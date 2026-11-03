import { getUserState, saveUserState } from '../pets/petCatalog.js';
import { initPetShop } from '../pets/petShop.js';
import { network } from './network.js';
import { SpinnerWheel } from './spinner.js';
import { game } from './game.js';
import { audio } from './audio.js';

let currentRoom = null;
let spinner = null;
let qrScanner = null;
let qrCodeGenerator = null;

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupLobby();
  setupNetworkHandlers();
  setupQRFeatures();
  setupLeaderboard();
  updateProfileDisplays();

  initPetShop((updatedUser) => {
    updateProfileDisplays();
  });

  spinner = new SpinnerWheel('spinner-canvas');

  // Check URL params for direct join link: ?join=ABCD
  const params = new URLSearchParams(window.location.search);
  const autoJoinCode = params.get('join');
  if (autoJoinCode && autoJoinCode.length === 4) {
    document.getElementById('join-code-input').value = autoJoinCode.toUpperCase();
    showScreen('screen-join');
  }
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
  document.getElementById('btn-landing-play')?.addEventListener('click', () => {
    audio.init();
    showScreen('screen-menu');
  });

  document.getElementById('btn-quick-play')?.addEventListener('click', () => {
    audio.init();
    showScreen('screen-menu');
  });

  document.getElementById('btn-landing-safety')?.addEventListener('click', () => {
    document.getElementById('modal-safety').classList.remove('hidden');
  });

  document.getElementById('btn-accept-safety')?.addEventListener('click', () => {
    document.getElementById('modal-safety').classList.add('hidden');
  });

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

  document.getElementById('btn-menu-leaderboard')?.addEventListener('click', () => {
    renderLeaderboard('hunters');
    showScreen('screen-leaderboard');
  });

  document.getElementById('btn-open-profile')?.addEventListener('click', () => {
    const user = getUserState();
    document.getElementById('profile-name-input').value = user.name;
    showScreen('screen-profile');
  });

  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target || 'screen-menu';
      showScreen(target);
    });
  });

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

  document.getElementById('btn-game-leave')?.addEventListener('click', () => {
    if (confirm('Leave current session?')) {
      game.stop();
      network.disconnect();
      showScreen('screen-menu');
    }
  });

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
  }, isHost);
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
    const scanInterval = parseInt(document.getElementById('select-scan-interval').value, 10) || 60;
    network.send('host_start_game', { scanInterval });
  });

  document.getElementById('btn-copy-code')?.addEventListener('click', () => {
    const joinUrl = `${window.location.origin}/?join=${currentRoom}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(joinUrl);
      alert('Squad link copied to clipboard!');
    }
  });
}

// QR Code Generator & Camera Scanner Features
function setupQRFeatures() {
  const btnShowQr = document.getElementById('btn-show-qr');
  const modalQrCode = document.getElementById('modal-qr-code');
  const btnCloseQr = document.getElementById('btn-close-qr-code');
  const qrContainer = document.getElementById('qrcode-container');

  btnShowQr?.addEventListener('click', () => {
    modalQrCode.classList.remove('hidden');
    document.getElementById('qr-code-text').textContent = currentRoom;
    qrContainer.innerHTML = '';

    const joinUrl = `${window.location.origin}/?join=${currentRoom}`;
    if (window.QRCode) {
      qrCodeGenerator = new window.QRCode(qrContainer, {
        text: joinUrl,
        width: 190,
        height: 190,
        colorDark: '#0e0a1a',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
  });

  btnCloseQr?.addEventListener('click', () => {
    modalQrCode.classList.add('hidden');
  });

  // QR Scanner for Joiner
  const btnOpenScanner = document.getElementById('btn-open-scanner');
  const modalScanner = document.getElementById('modal-qr-scanner');
  const btnCloseScanner = document.getElementById('btn-close-scanner');

  btnOpenScanner?.addEventListener('click', async () => {
    modalScanner.classList.remove('hidden');
    if (window.Html5Qrcode) {
      qrScanner = new window.Html5Qrcode('qr-scanner-view');
      try {
        await qrScanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            // Found QR Code!
            qrScanner.stop();
            modalScanner.classList.add('hidden');

            let code = decodedText.trim().toUpperCase();
            if (code.includes('JOIN=')) {
              code = code.split('JOIN=')[1].substring(0, 4);
            }
            if (code.length === 4) {
              document.getElementById('join-code-input').value = code;
              document.getElementById('btn-submit-join').click();
            } else {
              alert(`Invalid Room QR: ${decodedText}`);
            }
          },
          () => {} // frame error ignore
        );
      } catch (err) {
        alert('Camera access denied or unavailable: ' + err);
        modalScanner.classList.add('hidden');
      }
    }
  });

  btnCloseScanner?.addEventListener('click', () => {
    if (qrScanner) {
      qrScanner.stop().catch(() => {});
    }
    modalScanner.classList.add('hidden');
  });
}

// Tactical Leaderboard
function setupLeaderboard() {
  const tabs = document.querySelectorAll('.leaderboard-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderLeaderboard(tab.dataset.tab);
    });
  });
}

function renderLeaderboard(category) {
  const headers = document.getElementById('leaderboard-headers');
  const tbody = document.getElementById('leaderboard-body');
  if (!tbody || !headers) return;
  tbody.innerHTML = '';

  const user = getUserState();

  if (category === 'hunters') {
    headers.innerHTML = `<th>Rank</th><th>Operative</th><th>Catches</th><th>Rounds</th>`;
    const roster = [
      { rank: '🥇', name: 'GhostRecon', catches: 42, rounds: 50 },
      { rank: '🥈', name: 'NightOwl', catches: 31, rounds: 38 },
      { rank: '🥉', name: 'ShadowHawk', catches: 27, rounds: 30 },
      { rank: '4th', name: user.name + ' (You)', catches: user.stats.catches, rounds: user.stats.roundsPlayed }
    ].sort((a, b) => b.catches - a.catches);

    roster.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.rank}</td><td><strong>${r.name}</strong></td><td>${r.catches}</td><td>${r.rounds}</td>`;
      tbody.appendChild(tr);
    });
  } else if (category === 'hiders') {
    headers.innerHTML = `<th>Rank</th><th>Operative</th><th>Stealth Time</th><th>Status</th>`;
    const userMinutes = Math.round(user.stats.totalHideTimeSeconds / 60);
    const roster = [
      { rank: '🥇', name: 'PhantomFox', time: '115 min', status: 'Elite' },
      { rank: '🥈', name: 'Viper', time: '84 min', status: 'Veteran' },
      { rank: '🥉', name: user.name + ' (You)', time: `${userMinutes} min`, status: 'Operative' }
    ];

    roster.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.rank}</td><td><strong>${r.name}</strong></td><td>${r.time}</td><td><span class="status-badge-ok">${r.status}</span></td>`;
      tbody.appendChild(tr);
    });
  } else if (category === 'wealth') {
    headers.innerHTML = `<th>Rank</th><th>Operative</th><th>Coins</th><th>Companions</th>`;
    const roster = [
      { rank: '🥇', name: 'DragonLord', coins: 1450, pets: '8/8' },
      { rank: '🥈', name: user.name + ' (You)', coins: user.coins, pets: `${user.unlockedPets.length}/8` },
      { rank: '🥉', name: 'SilverFang', coins: 280, pets: '3/8' }
    ].sort((a, b) => b.coins - a.coins);

    roster.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.rank}</td><td><strong>${r.name}</strong></td><td>💰 ${r.coins}</td><td>${r.pets}</td>`;
      tbody.appendChild(tr);
    });
  }
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
    game.start(myRole, data.initialLat, data.initialLng);

    if (myRole === 'hunter') {
      document.getElementById('headstart-cover').classList.remove('hidden');
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

    const scanText = document.getElementById('scan-countdown-text');
    if (scanText) scanText.textContent = `${data.scanCountdown}s`;

    if (data.scanCountdown <= 3 && data.scanCountdown > 0) {
      audio.playScanWarning();
    }
  });

  network.on('satellite_sweep_pulse', (data) => {
    audio.playSonarPing();
    if (game.map && data.snapshots) {
      data.snapshots.forEach(s => {
        game.map.addSnapshotIntel(s.lat, s.lng, s.isDecoy);
      });
    }
  });

  network.on('proximity_heartbeat', (data) => {
    game.handleHeartbeatProximity(data.closestMeters);
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
    const coinsEarned = data.coinsEarned[network.playerId] || 15;
    document.getElementById('results-coins-amount').textContent = coinsEarned;

    user.coins += coinsEarned;
    user.stats.roundsPlayed += 1;
    saveUserState(user);
    updateProfileDisplays();

    document.getElementById('results-time-stat').textContent = `${Math.floor(data.duration / 60)}m ${data.duration % 60}s`;
    document.getElementById('results-catches-stat').textContent = data.totalCatches || 0;
  });
}
