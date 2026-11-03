// Leaflet Map Manager with dynamic privacy circles and radar sweeps

export class GameMap {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.userMarker = null;
    this.accuracyCircle = null;
    this.boundaryCircle = null;
    this.radarHintsGroup = null;
  }

  init(lat, lng) {
    if (this.map) return;

    this.map = L.map(this.containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView([lat, lng], 17);

    // OpenStreetMap high contrast dark-friendly carto tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(this.map);

    this.radarHintsGroup = L.layerGroup().addTo(this.map);

    // Custom pulse style icon for local player
    const playerIcon = L.divIcon({
      className: 'local-player-icon',
      html: `<div class="player-dot"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    this.userMarker = L.marker([lat, lng], { icon: playerIcon }).addTo(this.map);
    this.accuracyCircle = L.circle([lat, lng], {
      radius: 20,
      color: '#7c4dff',
      weight: 1,
      fillColor: '#7c4dff',
      fillOpacity: 0.15
    }).addTo(this.map);
  }

  updateUserPosition(lat, lng, accuracy) {
    if (!this.map) {
      this.init(lat, lng);
      return;
    }
    const latlng = [lat, lng];
    this.userMarker.setLatLng(latlng);
    this.accuracyCircle.setLatLng(latlng);
    this.accuracyCircle.setRadius(accuracy);
    this.map.panTo(latlng, { animate: true, duration: 0.5 });
  }

  setPlayBoundary(centerLat, centerLng, radiusMeters) {
    if (!this.map) return;
    if (this.boundaryCircle) {
      this.map.removeLayer(this.boundaryCircle);
      this.boundaryCircle = null;
    }
    if (radiusMeters > 0) {
      this.boundaryCircle = L.circle([centerLat, centerLng], {
        radius: radiusMeters,
        color: '#ff1744',
        dashArray: '6, 8',
        fill: false,
        weight: 2
      }).addTo(this.map);
    }
  }

  displayRadarHint(approxLat, approxLng, radiusMeters) {
    if (!this.map || !this.radarHintsGroup) return;
    this.radarHintsGroup.clearLayers();

    const hintCircle = L.circle([approxLat, approxLng], {
      radius: radiusMeters,
      color: '#00e5ff',
      weight: 2,
      fillColor: '#00e5ff',
      fillOpacity: 0.25
    });

    this.radarHintsGroup.addLayer(hintCircle);

    // Fade out after 8 seconds
    setTimeout(() => {
      if (this.radarHintsGroup.hasLayer(hintCircle)) {
        this.radarHintsGroup.removeLayer(hintCircle);
      }
    }, 8000);
  }

  clearAll() {
    if (this.radarHintsGroup) this.radarHintsGroup.clearLayers();
    if (this.boundaryCircle && this.map) {
      this.map.removeLayer(this.boundaryCircle);
      this.boundaryCircle = null;
    }
  }
}
