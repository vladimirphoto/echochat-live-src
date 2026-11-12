'use strict';
// оповещения о подписках: настройки, свои файлы, страница виджета, сервер, звук, подключение к событию подписки и сборка
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const A = require('../alerts');
const widget = require('../widget');
const PAGE = require('../widget-alert-page');
const root = (f) => path.join(__dirname, '..', f);
const read = (f) => fs.readFileSync(root(f), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'echo-alerts-'));

test('настройки: значения по умолчанию и границы', () => {
  assert.deepEqual(A.cleanSettings(), A.DEFAULTS);
  assert.deepEqual(A.cleanSettings({ duration: 1, scale: 999 }), { ...A.DEFAULTS, duration: 3, scale: 200 });
  assert.deepEqual(A.cleanSettings({ duration: 99, scale: 1 }), { ...A.DEFAULTS, duration: 20, scale: 50 });
  assert.equal(A.cleanSettings({ duration: 'мусор' }).duration, 6);
  const off = A.cleanSettings({ enabled: false, sound: false, showAvatar: false });
  assert.equal(off.enabled, false); assert.equal(off.sound, false); assert.equal(off.showAvatar, false);
  assert.equal(A.cleanSettings({ imageName: 'x'.repeat(500) }).imageName.length, 120);
});

test('свои файлы: расширение и размер проверяются, прежний файл заменяется', () => {
  const dir = tmp(), src = tmp();
  const png = path.join(src, 'logo.png'), jpg = path.join(src, 'pic.JPG'), txt = path.join(src, 'a.txt'), big = path.join(src, 'big.png');
  fs.writeFileSync(png, Buffer.from([1, 2, 3])); fs.writeFileSync(jpg, Buffer.from([4, 5])); fs.writeFileSync(txt, 'x');
  fs.writeFileSync(big, ''); fs.truncateSync(big, A.MAX_BYTES + 1);
  assert.equal(A.findImage(dir), null);
  assert.match(A.saveFile(dir, A.IMAGE_BASE, A.IMAGE_EXT, txt, 'image').error, /Нужен файл/);
  assert.match(A.saveFile(dir, A.IMAGE_BASE, A.IMAGE_EXT, big, 'image').error, /больше 5 МБ/);
  assert.match(A.saveFile(dir, A.IMAGE_BASE, A.IMAGE_EXT, path.join(src, 'нет.png'), 'image').error, /Не удалось открыть/);
  assert.equal(A.findImage(dir), null, 'после отказов ничего не сохранилось');
  const r1 = A.saveFile(dir, A.IMAGE_BASE, A.IMAGE_EXT, png, 'image');
  assert.deepEqual(r1, { ok: true, name: 'logo.png' });
  const f1 = A.findImage(dir);
  assert.equal(f1.mime, 'image/png'); assert.equal(f1.size, 3);
  assert.equal(A.saveFile(dir, A.IMAGE_BASE, A.IMAGE_EXT, jpg, 'image').ok, true); // расширение в верхнем регистре тоже принимается
  const f2 = A.findImage(dir);
  assert.equal(f2.mime, 'image/jpeg');
  assert.deepEqual(fs.readdirSync(dir), ['alert-image.jpg'], 'старый файл удалён');
  // звук и картинка не мешают друг другу
  assert.equal(A.saveFile(dir, A.SOUND_BASE, A.SOUND_EXT, png, 'sound').ok, false);
  const wav = path.join(src, 's.wav'); fs.writeFileSync(wav, 'RIFF');
  assert.equal(A.saveFile(dir, A.SOUND_BASE, A.SOUND_EXT, wav, 'sound').ok, true);
  assert.equal(A.findSound(dir).mime, 'audio/wav'); assert.equal(A.findImage(dir).mime, 'image/jpeg');
  A.clearFiles(dir, A.SOUND_BASE);
  assert.equal(A.findSound(dir), null); assert.ok(A.findImage(dir));
});

test('настройки виджета: версия картинки — время файла, без картинки 0', () => {
  const s = A.cleanSettings({ duration: 9, scale: 120, showAvatar: false });
  assert.deepEqual(A.widgetSettings(s, null), { duration: 9, scale: 120, align: 'center', vpos: 'middle', showAvatar: false, design: 'classic', imageV: 0 });
  assert.equal(A.widgetSettings(s, { mtime: 1700000000123 }).imageV, 1700000000123);
  assert.equal(A.widgetSettings(s, { mtime: 0 }).imageV, 1, 'картинка есть, даже если время файла 0');
});

test('страница: совпадает с docs/alert (npm run pages) и слушает оповещения и настройки', () => {
  assert.equal(read('docs/alert/index.html'), PAGE);
  assert.match(PAGE, /127\.0\.0\.1:'\+port\+'\/events/);
  assert.match(PAGE, /addEventListener\('alert'/);
  assert.match(PAGE, /addEventListener\('asettings'/);
  assert.match(PAGE, /\/alert-image\?v=/);
  assert.ok(!/<script[^>]+src=/i.test(PAGE), 'без внешних скриптов');
  // скрипт страницы собирается в валидный JS
  const m = /<script>([\s\S]*)<\/script>/.exec(PAGE);
  assert.doesNotThrow(() => new Function(m[1]));
});

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
function firstEvents(port) { // читаем начало потока событий и закрываем
  return new Promise((resolve, reject) => {
    const rq = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      setTimeout(() => { rq.destroy(); resolve(buf); }, 300);
    });
    rq.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
}

test('сервер виджета: страница, картинка с CORS, настройки в начале потока событий', async () => {
  const dir = tmp(), src = tmp();
  const png = path.join(src, 'logo.png'); fs.writeFileSync(png, Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  const ORIGIN = 'https://example.test';
  const srv = await widget.start(() => ({}), 38410, {
    origins: [ORIGIN],
    getAlerts: () => A.widgetSettings(A.cleanSettings({ duration: 7 }), A.findImage(dir)),
    getAlertImage: () => { const i = A.findImage(dir); return i ? { mime: i.mime, data: fs.readFileSync(i.file) } : null; },
  });
  try {
    assert.ok(srv.port, 'сервер запустился');
    const page = await get(srv.port, '/alert');
    assert.equal(page.status, 200); assert.equal(page.body.toString('utf8'), PAGE);
    assert.equal((await get(srv.port, '/alert-image')).status, 404, 'без картинки — 404');
    let ev = await firstEvents(srv.port);
    assert.match(ev, /event: asettings\ndata: \{[^\n]*"duration":7[^\n]*"imageV":0/);
    A.saveFile(dir, A.IMAGE_BASE, A.IMAGE_EXT, png, 'image');
    const img = await get(srv.port, '/alert-image?v=1', { Origin: ORIGIN });
    assert.equal(img.status, 200); assert.equal(img.headers['content-type'], 'image/png');
    assert.equal(img.headers['access-control-allow-origin'], ORIGIN);
    assert.deepEqual([...img.body], [137, 80, 78, 71, 1, 2, 3]);
    const other = await get(srv.port, '/alert-image', { Origin: 'https://evil.test' });
    assert.equal(other.headers['access-control-allow-origin'], undefined, 'чужой сайт картинку не получает через CORS');
    ev = await firstEvents(srv.port);
    assert.ok(!/"imageV":0/.test(ev.split('event: asettings')[1].split('\n\n')[0]), 'с картинкой версия не ноль');
    // оповещение доходит до подключённой страницы
    const got = new Promise((resolve) => {
      const rq = http.get({ host: '127.0.0.1', port: srv.port, path: '/events' }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; if (/event: alert\n/.test(buf)) { rq.destroy(); resolve(buf); } });
      });
      rq.on('error', () => {});
    });
    setTimeout(() => srv.broadcast('alert', { id: 'a1', name: 'Анна', avatar: '', test: true }), 150);
    assert.match(await got, /event: alert\ndata: \{"id":"a1","name":"Анна"/);
  } finally { srv.close(); }
});

const html = read('src/index.html'), js = read('src/renderer.js');
test('интерфейс: блок «Оповещения» во вкладке «Виджеты» со всеми элементами', () => {
  const tab = html.slice(html.indexOf('id="tab-widgets"'), html.indexOf('<!-- ДОНАТЫ КАСПИ -->'));
  for (const id of ['aImgPick', 'aImgName', 'aImgReset', 'aSoundTest', 'aSoundIcon', 'aSoundLbl', 'aSoundPick', 'aSoundName', 'aSoundReset', 'aDur', 'aDurVal', 'aScale', 'aScaleVal', 'aUrl', 'aCopy', 'aTest', 'alBox', 'alFrame']) {
    assert.ok(tab.includes(`id="${id}"`), 'нет #' + id + ' во вкладке «Виджеты»');
  }
  assert.equal((tab.match(/<div\b/g) || []).length, (tab.match(/<\/div>/g) || []).length, 'теги div закрыты');
  const keys = [...tab.matchAll(/data-ak="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ['enabled', 'showAvatar', 'sound']);
  for (const k of keys) assert.ok(k in A.DEFAULTS, 'ключ ' + k + ' есть в настройках по умолчанию');
});

test('интерфейс: настройки по умолчанию в окне те же, что в alerts.js', () => {
  const m = /alerts: (\{[^}]*\}),/.exec(js);
  assert.ok(m, 'в DEFAULTS окна есть alerts');
  assert.deepEqual(new Function('return (' + m[1] + ')')(), A.DEFAULTS);
});

test('звук оповещения: перед голосом «спасибо за подписку», очередь вне чата, выключение обрывает', () => {
  assert.match(js, /PRIO_SRC = new Set\(\[[^\]]*'alertSound'/);
  assert.match(js, /window\.echo\.onAlert\(\(\) => \{ if \(A\.sound\) enqueue\(\{ el: null, chime: true, alertChime: true, src: 'alertSound' \}, true\); \}\);/);
  assert.match(js, /dropSrc\('alertSound'\)/);
  assert.match(js, /if \(item\.alertChime\) \{ await playAlertChime\(\); return; \}/);
  assert.ok(js.indexOf('item.alertChime') < js.indexOf('if (item.chime) { await playChime()'), 'ветка оповещения раньше ветки доната');
  // главный процесс шлёт оповещение раньше события подписки: звук встаёт в очередь раньше голоса
  const main = read('main.js');
  const a = main.indexOf('fireAlert(u);'), b = main.indexOf("send('tt:follow', u);");
  assert.ok(a > 0 && b > a, 'fireAlert вызывается перед send(tt:follow)');
});

test('звук оповещения: свой файл играет вместо стандартного, не заиграл — стандартный; обрыв работает (заглушки Web Audio)', async () => {
  const start = js.indexOf('let actx = null;'), end = js.indexOf('async function speakItem');
  const code = js.slice(start, end);
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  const made = { osc: 0 };
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createGain() { return { gain: param(), connect() {} }; }
    createOscillator() { made.osc++; return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
    resume() {}
  }
  const played = [];
  let failNext = false;
  class FakeAudio {
    constructor(url) { this.url = url; played.push(url); }
    play() { if (failNext) { setTimeout(() => this.onerror && this.onerror(), 0); return Promise.resolve(); } setTimeout(() => this.onended && this.onended(), 0); return Promise.resolve(); }
    pause() {}
  }
  const make = new Function('window', 'S', 'Audio', `let chimeStop = null; ${code}; return { playAlertChime, playChime, setAlert: (v) => { alertSound = v; }, setDonate: (v) => { customSound = v; }, stop: () => chimeStop && chimeStop(), has: () => !!chimeStop };`);
  const api = make({ AudioContext: Ctx }, { vol: 80 }, FakeAudio);
  // стандартный звук: ноты создаются, обрыв завершает промис
  const p = api.playAlertChime();
  assert.ok(api.has(), 'играет — можно оборвать');
  api.stop(); await p;
  assert.ok(!api.has()); assert.ok(made.osc > 10, 'нот больше, чем у доната: блеск из шести нот');
  // свой звук оповещения и свой звук доната не путаются
  api.setAlert({ url: 'blob:alert' }); api.setDonate({ url: 'blob:donate' });
  const before = made.osc;
  await api.playAlertChime();
  assert.deepEqual(played, ['blob:alert']); assert.equal(made.osc, before, 'стандартный звук не играл');
  await api.playChime();
  assert.deepEqual(played, ['blob:alert', 'blob:donate']);
  // файл не заиграл — вместо него стандартный звук
  failNext = true;
  const q = api.playAlertChime();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(made.osc > before, 'после ошибки файла звучит стандартный'); api.stop(); await q;
});

test('сборка: новые файлы входят в exe, страница уходит на GitHub Pages', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const f of ['alerts.js', 'widget-alert-page.js', 'donationalerts.js', 'widget-da-page.js', 'da-auth-page.js']) assert.ok(pkg.build.files.includes(f), f + ' должен быть в build.files, иначе в exe его не будет');
  assert.match(read('.github/workflows/sync-public.yml'), /for d in chat donate likes gifts alert avatar da da-auth;/);
  assert.match(read('tools/build-pages.js'), /widget-alert-page/);
  assert.equal(widget.ALERT_PAGES_URL, 'https://vladimirphoto.github.io/jonny-chat-tiktok/alert/');
  // у новой версии есть запись «что нового» в окне и в README
  assert.match(js, new RegExp("'" + pkg.version.replace(/\./g, '\\.') + "': \\["));
});
