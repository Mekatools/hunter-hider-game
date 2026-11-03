// Landing page dynamic visual flair and particle grid enhancements

document.addEventListener('DOMContentLoaded', () => {
  initGridAnimation();
});

function initGridAnimation() {
  const container = document.querySelector('.landing-bg');
  if (!container) return;

  // Create subtle pulsing location beacon dots across background
  const dotCount = 8;
  for (let i = 0; i < dotCount; i++) {
    const dot = document.createElement('div');
    dot.className = 'radar-beacon-dot';
    dot.style.top = `${Math.random() * 85 + 5}%`;
    dot.style.left = `${Math.random() * 90 + 5}%`;
    dot.style.animationDelay = `${Math.random() * 3}s`;
    container.appendChild(dot);
  }
}
