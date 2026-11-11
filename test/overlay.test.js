'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ov = require('../overlay');

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const clock = (t0 = 1000) => { let t = t0; const f = () => t; f.set = (v) => { t = v; }; return f; };

test('оверлей: настройки по умолчанию и ограничение чисел', () => {
  assert.deepEqual(ov.cleanSettings({}), { opacity: 100, onTop: true, locked: false, events: true, joins: true, stats: true, hearts: true, hotkey: 'Ctrl+Alt+I' });
  const s = ov.cleanSettings({ opacity: -5, scale: 9999, onTop: false, locked: true, events: false, stats: false });
  assert.deepEqual(s, { opacity: 0, onTop: false, locked: true, events: false, joins: true, stats: false, hearts: true, hotkey: 'Ctrl+Alt+I' }); // масштаба больше нет
  assert.equal(ov.cleanSettings({ opacity: 500 }).opacity, 100);
  assert.equal(ov.cleanSettings({ opacity: 'мусор' }).opacity, 100);
  assert.equal(ov.cleanSettings({ opacity: 64.6 }).opacity, 65);
});

test('оверлей: лишние поля отбрасываются, частичное обновление не сбрасывает остальное', () => {
  const base = ov.cleanSettings({ opacity: 70, onTop: false });
  const s = ov.cleanSettings({ locked: true, hack: '<script>', onTop: 'yes' }, base);
  assert.equal(s.opacity, 70);       // осталось из base
  assert.equal(s.locked, true);      // пришло в обновлении
  assert.equal(s.onTop, false);      // не boolean — игнорируется, остаётся из base
  assert.ok(!('hack' in s));
  assert.deepEqual(ov.cleanSettings(null), ov.DEFAULTS);
  assert.deepEqual(ov.cleanSettings('строка'), ov.DEFAULTS);
});

test('оверлей: положение окна восстанавливается, только если оно видно на экране', () => {
  assert.deepEqual(ov.fitBounds({ x: 100, y: 80, width: 400, height: 560 }, [AREA]), { x: 100, y: 80, width: 400, height: 560 });
  assert.equal(ov.fitBounds({ x: 5000, y: 80, width: 400, height: 560 }, [AREA]), null); // монитор отключили
  assert.equal(ov.fitBounds({ x: -390, y: 80, width: 400, height: 560 }, [AREA]), null); // торчит край в 10 px — не взяться
  assert.deepEqual(ov.fitBounds({ x: 1700, y: 100, width: 400, height: 560 }, [AREA]), { x: 1700, y: 100, width: 400, height: 560 }); // 220 px видно
  // второй монитор справа
  assert.ok(ov.fitBounds({ x: 2000, y: 100, width: 400, height: 560 }, [AREA, { x: 1920, y: 0, width: 1920, height: 1040 }]));
  assert.equal(ov.fitBounds(null, [AREA]), null);
  assert.equal(ov.fitBounds({ x: 'a', y: 1, width: 1, height: 1 }, [AREA]), null);
  assert.equal(ov.fitBounds({ x: 10, y: 10, width: 400, height: 560 }, []), null);
});

test('оверлей: размер окна ограничивается', () => {
  const b = ov.fitBounds({ x: 0, y: 0, width: 10, height: 10 }, [AREA]);
  assert.equal(b.width, ov.SIZE.minW); assert.equal(b.height, ov.SIZE.minH);
  const c = ov.fitBounds({ x: 0, y: 0, width: 99999, height: 99999 }, [AREA]);
  assert.equal(c.width, ov.SIZE.maxW); assert.equal(c.height, ov.SIZE.maxH);
});

test('оверлей: по умолчанию окно справа внизу и помещается на маленьком экране', () => {
  const d = ov.defaultBounds(AREA);
  assert.equal(d.width, 400); assert.equal(d.height, 560);
  assert.ok(d.x + d.width <= AREA.width && d.y + d.height <= AREA.height && d.x > 0 && d.y > 0);
  const small = ov.defaultBounds({ x: 0, y: 0, width: 300, height: 500 });
  assert.ok(small.width <= 300 && small.x >= 0);
});

test('модель: сообщения TikTok и Twitch попадают в ленту с платформой и цветом', () => {
  const m = new ov.OverlayModel({ color: (n) => '#' + n.length });
  const a = m.track('tt:chat', { name: 'Аня', text: 'привет', avatar: 'https://x/a.png' });
  const b = m.track('tw:chat', { name: 'Max', text: 'hello' });
  assert.equal(a.entry.platform, 'tiktok'); assert.equal(a.entry.kind, 'chat'); assert.equal(a.entry.color, '#3');
  assert.equal(b.entry.platform, 'twitch');
  assert.equal(m.feed().length, 2);
  assert.ok(b.entry.id > a.entry.id);
  assert.equal(b.stats, false); // чат Twitch счётчики не трогает
  assert.equal(m.stats().likes, 0); assert.equal(m.stats().gifts, 0);
});

test('модель: пустые сообщения и неизвестные каналы игнорируются', () => {
  const m = new ov.OverlayModel();
  assert.equal(m.track('tt:chat', { name: 'A', text: '   ' }).entry, null);
  assert.equal(m.track('tw:chat', { name: 'A' }).entry, null);
  assert.equal(m.track('tray:set', { key: 'x' }).entry, null);
  assert.equal(m.track('tt:chat').entry, null);
  assert.equal(m.feed().length, 0);
});

test('модель: имя и текст ограничены по длине, без имени — «Гость»', () => {
  const m = new ov.OverlayModel();
  const e = m.track('tt:chat', { name: 'x'.repeat(500), text: 'y'.repeat(5000) }).entry;
  assert.equal(e.name.length, 60); assert.equal(e.text.length, 500);
  assert.equal(m.track('tt:chat', { text: 'привет' }).entry.name, 'Гость');
});

test('модель: лента не растёт бесконечно', () => {
  const m = new ov.OverlayModel({ max: 5 });
  for (let i = 0; i < 12; i++) m.track('tt:chat', { name: 'A', text: 'm' + i });
  const f = m.feed();
  assert.equal(f.length, 5);
  assert.equal(f[0].text, 'm7'); assert.equal(f[4].text, 'm11');
  m.clearFeed(); assert.equal(m.feed().length, 0);
});

test('модель: подарки и подписки — записи в ленте и счётчики', () => {
  const m = new ov.OverlayModel();
  const g = m.track('tt:gift', { name: 'Дина', gift: 'Rose', count: 3, image: 'https://x/g.png' });
  assert.equal(g.stats, true);
  assert.deepEqual(g.entry.gift, { name: 'Rose', count: 3, image: 'https://x/g.png' });
  m.track('tt:gift', { name: 'Дина', gift: 'Rose', count: 2 });
  const f = m.track('tt:follow', { name: 'Игорь' });
  assert.equal(f.entry.kind, 'follow');
  m.track('tt:follow', { name: 'Олег' });
  const s = m.stats();
  assert.equal(s.gifts, 5); assert.equal(s.follows, 2);
  assert.equal(m.track('tt:gift', { name: 'X', gift: 'Y', count: 0 }).entry.gift.count, 1); // 0 и мусор считаются за 1
  assert.equal(m.track('tt:gift', { name: 'X' }).entry.gift.name, 'подарок');
});

test('модель: лайки считаются как в главном окне (итог TikTok надёжнее суммы)', () => {
  const m = new ov.OverlayModel();
  m.track('tt:like', { count: 3, total: 100 }); assert.equal(m.stats().likes, 100);
  m.track('tt:like', { count: 2, total: null }); assert.equal(m.stats().likes, 102);
  m.track('tt:like', { count: 1, total: 0 }); assert.equal(m.stats().likes, 103);   // 0 — «итога нет»
  m.track('tt:like', { count: 5, total: 50 }); assert.equal(m.stats().likes, 103);  // итог не уменьшает счётчик
  m.track('tt:like', {}); assert.equal(m.stats().likes, 104);                       // без данных — один лайк
});

test('модель: зрители TikTok и Twitch', () => {
  const m = new ov.OverlayModel();
  assert.equal(m.track('tt:viewers', { count: 1234 }).stats, true);
  assert.equal(m.stats().ttViewers, 1234);
  assert.equal(m.track('tt:viewers', { count: NaN }).stats, false);
  assert.equal(m.track('tt:viewers', {}).stats, false);
  assert.equal(m.stats().ttViewers, 1234);
  m.track('tw:viewers', { count: 17 }); assert.equal(m.stats().twViewers, 17);
  assert.equal(m.track('tw:viewers', { count: 17 }).stats, false); // не изменилось — не шлём лишнего
  m.track('tw:viewers', { count: null }); assert.equal(m.stats().twViewers, null); // стрима нет — прочерк
});

test('модель: таймер идёт с первой платформы и останавливается, когда не осталось ни одной', () => {
  const t = clock(1000);
  const m = new ov.OverlayModel({ now: t });
  assert.equal(m.stats().since, 0);
  m.track('tt:status', { state: 'live' });
  assert.equal(m.stats().since, 1000); assert.equal(m.stats().ttOn, true);
  t.set(5000);
  m.track('tw:status', { state: 'live' });
  assert.equal(m.stats().since, 1000, 'вторая платформа таймер не сбрасывает');
  m.track('tt:status', { state: 'offline' });
  assert.equal(m.stats().since, 1000, 'Twitch ещё подключён — таймер идёт');
  m.track('tw:status', { state: 'reconnect' });
  assert.equal(m.stats().twOn, true); assert.equal(m.stats().since, 1000, 'переподключение — это всё ещё эфир');
  m.track('tw:status', { state: 'offline' });
  assert.equal(m.stats().since, 0); assert.equal(m.stats().twOn, false);
  t.set(9000);
  m.track('tt:status', { state: 'live' });
  assert.equal(m.stats().since, 9000, 'новый эфир — таймер с нуля');
});

test('модель: после окончания эфира TikTok счётчики обнуляются, а лента остаётся', () => {
  const m = new ov.OverlayModel();
  m.track('tt:status', { state: 'live' });
  m.track('tt:viewers', { count: 50 }); m.track('tt:like', { count: 1, total: 99 });
  m.track('tt:gift', { name: 'A', gift: 'Rose', count: 2 }); m.track('tt:follow', { name: 'B' });
  m.track('tw:viewers', { count: 7 });
  m.track('tt:status', { state: 'ended' });
  const s = m.stats();
  assert.deepEqual([s.likes, s.gifts, s.follows, s.ttViewers, s.ttOn], [0, 0, 0, null, false]);
  assert.equal(s.twViewers, 7, 'онлайн Twitch от TikTok не зависит');
  assert.equal(m.feed().length, 2);
});

test('модель: Twitch отключён — его онлайн сбрасывается', () => {
  const m = new ov.OverlayModel();
  m.track('tw:status', { state: 'live' }); m.track('tw:viewers', { count: 3 });
  m.track('tw:status', { state: 'offline' });
  assert.equal(m.stats().twViewers, null);
});

test('примеры для «Теста» содержат обе платформы, подарок, подписку, репост и лайки', () => {
  const k = new Set(ov.SAMPLE.map((e) => e.platform + ':' + e.kind));
  for (const x of ['tiktok:chat', 'twitch:chat', 'tiktok:gift', 'tiktok:follow', 'tiktok:share', 'tiktok:like']) assert.ok(k.has(x), x);
});

test('оверлей: «ник теперь с нами» — не запись ленты, один раз на зрителя; просмотры за эфир считаются без повторов', () => {
  const m = new ov.OverlayModel({ now: clock() });
  const a = m.track('tt:join', { id: 'anna', name: 'Анна' });
  assert.equal(a.entry, null);                                      // в ленте чата записей «кто зашёл» нет
  assert.equal(a.join.name, 'Анна');                                // а для строки внизу данные есть
  assert.equal(m.feed().length, 0);
  assert.equal(m.track('tt:join', { id: 'anna', name: 'Анна' }).join, null); // вернулся — не повторяем
  m.track('tt:join', { id: 'bob', name: 'Боб' });
  assert.equal(m.stats().views, 2);
  m.track('tt:chat', { id: 'anna', name: 'Анна', text: 'привет' }); // уже учтена
  m.track('tt:chat', { id: 'kate', name: 'Катя', text: 'привет' }); // зашла раньше, чем мы подключились
  assert.equal(m.stats().views, 3);
  assert.equal(m.track('tt:join', { name: 'Гость' }).join, null);   // без имени не показываем
  assert.equal(m.feed().length, 2);                                 // в ленте только два сообщения чата
});

test('оверлей: просмотры — число от TikTok, если оно больше собственного счёта; сбрасываются с эфиром', () => {
  const m = new ov.OverlayModel({ now: clock() });
  m.track('tt:status', { state: 'live' });
  m.track('tt:join', { id: 'a', name: 'А' });
  m.track('tt:views', { count: 340 });
  assert.equal(m.stats().views, 340);
  m.track('tt:views', { count: 12 }); // число от TikTok не уменьшается
  assert.equal(m.stats().views, 340);
  m.track('tt:status', { state: 'offline' });
  assert.equal(m.stats().views, null);
  assert.equal(m.track('tt:join', { id: 'a', name: 'А' }).join.name, 'А'); // новый эфир — снова «с нами»
});

test('оверлей: настройка «кто зашёл на эфир» включена по умолчанию и отключается', () => {
  assert.equal(ov.cleanSettings({}).joins, true);
  assert.equal(ov.cleanSettings({ joins: false }).joins, false);
});

test('оверлей: «В угол экрана» сохраняет выбранный размер, а не возвращает 100%', () => {
  const c = ov.cornerBounds(AREA, { x: 50, y: 50, width: 640, height: 900 });
  assert.equal(c.width, 640); assert.equal(c.height, 900);
  assert.equal(c.x, 1920 - 640 - 24); assert.equal(c.y, 1040 - 900 - 24);
  const small = ov.cornerBounds({ x: 0, y: 0, width: 500, height: 600 }, { width: 900, height: 900 }); // больше экрана — вписывается
  assert.ok(small.width <= 500 && small.height <= 600 && small.x >= 0 && small.y >= 0);
  const min = ov.cornerBounds(AREA, { width: 10, height: 10 }); // слишком мало — минимальный размер
  assert.equal(min.width, ov.SIZE.minW); assert.equal(min.height, ov.SIZE.minH);
  assert.equal(ov.cornerBounds(AREA, null).width, ov.SIZE.defW); // размера нет — стандартный
});

test('оверлей: значок Twitch нужен, только когда канал подключён И стрим идёт (есть число зрителей)', () => {
  const m = new ov.OverlayModel();
  assert.equal(m.stats().twLive, false);                                    // Twitch не подключён
  m.track('tw:status', { state: 'live' });
  assert.equal(m.stats().twOn, true);
  assert.equal(m.stats().twLive, false, 'чат подключён, но стрима нет — значка с прочерком быть не должно');
  m.track('tw:viewers', { count: 0 });
  assert.equal(m.stats().twLive, true, '0 зрителей — это всё равно идущий стрим');
  m.track('tw:viewers', { count: 25 });
  assert.equal(m.stats().twLive, true);
  m.track('tw:viewers', { count: null });                                   // стрим закончился
  assert.equal(m.stats().twLive, false);
  m.track('tw:viewers', { count: 9 });
  m.track('tw:status', { state: 'reconnect' });
  assert.equal(m.stats().twLive, true, 'при переподключении значок не мигает');
  m.track('tw:status', { state: 'offline' });
  assert.equal(m.stats().twLive, false, 'Twitch отключён — значок убирается');
  assert.equal(m.stats().twViewers, null);
});

test('оверлей: репост — строка в ленте, счётчики подписок и подарков не трогает', () => {
  const m = new ov.OverlayModel();
  const r = m.track('tt:share', { id: 'rustam', name: 'Рустам', avatar: 'https://x/a.png' });
  assert.equal(r.entry.kind, 'share'); assert.equal(r.entry.platform, 'tiktok'); assert.equal(r.entry.name, 'Рустам');
  assert.equal(r.stats, false); assert.equal(r.like, 0);
  const s = m.stats(); assert.equal(s.follows, 0); assert.equal(s.gifts, 0);
  assert.equal(m.track('tt:share', {}).entry.name, 'Гость');
  assert.equal(m.feed().length, 2);
  assert.equal(m.stats().views, 1, 'репост — это зритель эфира, он учитывается в просмотрах');
});

test('оверлей: лайки не попадают в ленту, а отдают число сердечек', () => {
  const m = new ov.OverlayModel();
  const r = m.track('tt:like', { count: 4, total: 120 });
  assert.equal(r.entry, null); assert.equal(r.like, 4); assert.equal(r.stats, true);
  assert.equal(m.feed().length, 0);
  assert.equal(m.stats().likes, 120);
  assert.equal(m.track('tt:like', {}).like, 1);                             // без данных — один лайк
  assert.equal(m.track('tt:like', { count: 0 }).like, 1);
  assert.equal(m.track('tt:like', { count: 'мусор' }).like, 1);
  assert.equal(m.track('tt:chat', { name: 'A', text: 'hi' }).like, 0);
});

test('оверлей: подарок в ленте несёт количество', () => {
  const m = new ov.OverlayModel();
  const e = m.track('tt:gift', { name: 'Дина', gift: 'Роза', count: 7 }).entry;
  assert.equal(e.kind, 'gift'); assert.equal(e.gift.count, 7); assert.equal(e.gift.name, 'Роза');
});

test('оверлей: настройка «лайки» (сердечки) включена по умолчанию и отключается', () => {
  assert.equal(ov.cleanSettings({}).hearts, true);
  assert.equal(ov.cleanSettings({ hearts: false }).hearts, false);
  assert.equal(ov.cleanSettings({ hearts: 'нет' }, ov.cleanSettings({ hearts: false })).hearts, false); // не boolean — остаётся прежнее
});

test('оверлей: лайк с известным ником отдаёт его для строки внизу, анонимный — только сердечки', () => {
  const m = new ov.OverlayModel({ color: () => '#abc' });
  const r = m.track('tt:like', { name: 'Тимур', id: 'timur', avatar: 'https://x/t.png', count: 5, total: 50 });
  assert.deepEqual(r.liker, { name: 'Тимур', avatar: 'https://x/t.png', color: '#abc', count: 5 });
  assert.equal(r.like, 5); assert.equal(r.entry, null); assert.equal(m.feed().length, 0);
  assert.equal(m.track('tt:like', { name: 'Гость', count: 2 }).liker, null);
  assert.equal(m.track('tt:like', { count: 2 }).liker, null);
  assert.equal(m.track('tt:like', { name: 'x'.repeat(300), count: 1 }).liker.name.length, 60);
  assert.equal(m.track('tt:like', { name: 'Аня' }).liker.count, 1);
  assert.equal(m.track('tt:chat', { name: 'A', text: 'hi' }).liker, null);
});

test('оверлей: горячая клавиша по умолчанию Ctrl+Alt+I, своё сочетание приводится к каноническому виду', () => {
  assert.equal(ov.DEFAULTS.hotkey, 'Ctrl+Alt+I');
  assert.equal(ov.cleanSettings({}).hotkey, 'Ctrl+Alt+I');
  assert.equal(ov.cleanSettings({ hotkey: 'shift+ctrl+o' }).hotkey, 'Ctrl+Shift+O');
  assert.equal(ov.cleanSettings({ hotkey: 'Alt+F9' }).hotkey, 'Alt+F9');
  assert.equal(ov.cleanSettings({ hotkey: 'F8' }).hotkey, 'F8'); // функциональная клавиша можно и без модификатора
  assert.equal(ov.cleanSettings({ hotkey: 'Ctrl+Alt+Up' }).hotkey, 'Ctrl+Alt+Up');
  assert.equal(ov.cleanSettings({ hotkey: 'Ctrl+Ctrl+K' }).hotkey, 'Ctrl+K');
});

test('оверлей: пустое сочетание выключает горячую клавишу, мусор не принимается', () => {
  assert.equal(ov.cleanSettings({ hotkey: '' }).hotkey, '');
  const base = ov.cleanSettings({ hotkey: 'Ctrl+Shift+L' });
  for (const bad of ['I', 'Ctrl+', 'Ctrl+Alt', 'Ctrl+A+B', 'Ctrl+Alt+<script>', 'Ctrl+Alt+F25', 123, null, {}]) {
    assert.equal(ov.cleanSettings({ hotkey: bad }, base).hotkey, 'Ctrl+Shift+L', String(bad)); // остаётся прежнее
  }
  assert.equal(ov.cleanSettings({ opacity: 50 }, base).hotkey, 'Ctrl+Shift+L'); // другие настройки сочетание не трогают
  assert.equal(ov.cleanSettings({ opacity: 50 }, { opacity: 100 }).hotkey, 'Ctrl+Alt+I'); // в старом overlay.json сочетания нет — берётся по умолчанию
  assert.equal(ov.cleanSettings({}, ov.cleanSettings({ hotkey: '' })).hotkey, ''); // выключенное остаётся выключенным
});

test('оверлей: значок Sub — только у подписчиков (isFollower === true), у неизвестных и неподписанных его нет', () => {
  const m = new ov.OverlayModel({ color: () => '#abc' });
  const yes = m.track('tt:chat', { name: 'Анна', id: 'anna', text: 'привет', isFollower: true }).entry;
  const no = m.track('tt:chat', { name: 'Борис', id: 'boris', text: 'привет', isFollower: false }).entry;
  const unknown = m.track('tt:chat', { name: 'Вера', id: 'vera', text: 'привет', isFollower: null }).entry;
  assert.equal(yes.sub, true);
  assert.ok(!('sub' in no), 'неподписанному значок не нужен');
  assert.ok(!('sub' in unknown), 'статус неизвестен — значка нет');
  // Twitch значок Sub не получает, даже если в событии есть isFollower
  assert.ok(!('sub' in m.track('tw:chat', { name: 'Max', text: 'hi', isFollower: true }).entry));
});

test('оверлей: значок Sub у входа, лайка, подарка и репоста; у строки подписки его нет', () => {
  const m = new ov.OverlayModel({ color: () => '#abc' });
  assert.equal(m.track('tt:join', { name: 'Алина', id: 'alina', isFollower: true }).join.sub, true);
  assert.ok(!('sub' in m.track('tt:join', { name: 'Тимур', id: 'timur', isFollower: false }).join));
  assert.equal(m.track('tt:like', { name: 'Дина', id: 'dina', count: 2, isFollower: true }).liker.sub, true);
  assert.equal(m.track('tt:gift', { name: 'Дина', id: 'dina', gift: 'Роза', count: 1, isFollower: true }).entry.sub, true);
  assert.equal(m.track('tt:share', { name: 'Рустам', id: 'rus', isFollower: true }).entry.sub, true);
  assert.ok(!('sub' in m.track('tt:follow', { name: 'Игорь', id: 'igor', isFollower: true }).entry), 'в строке «подписался(ась)» значка нет');
});

test('оверлей: кто подписался во время эфира, получает значок сразу, даже если TikTok ещё не обновил его статус', () => {
  const m = new ov.OverlayModel({ color: () => '#abc' });
  assert.ok(!('sub' in m.track('tt:chat', { name: 'Игорь', id: 'igor', text: 'до подписки', isFollower: false }).entry));
  m.track('tt:follow', { name: 'Игорь', id: 'igor' });
  assert.equal(m.track('tt:chat', { name: 'Игорь', id: 'igor', text: 'после', isFollower: false }).entry.sub, true);
  assert.equal(m.track('tt:chat', { name: 'Игорь', id: 'igor', text: 'после 2' }).entry.sub, true);
  assert.ok(!('sub' in m.track('tt:chat', { name: 'Другой', id: 'other', text: 'х', isFollower: false }).entry), 'чужая подписка значок не даёт');
  // эфир закончился — память о подписавшихся в этом эфире сбрасывается
  m.track('tt:status', { state: 'offline' });
  assert.ok(!('sub' in m.track('tt:chat', { name: 'Игорь', id: 'igor', text: 'новый эфир', isFollower: false }).entry));
});

test('оверлей: в примерах «Теста» есть подписчики со значком и неподписанный зритель', () => {
  const chats = ov.SAMPLE.filter((e) => e.platform === 'tiktok' && e.kind === 'chat');
  assert.ok(chats.some((e) => e.sub === true) && chats.some((e) => !e.sub));
  assert.ok(ov.SAMPLE.some((e) => e.kind === 'join' && e.sub) && ov.SAMPLE.some((e) => e.kind === 'like' && e.name && e.sub) && ov.SAMPLE.some((e) => e.kind === 'gift' && e.sub));
});

test('закреп: сообщение чата закрепляется на срок и сам исчезает по истечении', () => {
  const t = clock(10000);
  const m = new ov.OverlayModel({ now: t, color: () => '#6b7280' });
  assert.equal(m.getPin(), null);
  const e = m.track('tt:chat', { name: 'Madara', text: 'ты уже 15 лет куришь?', isFollower: true }).entry;
  const p = m.setPin(e, 1);
  assert.equal(p.until, 10000 + 60000);
  assert.equal(p.entry.name, 'Madara'); assert.equal(p.entry.text, 'ты уже 15 лет куришь?'); assert.equal(p.entry.sub, true);
  t.set(10000 + 59999); assert.ok(m.getPin());
  t.set(10000 + 60000); assert.equal(m.getPin(), null, 'через минуту закреп снимается');
  assert.equal(m.setPin(e, 5).until, t() + 300000);
  m.clearPin(); assert.equal(m.getPin(), null);
});

test('закреп: «до конца эфира» не истекает по времени, а эфир снимает любой закреп', () => {
  const t = clock(1000);
  const m = new ov.OverlayModel({ now: t });
  m.track('tt:status', { state: 'live' });
  const e = m.track('tt:chat', { name: 'A', text: 'важно' }).entry;
  assert.equal(m.setPin(e, 'end').until, 0);
  t.set(1000 + 5 * 3600 * 1000); assert.ok(m.getPin(), 'пять часов спустя закреп на месте');
  m.track('tw:status', { state: 'live' });
  assert.equal(m.track('tt:status', { state: 'offline' }).pinCleared, false, 'Twitch ещё идёт — эфир не закончился');
  assert.ok(m.getPin());
  const r = m.track('tw:status', { state: 'offline' });
  assert.equal(r.pinCleared, true); assert.equal(m.getPin(), null);
  // закреп с таймером тоже снимается концом эфира
  m.track('tt:status', { state: 'live' });
  m.setPin(e, 60); assert.equal(m.track('tt:status', { state: 'offline' }).pinCleared, true);
  // без эфира (проверка «Тест») закреп живёт по своему сроку и не считается снятым
  assert.equal(m.track('tt:status', { state: 'offline' }).pinCleared, false);
});

test('закреп: чужие и неверные данные отбрасываются, поля чистятся', () => {
  const m = new ov.OverlayModel();
  assert.equal(m.setPin(null, 5), null);
  assert.equal(m.setPin('x', 5), null);
  assert.equal(m.setPin({ kind: 'gift', name: 'A', text: 'x' }, 5), null, 'закрепить можно только сообщение чата');
  assert.equal(m.setPin({ kind: 'chat', name: 'A', text: '   ' }, 5), null, 'пустое не закрепляется');
  const ok = { kind: 'chat', name: 'A', text: 'привет' };
  assert.equal(m.setPin(ok, 0).until, 0, '0 — то же, что до конца эфира');
  assert.equal(m.setPin(ok, 'мусор'), null);
  assert.equal(m.setPin(ok, -3), null);
  assert.equal(m.setPin(ok, 24 * 60 + 1), null, 'дольше суток — нельзя');
  assert.ok(m.setPin(ok, 24 * 60));
  const p = m.setPin({ kind: 'chat', platform: 'evil', name: 'x'.repeat(500), text: 'y'.repeat(5000), avatar: 'z'.repeat(900), color: 'url(javascript:1)', sub: 'yes', hack: '<script>' }, 5);
  assert.equal(p.entry.platform, 'tiktok'); assert.equal(p.entry.name.length, 60); assert.equal(p.entry.text.length, 500); assert.equal(p.entry.avatar.length, 500);
  assert.equal(p.entry.color, '#6b7280'); assert.ok(!('sub' in p.entry)); assert.ok(!('hack' in p.entry));
  assert.equal(m.setPin({ kind: 'chat', platform: 'twitch', name: 'T', text: 'hi' }, 5).entry.platform, 'twitch');
});

test('закреп: очистка ленты закреп не трогает, а getPin отдаёт копию', () => {
  const m = new ov.OverlayModel();
  const e = m.track('tt:chat', { name: 'A', text: 'держим' }).entry;
  m.setPin(e, 'end');
  m.clearFeed();
  const p = m.getPin(); assert.equal(p.entry.text, 'держим');
  p.entry.text = 'испорчено'; assert.equal(m.getPin().entry.text, 'держим');
});
