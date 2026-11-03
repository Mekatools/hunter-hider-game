// Pet catalog containing definitions, stats, and upgrade levels

export const ACCESSORIES = ['', '🎀', '🕶️', '👑', '🔥'];

export const PET_LEVELS = [
  { level: 1, cost: 0,   multiplier: 1.0 },
  { level: 2, cost: 50,  multiplier: 1.25 },
  { level: 3, cost: 100, multiplier: 1.55 },
  { level: 4, cost: 200, multiplier: 1.90 },
  { level: 5, cost: 350, multiplier: 2.40 }
];

export const PET_CATALOG = {
  // Hunter Pets
  hawk: {
    id: 'hawk',
    name: 'Hunter Hawk',
    team: 'hunter',
    emoji: '🦅',
    price: 0, // Starter free
    baseCooldown: 30, // seconds between pings
    baseRadius: 140,  // meters accuracy area
    desc: 'Pings approximate hider zones from the sky.'
  },
  wolf: {
    id: 'wolf',
    name: 'Shadow Wolf',
    team: 'hunter',
    emoji: '🐺',
    price: 100,
    baseCooldown: 24,
    baseRadius: 110,
    desc: 'Tracks scent with sharper radius precision.'
  },
  owl: {
    id: 'owl',
    name: 'Night Owl',
    team: 'hunter',
    emoji: '🦉',
    price: 150,
    baseCooldown: 18,
    baseRadius: 90,
    desc: 'Swift nocturnal vision allows fast radar scans.'
  },
  dragon: {
    id: 'dragon',
    name: 'Inferno Dragon',
    team: 'hunter',
    emoji: '🐲',
    price: 300,
    baseCooldown: 12,
    baseRadius: 65,
    desc: 'Pinpoint thermal breath reveals tight areas.'
  },

  // Hider Pets
  fox: {
    id: 'fox',
    name: 'Cunning Fox',
    team: 'hider',
    emoji: '🦊',
    price: 0, // Starter free
    baseWarningRange: 50, // meters
    desc: 'Alerts when hunters draw near.'
  },
  cat: {
    id: 'cat',
    name: 'Stealth Cat',
    team: 'hider',
    emoji: '🐱',
    price: 100,
    baseWarningRange: 75,
    desc: 'Heightened senses detect footsteps sooner.'
  },
  rabbit: {
    id: 'rabbit',
    name: 'Quick Rabbit',
    team: 'hider',
    emoji: '🐰',
    price: 150,
    baseWarningRange: 105,
    desc: 'Sensitive ears warn of distant pursuers.'
  },
  ghost: {
    id: 'ghost',
    name: 'Phantom Ghost',
    team: 'hider',
    emoji: '👻',
    price: 300,
    baseWarningRange: 150,
    desc: 'Ethereal perception provides maximum warning distance.'
  }
};

const STORAGE_KEY = 'hvh_user_state_v1';

export function getUserState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse saved state:', e);
    }
  }

  // Default initial profile
  const initial = {
    name: 'Player' + Math.floor(1000 + Math.random() * 9000),
    coins: 50,
    equippedHunterPet: 'hawk',
    equippedHiderPet: 'fox',
    unlockedPets: ['hawk', 'fox'],
    petLevels: {
      hawk: 1,
      wolf: 1,
      owl: 1,
      dragon: 1,
      fox: 1,
      cat: 1,
      rabbit: 1,
      ghost: 1
    },
    stats: {
      roundsPlayed: 0,
      catches: 0,
      totalHideTimeSeconds: 0
    }
  };
  saveUserState(initial);
  return initial;
}

export function saveUserState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
