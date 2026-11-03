// Animated canvas spinner to pick Hiders and Hunters fairly

export class SpinnerWheel {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.players = [];
    this.rotation = 0;
    this.isSpinning = false;
  }

  setPlayers(playerList) {
    this.players = playerList;
    this.drawWheel();
  }

  drawWheel() {
    const { width, height } = this.canvas;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = width / 2 - 10;

    this.ctx.clearRect(0, 0, width, height);

    if (this.players.length === 0) return;

    const sliceAngle = (2 * Math.PI) / this.players.length;
    const colors = ['#7c4dff', '#00e5ff', '#ff1744', '#ffd600', '#00e676', '#ff9100'];

    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(this.rotation);

    for (let i = 0; i < this.players.length; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, 0);
      this.ctx.arc(0, 0, radius, i * sliceAngle, (i + 1) * sliceAngle);
      this.ctx.fillStyle = colors[i % colors.length];
      this.ctx.fill();
      this.ctx.stroke();

      // Text label
      this.ctx.save();
      this.ctx.rotate(i * sliceAngle + sliceAngle / 2);
      this.ctx.textAlign = 'right';
      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = 'bold 12px Outfit, sans-serif';
      this.ctx.fillText(this.players[i].name.substring(0, 10), radius - 15, 4);
      this.ctx.restore();
    }
    this.ctx.restore();

    // Draw center indicator triangle
    this.ctx.beginPath();
    this.ctx.moveTo(centerX - 10, 10);
    this.ctx.lineTo(centerX + 10, 10);
    this.ctx.lineTo(centerX, 25);
    this.ctx.closePath();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fill();
  }

  spinToWinner(winnerIndex, onComplete) {
    if (this.isSpinning) return;
    this.isSpinning = true;

    const sliceAngle = (2 * Math.PI) / this.players.length;
    // Align winner slice under the top needle (3*PI/2)
    const targetSliceRotation = (3 * Math.PI / 2) - (winnerIndex * sliceAngle + sliceAngle / 2);
    const totalSpins = 5 * 2 * Math.PI; // 5 full revolutions
    const finalAngle = totalSpins + targetSliceRotation;

    const duration = 4000;
    const startTime = performance.now();
    const initialRotation = this.rotation % (2 * Math.PI);

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);

      this.rotation = initialRotation + finalAngle * easeOut;
      this.drawWheel();

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.isSpinning = false;
        if (onComplete) onComplete();
      }
    };

    requestAnimationFrame(animate);
  }
}
