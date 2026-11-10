'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('promise: ' + String(e.reason && e.reason.message || e.reason)));

/* ---------- настройки и голоса ---------- */
// Живые нейро-голоса Microsoft (бесплатно, без ключей). Мультиязычные читают по-русски,
// у них лёгкий акцент. Недоступные на сервере голоса скрываются сами (см. applyCatalog).
const BUILTIN = [
  { id: 'b-svetlana', name: 'Светлана', desc: 'Женский · родной русский, тёплый', voice: 'ru-RU-SvetlanaNeural', gender: 'F' },
  { id: 'b-dmitry', name: 'Дмитрий', desc: 'Мужской · родной русский, уверенный', voice: 'ru-RU-DmitryNeural', gender: 'M' },
  { id: 'b-ava', name: 'Ава', desc: 'Женский · мягкий, живой', voice: 'en-US-AvaMultilingualNeural', gender: 'F' },
  { id: 'b-emma', name: 'Эмма', desc: 'Женский · спокойный, дружелюбный', voice: 'en-US-EmmaMultilingualNeural', gender: 'F' },
  { id: 'b-vivienne', name: 'Вивьен', desc: 'Женский · нежный, выразительный', voice: 'fr-FR-VivienneMultilingualNeural', gender: 'F' },
  { id: 'b-seraphina', name: 'Серафина', desc: 'Женский · чёткий, уверенный', voice: 'de-DE-SeraphinaMultilingualNeural', gender: 'F' },
  { id: 'b-andrew', name: 'Эндрю', desc: 'Мужской · тёплый, душевный', voice: 'en-US-AndrewMultilingualNeural', gender: 'M' },
  { id: 'b-brian', name: 'Брайан', desc: 'Мужской · ровный, дикторский', voice: 'en-US-BrianMultilingualNeural', gender: 'M' },
  { id: 'b-remy', name: 'Реми', desc: 'Мужской · бархатный, спокойный', voice: 'fr-FR-RemyMultilingualNeural', gender: 'M' },
  { id: 'b-florian', name: 'Флориан', desc: 'Мужской · бодрый, энергичный', voice: 'de-DE-FlorianMultilingualNeural', gender: 'M' },
].map((v) => ({ rate: 0, pitch: 0, ...v, provider: 'edge', builtin: true }));

const DEFAULTS = {
  selected: 'b-svetlana', vol: 80, maxLen: 140, nick: '',
  presets: [],
  widgets: [], wSel: '', twNick: '',
  ttChat: true, twChat: true, readName: true, gifts: true, follows: true, eventVoice: '', ttVoice: '', twVoice: '',
  skipCmd: true, skipLinks: true, onlyRu: true, noRepeat: true, profanity: true, skipMentions: true, noEmoji: true,
  likes: { count: 5, scale: 100, align: 'center', showCount: true, showRank: true, shadow: true, punch: true },
  gifts: { count: 5, scale: 100, align: 'center', showCount: true, showRank: true, shadow: true, celebrate: true },
  alerts: { enabled: true, sound: true, showAvatar: true, duration: 6, scale: 100, imageName: '', soundName: '' },
  kaspi: { enabled: true, token: '', strict: true, minAmount: 0, duration: 8, scale: 100, align: 'center', vpos: 'bottom', showMessage: true, voice: true, sound: true, soundName: '' },
};
let S = { ...DEFAULTS };
try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('echochat2') || '{}') }; } catch (_) {}
S.likes = { ...DEFAULTS.likes, ...(S.likes && typeof S.likes === 'object' ? S.likes : {}) };
S.gifts = { ...DEFAULTS.gifts, ...(S.gifts && typeof S.gifts === 'object' ? S.gifts : {}) };
S.kaspi = { ...DEFAULTS.kaspi, ...(S.kaspi && typeof S.kaspi === 'object' ? S.kaspi : {}) };
S.alerts = { ...DEFAULTS.alerts, ...(S.alerts && typeof S.alerts === 'object' ? S.alerts : {}) };
S.kaspi.enabled = true; // приём всегда включён: переключателя больше нет
// виджеты: у каждого своё выравнивание TikTok и Twitch и своя ссылка. Первый — для OBS, второй — для TikTok LIVE Studio.
// Прежнее выравнивание (одно на всё приложение) переносится на первый виджет.
try {
  const raw = JSON.parse(localStorage.getItem('echochat2') || '{}');
  if (!Array.isArray(S.widgets) || !S.widgets.length) {
    let tt = raw.wAlignTt, tw = raw.wAlignTw;
    if (!tt && raw.wAlign) { tt = raw.wAlign === 'right' ? 'right' : 'left'; tw = raw.wAlign === 'left' ? 'left' : 'right'; }
    S.widgets = [{ id: 'w1', name: 'OBS', tt: tt || 'left', tw: tw || 'left' }, { id: 'w2', name: 'TikTok LIVE', tt: 'right', tw: 'right' }];
  }
} catch (_) {}
delete S.wAlignTt; delete S.wAlignTw;
// у каждого виджета свои настройки (иконки, аватарки, подарки, тень, исчезновение, масштаб, высота, время жизни).
// Прежние общие настройки переносятся в каждый виджет, так что внешний вид после обновления не меняется.
const WDEF = { icons: true, avatars: true, gifts: true, shadow: true, fade: true, scale: 100, height: 100, fadeSec: 20 };
const WKEYS = { wIcons: 'icons', wAvatars: 'avatars', wGifts: 'gifts', wShadow: 'shadow', wFade: 'fade' };
const clampInt = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
let legacyW = {};
try {
  const r = JSON.parse(localStorage.getItem('echochat2') || '{}');
  legacyW = { icons: r.wIcons, avatars: r.wAvatars, gifts: r.wGifts, shadow: r.wShadow, fade: r.wFade, scale: r.wScale, height: r.wHeight, fadeSec: r.wFadeSec };
} catch (_) {}
const normWidget = (w, base = legacyW) => {
  const g = (k) => (w[k] !== undefined && w[k] !== null ? w[k] : base[k] !== undefined && base[k] !== null ? base[k] : WDEF[k]);
  return {
    id: String(w.id), name: String(w.name || 'Виджет').slice(0, 20), tt: w.tt === 'right' ? 'right' : 'left', tw: w.tw === 'right' ? 'right' : 'left',
    icons: !!g('icons'), avatars: !!g('avatars'), gifts: !!g('gifts'), shadow: !!g('shadow'), fade: !!g('fade'),
    scale: clampInt(g('scale'), 50, 200, WDEF.scale), height: clampInt(g('height'), 20, 100, WDEF.height), fadeSec: clampInt(g('fadeSec'), 3, 120, WDEF.fadeSec),
  };
};
S.widgets = S.widgets.filter((w) => w && w.id).map((w) => normWidget(w));
['wIcons', 'wAvatars', 'wGifts', 'wShadow', 'wFade', 'wScale', 'wHeight', 'wFadeSec'].forEach((k) => delete S[k]);
if (!S.widgets.length) S.widgets = [normWidget({ id: 'w1', name: 'OBS', tt: 'left', tw: 'left' })];
if (!S.widgets.some((w) => w.id === S.wSel)) S.wSel = S.widgets[0].id;
const curW = () => S.widgets.find((w) => w.id === S.wSel) || S.widgets[0];
// встроенные голоса всегда на месте, свои — добавляются после них
S.presets = BUILTIN.map((b) => ({ ...b, ...((S.presets || []).find((p) => p.id === b.id) || {}), builtin: true }));
if (!S.presets.some((p) => p.id === S.selected)) S.selected = BUILTIN[0].id;
delete S.subsOnly; // режим «только подписчики» убран
delete S.showTwitch; // чат Twitch всегда показывается в ленте, если канал подключён
// прежняя общая настройка «озвучивать чат» переносится на обе платформы
try { const raw = JSON.parse(localStorage.getItem('echochat2') || '{}'); if (typeof raw.chat === 'boolean' && raw.ttChat === undefined) { S.ttChat = raw.chat; S.twChat = raw.chat; } } catch (_) {}
delete S.chat;
// голоса платформ: у тех, кто обновился, остаётся прежний голос чата
const ensureRouteVoices = () => ['ttVoice', 'twVoice'].forEach((k) => { if (!S.presets.some((p) => p.id === S[k])) S[k] = S.presets.some((p) => p.id === S.selected) ? S.selected : BUILTIN[0].id; });
ensureRouteVoices();
let warmT = null;
const save = () => {
  try { localStorage.setItem('echochat2', JSON.stringify(S)); } catch (_) {}
  // поменяли голос (в том числе для подарков и подписок) — соединение для него открываем сразу, а не на первой фразе
  clearTimeout(warmT); warmT = setTimeout(() => { try { warmVoices(); } catch (_) {} }, 1200);
};
const selectedPreset = () => S.presets.find((p) => p.id === S.selected) || S.presets[0];
const ttPreset = () => S.presets.find((p) => p.id === S.ttVoice) || selectedPreset();
const twPreset = () => S.presets.find((p) => p.id === S.twVoice) || selectedPreset();

/* ---------- выпадающие списки в стиле приложения ---------- */
const csels = [];
function closeSels(except) { csels.forEach((c) => { if (c.root !== except) c.root.classList.remove('open'); }); }
function makeSelect(id, { options, get, set }) {
  const root = $('#' + id), val = $('.csel-val', root), drop = $('.csel-drop', root);
  const render = () => {
    const opts = options(), cur = get();
    const o = opts.find((x) => x.v === cur) || opts[0];
    val.textContent = o ? o.label : '';
    drop.innerHTML = '';
    opts.forEach((x) => {
      const d = document.createElement('div');
      d.className = 'csel-opt' + (o && x.v === o.v ? ' sel' : '');
      d.textContent = x.label;
      d.onclick = (e) => { e.stopPropagation(); root.classList.remove('open'); set(x.v); render(); };
      drop.appendChild(d);
    });
  };
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSels(root);
    root.classList.toggle('open');
    if (root.classList.contains('open')) {
      // мало места снизу — раскрываем вверх
      root.classList.remove('up');
      const r = root.getBoundingClientRect(), need = Math.min(drop.scrollHeight, 240) + 12;
      if (window.innerHeight - r.bottom < need && r.top > need) root.classList.add('up');
      drop.classList.toggle('sc', drop.scrollHeight > drop.clientHeight + 1); // отступ под полосу прокрутки
      const sel = $('.sel', drop); if (sel) sel.scrollIntoView({ block: 'nearest' });
    }
  });
  csels.push({ root, render });
  render();
  return render;
}
document.addEventListener('click', () => closeSels());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSels(); });

/* ---------- вкладки ---------- */
const TITLES = {
  live: ['Эфир', 'Подключись к TikTok LIVE и слушай чат вслух'],
  voice: ['Озвучка', 'Живые голоса, свои пресеты и события для озвучки'],
  filters: ['Фильтры', 'Что голос читает вслух, а что пропускает'],
  widgets: ['Виджеты', 'Чат, топ лайков и оповещения для OBS и TikTok LIVE Studio'],
  kaspi: ['Донаты Каспи', 'Донаты на экран стрима: имя, сумма и картинка'],
  overlay: ['Оверлей чата', 'Окно чата TikTok и Twitch поверх всех окон на время стрима'],
  license: ['Лицензия', 'Тариф, ключ и пробный период'],
  settings: ['Настройки', 'Окно, запуск и обновления'],
};
$$('.nav').forEach((b) => b.addEventListener('click', () => {
  $$('.nav').forEach((x) => x.classList.toggle('active', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('show', t.id === 'tab-' + b.dataset.tab));
  document.body.classList.toggle('t-widgets', b.dataset.tab === 'widgets');
  if (b.dataset.tab === 'widgets') requestAnimationFrame(() => { initPreview(); initLikesPreview(); initGiftsPreview(); initAlertPreview(); });
  if (b.dataset.tab === 'kaspi') requestAnimationFrame(() => { initGuideVideo(); initDonatePreview(); });
  $('#title').textContent = TITLES[b.dataset.tab][0];
  $('#subtitle').textContent = TITLES[b.dataset.tab][1];
}));

// переключатели виджета (data-k=w...) хранятся в выбранном виджете, остальные — общие
$$('input[data-k]').forEach((el) => {
  const wk = WKEYS[el.dataset.k];
  el.checked = wk ? !!curW()[wk] : !!S[el.dataset.k];
  el.addEventListener('change', () => {
    if (wk) { curW()[wk] = el.checked; save(); pushWidget(); } else { S[el.dataset.k] = el.checked; save(); }
  });
});

function bindRange(id, label, fmt, get, set) {
  const el = $('#' + id), lb = $('#' + label);
  const refresh = () => { const v = get(); el.value = v; lb.textContent = fmt(v); };
  el.addEventListener('input', () => { set(+el.value); lb.textContent = fmt(+el.value); save(); });
  return refresh;
}
const refreshVol = bindRange('vol', 'volVal', (v) => v + '%', () => S.vol, (v) => { S.vol = v; if (cur) cur.volume = v / 100; });
const refreshRate = bindRange('rate', 'rateVal', (v) => (v > 0 ? '+' : '') + v + '%', () => selectedPreset().rate, (v) => { selectedPreset().rate = v; });
function syncControls() {
  $('#rate').disabled = false;
  $('#pitch').disabled = false;
  $('#rate').closest('.ctl').classList.remove('off');
  $('#pitch').closest('.ctl').classList.remove('off');
}
const refreshPitch = bindRange('pitch', 'pitchVal', (v) => (v > 0 ? '+' : '') + v + ' Гц', () => selectedPreset().pitch, (v) => { selectedPreset().pitch = v; });
const refreshWScale = bindRange('wScale', 'wScaleVal', (v) => v + '%', () => curW().scale, (v) => { curW().scale = v; pushWidget(); });
// пока двигают ползунок высоты, в предпросмотре (и только в выбранном виджете) видна граница чата
const refreshWHeight = bindRange('wHeight', 'wHeightVal', (v) => v + '%', () => curW().height, (v) => { curW().height = v; pushWidget(true); });
$('#wHeight').addEventListener('mousedown', () => pushWidget(true));
$('#wHeight').addEventListener('touchstart', () => pushWidget(true), { passive: true });
$('#wHeight').addEventListener('mouseup', () => pushWidget(false));
$('#wHeight').addEventListener('touchend', () => pushWidget(false));
$('#wHeight').addEventListener('change', () => pushWidget(false));
const refreshWFade = bindRange('wFadeSec', 'wFadeSecVal', (v) => v + ' с', () => curW().fadeSec, (v) => { curW().fadeSec = v; pushWidget(); });
const widgetFields = (w) => ({ icons: w.icons, avatars: w.avatars, gifts: w.gifts, shadow: w.shadow, fade: w.fade, scale: w.scale, height: w.height, fadeSec: w.fadeSec });
// на сервер уходят настройки всех виджетов: каждая ссылка (?w=id) берёт свои. Плоские поля — настройки выбранного виджета (для старых страниц)
function getWSet(preview) {
  const w = curW();
  return { ...widgetFields(w), widgets: S.widgets.map((x) => ({ id: x.id, tt: x.tt, tw: x.tw, ...widgetFields(x) })), _previewHeight: preview ? w.id : false };
}
function pushWidget(preview) { window.echo.widgetSet(getWSet(preview)); }
// показать в правой панели настройки выбранного виджета
function refreshWidgetUi() {
  alignRenders.forEach((r) => r());
  refreshWScale(); refreshWHeight(); refreshWFade();
  $$('#tab-widgets input[data-k]').forEach((el) => { if (WKEYS[el.dataset.k]) el.checked = !!curW()[WKEYS[el.dataset.k]]; });
}
const refreshLen = bindRange('maxLen', 'lenVal', (v) => v, () => S.maxLen, (v) => { S.maxLen = v; });
$('#nick').value = S.nick;
$('#twNick').value = S.twNick || '';

/* ---------- карточки голосов ---------- */
const voicesBox = $('#voices');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderVoices() {
  voicesBox.innerHTML = '';
  S.presets.forEach((p) => {
    const d = document.createElement('div');
    d.className = 'voice' + (p.id === S.selected ? ' sel' : '');
    d.dataset.id = p.id;
    d.innerHTML = `<div class="av">${esc((p.name[0] || '?').toUpperCase())}</div>
      <div class="vi"><b>${esc(p.name)}</b><small>${esc(p.desc || p.voice || '')}</small></div>
      <span class="vtags">${p.id !== S.selected && S.ttVoice === p.id ? '<em class="tt">TikTok</em>' : ''}${p.id !== S.selected && S.twVoice === p.id ? '<em class="tw">Twitch</em>' : ''}</span>
      <button class="mini play" title="Прослушать">${ICON_PLAY}</button>
      ${p.builtin ? '' : '<button class="mini del" title="Удалить голос">✕</button>'}
      ${p.id === S.selected ? `<div class="vroute"><span>Озвучивает чат:</span><button class="rbtn tt${S.ttVoice === p.id ? ' on' : ''}" data-r="tt" title="Озвучивать чат TikTok этим голосом">TikTok</button><button class="rbtn tw${S.twVoice === p.id ? ' on' : ''}" data-r="tw" title="Озвучивать чат Twitch этим голосом">Twitch</button></div>` : ''}`;
    d.onclick = () => { S.selected = p.id; save(); renderVoices(); refreshRate(); refreshPitch(); syncControls(); warmVoices(); }; // следом человек жмёт TikTok/Twitch — соединение для голоса к тому времени уже готово
    $('.play', d).onclick = (e) => { e.stopPropagation(); previewPreset(p); };
    $$('.rbtn', d).forEach((btn) => { // закрепить этот голос за платформой: у платформы всегда есть голос, поэтому «снять» нельзя — только назначить другой
      btn.onclick = (e) => { e.stopPropagation(); const k = btn.dataset.r === 'tt' ? 'ttVoice' : 'twVoice', was = S[k]; S[k] = p.id; save(); renderVoices(); if (was !== p.id) dropForVoiceChange(); };
    });
    const del = $('.del', d);
    if (del) del.onclick = (e) => {
      e.stopPropagation();
      S.presets = S.presets.filter((x) => x.id !== p.id);
      if (S.selected === p.id) S.selected = BUILTIN[0].id;
      ensureRouteVoices();
      save(); renderVoices(); refreshRate(); refreshPitch(); syncControls();
    };
    voicesBox.appendChild(d);
  });
  refreshPreviewUi();
  fillVoiceSelects();
}

// голос чата TikTok и Twitch закрепляется кнопками в карточке выбранного голоса; для подарков и подписок — список в «Что озвучивать»
const voiceOpts = () => S.presets.map((p) => ({ v: p.id, label: p.name + ' · ' + (p.gender === 'M' ? 'муж.' : 'жен.') }));
const routeSelects = [
  makeSelect('eventVoiceSel', {
    options: () => [{ v: '', label: 'Как у чата TikTok' }, ...voiceOpts()],
    get: () => (S.presets.some((p) => p.id === S.eventVoice) ? S.eventVoice : ''),
    set: (v) => { const was = S.eventVoice; S.eventVoice = v; save(); if (was !== v) dropForVoiceChange(); },
  }),
];
function fillVoiceSelects() { ensureRouteVoices(); routeSelects.forEach((r) => r()); }
const eventPreset = () => S.presets.find((p) => p.id === S.eventVoice) || ttPreset();
// заранее открыть соединения с сервером озвучки для голосов чата, Twitch и событий: первая фраза эфира не ждёт подключения
function warmVoices() { try { window.echo.warm([...new Set([ttPreset(), twPreset(), eventPreset(), selectedPreset()].map((p) => p && p.voice).filter(Boolean))]); } catch (_) {} }
setTimeout(warmVoices, 2500);
setInterval(warmVoices, 5 * 60 * 1000); // голоса подарков и подписок звучат редко — напоминаем серверу-пулу, что они нужны

// Оставляем только голоса, которые реально есть у сервиса Microsoft
const BASE_IDS = ['b-svetlana', 'b-dmitry'];
function applyCatalog(all) {
  if (!Array.isArray(all) || all.length < 10) return; // каталог не загрузился — показываем всё
  const have = new Set(all);
  S.presets = S.presets.filter((p) => BASE_IDS.includes(p.id) || have.has(p.voice));
  if (!S.presets.some((p) => p.id === S.selected)) S.selected = BUILTIN[0].id;
  ensureRouteVoices(); save();
  renderVoices(); refreshRate(); refreshPitch(); syncControls();
}

/* ---------- прослушивание голоса: ▶ превращается в паузу и останавливает ---------- */
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
let previewItem = null; // { id, item } — фраза, которая сейчас звучит или готовится

function refreshPreviewUi() {
  const pid = previewItem && previewItem.id;
  $$('#voices .play').forEach((b) => {
    const on = b.closest('.voice').dataset.id === pid;
    b.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    b.title = on ? 'Остановить' : 'Прослушать';
    b.classList.toggle('active', on);
  });
  const t = $('#btnTest'), tOn = !!pid && pid === S.selected;
  t.innerHTML = (tOn ? ICON_PAUSE : ICON_PLAY) + (tOn ? 'Остановить' : 'Проверить голос');
  t.classList.toggle('stop', tOn);
}

function stopPreview() {
  if (!previewItem) return;
  previewItem.item.cancelled = true;
  previewItem = null;
  queue.length = 0; stopCurrent();
  refreshPreviewUi();
}

function previewPreset(p) {
  if (previewItem && previewItem.id === p.id) return stopPreview(); // повторное нажатие — пауза
  stopPreview();
  queue.length = 0; stopCurrent();
  const item = {
    el: null, say: `Привет! Меня зовут ${p.name}. Я буду читать чат твоего эфира.`, preset: p,
    onEnd: () => { if (previewItem && previewItem.item === item) { previewItem = null; refreshPreviewUi(); } },
  };
  previewItem = { id: p.id, item };
  refreshPreviewUi();
  enqueue(item, true);
}
$('#btnTest').onclick = () => previewPreset(selectedPreset());

/* ---------- лента ---------- */
const feed = $('#feed');
const colors = ['#8b5cf6', '#ec4899', '#22d3ee', '#f59e0b', '#10b981', '#6366f1', '#ef4444'];
const colorOf = (s) => colors[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length];

const ICON_TT = '<svg class="pi" viewBox="0 0 24 24"><path fill="#fff" d="M16.6 5.8A4.3 4.3 0 0 1 15.5 3h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.7 5.7 0 1 0 4.9 5.7V9a7.3 7.3 0 0 0 4.3 1.4V7.3a4.3 4.3 0 0 1-3.2-1.5z"/></svg>';
const ICON_TW = '<svg class="pi" viewBox="0 0 24 24"><path fill="#a970ff" d="M4 2 2.5 6v14H8v2.5h3L13.5 20H18l3.5-3.5V2H4zm15.5 13-2.5 2.5h-4.5L10 20v-2.5H6V4h13.5v11zM16 7.5h-2v5h2v-5zm-5 0H9v5h2v-5z"/></svg>';
/* ---------- пауза: лента не прокручивается за новыми сообщениями и сама возвращается к последнему ---------- */
const FEED_MAX = 150;
let PAUSE_MS = 0; // таймера паузы больше нет: пауза — полный стоп, пока не снимешь
const isPaused = () => $('#paused').checked;
function addMsg(msg) { return renderMsg(msg); }
// Лента сама возвращается вниз через FEED_RETURN_MS после того, как её перестали листать (на паузе и при выделенном тексте — нет)
let FEED_RETURN_MS = 10000, feedUserAt = 0, feedTimer = null;
const feedFromBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight;
function feedScheduleReturn() {
  clearTimeout(feedTimer);
  feedTimer = setTimeout(() => {
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && feed.contains(sel.anchorNode)) return feedScheduleReturn(); // человек выделил текст — не мешаем
    if (isPaused() || feedFromBottom() <= 4) return;
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
  }, FEED_RETURN_MS);
}
['wheel', 'touchmove', 'pointerdown', 'keydown'].forEach((ev) => feed.addEventListener(ev, () => { feedUserAt = Date.now(); feedScheduleReturn(); }, { passive: true }));
function renderMsg({ name, text, kind = '', sub = false, color, avatar = '', platform = '', giftImg = '' }) {
  if (isPaused() && !/\bsys\b/.test(kind)) return document.createElement('div'); // на паузе новые сообщения в ленте не показываются (озвучка от паузы не зависит)
  $('.empty', feed)?.remove();
  const el = document.createElement('div');
  el.className = 'msg ' + kind;
  const icon = platform === 'twitch' ? ICON_TW : platform === 'tiktok' ? ICON_TT : '';
  el.innerHTML = `<div class="av" style="background-color:${color || colorOf(name)}">${esc((name[0] || '?').toUpperCase())}</div>
    <div class="b"><div class="n">${icon}${esc(name)}${sub ? '<em>SUB</em>' : ''}</div><div class="t">${esc(text)}${giftImg && /^https:/.test(giftImg) ? `<img class="gi" src="${esc(giftImg)}" alt="">` : ''}</div></div>`;
  if (/^https?:\/\//.test(avatar)) { // аватарка с обеих площадок; если не загрузится — остаётся буква
    const av = $('.av', el), im = new Image();
    im.onload = () => { av.style.backgroundImage = `url("${esc(avatar)}")`; av.textContent = ''; };
    im.src = avatar;
  }
  // человек листает ленту вверх, чтобы прочитать: пока он «в процессе», новые сообщения её не сдёргивают вниз
  const reading = Date.now() - feedUserAt < FEED_RETURN_MS && feedFromBottom() > 40;
  feed.appendChild(el);
  while (feed.children.length > FEED_MAX) feed.firstChild.remove();
  if (!isPaused() && !reading) feed.scrollTop = feed.scrollHeight; // на паузе лента стоит на месте
  return el;
}
// цвет точки в «таблетке»: зелёный — подключились, красный — завершилось или ошибка, голубой — остальное
const sysTone = (t) => (/завершена|ошибк|не удалось|не работает|нестабильн|отклон|отмен|не найден|не в эфире/i.test(t) ? 'bad' : /подключено!|подключён\./i.test(t) ? 'ok' : '');
const sys = (text) => addMsg({ name: 'Система', text, kind: ('sys ' + sysTone(text)).trim(), color: '#475569' });
const resetEmpty = () => { feed.innerHTML = '<div class="empty">Здесь появятся сообщения чата</div>'; };
resetEmpty();
$('#btnClear').onclick = resetEmpty;

/* ---------- фильтры ---------- */
const BAD = /(?:^|[^а-яё])(?:х[уy][йяеёию]|пизд|бл[яе]д|бля|еб[аауо]|ёб|ебл|сук[аи]|муд[аи]|гондон|залуп|пидор|пидр|шлюх|дроч|нахуй|нахер)/i;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const recent = new Map();

function clean(raw) {
  let t = String(raw || '').trim();
  if (S.noEmoji) t = t.replace(EMOJI, '');
  if (S.skipLinks && /(https?:\/\/|www\.|\b[\w-]+\.(com|ru|net|org|me|io|kz|ua)\b)/i.test(t)) return null;
  if (S.skipCmd && /^[!/]/.test(t)) return null;
  t = t.replace(/\[[A-Za-z0-9_ ]{1,24}\]/g, ' '); // смайлы TikTok вида [rose]
  // ник с кириллицей тоже (\w не понимает русские буквы); ник из двух слов («@Анна Петрова») — вторую часть с заглавной тоже убираем
  if (S.skipMentions) t = t.replace(/@[\p{L}\p{N}_.-]+(\s+\p{Lu}[\p{L}\p{N}_.-]*)?/gu, '');
  t = t.replace(/(\p{L})\1{2,}/gu, '$1').replace(/\s+/g, ' ').trim(); // «приветттт» -> «привет»
  if (!t || !/[a-zа-яё0-9]/i.test(t)) return null;
  if (S.onlyRu && !/[а-яё]/i.test(t)) return null;
  if (S.profanity && BAD.test(t)) return null;
  if (S.noRepeat) {
    const k = t.toLowerCase(), ts = Date.now();
    for (const [key, v] of recent) if (ts - v > 20000) recent.delete(key);
    if (recent.has(k)) return null;
    recent.set(k, ts);
  }
  if (t.length > S.maxLen) t = t.slice(0, S.maxLen).replace(/\s\S*$/, '') + '…';
  return t;
}
// ник для озвучки: без эмодзи и мусора, чтобы голос не спотыкался
function speakName(n) {
  const t = String(n || '').replace(EMOJI, '').replace(/\d{5,}/g, ' ').replace(/[_.]+/g, ' ').replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  return t || 'Гость';
}

/* ---------- очередь озвучки ---------- */
const queue = [];
let chimeStop = null; // обрывает играющий звук доната
let busy = false, cur = null, curUrl = null, curEl = null, curResolve = null, curItem = null;

const QUEUE_MAX = 12;      // длиннее очередь — больше отставание от эфира (самое старое отбрасывается)
const STALE_MS = 40000;    // сообщение старше этого времени уже не озвучиваем
// при длинной очереди можно читать чуть быстрее (true). По умолчанию выключено — скорость всегда как в настройках голоса
const CATCH_UP = false; // выключено: ускорение голоса раздражало
const catchUpRate = () => { if (!CATCH_UP) return 1; const n = queue.length; return n >= 6 ? 1.3 : n >= 4 ? 1.2 : n >= 2 ? 1.1 : 1; };
function prefetch() { queue.slice(0, 3).forEach(ensureSynth); } // звук готовится заранее, пока говорит предыдущая фраза

let voiceCalls = 0; // сколько раз пытались озвучить (для автотеста)
// подарки, подписки и донаты озвучиваются вне очереди чата (сразу после текущей фразы), а при переполнении отбрасывается самое старое сообщение чата
const PRIO_SRC = new Set(['gifts', 'follows', 'donateSound', 'donateVoice', 'alertSound']);
function enqueue(item, force = false) {
  voiceCalls++; // пауза относится только к ленте чата: озвучка идёт по настройкам на странице «Озвучка»
  if (queue.length >= QUEUE_MAX) { const i = queue.findIndex((q) => !PRIO_SRC.has(q.src)); queue.splice(i < 0 ? 0 : i, 1); }
  item.preset = item.preset || selectedPreset();
  item.t = Date.now(); item.force = force;
  if (PRIO_SRC.has(item.src)) { let at = 0; while (at < queue.length && PRIO_SRC.has(queue[at].src)) at++; queue.splice(at, 0, item); }
  else queue.push(item);
  prefetch();   // синтез стартует сразу при появлении сообщения
  pump();
}

function stopCurrent() {
  if (chimeStop) { const st = chimeStop; chimeStop = null; st(); }
  if (cur) { cur.onended = cur.onerror = null; cur.pause(); cur = null; }
  if (curUrl) { URL.revokeObjectURL(curUrl); curUrl = null; }
  if (curResolve) { const r = curResolve; curResolve = null; r(); }
}

function playBlob(b64, rate = 1) {
  return new Promise((resolve, reject) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    curUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    cur = new Audio(curUrl);
    cur.volume = S.vol / 100;
    cur.preservesPitch = true;
    cur.playbackRate = rate;
    curResolve = resolve;
    cur.onended = () => { curResolve = null; resolve(); };
    cur.onerror = () => { curResolve = null; reject(new Error('audio')); };
    cur.play().catch((e) => { curResolve = null; reject(e); });
  });
}

function synthFor(text, p, urgent) {
  return window.echo.synth({
    text, voice: p.voice, urgent: !!urgent,
    rate: Math.max(0.5, 1 + (p.rate || 0) / 100),
    pitch: ((p.pitch || 0) >= 0 ? '+' : '') + (p.pitch || 0) + 'Hz',
  }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
}

// синтез стартует заранее, пока играет предыдущая фраза — без пауз между сообщениями
function ensureSynth(item) {
  if (item.chime) return null; // у звука доната нет синтеза речи
  if (!item.p) item.p = synthFor(item.say, item.preset, PRIO_SRC.has(item.src));
  return item.p;
}

// звук доната и оповещения: ноты собираются в браузере, без файлов; громкость как у озвучки.
// notes: [частота, когда начать (с), сколько звучит (с), громкость]; endMs — когда считать звук законченным (следующая фраза начинается, пока он затихает)
let actx = null;
function playTones(notes, endMs) {
  return new Promise((resolve) => {
    let done = false, timer = 0, master = null, oscs = [];
    const finish = () => { if (done) return; done = true; clearTimeout(timer); chimeStop = null; resolve(); };
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime + 0.04, vol = Math.max(0, Math.min(1, (S.vol == null ? 100 : S.vol) / 100));
      master = actx.createGain(); master.gain.value = 0.5 * vol; master.connect(actx.destination);
      notes.forEach(([f, at, len, peak]) => {
        [[f, 1, len], [f * 2, 0.22, len * 0.55], [f * 3.01, 0.07, len * 0.3]].forEach(([fr, k, l]) => {
          const o = actx.createOscillator(), g = actx.createGain();
          o.type = 'sine'; o.frequency.value = fr;
          g.gain.setValueAtTime(0.0001, t0 + at);
          g.gain.exponentialRampToValueAtTime(peak * k, t0 + at + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + l);
          o.connect(g); g.connect(master); o.start(t0 + at); o.stop(t0 + at + l + 0.05); oscs.push(o);
        });
      });
      chimeStop = () => { // оборвать: быстро гасим и освобождаем
        try { master.gain.cancelScheduledValues(actx.currentTime); master.gain.setTargetAtTime(0, actx.currentTime, 0.015); oscs.forEach((o) => { try { o.stop(actx.currentTime + 0.08); } catch (_) {} }); } catch (_) {}
        finish();
      };
      timer = setTimeout(finish, endMs);
    } catch (_) { finish(); }
  });
}
// донат: мягкий «колокольчик» из четырёх нот (до-ми-соль-до)
const playBell = () => playTones([[1046.5, 0, 0.8, 0.34], [1318.5, 0.12, 0.8, 0.34], [1568, 0.24, 0.9, 0.36], [2093, 0.38, 1.5, 0.46]], 1300);
// подписка: быстрый «блеск» вверх по пентатонике (соль-си-ре-соль-си) и высокая искорка в конце — отличается от доната на слух
const playAlertBell = () => playTones([[783.99, 0, 0.7, 0.3], [987.77, 0.09, 0.7, 0.3], [1174.66, 0.18, 0.75, 0.32], [1567.98, 0.27, 0.9, 0.36], [1975.53, 0.36, 1.3, 0.4], [3135.96, 0.52, 0.8, 0.14]], 1500);

// свой звук доната (файл, который человек загрузил): играет вместо колокольчика, не дольше 20 с; не заиграл — звучит колокольчик
let customSound = null; // { url } — адрес загруженного звука
function playCustom(snd = customSound) {
  return new Promise((resolve) => {
    let done = false, timer = 0, a = null;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); chimeStop = null; if (a) { a.onended = a.onerror = null; try { a.pause(); } catch (_) {} } resolve(ok === true); };
    try {
      a = new Audio(snd.url);
      a.volume = Math.max(0, Math.min(1, (S.vol == null ? 100 : S.vol) / 100));
      a.onended = () => finish(true);
      a.onerror = () => finish(false);
      chimeStop = () => finish(true); // оборвали (стоп, пропуск) — колокольчик после этого не нужен
      timer = setTimeout(() => finish(true), 20000);
      const p = a.play(); if (p && p.catch) p.catch(() => finish(false));
    } catch (_) { finish(false); }
  });
}
async function playChime() {
  if (customSound && customSound.url) { if (await playCustom()) return; }
  return playBell();
}
// звук оповещения о подписке: свой файл (отдельный от доната) или стандартный «блеск»
let alertSound = null; // { url } — адрес загруженного звука оповещения
async function playAlertChime() {
  if (alertSound && alertSound.url) { if (await playCustom(alertSound)) return; }
  return playAlertBell();
}

// Ждём синтез не дольше SYNTH_DEADLINE_MS: иначе одна зависшая фраза останавливает всю очередь на десятки секунд.
// Фраза, которая не успела, пропускается; запрос в фоне доработает и будет забыт.
const SYNTH_DEADLINE_MS = 8000;
const withDeadline = (p) => Promise.race([p, new Promise((res) => setTimeout(() => res({ ok: false, error: 'deadline' }), SYNTH_DEADLINE_MS))]);

async function speakItem(item) {
  if (item.alertChime) { await playAlertChime(); return; }
  if (item.chime) { await playChime(); return; }
  let r = await withDeadline(ensureSynth(item));
  if (item.cancelled) return; // нажали паузу, пока звук готовился
  // синтез не вышел быстро — одна повторная попытка (если фраза ещё не устарела), потом молча пропускаем: без системного голоса Windows и без уведомлений
  if (!(r && r.ok) && r && r.error !== 'deadline' && (item.force || Date.now() - item.t < STALE_MS - 8000)) {
    item.p = null;
    r = await withDeadline(ensureSynth(item));
    if (item.cancelled) return;
  }
  if (r && r.ok) {
    const rate = item.force ? 1 : catchUpRate();
    try { await playBlob(r.audio, rate); }
    catch (_) {
      // звук не проигрался (битый кусок, сбой устройства) — один раз синтезируем заново и играем ещё раз
      if (item.cancelled) return;
      item.p = null;
      const r2 = await withDeadline(ensureSynth(item));
      if (item.cancelled) return;
      if (r2 && r2.ok) { try { await playBlob(r2.audio, rate); } catch (_) {} }
    }
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const it = queue.shift();
      curItem = it;
      if (it.cancelled) { it.onEnd && it.onEnd(); continue; }
      if (!it.force && Date.now() - it.t > STALE_MS) continue; // устарело — пропускаем, чтобы догнать эфир
      curEl = it.el; curEl?.classList.add('speaking'); document.body.classList.add('talking');
      prefetch();
      try { await speakItem(it); } catch (_) {}
      it.onEnd && it.onEnd();
      curEl?.classList.remove('speaking'); curEl = null;
      stopCurrent();
      if (!queue.length) document.body.classList.remove('talking');
    }
  } finally { busy = false; curItem = null; document.body.classList.remove('talking'); }
}

// «Пропустить фразу» (из окна и из меню значка в трее)
function skipPhrase() { if (curItem) curItem.cancelled = true; stopCurrent(); }
// выключили переключатель — сразу замолкаем: убираем из очереди все фразы этого источника и обрываем текущую, если она его
function dropSrc(src) {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].src === src) { queue[i].cancelled = true; queue.splice(i, 1); }
  if (curItem && curItem.src === src) skipPhrase();
}
function silence() { queue.forEach((it) => { it.cancelled = true; }); skipPhrase(); }
// поменяли голос чата или подарков: старая очередь старым голосом не дочитывается, играющая фраза обрывается,
// и следующее же сообщение звучит новым голосом (функции объявлены выше по файлу, вызывается только по клику, когда всё уже загружено)
function dropForVoiceChange() {
  warmVoices(); // соединение для нового голоса открываем сразу, а не через 1,2 с после сохранения настроек: иначе первая фраза ждёт подключения
  while (queue.length) { const it = queue.shift(); it.cancelled = true; try { it.onEnd && it.onEnd(); } catch (_) {} }
  skipPhrase();
}

// значок в трее показывает и меняет основные переключатели озвучки: окно сообщает их состояние, трей присылает команды
const TRAY_KEYS = ['ttChat', 'gifts', 'follows', 'twChat'];
const trayEl = (k) => document.querySelector('input[data-k=' + k + ']');
const pushTray = () => { try { window.echo.trayState(Object.fromEntries(TRAY_KEYS.map((k) => [k, !!S[k]]))); } catch (_) {} };
TRAY_KEYS.forEach((k) => { const el = trayEl(k); if (el) el.addEventListener('change', () => { if (!el.checked) dropSrc(k); pushTray(); }); });
window.echo.onTraySet(({ key, value }) => { const el = TRAY_KEYS.includes(key) && trayEl(key); if (el) { el.checked = !!value; el.dispatchEvent(new Event('change')); } });
window.echo.onTraySkip(skipPhrase);
pushTray();

// пауза останавливает только ленту: звук и очередь озвучки не трогаем; при снятии лента возвращается вниз
$('#paused').addEventListener('change', (e) => {
  if (!e.target.checked) feed.scrollTop = feed.scrollHeight;
});

/* ---------- события TikTok ---------- */
const counters = { likes: 0, gifts: 0, follows: 0 };
const bump = (id, v) => { $(id).textContent = v.toLocaleString('ru-RU'); };

// Озвучиваем только то, что написали после подключения. Время отсчитывается от нажатия «Подключить»:
// всё, что создано раньше (хвост чата, который иногда присылает платформа), не показываем и не читаем.
const since = { tiktok: 0, twitch: 0 };
const BACKLOG_WINDOW = 20000, SKEW = 2000;
const isBacklog = (m, platform) => !!(m.created && since[platform] && Date.now() - since[platform] < BACKLOG_WINDOW && m.created < since[platform] - SKEW);
function handleChat(m, platform) {
  if (!m.text || isBacklog(m, platform)) return; // пустые и старые сообщения не показываем и не озвучиваем
  const el = addMsg({ name: m.name, text: m.text, sub: m.isSub, avatar: m.avatar, platform });
  if (platform === 'twitch' ? !S.twChat : !S.ttChat) return; // озвучка этой платформы выключена — сообщение остаётся в ленте
  const t = clean(m.text);
  if (!t) return;
  enqueue({ el, src: platform === 'twitch' ? 'twChat' : 'ttChat', say: S.readName ? `${speakName(m.name)}: ${t}` : t, preset: platform === 'twitch' ? twPreset() : ttPreset() });
}
window.echo.onChat((m) => handleChat(m, 'tiktok'));
// Twitch: сообщения есть только если канал указан и подключён
window.echo.onTwChat((m) => handleChat(m, 'twitch'));
window.echo.onGift((g) => {
  counters.gifts += g.count; bump('#sGifts', counters.gifts);
  const el = addMsg({ name: g.name, text: `🎁 отправил(а) «${g.gift}» ×${g.count}`, kind: 'gift', avatar: g.avatar, platform: 'tiktok', giftImg: g.image });
  if (S.gifts) enqueue({ el, src: 'gifts', say: g.count > 1 ? `${speakName(g.name)}, спасибо за подарки ${g.gift}, ${g.count} штук` : `${speakName(g.name)}, спасибо за подарок ${g.gift}`, preset: eventPreset() });
});
window.echo.onFollow((f) => {
  counters.follows++; bump('#sFollows', counters.follows);
  const el = addMsg({ name: f.name, text: '➕ подписался(ась) на канал', kind: 'follow', avatar: f.avatar, platform: 'tiktok' });
  if (S.follows) enqueue({ el, src: 'follows', say: `${speakName(f.name)}, спасибо за подписку`, preset: eventPreset() });
});
// итог от TikTok (total) надёжнее суммы событий; если итога нет (или 0) — копим сами
window.echo.onLike((l) => {
  counters.likes = l.total > 0 ? Math.max(counters.likes, l.total) : counters.likes + (l.count || 1);
  bump('#sLikes', counters.likes);
});
window.echo.onViewers((v) => { if (Number.isFinite(v.count)) $('#sViewers').textContent = v.count.toLocaleString('ru-RU'); });
// онлайн Twitch считается отдельно: пока стрима нет (или канал не подключён) — прочерк
// онлайн Twitch: от 10 000 — двузначное число и K (12 400 → 12K), чтобы цифры помещались в плашку
const shortViewers = (n) => (n >= 10000 ? Math.floor(n / 1000) + 'K' : n.toLocaleString('ru-RU'));
window.echo.onTwViewers((v) => { const e = $('#sViewersTw'); e.textContent = v && Number.isFinite(v.count) ? shortViewers(v.count) : '—'; e.title = v && Number.isFinite(v.count) ? v.count.toLocaleString('ru-RU') : ''; });
window.echo.onError((e) => sys(e.message));

/* ---------- подключение ---------- */
let twLive = false, twConnecting = false;
const connTw = $('#connTw');
const btnTw = $('#btnTwitch');

// пустой ник: подсвечиваем поле красным и ставим в него курсор
function flagField(input) {
  const f = input.closest('.nick-field');
  f.classList.remove('err'); void f.offsetWidth; f.classList.add('err');
  input.focus();
  clearTimeout(f._t); f._t = setTimeout(() => f.classList.remove('err'), 3000);
}
['#nick', '#twNick'].forEach((id) => $(id).addEventListener('input', () => $(id).closest('.nick-field').classList.remove('err')));
async function connectTwitch() {
  const nick = $('#twNick').value.trim();
  if (!nick) { flagField($('#twNick')); return false; }
  if (twConnecting) return false;
  twConnecting = true; btnTw.textContent = 'Подключаю…'; btnTw.disabled = true; S.twNick = nick; save();
  since.twitch = Date.now();
  const r = await window.echo.twConnect(nick);
  btnTw.disabled = false; twConnecting = false;
  if (!r || !r.ok) { btnTw.textContent = 'Подключить'; sys('Twitch: ' + ((r && r.error) || 'ошибка подключения')); return false; }
  sys('Twitch: подключаемся к ' + r.channel + '…');
  return true;
}
async function disconnectTwitch() {
  await window.echo.twDisconnect();
  btnTw.textContent = 'Подключить'; btnTw.classList.remove('connected'); twLive = false;
}
btnTw && (btnTw.onclick = async () => { twLive ? disconnectTwitch() : connectTwitch(); });
$('#twNick').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !twLive) connectTwitch(); });

const btn = $('#btnConnect'), status = $('#status');
const pillTt = $('#pillTt'), pillTw = $('#pillTw');
let connected = false, connecting = false, netOnline = true;
let _ttText = '', _twText = '';
// обе плашки видны всегда: «Не в эфире TikTok» / «Не в эфире Twitch» до подключения
function renderPills() {
  [[pillTt, connected, _ttText, 'Не в эфире TikTok'], [pillTw, twLive, _twText, 'Не в эфире Twitch']].forEach(([el, on, txt, off]) => {
    el.classList.toggle('on', on); el.classList.toggle('idle', !on);
    el.classList.toggle('net', !netOnline); // нет интернета — точка и рамка жёлтые
    el.lastElementChild.textContent = !netOnline ? (on ? txt + ' · нет сети' : 'Нет интернета') : on ? txt : off;
  });
}
function renderTwViewers() { const e = $('.vv.tw'); if (e) e.hidden = !twLive; } // онлайн Twitch виден, только пока Twitch подключён
function setNetOnline(v) { if (netOnline === v) return; netOnline = v; renderPills(); if (v) autoCheckUpdate(); }
window.echo.onNet((n) => setNetOnline(!!(n && n.online)));
window.addEventListener('offline', () => setNetOnline(false));
window.addEventListener('online', async () => setNetOnline(await window.echo.netCheck().catch(() => true)));
renderTwViewers();
window.echo.netState().then((v) => setNetOnline(v !== false)).catch(() => {});
const connNick = $('#connNick'), connStatus = $('#connStatus'), connTwStatus = $('#connTwStatus'), connTime = $('#connTime');
// статус подключения платформы: зелёный — подключена, жёлтый — переподключение
const setSt = (el, t, tone) => { el.textContent = t; el.classList.toggle('ok', tone === 'ok'); el.classList.toggle('warn', tone === 'warn'); };
// ник на цветной плашке; «—» — приглушённый
const setNk = (el, t) => { el.textContent = t; el.classList.toggle('off', !t || t === '—'); };
let liveSince = 0, timerId = null;
const fmtTime = (ms) => [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
  .map((n) => String(n).padStart(2, '0')).join(':');
function startTimer() {
  if (timerId) return; // идёт с первой подключённой платформы
  liveSince = Date.now(); clearInterval(timerId);
  const tick = () => { connTime.textContent = fmtTime(Date.now() - liveSince); };
  tick(); timerId = setInterval(tick, 1000);
}
function stopTimer() { if (connected || twLive) return; clearInterval(timerId); timerId = null; connTime.textContent = '—'; }
function showAlert(text, warn, detail) {
  // сообщение об ошибке выводим в ленте чата, а не под кнопкой
  if (!text) return;
  $('.empty', feed)?.remove();
  feed.querySelectorAll('.msg.notice').forEach((n) => n.remove());
  const el = document.createElement('div');
  el.className = 'msg notice' + (warn ? ' warn' : '');
  const t = document.createElement('div'); t.className = 't'; t.textContent = text; el.appendChild(t);
  if (detail) { const d = document.createElement('div'); d.className = 'alert-detail'; d.textContent = 'Техническая информация: ' + detail; el.appendChild(d); }
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
}
// после отключения статистика эфира обнуляется (онлайн Twitch сбрасывается при отключении Twitch)
function resetStats() {
  counters.likes = counters.gifts = counters.follows = 0;
  ['#sLikes', '#sGifts', '#sFollows'].forEach((i) => bump(i, 0));
  $('#sViewers').textContent = '—';
}
function setStatus(live, text) {
  connected = live;
  if (live) _ttText = text;
  renderPills();
  btn.textContent = live ? 'Отключить' : 'Подключить';
  btn.classList.toggle('connected', live);
  setSt(connStatus, live ? 'В эфире' : 'Не подключено', live ? 'ok' : '');
  if (!live) { setNk(connNick, '—'); stopTimer(); resetStats(); }
}
window.echo.onTwStatus((s) => {
  twLive = s.state === 'live' || s.state === 'reconnect';
  setSt(connTwStatus, s.state === 'live' ? 'Чат подключён' : s.state === 'reconnect' ? 'Переподключение…' : 'Не подключено', s.state === 'live' ? 'ok' : s.state === 'reconnect' ? 'warn' : '');
  if (s.state === 'live') startTimer(); else if (s.state === 'offline') { stopTimer(); $('#sViewersTw').textContent = '—' }
  setNk(connTw, s.state === 'live' ? '#' + s.channel : s.state === 'reconnect' ? 'переподключение…' : '—');
  if (s.state === 'live') {
    twLive = true; btnTw.textContent = 'Отключить'; btnTw.classList.add('connected');
    sys('Twitch: чат ' + s.channel + ' подключён.');
    _twText = '#' + s.channel;
  }
  if (s.state === 'offline' || s.state === 'reconnect') {
    if (s.state === 'offline') { twLive = false; btnTw.textContent = 'Подключить'; btnTw.classList.remove('connected'); }
    else { btnTw.textContent = 'Переподкл…'; }
    if (s.state === 'reconnect') _twText = 'Twitch · переподкл…';
  }
  renderPills(); renderTwViewers();
});
window.echo.onStatus((s) => {
  if (s.state === 'live') { setStatus(true, '@' + s.username); setNk(connNick, '@' + s.username); startTimer(); $('#feedSub').textContent = 'Эфир @' + s.username; }
  else {
    setStatus(false, s.state === 'ended' ? 'Эфир завершён' : 'Не в эфире');
    $('#feedSub').textContent = s.state === 'ended' ? 'Трансляция завершена' : 'Отключено';
    if (s.state === 'ended') sys('Трансляция завершена.');
  }
});

btn.onclick = async () => {
  if (connecting) return;
  connecting = true;
  try {
    if (connected) { await window.echo.disconnect(); return; }
    const nick = $('#nick').value.trim().replace(/^@/, '');
    if (!nick) { showAlert('Введите ник стримера TikTok LIVE (без @).', true); flagField($('#nick')); return; }
    S.nick = nick; save();
    since.tiktok = Date.now();
    btn.textContent = 'Подключаю…'; btn.classList.add('connecting');
    $('#feedSub').textContent = 'Ищем эфир @' + nick;
    counters.likes = counters.gifts = counters.follows = 0;
    ['#sLikes', '#sGifts', '#sFollows'].forEach((i) => bump(i, 0));
    $('#sViewers').textContent = '—';
    if (!twLive) resetEmpty();
    sys(`Ищем активный эфир @${nick}…`);
    warmVoices(); // соединения с сервером озвучки открываются, пока ищется эфир
    const r = await window.echo.connect(nick);
    if (!r || !r.ok) {
      setStatus(false, 'Не в эфире');
      $('#feedSub').textContent = 'Не удалось подключиться';
      // одно понятное сообщение на русском — в ленте чата
      showAlert((r && r.error) || 'Не удалось подключиться к эфиру. Попробуйте снова.', r && (r.code === 'offline' || r.code === 'empty'), r && r.detail);
    } else {
      sys('Подключено! Чат будет озвучен.');
      enqueue({ el: null, say: 'Подключено к эфиру. Озвучка включена.' });
    }
  } catch (e) {
    setStatus(false, 'Не в эфире');
    showAlert('Не удалось подключиться к эфиру. Попробуйте снова.', false, e && e.message ? e.message : String(e));
  } finally {
    connecting = false; btn.classList.remove('connecting');
    if (!connected) btn.textContent = 'Подключить';
  }
};
$('#nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });

/* ---------- обновление по кнопке ---------- */
/* ---------- настройки приложения: хранятся в основном процессе (крестик, трей, автозапуск, автообновление) ---------- */
let AS = { closeMode: 'ask', autoUpdate: true, autostart: false, autostartHidden: true, canTray: false, canAutostart: false };
const CLOSE_OPTS = [{ v: 'ask', label: 'Спрашивать' }, { v: 'tray', label: 'Сворачивать в трей' }, { v: 'quit', label: 'Закрывать программу' }];
const renderClose = makeSelect('closeModeSel', { options: () => CLOSE_OPTS, get: () => AS.closeMode, set: (v) => setApp({ closeMode: v }) });
function renderApp() {
  $('#setWin').hidden = !AS.canTray;
  $('#setRun').hidden = !AS.canAutostart;
  $('#setAutoUpd').checked = !!AS.autoUpdate;
  $('#setAutostart').checked = !!AS.autostart;
  $('#setAutostartHidden').checked = !!AS.autostartHidden;
  $('#setAutostartHidden').closest('.sw').style.opacity = AS.autostart ? '' : '.45';
  $('#setAutostartHidden').disabled = !AS.autostart;
  renderClose();
}
async function setApp(patch) {
  try { AS = { ...AS, ...(await window.echo.appSettingsSet(patch)) }; } catch (_) {}
  renderApp();
}
const appReady = window.echo.appSettings().then((s) => { AS = { ...AS, ...s }; renderApp(); }).catch(() => {});
$('#setAutoUpd').addEventListener('change', (e) => setApp({ autoUpdate: e.target.checked }));
$('#setAutostart').addEventListener('change', (e) => setApp({ autostart: e.target.checked }));
$('#setAutostartHidden').addEventListener('change', (e) => setApp({ autostartHidden: e.target.checked }));

// крестик: окно спрашивает, свернуть в трей или закрыть
const closeBack = $('#closeBack');
async function closeAnswer(action) {
  const remember = action !== 'cancel' && $('#closeRemember').checked;
  closeBack.hidden = true; $('#closeRemember').checked = false;
  try { AS = { ...AS, ...(await window.echo.closeAnswer({ action, remember })) }; renderApp(); } catch (_) {}
}
window.echo.onAskClose(() => { closeBack.hidden = false; $('#closeTray').focus(); });
$('#closeTray').onclick = () => closeAnswer('tray');
$('#closeQuit').onclick = () => closeAnswer('quit');
$('#closeCancel').onclick = () => closeAnswer('cancel');
closeBack.addEventListener('click', (e) => { if (e.target === closeBack) closeAnswer('cancel'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !closeBack.hidden) closeAnswer('cancel'); });

const btnUpd = $('#btnUpdate');
let updReady = false;
const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const UPD_ICON = {
  sync: SVG('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>'),
  ok: SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  down: SVG('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
  open: SVG('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
};
function setUpd(icon, label, spin) {
  btnUpd.innerHTML = (UPD_ICON[icon] || '') + '<span>' + esc(label) + '</span>';
  btnUpd.classList.toggle('spin', !!spin);
}
// строка версии в боковом меню: обновляется при запуске и каждый раз по кнопке обновления
const refreshVer = (note) => window.echo.version().then((v) => { $('#verLine').textContent = 'Версия ' + v + (note ? ' · ' + note : ''); }).catch(() => {});
refreshVer();
// полоска прогресса заполняется цветом под текстом кнопки
const setProgress = (p) => { btnUpd.classList.add('dl'); btnUpd.style.setProperty('--p', Math.max(0, Math.min(100, Number(p) || 0))); };
const clearProgress = () => { btnUpd.classList.remove('dl'); btnUpd.style.removeProperty('--p'); };
window.echo.onUpdateProgress((p) => { setProgress(p); setUpd('down', `Скачиваю… ${p}%`, false); });

// автопроверка: через полминуты после запуска и дальше раз в 6 часов. Устанавливает только по нажатию кнопки
const UPD_EVERY_MS = 6 * 60 * 60 * 1000;
let updChecked = false, autoUpdTried = false;
async function autoCheckUpdate() {
  if (updReady || updChecked || btnUpd.classList.contains('busy')) return;
  let r = null;
  await appReady;
  try { r = await window.echo.checkUpdate(); } catch (_) {}
  if (!r || !r.ok) return; // нет сети — попробуем снова, когда появится интернет, или через 6 часов
  updChecked = true;
  if (!r.available || updReady) return;
  updReady = true;
  btnUpd.classList.add('new');
  setUpd('down', `Обновить до ${r.version}`);
  sys(`Доступна новая версия ${r.version}. Нажми кнопку слева внизу, чтобы обновиться.`);
  if ((r.portable || r.installed) && AS.autoUpdate && !autoUpdTried) { autoUpdTried = true; btnUpd.click(); } // при запуске обновляемся сразу (если не выключено в «Настройках»)
}
setTimeout(autoCheckUpdate, 1500);
setInterval(() => { updChecked = false; autoCheckUpdate(); }, UPD_EVERY_MS);

btnUpd.onclick = async () => {
  if (btnUpd.classList.contains('busy')) return;
  btnUpd.classList.add('busy');
  refreshVer();
  if (!updReady) {
    setUpd('sync', 'Проверяю…', true);
    const r = await window.echo.checkUpdate();
    btnUpd.classList.remove('busy');
    if (!r.ok) { setUpd('sync', 'Проверить обновления'); sys('Не удалось проверить обновления: ' + r.error); return; }
    updChecked = true;
    refreshVer(r.available ? 'доступна ' + r.version : 'актуальна');
    if (r.available) {
      updReady = true;
      btnUpd.classList.add('new');
      setUpd('down', `Обновить до ${r.version}`);
      sys(`Доступна новая версия ${r.version}. Нажми кнопку слева внизу, чтобы обновиться.`);
    } else {
      setUpd('ok', 'Версия актуальна');
      setTimeout(() => { setUpd('sync', 'Проверить обновления'); }, 3000);
    }
    return;
  }
  btnUpd.classList.remove('new'); setProgress(0);
  setUpd('down', 'Скачиваю… 0%', false);
  const r = await window.echo.installUpdate();
  if (!r.ok) {
    btnUpd.classList.remove('busy'); clearProgress(); btnUpd.classList.add('new');
    setUpd('down', 'Повторить');
    sys('Ошибка обновления: ' + r.error);
  } else if (r.manual) {
    btnUpd.classList.remove('busy'); clearProgress(); btnUpd.classList.add('new');
    setUpd('open', 'Страница загрузки');
  } else {
    setProgress(100); setUpd('sync', 'Перезапуск…', false);
  }
};

/* ---------- студия озвучки ---------- */
const studioText = $('#studioText');
function speakStudio() {
  const t = studioText.value.trim();
  if (!t) { studioText.focus(); return; }
  queue.length = 0; stopCurrent();
  enqueue({ el: null, say: t.slice(0, 200), preset: selectedPreset() }, true);
}
$('#btnStudio').onclick = speakStudio;
$$('#chips .chip').forEach((c) => c.onclick = () => { studioText.value = c.textContent; speakStudio(); });

/* ---------- виджет чата ---------- */
// --- выпадающие списки виджета ---
// выравнивание сообщений задаётся отдельно для TikTok и для Twitch
const ALIGN_LABELS = { left: 'Слева', right: 'Справа' };
const alignOpts = () => Object.entries(ALIGN_LABELS).map(([v, label]) => ({ v, label }));
const alignRenders = [
  makeSelect('wAlignTtSel', { options: alignOpts, get: () => curW().tt, set: (v) => { curW().tt = v; save(); onWidgetChanged(); } }),
  makeSelect('wAlignTwSel', { options: alignOpts, get: () => curW().tw, set: (v) => { curW().tw = v; save(); onWidgetChanged(); } }),
];
// вкладки виджетов: переключение, добавление (до 5), удаление, переименование двойным щелчком
const MAX_WIDGETS = 5;
function renderWTabs() {
  const box = $('#wTabs'); box.innerHTML = '';
  S.widgets.forEach((w) => {
    const b = document.createElement('button');
    b.className = 'wtab' + (w.id === S.wSel ? ' sel' : '');
    b.dataset.id = w.id; b.title = 'Двойной щелчок — переименовать';
    const nm = document.createElement('span'); nm.textContent = w.name; b.appendChild(nm);
    b.onclick = () => { if (S.wSel === w.id) return; S.wSel = w.id; save(); renderWTabs(); refreshWidgetUi(); onWidgetChanged(); };
    nm.ondblclick = (e) => {
      e.stopPropagation(); nm.contentEditable = 'true'; nm.focus();
      document.getSelection().selectAllChildren(nm);
      const done = () => { nm.contentEditable = 'false'; w.name = (nm.textContent || '').trim().slice(0, 20) || 'Виджет'; nm.textContent = w.name; save(); };
      nm.onblur = done; nm.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); nm.blur(); } ev.stopPropagation(); };
    };
    if (S.widgets.length > 1 && w.id === S.wSel) {
      const x = document.createElement('i'); x.className = 'wdel'; x.textContent = '✕'; x.title = 'Удалить виджет';
      x.onclick = (e) => { e.stopPropagation(); S.widgets = S.widgets.filter((q) => q.id !== w.id); S.wSel = S.widgets[0].id; save(); renderWTabs(); refreshWidgetUi(); onWidgetChanged(); };
      b.appendChild(x);
    }
    box.appendChild(b);
  });
  if (S.widgets.length < MAX_WIDGETS) {
    const add = document.createElement('button'); add.className = 'wtab add'; add.textContent = '+'; add.title = 'Добавить виджет со своим выравниванием';
    add.onclick = () => {
      // новый виджет получает настройки по умолчанию (выравнивание — как у текущего), а не копию чужих
      const n = S.widgets.length + 1, w = normWidget({ id: 'w' + Date.now().toString(36), name: 'Виджет ' + n, tt: curW().tt, tw: curW().tw }, {});
      S.widgets.push(w); S.wSel = w.id; save(); renderWTabs(); refreshWidgetUi(); onWidgetChanged();
    };
    box.appendChild(add);
  }
}
// ссылка и предпросмотр зависят от выбранного виджета
function onWidgetChanged() { pushWidget(); refreshLink(); reloadPreview(); }
// w — id виджета: по нему страница находит именно его настройки
const widgetQuery = () => '?tt=' + curW().tt + '&tw=' + curW().tw + '&w=' + encodeURIComponent(curW().id);
let pageChecked = false;
async function refreshLink() {
  const r = await window.echo.widgetLink().catch(() => null);
  $('#wUrl').value = r && r.ok ? r.url + widgetQuery() : 'Не удалось запустить сервер виджета';
  if (!pageChecked) { pageChecked = true; checkPage(); }
}
// Опубликована ли страница на GitHub Pages: 404 значит, что Pages в репозитории ещё не включён
const PAGES_SETTINGS = 'https://github.com/vladimirphoto/jonny-chat-tiktok/settings/pages';
async function checkPage() {
  const el = $('#wStat');
  el.className = 'wstat'; el.textContent = ''; el.dataset.state = 'checking';
  const r = await window.echo.widgetCheck().catch(() => ({ ok: false, status: 0 }));
  if (r.ok) { el.dataset.state = 'ok'; return; } // всё в порядке — ничего не показываем
  el.dataset.state = 'bad'; el.className = 'wstat bad';
  el.innerHTML = r.status === 404
    ? 'Страница виджета ещё не опубликована: в репозитории не включён GitHub Pages. Откройте Settings → Pages, выберите ветку <b>main</b> и папку <b>/docs</b>, нажмите Save и подождите минуту.<br><a href="' + PAGES_SETTINGS + '" target="_blank">Открыть настройки Pages</a><a id="wRecheck">Проверить снова</a>'
    : 'Не удалось проверить страницу виджета (нет доступа к интернету или GitHub).<br><a id="wRecheck">Проверить снова</a>';
  const rc = $('#wRecheck'); if (rc) rc.onclick = checkPage;
}
refreshLink();
$('#wUrl').onfocus = (e) => e.target.select();
$('#wCopy').onclick = async () => {
  const u = $('#wUrl').value;
  try { await navigator.clipboard.writeText(u); } catch (_) { $('#wUrl').select(); document.execCommand('copy'); }
  const b = $('#wCopy'), svg = b.querySelector('svg').outerHTML;
  b.innerHTML = svg + '✓'; setTimeout(() => { b.innerHTML = svg + 'Копировать'; }, 1500);
};
// Предпросмотр. Страница виджета грузится в iframe сразу при запуске приложения (а не при первом открытии вкладки),
// а сообщает «готово» только когда уже получила настройки от приложения. Тестовые сообщения показываются
// после этого сигнала и когда вкладка видна, поэтому первое открытие больше не бывает пустым или недорисованным.
const PV_H = 210; // высота «виртуального экрана» предпросмотра: всё содержимое помещается без обрезания
let pvInit = false, pvBase = '', pvReady = false, pvTested = false;
const pvVisible = () => $('#tab-widgets').classList.contains('show');
const pvTest = () => { if (pvReady && pvVisible() && !pvTested) { pvTested = true; window.echo.widgetTest(); } };
// iframe всегда по размеру блока (без CSS-масштабирования — оно в Electron давало недорисованный кадр справа);
// «виртуальный экран» PV_H по высоте создаётся масштабом внутри страницы виджета
let pvK = 1;
function fitPreview() {
  const box = $('.prev-box'), fr = $('#pvFrame');
  const w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return; // вкладка скрыта — подгоним, когда появится
  pvK = Math.min(1, h / PV_H);
  fr.style.width = ''; fr.style.height = ''; fr.style.transform = '';
  try { fr.contentWindow.postMessage({ echochat: 'fit', k: pvK }, '*'); } catch (_) {}
}
async function initPreview() {
  if (pvInit) { fitPreview(); pvTest(); return; }
  pvInit = true;
  pvBase = await window.echo.widgetUrl();
  if (!pvBase) return;
  window.addEventListener('message', (e) => {
    if (e.source !== $('#pvFrame').contentWindow || !e.data || e.data.echochat !== 'ready') return;
    pvReady = true; pushWidget(); fitPreview(); pvTest();
  });
  $('#pvFrame').addEventListener('load', () => { pushWidget(); fitPreview(); });
  if (window.ResizeObserver) new ResizeObserver(fitPreview).observe($('.prev-box'));
  window.addEventListener('resize', fitPreview);
  reloadPreview();
}
// предпросмотр показывает выбранный виджет: страница читает выравнивание и настройки по адресу
function reloadPreview() { if (pvBase) { pvReady = false; pvTested = false; $('#pvFrame').src = pvBase + widgetQuery(); } }
$('#pvTest').onclick = () => { if (pvReady) { pvTested = true; window.echo.widgetTest(); } };
$('#wClear').onclick = () => window.echo.widgetClear();

/* ---------- оверлей чата ---------- */
// Все элементы всегда показывают настоящее состояние: окно можно закрыть крестиком в нём или из трея, замок — нажать в самом окне
function ovShow(st) {
  if (!st) return;
  const on = !!st.on, c = st.settings || {};
  $('#ovToggle').checked = on;
  $('#ovToggleTxt').textContent = on ? 'Включён' : 'Выключен';
  const err = $('#ovErr');
  err.hidden = !st.error; err.textContent = st.error ? 'Не удалось открыть оверлей: ' + st.error : '';
  if (document.activeElement !== $('#ovOpacity') && Number.isFinite(c.opacity)) $('#ovOpacity').value = c.opacity;
  if (Number.isFinite(c.opacity)) $('#ovOpacityVal').textContent = c.opacity + '%';
  [['ovLock', 'locked'], ['ovOnTop', 'onTop'], ['ovJoins', 'joins'], ['ovEvents', 'events'], ['ovHearts', 'hearts'], ['ovStats', 'stats']].forEach(([id, k]) => { if (typeof c[k] === 'boolean') $('#' + id).checked = c[k]; });
  if (typeof c.hotkey === 'string' && !ovCapturing) { ovHotkeyVal = c.hotkey; $('#ovHotkey').textContent = c.hotkey || 'Выключено'; }
  $('#ovHotkeyErr').hidden = !(st.hotkeyBusy && c.hotkey);
}
// горячие клавиши: кнопка записывает следующее нажатое сочетание (глобальное, поэтому пока идёт запись, старое сочетание снимается)
let ovCapturing = false, ovHotkeyVal = 'Ctrl+Alt+I';
const OV_KEYNAME = { Space: 'Space', Tab: 'Tab', Enter: 'Enter', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', NumpadEnter: 'Enter' };
function ovKeyOf(e) {
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(c)) return c;
  return OV_KEYNAME[c] || '';
}
function ovCaptureStop(apply) {
  if (!ovCapturing) return;
  ovCapturing = false;
  document.removeEventListener('keydown', ovCaptureKey, true);
  $('#ovHotkey').classList.remove('on');
  $('#ovHotkey').textContent = ovHotkeyVal || 'Выключено';
  window.echo.overlayHotkeyCapture(false).then(ovShow).catch(() => {});
  if (apply !== undefined) window.echo.overlaySet({ hotkey: apply }).then(ovShow).catch(() => {});
}
function ovCaptureKey(e) {
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') return ovCaptureStop();
  if (e.key === 'Backspace' || e.key === 'Delete') { ovHotkeyVal = ''; return ovCaptureStop(''); }
  const key = ovKeyOf(e);
  if (!key) return; // нажата только Ctrl/Alt/Shift или неподходящая клавиша — ждём дальше
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  if (!mods.length && !/^F\d+$/.test(key)) return; // одиночная буква перехватила бы набор текста везде
  ovHotkeyVal = [...mods, key].join('+');
  ovCaptureStop(ovHotkeyVal);
}
$('#ovHotkey').onclick = () => {
  if (ovCapturing) return ovCaptureStop();
  ovCapturing = true;
  $('#ovHotkey').classList.add('on'); $('#ovHotkey').textContent = 'Нажмите сочетание…';
  window.echo.overlayHotkeyCapture(true).catch(() => {});
  document.addEventListener('keydown', ovCaptureKey, true);
};
$('#ovHotkey').addEventListener('blur', () => ovCaptureStop());
$('#ovHotkeyReset').onclick = () => { ovCaptureStop(); ovHotkeyVal = 'Ctrl+Alt+I'; window.echo.overlaySet({ hotkey: 'Ctrl+Alt+I' }).then(ovShow).catch(() => {}); };
$('#ovToggle').addEventListener('change', async (e) => {
  const r = await window.echo.overlayToggle(e.target.checked).catch(() => null);
  ovShow(r || { on: false, error: 'нет ответа от приложения' });
});
$('#ovTest').onclick = async () => { ovShow(await window.echo.overlayTest().catch(() => null)); };
$('#ovClear').onclick = () => window.echo.overlayClear();
$('#ovReset').onclick = () => window.echo.overlayResetPos();
$('#ovOpacity').addEventListener('input', (e) => { $('#ovOpacityVal').textContent = e.target.value + '%'; window.echo.overlaySet({ opacity: +e.target.value }); });
[['ovLock', 'locked'], ['ovOnTop', 'onTop'], ['ovJoins', 'joins'], ['ovEvents', 'events'], ['ovHearts', 'hearts'], ['ovStats', 'stats']].forEach(([id, k]) => $('#' + id).addEventListener('change', (e) => window.echo.overlaySet({ [k]: e.target.checked })));
window.echo.onOverlayState(ovShow);
window.echo.overlayState().then(ovShow).catch(() => {});

/* ---------- донаты Каспи ---------- */
const K = S.kaspi;
const newToken = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
if (!K.token) { K.token = newToken(); save(); }
const kmoney = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₸';
let kState = { running: false, port: 0, ips: [] };
async function pushDonate() {
  save();
  const r = await window.echo.donateSet({ ...K }).catch(() => null);
  if (r && r.ok) { kState = r; refreshKaspiUi(); }
}
$$('input[data-kk]').forEach((el) => {
  el.checked = !!K[el.dataset.kk];
  el.addEventListener('change', () => {
    K[el.dataset.kk] = el.checked; pushDonate();
    if (!el.checked && el.dataset.kk === 'sound') { dropSrc('donateSound'); soundTest = null; refreshSoundTestUi(); } // выключили — звук обрывается сразу
    if (!el.checked && el.dataset.kk === 'voice') dropSrc('donateVoice');
  });
});
// «Прослушать звук»: пока звук играет, треугольник превращается в две полоски; повторное нажатие останавливает
const SND_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:6px" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const SND_PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align:-2px;margin-right:6px" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
let soundTest = null; // пункт очереди, который сейчас звучит как проба
function refreshSoundTestUi() {
  const on = !!soundTest;
  $('#kSoundIcon').innerHTML = on ? SND_PAUSE : SND_PLAY;
  $('#kSoundLbl').textContent = on ? 'Остановить' : 'Прослушать звук';
  $('#kSoundTest').classList.toggle('active', on);
}
function stopSoundTest() {
  const it = soundTest; if (!it) return;
  soundTest = null; it.cancelled = true;
  const i = queue.indexOf(it); if (i >= 0) queue.splice(i, 1);
  else if (curItem === it) skipPhrase();
  refreshSoundTestUi();
}
$('#kSoundTest').addEventListener('click', () => {
  if (soundTest) return stopSoundTest();
  const item = { el: null, chime: true, src: 'donateSound', onEnd: () => { if (soundTest === item) { soundTest = null; refreshSoundTestUi(); } } };
  soundTest = item; refreshSoundTestUi();
  enqueue(item, true);
});

// свой звук доната: загрузка файла, возврат к колокольчику
function refreshSoundNameUi() {
  $('#kSoundName').textContent = customSound ? 'Сейчас: ' + (K.soundName || 'свой звук') : 'Сейчас: стандартный колокольчик';
  $('#kSoundReset').hidden = !customSound;
}
async function loadCustomSound() {
  const r = await window.echo.donateSoundGet().catch(() => null);
  if (customSound) { URL.revokeObjectURL(customSound.url); customSound = null; }
  if (r && r.ok && r.data) customSound = { url: URL.createObjectURL(new Blob([r.data], { type: r.mime || 'audio/mpeg' })) };
  else if (K.soundName) { K.soundName = ''; save(); }
  refreshSoundNameUi();
}
$('#kSoundPick').addEventListener('click', async () => {
  const r = await window.echo.donateSoundPick().catch(() => null);
  if (!r || r.canceled) return;
  if (!r.ok) { $('#kSoundName').textContent = r.error || 'Не удалось загрузить звук'; return; }
  stopSoundTest();
  K.soundName = r.name || ''; save();
  await loadCustomSound();
});
$('#kSoundReset').addEventListener('click', async () => {
  stopSoundTest();
  await window.echo.donateSoundClear().catch(() => {});
  K.soundName = ''; save();
  await loadCustomSound();
});
loadCustomSound();
bindRange('kDur', 'kDurVal', (v) => v + ' с', () => K.duration, (v) => { K.duration = v; pushDonate(); })();
bindRange('kScale', 'kScaleVal', (v) => v + '%', () => K.scale, (v) => { K.scale = v; pushDonate(); })();
bindRange('kMin', 'kMinVal', (v) => kmoney(v), () => K.minAmount, (v) => { K.minAmount = v; pushDonate(); })();

async function refreshDonateLink() {
  const r = await window.echo.donateLink().catch(() => null);
  $('#dUrl').value = r && r.ok ? r.url : 'Не удалось запустить сервер виджета';
}
// есть сервер (assets/relay-url.txt) — в команду идёт его адрес, телефон тогда работает из любой сети; иначе адрес компьютера в Wi-Fi
const kaspiAddr = () => kState.relayBase ? `${kState.relayBase}/notify.php?token=${K.token}` : `http://${kState.ips[0] || 'IP-компьютера'}:${kState.port || '…'}/kaspi/${K.token}`;
function setKStat(text, tone) { const e = $('#kStat'); e.textContent = text; e.className = 'kstat' + (tone ? ' ' + tone : ''); }
function refreshKaspiUi() {
  $('#kTok').value = K.token || '';
  $('#kBox').hidden = !K.enabled;
  if (!K.enabled) return setKStat('Приём отключён', 'bad');
  $('#kUrl').value = kaspiAddr();
  // лицензия истекла (или Pro нет): так и пишем и предлагаем купить Pro; «нет связи с сервером» — только при настоящем обрыве
  const ls = window.__lic && window.__lic.state;
  if (kState.relayPro || (ls && Array.isArray(ls.locked) && ls.locked.includes('kaspi'))) {
    setKStat(ls && ls.reason === 'trial-ended' ? 'Пробный период закончился. ' : ls && !ls.paid && ls.plan === 'lite' && !ls.reason ? 'Донаты Каспи входят в Pro. ' : 'Лицензия истекла. ', 'bad');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'kbuy'; b.textContent = 'Купить Pro';
    b.onclick = () => window.__lic && window.__lic.buy();
    $('#kStat').appendChild(b);
    return;
  }
  if (kState.relayBase) setKStat(kState.relay === false ? 'Нет связи с сервером, проверьте интернет' : 'Приём включён', kState.relay === false ? 'bad' : 'ok');
  else if (!kState.running) setKStat('Запускаю приём…', '');
  else if (!kState.ips.length) setKStat('Не найдено подключение к локальной сети: подключи компьютер к Wi-Fi или кабелю', 'bad');
  else setKStat('Приём включён' + (kState.ips.length > 1 ? '. Другие адреса компьютера: ' + kState.ips.slice(1).join(', ') : ''), 'ok');
}
async function copyFrom(inputSel, btn, label) {
  const inp = $(inputSel);
  try { await navigator.clipboard.writeText(inp.value); } catch (_) { inp.select(); document.execCommand('copy'); }
  btn.textContent = '✓ Скопировано'; setTimeout(() => { btn.textContent = label; }, 1500);
}
if (window.echo.onKaspiRelay) window.echo.onKaspiRelay((s) => { kState.relay = s.ok; kState.relayPro = s.code === 'pro'; refreshKaspiUi(); });
window.addEventListener('lic-change', () => refreshKaspiUi());
$('#dUrl').onfocus = (e) => e.target.select();
$('#kUrl').onfocus = (e) => e.target.select();
$('#dCopy').onclick = () => copyFrom('#dUrl', $('#dCopy'), 'Копировать');
$('#btnDonateTest').onclick = () => window.echo.donateTest();
// своё окно подтверждения в стиле приложения (вместо системного confirm с заголовком «echochat-live»)
function askConfirm({ title, text, ok = 'Да', cancel = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    const back = $('#cfBack'), yes = $('#cfYes'), no = $('#cfNo'), prev = document.activeElement;
    $('#cfTitle').textContent = title; $('#cfText').textContent = text;
    yes.textContent = ok; no.textContent = cancel;
    $('.cf-box', back).classList.toggle('danger', !!danger);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
    const done = (v) => {
      back.hidden = true; document.removeEventListener('keydown', onKey, true);
      back.onclick = yes.onclick = no.onclick = null;
      if (prev && prev.focus) prev.focus();
      resolve(v);
    };
    document.addEventListener('keydown', onKey, true);
    yes.onclick = () => done(true); no.onclick = () => done(false);
    back.onclick = (e) => { if (e.target === back) done(false); };
    back.hidden = false; no.focus(); // по умолчанию выбрана «Отмена»: случайный Enter ничего не сломает
  });
}
$('#kToken').onclick = async () => {
  if (!await askConfirm({ title: 'Перевыпустить токен?', text: 'Старый токен перестанет работать. Новый токен нужно будет ввести в команде на iPhone.', ok: 'Перевыпустить', danger: true })) return;
  K.token = newToken(); pushDonate(); refreshKaspiUi();
};
let kQrDone = '';
$('#kShortcut').onclick = async () => {
  const r = await window.echo.kaspiShortcut().catch((e) => ({ ok: false, error: String(e && e.message || e) }));
  if (!r || !r.ok) return setKStat('Не получилось: ' + ((r && r.error) || 'нет ответа'), 'bad');
  $('#kQr').innerHTML = r.qr; $('#kScUrl').value = r.url; kQrDone = r.url;
  $('#kScNote').textContent = r.relay && r.manual ? 'Готовой команды нет: в QR адрес приёма. Создайте команду вручную: этот адрес в поле URL, метод POST, тело JSON с полем text = «Входные данные команды».'
    : r.relay ? '' : 'Телефон и компьютер должны быть в одной Wi-Fi сети.';
};
$('#kScUrl').onfocus = (e) => e.target.select();
$('#kTokCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(K.token); } catch (_) { const t = document.createElement('input'); t.value = K.token; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  $('#kTokCopy').textContent = '✓ Скопировано'; setTimeout(() => { $('#kTokCopy').textContent = 'Скопировать токен'; }, 1500);
};
setInterval(() => { const on = kState && (kState.running || kState.relayBase); if (on && !kQrDone) $('#kShortcut').click(); if (kState && !on) kQrDone = ''; }, 1500);
// журнал уведомлений: видно, что пришло с телефона и как приложение это поняло
const klog = $('#kLog');
window.echo.onKaspiLog((l) => {
  $('.empty', klog)?.remove();
  const d = new Date(l.t), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const it = document.createElement('div'); it.className = 'it ' + (l.accepted ? 'ok' : 'no');
  it.innerHTML = `<b>${hm} · ${l.accepted ? esc(l.name) + ' · ' + kmoney(l.amount) : 'Пропущено: ' + esc(l.reason || 'не распознано')}</b><small>${esc(l.raw)}</small>`;
  klog.prepend(it);
  while (klog.children.length > 30) klog.lastChild.remove();
});
// донат пришёл (или нажат тест): строка в ленте и голос
window.echo.onDonate((d) => {
  const el = addMsg({ name: d.name, text: `💸 донат ${kmoney(d.amount)}${d.message ? ' · ' + d.message : ''}`, kind: 'gift', color: '#f14635' });
  if (K.sound) enqueue({ el: null, chime: true, src: 'donateSound' }, true);
  if (K.voice) enqueue({ el, src: 'donateVoice', say: `${speakName(d.name)}, спасибо за донат ${d.amount} тенге`, preset: eventPreset() });
});
// предпросмотр виджета донатов
let dvInit = false;
function fitDonate() {
  const box = $('#dvBox'), fr = $('#dvFrame'), w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  const k = Math.min(1, w / 560, h / 200);
  fr.style.width = Math.ceil(w / k) + 'px'; fr.style.height = Math.ceil(h / k) + 'px';
  fr.style.transform = k === 1 ? '' : 'scale(' + k + ')';
}
// видеоинструкция «Донаты Каспи»: «Установка на айфон». Чтобы заменить, поменяйте ID: в ссылке youtube.com/watch?v=ЭТО_ID
const GUIDE_VIDEO_ID = 'adgkv62-uT8';
let guideInit = false;
async function initGuideVideo() {
  if (guideInit) return;
  guideInit = true; // грузим один раз и только когда вкладку открыли: при старте приложения интернет не тратится
  const base = await window.echo.donateUrl();
  if (!base) return; // локальный сервер не запустился — карточка остаётся скрытой
  $('#guideFrame').src = new URL(base).origin + '/guide?v=' + encodeURIComponent(GUIDE_VIDEO_ID);
  $('#guideCard').hidden = false;
}
async function initDonatePreview() {
  if (dvInit) { fitDonate(); return; }
  dvInit = true;
  const base = await window.echo.donateUrl();
  if (!base) return;
  $('#dvFrame').addEventListener('load', () => { pushDonate(); fitDonate(); });
  if (window.ResizeObserver) new ResizeObserver(fitDonate).observe($('#dvBox'));
  window.addEventListener('resize', fitDonate);
  $('#dvFrame').src = base + '?preview=1'; // предпросмотр показывает донат по центру окошка
}

/* ---------- виджет «Топ лайков» ---------- */
const L = S.likes;
const pushLikesSet = () => { save(); window.echo.likesSet({ ...L }); };
const refreshLCount = bindRange('lCount', 'lCountVal', (v) => String(v), () => L.count, (v) => { L.count = v; pushLikesSet(); fitLikes(); });
// масштаб и выравнивание в приложении не настраиваются: масштаб задаёт OBS/Studio, блок всегда по центру
L.scale = 100; L.align = 'center';
$$('input[data-lk]').forEach((el) => { el.checked = !!L[el.dataset.lk]; el.addEventListener('change', () => { L[el.dataset.lk] = el.checked; pushLikesSet(); }); });
refreshLCount();
async function refreshLikesLink() {
  const r = await window.echo.likesLink().catch(() => null);
  $('#lUrl').value = r && r.ok ? r.url : 'Не удалось запустить сервер виджета';
}
$('#lUrl').onfocus = (e) => e.target.select();
$('#lCopy').onclick = async () => {
  const u = $('#lUrl').value, b = $('#lCopy');
  try { await navigator.clipboard.writeText(u); } catch (_) { $('#lUrl').select(); document.execCommand('copy'); }
  b.textContent = '✓'; setTimeout(() => { b.textContent = 'Копировать'; }, 1500);
};
$('#lTest').onclick = () => window.echo.likesTest();
$('#lClear').onclick = () => window.echo.likesClear();
// предпросмотр: iframe по размеру блока, масштаб, чтобы все квадратики поместились по ширине, задаёт страница виджета
let lkInit = false;
function fitLikes() {
  const box = $('.lk-prev'), fr = $('#lkFrame'), w = box.clientWidth;
  if (!w) return;
  // раскладка фиксированная: 5 в ряду (ширина ряда 640 px в координатах виджета); блоки растягиваем под окно предпросмотра
  const rows = Math.ceil(L.count / 5);
  // 0.9 — чуть меньше, чем влезает, чтобы блоки не упирались в края окна
  const k = 0.9 * Math.min(1.5, w / 640, $('.lk-prev').clientHeight / (rows * 191 + 20));
  try { fr.contentWindow.postMessage({ echochat: 'fit', k: Math.max(0.15, k) }, '*'); } catch (_) {}
}
async function initLikesPreview() {
  if (lkInit) { fitLikes(); return; }
  lkInit = true;
  const base = await window.echo.likesUrl();
  if (!base) return;
  const fr = $('#lkFrame');
  window.addEventListener('message', (e) => { if (e.source === fr.contentWindow && e.data && e.data.echochat === 'likes-ready') { window.echo.likesSet({ ...L }); fitLikes(); window.echo.likesTest(); } });
  fr.addEventListener('load', () => { window.echo.likesSet({ ...L }); fitLikes(); });
  if (window.ResizeObserver) new ResizeObserver(fitLikes).observe($('.lk-prev'));
  fr.src = base;
}

/* ---------- виджет «Топ подарков» ---------- */
const G = S.gifts;
const pushGiftsSet = () => { save(); window.echo.giftsSet({ ...G }); };
const refreshGCount = bindRange('gCount', 'gCountVal', (v) => String(v), () => G.count, (v) => { G.count = v; pushGiftsSet(); fitGifts(); });
G.scale = 100; G.align = 'center';
$$('input[data-gf]').forEach((el) => { el.checked = !!G[el.dataset.gf]; el.addEventListener('change', () => { G[el.dataset.gf] = el.checked; pushGiftsSet(); }); });
refreshGCount();
async function refreshGiftsLink() {
  const r = await window.echo.giftsLink().catch(() => null);
  $('#gUrl').value = r && r.ok ? r.url : 'Не удалось запустить сервер виджета';
}
$('#gUrl').onfocus = (e) => e.target.select();
$('#gCopy').onclick = async () => {
  const u = $('#gUrl').value, b = $('#gCopy');
  try { await navigator.clipboard.writeText(u); } catch (_) { $('#gUrl').select(); document.execCommand('copy'); }
  b.textContent = '✓'; setTimeout(() => { b.textContent = 'Копировать'; }, 1500);
};
$('#gTest').onclick = () => window.echo.giftsTest();
$('#gClear').onclick = () => window.echo.giftsClear();
let gfInit = false;
function fitGifts() {
  const box = $('#gkPrev'), fr = $('#gkFrame'), w = box.clientWidth;
  if (!w) return;
  // раскладка вертикальная: колонка 320 px в координатах виджета, строка 84 px + зазор 14 px
  const k = 0.9 * Math.min(1.5, w / 320, box.clientHeight / (G.count * 98 + 6));
  try { fr.contentWindow.postMessage({ echochat: 'fit', k: Math.max(0.15, k) }, '*'); } catch (_) {}
}
async function initGiftsPreview() {
  if (gfInit) { fitGifts(); return; }
  gfInit = true;
  const base = await window.echo.giftsUrl();
  if (!base) return;
  const fr = $('#gkFrame');
  window.addEventListener('message', (e) => { if (e.source === fr.contentWindow && e.data && e.data.echochat === 'gifts-ready') { window.echo.giftsSet({ ...G }); fitGifts(); window.echo.giftsTest(); } });
  fr.addEventListener('load', () => { window.echo.giftsSet({ ...G }); fitGifts(); });
  if (window.ResizeObserver) new ResizeObserver(fitGifts).observe($('#gkPrev'));
  fr.src = base;
}

/* ---------- оповещения о подписках ---------- */
const A = S.alerts;
A.duration = Math.max(3, Math.min(20, Math.round(+A.duration) || 6));
A.scale = Math.max(50, Math.min(200, Math.round(+A.scale) || 100));
function refreshAlertNamesUi() {
  $('#aImgName').textContent = A.imageName ? 'Сейчас: ' + A.imageName : 'Сейчас: стандартное сердечко';
  $('#aImgReset').hidden = !A.imageName;
  $('#aSoundName').textContent = alertSound ? 'Сейчас: ' + (A.soundName || 'свой звук') : 'Сейчас: стандартный звук';
  $('#aSoundReset').hidden = !alertSound;
}
// приложение сообщает, есть ли файл картинки: если его удалили, подпись не врёт
async function pushAlerts() {
  save();
  const r = await window.echo.alertsSet({ ...A }).catch(() => null);
  if (r && r.ok && r.hasImage === false && A.imageName) { A.imageName = ''; save(); refreshAlertNamesUi(); }
}
$$('input[data-ak]').forEach((el) => {
  el.checked = !!A[el.dataset.ak];
  el.addEventListener('change', () => {
    A[el.dataset.ak] = el.checked; pushAlerts();
    if (!el.checked && el.dataset.ak === 'sound') { dropSrc('alertSound'); alertTest = null; refreshAlertTestUi(); } // выключили — звук обрывается сразу
  });
});
// «Прослушать звук»: как у доната — пока звук играет, треугольник превращается в две полоски; повторное нажатие останавливает
let alertTest = null; // пункт очереди, который сейчас звучит как проба
function refreshAlertTestUi() {
  const on = !!alertTest;
  $('#aSoundIcon').innerHTML = on ? SND_PAUSE : SND_PLAY;
  $('#aSoundLbl').textContent = on ? 'Остановить' : 'Прослушать звук';
  $('#aSoundTest').classList.toggle('active', on);
}
function stopAlertTest() {
  const it = alertTest; if (!it) return;
  alertTest = null; it.cancelled = true;
  const i = queue.indexOf(it); if (i >= 0) queue.splice(i, 1);
  else if (curItem === it) skipPhrase();
  refreshAlertTestUi();
}
$('#aSoundTest').addEventListener('click', () => {
  if (alertTest) return stopAlertTest();
  const item = { el: null, chime: true, alertChime: true, src: 'alertSound', onEnd: () => { if (alertTest === item) { alertTest = null; refreshAlertTestUi(); } } };
  alertTest = item; refreshAlertTestUi();
  enqueue(item, true);
});
// свой звук: файл копируется в папку данных, играет окно приложения
async function loadAlertSound() {
  const r = await window.echo.alertsSoundGet().catch(() => null);
  if (alertSound) { URL.revokeObjectURL(alertSound.url); alertSound = null; }
  if (r && r.ok && r.data) alertSound = { url: URL.createObjectURL(new Blob([r.data], { type: r.mime || 'audio/mpeg' })) };
  else if (A.soundName) { A.soundName = ''; save(); }
  refreshAlertNamesUi();
}
$('#aSoundPick').addEventListener('click', async () => {
  const r = await window.echo.alertsSoundPick().catch(() => null);
  if (!r || r.canceled) return;
  if (!r.ok) { $('#aSoundName').textContent = r.error || 'Не удалось загрузить звук'; return; }
  stopAlertTest();
  A.soundName = r.name || ''; save();
  await loadAlertSound();
});
$('#aSoundReset').addEventListener('click', async () => {
  stopAlertTest();
  await window.echo.alertsSoundClear().catch(() => {});
  A.soundName = ''; save();
  await loadAlertSound();
});
// своя картинка: вместо сердечка. Предпросмотр и OBS получают её сразу
$('#aImgPick').addEventListener('click', async () => {
  const r = await window.echo.alertsImagePick().catch(() => null);
  if (!r || r.canceled) return;
  if (!r.ok) { $('#aImgName').textContent = r.error || 'Не удалось загрузить картинку'; return; }
  A.imageName = r.name || 'своя картинка'; refreshAlertNamesUi(); pushAlerts();
});
$('#aImgReset').addEventListener('click', async () => {
  await window.echo.alertsImageClear().catch(() => {});
  A.imageName = ''; refreshAlertNamesUi(); pushAlerts();
});
bindRange('aDur', 'aDurVal', (v) => v + ' с', () => A.duration, (v) => { A.duration = v; pushAlerts(); })();
bindRange('aScale', 'aScaleVal', (v) => v + '%', () => A.scale, (v) => { A.scale = v; pushAlerts(); })();
async function refreshAlertLink() {
  const r = await window.echo.alertsLink().catch(() => null);
  $('#aUrl').value = r && r.ok ? r.url : 'Не удалось запустить сервер виджета';
}
$('#aUrl').onfocus = (e) => e.target.select();
$('#aCopy').onclick = () => copyFrom('#aUrl', $('#aCopy'), 'Копировать');
$('#aTest').onclick = () => window.echo.alertsTest();
// подписка (или «Тест»): звук оповещения встаёт в очередь раньше голоса «спасибо за подписку»
window.echo.onAlert(() => { if (A.sound) enqueue({ el: null, chime: true, alertChime: true, src: 'alertSound' }, true); });
// предпросмотр: страница виджета в рамке, масштаб подгоняем под окошко
let alInit = false;
function fitAlert() {
  const box = $('#alBox'), fr = $('#alFrame'), w = box.clientWidth, h = box.clientHeight;
  if (!w || !h) return;
  const k = Math.min(1, w / 520, h / 420);
  fr.style.width = Math.ceil(w / k) + 'px'; fr.style.height = Math.ceil(h / k) + 'px';
  fr.style.transform = k === 1 ? '' : 'scale(' + k + ')';
}
async function initAlertPreview() {
  if (alInit) { fitAlert(); return; }
  alInit = true;
  const base = await window.echo.alertsUrl();
  if (!base) return;
  $('#alFrame').addEventListener('load', () => { pushAlerts(); fitAlert(); });
  if (window.ResizeObserver) new ResizeObserver(fitAlert).observe($('#alBox'));
  window.addEventListener('resize', fitAlert);
  $('#alFrame').src = base + '?preview=1'; // в предпросмотре образец плашки висит, пока нет оповещений
}
loadAlertSound();

/* ---------- старт ---------- */
renderWTabs(); renderPills(); renderVoices(); refreshVol(); refreshRate(); refreshPitch(); refreshLen(); refreshWScale(); refreshWHeight(); refreshWFade(); syncControls(); pushWidget(); initPreview(); refreshDonateLink(); pushDonate(); refreshLikesLink(); window.echo.likesSet({ ...L }); refreshGiftsLink(); window.echo.giftsSet({ ...G }); refreshAlertLink(); pushAlerts();
window.echo.voices().then((r) => applyCatalog(r && r.all)).catch(() => {});
window.__echo = { K, UPD_EVERY_MS, get netOnline() { return netOnline; }, get voiceCalls() { return voiceCalls; }, setPauseMs(v) { PAUSE_MS = v; }, setFeedReturnMs(v) { FEED_RETURN_MS = v; }, stopAllVoice() { queue.length = 0; stopCurrent(); }, feedFromBottom, addMsg, get PAUSE_MS() { return PAUSE_MS; }, S, clean, speakName, renderVoices, builtin: BUILTIN, get presets() { return S.presets; }, since, ttPreset, twPreset, eventPreset, setNk };

/* ---------- «Что нового» после обновления ---------- */
const CHANGES = {
  '2.8.1': ['Топ подарков стал вертикальным: список строк сверху вниз, у каждой слева аватарка с номером места, справа ник и число монет. Ликование лидера осталось'],
  '2.8.0': ['Новый виджет «Топ подарков» во вкладке «Виджеты»: такой же, как «Топ лайков», но по подаркам (очки считаются в монетах: цена подарка × количество). Когда кто-то выходит на 1 место, его аватарка слегка подпрыгивает и светится. Есть предпросмотр, кнопка «Тест», сброс и ссылка для OBS и TikTok LIVE Studio'],
  '2.7.1': ['Топ лайков: удар рукой теперь и на 2 месте: кто обогнал соседа и вышел на 2 место, бьёт того, кого вытеснил на 3 место, и его аватарка слегка трясётся'],
  '2.7.0': ['Топ лайков: когда кто-то обгоняет лидера и выходит на 1 место, из его аватарки выскакивает рука и бьёт по аватарке 2 места, а та слегка трясётся. Включается и выключается переключателем «Удар рукой» в настройках топа лайков, кнопка «Тест» показывает удар'],
  '2.6.0': ['Новый виджет «Оповещения» во вкладке «Виджеты»: когда кто-то подписывается, на экране стрима появляется красивая плашка с сердечком, аватаркой, ником и летящими сердечками, и играет звук', 'Оповещения: можно загрузить свою картинку (png, jpg, gif, webp) вместо сердечка и свой звук (mp3, wav, ogg и др., до 5 МБ каждый); есть предпросмотр, кнопки «Тест» и «Прослушать звук», ссылка для OBS и TikTok LIVE Studio'],
  '2.5.3': ['Свой звук доната: между кнопками и названием файла появился отступ, ссылка «Сбросить» стоит в одной строке с названием'],
  '2.5.2': ['Окно «Что нового» прокручивается, кнопка «Закрыть» всегда видна, закрыть можно кликом по пустому месту или клавишей Esc. Кнопки «Прослушать звук» и «Загрузить свой звук» стоят рядом, одного размера, и не меняют размер при нажатии'],
  '2.5.1': ['Обновление: проверка и скачивание больше не зависают, если GitHub не отвечает. Через 15 секунд проверка идёт запасным путём или показывает понятную ошибку, а скачивание, которое встало на 30 секунд, повторяется само'],
  '2.5.0': ['Донаты: можно загрузить свой звук (mp3, wav, ogg и др., до 5 МБ) и вернуть стандартный; на кнопке «Прослушать звук» во время проигрывания вместо треугольника две полоски, повторное нажатие останавливает звук'],
  '2.4.5': ['Обновление по кнопке: при ошибке GitHub (502/503/504) скачивание само повторяется до 5 раз с паузами'],
  '2.4.4': ['Возврат к стабильной версии 2.3.9: офлайн-голоса Silero и автопереключение Edge → Silero из версий 2.4.0–2.4.2 убраны. Значок Sub в оверлее чата теперь без свечения'],
  '2.3.9': ['Оверлей чата: рядом с ником подписчика канала появился значок Sub (в ленте и в нижней строке); у тех, кто не подписан, его нет. Если человек подписался во время эфира, значок появится сразу после подписки'],
  '2.3.8': ['Закрытые разделы: размытие лежит на всей странице сразу (вместе с шапкой и счётчиками), стало сильнее и больше не меняется от слабого к сильному'],
  '2.3.7': ['Закрытые разделы («Виджеты», «Донаты Каспи», «Оверлей чата»): размытие идёт до самых краёв окна и плавно нарастает сверху, без резких границ по краям'],
  '2.3.6': ['Когда пробный период закончился, на закрытых разделах («Виджеты», «Донаты Каспи», «Оверлей чата») больше нет стрелки вниз: из-за неё страница уезжала вниз и кнопка «Открыть Pro» пропадала'],
  '2.3.5': ['Оверлей чата: без эфира рядом с плашкой ОФЛАЙН ничего не показывается (таймер «—» убран)', 'Значок Twitch в счётчиках оверлея белый, как остальной текст'],
  '2.3.4': ['Оверлей чата: горячие клавиши — оверлей открывается и закрывается сочетанием из любой программы (по умолчанию Ctrl+Alt+I); своё сочетание задаётся во вкладке «Оверлей чата» в настройках окна, Backspace выключает его, «По умолчанию» возвращает Ctrl+Alt+I'],
  '2.3.3': ['Оверлей чата: если пролистать ленту вверх, через 5 секунд она сама возвращается к последнему сообщению (пока выделен текст — не мешает)'],
  '2.3.2': ['Оверлей чата: нижняя строка теперь принадлежит чату, а действия зрителей — подарок, репост, лайк и «ник — теперь с нами» — на 5 секунд занимают её вместо чата, пока они на экране, чат стоит на второй строке, потом возвращается на нижнюю', 'Оверлей чата: действия идут по очереди — подарок и репост важнее лайка и «зашёл»; подписки по-прежнему строкой в ленте', 'Оверлей чата: пустого места внизу больше нет — когда действий нет, чат занимает всё окно'],
  '2.3.1': ['Оверлей чата: кто ставит лайки — «ник — поставил(а) лайк» в той же строке внизу, где «кто зашёл» (лайки от одного человека складываются: ×12; «зашёл» не вытесняется лайками первые полторы секунды)'],
  '2.3.0': ['Оверлей чата: «ник — теперь с нами» — одна строка внизу на 5 секунд, новая заменяет прежнюю; в ленте чата эти записи больше не остаются', 'Оверлей чата: в ленте видны подарки с количеством («×5»), репосты эфира и подписки', 'Оверлей чата: лайки — сердечки плавно летят вверх от правого нижнего угла и исчезают (можно отключить в настройках)', 'Оверлей чата: онлайн Twitch теперь со значком Twitch и показывается только при подключённом Twitch и идущем стриме; без него значок убирается'],
  '2.2.3': ['Оверлей чата: вернулась шестерёнка с настройками (прозрачность фона, поверх окон, подарки, входы, счётчики, очистка чата)', 'Оверлей чата: в ленте видно, кто зашёл на эфир («ник — теперь с нами»), и есть счётчик просмотров за весь эфир (значок глаза)', 'Оверлей чата: у онлайна Twitch нет логотипа и он белый, как остальные счётчики; показывается только при подключённом Twitch', 'Оверлей чата: «В угол экрана» больше не сбрасывает размер, который вы выбрали'],
  '2.2.2': ['Донаты Каспи: когда лицензия истекла, вместо «Нет связи с сервером» пишется «Лицензия истекла» и есть кнопка «Купить Pro»', 'Онлайн Twitch от 10 000 показывается коротко: 12K (в приложении и в оверлее чата)', 'Оверлей чата: текст под кнопками во вкладке больше не прилипает к ним'],
  '2.2.1': ['Оверлей чата: замок полностью блокирует окно (нельзя сдвинуть и растянуть), пока его не откроют', 'Оверлей чата: прозрачность убирает только фон, рамка, текст и значки всегда видны полностью; размер всегда 100%', 'Настройки оверлея вынесены в отдельную вкладку «Оверлей чата» под «Донатами Каспи»'],
  '2.2.0': ['Новое: оверлей чата — окно поверх всех окон, как чат в TikTok LIVE Studio: шапка LIVE с таймером, счётчики эфира и лента TikTok и Twitch вместе', 'Включается переключателем во вкладке «Виджеты» и пунктом в меню трея; положение, размер и прозрачность запоминаются'],
  '2.1.8': ['Озвучка: пауза в очереди больше не длится десятки секунд — фраза, которая не озвучилась за 8 секунд, пропускается', 'Озвучка: закреплённые голоса держат три готовых соединения, поэтому пачка сообщений не ждёт рукопожатия', 'Окно: «Свернуть» сворачивает на панель задач, иконка остаётся; в трей — только при закрытии по выбору'],
  '2.1.7': ['Озвучка: голос выбранной карточки прогревается сразу при клике, поэтому после нажатия TikTok/Twitch первая фраза нового голоса (в том числе мужского) идёт без задержки', 'Озвучка: фраза ждёт уже открывающееся соединение вместо того, чтобы открывать второе, а для выбранного голоса всегда держится запасное соединение — пачка фраз подряд не ждёт подключения'],
  '2.1.6': ['Смена голоса: соединение для нового голоса открывается сразу при выборе, поэтому первая фраза новым голосом идёт без задержки'],
  '2.1.5': ['Смена голоса: при выборе нового голоса чата (TikTok, Twitch) или голоса подарков и подписок очередь не дочитывается старым голосом, играющая фраза обрывается, и следующее же сообщение звучит новым голосом'],
  '2.1.4': ['Подарки, подписки и донаты озвучиваются вне очереди чата — сразу после текущей фразы', 'Озвучка: постоянное готовое соединение для выбранных голосов держится всегда (в том числе без подключения к эфиру), мёртвые соединения обнаруживаются заранее, а фразы подарков и подписок не ждут повторной попытки'],
  '2.1.3': ['Исправлено: репост эфира больше не озвучивается как «спасибо за подписку»'],
  '2.1.2': ['Озвучка: убрано ускорение голоса при длинной очереди — скорость всегда как в настройках голоса', 'Озвучка: соединение для голоса подарков и подписок держится постоянно и открывается сразу при смене голоса, без задержки на первой фразе'],
  '2.1.1': ['Озвучка: соединение с сервером голосов теперь постоянное, фразы стартуют быстрее', 'Озвучка: сообщения с символами « & », « < », « > » больше не пропадают', 'Озвучка: при сбое синтеза или воспроизведения фраза пробуется ещё раз, очередь стала длиннее, а при большой очереди голос читает чуть быстрее'],
  '2.1.0': ['Защита: пробный период привязан к компьютеру, переустановка не даёт новых 3 дней', 'Защита: донаты Каспи можно проверять на сервере по лицензии (включается отдельно)'],
  '2.0.12': ['Вкладка «Лицензия»: синяя подсказка про перенос ключа опущена вниз и стоит на одном уровне с кнопкой «Проверить сейчас»'],
  '2.0.11': ['Вкладка «Лицензия»: результат проверки показывается прямо в кнопке «Проверить сейчас» и через несколько секунд возвращается к её названию, блок больше не растягивается'],
  '2.0.10': ['Вкладка «Лицензия»: после окончания пробного периода вместо «Все функции открыты» пишется «Пробный период закончился» и «Действует тариф Lite»'],
  '2.0.9': ['Вкладка «Лицензия»: без ключа показывается «Лицензия Lite» (без зелёной точки и «проверена»), а «Лицензия Pro активна» или «Лицензия Lifetime активна» с зелёной точкой — только после активации ключа'],
  '2.0.8': ['Окно Lifetime: подпись у ввода ключа теперь «Lifetime Pro откроется сразу, перезапуск не нужен»'],
  '2.0.7': ['Тариф Lite: пункт «Настройки и обновления» заменён на «Бесплатные обновления Lite»'],
  '2.0.6': ['Карточка Lifetime и её окно: новые тексты «Lifetime Pro — партнёрская лицензия» (бесплатно за продвижение программы)'],
  '2.0.5': ['Плашка PRO в меню сдвинута чуть правее: не касается слова «Каспи» и не прилипает к границе при наведении'],
  '2.0.4': ['Плашка PRO в меню: у «Виджетов» и «Донатов Каспи» теперь на одной линии по правому краю'],
  '2.0.3': ['Поля ника и канала: первая буква больше не обрезается слева, текст в полях TikTok и Twitch выровнен'],
  '2.0.2': ['Окно оплаты: исправлен номер карты, добавлен шаг «Отправьте чек» перед вводом ключа', 'Вкладка «Лицензия»: карточки статуса и активации ключа теперь одной высоты', 'Плашка PRO в меню больше не прилипает к границе рамки при наведении'],
  '2.0.1': ['Вкладка «Лицензия»: после активации ввод ключа скрыт, а «Проверить сейчас» показывает, что лицензия проверена', 'Плашка PRO в меню, окно покупки с номером карты и копированием, новая анимация активации Pro'],
  '2.0.0': ['Лицензии: 3 дня пробного периода со всеми функциями, затем бесплатный тариф Lite', 'Pro открывает «Виджеты» и «Донаты Каспи», Lifetime даёт Pro навсегда', 'Новая вкладка «Лицензия»: статус, активация ключа и перенос на другой компьютер', 'Без интернета Pro продолжает работать, а лицензия сама перепроверяется при появлении связи'],
  '1.20.4': ['Убран общий выключатель «Озвучка включена» (в окне и в меню значка в трее). Озвучка настраивается по платформам в «Что озвучивать»'],
  '1.20.3': ['Окно снова с обычными кнопками Windows: его можно развернуть на весь экран. Растягивать мышью за края по-прежнему нельзя'],
  '1.20.2': ['Окно: убрана кнопка «развернуть», остались «свернуть» и «закрыть»', 'Twitch: сообщения чата показываются и озвучиваются сразу, без ожидания аватарки (раньше новый зритель мог задержать фразу на несколько секунд, а порядок сообщений мог путаться)'],
  '1.20.1': ['Размер окна теперь фиксированный: его нельзя растянуть или развернуть на весь экран'],
  '1.20.0': ['Значок в трее: общий выключатель озвучки, «Пропустить фразу», быстрые переключатели «Что озвучивать», статус подключения и обновления прямо из меню', 'Новая вкладка «Настройки»: что делает крестик, запуск вместе с Windows (можно сразу в трей), автообновление включается и выключается', 'При закрытии окна программа спрашивает: свернуть в трей или закрыть. Выбор можно запомнить', 'В «Озвучке» появился общий выключатель «Озвучка включена»'],
  '1.19.5': ['Окно при запуске открывается в новом размере (1105×748)'],
  '1.19.4': ['Стрелка «листать» больше не дёргается при переключении вкладок: появляется и гаснет сразу и плавно, без задержки и мигания у границы'],
  '1.19.3': ['«Перед эфиром» больше не пропадает в невысоком окне (страница при необходимости прокручивается)', 'В полях ников TikTok и Twitch работает меню по правой кнопке: вставить, вырезать, копировать', 'Стрелка «листать»: при наведении мягкое свечение становится ярче, без резкой границы'],
  '1.19.2': ['Пауза на странице «Эфир» останавливает только ленту чата: озвучка сообщений, подарков и подписок идёт по настройкам на странице «Озвучка»'],
  '1.19.1': ['Лента чата сама возвращается вниз через 10 секунд после того, как её перестали листать (пока читаешь — новые сообщения её не сдёргивают)', 'Стрелка «можно листать» теперь кнопка: клик плавно опускает страницу до конца'],
  '1.19.0': ['Озвучка: голос для TikTok и Twitch выбирается в карточке голоса — выбери голос и нажми TikTok и/или Twitch', 'Голос подарков и подписок перенесён в «Что озвучивать»; карточка «Голоса платформ» убрана'],
  '1.18.4': ['Озвучка: слева «Что озвучивать», «Голоса платформ» и «Студия озвучки», справа «Мои голоса»'],
  '1.18.2': ['«Перед эфиром» теперь над «Подключением»', 'Раздел «Голос» переименован в «Озвучка»', 'Виджеты: предпросмотр справа от виджетов чата, настройки ниже; «Топ лайков»: настройки слева, предпросмотр с кнопкой «Тест» справа'],
  '1.18.0': ['Топ лайков: упрощён — только бегунок «Сколько показывать» (от 5 до 10) и три переключателя', 'Раскладка фиксированная: по 5 в ряду, всё по центру'],
  '1.17.0': ['Топ лайков: «В ряду» — бегунок от 1 до 10 вместо выбора «по 5 или по 10»', 'Аватарки чуть меньше, предпросмотр слегка меньше и с отступом от краёв'],
  '1.16.0': ['Топ лайков: масштаб и выравнивание убраны из приложения (масштаб задаёт OBS или Studio), блок всегда по центру', 'Выбор «В ряду: по 5 или по 10», блоки в предпросмотре крупнее, ники чуть крупнее', 'Лайки мигают, когда у ника растут', 'Строка версии обновляется по кнопке «Проверить обновления»'],
  '1.14.0': ['Новый виджет «Топ лайков»: 5–10 закруглённых квадратиков с аватарками, никами и числом лайков под ними', 'Количество, масштаб и выравнивание настраиваются, ссылка для OBS и Twitch Studio', 'Предпросмотр чата больше не обрезается справа при нажатии «Тест»'],
  '1.13.3': ['Убрана кнопка «Пропустить» и карточка «Движок озвучки»: озвучка идёт голосами Microsoft Edge', 'Донаты Каспи временно скрыты из меню: готовится сервер приёма, сама функция в приложении сохранена', 'При запуске приложение проверяет обновления и показывает, что нового'],
  '1.13.2': ['Обновление больше не падает с ошибкой «GitHub ответил 403»: приложение берёт версию из запасного источника'],
  '1.12.3': ['Подключение Каспи: шаг 1 — токен виден, копируется и перевыпускается', 'Готовая подписанная команда для iPhone по ссылке iCloud'],
  '1.12.2': ['Пауза ленты чата теперь полный стоп: сообщения не показываются и не озвучиваются, таймер убран'],
  '1.12.1': ['Статус приёма Каспи: красный «Приём отключён», когда тумблер выключен', 'Обновление по кнопке стало надёжнее: берётся последний релиз, где есть EXE', 'Ссылка iCloud на команду для iPhone подхватывается без новой сборки', 'Стрелка прокрутки чуть ниже'],
  '1.12.0': ['Донаты Каспи: переделан экран подключения iPhone за 4 шага', 'Подписанная команда для iPhone: iOS принимает её без «ненадёжных команд»', 'Новые движки озвучки: Piper (офлайн) и Google рядом с Edge', 'Настройки виджета донатов теперь под предпросмотром', 'Мягкая стрелка прокрутки без видимых границ'],
  '1.11.0': ['Донаты Каспи: готовая команда для iPhone — QR-код вместо ручной настройки', 'Токен подключения: копирование и перевыпуск одной кнопкой', 'Тестовые уведомления Каспи без настоящих переводов', 'Кнопка «Очистить» в журнале уведомлений', 'Блок подключения теперь сверху, настройки виджета ниже', 'Стрелка-подсказка прокрутки на странице озвучки', 'Обновление запускается сразу при старте программы'],
};
const vcmp = (a, b) => { const x = String(a).split('.').map((n) => parseInt(n, 10) || 0), y = String(b).split('.').map((n) => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
(async () => {
  try {
    const v = await window.echo.version();
    let seen = ''; try { seen = localStorage.getItem('echo.seenVer') || ''; } catch (_) {}
    if (seen === v) return;
    const markSeen = () => { try { localStorage.setItem('echo.seenVer', v); } catch (_) {} };
    // пропустил несколько версий: показываем изменения всех, что вышли после последней виденной; первый запуск — только текущей
    const vers = Object.keys(CHANGES).filter((k) => vcmp(k, v) <= 0 && (seen ? vcmp(k, seen) > 0 : k === v)).sort((a, b) => vcmp(b, a));
    const list = vers.flatMap((k) => CHANGES[k]).slice(0, 8);
    if (!list.length) return markSeen();
    $('#wnVer').textContent = 'Версия ' + v;
    $('#wnList').innerHTML = list.map((t) => `<li>${esc(t)}</li>`).join('');
    $('#wnBack').hidden = false;
    const closeWn = () => { $('#wnBack').hidden = true; document.removeEventListener('keydown', wnKey); markSeen(); };
    const wnKey = (e) => { if (e.key === 'Escape') closeWn(); };
    $('#wnClose').onclick = closeWn;
    $('#wnBack').onclick = (e) => { if (e.target === e.currentTarget) closeWn(); }; // клик по пустому месту вне окна закрывает
    document.addEventListener('keydown', wnKey);
  } catch (_) {}
})();
$('#kLogClear').onclick = () => { klog.innerHTML = '<div class="empty">Пока ничего не приходило</div>'; };
/* ---------- стрелка «можно листать» на странице озвучки ---------- */
(() => {
  const hint = $('#scrollHint');
  // порог с запасом: включается при >40 px до конца, гаснет при <=12 px — у границы стрелка не мигает
  const upd = () => {
    const tab = document.querySelector('.tab.show'), on = hint.classList.contains('on');
    // на закрытом разделе (конец пробного периода) стрелки нет: прокрутка вниз оттуда не возвращается, и кнопку «Открыть Pro» не достать
    if (tab && tab.classList.contains('is-locked') && tab.scrollTop) tab.scrollTop = 0;
    const more = !!tab && !tab.classList.contains('is-locked') && tab.scrollHeight - tab.scrollTop - tab.clientHeight > (on ? 12 : 40);
    if (more !== on) hint.classList.toggle('on', more);
  };
  // при переключении вкладки состояние обновляется сразу и ещё раз после отрисовки (а не по таймеру): без задержки и «залипания»
  $$('.nav').forEach((b) => b.addEventListener('click', () => { upd(); requestAnimationFrame(upd); }));
  // клик по стрелке — плавно до конца страницы
  $('.sh-btn', hint).addEventListener('click', () => { const tab = document.querySelector('.tab.show'); if (tab) tab.scrollTo({ top: tab.scrollHeight, behavior: 'smooth' }); });
  document.addEventListener('scroll', upd, { passive: true, capture: true });
  window.addEventListener('resize', upd);
  setInterval(upd, 250); // содержимое вкладок дорисовывается само (список голосов, предпросмотры)
  upd();
})();

refreshKaspiUi();
