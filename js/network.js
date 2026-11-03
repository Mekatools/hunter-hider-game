// WebSocket Client managing real-time room communication

class NetworkClient {
  constructor() {
    this.ws = null;
    this.roomCode = null;
    this.playerId = null;
    this.handlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 6;
    this.reconnectTimer = null;
  }

  init(roomCode, playerId, playerName, petState) {
    this.roomCode = roomCode.toUpperCase();
    this.playerId = playerId;
    this.playerName = playerName;
    this.petState = petState;
    this.connect();
  }

  connect() {
    if (this.ws) {
      try { this.ws.close(); } catch(e) {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws?room=${this.roomCode}&pid=${this.playerId}&name=${encodeURIComponent(this.playerName)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setBannerVisible(false);
      this.send('join', { petState: this.petState });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const handler = this.handlers.get(msg.type);
        if (handler) {
          handler(msg.payload);
        }
      } catch (err) {
        console.error('Invalid WS payload:', err);
      }
    };

    this.ws.onclose = () => {
      this.attemptReconnect();
    };

    this.ws.onerror = (err) => {
      console.warn('WS encounter error:', err);
    };
  }

  attemptReconnect() {
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
      alert('Disconnected from the room. Please check your internet connection.');
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
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export const network = new NetworkClient();
