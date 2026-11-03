// Cloudflare Worker and Authoritative Durable Object Room Server
// Validates room existence to stop phantom room joins

const ADMIN_SERVER_PIN = '7777';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      const roomCode = url.searchParams.get('room');
      if (!roomCode || roomCode.length !== 4) {
        return new Response('Invalid Room Code', { status: 400 });
      }

      const id = env.GAME_ROOM.idFromName(roomCode.toUpperCase());
      const roomObject = env.GAME_ROOM.get(id);
      return roomObject.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
    
    this.sessions = new Map();
    this.hostId = null;
    this.isInitialized = false; // Strictly prevents random non-existent room joins
    this.adminSockets = new Set();
    this.gameState = 'lobby'; // 'lobby' | 'headstart' | 'active' | 'finished'
    this.headstartSeconds = 60;
    this.roundSeconds = 600;
    this.scanInterval = 60;
    this.scanCountdown = 60;
    this.proximityTracking = new Map();
    this.activeDecoys = new Set();
    this.intervalTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pid = url.searchParams.get('pid');
    const name = decodeURIComponent(url.searchParams.get('name') || 'Player');
    const isHost = url.searchParams.get('isHost') === 'true';

    const pair = new WebSocketPair();
    const clientWs = pair[0];
    const serverWs = pair[1];

    serverWs.accept();

    // Check 1: If room does not exist and player is NOT the creator -> Reject phantom join!
    if (!this.isInitialized && !isHost) {
      setTimeout(() => {
        try {
          serverWs.send(JSON.stringify({
            type: 'error',
            payload: { message: `Room "${url.searchParams.get('room')}" does not exist! Please check the code.` }
          }));
          serverWs.close(1008, 'Room not found');
        } catch (e) {}
      }, 50);
      return new Response(null, { status: 101, webSocket: clientWs });
    }

    // Check 2: If match is already in progress -> Reject late joiners!
    if (this.gameState !== 'lobby') {
      setTimeout(() => {
        try {
          serverWs.send(JSON.stringify({
            type: 'error',
            payload: { message: 'This game round is already in progress!' }
          }));
          serverWs.close(1008, 'Game already active');
        } catch (e) {}
      }, 50);
      return new Response(null, { status: 101, webSocket: clientWs });
    }

    // Initialize room when legitimate host joins
    if (isHost && !this.isInitialized) {
      this.isInitialized = true;
      this.hostId = pid;
    }

    const sessionData = {
      id: pid,
      name: name,
      ready: false,
      role: 'hunter',
      lat: null,
      lng: null,
      accuracy: 999,
      petState: {},
      speedKmh: 0,
      isCheating: false,
      cheatReason: '',
      lastUpdate: Date.now()
    };

    this.sessions.set(serverWs, sessionData);

    serverWs.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleClientMessage(serverWs, msg);
      } catch (err) {
        console.error('DO Message parsing error:', err);
      }
    });

    serverWs.addEventListener('close', () => {
      this.adminSockets.delete(serverWs);
      this.sessions.delete(serverWs);
      if (this.hostId === pid && this.sessions.size > 0) {
        const next = this.sessions.values().next().value;
        this.hostId = next.id;
      }
      this.broadcastRoomState();
      this.broadcastAdminTelemetry();

      if (this.sessions.size === 0) {
        this.cleanup();
      }
    });

    this.broadcastRoomState();
    return new Response(null, { status: 101, webSocket: clientWs });
  }

  handleClientMessage(ws, msg) {
    const session = this.sessions.get(ws);
    if (!session) return;

    switch (msg.type) {
      case 'join':
        session.petState = msg.payload.petState || {};
        this.broadcastRoomState();
        break;

      case 'toggle_ready':
        session.ready = !!msg.payload.ready;
        this.broadcastRoomState();
        break;

      case 'host_start_game':
        if (session.id === this.hostId && this.gameState === 'lobby') {
          this.scanInterval = msg.payload.scanInterval || 60;
          this.scanCountdown = this.scanInterval;
          this.startGameFlow();
        }
        break;

      case 'location_update':
        this.processLocationWithAntiCheat(session, msg.payload);
        this.checkAuthoritativeCatches();
        this.checkHeartbeatProximities();
        this.broadcastAdminTelemetry();
        break;

      case 'deploy_decoy':
        if (session.role === 'hider') {
          this.activeDecoys.add(session.id);
        }
        break;

      case 'request_radar_ping':
        if (session.role === 'hunter' && this.gameState === 'active') {
          this.triggerSatelliteSweep(true, ws);
        }
        break;

      // Admin & Anti-Cheat Commands
      case 'admin_auth':
        if (msg.payload.pin === ADMIN_SERVER_PIN) {
          this.adminSockets.add(ws);
          this.broadcastAdminTelemetry();
        }
        break;

      case 'admin_request_telemetry':
        if (this.adminSockets.has(ws)) {
          this.broadcastAdminTelemetry();
        }
        break;

      case 'admin_force_start':
        if (this.adminSockets.has(ws) && this.gameState === 'lobby') {
          this.startGameFlow();
        }
        break;

      case 'admin_force_end':
        if (this.adminSockets.has(ws)) {
          this.endGame('hunters', 'Match ended by Overseer Admin.');
        }
        break;

      case 'admin_skip_stealth':
        if (this.adminSockets.has(ws) && this.gameState === 'headstart') {
          this.headstartSeconds = 1;
        }
        break;

      case 'admin_trigger_scan':
        if (this.adminSockets.has(ws)) {
          this.triggerSatelliteSweep(false);
        }
        break;

      case 'admin_kick_player':
        if (this.adminSockets.has(ws) && msg.payload.targetId) {
          for (let [clientSocket, s] of this.sessions.entries()) {
            if (s.id === msg.payload.targetId) {
              try { clientSocket.close(1000, 'Kicked by admin'); } catch(e) {}
              this.sessions.delete(clientSocket);
              break;
            }
          }
          this.broadcastRoomState();
          this.broadcastAdminTelemetry();
        }
        break;
    }
  }

  processLocationWithAntiCheat(session, payload) {
    const now = Date.now();
    const newLat = payload.lat;
    const newLng = payload.lng;
    const accuracy = payload.accuracy;

    if (session.lat !== null && session.lng !== null) {
      const dtSeconds = Math.max(0.5, (now - session.lastUpdate) / 1000);
      const distMeters = this.haversineMeters(session.lat, session.lng, newLat, newLng);
      const speedMps = distMeters / dtSeconds;
      const speedKmh = speedMps * 3.6;

      session.speedKmh = speedKmh;

      if (speedKmh > 38 && distMeters > 50) {
        session.isCheating = true;
        session.cheatReason = `Teleport (${speedKmh.toFixed(0)} km/h)`;
      } else if (accuracy === 0) {
        session.isCheating = true;
        session.cheatReason = 'Mock GPS Detected';
      } else {
        session.isCheating = false;
        session.cheatReason = '';
      }
    }

    session.lat = newLat;
    session.lng = newLng;
    session.accuracy = accuracy;
    session.lastUpdate = now;
  }

  broadcastAdminTelemetry() {
    if (this.adminSockets.size === 0) return;

    const telemetryData = Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      name: s.name,
      role: s.role,
      lat: s.lat,
      lng: s.lng,
      accuracy: s.accuracy,
      speedKmh: s.speedKmh,
      isCheating: s.isCheating,
      cheatReason: s.cheatReason
    }));

    const dataString = JSON.stringify({
      type: 'admin_telemetry_tick',
      payload: { players: telemetryData }
    });

    for (let adminWs of this.adminSockets) {
      try { adminWs.send(dataString); } catch(e) {}
    }
  }

  startGameFlow() {
    const playerArray = Array.from(this.sessions.values());
    if (playerArray.length < 2) return;

    const hiderCount = playerArray.length > 5 ? 2 : 1;
    const shuffled = [...playerArray].sort(() => 0.5 - Math.random());
    const hiders = shuffled.slice(0, hiderCount);
    const hiderIds = new Set(hiders.map(h => h.id));

    const rolesMap = {};
    for (let s of this.sessions.values()) {
      s.role = hiderIds.has(s.id) ? 'hider' : 'hunter';
      rolesMap[s.id] = s.role;
    }

    const hostSession = Array.from(this.sessions.values()).find(s => s.id === this.hostId);
    const winnerIndex = playerArray.findIndex(p => p.id === hiders[0].id);

    this.broadcast('spinner_start', {
      players: playerArray.map(p => ({ id: p.id, name: p.name })),
      winnerIndex: winnerIndex,
      hiderNames: hiders.map(h => h.name)
    });

    setTimeout(() => {
      this.gameState = 'headstart';
      this.headstartSeconds = 60;
      this.broadcast('game_start', {
        roles: rolesMap,
        initialLat: hostSession ? hostSession.lat : 0,
        initialLng: hostSession ? hostSession.lng : 0
      });

      this.startLoop();
    }, 4500);
  }

  startLoop() {
    clearInterval(this.intervalTimer);
    this.intervalTimer = setInterval(() => {
      if (this.gameState === 'headstart') {
        this.headstartSeconds--;
        this.broadcast('headstart_tick', { remaining: this.headstartSeconds });
        if (this.headstartSeconds <= 0) {
          this.gameState = 'active';
        }
      } else if (this.gameState === 'active') {
        this.roundSeconds--;
        this.scanCountdown--;

        this.broadcast('round_tick', {
          remaining: this.roundSeconds,
          scanCountdown: this.scanCountdown
        });

        if (this.scanCountdown <= 0) {
          this.triggerSatelliteSweep(false);
          this.scanCountdown = this.scanInterval;
        }

        this.checkAuthoritativeCatches();
        this.checkHeartbeatProximities();

        if (this.roundSeconds <= 0) {
          this.endGame('hiders', 'Time expired! Hiders successfully remained hidden.');
        }
      }
    }, 1000);
  }

  triggerSatelliteSweep(isManualPing = false, targetWs = null) {
    const hiders = Array.from(this.sessions.values()).filter(s => s.role === 'hider' && s.lat && s.lng);
    const snapshots = [];

    hiders.forEach(h => {
      let lat = h.lat;
      let lng = h.lng;
      let isDecoy = false;

      if (this.activeDecoys.has(h.id)) {
        isDecoy = true;
        this.activeDecoys.delete(h.id);
        const angle = Math.random() * 2 * Math.PI;
        const offsetDist = 80;
        lat += (offsetDist / 111111) * Math.cos(angle);
        lng += (offsetDist / (111111 * Math.cos(h.lat * (Math.PI / 180)))) * Math.sin(angle);
      }

      snapshots.push({ lat, lng, isDecoy });
    });

    const payload = { snapshots, isManual: isManualPing };

    if (targetWs) {
      this.sendTo(targetWs, 'satellite_sweep_pulse', payload);
    } else {
      for (let [ws, s] of this.sessions.entries()) {
        if (s.role === 'hunter') {
          this.sendTo(ws, 'satellite_sweep_pulse', payload);
        }
      }
    }
  }

  checkHeartbeatProximities() {
    if (this.gameState !== 'active') return;

    for (let [ws, s] of this.sessions.entries()) {
      let closest = 999;

      for (let other of this.sessions.values()) {
        if (other.id !== s.id && other.role !== s.role && other.lat && s.lat) {
          const d = this.haversineMeters(s.lat, s.lng, other.lat, other.lng);
          if (d < closest) closest = d;
        }
      }

      this.sendTo(ws, 'proximity_heartbeat', { closestMeters: closest });
    }
  }

  checkAuthoritativeCatches() {
    if (this.gameState !== 'active') return;

    const hunters = [];
    const hiders = [];

    for (const [ws, s] of this.sessions.entries()) {
      if (!s.lat || !s.lng || s.accuracy > 50 || s.isCheating) continue;

      if (s.role === 'hunter') hunters.push({ ws, session: s });
      else if (s.role === 'hider') hiders.push({ ws, session: s });
    }

    if (hiders.length === 0) {
      this.endGame('hunters', 'All hiders have been captured!');
      return;
    }

    const now = Date.now();

    for (const hunter of hunters) {
      let closeHider = null;

      for (const hider of hiders) {
        const dist = this.haversineMeters(
          hunter.session.lat, hunter.session.lng,
          hider.session.lat, hider.session.lng
        );

        if (dist <= 20) {
          closeHider = hider;
          break;
        }
      }

      if (closeHider) {
        const trackingKey = hunter.session.id;
        const track = this.proximityTracking.get(trackingKey);

        if (!track || track.hiderId !== closeHider.session.id) {
          this.proximityTracking.set(trackingKey, { hiderId: closeHider.session.id, startTime: now });
          this.sendTo(hunter.ws, 'catch_proximity_update', { progressPercent: 20 });
        } else {
          const elapsed = (now - track.startTime) / 1000;
          const progress = Math.min(100, Math.round((elapsed / 5.0) * 100));
          this.sendTo(hunter.ws, 'catch_proximity_update', { progressPercent: progress });

          if (elapsed >= 5.0) {
            closeHider.session.role = 'hunter';
            this.proximityTracking.delete(trackingKey);
            this.sendTo(hunter.ws, 'catch_proximity_update', { progressPercent: 0 });

            const remainingHiders = Array.from(this.sessions.values()).filter(s => s.role === 'hider');
            if (remainingHiders.length === 0) {
              this.endGame('hunters', `${hunter.session.name} caught the final hider!`);
            } else {
              this.broadcast('hider_caught', {
                hunterName: hunter.session.name,
                hiderName: closeHider.session.name
              });
            }
          }
        }
      } else {
        if (this.proximityTracking.has(hunter.session.id)) {
          this.proximityTracking.delete(hunter.session.id);
          this.sendTo(hunter.ws, 'catch_proximity_update', { progressPercent: 0 });
        }
      }
    }
  }

  endGame(winner, reason) {
    this.gameState = 'finished';
    clearInterval(this.intervalTimer);

    const coinsEarned = {};
    for (const s of this.sessions.values()) {
      coinsEarned[s.id] = (winner === 'hunters' && s.role === 'hunter') ? 45 : 20;
    }

    const rolesMap = {};
    for (let s of this.sessions.values()) {
      rolesMap[s.id] = s.role;
    }

    this.broadcast('game_over', {
      winner,
      reason,
      coinsEarned,
      roles: rolesMap,
      duration: 600 - this.roundSeconds
    });

    this.cleanup();
  }

  cleanup() {
    clearInterval(this.intervalTimer);
    this.proximityTracking.clear();
    this.activeDecoys.clear();
    this.gameState = 'lobby';
    this.isInitialized = false;
  }

  haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  broadcast(type, payload) {
    const data = JSON.stringify({ type, payload });
    for (const [ws] of this.sessions.entries()) {
      try { ws.send(data); } catch(e) {}
    }
  }

  sendTo(ws, type, payload) {
    try {
      ws.send(JSON.stringify({ type, payload }));
    } catch(e) {}
  }

  broadcastRoomState() {
    const playerArray = Array.from(this.sessions.values()).map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready
    }));

    this.broadcast('room_update', {
      hostId: this.hostId,
      players: playerArray
    });
  }
}
