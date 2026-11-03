import { GameMap } from './map.js';
import { network } from './network.js';
import { audio } from './audio.js';
import { getUserState, PET_CATALOG, PET_LEVELS, ACCESSORIES } from '../pets/petCatalog.js';

class GameManager {
  constructor() {
    this.map = null;
    this.geoWatchId = null;
    this.wakeLock = null;
    this.myRole = 'hunter';
    this.decoyAvailable = true;
  }

  start(role, initialLat, initialLng) {
    this.myRole = role;
    this.decoyAvailable = true;

    this.requestWakeLock();
    this.setupHUD();

    if (!this.map) {
      this.map = new GameMap('map-view');
    }
    this.map.init(initialLat || 0, initialLng || 0);

    this.startGPS();
    this.bindEvents();
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('Wake lock failed:', err);
      }
    }
  }

  startGPS() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    this.geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const gpsBadge = document.getElementById('hud-gps-status');
        if (gpsBadge) {
          if (accuracy > 50) {
            gpsBadge.textContent = `GPS: Weak (±${Math.round(accuracy)}m)`;
            gpsBadge.style.color = '#ff1744';
          } else {
            gpsBadge.textContent = `GPS: ±${Math.round(accuracy)}m`;
            gpsBadge.style.color = '#00e5ff';
          }
        }

        this.map.updateUserPosition(latitude, longitude, accuracy);

        network.send('location_update', {
          lat: latitude,
          lng: longitude,
          accuracy: accuracy
        });
      },
      (err) => {
        console.warn('GPS Error:', err.message);
        const gpsBadge = document.getElementById('hud-gps-status');
        if (gpsBadge) gpsBadge.textContent = 'GPS: Lost';
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000
      }
    );
  }

  setupHUD() {
    const roleBadge = document.getElementById('hud-role-badge');
    roleBadge.textContent = this.myRole.toUpperCase();
    roleBadge.className = `hud-role-pill ${this.myRole}`;

    const user = getUserState();
    const petId = this.myRole === 'hunter' ? user.equippedHunterPet : user.equippedHiderPet;
    const pet = PET_CATALOG[petId];
    const lvl = user.petLevels[petId] || 1;
    const accessory = ACCESSORIES[lvl - 1] || '';

    document.getElementById('hud-pet-name').textContent = pet.name;
    document.getElementById('hud-pet-icon').textContent = pet.emoji;
    document.getElementById('hud-pet-accessory').textContent = accessory;
    document.getElementById('hud-pet-level').textContent = `Lv ${lvl}`;

    const scanBtn = document.getElementById('btn-trigger-pet');
    const decoyBtn = document.getElementById('btn-trigger-decoy');

    if (this.myRole === 'hunter') {
      const mult = PET_LEVELS[lvl - 1].multiplier;
      const cd = Math.round(pet.baseCooldown / mult);
      document.getElementById('hud-pet-ability').textContent = `Manual Ping: ${cd}s`;
      scanBtn.style.display = 'inline-flex';
      decoyBtn.classList.add('hidden');
    } else {
      document.getElementById('hud-pet-ability').textContent = 'Spoofs Next Satellite Ping';
      scanBtn.style.display = 'none';
      decoyBtn.classList.remove('hidden');
    }
  }

  bindEvents() {
    const scanBtn = document.getElementById('btn-trigger-pet');
    if (scanBtn) {
      scanBtn.onclick = () => {
        audio.playSonarPing();
        network.send('request_radar_ping');
        scanBtn.disabled = true;
        let remaining = 25;
        const itv = setInterval(() => {
          remaining--;
          scanBtn.textContent = `Cooldown (${remaining}s)`;
          if (remaining <= 0) {
            clearInterval(itv);
            scanBtn.disabled = false;
            scanBtn.textContent = 'Ping Radar';
          }
        }, 1000);
      };
    }

    const decoyBtn = document.getElementById('btn-trigger-decoy');
    if (decoyBtn) {
      decoyBtn.onclick = () => {
        if (!this.decoyAvailable) return;
        this.decoyAvailable = false;
        network.send('deploy_decoy');
        decoyBtn.disabled = true;
        decoyBtn.textContent = 'Decoy Armed! 🎭';
        setTimeout(() => {
          decoyBtn.textContent = 'Decoy Expended';
        }, 3000);
      };
    }
  }

  handleHeartbeatProximity(distanceMeters) {
    const threatOverlay = document.getElementById('threat-overlay');

    if (distanceMeters <= 50) {
      threatOverlay.classList.add('active');
      const bpm = distanceMeters <= 20 ? 120 : (distanceMeters <= 35 ? 90 : 60);
      audio.startHeartbeat(bpm);
    } else {
      threatOverlay.classList.remove('active');
      audio.stopHeartbeat();
    }
  }

  handleCatchProgress(progressPercent) {
    const meter = document.getElementById('catch-meter');
    const bar = document.getElementById('catch-progress-bar');
    if (!meter || !bar) return;

    if (progressPercent > 0) {
      meter.classList.remove('hidden');
      bar.style.width = `${progressPercent}%`;
    } else {
      meter.classList.add('hidden');
      bar.style.width = '0%';
    }
  }

  stop() {
    audio.stopHeartbeat();
    if (this.geoWatchId !== null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
    if (this.wakeLock) {
      try { this.wakeLock.release(); } catch(e) {}
      this.wakeLock = null;
    }
    if (this.map) {
      this.map.clearAll();
    }
  }
}

export const game = new GameManager();
