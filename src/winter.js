// ❄ Зимний режим: кнопка «Зима/Оттаять» + лёгкий снегопад (canvas)
(function () {
  const KEY = 'echochat-winter';
  const body = document.body;
  const SNOW = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M4.2 7l15.6 10M19.8 7L4.2 17M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2"/></svg>';
  const DROP = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/></svg>';

  const settingsBtn = document.querySelector('.nav[data-tab="settings"]');
  if (!settingsBtn) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'nav-winter';
  settingsBtn.after(btn);

  ['l', 'r'].forEach(c => { const d = document.createElement('div'); d.className = 'w-drift ' + c; body.appendChild(d); });
  const cv = document.createElement('canvas'); cv.id = 'winterSnow'; body.appendChild(cv);
  const ctx = cv.getContext('2d');
  let flakes = [], raf = 0, W = 0, H = 0;

  function resize() { const r = devicePixelRatio || 1; W = innerWidth; H = innerHeight; cv.width = W * r; cv.height = H * r; ctx.setTransform(r, 0, 0, r, 0, 0); }
  function mk(top) { return { x: Math.random() * W, y: top ? -10 : Math.random() * H, r: .8 + Math.random() * 2.2, v: .35 + Math.random() * .9, p: Math.random() * 6.28, s: .004 + Math.random() * .01 }; }
  function frame() {
    ctx.clearRect(0, 0, W, H);
    for (const f of flakes) {
      f.p += f.s * 10; f.y += f.v; f.x += Math.sin(f.p) * .35 + .12;
      if (f.y > H + 6 || f.x > W + 6) Object.assign(f, mk(true));
      ctx.globalAlpha = .35 + f.r / 4.5; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fillStyle = '#fff'; ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }
  function start() { resize(); const n = Math.min(70, Math.round(W * H / 16000)); flakes = Array.from({ length: n }, () => mk(false)); cancelAnimationFrame(raf); frame(); }
  function stop() { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, W, H); }

  function apply(on) {
    body.classList.toggle('winter', on);
    btn.classList.toggle('on', on);
    btn.innerHTML = (on ? DROP : SNOW) + '<span class="wt">' + (on ? 'Оттаять' : 'Зима') + '</span>';
    btn.title = on ? 'Вернуть обычное оформление' : 'Включить зимнее оформление';
    if (on) start(); else stop();
  }
  btn.addEventListener('click', () => {
    const on = !body.classList.contains('winter'); apply(on);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
  });
  addEventListener('resize', () => { if (raf) start(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (body.classList.contains('winter') && !raf) frame(); });
  let saved = false; try { saved = localStorage.getItem(KEY) === '1'; } catch (_) {}
  apply(saved);
})();
