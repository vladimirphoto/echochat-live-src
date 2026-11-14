const { app, BrowserWindow, ipcMain, dialog, shell, net, Menu, Tray, nativeImage, Notification, screen, globalShortcut, session, systemPreferences } = require('electron');
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
let lset = { count: 5, scale: 100, align: 'center', showCount: true, showRank: true, shadow: true, punch: true };
const clampN = (v, a, b, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
let likesTimer = null, likesTestTimer = null;
function pushLikes() { // не чаще раза в 0,4 с: лайки сыплются пачками
  if (likesTimer) return;
  likesTimer = setTimeout(() => { likesTimer = null; if (!locked('widgets')) wsrv && wsrv.broadcast('likes', likesBoard.top(LIKES_MAX)); }, 400);
}

// ---- виджет «Топ подарков»: очки = цена подарка в монетах × количество; обнуляется с новым эфиром
const giftsBoard = new ev.GiftsBoard();
let gset = { count: 5, scale: 100, align: 'center', showCount: true, showRank: true, shadow: true, celebrate: true };
let giftsTimer = null, giftsTestTimer = null;
function pushGifts() {
  if (giftsTimer) return;
  giftsTimer = setTimeout(() => { giftsTimer = null; if (!locked('widgets')) wsrv && wsrv.broadcast('gifts', giftsBoard.top(LIKES_MAX)); }, 400);
}

// ---- оверлей чата: отдельное окно поверх всех окон (как окно чата в TikTok LIVE Studio) с чатом TikTok + Twitch, счётчиками и таймером.
// Его питают те же события, что и главное окно (см. send ниже): модель считает счётчики всегда, поэтому оверлей, включённый посреди эфира, сразу показывает верные цифры.
// Включается и выключается переключателем во вкладке «Виджеты» и пунктом в меню трея. Как и виджеты, входит в тариф Pro.
const ovMod = require('./overlay');
let ovWin = null, ovSet = { ...ovMod.DEFAULTS }, ovBounds = null, ovSaveT = null, ovKnown = [];
const OV_FILE = () => path.join(app.getPath('userData'), 'overlay.json');
try { const j = JSON.parse(require('fs').readFileSync(OV_FILE(), 'utf8')); ovSet = ovMod.cleanSettings(j && j.settings); ovBounds = (j && j.bounds) || null; ovKnown = Array.isArray(j && j.known) ? j.known : []; } catch (_) {}
// known — кто подписывался на канал в прошлых эфирах: хранится в overlay.json, от этого ник в чате розово-фиолетовый
const ovModel = new ovMod.OverlayModel({ color: colorOf, known: ovKnown, onKnown: () => ovSave() });
const ovOpen = () => !!(ovWin && !ovWin.isDestroyed());
const ovPublic = (on) => ({ on: on === undefined ? ovOpen() : !!on, settings: ovSet, locked: locked('widgets'), hotkeyBusy: ovHotkeyBusy });
// Глобальное сочетание клавиш: открывает и закрывает оверлей из любой программы (в том числе из игры в оконном режиме).
// ovHotkeyBusy — сочетание не удалось занять (его уже держит другая программа), в настройках показывается подсказка
let ovHotkeyBusy = false, ovHotkeyReg = '';
function ovHotkeyOff() { if (ovHotkeyReg) { try { globalShortcut.unregister(ovHotkeyReg); } catch (_) {} ovHotkeyReg = ''; } }
function ovHotkeyOn() {
  ovHotkeyOff(); ovHotkeyBusy = false;
  const k = ovSet.hotkey;
  if (!k || SELFTEST) return;
  try {
    const ok = globalShortcut.register(k, () => {
      const r = setOverlay(!ovOpen());
      if (r.locked) toast('Оверлей чата входит в тариф Pro');
      else if (!r.ok) toast('Не удалось открыть оверлей чата');
    });
    if (ok) ovHotkeyReg = k; else ovHotkeyBusy = true;
  } catch (_) { ovHotkeyBusy = true; }
}
function ovSave() {
  clearTimeout(ovSaveT);
  ovSaveT = setTimeout(() => { try { require('fs').writeFileSync(OV_FILE(), JSON.stringify({ settings: ovSet, bounds: ovBounds, known: Array.from(ovModel.known) })); } catch (_) {} }, 300);
}
// событие приложения → модель → окно оверлея (если оно открыто)
function ovTrack(channel, payload) {
  let r;
  try { r = ovModel.track(channel, payload); } catch (_) { return; }
  if (r.pinCleared) pinApply(null); // эфир закончился — закреп снимается везде: в виджете на стриме и в оверлее
  if (!ovOpen()) return;
  const wc = ovWin.webContents;
  if (r.stats) wc.send('ov:stats', ovModel.stats());
  if (r.entry) wc.send('ov:msg', r.entry);
  if (r.like) wc.send('ov:like', { count: r.like }); // лайки: сердечки в окне, в историю ленты не попадают
  if (r.join) wc.send('ov:join', r.join); // кто зашёл: временная строка внизу, в историю ленты не попадает
  if (r.liker) wc.send('ov:liker', r.liker); // кто лайкает: та же строка внизу
  if (r.pinCleared) wc.send('ov:pin', null); // эфир закончился — закреплённое сообщение снимается
}
// применить настройки к окну; echo=false — не отправлять их обратно окну, которое их само и прислало (иначе ползунок «дёргается»)
function ovApply(echo = true) {
  if (!ovOpen()) return;
  try { ovWin.setAlwaysOnTop(!!ovSet.onTop, 'screen-saver'); } catch (_) {}
  // прозрачность относится только к фону и применяется в самой странице (CSS), окно целиком всегда непрозрачное
  try { ovWin.setMovable(!ovSet.locked); } catch (_) {} // замок: окно нельзя сдвинуть (растягивание отключается в странице)
  if (echo) ovWin.webContents.send('ov:settings', ovSet);
}
// переключатель в приложении и пункт трея всегда показывают настоящее состояние
function ovNotify(on) { send('overlay:state', ovPublic(on)); rebuildTrayMenu(); }
function ovUpdate(patch, echo = true) {
  const was = ovSet.hotkey;
  ovSet = ovMod.cleanSettings(patch, ovSet);
  if (ovSet.hotkey !== was) ovHotkeyOn();
  ovSave(); ovApply(echo); ovNotify();
  return ovPublic();
}
function openOverlay() {
  if (ovOpen()) { try { ovWin.showInactive(); } catch (_) {} return; }
  const b = ovMod.fitBounds(ovBounds, screen.getAllDisplays().map((d) => d.workArea)) || ovMod.defaultBounds(screen.getPrimaryDisplay().workArea);
  const w = new BrowserWindow({
    ...b,
    minWidth: ovMod.SIZE.minW, minHeight: ovMod.SIZE.minH,
    // окно прозрачное: фон рисует страница с настраиваемой прозрачностью. Размер меняется своими ручками по краям (у прозрачных окон Windows нативное растягивание не работает)
    show: false, frame: false, transparent: true, hasShadow: false, resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
    backgroundColor: '#00000000',
    title: 'ЭхоЧат LIVE — оверлей чата', // это имя окна видно в OBS («Захват окна»)
    icon: path.join(__dirname, 'src', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // окно под игрой или за другими окнами продолжает обновляться
    },
  });
  ovWin = w;
  w.setMenu(null);
  w.on('page-title-updated', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.on('did-finish-load', () => ovApply());
  w.once('ready-to-show', () => {
    if (w.isDestroyed()) return;
    ovApply();
    w.showInactive(); // не отбираем фокус у игры или TikTok LIVE Studio
    // положение и размер запоминаются, когда окно уже показано (а не пока оно создаётся)
    const keep = () => { if (!w.isDestroyed() && !w.isMinimized()) { ovBounds = w.getBounds(); ovSave(); } };
    w.on('move', keep); w.on('resize', keep);
  });
  w.on('closed', () => { if (ovWin === w) { ovWin = null; ovNotify(); } });
  w.loadFile(path.join(__dirname, 'src', 'overlay.html'));
}
function closeOverlay() { if (ovOpen()) { try { ovWin.close(); } catch (_) {} } }
function setOverlay(on) {
  if (on) {
    if (locked('widgets')) return { ok: false, ...ovPublic(false) };
    try { openOverlay(); } catch (err) { ovWin = null; return { ok: false, error: String((err && err.message) || err), ...ovPublic(false) }; }
  } else closeOverlay();
  ovNotify(!!on);
  return { ok: true, ...ovPublic(!!on) };
}
// окно оверлея обращается только за своим: чужие окна эти каналы не используют
const fromOv = (e) => ovOpen() && e.sender === ovWin.webContents;
ipcMain.handle('ov:state', (e) => (fromOv(e) ? { settings: ovSet, stats: ovModel.stats(), feed: ovModel.feed(), pin: ovModel.getPin() } : null));
// Закрепление сообщения. Закрепить можно из окна оверлея (точки «⋯» у ника, когда замок открыт).
// Модель хранит закреп и срок, а pinApply рассылает итог всем: виджету на стриме (OBS, TikTok LIVE Studio), и окну оверлея
let pinT = null;
function pinApply(p) {
  clearTimeout(pinT); pinT = null;
  if (wsrv && !locked('widgets')) wsrv.broadcast('pin', p || null);
  if (ovOpen()) { try { ovWin.webContents.send('ov:pin', p || null); } catch (_) {} }
  // срок вышел — модель сама отдаёт null; все окна и виджет получают это же (страница при этом снимает закреп и сама по времени)
  if (p && p.until) pinT = setTimeout(() => { pinT = null; if (!ovModel.getPin()) pinApply(null); }, Math.max(0, p.until - Date.now()) + 300);
}
ipcMain.handle('ov:pin', (e, entry, mins) => {
  if (!fromOv(e)) return null;
  const p = ovModel.setPin(entry, mins);
  pinApply(p);
  return p;
});
ipcMain.handle('ov:unpin', (e) => { if (!fromOv(e)) return false; ovModel.clearPin(); pinApply(null); return true; });
// из самого окна (замок и шестерёнка) настройки меняются так же, как во вкладке «Оверлей чата» главного окна: обе стороны видят одно и то же
ipcMain.handle('ov:set', (e, patch) => (fromOv(e) ? ovUpdate(patch, false).settings : null));
// растягивание окна за края: страница присылает смещение курсора, окно меняет размер (при замке — никак)
let ovGrip = null;
ipcMain.on('ov:grip', (e, m) => {
  if (!fromOv(e) || !m || typeof m !== 'object') return;
  if (m.phase === 'end' || ovSet.locked) { ovGrip = null; return; }
  if (m.phase === 'start') { ovGrip = ovWin.getBounds(); return; }
  if (!ovGrip || !/^[nsew]{1,2}$/.test(String(m.dir))) return;
  const dx = Number(m.dx) || 0, dy = Number(m.dy) || 0, b = ovGrip, d = String(m.dir), S = ovMod.SIZE;
  const width = Math.min(S.maxW, Math.max(S.minW, Math.round(b.width + (d.includes('e') ? dx : d.includes('w') ? -dx : 0))));
  const height = Math.min(S.maxH, Math.max(S.minH, Math.round(b.height + (d.includes('s') ? dy : d.includes('n') ? -dy : 0))));
  const x = d.includes('w') ? b.x + b.width - width : b.x, y = d.includes('n') ? b.y + b.height - height : b.y;
  try { ovWin.setBounds({ x, y, width, height }); } catch (_) {}
});
ipcMain.handle('ov:clear', (e) => { if (!fromOv(e)) return false; ovClear(); return true; });
ipcMain.on('ov:close', (e) => { if (fromOv(e)) closeOverlay(); });
function ovClear() { ovModel.clearFeed(); if (ovOpen()) ovWin.webContents.send('ov:clear-feed'); }
// из главного окна приложения
ipcMain.handle('overlay:state', () => ovPublic());
ipcMain.handle('overlay:toggle', (_e, on) => setOverlay(!!on));
ipcMain.handle('overlay:set', (_e, patch) => ovUpdate(patch));
// пока человек в настройках записывает новое сочетание, старое не должно срабатывать (иначе его не нажать повторно)
ipcMain.handle('overlay:hotkey-capture', (_e, on) => { if (on) ovHotkeyOff(); else ovHotkeyOn(); ovNotify(); return ovPublic(); });
ipcMain.handle('overlay:clear', () => { ovClear(); return { ok: true }; });
ipcMain.handle('overlay:reset-pos', () => {
  // «В угол экрана» двигает окно, но размер остаётся тем, который выбрал пользователь
  const area = screen.getPrimaryDisplay().workArea;
  const cur = ovOpen() ? ovWin.getBounds() : ovBounds;
  const b = cur ? ovMod.cornerBounds(area, cur) : ovMod.defaultBounds(area);
  ovBounds = b; ovSave();
  if (ovOpen()) { try { ovWin.setBounds(b); } catch (_) {} }
  return { ok: true };
});
// «Тест»: показывает примеры (открывает оверлей, если он выключен). В историю они не попадают: исчезают при очистке и перезапуске окна
ipcMain.handle('overlay:test', () => {
  const r = setOverlay(true);
  if (!r.ok) return r;
  const play = () => ovMod.SAMPLE.forEach((s, i) => setTimeout(() => {
    if (ovOpen()) ovWin.webContents.send('ov:msg', { ...s, id: -(i + 1), t: Date.now(), avatar: '', color: colorOf(s.name) });
  }, i * 350));
  // только что созданное окно ещё грузится: ждём страницу, иначе первые примеры потеряются
  if (ovWin.webContents.isLoading()) ovWin.webContents.once('did-finish-load', () => setTimeout(play, 200)); else play();
  return r;
});

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
    { label: 'Оверлей чата', type: 'checkbox', checked: ovOpen(), click: (it) => {
      const r = setOverlay(it.checked);
      if (r.locked) toast('Оверлей чата входит в тариф Pro');
      else if (!r.ok) toast('Не удалось открыть оверлей чата');
      rebuildTrayMenu(); // пункт всегда показывает настоящее состояние
    } },
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
app.on('before-quit', () => { quitting = true; ovHotkeyOff(); try { edgePool.close(); } catch (_) {} });
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
    height: Math.min(920, wa.height), // выше прежних 800: внизу меню целиком видна строка с версией и жуком (баг-репорт)
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
  // «Свернуть» — обычное сворачивание на панель задач (иконка остаётся); в трей прячется только при закрытии, по выбору пользователя
  // окно можно растягивать за края и разворачивать; при запуске всегда 1105×920, меньше 1060×720 уменьшить нельзя (minWidth/minHeight выше)
  win.on('close', onWindowClose);
  win.on('closed', () => { closeOverlay(); closeAvatar(); }); // главное окно закрыто (выход) — оверлей закрывается вместе с ним, иначе приложение не завершилось бы
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
  ovTrack(channel, payload); // оверлей чата получает те же события, что и главное окно
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
    if (giftsBoard.add(g, ev.giftScore(g))) pushGifts();
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
    fireAlert(u); // плашка на экране стрима; раньше tt:follow, чтобы звук оповещения звучал перед голосом «спасибо за подписку»
    send('tt:follow', u);
  };
  // репост эфира: событие share, а если его нет в версии библиотеки — social с признаком репоста (оба могут прийти парой)
  const seenShare = new Map();
  const onShare = (d) => {
    if (!alive()) return;
    const u = ev.userOf(d);
    const key = u.id || u.name, now = Date.now();
    if (seenShare.has(key) && now - seenShare.get(key) < 10000) return;
    seenShare.set(key, now);
    if (seenShare.size > 500) seenShare.clear();
    send('tt:share', u);
  };
  c.on(WebcastEvent.FOLLOW || 'follow', (d) => { if (ev.isShareSocial(d)) onShare(d); else onFollow(d); }); // репост — не подписка
  c.on(WebcastEvent.SOCIAL || 'social', (d) => { if (ev.isFollowSocial(d)) onFollow(d); else if (ev.isShareSocial(d)) onShare(d); });
  if (WebcastEvent.SHARE) c.on(WebcastEvent.SHARE, onShare);
  c.on(WebcastEvent.LIKE || 'like', (d) => {
    if (!alive()) return;
    const l = ev.likerOf(d);
    send('tt:like', { ...ev.likesOf(d), name: l.name, id: l.id, avatar: l.avatar, isFollower: l.isFollower }); // ник нужен оверлею: «ник — поставил(а) лайк»; isFollower — для значка Sub
    if (likesBoard.add(l, l.count)) pushLikes();
  });
  c.on(WebcastEvent.ROOM_USER || 'roomUser', (d) => {
    if (!alive()) return;
    const count = ev.viewersOf(d);
    if (count !== null) send('tt:viewers', { count });
    const views = ev.totalViewsOf(d);
    if (views !== null) send('tt:views', { count: views });
  });
  // кто-то зашёл на эфир: в оверлее «ник — теперь с нами» и счётчик просмотров за эфир
  c.on(WebcastEvent.MEMBER || 'member', (d) => {
    if (!alive()) return;
    const u = ev.userOf(d);
    if (u.name !== 'Гость' || u.id) send('tt:join', u);
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
  giftsBoard.clear(); wsrv && wsrv.broadcast('gifts', []);
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

// Озвучка Edge: постоянные соединения с сервером Microsoft (edge-pool.js), без нового подключения на каждую фразу
const edgePool = require('./edge-pool').createEdgeSynth({
  loadTts: async () => { const { MsEdgeTTS, OUTPUT_FORMAT } = await load('msedge-tts'); return { MsEdgeTTS, OUTPUT_FORMAT }; },
});
const edgeSynth = (text, voice, rate, pitch, o) => edgePool.synth(text, voice, rate, pitch, o);
// окно просит заранее открыть соединения для выбранных голосов (при запуске и при подключении к эфиру)
ipcMain.handle('tts:warm', (_e, voices) => {
  edgePool.setPinned((Array.isArray(voices) ? voices : []).filter((v) => typeof v === 'string' && /^[\w-]{3,80}$/.test(v)).slice(0, 6));
  return true;
});

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
    const buf = await edgeSynth(text, o.voice, o.rate, o.pitch, { urgent: !!o.urgent });
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
  lset = { count: clampN(s.count, 5, LIKES_MAX, 5),scale: clampN(s.scale, 30, 300, 100), align: ['left', 'center', 'right'].includes(s.align) ? s.align : 'center', showCount: s.showCount !== false, showRank: s.showRank !== false, shadow: s.shadow !== false, punch: s.punch !== false };
  wsrv && wsrv.broadcast('lsettings', lset);
  return { ok: true };
});
ipcMain.handle('likes:test', () => {
  if (locked('widgets')) return { ok: false, locked: true };
  const names = ['Анна', 'Max', 'Игорь', 'Дина', 'Марат', 'Света', 'Олег', 'Ксюша', 'Тимур', 'Лера'];
  const base = names.map((name, i) => ({ name, avatar: '', likes: Math.max(20, 1200 - i * 97 - i * i * 5) }));
  wsrv && wsrv.broadcast('likes', []); // пустая таблица: страница забывает прежнего лидера, поэтому показ таблицы сам по себе не вызывает удар
  wsrv && wsrv.broadcast('likes', base);
  // через 1,6 с второй обгоняет первого, ещё через 2 с третий обгоняет второго — виджет показывает «удар рукой» (если он включён)
  clearTimeout(likesTestTimer);
  likesTestTimer = setTimeout(() => {
    const t = base.map((x) => ({ ...x }));
    t[1].likes = t[0].likes + 25;
    t.sort((a, b) => b.likes - a.likes);
    wsrv && wsrv.broadcast('likes', t);
    // ещё через 2 с третий обгоняет второго и бьёт его: показываем и удар «2 место → 3 место»
    likesTestTimer = setTimeout(() => {
      const u = t.map((x) => ({ ...x }));
      u[2].likes = u[1].likes + 20;
      u.sort((a, b) => b.likes - a.likes);
      wsrv && wsrv.broadcast('likes', u);
    }, 2000);
  }, 1600);
  return { ok: true };
});
ipcMain.handle('likes:clear', () => { likesBoard.clear(); wsrv && wsrv.broadcast('likes', []); return { ok: true }; });
ipcMain.handle('gifts:set', (_e, s) => {
  s = s || {};
  gset = { count: clampN(s.count, 5, LIKES_MAX, 5), scale: 100, align: 'center', showCount: s.showCount !== false, showRank: s.showRank !== false, shadow: s.shadow !== false, celebrate: s.celebrate !== false };
  wsrv && wsrv.broadcast('gsettings', gset);
  return { ok: true };
});
ipcMain.handle('gifts:test', () => {
  if (locked('widgets')) return { ok: false, locked: true };
  const names = ['Анна', 'Max', 'Игорь', 'Дина', 'Марат', 'Света', 'Олег', 'Ксюша', 'Тимур', 'Лера'];
  const base = names.map((name, i) => ({ name, avatar: '', likes: Math.max(10, 5200 - i * 430 - i * i * 25) }));
  wsrv && wsrv.broadcast('gifts', []); // пустая таблица: страница забывает прежнего лидера, поэтому показ таблицы сам по себе не вызывает ликования
  wsrv && wsrv.broadcast('gifts', base);
  clearTimeout(giftsTestTimer);
  giftsTestTimer = setTimeout(() => { // через 1,6 с второй обгоняет первого — аватарка нового лидера прыгает и светится
    const t = base.map((x) => ({ ...x }));
    t[1].likes = t[0].likes + 150;
    t.sort((a, b) => b.likes - a.likes);
    wsrv && wsrv.broadcast('gifts', t);
  }, 1600);
  return { ok: true };
});
ipcMain.handle('gifts:clear', () => { giftsBoard.clear(); wsrv && wsrv.broadcast('gifts', []); return { ok: true }; });
ipcMain.handle('gifts:url', () => (wsrv && wsrv.port ? `http://127.0.0.1:${wsrv.port}/gifts` : ''));
ipcMain.handle('gifts:link', () => (wsrv && wsrv.port ? { ok: true, url: widget.GIFTS_PAGES_URL } : { ok: false, url: '' }));
ipcMain.handle('likes:url', () => (wsrv && wsrv.port ? `http://127.0.0.1:${wsrv.port}/likes` : ''));
ipcMain.handle('likes:link', () => (wsrv && wsrv.port ? { ok: true, url: widget.LIKES_PAGES_URL } : { ok: false, url: '' }));
ipcMain.handle('widget:clear', () => { wsrv && wsrv.broadcast('clear', {}); return { ok: true }; });

// ---------- Аватар: Live2D-персонаж повторяет лицо с камеры (идея VTubeLeaf, MIT) ----------
// Камеру и MediaPipe ведёт скрытое окно трекера (avatar-tracker.js), в виджет уходят только числа параметров. Компоненты скачиваются по кнопке (avatar.js).
const av = require('./avatar');
const AV_FILE = () => path.join(app.getPath('userData'), 'avatar.json');
let avSet = av.cleanSettings({});
try { avSet = av.cleanSettings(JSON.parse(require('fs').readFileSync(AV_FILE(), 'utf8'))); } catch (_) {}
const avSave = () => { try { require('fs').writeFileSync(AV_FILE(), JSON.stringify(avSet)); } catch (_) {} };
let avWin = null, avReady = false, avInstalling = false, avRun = { state: 'off', error: '', fps: 0, calibrating: false };
let avPending = [], avCalls = new Map(), avCallId = 0;
const avUD = () => app.getPath('userData');
function avWidgetSettings() {
  const st = av.status(avUD()), m = av.activeModel(avUD(), avSet.model);
  return { ready: st.ready, model: m ? m.id : '', entry: m ? m.entry : '', scale: avSet.scale, offsetX: avSet.offsetX, offsetY: avSet.offsetY, bg: avSet.bg };
}
function avWidgetSettings3d() {
  const st = av.status(avUD(), '3d'), m = av.activeVrm(avUD(), avSet.v3.model), v = avSet.v3;
  return { ready: st.ready, model: m ? m.id : '', credit: m ? m.credit : '', scale: v.scale, offsetX: v.offsetX, offsetY: v.offsetY, bg: v.bg, mirror: v.mirror };
}
const avPush = () => { if (!wsrv) return; wsrv.broadcast('avsettings', avWidgetSettings()); wsrv.broadcast('av3settings', avWidgetSettings3d()); };
function avNotify() { send('avatar:state', { run: avRun }); }
function avOpen() { return !!(avWin && !avWin.isDestroyed()); }
function avCmd(c) { if (!avOpen()) return; if (avReady) avWin.webContents.send('av:cmd', c); else avPending.push(c); }
function avEnsureWin() {
  if (avOpen()) return true;
  if (!wsrv || !wsrv.port) return false;
  avReady = false; avPending = [];
  const ses = session.fromPartition('avatar-tracker');
  const okOrigin = (u) => /^http:\/\/127\.0\.0\.1:\d+\//.test(String(u || ''));
  ses.setPermissionRequestHandler((wc, perm, cb, d) => cb(perm === 'media' && okOrigin(d && d.requestingUrl)));
  ses.setPermissionCheckHandler((wc, perm, origin) => perm === 'media' && okOrigin(origin + '/'));
  const w = new BrowserWindow({
    show: false, width: 320, height: 240, skipTaskbar: true, focusable: false,
    webPreferences: { preload: path.join(__dirname, 'avatar-preload.js'), contextIsolation: true, nodeIntegration: false, partition: 'avatar-tracker', backgroundThrottling: false },
  });
  avWin = w;
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.on('closed', () => { if (avWin === w) { avWin = null; avReady = false; avRun = { state: 'off', error: '', fps: 0, calibrating: false }; wsrv && wsrv.broadcast('aframe', { lost: true }); avNotify(); } });
  w.loadURL(`http://127.0.0.1:${wsrv.port}/avatar-tracker`);
  return true;
}
function avCall(cmd, extra) { // команда трекеру с ответом
  return new Promise((resolve) => {
    if (!avEnsureWin()) return resolve([]);
    const id = ++avCallId, t = setTimeout(() => { avCalls.delete(id); resolve([]); }, 8000);
    avCalls.set(id, (d) => { clearTimeout(t); resolve(d); });
    avCmd({ cmd, id, ...extra });
  });
}
const fromAv = (e) => avOpen() && e.sender === avWin.webContents;
ipcMain.on('av:ready', (e) => { if (!fromAv(e)) return; avReady = true; avPending.splice(0).forEach((c) => avWin.webContents.send('av:cmd', c)); });
ipcMain.on('av:reply', (e, id, data) => { if (!fromAv(e)) return; const f = avCalls.get(id); if (f) { avCalls.delete(id); f(Array.isArray(data) ? data.slice(0, 20).map((d) => ({ id: String((d && d.id) || '').slice(0, 300), label: String((d && d.label) || '').slice(0, 120) })) : []); } });
ipcMain.on('av:state', (e, s) => {
  if (!fromAv(e) || !s) return;
  const st = ['off', 'starting', 'on', 'error'].includes(s.state) ? s.state : 'off';
  avRun = { state: st, error: st === 'error' ? String(s.error || '').slice(0, 300) : '', fps: Number.isFinite(s.fps) ? Math.round(s.fps) : avRun.fps, calibrating: !!s.calibrating };
  if (st !== 'on') wsrv && wsrv.broadcast('aframe', { lost: true });
  avNotify();
});
ipcMain.on('av:frame', (e, f) => { // только известные параметры и конечные числа
  if (!fromAv(e) || !wsrv || locked('widgets')) return;
  if (f && f.lost) return wsrv.broadcast('aframe', { lost: true });
  if (!f || !f.p || typeof f.p !== 'object') return;
  const p = {};
  for (const id of Object.keys(require('./src/avatar-map.js').REST)) { const v = f.p[id]; if (Number.isFinite(v)) p[id] = Math.max(-60, Math.min(60, v)); }
  wsrv.broadcast('aframe', { p });
});
function avStop() { if (avOpen()) avCmd({ cmd: 'stop' }); }
function closeAvatar() { if (avOpen()) { try { avWin.close(); } catch (_) {} } }
async function avStart() {
  if (locked('widgets')) return { ok: false, locked: true };
  // камере нужны только MediaPipe и модель лица (они общие для 2D и 3D)
  const trk = av.status(avUD(), '3d').items.filter((i) => i.id === 'mediapipe' || i.id === 'face');
  if (!trk.length || !trk.every((i) => i.ok)) return { ok: false, error: 'Сначала скачайте компоненты аватара (2D или 3D).' };
  if (process.platform === 'darwin') { try { if (!(await systemPreferences.askForMediaAccess('camera'))) return { ok: false, error: 'Нет доступа к камере: разрешите в настройках macOS.' }; } catch (_) {} }
  if (!avEnsureWin()) return { ok: false, error: 'Не запущен сервер виджетов.' };
  avCmd({ cmd: 'start', opts: { camera: avSet.camera, mirror: avSet.mirror } });
  return { ok: true };
}
const avFull = () => ({ settings: avSet, status: av.status(avUD()), status3: av.status(avUD(), '3d'), models: av.listModels(avUD()), models3: av.listVrm(avUD()), run: avRun, installing: avInstalling, locked: locked('widgets') });
ipcMain.handle('avatar:state', () => avFull());
ipcMain.handle('avatar:cameras', (_e, ask) => avCall('cameras', { ask: !!ask }));
ipcMain.handle('avatar:start', () => avStart());
ipcMain.handle('avatar:stop', () => { avStop(); return { ok: true }; });
ipcMain.handle('avatar:calibrate', () => { avCmd({ cmd: 'calibrate' }); return { ok: true }; });
const avViewReset = { scale: 100, offsetX: 0, offsetY: 0 };
ipcMain.handle('avatar:set', (_e, patch) => {
  const was = avSet;
  const next = { ...patch };
  // при смене модели вид в предпросмотре возвращается к стандартному: по центру и в масштабе 100%
  if (next.model && next.model !== was.model) Object.assign(next, avViewReset);
  if (next.v3 && next.v3.model && next.v3.model !== was.v3.model) next.v3 = { ...next.v3, ...avViewReset }; // то же для 3D
  avSet = av.cleanSettings(next, avSet); avSave();
  if (avSet.mirror !== was.mirror) avCmd({ cmd: 'opts', opts: { mirror: avSet.mirror } });
  if (avSet.camera !== was.camera && avRun.state !== 'off') avCmd({ cmd: 'start', opts: { camera: avSet.camera, mirror: avSet.mirror } });
  avPush();
  return avFull();
});
ipcMain.handle('avatar:install', async (_e, engine) => {
  if (avInstalling) return { ok: false, error: 'Скачивание уже идёт.' };
  avInstalling = true;
  try {
    await av.install(avUD(), { engine: engine === '3d' ? '3d' : '2d', onProgress: (p) => send('avatar:progress', p) });
    avPush();
    return { ok: true, ...avFull(), installing: false };
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
  finally { avInstalling = false; }
});
async function avPick(kind) {
  if (kind === 'vrm') { // 3D: один файл .vrm
    const r = await dialog.showOpenDialog(win, { title: 'Модель VRM (.vrm)', properties: ['openFile'], filters: [{ name: 'Модель VRM', extensions: ['vrm'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const m = av.importVrm(avUD(), r.filePaths[0]);
    if (!m.ok) return m;
    avSet = av.cleanSettings({ v3: { model: m.id, ...avViewReset } }, avSet); avSave(); avPush();
    return { ok: true, ...avFull() };
  }
  const r = await dialog.showOpenDialog(win, kind === 'dir'
    ? { title: 'Папка модели Live2D', properties: ['openDirectory'] }
    : { title: 'Модель Live2D (.zip или .model3.json)', properties: ['openFile'], filters: [{ name: 'Модель Live2D', extensions: ['zip', 'json'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const m = av.importModel(avUD(), r.filePaths[0]);
  if (!m.ok) return m;
  avSet = av.cleanSettings({ model: m.id, ...avViewReset }, avSet); avSave(); avPush();
  return { ok: true, ...avFull() };
}
ipcMain.handle('avatar:add', (_e, kind) => avPick(kind === 'dir' ? 'dir' : kind === 'vrm' ? 'vrm' : 'file'));
ipcMain.handle('avatar:remove', (_e, id) => {
  if (/^vrm-/.test(String(id))) {
    const r3 = av.removeVrm(avUD(), id);
    if (r3.ok) { if (avSet.v3.model === id) { avSet = av.cleanSettings({ v3: { model: 'builtin-seed', ...avViewReset } }, avSet); avSave(); } avPush(); }
    return r3.ok ? { ok: true, ...avFull() } : r3;
  }
  const r = av.removeModel(avUD(), id);
  if (r.ok) { if (avSet.model === id) { avSet = av.cleanSettings({ model: 'builtin-Haru', ...avViewReset }, avSet); avSave(); } avPush(); }
  return r.ok ? { ok: true, ...avFull() } : r;
});
// Где взять бесплатные модели: официальная страница примеров Live2D (адрес зашит, из окна его подменить нельзя)
// Для 3D (VRM) — VRoid Hub: там модели, которые авторы разрешили скачивать (нужен аккаунт pixiv)
const AV_MODELS_URL = 'https://booth.pm/en/search/free%20live%202d%20model?tags%5B%5D=live2d', AV_MODELS3_URL = 'https://hub.vroid.com/en';
ipcMain.handle('avatar:open-models', (_e, engine) => { shell.openExternal(engine === '3d' ? AV_MODELS3_URL : AV_MODELS_URL).catch(() => {}); return { ok: true }; });
ipcMain.handle('avatar:url', (_e, engine) => (wsrv && wsrv.port ? `http://127.0.0.1:${wsrv.port}/${engine === '3d' ? 'avatar3d' : 'avatar'}` : ''));
ipcMain.handle('avatar:link', (_e, engine) => (wsrv && wsrv.port ? { ok: true, url: engine === '3d' ? widget.AVATAR3D_PAGES_URL : widget.AVATAR_PAGES_URL } : { ok: false, url: '' }));

// ---------- Оповещения о подписках: плашка на экране стрима (страница /alert), звук играет окно приложения ----------
// Картинка и звук, которые загрузил человек, лежат в папке данных приложения (alerts.js); до 5 МБ каждый
const alertsMod = require('./alerts');
let aset = alertsMod.cleanSettings({});
const alertsDir = () => app.getPath('userData');
const alertImage = () => alertsMod.findImage(alertsDir());
const alertWidgetSettings = () => alertsMod.widgetSettings(aset, alertImage());
let alertSeq = 0;
function fireAlert(u, test = false) {
  if (locked('widgets') || (!test && !aset.enabled)) return false; // тариф Lite или оповещения выключены (кнопка «Тест» работает и при выключенных)
  const name = String((u && u.name) || 'Гость').slice(0, 40);
  const avatar = u && /^https?:\/\//.test(u.avatar || '') ? u.avatar : '';
  wsrv && wsrv.broadcast('alert', { id: Date.now().toString(36) + (alertSeq++), name, avatar, test });
  send('alert:show', { name, test }); // окно приложения играет звук
  return true;
}
ipcMain.handle('alerts:set', (_e, s) => { aset = alertsMod.cleanSettings(s); wsrv && wsrv.broadcast('asettings', alertWidgetSettings()); return { ok: true, hasImage: !!alertImage() }; });
const ALERT_SAMPLES = [{ name: 'Анна К.' }, { name: 'Max' }, { name: 'Игорь' }, { name: 'Дина Н.' }, { name: 'Марат' }];
let alertSampleI = 0;
ipcMain.handle('alerts:test', () => {
  if (locked('widgets')) return { ok: false, locked: true };
  fireAlert(ALERT_SAMPLES[alertSampleI++ % ALERT_SAMPLES.length], true);
  return { ok: true };
});
async function pickAlertFile(title, name, exts, base, kind) {
  const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { title, properties: ['openFile'], filters: [{ name, extensions: Object.keys(exts) }] }).catch(() => null);
  if (!r || r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  return alertsMod.saveFile(alertsDir(), base, exts, r.filePaths[0], kind);
}
ipcMain.handle('alerts:imgpick', async () => {
  const r = await pickAlertFile('Своя картинка оповещения', 'Картинка', alertsMod.IMAGE_EXT, alertsMod.IMAGE_BASE, 'image');
  if (r.ok) wsrv && wsrv.broadcast('asettings', alertWidgetSettings()); // предпросмотр и OBS сразу берут новую картинку
  return r;
});
ipcMain.handle('alerts:imgclear', () => { alertsMod.clearFiles(alertsDir(), alertsMod.IMAGE_BASE); wsrv && wsrv.broadcast('asettings', alertWidgetSettings()); return { ok: true }; });
ipcMain.handle('alerts:sndpick', () => pickAlertFile('Свой звук оповещения', 'Звук', alertsMod.SOUND_EXT, alertsMod.SOUND_BASE, 'sound'));
ipcMain.handle('alerts:sndget', () => {
  const f = alertsMod.findSound(alertsDir());
  if (!f) return { ok: false };
  try { return { ok: true, mime: f.mime, data: require('fs').readFileSync(f.file) }; } catch (_) { return { ok: false }; }
});
ipcMain.handle('alerts:sndclear', () => { alertsMod.clearFiles(alertsDir(), alertsMod.SOUND_BASE); return { ok: true }; });
ipcMain.handle('alerts:url', () => (wsrv && wsrv.port ? `http://127.0.0.1:${wsrv.port}/alert` : ''));
ipcMain.handle('alerts:link', () => (wsrv && wsrv.port ? { ok: true, url: widget.ALERT_PAGES_URL } : { ok: false, url: '' }));

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
let dset = { enabled: true, token: '', minAmount: 0, strict: true, duration: 8, scale: 100, align: 'center', vpos: 'bottom', showMessage: true, design: 'classic', layout: 'top' };
const DONATE_DESIGNS = ['classic', 'neon', 'minimal', 'party', 'gold', 'arcade', 'glass', 'candy'];
let krx = null, krxP = null;
// своя картинка доната (вместо эмодзи по сумме): копия лежит в папке данных, до 5 МБ
const DIMG_BASE = 'donate-image';
const donateImage = () => alertsMod.findFile(app.getPath('userData'), DIMG_BASE, alertsMod.IMAGE_EXT);
const donateWidgetSettings = () => { const im = donateImage(); return { duration: dset.duration, scale: dset.scale, align: dset.align, vpos: dset.vpos, showMessage: dset.showMessage, design: DONATE_DESIGNS.includes(dset.design) ? dset.design : 'classic', layout: dset.layout === 'side' ? 'side' : 'top', imageV: im ? Math.max(1, im.mtime) : 0 }; };
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
const kaspiState = () => ({ running: !!(krx && krx.port), port: krx ? krx.port : 0, ips: kaspi.lanAddresses(), relay: relayOk ? relayOk.ok : null, relayPro: !!(relayOk && relayOk.code === 'pro'), relayBase: relayBaseNow });
ipcMain.handle('donate:set', async (_e, s) => {
  dset = { ...dset, ...(s || {}) };
  wsrv && wsrv.broadcast('dsettings', donateWidgetSettings());
  try { await applyKaspi(); } catch (_) {}
  return { ok: true, ...kaspiState() };
});
// свой звук доната: файл копируется в папку данных приложения (до 5 МБ), играет окно приложения
const DSND_MAX = 5 * 1024 * 1024, DSND_EXT = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm' };
const dsndFiles = () => { try { return require('fs').readdirSync(app.getPath('userData')).filter((f) => /^donate-sound\.[a-z0-9]+$/.test(f)); } catch (_) { return []; } };
const dsndClear = () => dsndFiles().forEach((f) => { try { require('fs').unlinkSync(path.join(app.getPath('userData'), f)); } catch (_) {} });
ipcMain.handle('donimg:pick', async () => {
  const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { title: 'Своя картинка доната', properties: ['openFile'], filters: [{ name: 'Картинка', extensions: Object.keys(alertsMod.IMAGE_EXT) }] }).catch(() => null);
  if (!r || r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const res = alertsMod.saveFile(app.getPath('userData'), DIMG_BASE, alertsMod.IMAGE_EXT, r.filePaths[0], 'image');
  if (res.ok) wsrv && wsrv.broadcast('dsettings', donateWidgetSettings());
  return res;
});
ipcMain.handle('donimg:clear', () => { alertsMod.clearFiles(app.getPath('userData'), DIMG_BASE); wsrv && wsrv.broadcast('dsettings', donateWidgetSettings()); return { ok: true }; });
ipcMain.handle('donimg:info', () => { const im = donateImage(); return { ok: true, has: !!im, name: im ? im.name : '' }; });
ipcMain.handle('donsound:pick', async () => {
  const fs = require('fs');
  const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { title: 'Свой звук доната', properties: ['openFile'], filters: [{ name: 'Звук', extensions: Object.keys(DSND_EXT) }] }).catch(() => null);
  if (!r || r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const src = r.filePaths[0], ext = path.extname(src).slice(1).toLowerCase();
  if (!DSND_EXT[ext]) return { ok: false, error: 'Нужен файл mp3, wav, ogg, m4a, aac, flac или webm' };
  let st; try { st = fs.statSync(src); } catch (e) { return { ok: false, error: 'Не удалось открыть файл' }; }
  if (st.size > DSND_MAX) return { ok: false, error: 'Файл больше 5 МБ: возьмите звук покороче' };
  try { dsndClear(); fs.copyFileSync(src, path.join(app.getPath('userData'), 'donate-sound.' + ext)); } catch (e) { return { ok: false, error: 'Не удалось сохранить звук: ' + (e && e.message || e) }; }
  return { ok: true, name: path.basename(src) };
});
ipcMain.handle('donsound:get', () => {
  const f = dsndFiles()[0];
  if (!f) return { ok: false };
  try { return { ok: true, mime: DSND_EXT[f.split('.').pop()] || 'audio/mpeg', data: require('fs').readFileSync(path.join(app.getPath('userData'), f)) }; } catch (_) { return { ok: false }; }
});
ipcMain.handle('donsound:clear', () => { dsndClear(); return { ok: true }; });
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
// пробный показ только в виджете (без озвучки и звука): так видно выбранное оформление
ipcMain.handle('donate:preview', () => {
  const d = SAMPLES[sampleI++ % SAMPLES.length];
  wsrv && wsrv.broadcast('donate', { id: 'pv' + Date.now().toString(36), name: d.name, amount: d.amount, message: d.message || '', test: true });
  return { ok: true };
});
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

// ---------- DonationAlerts: вход через OAuth, донаты в реальном времени, свой виджет /da (donationalerts.js) ----------
// Нужен client_id приложения DonationAlerts: он лежит в assets/da-client-id.txt (публичное значение, секрет не нужен — вход по implicit-схеме).
// Токен доступа хранится в папке данных приложения в зашифрованном виде (safeStorage: DPAPI на Windows, Keychain на macOS).
const daMod = require('./donationalerts');
let daSet = daMod.cleanSettings({});
let daHandle = null, daAuthWin = null, daSt = { state: 'off', user: null, error: '' };
const daDir = () => app.getPath('userData');
const daAuthFile = () => path.join(daDir(), 'da-auth.json');
const daClientId = () => { const b = readAsset('da-client-id.txt'); const m = b && /^\s*(\d{1,10})\s*$/m.exec(String(b)); return m ? m[1] : ''; };
function daSaveToken(t) {
  try {
    const { safeStorage } = require('electron');
    const enc = safeStorage.isEncryptionAvailable();
    const body = enc ? safeStorage.encryptString(t).toString('base64') : Buffer.from(t, 'utf8').toString('base64');
    require('fs').writeFileSync(daAuthFile(), JSON.stringify({ enc, v: body }), { mode: 0o600 });
  } catch (_) {}
}
function daLoadToken() {
  try {
    const { safeStorage } = require('electron');
    const j = JSON.parse(require('fs').readFileSync(daAuthFile(), 'utf8'));
    const raw = Buffer.from(String(j.v || ''), 'base64');
    return j.enc ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch (_) { return ''; }
}
const daClearToken = () => { try { require('fs').unlinkSync(daAuthFile()); } catch (_) {} };
const daImage = () => alertsMod.findFile(daDir(), daMod.IMAGE_BASE, alertsMod.IMAGE_EXT);
const daSound = () => alertsMod.findFile(daDir(), daMod.SOUND_BASE, alertsMod.SOUND_EXT);
const daWidgetSettings = () => daMod.widgetSettings(daSet, daImage());
const daPublic = () => ({ state: daSt.state, user: daSt.user, error: daSt.error || '', last: daSt.last || '', hasClientId: !!daClientId(), locked: false });
const daNotify = () => send('da:status', daPublic());
function stopDa() { if (daHandle) { try { daHandle.stop(); } catch (_) {} daHandle = null; } }
function startDa(token) {
  stopDa();
  daSt = { state: 'connecting', user: daSt.user, error: '' }; daNotify();
  daHandle = daMod.start({
    token,
    onDonation: (d) => handleDaDonation(d),
    // что именно пришло с сайта (для подсказки в окне: видно, доходят ли события вообще)
    onRaw: (r) => { try { const x = r && r.data && r.amount === undefined ? r.data : (r || {}); daSt.last = 'Последнее событие: ' + String(x.name || 'без названия').slice(0, 24) + ', ' + (x.amount !== undefined ? x.amount + ' ' + String(x.currency || '') : 'без суммы') + ' · ' + new Date().toLocaleTimeString('ru-RU'); daNotify(); } catch (_) {} },
    onState: (s) => {
      daSt = { state: s.state, user: s.user || daSt.user, error: s.error || '', last: daSt.last };
      if (s.state === 'auth') { stopDa(); daClearToken(); daSt = { state: 'off', user: null, error: s.error || 'Нужно войти заново' }; } // токен не принят: старый удаляем, чтобы не гонять запросы впустую
      daNotify();
    },
  });
}
function handleDaDonation(d, test = false) {
  if (!test && !daSet.enabled) return { accepted: false, reason: 'приём выключен' };
  const kzt = daMod.kztEquivalent(d.amount, d.currency);
  if (!test && daSet.minAmount > 0 && kzt < daSet.minAmount) return { accepted: false, reason: 'сумма меньше минимальной' };
  const don = {
    id: 'da' + (d.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), name: d.name, message: d.message,
    money: daMod.formatMoney(d.amount, d.currency), say: daMod.speakAmount(d.amount, d.currency), kzt: Math.round(kzt), test,
  };
  wsrv && wsrv.broadcast('dadonate', { id: don.id, name: don.name, money: don.money, message: don.message, kzt: don.kzt, test });
  send('da:donate', don); // окно приложения играет звук и озвучивает
  return { accepted: true, donation: don };
}
async function daAcceptToken(token) {
  try {
    const u = await daMod.fetchUser(token);
    daSaveToken(token);
    daSt = { state: 'connecting', user: { id: u.id, name: u.name, avatar: u.avatar }, error: '' };
    startDa(token);
    return { ok: true };
  } catch (e) { return { ok: false, error: e && e.code === 'auth' ? 'DonationAlerts не принял вход, попробуйте ещё раз' : 'Не удалось связаться с DonationAlerts: ' + String((e && e.message) || e) }; }
}
function daLogin() {
  const cid = daClientId();
  if (!cid) return Promise.resolve({ ok: false, error: 'В приложении не указан client_id DonationAlerts (assets/da-client-id.txt)' });
  if (daAuthWin && !daAuthWin.isDestroyed()) { daAuthWin.focus(); return Promise.resolve({ ok: false, busy: true }); }
  const state = require('crypto').randomBytes(12).toString('hex');
  return new Promise((resolve) => {
    let done = false;
    const w = new BrowserWindow({
      width: 520, height: 780, parent: win && !win.isDestroyed() ? win : undefined, autoHideMenuBar: true, title: 'Вход в DonationAlerts', backgroundColor: '#ffffff',
      webPreferences: { partition: 'persist:da-auth', contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    daAuthWin = w;
    const finish = (r) => { if (done) return; done = true; daAuthWin = null; try { if (!w.isDestroyed()) w.destroy(); } catch (_) {} resolve(r); };
    // DonationAlerts возвращает человека на адрес из настроек приложения, токен лежит после «#»: перехватываем адрес до загрузки страницы
    const check = (e, url) => {
      const p = daMod.parseRedirect(url, state);
      if (p.notRedirect) return;
      if (e && e.preventDefault) e.preventDefault();
      if (p.ok) daAcceptToken(p.token).then(finish); else finish({ ok: false, error: p.error });
    };
    const wc = w.webContents;
    wc.on('will-redirect', (e, url) => check(e, url || (e && e.url)));
    wc.on('will-navigate', (e, url) => check(e, url || (e && e.url)));
    wc.on('did-navigate', (_e, url) => check(null, url));
    wc.on('did-fail-load', (_e, _c, _d, url) => check(null, url));
    wc.setWindowOpenHandler(({ url }) => { try { wc.loadURL(url); } catch (_) {} return { action: 'deny' }; }); // вход через Twitch/Google и т.п. открывается в этом же окне
    w.on('closed', () => finish({ ok: false, canceled: true }));
    w.loadURL(daMod.authorizeUrl({ clientId: cid, state })).catch(() => {});
  });
}
ipcMain.handle('da:state', () => daPublic());
ipcMain.handle('da:login', async () => { const r = await daLogin(); return { ...r, ...daPublic(), ok: !!r.ok }; });
ipcMain.handle('da:logout', async () => {
  stopDa(); daClearToken(); daSt = { state: 'off', user: null, error: '' };
  try { await require('electron').session.fromPartition('persist:da-auth').clearStorageData(); } catch (_) {} // чтобы вошёл другой человек, а не прежний сеанс
  daNotify(); return { ok: true, ...daPublic() };
});
ipcMain.handle('da:set', (_e, s) => { daSet = daMod.cleanSettings(s); wsrv && wsrv.broadcast('dasettings', daWidgetSettings()); return { ok: true, hasImage: !!daImage(), hasSound: !!daSound() }; });
const DA_SAMPLES = [
  { name: 'Айдос А.', amount: 500, currency: 'KZT', message: 'Привет из Алматы!' }, { name: 'Анна К.', amount: 150, currency: 'RUB' },
  { name: 'Mark', amount: 5, currency: 'USD', message: 'Thanks for the stream!' }, { name: 'Дина Н.', amount: 7500, currency: 'KZT' },
  { name: 'Тимур Б.', amount: 100, currency: 'EUR', message: 'Ракета для тебя!' },
];
let daSampleI = 0;
// «Тест»: показывает донат на экране и играет звук/голос, как настоящий
ipcMain.handle('da:test', () => { handleDaDonation(DA_SAMPLES[daSampleI++ % DA_SAMPLES.length], true); return { ok: true }; });
// «Предпросмотр»: только в виджете, без звука и голоса — так видно выбранное оформление
ipcMain.handle('da:preview', () => {
  const d = DA_SAMPLES[daSampleI++ % DA_SAMPLES.length];
  wsrv && wsrv.broadcast('dadonate', { id: 'pv' + Date.now().toString(36), name: d.name, money: daMod.formatMoney(d.amount, d.currency), message: d.message || '', kzt: Math.round(daMod.kztEquivalent(d.amount, d.currency)), test: true, preview: true });
  return { ok: true };
});
async function pickDaFile(title, name, exts, base, kind) {
  const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { title, properties: ['openFile'], filters: [{ name, extensions: Object.keys(exts) }] }).catch(() => null);
  if (!r || r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  return alertsMod.saveFile(daDir(), base, exts, r.filePaths[0], kind);
}
ipcMain.handle('da:imgpick', async () => { const r = await pickDaFile('Своя картинка доната', 'Картинка', alertsMod.IMAGE_EXT, daMod.IMAGE_BASE, 'image'); if (r.ok) wsrv && wsrv.broadcast('dasettings', daWidgetSettings()); return r; });
ipcMain.handle('da:imgclear', () => { alertsMod.clearFiles(daDir(), daMod.IMAGE_BASE); wsrv && wsrv.broadcast('dasettings', daWidgetSettings()); return { ok: true }; });
ipcMain.handle('da:sndpick', () => pickDaFile('Свой звук доната', 'Звук', alertsMod.SOUND_EXT, daMod.SOUND_BASE, 'sound'));
ipcMain.handle('da:sndget', () => {
  const f = daSound();
  if (!f) return { ok: false };
  try { return { ok: true, mime: f.mime, data: require('fs').readFileSync(f.file) }; } catch (_) { return { ok: false }; }
});
ipcMain.handle('da:sndclear', () => { alertsMod.clearFiles(daDir(), daMod.SOUND_BASE); return { ok: true }; });
ipcMain.handle('da:url', () => (wsrv && wsrv.port ? `http://127.0.0.1:${wsrv.port}/da` : ''));
ipcMain.handle('da:link', () => (wsrv && wsrv.port ? { ok: true, url: widget.DA_PAGES_URL } : { ok: false, url: '' }));
ipcMain.handle('da:presets', () => ({ images: daMod.IMAGE_PRESETS, sounds: daMod.SOUND_PRESETS }));
// при запуске: если человек уже входил, приём включается сам
function daBoot() { const t = daLoadToken(); if (t) { daSt = { state: 'connecting', user: null, error: '' }; startDa(t); } }

// ---------- Лицензия: тарифы, пробный период, ключи (license.js; сервер — relay-worker) ----------
const licMod = require('./license');
const readAsset = (name) => { try { return require('fs').readFileSync(path.join(__dirname, 'assets', name)); } catch (_) { return null; } };
const licPub = () => { const b = readAsset('license-pub.txt'); return b ? (String(b).split(/\r?\n/).map((x) => x.trim()).find((x) => /^[A-Za-z0-9_-]{40,50}$/.test(x)) || '') : ''; };
function initLicense() {
  license = new licMod.LicenseManager({ dir: app.getPath('userData'), getServer: relayServer, pub: licPub(), onChange: (st, meta) => {
    send('lic:state', { ...st, justActivated: !!(meta && meta.activated) });
    if (st && Array.isArray(st.locked) && st.locked.includes('widgets')) closeOverlay(); // тариф закончился — оверлей закрывается, как и виджеты
    else ovNotify(); // тариф открылся — переключатель в приложении снова доступен
  } });
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
// Баг-репорт и «Написать автору»: письмо уходит на вшитую почту автора без почтовой программы у пользователя.
// Пароль от почты в приложение не кладём (его можно достать из exe), поэтому отправка идёт через форму-пересылку FormSubmit.
// Если сеть недоступна, остаётся запасной путь: открыть обычное письмо (mailto) в почтовой программе.
const AUTHOR_MAIL = 'vladimir.palatovsky@yandex.ru';
let lastBugAt = 0;
const bugBody = (d) => {
  const text = String((d && d.text) || '').trim().slice(0, 3000);
  const contact = String((d && d.contact) || '').trim().slice(0, 120);
  const kind = d && d.kind === 'message' ? 'message' : 'bug';
  const sys = `ЭхоЧат LIVE ${app.getVersion()} · ${process.platform} ${require('os').release()} · ${process.arch}`;
  return { text, contact, kind, sys, subject: (kind === 'bug' ? 'Баг-репорт' : 'Сообщение автору') + ' · ЭхоЧат LIVE ' + app.getVersion() };
};
ipcMain.handle('bug:send', async (_e, d) => {
  const b = bugBody(d);
  if (b.text.length < 5) return { ok: false, error: 'Опишите проблему хотя бы парой слов' };
  if (Date.now() - lastBugAt < 30000) return { ok: false, error: 'Подождите полминуты перед следующим письмом' };
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch('https://formsubmit.co/ajax/' + AUTHOR_MAIL, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://vladimirphoto.github.io', Referer: 'https://vladimirphoto.github.io/jonny-chat-tiktok/' },
      body: JSON.stringify({ _subject: b.subject, _captcha: 'false', _template: 'table', Сообщение: b.text, Связь: b.contact || 'не указано', Система: b.sys }),
    });
    clearTimeout(tm);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || String(j.success) === 'false') return { ok: false, error: 'Не удалось отправить письмо' + (j.message ? ': ' + String(j.message).slice(0, 160) : ' (код ' + r.status + ')'), fallback: true };
    lastBugAt = Date.now();
    return { ok: true };
  } catch (_) { return { ok: false, error: 'Нет связи с сервером', fallback: true }; }
});
ipcMain.handle('bug:mailto', (_e, d) => {
  const b = bugBody(d);
  const body = `${b.text}\n\n—\n${b.contact ? 'Связь: ' + b.contact + '\n' : ''}${b.sys}`;
  shell.openExternal(`mailto:${AUTHOR_MAIL}?subject=${encodeURIComponent(b.subject)}&body=${encodeURIComponent(body)}`).catch(() => {});
  return { ok: true };
});

ipcMain.handle('upd:check', async () => {
  try { const r = await updater.check(); if (r && r.ok && !trayUpd.busy) { trayUpd.version = r.available ? r.version : ''; rebuildTrayMenu(); } return r; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
ipcMain.handle('upd:install', async () => {
  try { return await updater.install((p) => send('upd:progress', p)); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

app.whenReady().then(async () => {
  if (!gotLock) return; // уже запущен другой экземпляр — он покажет своё окно
  ovHotkeyOn();
  try { wsrv = await widget.start(() => wset, 7878, {
      getDonate: () => donateWidgetSettings(),
      getLikes: () => ({ settings: lset, top: likesBoard.top(LIKES_MAX) }),
      getGifts: () => ({ settings: gset, top: giftsBoard.top(LIKES_MAX) }),
      getAlerts: () => alertWidgetSettings(),
      getAvatar: () => avWidgetSettings(),
      getAvatar3d: () => avWidgetSettings3d(),
      getTrackerPage: () => av.TRACKER_PAGE,
      getAvatarAsset: (u) => av.resolveAsset(avUD(), u),
      getDa: () => daWidgetSettings(),
      getDonateImage: () => { const i = donateImage(); if (!i) return null; try { return { mime: i.mime, data: require('fs').readFileSync(i.file) }; } catch (_) { return null; } },
      getDaImage: () => { const i = daImage(); if (!i || daSet.imageKind !== 'custom') return null; try { return { mime: i.mime, data: require('fs').readFileSync(i.file) }; } catch (_) { return null; } },
      getAlertImage: () => { const i = alertImage(); if (!i) return null; try { return { mime: i.mime, data: require('fs').readFileSync(i.file) }; } catch (_) { return null; } },
    }); } catch (_) { wsrv = null; }
  initLicense();
  if (!SELFTEST) daBoot();
  createWindow();
  if (useTray) { try { createTray(); } catch (_) { tray = null; } }
  if (startHidden && !tray) showWindow(); // трея нет — окно всё равно должно быть видно
  if (appSet.autostart) applyAutostart(); // путь в автозапуске обновляется, если программу переместили или обновили
  if (!SELFTEST) { netTick(); setInterval(netTick, 8000); }
  // прогрев: модуль, DNS и TLS-соединение готовы до первой фразы эфира (соединение остаётся в пуле)
  edgeSynth('Привет', 'ru-RU-SvetlanaNeural', 1, '+0Hz').catch(() => {});
  if (SELFTEST) require('./selftest').run(win, app);
});
app.on('window-all-closed', async () => {
  closeOverlay();
  closeAvatar();
  await disconnect();
  stopTwitch();
  try { wsrv && wsrv.close(); } catch (_) {}
  try { krx && krx.close(); } catch (_) {}
  stopDa();
  try { license && license.stop(); } catch (_) {}
  app.quit();
});
