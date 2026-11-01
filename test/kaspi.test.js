'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const k = require('../kaspi');

test('сумма и имя: разные формулировки входящего перевода', () => {
  const cases = [
    ['Перевод. Айдос А. отправил(а) вам 1 000 ₸', 1000, 'Айдос А.'],
    ['Вам поступил перевод 2 500 ₸ от Анна К.', 2500, 'Анна К.'],
    ['Пополнение +15 000 ₸. Отправитель: Марат С.\nБаланс: 120 000 ₸', 15000, 'Марат С.'],
    ['Иван И. перевёл(а) вам 500 тг', 500, 'Иван И.'],
    ['Kaspi.kz: Перевод от Дина Н. 1 234,50 ₸', 1235, 'Дина Н.'],
    ['Перевод 3000 ₸', 3000, 'Аноним'],
  ];
  for (const [text, amount, name] of cases) {
    const r = k.parse(text);
    assert.equal(r.ok, true, text);
    assert.equal(r.amount, amount, text);
    assert.equal(r.name, name, text);
  }
});

test('баланс не принимается за сумму перевода', () => {
  const r = k.parse('Баланс: 120 000 ₸. Перевод от Аня Б. 700 ₸');
  assert.equal(r.amount, 700);
});

test('исходящие операции и покупки не считаются донатом', () => {
  for (const t of ['Покупка 4 500 ₸ Magnum', 'Вы перевели 2 000 ₸ Ивану И.', 'Списание 1 000 ₸', 'Оплата 5 000 ₸ Kaspi QR']) {
    assert.equal(k.parse(t).ok, false, t);
  }
});

test('сообщение к переводу', () => {
  const r = k.parse('Перевод от Мира Т. 1 000 ₸\nСообщение: Привет, стример!');
  assert.equal(r.message, 'Привет, стример!');
});

test('нестрогий режим: любой текст с суммой', () => {
  assert.equal(k.parse('Что-то на 900 ₸', { strict: false }).amount, 900);
  assert.equal(k.parse('Что-то на 900 ₸').ok, false);
});

test('текст из тела запроса: JSON, форма, простой текст', () => {
  assert.match(k.textFromBody('{"title":"Kaspi","text":"Перевод 1000 ₸"}', 'application/json'), /Перевод 1000/);
  assert.match(k.textFromBody('title=Kaspi&text=%D0%9F%D0%B5%D1%80%D0%B5%D0%B2%D0%BE%D0%B4+1000', 'application/x-www-form-urlencoded'), /Перевод 1000/);
  assert.equal(k.textFromBody('Перевод 1000 ₸', 'text/plain'), 'Перевод 1000 ₸');
});

test('приёмник: токен, разбор, отказ при неверном токене', async () => {
  const got = [];
  const cfg = { enabled: true, token: 'abc123' };
  const r = await k.startReceiver({ getConfig: () => cfg, onNotification: (t) => { got.push(t); return { accepted: true }; } });
  assert.ok(r.port >= k.PORT_FROM);
  const post = (path, body) => new Promise((res, rej) => {
    const q = http.request({ host: '127.0.0.1', port: r.port, path, method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' } }, (resp) => {
      let d = ''; resp.on('data', (c) => (d += c)); resp.on('end', () => res({ code: resp.statusCode, body: d }));
    });
    q.on('error', rej); q.end(body);
  });
  const ok = await post('/kaspi/abc123', 'Перевод 1000 ₸');
  assert.equal(ok.code, 200); assert.equal(JSON.parse(ok.body).accepted, true);
  assert.equal(got[0], 'Перевод 1000 ₸');
  assert.equal((await post('/kaspi/wrong', 'x')).code, 404);
  cfg.enabled = false;
  assert.equal((await post('/kaspi/abc123', 'x')).code, 404);
  r.close();
});

test('iOS-команда: валидный bplist с URL, POST и JSON {text: ввод}', () => {
  const sc = require('../shortcut');
  const buf = sc.buildShortcut('http://192.168.0.5:7899/kaspi/abc123');
  assert.equal(buf.slice(0, 8).toString(), 'bplist00');
  assert.ok(buf.includes(Buffer.from('http://192.168.0.5:7899/kaspi/abc123')));
  assert.ok(buf.includes(Buffer.from('is.workflow.actions.downloadurl')));
  assert.ok(buf.includes(Buffer.from('ExtensionInput')));
});

test('тестовые уведомления Каспи: сумма и отклонение исходящих', () => {
  const sc = require('../shortcut');
  for (const t of sc.TEST_NOTIFICATIONS) {
    const r = k.parse(t.text);
    if (t.reject) assert.equal(r.ok, false, t.text);
    else { assert.equal(r.ok, true, t.text); assert.equal(r.amount, t.amount, t.text); assert.equal(r.name, t.name, t.text); }
  }
});

test('раздача команды: только с верным токеном; JSON {"text"} разбирается', async () => {
  const cfg = { enabled: true, token: 'tok999' }, got = [];
  const r = await k.startReceiver({ getConfig: () => cfg, onNotification: (t) => { got.push(t); return { accepted: true }; }, getShortcut: async () => ({ buf: Buffer.from('bplist00x') }) });
  const get = (path) => new Promise((res) => http.get({ host: '127.0.0.1', port: r.port, path, agent: false }, (x) => { let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => res({ code: x.statusCode, d })); }));
  assert.equal((await get('/shortcut/tok999/EchoChat-Kaspi.shortcut')).code, 200);
  assert.equal((await get('/shortcut/bad/EchoChat-Kaspi.shortcut')).code, 404);
  assert.equal((await get('/kaspi/tok999/ping')).code, 200);
  assert.equal((await get('/kaspi/bad/ping')).code, 404);
  await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port: r.port, path: '/kaspi/tok999', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json' } }, (x) => { x.resume(); x.on('end', res); }); q.end(JSON.stringify({ text: 'Перевод 1000 ₸' })); });
  assert.match(got[0], /Перевод 1000/);
  r.close();
});

test('шаблон команды: вопрос при импорте про адрес', () => {
  const sc = require('../shortcut');
  const b = sc.buildTemplate();
  assert.equal(b.slice(0, 8).toString(), 'bplist00');
  assert.ok(b.includes(Buffer.from('WFWorkflowImportQuestions')) && b.includes(Buffer.from('ParameterKey')));
});

test('Piper: аргументы без shell, скорость через length_scale', () => {
  const te = require('../tts-engines');
  const a = te.piperArgs('m.onnx', 'o.wav', 2);
  assert.deepEqual(a.slice(0, 4), ['--model', 'm.onnx', '--output_file', 'o.wav']);
  assert.equal(a[5], '0.50');
  assert.equal(te.piperArgs('m', 'o', 0.1)[5], '2.00');
});

test('обновление: берётся новейший релиз с EXE, пред-релизы и релизы без EXE пропускаются', () => {
  const u = require('../updater.js');
  const exe = (v, extra = {}) => ({ tag_name: 'v' + v, assets: [{ name: `E-${v}.exe`, browser_download_url: 'u' + v, size: 1 }], ...extra });
  const list = [{ tag_name: 'v1.12.0', assets: [{ name: 'a.dmg' }] }, exe('1.11.9', { prerelease: true }), exe('1.11.0'), exe('1.10.1')];
  assert.equal(u.pickRelease(list).version, '1.11.0');
  assert.equal(u.pickRelease([]), null);
});
test('обновление: установленная версия берёт установщик, portable — обычный exe', () => {
  const u = require('../updater.js');
  const rel = (v, names) => ({ tag_name: 'v' + v, assets: names.map((n) => ({ name: n, browser_download_url: n, size: 1 })) });
  const both = [rel('1.20.0', ['EchoChat-LIVE-1.20.0.exe', 'EchoChat-LIVE-Setup-1.20.0.exe'])];
  assert.equal(u.pickRelease(both, true).asset.name, 'EchoChat-LIVE-Setup-1.20.0.exe');
  assert.equal(u.pickRelease(both, false).asset.name, 'EchoChat-LIVE-1.20.0.exe');
  const mixed = [rel('1.20.0', ['EchoChat-LIVE-1.20.0.exe']), rel('1.19.0', ['EchoChat-LIVE-Setup-1.19.0.exe'])];
  assert.equal(u.pickRelease(mixed, true).version, '1.19.0'); // выпуск без установщика установленной версии не подходит
  assert.equal(u.pickRelease(mixed, false).version, '1.20.0');
});
test('ссылка iCloud: только официальный адрес команды', () => {
  const sc = require('../shortcut');
  assert.equal(sc.isICloudLink('https://www.icloud.com/shortcuts/4e916b32ae1b47efbe3d85395359ceaa'), true);
  assert.equal(sc.isICloudLink('https://evil.example/shortcuts/abc'), false);
  assert.equal(sc.isICloudLink(''), false);
});
