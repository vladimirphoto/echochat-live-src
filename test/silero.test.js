'use strict';
// Silero: подготовка текста, клиент процесса (на заглушке, без PyTorch), установщик (на подмене загрузок)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const silero = require('../silero');

const SCRIPT_DIR = path.join(__dirname, '..', 'silero');
const SERVER = path.join(SCRIPT_DIR, 'silero_server.py');
const PY = (() => { for (const c of ['python3', 'python']) { try { execFileSync(c, ['-c', '1'], { stdio: 'ignore' }); return c; } catch (_) {} } return null; })();
const skip = PY ? false : 'нет Python';
const client = (stub, o = {}) => silero.createClient({ pythonExe: PY, pyArgs: ['-I'], script: SERVER, env: { ECHO_SILERO_STUB: stub }, ...o });
const isWav = (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE';

test('подготовка текста: числа, латиница, символы, пустота', { skip }, () => {
  const cases = [
    ['Привет, мир!', 'привет, мир!'], ['Мне 25 лет', 'мне двадцать пять лет.'], ['lol', 'лол.'], ['100%', 'сто процентов.'],
    ['2+2', 'два плюс два.'], ['😀😀', ''], ['ахахах!!!', 'ахахах!'], ['3,5 часа', 'три запятая пять часа.'],
    ['1000 и 21 и 2000 и 5000000', 'одна тысяча и двадцать один и две тысячи и пять миллионов.'], ['...', ''], ['Hello World', 'хелло ворлд.'],
    ['100500', 'сто тысяч пятьсот.'], ['12000', 'двенадцать тысяч.'], ['ёлка', 'ёлка.'],
  ];
  const code = `import sys, json\nsys.path.insert(0, ${JSON.stringify(SCRIPT_DIR)})\nfrom silero_text import prepare\nprint(json.dumps([prepare(c) for c in json.loads(sys.stdin.read())], ensure_ascii=False))`;
  const out = JSON.parse(execFileSync(PY, ['-I', '-c', code], { input: JSON.stringify(cases.map((c) => c[0])), encoding: 'utf8' }));
  assert.deepEqual(out, cases.map((c) => c[1]));
});

test('клиент: фраза возвращает WAV, параллельные запросы не путаются', { skip }, async () => {
  const c = client('1');
  try {
    const one = await c.synth('Привет, чат!', 'aidar', 24000);
    assert.ok(isWav(one) && one.length > 1000);
    const many = await Promise.all(Array.from({ length: 8 }, (_, i) => c.synth('фраза ' + i, i % 2 ? 'baya' : 'eugene', 48000)));
    assert.ok(many.every(isWav));
    assert.ok(c.running);
  } finally { c.stop(); }
});

test('клиент: нечего читать — код EMPTY; неверный голос — ошибка, а процесс жив', { skip }, async () => {
  const c = client('1');
  try {
    await assert.rejects(c.synth('😀😀', 'aidar'), (e) => e.code === 'EMPTY');
    await assert.rejects(c.synth('привет', 'nobody'), /unknown speaker/);
    assert.ok(isWav(await c.synth('привет', 'xenia')));
  } finally { c.stop(); }
});

test('клиент: зависание — таймаут, процесс убирается и стартует заново', { skip }, async () => {
  const c = client('hang', { reqMs: 500 });
  try {
    await assert.rejects(c.synth('привет', 'aidar'), /таймаут/);
    assert.equal(c.running, false);
    await assert.rejects(c.synth('привет', 'aidar'), /таймаут/); // новый процесс запускался (и тоже завис)
  } finally { c.stop(); }
});

test('клиент: падение процесса на фразе — ошибка вместо вечного ожидания, потом новый запуск', { skip }, async () => {
  const c = client('crash');
  try {
    await assert.rejects(c.synth('привет', 'aidar'), /процесс остановлен/);
    assert.equal(c.running, false);
  } finally { c.stop(); }
});

test('клиент: не удалось запустить — быстрый отказ и пауза перед новой попыткой', { skip }, async () => {
  const c = silero.createClient({ pythonExe: path.join(os.tmpdir(), 'нет-такого-python'), script: SERVER, failCooldownMs: 60000 });
  await assert.rejects(c.synth('привет', 'aidar'));
  const t0 = Date.now();
  await assert.rejects(c.synth('привет', 'aidar'), /недавний сбой/);
  assert.ok(Date.now() - t0 < 100);
});

test('клиент: нет файла модели — понятная ошибка запуска', { skip }, async () => {
  const c = silero.createClient({ pythonExe: PY, pyArgs: ['-I'], script: SERVER, modelPath: path.join(os.tmpdir(), 'нет-модели.pt') });
  await assert.rejects(c.synth('привет', 'aidar'), /model file not found/);
});

test('установщик: шаги по порядку, маркер только после успешной проверки голоса', async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-sil-'));
  const log = [];
  const p = silero.paths(ud);
  const download = async (url, dest) => { log.push('dl ' + path.basename(dest)); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.alloc(5000, 1)); };
  const run = async (cmd, args) => {
    log.push('run ' + path.basename(cmd) + ' ' + args.slice(0, 3).join(' '));
    if (cmd === 'powershell') { const d = path.join(p.dir, 'python'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'python.exe'), Buffer.alloc(5000)); fs.writeFileSync(path.join(d, 'python311._pth'), 'python311.zip\n.\n#import site\n'); }
    if (args[0] === '-m' && args[1] === 'pip' && args[2] === '--version') throw new Error('нет pip');
    return '';
  };
  const stages = [];
  const okClient = () => ({ synth: async () => Buffer.alloc(5000), stop() {} });
  await silero.install(ud, (f, s) => stages.push([f, s]), { download, run, createTestClient: okClient, assumeSupported: true, settleMs: 0 });
  assert.ok(fs.existsSync(p.marker)); assert.ok(silero.isInstalled(ud));
  assert.match(fs.readFileSync(path.join(p.dir, 'python', 'python311._pth'), 'utf8'), /^import site$/m);
  const pipInstall = log.findIndex((l) => /pip install/.test(l)), model = log.indexOf('dl v5_ru.pt'), getPip = log.indexOf('dl get-pip.py');
  assert.ok(getPip > 0 && pipInstall > getPip && model > pipInstall, log.join(' | '));
  assert.ok(fs.existsSync(p.script)); // скрипты скопированы рядом с Python
  assert.equal(stages[stages.length - 1][0], 1);
  assert.ok(stages.every(([f], i) => i === 0 || f >= stages[i - 1][0] - 1e-9), 'полоса не идёт назад');

  // сбой проверки голоса: установка не считается завершённой
  fs.rmSync(p.marker);
  const badClient = () => ({ synth: async () => { throw new Error('silero: не запустился'); }, stop() {} });
  await assert.rejects(silero.install(ud, null, { download, run, createTestClient: badClient, assumeSupported: true, settleMs: 0 }), /не запустился/);
  assert.equal(silero.isInstalled(ud), false);
});

test('установщик: не Windows — понятный отказ; статус без установки', async () => {
  if (silero.supported()) return;
  await assert.rejects(silero.install(os.tmpdir(), null, {}), /только в Windows/);
  const st = silero.status(fs.mkdtempSync(path.join(os.tmpdir(), 'echo-sil-')));
  assert.equal(st.installed, false); assert.equal(st.supported, false); assert.equal(st.voices.length, 5);
});

test('установщик: python.exe исчез после распаковки — понятная ошибка про антивирус, а не «spawn ENOENT»', async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-sil-'));
  const p = silero.paths(ud);
  let downloads = 0;
  const download = async (url, dest) => { downloads++; fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.alloc(5000, 1)); };
  const run = async (cmd) => { // «распаковка» кладёт файлы, но python.exe нет (его удалил антивирус)
    if (cmd === 'powershell') { const d = path.join(p.dir, 'python'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'python311.dll'), Buffer.alloc(5000)); }
    return '';
  };
  await assert.rejects(silero.install(ud, null, { download, run, assumeSupported: true, settleMs: 0 }), (e) => /python\.exe пропал/.test(e.message) && /антивирус/.test(e.message) && /файлов в папке: 1/.test(e.message) && !/ENOENT/.test(e.message));
  assert.equal(downloads, 2, 'одна повторная попытка с чистой папки');
  assert.equal(silero.isInstalled(ud), false);
});

test('установщик: битый Python (есть, но не запускается) ставится заново', async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-sil-'));
  const p = silero.paths(ud);
  fs.mkdirSync(path.dirname(p.py), { recursive: true });
  fs.writeFileSync(p.py, Buffer.alloc(5000)); fs.writeFileSync(path.join(path.dirname(p.py), 'stale.txt'), 'старьё');
  let downloads = 0, broken = true;
  const download = async (url, dest) => { downloads++; fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.alloc(5000, 1)); };
  const run = async (cmd, args) => {
    if (cmd === 'powershell') { broken = false; const d = path.join(p.dir, 'python'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'python.exe'), Buffer.alloc(5000)); fs.writeFileSync(path.join(d, 'python311._pth'), '#import site\n'); }
    if (cmd === p.py && args[0] === '-c' && broken) throw new Error('проверка Python: не запускается');
    if (args[0] === '-m' && args[2] === '--version') throw new Error('нет pip');
    return '';
  };
  await silero.install(ud, null, { download, run, createTestClient: () => ({ synth: async () => Buffer.alloc(5000), stop() {} }), assumeSupported: true, settleMs: 0 });
  assert.ok(downloads >= 3 && silero.isInstalled(ud)); // Python, get-pip, модель
  assert.equal(fs.existsSync(path.join(path.dirname(p.py), 'stale.txt')), false, 'старая папка очищена');
});

test('установщик: pip и PyTorch ставятся с повторами и таймаутом сети, импорт проверяется', async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-sil-'));
  const p = silero.paths(ud);
  fs.mkdirSync(path.dirname(p.py), { recursive: true }); fs.writeFileSync(p.py, Buffer.alloc(5000));
  const calls = [];
  const download = async (url, dest) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.alloc(5000, 1)); };
  const run = async (cmd, args) => { calls.push(args.join(' ')); if (args[0] === '-m' && args[2] === '--version') throw new Error('нет pip'); return ''; };
  await silero.install(ud, null, { download, run, createTestClient: () => ({ synth: async () => Buffer.alloc(5000), stop() {} }), assumeSupported: true, settleMs: 0 });
  const inst = calls.find((c) => /pip install/.test(c));
  assert.match(inst, /--retries 10/); assert.match(inst, /--timeout 60/);
  assert.ok(calls.some((c) => c === '-c import torch, numpy'), 'после pip проверяется import torch');
  // import torch не прошёл: установка падает с понятным шагом
  fs.rmSync(p.marker, { force: true });
  const run2 = async (cmd, args) => { if (args[0] === '-c' && /torch/.test(args[1])) throw new Error('проверка PyTorch: DLL load failed'); return ''; };
  await assert.rejects(silero.install(ud, null, { download, run: run2, assumeSupported: true, settleMs: 0 }), /проверка PyTorch/);
  assert.equal(silero.isInstalled(ud), false);
});

test('запуск программы: отсутствующий файл — понятное сообщение, а не «spawn ENOENT»', async () => {
  await assert.rejects(silero.runCapture(path.join(os.tmpdir(), 'нет-такого', 'python.exe'), ['-V'], { what: 'установка pip' }), (e) => /установка pip/.test(e.message) && /антивирус/.test(e.message) && !/ENOENT/.test(e.message));
});
