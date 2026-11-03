// Tactical Sonar Radar Engine (Canvas-based, distance rings, rotating sweep beam, snapshot intel)

export class GameMap {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.canvas = null;
    this.ctx = null;
    this.userLat = 0;
    this.userLng = 0;
    this.heading = 0; // Degrees (0 = North)
    this.sweepAngle = 0; // Current rotating radar beam
    this.radarRadiusMeters = 200; // Outer circle represents 200m
    this.snapshotBlips = []; // Fading intel snapshots { xRel, yRel, distance, age, isDecoy }
    this.animFrameId = null;
    this.initCanvas();
  }

  initCanvas() {
    this.container.innerHTML = '';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'radar-canvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Listen to device compass orientation if supported
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (e) => {
        if (e.webkitCompassHeading) {
          this.heading = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
          this.heading = 360 - e.alpha;
        }
      }, true);
    }

    this.startRadarAnimation();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) * 0.94;
    this.canvas.width = size;
    this.canvas.height = size;
  }

  init(lat, lng) {
    this.userLat = lat;
    this.userLng = lng;
  }

  updateUserPosition(lat, lng, accuracy) {
    this.userLat = lat;
    this.userLng = lng;
    this.accuracy = accuracy;
  }

  // Drops a frozen snapshot blip of a hider relative to hunter
  addSnapshotIntel(targetLat, targetLng, isDecoy = false) {
    if (!this.userLat || !this.userLng) return;

    const dist = this.haversineMeters(this.userLat, this.userLng, targetLat, targetLng);
    const bearing = this.calculateBearing(this.userLat, this.userLng, targetLat, targetLng);

    this.snapshotBlips.push({
      distance: dist,
      bearing: bearing,
      createdAt: Date.now(),
      isDecoy: isDecoy
    });
  }

  startRadarAnimation() {
    const draw = () => {
      this.render();
      this.sweepAngle = (this.sweepAngle + 0.035) % (2 * Math.PI);
      this.animFrameId = requestAnimationFrame(draw);
    };
    this.animFrameId = requestAnimationFrame(draw);
  }

  render() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const cx = width / 2;
    const cy = height / 2;
    const maxR = cx - 18;

    this.ctx.clearRect(0, 0, width, height);

    // 1. Radar background circle
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, maxR, 0, 2 * Math.PI);
    this.ctx.fillStyle = 'rgba(10, 8, 22, 0.92)';
    this.ctx.fill();
    this.ctx.lineWidth = 2;
    this.ctx.strokeStyle = 'rgba(124, 77, 255, 0.4)';
    this.ctx.stroke();

    // 2. Concentric range rings: 50m, 100m, 200m
    const rings = [
      { meters: 50, label: '50m' },
      { meters: 100, label: '100m' },
      { meters: 200, label: '200m' }
    ];

    rings.forEach(ring => {
      const r = (ring.meters / this.radarRadiusMeters) * maxR;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      this.ctx.lineWidth = 1;
      this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.2)';
      this.ctx.setLineDash([4, 6]);
      this.ctx.stroke();
      this.ctx.setLineDash([]);

      // Ring distance labels
      this.ctx.fillStyle = 'rgba(0, 229, 255, 0.6)';
      this.ctx.font = '10px JetBrains Mono, monospace';
      this.ctx.fillText(ring.label, cx + 4, cy - r + 12);
    });

    // 3. Crosshairs
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy - maxR);
    this.ctx.lineTo(cx, cy + maxR);
    this.ctx.moveTo(cx - maxR, cy);
    this.ctx.lineTo(cx + maxR, cy);
    this.ctx.strokeStyle = 'rgba(124, 77, 255, 0.25)';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    // 4. Rotating sweep beam
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy);
    this.ctx.arc(cx, cy, maxR, this.sweepAngle - 0.45, this.sweepAngle);
    this.ctx.closePath();
    const sweepGradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    sweepGradient.addColorStop(0, 'rgba(0, 229, 255, 0)');
    sweepGradient.addColorStop(1, 'rgba(0, 229, 255, 0.25)');
    this.ctx.fillStyle = sweepGradient;
    this.ctx.fill();
    this.ctx.restore();

    // 5. Draw snapshot intel blips (fades over 15 seconds)
    const now = Date.now();
    this.snapshotBlips = this.snapshotBlips.filter(b => now - b.createdAt < 16000);

    this.snapshotBlips.forEach(blip => {
      const ageMs = now - blip.createdAt;
      const opacity = Math.max(0, 1 - (ageMs / 16000));
      
      // Calculate screen position relative to North heading
      const angleRad = ((blip.bearing - this.heading - 90) * Math.PI) / 180;
      let distRatio = blip.distance / this.radarRadiusMeters;
      let isOffscreen = false;

      if (distRatio > 1.0) {
        distRatio = 0.96; // Clamp to edge with arrow
        isOffscreen = true;
      }

      const bx = cx + (distRatio * maxR) * Math.cos(angleRad);
      const by = cy + (distRatio * maxR) * Math.sin(angleRad);

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(bx, by, isOffscreen ? 7 : 10, 0, 2 * Math.PI);
      this.ctx.fillStyle = blip.isDecoy 
        ? `rgba(255, 23, 68, ${opacity})` 
        : `rgba(0, 229, 255, ${opacity})`;
      this.ctx.shadowColor = blip.isDecoy ? '#ff1744' : '#00e5ff';
      this.ctx.shadowBlur = 14;
      this.ctx.fill();

      // Blip distance text
      this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity * 0.8})`;
      this.ctx.font = 'bold 10px JetBrains Mono, monospace';
      this.ctx.fillText(`${Math.round(blip.distance)}m`, bx + 12, by + 4);
      this.ctx.restore();
    });

    // 6. Player center dot
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
    this.ctx.fillStyle = '#7c4dff';
    this.ctx.shadowColor = '#7c4dff';
    this.ctx.shadowBlur = 10;
    this.ctx.fill();
    this.ctx.shadowBlur = 0;

    // 7. North Compass indicator
    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate((-this.heading * Math.PI) / 180);
    this.ctx.fillStyle = '#ff1744';
    this.ctx.font = 'bold 12px Outfit, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('N', 0, -maxR + 14);
    this.ctx.restore();
  }

  haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  calculateBearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  clearAll() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
    this.snapshotBlips = [];
  }
}
