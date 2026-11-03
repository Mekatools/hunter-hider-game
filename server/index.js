// Cloudflare Worker and Authoritative Durable Object Room Server with Anti-Cheat

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
    
    // In-memory runtime state
    this.sessions = new Map(); // WebSocket -> session object
    this.hostId = null;
    this.adminSockets = new Set();
    this.gameState = 'lobby'; // 'lobby' | 'headstart' | 'active' | 'finished'
    this.headstartSeconds = 60;
    this.roundSeconds = 600;
    this.boundary = { lat: 0, lng: 0, radius: 0 };
    this.proximityTracking = new Map();
    this.intervalTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pid = url.searchParams.get('pid');
    const name = decodeURIComponent(url.searchParams.get('name') || 'Player');

    const pair = new WebSocketPair();
    const clientWs = pair[0];
    const serverWs = pair[1];

    serverWs.accept();

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
    if (!this.hostId) {
      this.hostId = pid;
    }

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
          this.boundary.radius = msg.payload.boundaryRadius || 0;
          this.startGameFlow();
        }
        break;

      case 'location_update':
        this.processLocationWithAntiCheat(session, msg.payload);
        this.checkAuthoritativeCatches();
        this.broadcastAdminTelemetry();
        break;

      case 'request_radar_ping':
        if (session.role === 'hunter' && this.gameState === 'active') {
          this.computeRadarHintForHunter(session, ws);
        }
        break;

      // ================= ADMIN & ANTI-CHEAT COMMANDS =================
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
          this.endGame('hunters', 'Match terminated by Overseer Admin.');
        }
        break;

      case 'admin_skip_stealth':
        if (this.adminSockets.has(ws) && this.gameState === 'headstart') {
          this.headstartSeconds = 1;
        }
        break;

      case 'admin_reveal_all':
        if (this.adminSockets.has(ws)) {
          // Reveal exact hider coordinates to the admin
          for (let s of this.sessions.values()) {
            if (s.role === 'hider' && s.lat && s.lng) {
              this.sendTo(ws, 'radar_ping', { lat: s.lat, lng: s.lng, radius: 10 });
            }
          }
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

  // Anti-Cheat Engine: Detects instant teleports, impossible running speeds, and mock GPS signatures
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

      // Anti-Cheat Rule 1: Human sprint limit is ~35-44 km/h
      // If moving faster than 38 km/h or teleporting > 150m in seconds, flag cheat
      if (speedKmh > 38 && distMeters > 50) {
        session.isCheating = true;
        session.cheatReason = `Teleport (${speedKmh.toFixed(0)} km/h)`;
      } 
      // Anti-Cheat Rule 2: Fake GPS apps reporting absolute zero accuracy
      else if (accuracy === 0) {
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
    if (hostSession && hostSession.lat) {
      this.boundary.lat = hostSession.lat;
      this.boundary.lng = hostSession.lng;
    }

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
        boundary: this.boundary,
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
        this.broadcast('round_tick', { remaining: this.roundSeconds });
        this.checkAuthoritativeCatches();

        if (this.roundSeconds <= 0) {
          this.endGame('hiders', 'Time expired! Hiders successfully remained hidden.');
        }
      }
    }, 1000);
  }

  checkAuthoritativeCatches() {
    if (this.gameState !== 'active') return;

    const hunters = [];
    const hiders = [];

    for (const [ws, s] of this.sessions.entries()) {
      if (!s.lat || !s.lng) continue;
      // Low-accuracy or detected cheaters cannot trigger catches
      if (s.accuracy > 50 || s.isCheating) continue;

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

  computeRadarHintForHunter(hunterSession, hunterWs) {
    const hiders = Array.from(this.sessions.values()).filter(s => s.role === 'hider' && s.lat && s.lng);
    if (hiders.length === 0) return;

    const target = hiders[0];
    const petLevel = hunterSession.petState.petLevels ? (hunterSession.petState.petLevels[hunterSession.petState.hunterPet] || 1) : 1;
    const baseRadius = 120;
    const radius = Math.max(45, baseRadius - (petLevel * 15));

    const angle = Math.random() * 2 * Math.PI;
    const offsetMeters = Math.random() * (radius * 0.6);
    const offsetLat = (offsetMeters / 111111) * Math.cos(angle);
    const offsetLng = (offsetMeters / (111111 * Math.cos(target.lat * (Math.PI / 180)))) * Math.sin(angle);

    this.sendTo(hunterWs, 'radar_ping', {
      lat: target.lat + offsetLat,
      lng: target.lng + offsetLng,
      radius: radius
    });
  }

  endGame(winner, reason) {
    this.gameState = 'finished';
    clearInterval(this.intervalTimer);

    const coinsEarned = {};
    for (const s of this.sessions.values()) {
      if (winner === 'hunters' && s.role === 'hunter') {
        coinsEarned[s.id] = 40;
      } else if (winner === 'hiders' && s.role === 'hider') {
        coinsEarned[s.id] = 60;
      } else {
        coinsEarned[s.id] = 15;
      }
    }

    const rolesMap = {};
    for (const s of this.sessions.values()) {
      rolesMap[s.id] = s.role;
    }

    this.broadcast('game_over', {
      winner,
      reason,
      coinsEarned,
      roles: rolesMap,
      duration: 600 - this.roundSeconds,
      hideDurationSeconds: 600 - this.roundSeconds
    });

    this.cleanup();
  }

  cleanup() {
    clearInterval(this.intervalTimer);
    this.proximityTracking.clear();
    this.gameState = 'lobby';
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
