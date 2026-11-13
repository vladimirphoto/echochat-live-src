'use strict';
// Мини-графики в карточках «Эфир»: Зрители / Лайки / Подарки / Новые подписки.
// Раз в 2 секунды берём значение из карточки. Зрители рисуются как есть (онлайн TikTok + Twitch),
// остальные три как прирост за интервал, поэтому график двигается вместе с активностью эфира.
// Пока эфира нет (обе плашки «Не в эфире»), график плавно гаснет, а накопленные точки сбрасываются.
(() => {
  const W = 120, H = 40, N = 30, STEP = W / (N - 1), TICK = 2000;
  const NS = 'http://www.w3.org/2000/svg';
  const num = (t) => { const n = parseInt(String(t || '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : 0; };
  const viewers = () => {
    const tt = document.getElementById('sViewers'), tw = document.getElementById('sViewersTw');
    const twOn = document.querySelector('.vv.tw') && !document.querySelector('.vv.tw').hidden;
    return num(tt && tt.textContent) + (twOn && tw ? num(tw.title || tw.textContent) : 0);
  };
  const total = (id) => () => num((document.getElementById(id) || {}).textContent);
  const defs = [
    { card: '.stat-viewers', read: viewers, delta: false },
    { card: '.stats .stat:nth-child(2)', read: total('sLikes'), delta: true },
    { card: '.stats .stat:nth-child(3)', read: total('sGifts'), delta: true },
    { card: '.stats .stat:nth-child(4)', read: total('sFollows'), delta: true },
  ];
  const isLive = () => !!document.querySelector('#pillTt.on, #pillTw.on');

  defs.forEach((d, i) => {
    const el = document.querySelector(d.card);
    if (!el) return;
    d.el = el; d.vals = []; d.prev = null;
    const id = 'spg' + i;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".38"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><g class="sp-g"><path class="sp-area" fill="url(#${id})"/><path class="sp-line"/></g>`;
    svg.style.color = 'var(--sc)';
    el.appendChild(svg);
    d.svg = svg; d.g = svg.querySelector('.sp-g'); d.line = svg.querySelector('.sp-line'); d.area = svg.querySelector('.sp-area');
  });

  // плавная кривая через середины отрезков
  function pathFrom(pts) {
    if (pts.length < 2) return '';
    let s = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      s += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    const l = pts[pts.length - 1];
    return s + ` L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
  }
  function draw(d, animate) {
    const raw = d.vals.slice(-(N + 1));
    // лёгкое сглаживание прироста, чтобы редкие всплески не рвали линию
    const v = d.delta ? raw.map((x, i) => (x + (raw[i - 1] ?? x) + (raw[i - 2] ?? x)) / 3) : raw;
    let lo = d.delta ? 0 : Math.min(...v), hi = Math.max(...v);
    if (d.delta) hi = Math.max(hi, 2);
    else if (hi - lo < 4) { lo = Math.max(0, lo - 2); hi = lo + 4; }
    const top = 6, bot = H - 3;
    const n = v.length;
    const pts = v.map((x, i) => [W - (n - 1 - i) * STEP, bot - ((x - lo) / (hi - lo || 1)) * (bot - top)]);
    const line = pathFrom(pts);
    d.line.setAttribute('d', line);
    d.area.setAttribute('d', line ? `${line} L${W} ${H} L${pts[0][0].toFixed(1)} ${H} Z` : '');
    if (animate && d.g.animate && !matchMedia('(prefers-reduced-motion:reduce)').matches) {
      d.g.animate([{ transform: `translateX(${STEP}px)` }, { transform: 'translateX(0)' }], { duration: TICK * 0.45, easing: 'ease-out' });
    }
  }

  let wasLive = false;
  function tick() {
    const live = isLive();
    if (!live) {
      if (wasLive) defs.forEach((d) => { if (d.el) d.el.classList.remove('live'); });
      // точки стираем после того, как график погас
      if (wasLive) setTimeout(() => { if (!isLive()) defs.forEach((d) => { d.vals = []; d.prev = null; if (d.line) { d.line.setAttribute('d', ''); d.area.setAttribute('d', ''); } }); }, 900);
      wasLive = false; return;
    }
    wasLive = true;
    defs.forEach((d) => {
      if (!d.el) return;
      const cur = d.read();
      const val = d.delta ? (d.prev == null ? 0 : Math.max(0, cur - d.prev)) : cur;
      d.prev = cur;
      d.vals.push(val); if (d.vals.length > N + 1) d.vals.shift();
      draw(d, d.vals.length > 1);
      d.el.classList.add('live');
    });
  }
  tick();
  setInterval(tick, TICK);
})();
