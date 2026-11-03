const { app, BrowserWindow, ipcMain, shell, net, Menu, Tray, nativeImage, Notification } = require('electron');
const path = require('path');
const ev = require('./events');
const twitch = require('./twitch');
const widget = require('./widget');

// Пакеты могут быть ESM-only — подключаем через динамический import()
const load = async (name) => {
  const m = await import(name);
  return { ...(m.default && typeof m.default === 'object' ? m.default : {}), ...m };
};

const SELFTEST = process.argv.includes('--selftest');
let win = null;
let conn = null;
let tw = null;           // подключение к чату Twitch
let wsrv = null;         // сервер виджета
let wset = {};           // настройки виджета (приходят из окна)
const NAME_COLORS = ['#a78bfa', '#f472b6', '#22d3ee', '#fbbf24', '#34d399', '#818cf8', '#fb7185'];
const colorOf = (s) => NAME_COLORS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % NAME_COLORS.length];
// лицензия (license.js): в тарифе Lite вкладки «Виджеты» и «Донаты Каспи» закрыты — виджеты ничего не получают, донаты не принимаются
let license = null;
const locked = (tab) => !SELFTEST && !!license && license.isLocked(tab);
const wmsg = (m) => !locked('widgets') && wsrv && wsrv.broadcast('msg', m);
// ---- виджет «Топ лайков»: считаем лайки каждого зрителя и отдаём страницам виджета лучших (до 10, сколько показать — решает страница)
const likesBoard = new ev.LikesBoard();
const LIKES_MAX = 10;
let lset = { count: 5, scale: 100, align: 'center', showCount: true, showRank: true, shadow: true };
const clampN = (v, a, b, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
let likesTimer = null;
function pushLikes() { // не чаще раза в 0,4 с: лайки сыплются пачками
  if (likesTimer) return;
  likesTimer = setTimeout(() => { likesTimer = null; if (!locked('widgets')) wsrv && wsrv.broadcast('likes', likesBoard.top(LIKES_MAX)); }, 400);
}
if (process.platform === 'win32') app.setAppUserModelId('live.echochat.app'); // нужен для уведомлений Windows; совпадает с ярлыками установщика

// ---- трей (Windows): «свернуть» прячет окно в трей, озвучка продолжает работать; крестик закрывает приложение, как раньше
let tray = null;
const useTray = process.platform === 'win32' && !SELFTEST;
const startHidden = useTray && process.argv.includes('--hidden'); // запуск вместе с Windows сразу в трей
// один экземпляр: иначе повторный запуск ярлыка, пока приложение в трее, поднял бы второе (с конфликтом порта виджета)
const gotLock = SELFTEST || app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function trayImage() {
  const src = nativeImage.createFromPath(path.join(__dirname, 'src', 'icon.png'));
  const img = nativeImage.createEmpty();
  for (const [size, scaleFactor] of [[16, 1], [24, 1.5], [32, 2]]) {
    img.addRepresentation({ scaleFactor, width: size, height: size, buffer: src.resize({ width: size, height: size, quality: 'best' }).toPNG() });
  }
  return img;
}
// состояние для меню трея: переключатели озвучки приходят из окна, подключения — из событий статуса, обновление — из проверок
const TRAY_KEYS = ['ttChat', 'gifts', 'follows', 'twChat'];
const trayS = { ttChat: true, gifts: true, follows: true, twChat: true };
const trayConn = { tt: 'offline', tw: 'offline' };
const trayUpd = { busy: false, version: '' };
const toast = (body) => { try { if (Notification.isSupported()) new Notification({ title: 'ЭхоЧат LIVE', body, icon: path.join(__dirname, 'src', 'icon.png') }).show(); } catch (_) {} };

function buildTrayMenu() {
  const flag = (key, label) => ({ label, type: 'checkbox', checked: !!trayS[key], click: (it) => send('tray:set', { key, value: it.checked }) });
  const tt = trayConn.tt === 'live' ? 'подключён' : trayConn.tt === 'ended' ? 'эфир завершён' : 'не подключён';
  const status = [{ label: 'TikTok: ' + tt, enabled: false }];
  if (trayConn.tw === 'live') status.push({ label: 'Twitch: подключён', enabled: false });
  else if (trayConn.tw === 'reconnect') status.push({ label: 'Twitch: переподключение…', enabled: false });
  const upd = trayUpd.busy ? { label: 'Обновление…', enabled: false }
    : trayUpd.version ? { label: 'Обновить до ' + trayUpd.version, click: trayInstallUpdate }
    : { label: 'Проверить обновления', click: trayCheckUpdate };
  return Menu.buildFromTemplate([
    { label: 'Открыть ЭхоЧат LIVE', click: showWindow },
    { type: 'separator' },
    ...status,
    { type: 'separator' },
    { label: 'Пропустить текущую фразу', click: () => send('tray:skip') },
    { label: 'Что озвучивать', submenu: [
      flag('ttChat', 'TikTok: сообщения чата'), flag('gifts', 'TikTok: подарки'), flag('follows', 'TikTok: новые подписки'), flag('twChat', 'Twitch: сообщения чата'),
    ] },
    { type: 'separator' },
    upd,
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ]);
}
function rebuildTrayMenu() { if (tray) { try { tray.setContextMenu(buildTrayMenu()); } catch (_) {} } }

async function trayCheckUpdate() {
  if (trayUpd.busy) return;
  trayUpd.busy = true; rebuildTrayMenu();
  try {
    const r = await updater.check();
    trayUpd.version = r.available ? r.version : '';
    toast(r.available ? `Доступна версия ${r.version}. Чтобы обновиться, выбери «Обновить» в меню значка` : `Установлена последняя версия (${r.current})`);
  } catch (err) { toast('Не удалось проверить обновления: ' + String((err && err.message) || err)); }
  trayUpd.busy = false; rebuildTrayMenu();
}
async function trayInstallUpdate() {
  if (trayUpd.busy) return;
  trayUpd.busy = true; rebuildTrayMenu();
  toast(`Скачиваю версию ${trayUpd.version}. Приложение перезапустится само`);
  try {
    const r = await updater.install((p) => send('upd:progress', p));
    if (r && r.manual) toast('Это запуск не из установленной версии: страница загрузки открыта в браузере');
  } catch (err) { toast('Ошибка обновления: ' + String((err && err.message) || err)); }
  trayUpd.busy = false; rebuildTrayMenu();
}
ipcMain.on('tray:state', (_e, st) => {
  if (!st || typeof st !== 'object') return;
  for (const k of TRAY_KEYS) if (typeof st[k] === 'boolean') trayS[k] = st[k];
  rebuildTrayMenu();
});

// ---- настройки приложения: нужны основному процессу до загрузки окна (поведение крестика, автозапуск, автообновление)
const APP_DEFAULTS = { closeMode: 'ask', autoUpdate: true, autostart: false, autostartHidden: true };
const APP_FILE = () => path.join(app.getPath('userData'), 'app-settings.json');
const cleanApp = (o) => {
  const r = {};
  if (o && ['ask', 'tray', 'quit'].includes(o.closeMode)) r.closeMode = o.closeMode;
  for (const k of ['autoUpdate', 'autostart', 'autostartHidden']) if (o && typeof o[k] === 'boolean') r[k] = o[k];
  return r;
};
let appSet = { ...APP_DEFAULTS };
try { appSet = { ...APP_DEFAULTS, ...cleanApp(JSON.parse(require('fs').readFileSync(APP_FILE(), 'utf8'))) }; } catch (_) {}
const saveApp = () => { try { require('fs').writeFileSync(APP_FILE(), JSON.stringify(appSet, null, 2)); } catch (_) {} };
const canAutostart = process.platform === 'win32' && app.isPackaged && !SELFTEST;
const publicApp = () => ({ ...appSet, canTray: useTray && !!tray, canAutostart });
function applyAutostart() {
  if (!canAutostart) return;
  try {
    app.setLoginItemSettings({ openAtLogin: !!appSet.autostart, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: appSet.autostartHidden ? ['--hidden'] : [] });
  } catch (_) {}
}
ipcMain.handle('app:settings:get', () => publicApp());
ipcMain.handle('app:settings:set', (_e, patch) => {
  const c = cleanApp(patch);
  appSet = { ...appSet, ...c };
  saveApp();
  if ('autostart' in c || 'autostartHidden' in c) applyAutostart();
  return publicApp();
});

// ---- крестик: спрашиваем «свернуть в трей или закрыть» (или делаем по сохранённому выбору)
let quitting = false, askPending = false;
app.on('before-quit', () => { quitting = true; });
function onWindowClose(e) {
  if (quitting || !useTray || !tray || appSet.closeMode === 'quit') return; // обычное закрытие
  if (win.webContents.isLoading()) return;
  e.preventDefault();
  if (appSet.closeMode === 'tray') { win.hide(); return; }
  showWindow();
  if (!askPending) { askPending = true; send('app:ask-close'); }
}
ipcMain.handle('app:close-answer', (_e, a) => {
  askPending = false;
  const action = a && a.action;
  if (action !== 'tray' && action !== 'quit') return publicApp(); // «Отмена»
  if (a.remember) { appSet.closeMode = action; saveApp(); }
  if (action === 'tray') { if (win && !win.isDestroyed()) win.hide(); } else app.quit();
  return publicApp();
});

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('ЭхоЧат LIVE');
  rebuildTrayMenu();
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}
app.on('second-instance', showWindow);

function createWindow() {
  // стартовый размер окна (не больше экрана)
  const wa = require('electron').screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1105, wa.width),
    height: Math.min(748, wa.height),
    useContentSize: true,
    minWidth: 1060,
    minHeight: 720,
    show: !SELFTEST && !startHidden,
    backgroundColor: '#0b0b12',
    title: 'ЭхоЧат LIVE',
    icon: path.join(__dirname, 'src', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required', // озвучка стартует без клика в окне
      backgroundThrottling: false, // скрытое окно (в трее) не «засыпает»: очередь озвучки идёт без задержек
    },
  });
  win.setMenu(null);
  if (useTray) win.on('minimize', () => { if (tray) win.hide(); }); // без иконки в трее окно не прячем, иначе его не вернуть
  // окно можно растягивать за края и разворачивать; при запуске всегда 1105×748, меньше 1060×720 уменьшить нельзя (minWidth/minHeight выше)
  win.on('close', onWindowClose);
  win.on('session-end', () => { quitting = true; }); // выключение Windows не блокируем
  // меню по правой кнопке: в полях ввода (ники, ссылки) — вставка, вырезание, копирование; на выделенном тексте — «Копировать»
  win.webContents.on('context-menu', (_e, p) => {
    const f = p.editFlags || {};
    const items = p.isEditable
      ? [{ role: 'cut', label: 'Вырезать', enabled: !!f.canCut }, { role: 'copy', label: 'Копировать', enabled: !!f.canCopy }, { role: 'paste', label: 'Вставить', enabled: !!f.canPaste }, { type: 'separator' }, { role: 'selectAll', label: 'Выделить всё', enabled: !!f.canSelectAll }]
      : (p.selectionText ? [{ role: 'copy', label: 'Копировать' }] : []);
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

const send = (channel, payload) => {
  if ((channel === 'tt:status' || channel === 'tw:status') && payload && payload.state) {
    trayConn[channel === 'tt:status' ? 'tt' : 'tw'] = payload.state; rebuildTrayMenu();
  }
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

async function disconnect() {
  if (conn) {
    const c = conn;
    conn = null;
    try { c.removeAllListeners(); } catch (_) {}
    try { await Promise.race([c.disconnect(), new Promise((r) => setTimeout(r, 3000))]); } catch (_) {}
  }
}

const { explain } = require('./errors');

async function doConnect(rawName) {
  const username = String(rawName || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '').replace(/\/live.*$/i, '');
  if (!username) return { ok: false, code: 'empty', error: 'Введите ник автора.' };
  await disconnect();
  let TikTokLiveConnection, WebcastEvent, ControlEvent;
  try {
    ({ TikTokLiveConnection, WebcastEvent, ControlEvent } = await load('tiktok-live-connector'));
  } catch (err) {
    return { ok: false, code: 'module', error: 'Не удалось загрузить модуль TikTok: ' + String((err && err.message) || err) };
  }
  let c;
  try {
    c = new TikTokLiveConnection(username, {
      processInitialData: false, // «хвост» старых сообщений не нужен — озвучиваем только новое
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: false,
      authenticateWs: false,
      useMobile: false,
      webClientOptions: {},
      wsClientOptions: {},
    });
  } catch (err) {
    return { ok: false, code: 'init', error: 'Не удалось запустить подключение к TikTok: ' + String((err && err.message) || err) };
  }
  conn = c;
  let ready = false;
  let lastErrAt = 0;
  const alive = () => conn === c;
  const EV = ControlEvent || {};

  c.on(WebcastEvent.CHAT || 'chat', (d) => {
    if (!alive()) return;
    const m = ev.chatOf(d);
    send('tt:chat', m);
    if (m.text) wmsg({ platform: 'tiktok', name: m.name, text: m.text, avatar: m.avatar, color: colorOf(m.name) });
  });
  c.on(WebcastEvent.GIFT || 'gift', (d) => {
    if (!alive()) return;
    const g = ev.giftOf(d);
    if (!g.done) return; // серия подарков идёт — считаем один раз, когда она закончилась
    send('tt:gift', g);
    wmsg({ platform: 'tiktok', name: g.name, avatar: g.avatar, color: colorOf(g.name), gift: { name: g.gift, count: g.count, image: g.image } });
  });
  // подписка: событие follow, а если его нет в версии библиотеки — social с признаком подписки
  const seenFollow = new Map();
  const onFollow = (d) => {
    if (!alive()) return;
    const u = ev.userOf(d);
    const key = u.id || u.name, now = Date.now();
    if (seenFollow.has(key) && now - seenFollow.get(key) < 10000) return; // follow и social приходят парой
    seenFollow.set(key, now);
    if (seenFollow.size > 500) seenFollow.clear();
    send('tt:follow', u);
  };
  c.on(WebcastEvent.FOLLOW || 'follow', onFollow);
  c.on(WebcastEvent.SOCIAL || 'social', (d) => { if (ev.isFollowSocial(d)) onFollow(d); });
  c.on(WebcastEvent.LIKE || 'like', (d) => {
    if (!alive()) return;
    send('tt:like', ev.likesOf(d));
    const l = ev.likerOf(d);
    if (likesBoard.add(l, l.count)) pushLikes();
  });
  c.on(WebcastEvent.ROOM_USER || 'roomUser', (d) => {
    if (!alive()) return;
    const count = ev.viewersOf(d);
    if (count !== null) send('tt:viewers', { count });
  });
  c.on(WebcastEvent.STREAM_END || 'streamEnd', () => alive() && send('tt:status', { state: 'ended' }));
  c.on(EV.DISCONNECTED || 'disconnected', () => alive() && send('tt:status', { state: 'offline' }));
  c.on(EV.ERROR || 'error', (e) => {
    if (!alive() || !ready) return; // ошибки подключения показывает сам обработчик ниже — один раз
    if (Date.now() - lastErrAt < 30000) return;
    lastErrAt = Date.now();
    send('tt:error', { message: 'Связь с TikTok нестабильна, пытаемся продолжить…' });
  });

  try {
    const state = await Promise.race([
      c.connect(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 30000)),
    ]);
    if (!alive()) return { ok: false, code: 'cancelled', error: 'Подключение отменено.' };
    ready = true;
    send('tt:status', { state: 'live', username, roomId: state && state.roomId });
    return { ok: true, username };
  } catch (err) {
    if (conn === c) conn = null;
    try { c.removeAllListeners(); c.disconnect().catch(() => {}); } catch (_) {}
    return { ok: false, ...explain(err) };
  }
}

ipcMain.handle('tt:connect', async (_e, rawName) => {
  likesBoard.clear(); wsrv && wsrv.broadcast('likes', []); // новый эфир — таблица с нуля
  try { return await doConnect(rawName); } catch (err) { return { ok: false, ...explain(err) }; }
});

ipcMain.handle('tt:disconnect', async () => {
  await disconnect();
  send('tt:status', { state: 'offline' });
  return { ok: true };
});

// ---------- Голоса ----------
const FALLBACK_VOICES = [
  ['ru-RU-SvetlanaNeural', 'Светлана · русский', 'ru-RU', 'Female'],
  ['ru-RU-DmitryNeural', 'Дмитрий · русский', 'ru-RU', 'Male'],
].map(([id, name, locale, gender]) => ({ id, name, locale, gender }));

let voicesCache = null;
ipcMain.handle('tts:voices', async () => {
  if (voicesCache) return voicesCache;
  let tts = null;
  try {
    const { MsEdgeTTS } = await load('msedge-tts');
    tts = new MsEdgeTTS();
    const list = await Promise.race([
      tts.getVoices(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]);
    const all = (list || []).map((v) => v && v.ShortName).filter(Boolean);
    const voices = (list || []).filter((v) => v && v.ShortName && /^ru-/i.test(v.Locale || v.ShortName) && !/Dariya/i.test(v.ShortName)).map((v) => ({
      id: v.ShortName,
      name: String(v.FriendlyName || v.ShortName).replace(/^Microsoft\s+/, '').replace(/\s*Online \(Natural\)\s*-?\s*/, ' · '),
      locale: v.Locale || '',
      gender: v.Gender || '',
    }));
    if (voices.length >= 2) return (voicesCache = { ok: true, voices, all });
  } catch (_) { /* берём встроенный список */ } finally {
    try { tts && tts.close && tts.close(); } catch (_) {}
  }
  return { ok: false, voices: FALLBACK_VOICES, all: [] };
});

async function edgeSynthOnce(text, voice, rate, pitch, timeoutMs = 8000) {
  let tts = null;
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await load('msedge-tts');
    tts = new MsEdgeTTS();
    const fmt = OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3 || OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
    await tts.setMetadata(voice || 'ru-RU-SvetlanaNeural', fmt);
    const res = await tts.toStream(text, { rate: Number(rate) || 1, pitch: pitch || '+0Hz' });
    const chunks = [];
    await Promise.race([
      new Promise((resolve, reject) => {
        res.audioStream.on('data', (ch) => chunks.push(ch));
        res.audioStream.on('end', resolve);
        res.audioStream.on('close', resolve);
        res.audioStream.on('error', reject);
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('tts timeout')), timeoutMs)),
    ]);
    const buf = Buffer.concat(chunks);
    if (!buf.length) throw new Error('empty audio');
    return buf;
  } finally {
    try { tts && tts.close && tts.close(); } catch (_) {}
  }
}

// Сервер Microsoft иногда отвечает медленно или обрывает поток. Если ответа нет за HEDGE_MS,
// параллельно запускается ещё одна попытка (до 3), берём первую успешную — без многосекундных пауз.
function edgeSynth(text, voice, rate, pitch) {
  const MAX = 3, HEDGE_MS = 2500;
  return new Promise((resolve, reject) => {
    let done = false, started = 0, failed = 0, last, timer;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const launch = () => {
      if (done || started >= MAX) return;
      started++;
      edgeSynthOnce(text, voice, rate, pitch).then((buf) => finish(resolve, buf)).catch((err) => {
        last = err; failed++;
        if (failed >= MAX) finish(reject, last); else launch(); // оборвалось — сразу следующая попытка
      });
      clearTimeout(timer);
      if (started < MAX) timer = setTimeout(launch, HEDGE_MS);
    };
    launch();
  });
}

// выбранный движок и его настройки; ключ Google хранится только здесь и в логи не попадает
const te = require('./tts-engines');
const engFile = () => require('path').join(app.getPath('userData'), 'engines.json');
let engCfg = null;
const engLoad = () => { if (!engCfg) { try { engCfg = JSON.parse(require('fs').readFileSync(engFile(), 'utf8')); } catch (_) { engCfg = {}; } } return engCfg; };
const engSave = () => { try { require('fs').writeFileSync(engFile(), JSON.stringify(engCfg)); } catch (_) {} };
ipcMain.handle('eng:status', () => te.status(app.getPath('userData'), engLoad()));
ipcMain.handle('eng:set', (_e, o) => {
  const c = engLoad();
  if (['edge', 'piper', 'google'].includes(o.engine)) c.engine = o.engine;
  if (o.piperVoice && te.PIPER_VOICES.some((v) => v.id === o.piperVoice)) c.piperVoice = o.piperVoice;
  if (o.googleVoice && te.GOOGLE_VOICES.some((v) => v.id === o.googleVoice)) c.googleVoice = o.googleVoice;
  if (typeof o.googleKey === 'string') c.googleKey = o.googleKey.trim().slice(0, 200);
  engSave(); return te.status(app.getPath('userData'), c);
});
ipcMain.handle('eng:install', async (e, id) => {
  try { await te.install(app.getPath('userData'), id, (p) => { try { e.sender.send('eng:progress', { id, p }); } catch (_) {} }); engLoad().piperVoice = id; engSave(); return { ok: true, status: te.status(app.getPath('userData'), engCfg) }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
// выбор движка (Piper/Google) пока убран из интерфейса: всегда озвучивает Edge, даже если раньше был выбран другой
const ENGINES_ON = false;
ipcMain.handle('tts:synth', async (_e, o) => {
  try {
    const text = String(o.text || '').slice(0, 400);
    if (!text.trim()) return { ok: false, error: 'empty text' };
    const cfg = engLoad();
    if (ENGINES_ON && (cfg.engine === 'piper' || cfg.engine === 'google')) {
      try { const b = cfg.engine === 'piper' ? await te.piperSynth(app.getPath('userData'), cfg, text, o.rate) : await te.googleSynth(cfg, text, o.rate); return { ok: true, audio: b.toString('base64'), chars: text.length }; }
      catch (err) { console.warn('[tts] ' + cfg.engine + ' не сработал, откат на Edge:', String((err && err.message) || err).replace(cfg.googleKey || '\u0000', '***')); }
    }
    const buf = await edgeSynth(text, o.voice, o.rate, o.pitch);
    return { ok: true, audio: buf.toString('base64'), chars: text.length };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// ---------- Twitch (мультистрим) ----------
let twViewersTimer = null;
function stopTwitch() {
  clearInterval(twViewersTimer); twViewersTimer = null;
  if (tw) { try { tw.close(); } catch (_) {} tw = null; }
  send('tw:viewers', { count: null });
}
// онлайн Twitch: опрашиваем раз в 30 секунд, пока канал подключён
function pollTwitchViewers(t) {
  const tick = async () => { const n = await twitch.viewersOf(t.channel); if (tw === t) send('tw:viewers', { count: n }); };
  tick(); twViewersTimer = setInterval(tick, 30000);
}
ipcMain.handle('tw:connect', async (_e, name) => {
  stopTwitch();
  let first = true;
  const t = twitch.connect(name, {
    onStatus: (st) => { if (tw === t) send('tw:status', { state: st, channel: t.channel }); },
    // без await: ни показ, ни озвучка не ждут сеть, и порядок сообщений не нарушается;
    // аватарка берётся из кэша, а у нового человека догружается в фоне — со следующего сообщения она уже есть
    onChat: (m) => {
      if (tw !== t || !m.text) return;
      const avatar = twitch.cachedAvatar(m.id);
      if (!avatar) twitch.avatarOf(m.id).catch(() => {});
      send('tw:chat', { ...m, avatar });
      wmsg({ platform: 'twitch', name: m.name, text: m.text, avatar, color: colorOf(m.name) });
    },
  });
  if (!t.ok) return t;
  tw = t;
  pollTwitchViewers(t);
  return { ok: true, channel: t.channel };
});
ipcMain.handle('tw:disconnect', () => { stopTwitch(); send('tw:status', { state: 'offline' }); return { ok: true }; });

// ---------- Виджет чата для OBS / TikTok LIVE Studio ----------
// адрес для предпросмотра внутри приложения
ipcMain.handle('widget:url', () => (wsrv && wsrv.port ? `http://127.0.0.1:${wsrv.port}/chat` : ''));
// ссылка для копирования: настоящий https-адрес страницы виджета на GitHub Pages (выравнивание добавляет окно приложения)
ipcMain.handle('widget:link', () => (wsrv && wsrv.port ? { ok: true, url: widget.PAGES_URL } : { ok: false, url: '' }));
// Доступна ли страница на GitHub Pages (404 — Pages для репозитория ещё не включён)
ipcMain.handle('widget:check', () => new Promise((resolve) => {
  try {
    const r = require('https').get(widget.PAGES_URL, { timeout: 7000, headers: { 'User-Agent': 'echochat' } }, (res) => { res.resume(); resolve({ ok: res.statusCode === 200, status: res.statusCode }); });
    r.on('timeout', () => { r.destroy(); resolve({ ok: false, status: 0 }); });
    r.on('error', () => resolve({ ok: false, status: 0 }));
  } catch (_) { resolve({ ok: false, status: 0 }); }
}));
ipcMain.handle('widget:set', (_e, s) => { wset = { ...(s || {}) }; wsrv && wsrv.broadcast('settings', wset); return { ok: true }; });
ipcMain.handle('widget:test', () => {
  if (locked('widgets')) return { ok: false, locked: true };
  wmsg({ platform: 'tiktok', name: 'Анна', text: 'Привет из TikTok! Так выглядит чат', color: colorOf('Анна') });
  wmsg({ platform: 'twitch', name: 'Max', text: 'Привет из Twitch!', color: colorOf('Max') });
  wmsg({ platform: 'tiktok', name: 'Игорь', color: colorOf('Игорь'), gift: { name: 'Роза', count: 5 } });
  return { ok: true };
});
ipcMain.handle('likes:set', (_e, s) => {
  s = s || {};
  lset = { count: clampN(s.count, 5, LIKES_MAX, 5),scale: clampN(s.scale, 30, 300, 100), align: ['left', 'center', 'right'].includes(s.align) ? s.align : 'center', showCount: s.showCount !== false, showRank: s.showRank !== false, shadow: s.shadow !== false };
  wsrv && wsrv.broadcast('lsettings', lset);
  return { ok: true };
});
ipcMain.handle('likes:test', () => {
  if (locked('widgets')) return { ok: false, locked: true };
  const names = ['Анна', 'Max', 'Игорь', 'Дина', 'Марат', 'Света', 'Олег', 'Ксюша', 'Тимур', 'Лера'];
  wsrv && wsrv.broadcast('likes', names.map((name, i) => ({ name, avatar: '', likes: Math.max(20, 1200 - i * 97 - i * i * 5) })));
  return { ok: true };
});
ipcMain.handle('likes:clear', () => { likesBoard.clear(); wsrv && wsrv.broadcast('likes', []); return { ok: true }; });
ipcMain.handle('likes:url', () => (wsrv && wsrv.port ? `http://127.0.0.1:${wsrv.port}/likes` : ''));
ipcMain.handle('likes:link', () => (wsrv && wsrv.port ? { ok: true, url: widget.LIKES_PAGES_URL } : { ok: false, url: '' }));
ipcMain.handle('widget:clear', () => { wsrv && wsrv.broadcast('clear', {}); return { ok: true }; });

// ---------- Интернет: проверяем связь, чтобы плашки в шапке горели жёлтым без сети ----------
let netOnline = true, netFails = 0;
async function pingNet() {
  const one = async (u) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 4000);
    try { await fetch(u, { method: 'HEAD', signal: ac.signal, cache: 'no-store' }); return true; } catch (_) { return false; } finally { clearTimeout(t); }
  };
  // любой ответ (даже ошибка сервера) значит, что интернет есть
  const rs = await Promise.all(['https://www.gstatic.com/generate_204', 'https://www.cloudflare.com/cdn-cgi/trace', 'https://api.github.com'].map(one));
  return rs.some(Boolean);
}
const setNet = (v) => { if (v !== netOnline) { netOnline = v; send('net:status', { online: v }); } };
async function netTick() {
  let ok = false;
  try { ok = net.isOnline() && await pingNet(); } catch (_) { ok = false; }
  if (ok) { netFails = 0; setNet(true); } else if (++netFails >= 2 || !net.isOnline()) setNet(false); // два промаха подряд — связи нет
  return netOnline;
}
ipcMain.handle('net:check', () => netTick());
ipcMain.handle('net:state', () => netOnline);

// ---------- Донаты Каспи ----------
const kaspi = require('./kaspi');
let dset = { enabled: true, token: '', minAmount: 0, strict: true, duration: 8, scale: 100, align: 'center', vpos: 'bottom', showMessage: true };
let krx = null, krxP = null;
const donateWidgetSettings = () => ({ duration: dset.duration, scale: dset.scale, align: dset.align, vpos: dset.vpos, showMessage: dset.showMessage });
let lastDon = { key: '', t: 0 };
function handleDonation(d, test = false) {
  if (locked('kaspi')) return { accepted: false, reason: 'раздел доступен в Pro' };
  const don = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(d.name || 'Аноним').slice(0, 40), amount: Math.round(Number(d.amount) || 0), message: String(d.message || '').slice(0, 140), test };
  if (don.amount <= 0) return { accepted: false, reason: 'нет суммы' };
  if (!test) {
    if (don.amount < (Number(dset.minAmount) || 0)) return { accepted: false, reason: `сумма меньше минимальной (${dset.minAmount} ₸)` };
    const key = don.name + '|' + don.amount, now = Date.now();
    if (lastDon.key === key && now - lastDon.t < 20000) return { accepted: false, reason: 'повтор: то же уведомление уже было' }; // уведомление и СМС об одном переводе
    lastDon = { key, t: now };
  }
  wsrv && wsrv.broadcast('donate', don);
  send('kaspi:donate', don);
  return { accepted: true, donation: don };
}
function onKaspiText(text) {
  const p = kaspi.parse(text, { strict: dset.strict !== false });
  const r = p.ok ? handleDonation(p) : { accepted: false, reason: p.reason };
  send('kaspi:log', { t: Date.now(), raw: String(text).slice(0, 220), accepted: !!r.accepted, reason: r.reason || '', name: p.name || '', amount: p.amount || 0 });
  return r;
}
// приём через интернет: телефон шлёт на наш сервер (relay/*.php), приложение забирает оттуда.
// Адрес сервера лежит в assets/relay-url.txt (его можно менять в репозитории без новой сборки, как ссылку на команду).
// Файл пустой — работает только приём по Wi-Fi
const relayMod = require('./relay');
let relayRx = null, relayKey = '', relayOk = null, relayBaseNow = '', relayCache = { t: 0, v: '' };
const firstUrl = (t) => relayMod.normBase(String(t || '').split(/\r?\n/).map((x) => x.trim()).find((x) => /^https?:\/\//i.test(x)) || '');
const relayLocal = () => { try { return firstUrl(require('fs').readFileSync(require('path').join(__dirname, 'assets', 'relay-url.txt'), 'utf8')); } catch (_) { return ''; } };
async function relayServer() {
  if (Date.now() - relayCache.t < 600000) return relayCache.v || relayLocal();
  try {
    const r = await fetch('https://raw.githubusercontent.com/vladimirphoto/jonny-chat-tiktok/main/assets/relay-url.txt', { signal: AbortSignal.timeout(3000) });
    relayCache = { t: Date.now(), v: r.ok ? firstUrl(await r.text()) : '' };
  } catch (_) { relayCache = { t: Date.now() - 540000, v: relayCache.v }; }
  return relayCache.v || relayLocal();
}
async function applyRelay() {
  const base = await relayServer();
  relayBaseNow = relayMod.isHttp(base) ? base : '';
  const want = !!dset.enabled && !!dset.token && !!relayBaseNow;
  const key = want ? relayBaseNow + '|' + dset.token : '';
  if (key === relayKey) return;
  if (relayRx) { relayRx.close(); relayRx = null; }
  relayKey = key; relayOk = null;
  if (want) relayRx = relayMod.startRelay({ getConfig: () => ({ enabled: dset.enabled, token: dset.token, relayUrl: relayBaseNow, licToken: license ? license.rawToken() : '' }), onNotification: onKaspiText, onState: (s) => { relayOk = s; send('kaspi:relay', s); } });
}
async function applyKaspi() {
  await applyRelay();
  const want = !!dset.enabled && !!dset.token;
  if (want && !krx) {
    if (!krxP) krxP = kaspi.startReceiver({ getConfig: () => dset, onNotification: onKaspiText, getShortcut: (host) => buildShortcutFile(host) }).then((r) => { krx = r; krxP = null; return r; });
    await krxP;
  }
  if (!want && krx) { krx.close(); krx = null; }
}
const sc = require('./shortcut');
const qrcode = require('qrcode-generator');
const kaspiHost = () => `${kaspi.lanAddresses()[0] || '127.0.0.1'}:${krx && krx.port ? krx.port : 0}`;
// подписанный шаблон кладётся в сборку на macOS-раннере (iOS не принимает неподписанные команды)
const signedShortcutPath = () => { const fs = require('fs'), path = require('path'); return [path.join(__dirname, 'assets', 'EchoChat-Kaspi.signed.shortcut'), path.join(process.resourcesPath || '', 'app.asar', 'assets', 'EchoChat-Kaspi.signed.shortcut')].find((f) => { try { return fs.statSync(f).size > 100; } catch (_) { return false; } }); };
// вариант без Mac: ссылка iCloud на команду, созданную на iPhone (Apple сама её подписывает) — в assets/shortcut-link.txt
const icloudLinkLocal = () => { try { const t = require('fs').readFileSync(require('path').join(__dirname, 'assets', 'shortcut-link.txt'), 'utf8').trim(); return sc.isICloudLink(t) ? t : ''; } catch (_) { return ''; } };
// ссылку можно обновить прямо в репозитории (assets/shortcut-link.txt), без новой сборки приложения
let remoteLink = { t: 0, v: '' };
const icloudLink = async () => {
  if (Date.now() - remoteLink.t < 600000) return remoteLink.v || icloudLinkLocal();
  try {
    const r = await fetch('https://raw.githubusercontent.com/vladimirphoto/jonny-chat-tiktok/main/assets/shortcut-link.txt', { signal: AbortSignal.timeout(3000) });
    const t = r.ok ? (await r.text()).trim() : '';
    remoteLink = { t: Date.now(), v: sc.isICloudLink(t) ? t : '' };
  } catch (_) { remoteLink = { t: Date.now() - 540000, v: remoteLink.v }; }
  return remoteLink.v || icloudLinkLocal();
};
const buildShortcutFile = async () => { const f = signedShortcutPath(); if (!f) throw new Error('нет подписанной команды'); return { buf: require('fs').readFileSync(f), signed: true }; };
const shortcutUrl = () => `http://${kaspiHost()}/shortcut/${dset.token}/EchoChat-Kaspi.shortcut`;
// адрес команды и QR (SVG) для камеры iPhone; токен наружу не уходит никуда, кроме окна приложения
ipcMain.handle('kaspi:shortcut', async () => {
  // с сервером приёма локальный приёмник по Wi-Fi не нужен: QR можно показать и без него
  if (!relayBaseNow && (!krx || !krx.port)) return { ok: false, error: 'Приём выключен. Включи переключатель выше' };
  const qrOf = (u) => { const q = qrcode(0, 'M'); q.addData(u); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); };
  // есть сервер: QR ведёт на общую команду (assets/shortcut-link.txt), адрес с токеном человек вставляет сам при установке
  // (кнопка «Скопировать адрес»). Токен в QR и в общей ссылке не попадает. Ссылки нет — QR несёт сам адрес, команду собирают вручную
  if (relayBaseNow) {
    const link = await icloudLink();
    const url = link || `${relayBaseNow}/notify.php?token=${dset.token}`;
    return { ok: true, url, qr: qrOf(url), signed: !!link, relay: true, manual: !link };
  }
  const link = await icloudLink(), url = link || shortcutUrl();
  return { ok: true, url, qr: qrOf(url), signed: !!link || !!signedShortcutPath() };
});
// тестовые уведомления в формате Каспи идут через настоящий приёмник: проверяется весь путь
ipcMain.handle('kaspi:sample', async (_e, i) => {
  const smp = sc.TEST_NOTIFICATIONS[Number(i) || 0];
  if (!smp || !krx || !krx.port) return { ok: false, error: 'Приём выключен' };
  return new Promise((resolve) => {
    const rq = require('http').request({ host: '127.0.0.1', port: krx.port, path: '/kaspi/' + dset.token, method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 4000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} resolve({ ok: res.statusCode === 200, accepted: !!j.accepted, reason: j.reason || '', expectReject: !!smp.reject }); });
    });
    rq.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
    rq.end(JSON.stringify({ text: smp.text }));
  });
});
const kaspiState = () => ({ running: !!(krx && krx.port), port: krx ? krx.port : 0, ips: kaspi.lanAddresses(), relay: relayOk ? relayOk.ok : null, relayBase: relayBaseNow });
ipcMain.handle('donate:set', async (_e, s) => {
  dset = { ...dset, ...(s || {}) };
  wsrv && wsrv.broadcast('dsettings', donateWidgetSettings());
  try { await applyKaspi(); } catch (_) {}
  return { ok: true, ...kaspiState() };
});
ipcMain.handle('kaspi:state', () => kaspiState());
ipcMain.handle('donate:url', () => (wsrv && wsrv.port ? `http://127.0.0.1:${wsrv.port}/donate` : ''));
ipcMain.handle('donate:link', () => (wsrv && wsrv.port ? { ok: true, url: widget.DONATE_PAGES_URL } : { ok: false, url: '' }));
// тест: по кругу показывает донаты разной суммы, чтобы увидеть все картинки
const SAMPLES = [
  { name: 'Айдос А.', amount: 500, message: 'Привет из Алматы!' }, { name: 'Анна К.', amount: 1500 },
  { name: 'Марат С.', amount: 3000, message: 'Спасибо за стрим!' }, { name: 'Дина Н.', amount: 7500 },
  { name: 'Тимур Б.', amount: 15000, message: 'Ракета для тебя!' },
];
let sampleI = 0;
ipcMain.handle('donate:test', () => { handleDonation(SAMPLES[sampleI++ % SAMPLES.length], true); return { ok: true }; });
// проверка приёма целиком: приложение само отправляет «уведомление» на свой приёмник, как это сделает телефон
ipcMain.handle('kaspi:probe', () => new Promise((resolve) => {
  if (!krx || !krx.port) return resolve({ ok: false, error: 'Приём выключен. Включи переключатель выше' });
  const amount = 100 * (5 + Math.floor(Math.random() * 40));
  const body = `Перевод. Тест Т. отправил(а) вам ${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`;
  const rq = require('http').request({ host: '127.0.0.1', port: krx.port, path: '/kaspi/' + dset.token, method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, timeout: 4000 }, (res) => {
    let d = ''; res.on('data', (c) => (d += c));
    res.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch (_) {} resolve({ ok: res.statusCode === 200, status: res.statusCode, accepted: !!j.accepted, reason: j.reason || '' }); });
  });
  rq.on('error', (e) => resolve({ ok: false, error: String(e && e.message || e) }));
  rq.on('timeout', () => { rq.destroy(); resolve({ ok: false, error: 'нет ответа' }); });
  rq.end(body);
}));

// ---------- Лицензия: тарифы, пробный период, ключи (license.js; сервер — relay-worker) ----------
const licMod = require('./license');
const readAsset = (name) => { try { return require('fs').readFileSync(path.join(__dirname, 'assets', name)); } catch (_) { return null; } };
const licPub = () => { const b = readAsset('license-pub.txt'); return b ? (String(b).split(/\r?\n/).map((x) => x.trim()).find((x) => /^[A-Za-z0-9_-]{40,50}$/.test(x)) || '') : ''; };
function initLicense() {
  license = new licMod.LicenseManager({ dir: app.getPath('userData'), getServer: relayServer, pub: licPub(), onChange: (st, meta) => send('lic:state', { ...st, justActivated: !!(meta && meta.activated) }) });
  if (!SELFTEST) license.start();
}
// данные экрана покупки: assets/purchase.json (цена, текст, контакт) и assets/pay-qr.png (QR для оплаты) — правятся без изменения кода
function purchaseInfo() {
  let j = {};
  try { j = JSON.parse(String(readAsset('purchase.json') || '{}')); } catch (_) {}
  const qr = readAsset('pay-qr.png');
  const url = String(j.contactUrl || '');
  return {
    price: Number(j.price) || 5000, days: Number(j.days) || 30,
    payNote: String(j.payNote || '').slice(0, 400),
    cardNumber: /^[\d ]{12,23}$/.test(String(j.cardNumber || '')) ? String(j.cardNumber) : '',
    contactLabel: String(j.contactLabel || '').slice(0, 60),
    contactUrl: /^https:\/\//i.test(url) ? url : '',
    qr: qr && qr.length < 2e6 ? 'data:image/png;base64,' + qr.toString('base64') : '',
  };
}
ipcMain.handle('lic:state', () => (license ? license.state() : null));
ipcMain.handle('lic:refresh', () => (license ? license.refresh() : null));
ipcMain.handle('lic:activate', (_e, key) => (license ? license.activate(key) : { ok: false, message: 'Лицензия недоступна' }));
ipcMain.handle('lic:deactivate', () => (license ? license.deactivate() : { ok: false, message: 'Лицензия недоступна' }));
ipcMain.handle('lic:purchase', () => purchaseInfo());

const updater = require('./updater');
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('upd:check', async () => {
  try { const r = await updater.check(); if (r && r.ok && !trayUpd.busy) { trayUpd.version = r.available ? r.version : ''; rebuildTrayMenu(); } return r; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
ipcMain.handle('upd:install', async () => {
  try { return await updater.install((p) => send('upd:progress', p)); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

app.whenReady().then(async () => {
  if (!gotLock) return; // уже запущен другой экземпляр — он покажет своё окно
  try { wsrv = await widget.start(() => wset, 7878, { getDonate: () => donateWidgetSettings(), getLikes: () => ({ settings: lset, top: likesBoard.top(LIKES_MAX) }) }); } catch (_) { wsrv = null; }
  initLicense();
  createWindow();
  if (useTray) { try { createTray(); } catch (_) { tray = null; } }
  if (startHidden && !tray) showWindow(); // трея нет — окно всё равно должно быть видно
  if (appSet.autostart) applyAutostart(); // путь в автозапуске обновляется, если программу переместили или обновили
  if (!SELFTEST) { netTick(); setInterval(netTick, 8000); }
  // прогрев: модуль, DNS и TLS-соединение готовы до первой фразы эфира
  edgeSynth('Привет', 'ru-RU-SvetlanaNeural', 1, '+0Hz').catch(() => {});
  if (SELFTEST) require('./selftest').run(win, app);
});
app.on('window-all-closed', async () => {
  await disconnect();
  stopTwitch();
  try { wsrv && wsrv.close(); } catch (_) {}
  try { krx && krx.close(); } catch (_) {}
  try { license && license.stop(); } catch (_) {}
  app.quit();
});
