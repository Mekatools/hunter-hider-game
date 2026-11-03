import { GameMap } from './map.js';
import { network } from './network.js';
import { getUserState, saveUserState, PET_CATALOG, PET_LEVELS, ACCESSORIES } from '../pets/petCatalog.js';

class GameManager {
  constructor() {
    this.map = null;
    this.geoWatchId = null;
    this.wakeLock = null;
    this.myRole = 'hunter';
    this.myId = null;
    this.radarCooldownTimer = 0;
    this.catchTimer = null;
  }

  start(role, playBoundary, initialLat, initialLng) {
    this.myRole = role;
    this.myId = network.playerId;

    this.requestWakeLock();
    this.setupHUD();

    if (!this.map) {
      this.map = new GameMap('map-view');
    }
    this.map.init(initialLat || 0, initialLng || 0);

    if (playBoundary && playBoundary.radius > 0) {
      this.map.setPlayBoundary(playBoundary.lat, playBoundary.lng, playBoundary.radius);
    }

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

        // Update local map
        this.map.updateUserPosition(latitude, longitude, accuracy);

        // Send authoritative location to Durable Object
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
    if (this.myRole === 'hunter') {
      const mult = PET_LEVELS[lvl - 1].multiplier;
      const cd = Math.round(pet.baseCooldown / mult);
      document.getElementById('hud-pet-ability').textContent = `Radar Cooldown: ${cd}s`;
      scanBtn.style.display = 'inline-flex';
    } else {
      const mult = PET_LEVELS[lvl - 1].multiplier;
      const range = Math.round(pet.baseWarningRange * mult);
      document.getElementById('hud-pet-ability').textContent = `Sense Radius: ${range}m`;
      scanBtn.style.display = 'none';
    }
  }

  bindEvents() {
    const scanBtn = document.getElementById('btn-trigger-pet');
    if (scanBtn) {
      scanBtn.onclick = () => {
        network.send('request_radar_ping');
        scanBtn.disabled = true;
        let remaining = 20;
        const itv = setInterval(() => {
          remaining--;
          scanBtn.textContent = `Cooldown (${remaining}s)`;
          if (remaining <= 0) {
            clearInterval(itv);
            scanBtn.disabled = false;
            scanBtn.textContent = 'Scan Radar';
          }
        }, 1000);
      };
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
