// ❄ Зимний режим: кнопка-снежинка в шапке (зима ⇄ лето), снегопад (canvas) и снег на блоках в общем слое поверх всего
(function () {
  const KEY = 'echochat-winter';
  const body = document.body;
  const status = document.getElementById('status');
  if (!status) return;

  // ❄ красивая снежинка (кнопка показывает её, пока зима выключена) и ☀ солнце (пока зима включена)
  const FLAKE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + [0, 60, 120].map(a => '<g transform="rotate(' + a + ' 12 12)"><path d="M12 2.6v18.8M9.4 5 12 7.6 14.6 5M9.4 19 12 16.4 14.6 19M10.3 9.4 12 11l1.7-1.6M10.3 14.6 12 13l1.7 1.6"/></g>').join('')
    + '<circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>';
  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M5.4 18.6l1.7-1.7M16.9 7.1l1.7-1.7"/></svg>';

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'winter-toggle';
  status.prepend(btn); // самый левый элемент шапки, левее «Не в эфире TikTok»

  ['l', 'r'].forEach(c => { const d = document.createElement('div'); d.className = 'w-drift ' + c; body.appendChild(d); });
  const cv = document.createElement('canvas'); cv.id = 'winterSnow'; body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const layer = document.createElement('div'); layer.id = 'winterCaps'; body.appendChild(layer);
  let flakes = [], raf = 0, capsRaf = 0, W = 0, H = 0;

  // ---------- снегопад ----------
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
  function startSnow() { resize(); const n = Math.min(70, Math.round(W * H / 16000)); flakes = Array.from({ length: n }, () => mk(false)); cancelAnimationFrame(raf); frame(); }
  function stopSnow() { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, W, H); }

  // ---------- снег на блоках: один слой поверх всего ----------
  // Шапки сугробов привязаны к реальным границам .card и .logo: подошва сугроба лежит ровно на верхней линии блока.
  const CARD_W = 160, CARD_BASE = 12, LOGO_W = 42, LOGO_BASE = 12;
  const pool = [];
  function el(i) {
    if (!pool[i]) { const n = document.createElement('i'); layer.appendChild(n); pool[i] = { n, key: '' }; }
    return pool[i];
  }
  function put(i, cls, x, y, flip, w) {
    const o = el(i);
    const key = cls + '|' + Math.round(x * 2) + '|' + Math.round(y * 2) + '|' + flip + '|' + w;
    if (o.key === key) return;
    o.key = key;
    o.n.className = cls;
    o.n.style.display = '';
    o.n.style.width = w + 'px';
    o.n.style.transform = flip ? 'translate(' + (x + w) + 'px,' + y + 'px) scaleX(-1)' : 'translate(' + x + 'px,' + y + 'px)';
  }
  function hideFrom(i) { for (let k = i; k < pool.length; k++) { if (pool[k].key !== 'off') { pool[k].key = 'off'; pool[k].n.style.display = 'none'; } } }
  function hit(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }

  function updateCaps() {
    let n = 0;
    const dd = document.querySelector('.csel.open .csel-drop');
    const ddr = dd ? dd.getBoundingClientRect() : null;

    const logo = document.querySelector('.logo');
    if (logo) {
      const r = logo.getBoundingClientRect();
      if (r.width > 0) put(n++, 'lc', r.left + (r.width - LOGO_W) / 2, r.top - LOGO_BASE, false, LOGO_W);
    }

    const cards = document.querySelectorAll('.card');
    for (const c of cards) {
      if (c.closest('.wn-back,.lic-wow,.lic-buy')) continue; // карточки внутри окон снег не получают
      const r = c.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) continue;            // скрытые вкладки
      const tab = c.closest('.tab');
      const clip = tab ? tab.getBoundingClientRect() : null;
      if (clip && (r.top < clip.top - 1 || r.top > clip.bottom - 10)) continue; // карточка уехала за край прокрутки
      if (r.top > innerHeight - 10) continue;
      const sib = c.parentElement ? Array.prototype.filter.call(c.parentElement.children, s => s.tagName === c.tagName) : [c];
      const even = sib.indexOf(c) % 2 === 1;                  // чётные карточки справа, зеркально
      const w = Math.max(60, Math.min(CARD_W, r.width - 36)); // в узкой карточке шапка сужается
      const x = even ? r.right - 18 - w : r.left + 18;
      const y = r.top - CARD_BASE + 1;                        // подошва сугроба перекрывает верхнюю рамку на 1px
      if (ddr && hit(ddr, { left: x, right: x + w, top: y, bottom: y + 32 })) continue; // не рисуем поверх открытого списка
      // снег показываем, только если оба края шапки реально лежат на видимой верхней кромке этой карточки
      // (не закрыта другим блоком, не обрезана прокруткой/границей контейнера, не уехала в сторону)
      const py = r.top + 3;
      const a = document.elementFromPoint(x + 3, py), b = document.elementFromPoint(x + w - 3, py);
      if (!a || !b || !c.contains(a) || !c.contains(b)) continue;
      put(n++, 'cc', x, y, even, w);
    }
    hideFrom(n);
  }
  function capsLoop() { updateCaps(); capsRaf = requestAnimationFrame(capsLoop); }
  function startCaps() { cancelAnimationFrame(capsRaf); capsLoop(); }
  function stopCaps() { cancelAnimationFrame(capsRaf); capsRaf = 0; hideFrom(0); }

  // ---------- переключатель ----------
  function apply(on) {
    body.classList.toggle('winter', on);
    btn.classList.toggle('on', on);
    btn.innerHTML = on ? SUN : FLAKE;                 // зима включена → солнце (вернуть лето), выключена → снежинка
    const t = on ? 'Лето: вернуть обычное оформление' : 'Зима: включить зимнее оформление';
    btn.title = t; btn.setAttribute('aria-label', t); btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) { startSnow(); startCaps(); } else { stopSnow(); stopCaps(); }
  }
  btn.addEventListener('click', () => {
    const on = !body.classList.contains('winter'); apply(on);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
  });
  addEventListener('resize', () => { if (raf) startSnow(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; cancelAnimationFrame(capsRaf); capsRaf = 0; }
    else if (body.classList.contains('winter')) { if (!raf) frame(); if (!capsRaf) capsLoop(); }
  });
  let saved = false; try { saved = localStorage.getItem(KEY) === '1'; } catch (_) {}
  apply(saved);
})();
