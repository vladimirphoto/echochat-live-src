'use strict';
// Офлайн-голоса Silero. Движок написан на PyTorch, поэтому приложение держит свой Python с PyTorch в папке данных
// (ставится по кнопке, один раз; пользовательский Python не нужен и не трогается). Работает без интернета и без лимитов.
// Только Windows x64. Голоса: aidar, eugene (муж.), baya, kseniya, xenia (жен.).
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const PY_VER = '3.11.9';
const PY_URL = `https://www.python.org/ftp/python/${PY_VER}/python-${PY_VER}-embed-amd64.zip`;
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
const MODEL_URL = 'https://models.silero.ai/models/tts/ru/v5_ru.pt';
const SCRIPT_FILES = ['silero_server.py', 'silero_text.py'];

const VOICES = [
  { id: 'aidar', name: 'Айдар', gender: 'M' }, { id: 'eugene', name: 'Евгений', gender: 'M' },
  { id: 'baya', name: 'Бая', gender: 'F' }, { id: 'kseniya', name: 'Ксения', gender: 'F' }, { id: 'xenia', name: 'Ксения 2', gender: 'F' },
];

const has = (f) => { try { return fs.statSync(f).size > 1000; } catch (_) { return false; } };
const supported = (platform = process.platform, arch = process.arch) => platform === 'win32' && arch === 'x64';

function paths(userData) {
  const dir = path.join(userData, 'silero');
  return {
    dir, py: path.join(dir, 'python', 'python.exe'), app: path.join(dir, 'app'), script: path.join(dir, 'app', 'silero_server.py'),
    model: path.join(dir, 'model', 'v5_ru.pt'), marker: path.join(dir, 'installed.json'),
  };
}

// Python не читает файлы из asar-архива приложения: скрипты копируем рядом с ним (при каждом запуске, чтобы обновлялись вместе с приложением)
function copyScripts(userData, srcDir = path.join(__dirname, 'silero')) {
  const p = paths(userData);
  fs.mkdirSync(p.app, { recursive: true });
  for (const f of SCRIPT_FILES) fs.writeFileSync(path.join(p.app, f), fs.readFileSync(path.join(srcDir, f)));
}

const isInstalled = (userData) => { const p = paths(userData); return fs.existsSync(p.marker) && has(p.py) && has(p.model) && fs.existsSync(p.script); };

// ---------- клиент: один долгоживущий процесс, запросы по строкам JSON ----------
function createClient(opts) {
  const {
    pythonExe, pyArgs = [], script, modelPath = '', env = {}, spawnFn = spawn,
    readyMs = 120000,        // загрузка модели с диска при первом запуске
    reqMs = 20000,           // одна фраза
    failCooldownMs = 20000,  // после неудачного запуска не пытаемся стартовать заново сразу: озвучка идёт через Edge
  } = opts;
  let proc = null, readyP = null, nextId = 0, brokenUntil = 0, tail = '';
  const pending = new Map();

  const rejectAll = (e) => { for (const [id, q] of pending) { clearTimeout(q.timer); q.reject(e); pending.delete(id); } };
  const killProc = () => { const p = proc; proc = null; readyP = null; if (p) { try { p.stdin.destroy(); } catch (_) {} try { p.kill(); } catch (_) {} } };

  function start() {
    if (readyP) return readyP;
    if (Date.now() < brokenUntil) return Promise.reject(new Error('silero: недавний сбой запуска'));
    const rp = new Promise((resolve, reject) => {
      let settled = false, buf = '', t = null;
      const fail = (e) => { if (settled) return; settled = true; clearTimeout(t); brokenUntil = Date.now() + failCooldownMs; if (proc === p) killProc(); reject(e); };
      let p;
      try {
        p = spawnFn(pythonExe, [...pyArgs, script, modelPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...env } });
      } catch (e) { fail(e); return; }
      proc = p; tail = '';
      t = setTimeout(() => fail(new Error('silero: модель не загрузилась вовремя')), readyMs);
      const onLine = (line) => {
        let m; try { m = JSON.parse(line); } catch (_) { return; }
        if (m.ready === true) { if (!settled) { settled = true; clearTimeout(t); resolve(); } return; }
        if (m.ready === false) return fail(new Error('silero: ' + (m.error || 'не запустился')));
        const q = m.id != null && pending.get(m.id);
        if (!q) return;
        pending.delete(m.id); clearTimeout(q.timer);
        if (m.ok) q.resolve(Buffer.from(m.wav, 'base64'));
        else q.reject(Object.assign(new Error('silero: ' + (m.error || 'ошибка')), { code: m.error === 'empty' ? 'EMPTY' : 'FAIL' }));
      };
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); } });
      p.stderr.on('data', (d) => { tail = (tail + d).slice(-500); });
      p.on('error', (e) => fail(e));
      p.on('exit', (code) => {
        if (proc === p) { proc = null; readyP = null; }
        if (!settled) fail(new Error('silero: процесс завершился (код ' + code + ') ' + tail.replace(/\s+/g, ' ').trim()));
        else rejectAll(new Error('silero: процесс остановлен'));
      });
    });
    readyP = rp;
    rp.catch(() => { if (readyP === rp) readyP = null; });
    return rp;
  }

  async function synth(text, speaker, sr = 48000) {
    await start();
    const p = proc; const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('silero: таймаут')); if (proc === p) killProc(); }, reqMs); // зависший процесс перезапустится на следующей фразе
      pending.set(id, { resolve, reject, timer });
      try { p.stdin.write(JSON.stringify({ id, text, speaker, sr }) + '\n'); }
      catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
    });
  }
  const stop = () => { rejectAll(new Error('silero: остановлен')); killProc(); };
  return { start, synth, stop, get running() { return !!proc; } };
}

// ---------- установка ----------
function runCapture(cmd, args, o = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: o.timeout || 0, cwd: o.cwd }, (e, out, err) => {
      if (!e) return resolve(String(out));
      // файл, который только что распаковали, исчез: чаще всего его удалил антивирус
      if (e.code === 'ENOENT') return reject(new Error((o.what || cmd) + ': не найден файл ' + cmd + ' (возможно, его удалил антивирус)'));
      reject(new Error((o.what || cmd) + ': ' + String(String(err || out || e.message).trim()).split('\n').slice(-6).join(' ').slice(-400)));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// null — Python на месте и запускается, иначе текст причины
async function pythonProblem(py, run) {
  if (!has(py)) return 'python.exe не найден';
  try { await run(py, ['-c', 'import sys; print(sys.version_info[0])'], { what: 'проверка Python', timeout: 60000 }); return null; }
  catch (e) { return String((e && e.message) || e); }
}

// Свой Python: если рабочий уже стоит, ничего не делаем; если нет или он битый (прошлая установка оборвалась,
// файл удалил антивирус), ставим заново с чистой папки. Проверка идёт не сразу, а после паузы: антивирус нередко
// убирает файл через пару секунд после распаковки, и тогда ошибка вылезала позже, на шаге pip, как «spawn ... ENOENT».
async function ensurePython(p, say, { download, run, settleMs }) {
  if (!(await pythonProblem(p.py, run))) return;
  const pyDir = path.join(p.dir, 'python');
  let problem = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    fs.rmSync(pyDir, { recursive: true, force: true });
    const zip = path.join(p.dir, 'python.zip');
    say(0.01, 'Скачиваю Python');
    await download(PY_URL, zip, (f) => say(0.01 + f * 0.07, 'Скачиваю Python'));
    await run('powershell', ['-NoProfile', '-Command', 'Expand-Archive', '-LiteralPath', zip, '-DestinationPath', pyDir, '-Force'], { what: 'распаковка Python' });
    if (!has(p.py)) { // запасная распаковка: tar.exe есть в Windows 10 (1803) и новее
      try { fs.mkdirSync(pyDir, { recursive: true }); await run('tar', ['-xf', zip, '-C', pyDir], { what: 'распаковка Python (tar)' }); } catch (_) {}
    }
    fs.rmSync(zip, { force: true });
    if (settleMs > 0) await sleep(settleMs);
    problem = await pythonProblem(p.py, run);
    if (!problem) return;
  }
  let n = 0; try { n = fs.readdirSync(pyDir).length; } catch (_) {}
  throw new Error(has(p.py)
    ? 'Python не запускается: ' + problem
    : `python.exe пропал после распаковки (файлов в папке: ${n}). Похоже, его удалил антивирус: добавь папку ${p.dir} в исключения Защитника Windows и нажми «Установить» снова`);
}

async function install(userData, onProgress, deps = {}) {
  const { download, run = runCapture, createTestClient, assumeSupported = false, settleMs = 2500 } = deps;
  if (!assumeSupported && !supported()) throw new Error('Silero поддерживается только в Windows 64-бит');
  const p = paths(userData);
  const say = (frac, step) => { try { onProgress && onProgress(Math.min(1, Math.max(0, frac)), step); } catch (_) {} };
  fs.mkdirSync(p.dir, { recursive: true });
  fs.rmSync(p.marker, { force: true });

  await ensurePython(p, say, { download, run, settleMs });
  // во встраиваемом Python по умолчанию выключен site-packages: без этого pip не ставит пакеты
  const pyDir = path.join(p.dir, 'python');
  const pth = fs.readdirSync(pyDir).find((f) => /^python\d+\._pth$/i.test(f));
  if (pth) { const f = path.join(pyDir, pth); const s = fs.readFileSync(f, 'utf8'); if (/^#\s*import site/m.test(s)) fs.writeFileSync(f, s.replace(/^#\s*import site/m, 'import site')); }

  say(0.1, 'Устанавливаю pip');
  const pipOk = await run(p.py, ['-m', 'pip', '--version'], { what: 'pip' }).then(() => true, () => false);
  if (!pipOk) {
    const gp = path.join(p.dir, 'get-pip.py');
    await download(GET_PIP_URL, gp);
    const getPip = () => run(p.py, [gp, '--no-warn-script-location', '--disable-pip-version-check', '--retries', '10', '--timeout', '60'], { what: 'установка pip', timeout: 10 * 60 * 1000 });
    try { await getPip(); } catch (e) { if (!has(p.py)) throw e; await getPip(); } // сетевой сбой: одна повторная попытка (если Python исчез, повтор бесполезен)
    fs.rmSync(gp, { force: true });
  }

  // PyTorch — самый долгий шаг: размер заранее не известен, поэтому полоса плавно ползёт, пока pip работает
  say(0.15, 'Устанавливаю PyTorch (самый долгий шаг)');
  let frac = 0.15;
  const tick = setInterval(() => { frac = Math.min(0.8, frac + (0.8 - frac) * 0.04); say(frac, 'Устанавливаю PyTorch (самый долгий шаг)'); }, 3000);
  try { await run(p.py, ['-m', 'pip', 'install', '--no-warn-script-location', '--disable-pip-version-check', '--retries', '10', '--timeout', '60', 'torch', 'numpy'], { what: 'установка PyTorch', timeout: 45 * 60 * 1000 }); }
  finally { clearInterval(tick); }
  // pip мог отчитаться об успехе, а библиотека не загружается (битая распаковка, антивирус): ловим это сразу и понятно
  await run(p.py, ['-c', 'import torch, numpy'], { what: 'проверка PyTorch', timeout: 5 * 60 * 1000 });

  if (!has(p.model)) {
    say(0.82, 'Скачиваю голоса Silero');
    await download(MODEL_URL, p.model, (f) => say(0.82 + f * 0.13, 'Скачиваю голоса Silero'));
  }
  copyScripts(userData);

  // проверка по-настоящему: запускаем модель и просим сказать фразу; пока не получилось, установка не считается завершённой
  say(0.96, 'Проверяю озвучку');
  const c = (createTestClient || createClient)({ pythonExe: p.py, script: p.script, modelPath: p.model });
  try {
    const wav = await c.synth('Проверка голоса.', 'kseniya', 24000);
    if (!wav || wav.length < 2000) throw new Error('пустой звук');
  } finally { c.stop(); }
  fs.writeFileSync(p.marker, JSON.stringify({ at: Date.now(), py: PY_VER }));
  say(1, 'Готово');
}

function status(userData) {
  return { supported: supported(), installed: supported() && isInstalled(userData), voices: VOICES };
}

function clientFor(userData) {
  const p = paths(userData);
  return createClient({ pythonExe: p.py, script: p.script, modelPath: p.model });
}

module.exports = { VOICES, MODEL_URL, PY_URL, supported, paths, copyScripts, isInstalled, createClient, install, status, clientFor, runCapture };
