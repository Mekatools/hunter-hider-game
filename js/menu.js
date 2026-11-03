import { getUserState, saveUserState } from '../pets/petCatalog.js';
import { initPetShop } from '../pets/petShop.js';
import { network } from './network.js';
import { SpinnerWheel } from './spinner.js';
import { game } from './game.js';

let currentRoom = null;
let spinner = null;

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupLobby();
  setupNetworkHandlers();
  updateProfileDisplays();

  initPetShop((updatedUser) => {
    updateProfileDisplays();
  });

  spinner = new SpinnerWheel('spinner-canvas');
});

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

function updateProfileDisplays() {
  const user = getUserState();
  const nameEl = document.getElementById('user-display-name');
  const coinsEl = document.getElementById('user-display-coins');
  const statRounds = document.getElementById('stat-rounds');
  const statCatches = document.getElementById('stat-catches');
  const statTime = document.getElementById('stat-hide-time');

  if (nameEl) nameEl.textContent = user.name;
  if (coinsEl) coinsEl.textContent = user.coins;
  if (statRounds) statRounds.textContent = user.stats.roundsPlayed;
  if (statCatches) statCatches.textContent = user.stats.catches;
  if (statTime) statTime.textContent = `${Math.round(user.stats.totalHideTimeSeconds / 60)} min`;
}

function setupNavigation() {
  // Landing Actions
  document.getElementById('btn-landing-play')?.addEventListener('click', () => {
    showScreen('screen-menu');
  });

  document.getElementById('btn-quick-play')?.addEventListener('click', () => {
    showScreen('screen-menu');
  });

  document.getElementById('btn-landing-safety')?.addEventListener('click', () => {
    document.getElementById('modal-safety').classList.remove('hidden');
  });

  document.getElementById('btn-accept-safety')?.addEventListener('click', () => {
    document.getElementById('modal-safety').classList.add('hidden');
  });

  // Menu Actions
  document.getElementById('btn-menu-create')?.addEventListener('click', () => {
    const code = generateRoomCode();
    joinOrHostRoom(code, true);
  });

  document.getElementById('btn-menu-join')?.addEventListener('click', () => {
    showScreen('screen-join');
  });

  document.getElementById('btn-menu-shop')?.addEventListener('click', () => {
    showScreen('screen-shop');
  });

  document.getElementById('btn-open-profile')?.addEventListener('click', () => {
    const user = getUserState();
    document.getElementById('profile-name-input').value = user.name;
    showScreen('screen-profile');
  });

  // Back Buttons
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target || 'screen-menu';
      showScreen(target);
    });
  });

  // Profile Save
  document.getElementById('btn-profile-save')?.addEventListener('click', () => {
    const newName = document.getElementById('profile-name-input').value.trim();
    if (newName) {
      const user = getUserState();
      user.name = newName;
      saveUserState(user);
      updateProfileDisplays();
      showScreen('screen-menu');
    }
  });

  // Join Form Submit
  document.getElementById('btn-submit-join')?.addEventListener('click', () => {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    const name = document.getElementById('join-name-input').value.trim();
    if (code.length !== 4) {
      alert('Please enter a valid 4-letter room code.');
      return;
    }
    if (name) {
      const user = getUserState();
      user.name = name;
      saveUserState(user);
      updateProfileDisplays();
    }
    joinOrHostRoom(code, false);
  });

  // Game HUD Exit
  document.getElementById('btn-game-leave')?.addEventListener('click', () => {
    if (confirm('Leave current round?')) {
      game.stop();
      network.disconnect();
      showScreen('screen-menu');
    }
  });

  // Results back button
  document.getElementById('btn-results-menu')?.addEventListener('click', () => {
    showScreen('screen-menu');
  });
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function joinOrHostRoom(code, isHost) {
  currentRoom = code;
  const user = getUserState();
  const playerId = 'p_' + Math.random().toString(36).substring(2, 9);

  document.getElementById('lobby-code-display').textContent = code;
  showScreen('screen-lobby');

  const hostPanel = document.getElementById('host-settings-panel');
  if (hostPanel) hostPanel.style.display = isHost ? 'flex' : 'none';

  network.init(code, playerId, user.name, {
    hunterPet: user.equippedHunterPet,
    hiderPet: user.equippedHiderPet,
    petLevels: user.petLevels
  });
}

function setupLobby() {
  const btnReady = document.getElementById('btn-lobby-ready');
  let isReady = false;

  btnReady?.addEventListener('click', () => {
    isReady = !isReady;
    btnReady.textContent = isReady ? 'Cancel Ready' : 'Ready Up';
    btnReady.className = isReady ? 'btn btn-outline btn-block' : 'btn btn-secondary btn-block';
    network.send('toggle_ready', { ready: isReady });
  });

  const btnStart = document.getElementById('btn-lobby-start');
  btnStart?.addEventListener('click', () => {
    const boundaryRadius = parseInt(document.getElementById('select-boundary').value, 10);
    network.send('host_start_game', { boundaryRadius });
  });

  document.getElementById('btn-copy-code')?.addEventListener('click', () => {
    const shareText = `Join my Hunter vs Hider room! Code: ${currentRoom}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText);
      alert('Room code copied to clipboard!');
    }
  });
}

function setupNetworkHandlers() {
  network.on('room_update', (data) => {
    const list = document.getElementById('lobby-players-ul');
    const countEl = document.getElementById('player-count');
    const btnStart = document.getElementById('btn-lobby-start');
    if (!list) return;

    list.innerHTML = '';
    countEl.textContent = data.players.length;

    let allReady = data.players.length >= 2;

    data.players.forEach(p => {
      if (!p.ready && p.id !== data.hostId) allReady = false;

      const li = document.createElement('li');
      li.className = 'player-item';
      li.innerHTML = `
        <div class="player-item-meta">
          <strong>${p.name}</strong> ${p.id === data.hostId ? '👑' : ''}
        </div>
        <span class="status-pill ${p.ready ? 'ready' : 'waiting'}">
          ${p.ready ? 'READY' : 'WAITING'}
        </span>
      `;
      list.appendChild(li);
    });

    if (btnStart) {
      btnStart.disabled = !(data.hostId === network.playerId && allReady);
    }
  });

  network.on('spinner_start', (data) => {
    const overlay = document.getElementById('spinner-overlay');
    overlay.classList.remove('hidden');
    spinner.setPlayers(data.players);

    spinner.spinToWinner(data.winnerIndex, () => {
      document.getElementById('spinner-result').textContent = `${data.hiderNames.join(', ')} is hiding!`;
      setTimeout(() => {
        overlay.classList.add('hidden');
      }, 2000);
    });
  });

  network.on('game_start', (data) => {
    showScreen('screen-game');
    const myRole = data.roles[network.playerId] || 'hunter';
    game.start(myRole, data.boundary, data.initialLat, data.initialLng);

    if (myRole === 'hunter') {
      const headstartCover = document.getElementById('headstart-cover');
      headstartCover.classList.remove('hidden');
    }
  });

  network.on('headstart_tick', (data) => {
    const secondsEl = document.getElementById('headstart-seconds');
    if (secondsEl) secondsEl.textContent = data.remaining;
    if (data.remaining <= 0) {
      document.getElementById('headstart-cover').classList.add('hidden');
    }
  });

  network.on('round_tick', (data) => {
    const minutes = Math.floor(data.remaining / 60);
    const seconds = data.remaining % 60;
    const formatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    const timerDisplay = document.getElementById('hud-timer-display');
    if (timerDisplay) timerDisplay.textContent = formatted;
  });

  network.on('radar_ping', (data) => {
    if (game.map) {
      game.map.displayRadarHint(data.lat, data.lng, data.radius);
    }
  });

  network.on('catch_proximity_update', (data) => {
    game.handleCatchProgress(data.progressPercent);
  });

  network.on('game_over', (data) => {
    game.stop();
    showScreen('screen-results');

    document.getElementById('results-title').textContent = data.winner === 'hunters' ? 'Hunters Won!' : 'Hiders Escaped!';
    document.getElementById('results-reason').textContent = data.reason;

    const user = getUserState();
    const coinsEarned = data.coinsEarned[network.playerId] || 10;
    document.getElementById('results-coins-amount').textContent = coinsEarned;

    user.coins += coinsEarned;
    user.stats.roundsPlayed += 1;
    if (data.catches && data.catches[network.playerId]) {
      user.stats.catches += data.catches[network.playerId];
    }
    if (data.roles[network.playerId] === 'hider') {
      user.stats.totalHideTimeSeconds += data.hideDurationSeconds || 0;
    }
    saveUserState(user);
    updateProfileDisplays();

    document.getElementById('results-time-stat').textContent = `${Math.floor(data.duration / 60)}m ${data.duration % 60}s`;
    document.getElementById('results-catches-stat').textContent = data.totalCatches || 0;
  });
}
