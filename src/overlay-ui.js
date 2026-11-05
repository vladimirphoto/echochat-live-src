'use strict';
// Окно оверлея чата. Всё, что показывается, приходит из приложения (preload → window.overlay); текст вставляется только через textContent.
(() => {
  const $ = (s) => document.querySelector(s);
  const api = window.overlay;
  const feed = $('#feed'), emptyEl = $('#empty'), down = $('#down'), pop = $('#pop');
  const MAX_ROWS = 120;
  const STICK_PX = 48; // ближе этого к низу — лента «прилипает» и сама прокручивается к новым сообщениям

  const ICON = {
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9a7.3 7.3 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5z"/></svg>',
    twitch: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 2 2.5 6v14H8v2.5h3L13.5 20H18l3.5-3.5V2H4zm15.5 13-2.5 2.5h-4.5L10 20v-2.5H6V4h13.5v11zM16 7.5h-2v5h2v-5zm-5 0H9v5h2v-5z"/></svg>',
    join: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
    follow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.6"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4.5" rx="1"/><path d="M5 12.5V20h14v-7.5M12 8v12M12 8c-1.5-4-6-4-6-1.5S10 8 12 8zm0 0c1.5-4 6-4 6-1.5S14 8 12 8z"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 21.4 10.6 20.1C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1C13.2 3.8 14.9 3 16.6 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6L12 21.4z"/></svg>',
  };
  const fmtNum = (n) => (Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—');
  // онлайн Twitch от 10 000: двузначное число и K (12 400 → 12K), иначе цифры не помещаются
  const fmtShort = (n) => (Number.isFinite(n) ? (n >= 10000 ? Math.floor(n / 1000) + 'K' : n.toLocaleString('ru-RU')) : '—');
  const fmtTime = (ms) => [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map((n) => String(n).padStart(2, '0')).join(':');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const isUrl = (u) => /^https?:\/\//i.test(String(u || ''));

  /* ---------- лента ---------- */
  let unread = 0;
  let stuck = true; // лента «прилипла» к низу: так остаётся, пока человек сам не прокрутил вверх
  const nearBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight <= STICK_PX;
  const toBottom = () => { feed.scrollTop = feed.scrollHeight; };
  function syncEmpty() { emptyEl.hidden = !!feed.querySelector('.row'); }
  function syncDown() { down.hidden = nearBottom(); if (down.hidden) { unread = 0; } down.textContent = unread ? '↓ Новые сообщения · ' + unread : '↓ Новые сообщения'; }

  // аватарка: пока картинка грузится (или не загрузилась) — первая буква на цветном круге
  function avatar(e) {
    const a = el('div', 'av', (String(e.name || '?').trim().charAt(0) || '?').toUpperCase());
    a.style.background = /^#[0-9a-f]{3,8}$/i.test(e.color || '') ? e.color : '#6b7280';
    if (isUrl(e.avatar)) {
      const im = new Image(); im.alt = ''; im.referrerPolicy = 'no-referrer';
      im.onload = () => { a.textContent = ''; a.appendChild(im); };
      im.src = e.avatar;
    }
    return a;
  }
  function rowOf(e) {
    const row = el('div', 'row ' + (e.platform === 'twitch' ? 'twitch' : 'tiktok'));
    if (e.kind === 'chat') {
      row.appendChild(avatar(e));
      const b = el('div', 'body'), nm = el('div', 'nm');
      nm.insertAdjacentHTML('beforeend', e.platform === 'twitch' ? ICON.twitch : ICON.tiktok);
      nm.appendChild(el('span', '', e.name));
      b.appendChild(nm); b.appendChild(el('div', 'tx', e.text));
      row.appendChild(b);
      return row;
    }
    // подписка / подарок / репост: серый круг со значком и одна строка
    row.classList.add('ev');
    const ic = el('div', 'av'); ic.insertAdjacentHTML('beforeend', e.kind === 'gift' ? ICON.gift : e.kind === 'share' ? ICON.share : ICON.follow);
    row.appendChild(ic);
    const b = el('div', 'body'), tx = el('div', 'tx');
    tx.appendChild(el('b', '', e.name));
    if (e.kind === 'gift' && e.gift) {
      row.classList.add('gift');
      tx.appendChild(document.createTextNode(' — отправил(а) «' + e.gift.name + '» '));
      tx.appendChild(el('span', 'cnt', '×' + e.gift.count)); // сколько подарков
      if (isUrl(e.gift.image)) { const gi = new Image(); gi.className = 'gi'; gi.alt = ''; gi.referrerPolicy = 'no-referrer'; gi.src = e.gift.image; gi.onerror = () => gi.remove(); tx.appendChild(gi); }
    } else if (e.kind === 'share') tx.appendChild(document.createTextNode(' — поделился(ась) эфиром'));
    else tx.appendChild(document.createTextNode(' — подписался(ась) на канал'));
    b.appendChild(tx); row.appendChild(b);
    return row;
  }
  function addEntry(e, animate) {
    if (!e || typeof e !== 'object') return;
    if (e.kind === 'like') { if (animate) { burst(e.count); if (e.name) showLike(e); } return; } // лайки — не строка ленты, а летящие сердечки и строка внизу
    if (e.kind === 'join') { if (animate) showJoin(e); return; } // «теперь с нами» — не строка ленты, а временная строка внизу
    // подарок и репост — тоже действие: на 5 секунд занимает нижнюю строку вместо чата (чат на это время поднимается на вторую строку).
    // Если строку внизу выключили, они остаются обычными строками ленты. При открытии окна старые подарки и репосты заново не показываются
    if ((e.kind === 'gift' || e.kind === 'share') && SET.joins !== false) {
      if (animate) pushAction(e.kind === 'gift' ? { kind: 'gift', name: String(e.name || 'Гость'), gift: e.gift || { name: 'подарок', count: 1, image: '' } } : { kind: 'share', name: String(e.name || 'Гость') });
      return;
    }
    const stick = stuck || nearBottom();
    const row = rowOf(e);
    if (animate) row.classList.add('in');
    feed.appendChild(row);
    while (feed.querySelectorAll('.row').length > MAX_ROWS) feed.querySelector('.row').remove();
    syncEmpty();
    if (stick) toBottom(); else { unread++; }
    syncDown();
  }
  function clearFeed() { feed.innerHTML = ''; unread = 0; clearJoin(); syncEmpty(); syncDown(); }
  feed.addEventListener('scroll', () => { stuck = nearBottom(); syncDown(); }, { passive: true });
  // строка действий внизу выезжает и уезжает: лента меняет высоту, и последнее сообщение должно оставаться у самого низа (над строкой)
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (stuck) toBottom(); syncDown(); }).observe(feed);
  down.onclick = () => { toBottom(); unread = 0; syncDown(); };
  window.addEventListener('resize', () => { syncDown(); });

  /* ---------- строка внизу: действия зрителей (подарок, репост, «зашёл», лайк) ----------
     Обычно эта строка — чат: места под действия нет, лента занимает всё окно. Пришло действие — оно на 5 секунд встаёт на нижнюю строку,
     а чат поднимается на вторую; действие ушло — чат снова на нижней строке. Действия идут по очереди; важные (подарок, репост)
     вытесняют менее важные («зашёл», лайк), а когда «зашёл» и лайков много, ждёт только самый свежий из них. */
  const joinBar = $('#joinBar');
  const T = { line: 5000, min: 1200, out: 380 }; // сколько показывать, сколько минимум, прежде чем уступить более важному, длительность затухания
  const MAX_Q = 8;
  const PRIO = { gift: 0, share: 0, join: 1, like: 2 };
  let queue = [], cur = null; // cur — что сейчас на строке: { kind, name, count, at, row, rest, timer, leaving }
  const likeText = (n) => (n > 1 ? ' — поставил(а) лайки ×' + n : ' — поставил(а) лайк');

  function lineRow(a) {
    const row = el('div', 'jb' + (a.kind === 'like' ? ' lk' : a.kind === 'gift' ? ' gf' : ''));
    const ic = el('div', 'av'); ic.insertAdjacentHTML('beforeend', a.kind === 'like' ? ICON.heart : a.kind === 'gift' ? ICON.gift : a.kind === 'share' ? ICON.share : ICON.join);
    const tx = el('div', 'tx'); tx.appendChild(el('b', '', a.name));
    let rest = null;
    if (a.kind === 'gift') {
      tx.appendChild(document.createTextNode(' — отправил(а) «' + a.gift.name + '» '));
      tx.appendChild(el('span', 'cnt', '×' + a.gift.count));
      if (isUrl(a.gift.image)) { const gi = new Image(); gi.className = 'gi'; gi.alt = ''; gi.referrerPolicy = 'no-referrer'; gi.src = a.gift.image; gi.onerror = () => gi.remove(); tx.appendChild(gi); }
    } else if (a.kind === 'share') tx.appendChild(document.createTextNode(' — поделился(ась) эфиром'));
    else if (a.kind === 'join') tx.appendChild(document.createTextNode(' — теперь с нами'));
    else { rest = document.createTextNode(likeText(a.count)); tx.appendChild(rest); }
    row.appendChild(ic); row.appendChild(tx);
    return { row, rest };
  }
  function clearJoin() { if (cur) clearTimeout(cur.timer); cur = null; queue = []; if (joinBar) { joinBar.replaceChildren(); joinBar.classList.remove('on'); } }
  function endIn(ms) { if (!cur || cur.leaving) return; clearTimeout(cur.timer); cur.timer = setTimeout(finish, ms); }
  function finish() {
    const c = cur;
    if (!c || c.leaving) return;
    c.leaving = true; c.row.classList.add('out');
    c.timer = setTimeout(() => { if (cur !== c) return; cur = null; c.row.remove(); next(); }, T.out);
  }
  function next() {
    if (cur || !joinBar) return;
    if (!queue.length) { joinBar.classList.remove('on'); return; } // действий больше нет: место под строку возвращается чату
    let b = 0;
    for (let i = 1; i < queue.length; i++) if (PRIO[queue[i].kind] < PRIO[queue[b].kind]) b = i; // самое важное, а среди равных — пришедшее раньше
    const a = queue.splice(b, 1)[0];
    const { row, rest } = lineRow(a);
    joinBar.replaceChildren(row); joinBar.classList.add('on');
    cur = { ...a, row, rest, at: Date.now(), leaving: false, timer: null };
    cur.timer = setTimeout(finish, T.line);
  }
  function pushAction(a) {
    if (!joinBar || SET.joins === false) return;
    if (a.kind === 'like') {
      // лайки от одного человека складываются в одну строку («×12»), 5 секунд при этом не продлеваются
      if (cur && !cur.leaving && cur.kind === 'like' && cur.name === a.name) { cur.count += a.count; cur.rest.textContent = likeText(cur.count); return; }
      const same = queue.find((x) => x.kind === 'like' && x.name === a.name);
      if (same) { same.count += a.count; return; }
      queue = queue.filter((x) => x.kind !== 'like'); // лайков очень много: в очереди ждёт только самый свежий
    } else if (a.kind === 'join') queue = queue.filter((x) => x.kind !== 'join'); // и «зашёл» — тоже только самый свежий
    queue.push(a);
    while (queue.length > MAX_Q) { // переполнение: уходит самое неважное, а среди равных — самое старое
      let w = 0;
      for (let i = 1; i < queue.length; i++) if (PRIO[queue[i].kind] > PRIO[queue[w].kind]) w = i;
      queue.splice(w, 1);
    }
    if (!cur) next();
    else if (!cur.leaving && PRIO[a.kind] < PRIO[cur.kind]) endIn(Math.max(0, T.min - (Date.now() - cur.at))); // подарок или репост не ждут конца лайка или «зашёл»
  }
  const showJoin = (e) => pushAction({ kind: 'join', name: String((e && e.name) || 'Гость') });
  const showLike = (e) => pushAction({ kind: 'like', name: String((e && e.name) || 'Гость'), count: Math.max(1, Math.round(Number(e && e.count)) || 1) });

  /* ---------- лайки: сердечки летят вверх от правого нижнего угла и плавно исчезают ---------- */
  const heartsEl = $('#hearts');
  const MAX_FLYING = 40, MAX_PER_EVENT = 6; // пачка лайков от TikTok может быть большой: рисуем не больше нескольких сердечек на событие
  let flying = 0;
  function floatHeart() {
    if (!heartsEl || SET.hearts === false || flying >= MAX_FLYING || typeof Element.prototype.animate !== 'function') return;
    const h = el('i', 'ht');
    h.insertAdjacentHTML('beforeend', ICON.heart);
    const size = 22 + Math.random() * 14;
    h.style.width = h.style.height = size.toFixed(0) + 'px';
    h.style.right = (10 + Math.random() * 20).toFixed(0) + 'px'; // чуть разный старт, чтобы сердечки не слипались в одну линию
    heartsEl.appendChild(h);
    const room = Math.max(160, (heartsEl.clientHeight || 400) - 24);
    const rise = Math.min(560, room * (0.72 + Math.random() * 0.22));
    const sway = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 22);
    const at = (k, x) => 'translate3d(' + (sway * x).toFixed(1) + 'px,' + (-rise * k).toFixed(1) + 'px,0)';
    flying++;
    const done = () => { if (h.isConnected) { h.remove(); flying = Math.max(0, flying - 1); } };
    try {
      const a = h.animate([
        { opacity: 0, transform: at(0, 0) + ' scale(.45)', offset: 0 },
        { opacity: 1, transform: at(0.1, 0.2) + ' scale(1)', offset: 0.1 },
        { opacity: 1, transform: at(0.45, 1) + ' scale(1.05)', offset: 0.45 },
        { opacity: 0.75, transform: at(0.75, -0.6) + ' scale(1)', offset: 0.75 },
        { opacity: 0, transform: at(1, 0.3) + ' scale(.9)', offset: 1 },
      ], { duration: 2600 + Math.random() * 1400, easing: 'cubic-bezier(.25,.1,.3,1)', fill: 'forwards' });
      a.onfinish = done; a.oncancel = done;
    } catch (_) { done(); }
  }
  // n лайков → до MAX_PER_EVENT сердечек с небольшой задержкой друг за другом
  function burst(n) {
    const k = Math.min(MAX_PER_EVENT, Math.max(1, Math.round(Number(n)) || 1));
    for (let i = 0; i < k; i++) setTimeout(floatHeart, i * 110 + Math.random() * 70);
  }

  /* ---------- шапка и счётчики ---------- */
  let ST = { since: 0, ttOn: false, twOn: false };
  const badge = $('#badge'), timeEl = $('#time');
  function tick() {
    const live = !!ST.since;
    badge.textContent = live ? 'LIVE' : 'ОФЛАЙН';
    badge.classList.toggle('off', !live);
    timeEl.textContent = live ? fmtTime(Math.max(0, Date.now() - ST.since)) : '—';
  }
  function applyStats(s) {
    if (!s || typeof s !== 'object') return;
    ST = s;
    $('#vTt').textContent = fmtNum(s.ttViewers);
    $('#stTw').hidden = !s.twLive; // значок Twitch виден, только пока Twitch подключён и стрим идёт; иначе убирается совсем
    $('#vTw').textContent = fmtShort(s.twViewers); $('#vTw').title = fmtNum(s.twViewers);
    $('#vViews').textContent = fmtShort(s.views); $('#vViews').title = fmtNum(s.views);
    $('#vGifts').textContent = fmtNum(s.gifts);
    $('#vFollows').textContent = fmtNum(s.follows);
    $('#vLikes').textContent = fmtNum(s.likes);
    tick();
  }
  setInterval(tick, 1000);

  /* ---------- настройки (меняются во вкладке «Оверлей чата» приложения; здесь только замок) ---------- */
  let SET = { opacity: 100, onTop: true, locked: false, events: true, joins: true, stats: true, hearts: true };
  const SHACKLE = { closed: 'M8 10.5V7.5a4 4 0 0 1 8 0v3', open: 'M8 10.5V7.5a4 4 0 0 1 7.6-1.7' };
  function applySettings(s) {
    if (!s || typeof s !== 'object') return;
    SET = { ...SET, ...s };
    // прозрачность — только у фона; 2% оставляем, чтобы окно по-прежнему ловило мышь
    document.documentElement.style.setProperty('--a', String(Math.max(0.02, Math.min(1, SET.opacity / 100))));
    document.body.classList.toggle('locked', !!SET.locked);
    feed.classList.toggle('no-ev', !SET.events);
    document.body.classList.toggle('no-jn', !SET.joins);
    if (!SET.joins) clearJoin();
    if (document.activeElement !== $('#sOpacity')) $('#sOpacity').value = SET.opacity;
    $('#sOpacityV').textContent = SET.opacity + '%';
    $('#sOnTop').checked = !!SET.onTop; $('#sEvents').checked = !!SET.events; $('#sJoins').checked = !!SET.joins; $('#sHearts').checked = SET.hearts !== false; $('#sStats').checked = !!SET.stats;
    $('#stats').hidden = !SET.stats;
    $('#btnLock').classList.toggle('on', !!SET.locked);
    $('#btnLock').title = SET.locked ? 'Окно заблокировано. Нажмите, чтобы разблокировать' : 'Заблокировать положение и размер окна';
    $('#lockShackle').setAttribute('d', SET.locked ? SHACKLE.closed : SHACKLE.open);
    const stick = nearBottom(); syncDown(); if (stick) toBottom();
  }
  $('#btnLock').onclick = () => { const locked = !SET.locked; applySettings({ locked }); try { api.set({ locked }); } catch (_) {} };
  // шестерёнка: прозрачность фона и переключатели; те же настройки есть во вкладке «Оверлей чата» приложения
  // изменения копятся и уходят одним пакетом, поэтому две быстрые правки подряд не затирают друг друга
  let sendT = null, pending = {};
  const push = (patch) => { applySettings(patch); pending = { ...pending, ...patch }; clearTimeout(sendT); sendT = setTimeout(() => { const p = pending; pending = {}; try { api.set(p); } catch (_) {} }, 60); };
  $('#sOpacity').addEventListener('input', (e) => push({ opacity: +e.target.value }));
  $('#sOnTop').addEventListener('change', (e) => push({ onTop: e.target.checked }));
  $('#sEvents').addEventListener('change', (e) => push({ events: e.target.checked }));
  $('#sJoins').addEventListener('change', (e) => push({ joins: e.target.checked }));
  $('#sHearts').addEventListener('change', (e) => push({ hearts: e.target.checked }));
  $('#sStats').addEventListener('change', (e) => push({ stats: e.target.checked }));
  $('#btnSet').onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; };
  $('#btnClear').onclick = () => { try { api.clear(); } catch (_) {} pop.hidden = true; };
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && !$('#btnSet').contains(e.target)) pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
  $('#btnClose').onclick = () => { try { api.close(); } catch (_) {} };

  /* ---------- растягивание за края (при замке ручки скрыты) ---------- */
  document.querySelectorAll('.grip').forEach((g) => {
    g.addEventListener('pointerdown', (e) => {
      if (SET.locked || e.button !== 0) return;
      e.preventDefault(); g.setPointerCapture(e.pointerId);
      const sx = e.screenX, sy = e.screenY, dir = g.dataset.dir;
      let raf = 0, last = null;
      try { api.grip({ phase: 'start' }); } catch (_) {}
      const send = () => { raf = 0; if (last) { try { api.grip({ phase: 'move', dir, dx: last.x - sx, dy: last.y - sy }); } catch (_) {} } };
      const mv = (ev) => { last = { x: ev.screenX, y: ev.screenY }; if (!raf) raf = requestAnimationFrame(send); };
      const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); if (raf) cancelAnimationFrame(raf); send(); try { api.grip({ phase: 'end' }); } catch (_) {} };
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
  });

  /* ---------- связь с приложением ---------- */
  api.onMsg((e) => addEntry(e, true));
  api.onLike((p) => burst(p && p.count));
  api.onJoin((p) => showJoin(p || {}));
  api.onLiker((p) => showLike(p || {}));
  api.onStats(applyStats);
  api.onSettings(applySettings);
  api.onClear(clearFeed);
  Promise.resolve(api.state()).then((st) => {
    if (!st) return;
    applySettings(st.settings); applyStats(st.stats);
    (Array.isArray(st.feed) ? st.feed : []).forEach((e) => addEntry(e, false));
    toBottom(); unread = 0; syncDown();
  }).catch(() => {});
  syncEmpty(); syncDown(); tick();
  window.__overlay = { addEntry, applyStats, applySettings, clearFeed, like: burst, join: showJoin, liker: showLike, setTiming: (t) => Object.assign(T, t), bar: () => ({ cur: cur ? cur.kind : null, queue: queue.map((x) => x.kind) }), get SET() { return SET; } }; // для автотестов
})();
