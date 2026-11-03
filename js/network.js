// WebSocket Client managing real-time room communication & error handling

class NetworkClient {
  constructor() {
    this.ws = null;
    this.roomCode = null;
    this.playerId = null;
    this.playerName = null;
    this.isHost = false;
    this.handlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimer = null;
    this.shouldReconnect = true;
  }

  init(roomCode, playerId, playerName, petState, isHost = false) {
    this.roomCode = roomCode.toUpperCase();
    this.playerId = playerId;
    this.playerName = playerName;
    this.petState = petState;
    this.isHost = isHost;
    this.shouldReconnect = true;
    this.connect();
  }

  connect() {
    if (this.ws) {
      try { this.ws.close(); } catch(e) {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws?room=${this.roomCode}&pid=${this.playerId}&name=${encodeURIComponent(this.playerName)}&isHost=${this.isHost}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setBannerVisible(false);
      this.send('join', { petState: this.petState });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Server-side room error (e.g., room doesn't exist or already started)
        if (msg.type === 'error') {
          this.shouldReconnect = false;
          alert(msg.payload.message);
          window.location.hash = '';
          const menuScreen = document.getElementById('screen-menu');
          document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
          if (menuScreen) menuScreen.classList.add('active');
          return;
        }

        const handler = this.handlers.get(msg.type);
        if (handler) {
          handler(msg.payload);
        }
      } catch (err) {
        console.error('Invalid WS payload:', err);
      }
    };

    this.ws.onclose = (event) => {
      // Code 1008 is policy violation / rejected room
      if (event.code === 1008 || !this.shouldReconnect) {
        this.setBannerVisible(false);
        return;
      }
      this.attemptReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('WS encounter error:', err);
    };
  }

  attemptReconnect() {
    if (!this.shouldReconnect) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.setBannerVisible(true);
      const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 8000);
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      this.setBannerVisible(false);
    }
  }

  setBannerVisible(show) {
    const banner = document.getElementById('reconnect-banner');
    if (banner) {
      if (show) banner.classList.remove('hidden');
      else banner.classList.add('hidden');
    }
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  on(type, callback) {
    this.handlers.set(type, callback);
  }

  disconnect() {
    this.shouldReconnect = false;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const network = new NetworkClient();
