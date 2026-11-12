'use strict';
// Аватар (Live2D + трекинг лица по камере). Модуль без зависимостей от Electron: его проверяют обычными тестами.
// Идея взята из VTubeLeaf (MIT, github.com/moonrailgun/vtubeleaf): MediaPipe читает лицо, Live2D-персонаж повторяет его.
// Файлы Live2D (ядро Cubism и образцы моделей) в приложение не вшиваются: они скачиваются на компьютер человека из официального пакета Live2D,
// остальные компоненты — из npm и Google. Всё лежит в папке данных приложения (avatar/runtime) и отдаётся страницам виджета локальным сервером.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const https = require('https');
const { downloadWithRetry } = require('./fetch-retry');

// ---------- настройки ----------
const DEFAULTS = { model: 'builtin-Haru', scale: 100, offsetX: 0, offsetY: 0, mirror: false, bg: 'transparent', camera: '' };
const clampN = (v, a, b, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
const MODEL_ID = /^(builtin-(Haru|Hiyori|Mao)|user-[0-9a-f]{8})$/;
function cleanSettings(s, base) {
  const b = { ...DEFAULTS, ...(base || {}) };
  s = s || {};
  return {
    model: typeof s.model === 'string' && MODEL_ID.test(s.model) ? s.model : (MODEL_ID.test(b.model) ? b.model : DEFAULTS.model),
    scale: clampN(s.scale !== undefined ? s.scale : b.scale, 40, 250, 100),
    offsetX: clampN(s.offsetX !== undefined ? s.offsetX : b.offsetX, -100, 100, 0),
    offsetY: clampN(s.offsetY !== undefined ? s.offsetY : b.offsetY, -100, 100, 0),
    mirror: s.mirror !== undefined ? !!s.mirror : !!b.mirror,
    bg: ['transparent', 'green'].includes(s.bg) ? s.bg : (['transparent', 'green'].includes(b.bg) ? b.bg : 'transparent'),
    camera: typeof s.camera === 'string' ? s.camera.slice(0, 300) : String(b.camera || '').slice(0, 300),
  };
}

// ---------- безопасные пути ----------
// Имя файла из архива или папки → относительный путь с «/», либо null, если он выходит за пределы папки или подозрителен
function safeRel(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return null;
  const n = name.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (!n || n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return null;
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.some((p) => p === '..')) return null;
  return parts.join('/');
}
const inside = (base, file) => { const r = path.relative(base, file); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
function writeFileSafe(base, rel, data) {
  const r = safeRel(rel);
  if (!r) throw new Error('Небезопасный путь в архиве: ' + rel);
  const dest = path.join(base, ...r.split('/'));
  if (!inside(base, dest)) throw new Error('Небезопасный путь в архиве: ' + rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}

// ---------- архивы ----------
const cstr = (buf, off, len) => { let e = off; const end = off + len; while (e < end && buf[e] !== 0) e++; return buf.toString('utf8', off, e); };
// .tar.gz (так устроены пакеты npm): { name, data } для каждого обычного файла
function readTarGz(gz) {
  const tar = zlib.gunzipSync(gz);
  const out = [];
  let off = 0, longName = null, pax = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    let name = cstr(h, 0, 100);
    const size = parseInt(cstr(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = cstr(h, 345, 155);
    if (prefix) name = prefix + '/' + name;
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > tar.length) throw new Error('Повреждённый архив');
    const data = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = cstr(data, 0, size); continue; }
    if (type === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8')); if (m) pax = m[1]; continue; }
    if (type === 'g') continue;
    if (longName) { name = longName; longName = null; }
    if (pax) { name = pax; pax = null; }
    if (type === '0' || type === '\0') out.push({ name, data });
  }
  return out;
}
// .zip: список записей с ленивым чтением. Поддерживает хранение и deflate; zip64 не поддерживается (нужен для файлов больше 4 ГБ)
function readZip(buf, limits) {
  const lim = { files: 20000, bytes: 1024 * 1024 * 1024, ...(limits || {}) };
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Это не zip-архив или он повреждён');
  const count = buf.readUInt16LE(e + 10), cdOff = buf.readUInt32LE(e + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new Error('zip64 не поддерживается');
  if (count > lim.files) throw new Error('В архиве слишком много файлов');
  const entries = [];
  let p = cdOff, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Повреждённый zip-архив');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (name.endsWith('/')) continue; // папка
    total += usize;
    if (total > lim.bytes) throw new Error('Архив слишком большой после распаковки');
    entries.push({
      name, size: usize,
      read() {
        if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new Error('Повреждённый zip-архив');
        const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
        const raw = buf.subarray(start, start + csize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(usize, 1) + 16 });
        throw new Error('Неподдерживаемый способ сжатия в zip');
      },
    });
  }
  return entries;
}

// ---------- сеть ----------
const UA = 'echochat-live';
function httpGet(url, opts = {}) {
  const maxBytes = opts.maxBytes || 400 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const go = (u, left) => {
      const req = https.get(u, { headers: { 'User-Agent': UA }, timeout: 30000 }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (left <= 0) return reject(Object.assign(new Error('Слишком много перенаправлений'), { fatal: true }));
          return go(new URL(res.headers.location, u).toString(), left - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          const err = new Error('Сервер ответил ' + res.statusCode);
          if (res.statusCode < 500 && res.statusCode !== 408 && res.statusCode !== 429) err.fatal = true;
          return reject(err);
        }
        const total = +res.headers['content-length'] || 0;
        const chunks = []; let got = 0;
        res.on('data', (c) => {
          got += c.length;
          if (got > maxBytes) { req.destroy(Object.assign(new Error('Файл слишком большой'), { fatal: true })); return; }
          chunks.push(c);
          if (opts.onProgress) opts.onProgress(got, total);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Нет ответа от сервера')));
      req.on('error', reject);
    };
    go(url, 5);
  });
}
const defaultFetch = (url, o) => downloadWithRetry(() => httpGet(url, o));

// проверка целостности: sha256 (hex) или integrity npm («sha512-…» в base64)
function checkIntegrity(buf, { sha256, integrity, shasum }) {
  if (sha256) return crypto.createHash('sha256').update(buf).digest('hex') === String(sha256).toLowerCase();
  if (integrity) {
    const m = /^(sha512|sha256|sha384)-(.+)$/.exec(integrity);
    if (m) return crypto.createHash(m[1]).update(buf).digest('base64') === m[2];
  }
  if (shasum) return crypto.createHash('sha1').update(buf).digest('hex') === String(shasum).toLowerCase();
  return false;
}

// ---------- компоненты ----------
// Версии зафиксированы (те же, что в VTubeLeaf). У пакетов npm целостность сверяется со значением из реестра, у файла Google и пакета Live2D — с зашитой суммой SHA-256.
const SAMPLE_MODELS = ['Haru', 'Hiyori', 'Mao'];
const COMPONENTS = [
  { id: 'pixi', title: 'PixiJS (рисование)', kind: 'npm', pkg: 'pixi.js', version: '6.5.10', check: ['pixi.min.js'], pick: (n) => (n === 'package/dist/browser/pixi.min.js' ? 'pixi.min.js' : null), approxMb: 1.5 },
  { id: 'live2d', title: 'Live2D для PixiJS', kind: 'npm', pkg: 'pixi-live2d-display', version: '0.4.0', check: ['cubism4.min.js'], pick: (n) => (n === 'package/dist/cubism4.min.js' ? 'cubism4.min.js' : null), approxMb: 0.5 },
  {
    id: 'mediapipe', title: 'MediaPipe (поиск лица)', kind: 'npm', pkg: '@mediapipe/tasks-vision', version: '0.10.32',
    check: ['mediapipe/vision_bundle.mjs'], needAny: { dir: 'mediapipe/wasm', ext: '.wasm' }, // набор wasm-файлов отличается между версиями пакета: достаточно, чтобы они были
    pick: (n) => (n === 'package/vision_bundle.mjs' ? 'mediapipe/vision_bundle.mjs' : (/^package\/wasm\/[\w.-]+$/.test(n) ? 'mediapipe/wasm/' + n.slice('package/wasm/'.length) : null)),
    approxMb: 12,
  },
  {
    id: 'face', title: 'Модель лица MediaPipe', kind: 'file', url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    size: 3758596, sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff', to: 'mediapipe/face_landmarker.task', check: ['mediapipe/face_landmarker.task'], approxMb: 3.6,
  },
  {
    id: 'cubism', title: 'Ядро Live2D и модели Haru, Hiyori, Mao', kind: 'zip', url: 'https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.4.zip',
    sha256: 'd78904d908bd232b800219e01732e4ea2f0562b5e9f35a2670742a1c16d22942',
    check: ['live2dcubismcore.min.js', ...SAMPLE_MODELS.map((m) => `models/${m}/${m}.model3.json`)],
    pick: (n) => {
      const x = /^[^/]+\/(.+)$/.exec(n); if (!x) return null; const r = x[1];
      if (r === 'Core/live2dcubismcore.min.js') return 'live2dcubismcore.min.js';
      if (r === 'LICENSE.md') return 'licenses/live2d-sdk-LICENSE.md';
      if (r === 'Core/LICENSE.md') return 'licenses/live2d-core-LICENSE.md';
      const mm = /^Samples\/Resources\/(Haru|Hiyori|Mao)\/(.+)$/.exec(r);
      if (mm && !/\.(wav|mp3|ogg)$/i.test(mm[2])) return 'models/' + mm[1] + '/' + mm[2]; // голоса моделей не нужны: мы не проигрываем движения со звуком
      return null;
    },
    approxMb: 60,
  },
];
const runtimeDir = (userData) => path.join(userData, 'avatar', 'runtime');
const userModelsDir = (userData) => path.join(userData, 'avatar', 'models');
const manifestFile = (userData) => path.join(runtimeDir(userData), 'installed.json');
function readManifest(userData) { try { const j = JSON.parse(fs.readFileSync(manifestFile(userData), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch (_) { return {}; } }
function componentOk(userData, c, man) {
  const m = man || readManifest(userData);
  const ver = c.version || c.url;
  if (m[c.id] !== ver) return false;
  const okFiles = c.check.every((f) => isFile(path.join(runtimeDir(userData), ...f.split('/'))));
  if (!okFiles) return false;
  if (c.needAny) { try { return fs.readdirSync(path.join(runtimeDir(userData), ...c.needAny.dir.split('/'))).some((n) => n.endsWith(c.needAny.ext)); } catch (_) { return false; } }
  return true;
}
function status(userData) {
  const man = readManifest(userData);
  const items = COMPONENTS.map((c) => ({ id: c.id, title: c.title, ok: componentOk(userData, c, man), approxMb: c.approxMb }));
  return { ready: items.every((i) => i.ok), items, totalMb: Math.round(COMPONENTS.reduce((a, c) => a + c.approxMb, 0)) };
}

// Скачивает и ставит недостающие компоненты. opts.fetch(url, { onProgress }) → Buffer — подмена в тестах; opts.onProgress({ id, title, phase, done, total, index, count })
async function install(userData, opts = {}) {
  const get = opts.fetch || defaultFetch;
  const rt = runtimeDir(userData);
  fs.mkdirSync(rt, { recursive: true });
  const todo = COMPONENTS.filter((c) => !componentOk(userData, c));
  const note = (c, i, phase, done, total) => opts.onProgress && opts.onProgress({ id: c.id, title: c.title, phase, done: done || 0, total: total || 0, index: i + 1, count: todo.length });
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    note(c, i, 'download');
    const prog = (done, total) => note(c, i, 'download', done, total);
    let files = []; // { rel, data }
    if (c.kind === 'npm') {
      const metaUrl = 'https://registry.npmjs.org/' + c.pkg.replace('/', '%2f') + '/' + c.version;
      const meta = JSON.parse((await get(metaUrl, { maxBytes: 5 * 1024 * 1024 })).toString('utf8'));
      const dist = meta && meta.dist;
      if (!dist || !/^https:\/\/registry\.npmjs\.org\//.test(dist.tarball || '')) throw new Error(`${c.title}: реестр npm не вернул адрес пакета`);
      const gz = await get(dist.tarball, { onProgress: prog });
      if (!checkIntegrity(gz, dist)) throw new Error(`${c.title}: пакет не прошёл проверку целостности`);
      note(c, i, 'unpack');
      for (const f of readTarGz(gz)) { const rel = c.pick(f.name); if (rel) files.push({ rel, data: f.data }); }
    } else if (c.kind === 'file') {
      const buf = await get(c.url, { onProgress: prog });
      if (buf.length !== c.size || !checkIntegrity(buf, c)) throw new Error(`${c.title}: файл не прошёл проверку целостности`);
      files.push({ rel: c.to, data: buf });
    } else {
      const zip = await get(c.url, { onProgress: prog });
      if (!checkIntegrity(zip, c)) throw new Error(`${c.title}: архив не прошёл проверку целостности`);
      note(c, i, 'unpack');
      for (const en of readZip(zip)) { const rel = c.pick(en.name); if (rel) files.push({ rel, data: en.read() }); }
    }
    const have = new Set(files.map((f) => f.rel));
    const miss = c.check.filter((f) => !have.has(f));
    if (c.needAny && ![...have].some((f) => f.startsWith(c.needAny.dir + '/') && f.endsWith(c.needAny.ext))) miss.push(c.needAny.dir + '/*' + c.needAny.ext);
    if (miss.length) throw new Error(`${c.title}: в скачанном пакете нет файлов: ${miss.join(', ')}`);
    for (const f of files) writeFileSafe(rt, f.rel, f.data);
    const man = readManifest(userData);
    man[c.id] = c.version || c.url;
    fs.writeFileSync(manifestFile(userData), JSON.stringify(man));
  }
  return status(userData);
}

// ---------- модели ----------
const MIME = {
  '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.moc3': 'application/octet-stream', '.task': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.html': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

// Файлы, на которые ссылается .model3.json (без звуков: их мы не проигрываем)
function modelRefs(json) {
  const r = (json && json.FileReferences) || {};
  const out = { required: [], optional: [] };
  if (typeof r.Moc === 'string') out.required.push(r.Moc);
  for (const t of Array.isArray(r.Textures) ? r.Textures : []) if (typeof t === 'string') out.required.push(t);
  for (const k of ['Physics', 'Pose', 'DisplayInfo', 'UserData']) if (typeof r[k] === 'string') out.optional.push(r[k]);
  for (const x of Array.isArray(r.Expressions) ? r.Expressions : []) if (x && typeof x.File === 'string') out.optional.push(x.File);
  for (const g of Object.values(r.Motions && typeof r.Motions === 'object' ? r.Motions : {})) for (const m of Array.isArray(g) ? g : []) if (m && typeof m.File === 'string') out.optional.push(m.File);
  return out;
}
// files — Set относительных путей (в нижнем регистре не приводим: на Windows и в архивах регистр важен для ссылок)
function validateModelFiles(files, entry) {
  let doc;
  try { doc = JSON.parse(files.get(entry).toString('utf8')); } catch (_) { return { ok: false, error: 'Файл модели повреждён: не читается ' + path.posix.basename(entry) }; }
  if (!doc || typeof doc !== 'object' || !doc.FileReferences || typeof doc.FileReferences.Moc !== 'string') return { ok: false, error: 'Это не модель Live2D: в ' + path.posix.basename(entry) + ' нет ссылки на файл .moc3' };
  if (+doc.Version < 3) return { ok: false, error: 'Поддерживаются модели Cubism 3 и 4 (.model3.json).' };
  const dir = path.posix.dirname(entry);
  const abs = (f) => safeRel(dir === '.' ? f : dir + '/' + f);
  const refs = modelRefs(doc);
  const missing = [];
  for (const f of [...refs.required, ...refs.optional]) { const a = abs(f); if (!a || !files.has(a)) missing.push(f); }
  if (missing.length) return { ok: false, error: 'В модели не хватает файлов: ' + missing.slice(0, 5).join(', ') + (missing.length > 5 ? ' и ещё ' + (missing.length - 5) : '') + '. Нужна папка или архив целиком, а не один .model3.json.' };
  return { ok: true, name: path.posix.basename(entry).replace(/\.model3\.json$/i, '') || 'Модель' };
}
// Выбирает главный .model3.json (самый «мелкий» по вложенности)
function pickEntry(paths) {
  const list = paths.filter((p) => /\.model3\.json$/i.test(p)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return list[0] || null;
}

const LIMIT_FILES = 3000, LIMIT_BYTES = 400 * 1024 * 1024;
function walkDir(root) {
  const out = []; let total = 0;
  const rec = (d, rel) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.isSymbolicLink()) continue;
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) rec(path.join(d, ent.name), r);
      else if (ent.isFile()) {
        const st = fs.statSync(path.join(d, ent.name));
        total += st.size;
        if (out.length >= LIMIT_FILES || total > LIMIT_BYTES) throw new Error('Папка модели слишком большая');
        out.push(r);
      }
    }
  };
  rec(root, '');
  return out;
}
// Добавляет свою модель: src — папка, .zip или .model3.json. Возвращает { ok, id, name } или { ok: false, error }
function importModel(userData, src) {
  try {
    const st = fs.statSync(src);
    const files = new Map(); // относительный путь → null (содержимое читаем через reader только когда нужно)
    let reader, entry; // reader: rel → Buffer
    if (st.isDirectory() || /\.model3\.json$/i.test(src)) {
      const root = st.isDirectory() ? src : path.dirname(src);
      const rels = walkDir(root);
      reader = (rel) => fs.readFileSync(path.join(root, ...rel.split('/')));
      for (const r of rels) files.set(r, null);
      entry = st.isDirectory() ? pickEntry(rels) : path.basename(src);
      if (!entry) return { ok: false, error: 'В папке нет файла .model3.json. Выберите папку модели Live2D (Cubism 3 или 4).' };
    } else if (/\.zip$/i.test(src)) {
      const ents = readZip(fs.readFileSync(src), { files: LIMIT_FILES, bytes: LIMIT_BYTES });
      const map = new Map();
      for (const e of ents) { const r = safeRel(e.name); if (r && !/(^|\/)__MACOSX\//.test(r)) map.set(r, e); }
      for (const r of map.keys()) files.set(r, null);
      reader = (rel) => map.get(rel).read();
      entry = pickEntry([...map.keys()]);
      if (!entry) return { ok: false, error: 'В архиве нет файла .model3.json. Нужна модель Live2D Cubism 3 или 4.' };
    } else return { ok: false, error: 'Выберите папку модели, архив .zip или файл .model3.json.' };
    // проверка по содержимому главного файла
    const probe = new Map(files); probe.set(entry, reader(entry));
    const v = validateModelFiles(probe, entry);
    if (!v.ok) return v;
    const baseDir = path.posix.dirname(entry);
    const copy = [...files.keys()].filter((r) => baseDir === '.' || r.startsWith(baseDir + '/'));
    const id = 'user-' + crypto.createHash('sha1').update(entry + Date.now() + Math.random()).digest('hex').slice(0, 8);
    const dest = path.join(userModelsDir(userData), id);
    try {
      for (const r of copy) writeFileSafe(dest, baseDir === '.' ? r : r.slice(baseDir.length + 1), reader(r));
      const entryRel = baseDir === '.' ? entry : entry.slice(baseDir.length + 1);
      fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify({ name: v.name, entry: entryRel }));
    } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); throw e; }
    return { ok: true, id, name: v.name };
  } catch (e) { return { ok: false, error: 'Не удалось добавить модель: ' + String((e && e.message) || e) }; }
}
function listModels(userData) {
  const out = [];
  for (const n of SAMPLE_MODELS) {
    if (fs.existsSync(path.join(runtimeDir(userData), 'models', n, n + '.model3.json'))) out.push({ id: 'builtin-' + n, name: n, builtin: true, entry: n + '.model3.json' });
  }
  let dirs = [];
  try { dirs = fs.readdirSync(userModelsDir(userData)).filter((d) => /^user-[0-9a-f]{8}$/.test(d)).sort(); } catch (_) {}
  for (const d of dirs) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(userModelsDir(userData), d, 'meta.json'), 'utf8'));
      if (m && typeof m.entry === 'string' && safeRel(m.entry)) out.push({ id: d, name: String(m.name || 'Модель').slice(0, 60), builtin: false, entry: m.entry });
    } catch (_) {}
  }
  return out;
}
function removeModel(userData, id) {
  if (!/^user-[0-9a-f]{8}$/.test(String(id))) return { ok: false, error: 'Встроенные модели удалить нельзя' };
  fs.rmSync(path.join(userModelsDir(userData), id), { recursive: true, force: true });
  return { ok: true };
}
// что отдавать странице виджета: выбранная модель (или первая доступная, если выбранной нет)
function activeModel(userData, wanted) {
  const list = listModels(userData);
  return list.find((m) => m.id === wanted) || list[0] || null;
}

// ---------- раздача файлов локальным сервером ----------
const LIB_FILE = /^(pixi\.min\.js|cubism4\.min\.js|live2dcubismcore\.min\.js|mediapipe\/vision_bundle\.mjs|mediapipe\/face_landmarker\.task|mediapipe\/wasm\/[\w.-]+)$/;
const OWN_FILES = { 'avatar-map.js': path.join(__dirname, 'src', 'avatar-map.js'), 'avatar-tracker.js': path.join(__dirname, 'src', 'avatar-tracker.js') };
// urlPath — путь запроса без параметров. Возвращает { file, mime } или null
function resolveAsset(userData, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch (_) { return null; }
  let m = /^\/avatar-lib\/(.+)$/.exec(p);
  if (m) {
    if (Object.prototype.hasOwnProperty.call(OWN_FILES, m[1])) return fs.existsSync(OWN_FILES[m[1]]) ? { file: OWN_FILES[m[1]], mime: mimeOf(m[1]) } : null;
    if (!LIB_FILE.test(m[1])) return null;
    const base = runtimeDir(userData), file = path.join(base, ...m[1].split('/'));
    return inside(base, file) && isFile(file) ? { file, mime: mimeOf(file) } : null;
  }
  m = /^\/avatar-model\/([\w-]+)\/(.+)$/.exec(p);
  if (m && MODEL_ID.test(m[1])) {
    const rel = safeRel(m[2]);
    if (!rel) return null;
    const base = m[1].startsWith('builtin-') ? path.join(runtimeDir(userData), 'models', m[1].slice(8)) : path.join(userModelsDir(userData), m[1]);
    const file = path.join(base, ...rel.split('/'));
    if (!inside(base, file) || !isFile(file) || rel === 'meta.json') return null;
    return { file, mime: mimeOf(file) };
  }
  return null;
}
function isFile(f) { try { return fs.statSync(f).isFile(); } catch (_) { return false; } }

// Страница окна трекера (скрытое окно приложения). Команды и результаты идут через preload, а не через сеть.
const TRACKER_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Трекер аватара</title></head><body style="margin:0;background:#000"><video id="v" muted playsinline style="width:2px;height:2px"></video><script src="/avatar-lib/avatar-map.js"></script><script src="/avatar-lib/avatar-tracker.js"></script></body></html>';

module.exports = {
  DEFAULTS, cleanSettings, safeRel, readTarGz, readZip, checkIntegrity, COMPONENTS, SAMPLE_MODELS, runtimeDir, userModelsDir,
  status, install, importModel, listModels, removeModel, activeModel, validateModelFiles, pickEntry, resolveAsset, mimeOf, TRACKER_PAGE,
};
