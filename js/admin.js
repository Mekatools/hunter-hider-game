// Secret Admin & Anti-Cheat Command Center

import { network } from './network.js';
import { getUserState, saveUserState, PET_CATALOG } from '../pets/petCatalog.js';

const ADMIN_PIN = '7777'; // Change this to any secret PIN you prefer
let clickCounter = 0;
let clickResetTimer = null;
let isAdminAuthenticated = false;

document.addEventListener('DOMContentLoaded', () => {
  setupSecretAdminTriggers();
  setupAdminUI();
  setupNetworkAdminHandlers();
});

function setupSecretAdminTriggers() {
  const triggers = document.querySelectorAll('.secret-admin-trigger');
  triggers.forEach(el => {
    el.addEventListener('click', () => {
      clickCounter++;
      clearTimeout(clickResetTimer);
      clickResetTimer = setTimeout(() => {
        clickCounter = 0;
      }, 2500);

      // 5 rapid taps triggers admin authentication
      if (clickCounter >= 5) {
        clickCounter = 0;
        promptAdminLogin();
      }
    });
  });
}

function promptAdminLogin() {
  if (isAdminAuthenticated) {
    openAdminModal();
    return;
  }

  const enteredPin = prompt('🔒 ENTER OVERSEER ACCESS PIN:');
  if (enteredPin === ADMIN_PIN) {
    isAdminAuthenticated = true;
    network.send('admin_auth', { pin: enteredPin });
    openAdminModal();
  } else if (enteredPin !== null) {
    alert('Access Denied: Invalid Security Credential.');
  }
}

function openAdminModal() {
  const modal = document.getElementById('modal-admin');
  if (modal) modal.classList.remove('hidden');
  network.send('admin_request_telemetry');
}

function closeAdminModal() {
  const modal = document.getElementById('modal-admin');
  if (modal) modal.classList.add('hidden');
}

function setupAdminUI() {
  document.getElementById('btn-close-admin')?.addEventListener('click', closeAdminModal);

  // Tab switching
  const tabBtns = document.querySelectorAll('.admin-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-view').forEach(v => v.classList.remove('active'));

      btn.classList.add('active');
      const targetView = document.getElementById(`admin-tab-${btn.dataset.tab}`);
      if (targetView) targetView.classList.add('active');
    });
  });

  // Tab 2 Controls
  document.getElementById('btn-admin-force-start')?.addEventListener('click', () => {
    network.send('admin_force_start');
  });

  document.getElementById('btn-admin-force-end')?.addEventListener('click', () => {
    network.send('admin_force_end');
  });

  document.getElementById('btn-admin-skip-stealth')?.addEventListener('click', () => {
    network.send('admin_skip_stealth');
  });

  document.getElementById('btn-admin-reveal-all')?.addEventListener('click', () => {
    network.send('admin_reveal_all');
  });

  // Tab 3 Secret Coins
  document.getElementById('btn-admin-add-100')?.addEventListener('click', () => {
    const user = getUserState();
    user.coins += 100;
    saveUserState(user);
    refreshDisplays(user);
    alert('Granted +100 Secret Coins!');
  });

  document.getElementById('btn-admin-add-500')?.addEventListener('click', () => {
    const user = getUserState();
    user.coins += 500;
    saveUserState(user);
    refreshDisplays(user);
    alert('Granted +500 Secret Coins!');
  });

  document.getElementById('btn-admin-max-pets')?.addEventListener('click', () => {
    const user = getUserState();
    user.unlockedPets = Object.keys(PET_CATALOG);
    Object.keys(PET_CATALOG).forEach(id => {
      user.petLevels[id] = 5;
    });
    saveUserState(user);
    refreshDisplays(user);
    alert('Unlocked and maxed out all companions to Level 5!');
  });
}

function refreshDisplays(user) {
  const coinsDisplay = document.getElementById('user-display-coins');
  const shopCoins = document.getElementById('shop-coins-display');
  if (coinsDisplay) coinsDisplay.textContent = user.coins;
  if (shopCoins) shopCoins.textContent = user.coins;
}

function setupNetworkAdminHandlers() {
  network.on('admin_telemetry_tick', (data) => {
    renderTelemetryTable(data.players);
  });
}

function renderTelemetryTable(players) {
  const tbody = document.getElementById('admin-telemetry-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!players || players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No active players in room</td></tr>`;
    return;
  }

  players.forEach(p => {
    const tr = document.createElement('tr');

    let statusHtml = '<span class="status-badge-ok">🟢 Normal</span>';
    if (p.isCheating) {
      statusHtml = `<span class="status-badge-cheat">⚠️ ${p.cheatReason}</span>`;
    } else if (p.accuracy > 50) {
      statusHtml = '<span class="status-badge-warn">🟡 Weak GPS</span>';
    }

    tr.innerHTML = `
      <td><strong>${p.name}</strong></td>
      <td><span class="hud-role-pill ${p.role}" style="font-size:0.65rem; padding:2px 8px;">${p.role.toUpperCase()}</span></td>
      <td>${p.speedKmh ? p.speedKmh.toFixed(1) : 0} km/h</td>
      <td>±${p.accuracy ? Math.round(p.accuracy) : '?'}m</td>
      <td>${statusHtml}</td>
      <td>
        <button class="btn btn-xs btn-outline btn-kick-player" data-id="${p.id}">Kick</button>
      </td>
    `;

    tr.querySelector('.btn-kick-player')?.addEventListener('click', () => {
      if (confirm(`Kick ${p.name} from room?`)) {
        network.send('admin_kick_player', { targetId: p.id });
      }
    });

    tbody.appendChild(tr);
  });
}
