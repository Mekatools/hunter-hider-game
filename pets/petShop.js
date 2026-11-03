import { PET_CATALOG, PET_LEVELS, ACCESSORIES, getUserState, saveUserState } from './petCatalog.js';

let currentTab = 'hunter';

export function initPetShop(onStateChange) {
  const tabs = document.querySelectorAll('.shop-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.team;
      renderShopList(onStateChange);
    });
  });

  updateShopHeader();
  renderShopList(onStateChange);
}

export function updateShopHeader() {
  const user = getUserState();
  const balanceEl = document.getElementById('shop-coins-display');
  if (balanceEl) balanceEl.textContent = user.coins;
}

export function renderShopList(onStateChange) {
  const container = document.getElementById('shop-cards-list');
  if (!container) return;
  container.innerHTML = '';

  const user = getUserState();
  const pets = Object.values(PET_CATALOG).filter(p => p.team === currentTab);

  pets.forEach(pet => {
    const isUnlocked = user.unlockedPets.includes(pet.id);
    const isEquipped = (pet.team === 'hunter' && user.equippedHunterPet === pet.id) ||
                       (pet.team === 'hider' && user.equippedHiderPet === pet.id);
    const level = user.petLevels[pet.id] || 1;
    const accessory = ACCESSORIES[level - 1] || '';
    const nextLevelData = PET_LEVELS[level];

    const card = document.createElement('div');
    card.className = 'shop-item-card';

    let actionBtnHtml = '';
    if (!isUnlocked) {
      actionBtnHtml = `<button class="btn btn-primary btn-sm btn-buy" data-id="${pet.id}">Buy (${pet.price} 💰)</button>`;
    } else if (isEquipped) {
      actionBtnHtml = `<button class="btn btn-outline btn-sm" disabled>Equipped</button>`;
    } else {
      actionBtnHtml = `<button class="btn btn-secondary btn-sm btn-equip" data-id="${pet.id}">Equip</button>`;
    }

    let upgradeBtnHtml = '';
    if (isUnlocked && level < 5 && nextLevelData) {
      upgradeBtnHtml = `<button class="btn btn-secondary btn-xs btn-upgrade" data-id="${pet.id}">Upgrade Lv${level + 1} (${nextLevelData.cost} 💰)</button>`;
    } else if (isUnlocked && level >= 5) {
      upgradeBtnHtml = `<span class="badge-level">MAX LEVEL</span>`;
    }

    card.innerHTML = `
      <div class="shop-item-info">
        <div class="shop-item-icon">${pet.emoji} ${accessory}</div>
        <div>
          <strong>${pet.name} <small class="badge-level">Lv ${level}</small></strong>
          <p style="font-size:0.75rem; color:var(--text-muted);">${pet.desc}</p>
          <div style="margin-top:4px;">${upgradeBtnHtml}</div>
        </div>
      </div>
      <div>
        ${actionBtnHtml}
      </div>
    `;

    // Hook buttons
    const buyBtn = card.querySelector('.btn-buy');
    if (buyBtn) {
      buyBtn.addEventListener('click', () => buyPet(pet.id, onStateChange));
    }
    const equipBtn = card.querySelector('.btn-equip');
    if (equipBtn) {
      equipBtn.addEventListener('click', () => equipPet(pet.id, onStateChange));
    }
    const upgradeBtn = card.querySelector('.btn-upgrade');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => upgradePet(pet.id, onStateChange));
    }

    container.appendChild(card);
  });
}

function buyPet(petId, onStateChange) {
  const user = getUserState();
  const pet = PET_CATALOG[petId];
  if (!pet) return;

  if (user.coins < pet.price) {
    alert('Not enough coins to adopt this companion!');
    return;
  }

  user.coins -= pet.price;
  user.unlockedPets.push(petId);
  saveUserState(user);
  updateShopHeader();
  renderShopList(onStateChange);
  if (onStateChange) onStateChange(user);
}

function equipPet(petId, onStateChange) {
  const user = getUserState();
  const pet = PET_CATALOG[petId];
  if (!pet) return;

  if (pet.team === 'hunter') {
    user.equippedHunterPet = pet.id;
  } else {
    user.equippedHiderPet = pet.id;
  }

  saveUserState(user);
  renderShopList(onStateChange);
  if (onStateChange) onStateChange(user);
}

function upgradePet(petId, onStateChange) {
  const user = getUserState();
  const currentLvl = user.petLevels[petId] || 1;
  const nextLevelData = PET_LEVELS[currentLvl];

  if (!nextLevelData || currentLvl >= 5) return;
  if (user.coins < nextLevelData.cost) {
    alert('Not enough coins to upgrade this companion!');
    return;
  }

  user.coins -= nextLevelData.cost;
  user.petLevels[petId] = currentLvl + 1;
  saveUserState(user);
  updateShopHeader();
  renderShopList(onStateChange);
  if (onStateChange) onStateChange(user);
}
