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
    follow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.6"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4.5" rx="1"/><path d="M5 12.5V20h14v-7.5M12 8v12M12 8c-1.5-4-6-4-6-1.5S10 8 12 8zm0 0c1.5-4 6-4 6-1.5S14 8 12 8z"/></svg>',
  };
  const fmtNum = (n) => (Number.isFinite(n) ? n.toLocaleString('ru-RU') : '—');
  const fmtTime = (ms) => [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map((n) => String(n).padStart(2, '0')).join(':');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const isUrl = (u) => /^https?:\/\//i.test(String(u || ''));

  /* ---------- лента ---------- */
  let unread = 0;
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
    // подписка / подарок: серый круг со значком и одна строка
    row.classList.add('ev');
    const ic = el('div', 'av'); ic.insertAdjacentHTML('beforeend', e.kind === 'gift' ? ICON.gift : ICON.follow);
    row.appendChild(ic);
    const b = el('div', 'body'), tx = el('div', 'tx');
    tx.appendChild(el('b', '', e.name));
    if (e.kind === 'gift' && e.gift) {
      row.classList.add('gift');
      tx.appendChild(document.createTextNode(' — отправил(а) «' + e.gift.name + '» ×' + e.gift.count));
      if (isUrl(e.gift.image)) { const gi = new Image(); gi.className = 'gi'; gi.alt = ''; gi.referrerPolicy = 'no-referrer'; gi.src = e.gift.image; gi.onerror = () => gi.remove(); tx.appendChild(gi); }
    } else tx.appendChild(document.createTextNode(' — подписался(ась) на канал'));
    b.appendChild(tx); row.appendChild(b);
    return row;
  }
  function addEntry(e, animate) {
    if (!e || typeof e !== 'object') return;
    const stick = nearBottom();
    const row = rowOf(e);
    if (animate) row.classList.add('in');
    feed.appendChild(row);
    while (feed.querySelectorAll('.row').length > MAX_ROWS) feed.querySelector('.row').remove();
    syncEmpty();
    if (stick) toBottom(); else { unread++; }
    syncDown();
  }
  function clearFeed() { feed.innerHTML = ''; unread = 0; syncEmpty(); syncDown(); }
  feed.addEventListener('scroll', syncDown, { passive: true });
  down.onclick = () => { toBottom(); unread = 0; syncDown(); };
  window.addEventListener('resize', () => { syncDown(); });

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
    $('#stTw').hidden = !s.twOn; // онлайн Twitch виден, только пока Twitch подключён
    $('#vTw').textContent = fmtNum(s.twViewers);
    $('#vGifts').textContent = fmtNum(s.gifts);
    $('#vFollows').textContent = fmtNum(s.follows);
    $('#vLikes').textContent = fmtNum(s.likes);
    tick();
  }
  setInterval(tick, 1000);

  /* ---------- настройки ---------- */
  let SET = { opacity: 100, scale: 100, onTop: true, events: true, stats: true };
  function applySettings(s) {
    if (!s || typeof s !== 'object') return;
    SET = { ...SET, ...s };
    feed.classList.toggle('no-ev', !SET.events);
    $('#stats').hidden = !SET.stats;
    $('#btnPin').classList.toggle('on', !!SET.onTop);
    $('#btnPin').title = SET.onTop ? 'Поверх всех окон: включено' : 'Поверх всех окон: выключено';
    $('#pinShackle').setAttribute('d', SET.onTop ? 'M8 10.5V7.5a4 4 0 0 1 8 0v3' : 'M8 10.5V7.5a4 4 0 0 1 7.6-1.7');
    if (document.activeElement !== $('#sOpacity')) $('#sOpacity').value = SET.opacity;
    if (document.activeElement !== $('#sScale')) $('#sScale').value = SET.scale;
    $('#sOpacityV').textContent = SET.opacity + '%'; $('#sScaleV').textContent = SET.scale + '%';
    $('#sOnTop').checked = !!SET.onTop; $('#sEvents').checked = !!SET.events; $('#sStats').checked = !!SET.stats;
    const stick = nearBottom(); syncDown(); if (stick) toBottom();
  }
  let sendT = null;
  const push = (patch) => { SET = { ...SET, ...patch }; applySettings(SET); clearTimeout(sendT); sendT = setTimeout(() => { try { api.set(patch); } catch (_) {} }, 60); };
  $('#sOpacity').addEventListener('input', (e) => { $('#sOpacityV').textContent = e.target.value + '%'; push({ opacity: +e.target.value }); });
  $('#sScale').addEventListener('change', (e) => push({ scale: +e.target.value })); // размер — по отпусканию, пока тянут, окно не прыгает
  $('#sScale').addEventListener('input', (e) => { $('#sScaleV').textContent = e.target.value + '%'; });
  $('#sOnTop').addEventListener('change', (e) => push({ onTop: e.target.checked }));
  $('#sEvents').addEventListener('change', (e) => push({ events: e.target.checked }));
  $('#sStats').addEventListener('change', (e) => push({ stats: e.target.checked }));
  $('#btnPin').onclick = () => push({ onTop: !SET.onTop });
  $('#btnSet').onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; };
  $('#btnClear').onclick = () => { try { api.clear(); } catch (_) {} pop.hidden = true; };
  $('#btnClose').onclick = () => { try { api.close(); } catch (_) {} };
  document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== $('#btnSet') && !$('#btnSet').contains(e.target)) pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });

  /* ---------- связь с приложением ---------- */
  api.onMsg((e) => addEntry(e, true));
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
  window.__overlay = { addEntry, applyStats, applySettings, clearFeed, get SET() { return SET; } }; // для автотестов
})();
