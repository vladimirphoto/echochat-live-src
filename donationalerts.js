'use strict';
// DonationAlerts: вход через OAuth (implicit), приём донатов в реальном времени (Centrifugo), настройки виджета.
// Модуль не зависит от Electron, поэтому его можно проверять обычными тестами.
// Документация API: https://www.donationalerts.com/apidoc
const alerts = require('./alerts');

const AUTH_URL = 'https://www.donationalerts.com/oauth/authorize';
const API_URL = 'https://www.donationalerts.com/api/v1';
const WS_URL = 'wss://centrifugo.donationalerts.com/connection/websocket';
const SCOPES = 'oauth-user-show oauth-donation-subscribe';
// Адрес, куда DonationAlerts возвращает человека после входа. Он должен быть записан в настройках приложения
// на https://www.donationalerts.com/application/clients. Само окно входа перехватывает этот адрес и закрывается,
// так что страница по нему нужна только на случай сбоя (docs/da-auth).
const REDIRECT_URI = 'https://vladimirphoto.github.io/jonny-chat-tiktok/da-auth/';

const IMAGE_BASE = 'da-image';
const SOUND_BASE = 'da-sound';

// Картинка доната: «auto» — картинка выбранного шаблона (assets/da), «custom» — загруженная человеком.
const IMAGE_PRESETS = [{ id: 'auto', label: 'Картинка шаблона', art: '' }];
// Готовые звуки: ноты собирает окно приложения (renderer.js), файлов нет. 'custom' — загруженный файл.
const SOUND_PRESETS = [
  { id: 'bell', label: 'Колокольчик' },
  { id: 'coin', label: 'Монетка' },
  { id: 'fanfare', label: 'Фанфары' },
  { id: 'arcade', label: 'Аркада' },
  { id: 'pop', label: 'Поп' },
  { id: 'chime', label: 'Перезвон' },
  { id: 'levelup', label: 'Новый уровень' },
  { id: 'cash', label: 'Касса' },
  { id: 'magic', label: 'Магия' },
  { id: 'tada', label: 'Ура' },
  { id: 'drop', label: 'Капля' },
];
const DESIGNS = alerts.DESIGNS;

// Только для выбора картинки «по сумме» (деньги на экране показываются как пришли): примерный курс к тенге.
const TO_KZT = { KZT: 1, RUB: 6, UAH: 12, BYN: 160, USD: 500, EUR: 550, BRL: 90, TRY: 15 };
const SYMBOLS = { KZT: '\u20b8', RUB: '\u20bd', UAH: '\u20b4', USD: '$', EUR: '\u20ac', BRL: 'R$', TRY: '\u20ba', BYN: 'Br' };

const DEFAULTS = {
  enabled: true, voice: true, sound: true, showMessage: true,
  duration: 8, scale: 100, minAmount: 0, design: 'classic', layout: 'top', textPos: 'below',
  imageKind: 'auto', soundKind: 'bell', imageName: '', soundName: '',
};
const clampN = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

function cleanSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  const imgIds = IMAGE_PRESETS.map((p) => p.id).concat('custom');
  const sndIds = SOUND_PRESETS.map((p) => p.id).concat('custom');
  return {
    enabled: s.enabled !== false,
    voice: s.voice !== false,
    sound: s.sound !== false,
    showMessage: s.showMessage !== false,
    duration: clampN(s.duration, 3, 30, DEFAULTS.duration),
    scale: clampN(s.scale, 50, 200, DEFAULTS.scale),
    minAmount: clampN(s.minAmount, 0, 1000000, 0),
    design: DESIGNS.includes(s.design) ? s.design : 'classic',
    layout: s.layout === 'side' ? 'side' : 'top',
    textPos: s.textPos === 'above' ? 'above' : 'below',
    imageKind: imgIds.includes(s.imageKind) ? s.imageKind : 'auto',
    soundKind: sndIds.includes(s.soundKind) ? s.soundKind : 'bell',
    imageName: String(s.imageName || '').slice(0, 120),
    soundName: String(s.soundName || '').slice(0, 120),
  };
}

// что получает страница виджета: art — готовая картинка-эмодзи (пусто = по сумме), imageV — версия своей картинки (0 = нет)
function widgetSettings(s, imageInfo) {
  const custom = s.imageKind === 'custom' && imageInfo;
  return {
    duration: s.duration, scale: s.scale, showMessage: s.showMessage,
    design: DESIGNS.includes(s.design) ? s.design : 'classic',
    layout: s.layout === 'side' ? 'side' : 'top',
    textPos: s.textPos === 'above' ? 'above' : 'below',
    art: '',
    imageV: custom ? Math.max(1, imageInfo.mtime) : 0,
  };
}

// ---------- вход ----------
const authorizeUrl = ({ clientId, redirectUri = REDIRECT_URI, state }) => AUTH_URL + '?' + new URLSearchParams({
  client_id: String(clientId), redirect_uri: redirectUri, response_type: 'token', scope: SCOPES, state: String(state || ''),
}).toString();

// Адрес, на который DonationAlerts вернул человека: токен лежит в части после «#». Возвращает { ok, token } или { ok:false, error }
function parseRedirect(url, state, redirectUri = REDIRECT_URI) {
  const u = String(url || '');
  if (!u.startsWith(redirectUri)) return { ok: false, notRedirect: true };
  const i = u.indexOf('#');
  const q = new URLSearchParams(i >= 0 ? u.slice(i + 1) : u.split('?')[1] || '');
  if (q.get('error')) return { ok: false, error: q.get('error') === 'access_denied' ? 'Вход отменён' : 'DonationAlerts: ' + (q.get('error_description') || q.get('error')) };
  const token = q.get('access_token');
  if (!token) return { ok: false, error: 'DonationAlerts не вернул токен' };
  if (state && q.get('state') && q.get('state') !== state) return { ok: false, error: 'Ответ не от вашего запроса (state), попробуйте ещё раз' };
  return { ok: true, token, expiresIn: Number(q.get('expires_in')) || 0 };
}

// ---------- донат ----------
// Сообщение канала → то, что умеет приложение. Возвращает null, если это не донат.
function parseDonation(raw) {
  let d = raw;
  if (d && typeof d === 'object' && d.data && typeof d.data === 'object' && d.amount === undefined) d = d.data; // иногда донат лежит ещё на уровень глубже
  if (!d || typeof d !== 'object') return null;
  const amount = Number(d.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (d.name && /merch/i.test(String(d.name))) return null; // продажа товара пока не показываем; донаты и тестовые оповещения с сайта пропускаем дальше
  const currency = String(d.currency || '').toUpperCase().slice(0, 4);
  return {
    id: d.id !== undefined ? String(d.id) : '',
    name: String(d.username || d.name_alias || 'Аноним').trim().slice(0, 40) || 'Аноним',
    amount: Math.round(amount * 100) / 100,
    currency,
    // для сообщения-аудио текста нет: показывать «audio» незачем
    message: d.message_type === 'audio' ? '' : String(d.message || '').slice(0, 300),
  };
}
const symbolOf = (c) => SYMBOLS[c] || c || '';
const kztEquivalent = (amount, currency) => amount * (TO_KZT[currency] || 1);
function formatMoney(amount, currency) {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  const [int, frac] = (whole ? String(Math.round(amount)) : amount.toFixed(2)).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + (frac ? ',' + frac : '') + '\u00a0' + symbolOf(currency);
}
// фраза для озвучки: «Имя, спасибо за донат 500 рублей»
const WORDS = { KZT: 'тенге', RUB: 'рублей', UAH: 'гривен', USD: 'долларов', EUR: 'евро', BYN: 'белорусских рублей', BRL: 'реалов', TRY: 'лир' };
const speakAmount = (amount, currency) => `${Math.abs(amount - Math.round(amount)) < 0.005 ? Math.round(amount) : amount.toFixed(2).replace('.', ',')} ${WORDS[currency] || currency || ''}`.trim();

// ---------- запросы к API ----------
async function apiGet(path, token, fetchImpl = fetch) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 10000);
  try {
    const r = await fetchImpl(API_URL + path, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: ac.signal });
    if (r.status === 401 || r.status === 403) { const e = new Error('Нужно войти заново'); e.code = 'auth'; throw e; }
    if (!r.ok) throw new Error('DonationAlerts ответил ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function fetchUser(token, fetchImpl) {
  const j = await apiGet('/user/oauth', token, fetchImpl);
  const u = j && j.data;
  if (!u || !u.id || !u.socket_connection_token) throw new Error('DonationAlerts не вернул данные профиля');
  return { id: u.id, name: u.name || u.code || '', avatar: u.avatar || '', socketToken: u.socket_connection_token };
}

// ---------- приём в реальном времени ----------
// start({ token, onDonation, onState }) → { stop() }
// Состояния: connecting → live; auth (токен не принят, нужен новый вход); retry (связь пропала, пробуем снова).
function start(opts) {
  const o = { wsUrl: WS_URL, fetchImpl: fetch, ...opts };
  const Centrifuge = o.Centrifuge || require('centrifuge');
  const WebSocketImpl = o.WebSocket || require('ws');
  const seen = new Map(); // id → время: повтор одного и того же доната отсекаем только ненадолго, чтобы повторные тесты с сайта (у них id может совпадать) не пропадали
  let stopped = false, client = null, timer = null, watchdog = null, backoff = 3000;
  const state = (s, extra) => { try { o.onState && o.onState({ state: s, ...(extra || {}) }); } catch (_) {} };

  const kill = () => { clearTimeout(watchdog); watchdog = null; if (client) { try { client.disconnect(); } catch (_) {} client = null; } };
  const later = (ms) => { if (stopped) return; clearTimeout(timer); timer = setTimeout(go, ms); };

  async function go() {
    if (stopped) return;
    kill(); state('connecting');
    let user;
    try { user = await fetchUser(o.token, o.fetchImpl); }
    catch (e) {
      if (stopped) return;
      if (e && e.code === 'auth') { state('auth', { error: 'DonationAlerts не принял вход: войдите заново' }); return; }
      state('retry', { error: String((e && e.message) || e) }); backoff = Math.min(backoff * 2, 60000); return later(backoff);
    }
    if (stopped) return;
    const channel = '$alerts:donation_' + user.id;
    let authFailed = false;
    const c = new Centrifuge(o.wsUrl, {
      websocket: WebSocketImpl,
      // подпись закрытого канала выдаёт сам DonationAlerts по нашему токену
      onPrivateSubscribe: async (ctx, cb) => {
        try {
          const r = await o.fetchImpl(API_URL + '/centrifuge/subscribe', {
            method: 'POST', headers: { Authorization: 'Bearer ' + o.token, 'Content-Type': 'application/json' },
            body: JSON.stringify(ctx.data),
          });
          if (r.status === 401 || r.status === 403) { authFailed = true; cb({ status: 403, data: {} }); state('auth', { error: 'DonationAlerts не принял вход: войдите заново' }); return; }
          if (!r.ok) throw new Error('subscribe ' + r.status);
          cb({ status: 200, data: await r.json() });
        } catch (_) { cb({ status: 500, data: {} }); }
      },
    });
    client = c;
    c.setToken(user.socketToken);
    const sub = c.subscribe(channel);
    sub.on('publish', (ctx) => {
      try { o.onRaw && o.onRaw(ctx && ctx.data); } catch (_) {}
      const d = parseDonation(ctx && ctx.data);
      if (!d) return;
      if (d.id) { const now = Date.now(), t = seen.get(d.id); if (t && now - t < 15000) return; seen.set(d.id, now); if (seen.size > 200) seen.delete(seen.keys().next().value); }
      try { o.onDonation && o.onDonation(d); } catch (_) {}
    });
    sub.on('subscribe', () => { backoff = 3000; clearTimeout(watchdog); watchdog = null; state('live', { user: { id: user.id, name: user.name, avatar: user.avatar } }); });
    // связь пропала: библиотека сама пробует вернуться, но токен соединения мог устареть — через 25 с начинаем заново со свежим
    c.on('disconnect', () => {
      if (stopped || authFailed || watchdog) return;
      state('retry');
      watchdog = setTimeout(() => { watchdog = null; if (!stopped && !authFailed) { backoff = Math.min(backoff * 2, 60000); go(); } }, 25000);
    });
    c.on('error', () => {});
    c.connect();
    // не дождались подписки на канал — пробуем заново
    watchdog = setTimeout(() => { watchdog = null; if (!stopped && !authFailed) { backoff = Math.min(backoff * 2, 60000); go(); } }, 30000);
  }
  go();
  return { stop() { stopped = true; clearTimeout(timer); kill(); } };
}

module.exports = {
  AUTH_URL, API_URL, WS_URL, SCOPES, REDIRECT_URI, IMAGE_BASE, SOUND_BASE, IMAGE_PRESETS, SOUND_PRESETS, DESIGNS, DEFAULTS, SYMBOLS, TO_KZT,
  cleanSettings, widgetSettings, authorizeUrl, parseRedirect, parseDonation, formatMoney, speakAmount, symbolOf, kztEquivalent, fetchUser, start,
};
