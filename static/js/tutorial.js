document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('start-btn');
  const openApp = document.getElementById('open-app');
  const dismiss = document.getElementById('dismiss');

  
  startBtn.addEventListener('click', () => {
    
    window.location.href = 'main.html';
  });

  openApp.addEventListener('click', (e) => {
    e.preventDefault();
    window.location.href = 'main.html';
  });

  dismiss.addEventListener('click', (e) => {
    e.preventDefault();
    
    try { window.close(); } catch (err) {}
  });

  
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { startBtn.click(); }
    if (ev.key === 'Escape') { dismiss.click(); }
  });

  
  const particlesEl = document.querySelector('.particles');
  if (particlesEl) {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const left = Math.random() * 100;
      const top = 60 + Math.random() * 60; 
      const size = 6 + Math.random() * 18;
      p.style.left = left + 'vw';
      p.style.top = top + 'vh';
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.animationDuration = (12 + Math.random() * 18) + 's';
      p.style.opacity = (0.03 + Math.random() * 0.18).toString();
      particlesEl.appendChild(p);
    }
  }
});
