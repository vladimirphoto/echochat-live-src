'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const http = require('node:http');
const av = require('../avatar');
const M = require('../src/avatar-map');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'echo-av-'));
// --- сборка архивов для тестов ---
function tgz(files) {
  const blocks = [];
  for (const [name, data] of Object.entries(files)) {
    const h = Buffer.alloc(512); h.write(name, 0, 'utf8'); h.write('0000644\0', 100); h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('0', 156);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}
const crc = (b) => zlib.crc32 ? zlib.crc32(b) : (() => { let c, r = ~0; for (const x of b) { c = (r ^ x) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; r = (r >>> 8) ^ c; } return ~r >>> 0; })();
function zip(files) {
  const loc = [], cen = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const nm = Buffer.from(name), comp = zlib.deflateRawSync(data), c = crc(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(c, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nm.length, 26);
    const g = Buffer.alloc(46); g.writeUInt32LE(0x02014b50, 0); g.writeUInt16LE(20, 4); g.writeUInt16LE(20, 6); g.writeUInt16LE(8, 10); g.writeUInt32LE(c, 16); g.writeUInt32LE(comp.length, 20); g.writeUInt32LE(data.length, 24); g.writeUInt16LE(nm.length, 28); g.writeUInt32LE(off, 42);
    loc.push(l, nm, comp); cen.push(g, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, e]);
}
const B = (s) => Buffer.from(s);
const MODEL = (extra) => JSON.stringify({ Version: 3, FileReferences: { Moc: 'a.moc3', Textures: ['t.png'], ...(extra || {}) } });

test('настройки аватара: значения ограничиваются, чужие id моделей отбрасываются', () => {
  const s = av.cleanSettings({ model: '../../x', scale: 9999, offsetX: -500, bg: 'red', camera: 5 });
  assert.equal(s.model, 'builtin-Haru'); assert.equal(s.scale, 250); assert.equal(s.offsetX, -100); assert.equal(s.bg, 'transparent'); assert.equal(s.camera, '');
  assert.equal(av.cleanSettings({ model: 'builtin-Mao' }).model, 'builtin-Mao');
  assert.equal(av.cleanSettings({ model: 'user-0123abcd' }).model, 'user-0123abcd');
  assert.equal(av.cleanSettings({ scale: 120 }, { scale: 50, mirror: true }).mirror, true);
});

test('safeRel отсекает выход из папки и абсолютные пути', () => {
  for (const bad of ['../a', 'a/../../b', '/etc/passwd', 'C:\\x', 'a\0b', '', '..\\x']) assert.equal(av.safeRel(bad), null, bad);
  assert.equal(av.safeRel('a\\b/./c.json'), 'a/b/c.json');
});

test('читает tar.gz и zip', () => {
  const t = av.readTarGz(tgz({ 'package/a.txt': B('hi'), 'package/dir/b.bin': Buffer.alloc(700, 7) }));
  assert.deepEqual(t.map((x) => x.name), ['package/a.txt', 'package/dir/b.bin']); assert.equal(t[1].data.length, 700);
  const z = av.readZip(zip({ 'x/y.txt': B('hello'), 'z.txt': B('') }));
  assert.equal(z[0].read().toString(), 'hello'); assert.equal(z.length, 2);
  assert.throws(() => av.readZip(B('not a zip')), /zip/);
  assert.throws(() => av.readZip(zip({ a: B('1'), b: B('2') }), { files: 1 }), /много файлов/);
});

test('установка компонентов: проверка целостности, распаковка, повторный запуск ничего не качает', async () => {
  const ud = tmp(), calls = [];
  const gz = tgz({ 'package/dist/browser/pixi.min.js': B('pixi'), 'package/dist/cubism4.min.js': B('c4'), 'package/vision_bundle.mjs': B('vb'), 'package/wasm/vision_wasm_internal.wasm': B('w'), 'package/wasm/vision_wasm_internal.js': B('j'), 'package/evil': B('x') });
  const face = B('face-model');
  const sdk = zip({ 'CubismSdkForWeb-5-r.4/Core/live2dcubismcore.min.js': B('core'), 'CubismSdkForWeb-5-r.4/LICENSE.md': B('l'), 'CubismSdkForWeb-5-r.4/Core/LICENSE.md': B('l2'),
    ...Object.fromEntries(av.SAMPLE_MODELS.flatMap((n) => [[`CubismSdkForWeb-5-r.4/Samples/Resources/${n}/${n}.model3.json`, B(MODEL())], [`CubismSdkForWeb-5-r.4/Samples/Resources/${n}/voice.wav`, B('snd')]])) });
  const saved = av.COMPONENTS.map((c) => ({ ...c }));
  const faceC = av.COMPONENTS.find((c) => c.id === 'face'), cubC = av.COMPONENTS.find((c) => c.id === 'cubism');
  faceC.size = face.length; faceC.sha256 = crypto.createHash('sha256').update(face).digest('hex'); cubC.sha256 = crypto.createHash('sha256').update(sdk).digest('hex');
  const integ = 'sha512-' + crypto.createHash('sha512').update(gz).digest('base64');
  const fetch = async (url) => {
    calls.push(url);
    if (url.startsWith('https://registry.npmjs.org/') && !url.includes('.tgz')) return B(JSON.stringify({ dist: { tarball: 'https://registry.npmjs.org/x/-/x-1.tgz', integrity: integ } }));
    if (url.endsWith('x-1.tgz')) return gz;
    if (url === faceC.url) return face;
    if (url === cubC.url) return sdk;
    throw new Error('неожиданный адрес ' + url);
  };
  try {
    assert.equal(av.status(ud).ready, false);
    await av.install(ud, { fetch });
    const st = av.status(ud); assert.equal(st.ready, true, JSON.stringify(st));
    const rt = av.runtimeDir(ud);
    assert.equal(fs.readFileSync(path.join(rt, 'pixi.min.js'), 'utf8'), 'pixi');
    assert.equal(fs.existsSync(path.join(rt, 'evil')), false);
    assert.equal(fs.existsSync(path.join(rt, 'models', 'Haru', 'voice.wav')), false); // звуки образцов не берём
    assert.deepEqual(av.listModels(ud).map((m) => m.id), ['builtin-Haru', 'builtin-Hiyori', 'builtin-Mao']);
    const n = calls.length; await av.install(ud, { fetch }); assert.equal(calls.length, n);
    // испорченная загрузка отвергается
    const ud2 = tmp();
    await assert.rejects(av.install(ud2, { fetch: async (u) => (u.endsWith('x-1.tgz') ? B('bad') : fetch(u)) }), /целостност/);
    assert.equal(av.status(ud2).items.find((i) => i.id === 'pixi').ok, false);
  } finally { av.COMPONENTS.forEach((c, i) => Object.assign(c, saved[i])); }
});

test('импорт своей модели: папка, zip, проверки и защита от лишнего', () => {
  const ud = tmp(), src = tmp();
  fs.writeFileSync(path.join(src, 'my.model3.json'), MODEL({ Physics: 'p.json' }));
  fs.writeFileSync(path.join(src, 'a.moc3'), 'moc'); fs.writeFileSync(path.join(src, 't.png'), 'png');
  let r = av.importModel(ud, src); assert.equal(r.ok, false); assert.match(r.error, /p\.json/); // не хватает файла из ссылок
  fs.writeFileSync(path.join(src, 'p.json'), '{}');
  r = av.importModel(ud, src); assert.equal(r.ok, true); assert.equal(r.name, 'my'); assert.match(r.id, /^user-[0-9a-f]{8}$/);
  assert.equal(av.listModels(ud).find((m) => m.id === r.id).entry, 'my.model3.json');
  const z = path.join(src, 'm.zip');
  fs.writeFileSync(z, zip({ 'Folder/q.model3.json': B(MODEL()), 'Folder/a.moc3': B('m'), 'Folder/t.png': B('p'), '__MACOSX/x': B('') }));
  const r2 = av.importModel(ud, z); assert.equal(r2.ok, true); assert.equal(r2.name, 'q');
  assert.equal(fs.existsSync(path.join(av.userModelsDir(ud), r2.id, 'q.model3.json')), true);
  // zip с выходом за папку не распаковывается за её пределы
  const evil = path.join(src, 'evil.zip');
  fs.writeFileSync(evil, zip({ 'q.model3.json': B(MODEL()), 'a.moc3': B('m'), 't.png': B('p'), '../escape.txt': B('x') }));
  assert.equal(av.importModel(ud, evil).ok, true); assert.equal(fs.existsSync(path.join(av.userModelsDir(ud), '..', 'escape.txt')), false);
  assert.equal(av.importModel(ud, path.join(src, 'a.moc3')).ok, false);
  const bad = tmp(); fs.writeFileSync(path.join(bad, 'x.model3.json'), '{oops'); assert.equal(av.importModel(ud, bad).ok, false);
  assert.equal(av.removeModel(ud, r.id).ok, true); assert.equal(av.removeModel(ud, 'builtin-Haru').ok, false);
  assert.equal(av.removeModel(ud, '../x').ok, false);
});

test('сервер отдаёт только разрешённые файлы аватара', () => {
  const ud = tmp(), rt = av.runtimeDir(ud);
  fs.mkdirSync(path.join(rt, 'models', 'Haru'), { recursive: true });
  fs.writeFileSync(path.join(rt, 'pixi.min.js'), 'x'); fs.writeFileSync(path.join(rt, 'secret.txt'), 's'); fs.writeFileSync(path.join(rt, 'models', 'Haru', 'Haru.model3.json'), '{}');
  assert.ok(av.resolveAsset(ud, '/avatar-lib/pixi.min.js'));
  assert.ok(av.resolveAsset(ud, '/avatar-lib/avatar-map.js'));
  assert.ok(av.resolveAsset(ud, '/avatar-model/builtin-Haru/Haru.model3.json'));
  for (const u of ['/avatar-lib/secret.txt', '/avatar-lib/../secret.txt', '/avatar-lib/%2e%2e/secret.txt', '/avatar-model/builtin-Haru/..%2f..%2fsecret.txt', '/avatar-model/other/x', '/avatar-lib/installed.json', '/avatar-model/user-0123abcd/meta.json']) assert.equal(av.resolveAsset(ud, u), null, u);
});

test('виджет-сервер: страница аватара, файлы и настройки по SSE', async () => {
  const widget = require('../widget'), ud = tmp(), rt = av.runtimeDir(ud);
  fs.mkdirSync(rt, { recursive: true }); fs.writeFileSync(path.join(rt, 'pixi.min.js'), 'PIXI!');
  const srv = await widget.start(() => ({}), 17990, { getAvatar: () => ({ ready: true, model: 'builtin-Haru', entry: 'Haru.model3.json' }), getAvatarAsset: (u) => av.resolveAsset(ud, u), getTrackerPage: () => av.TRACKER_PAGE });
  const get = (p, h) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: srv.port, path: p, headers: h || {} }, (r) => { let b = ''; r.on('data', (c) => { b += c; if (p === '/events' && /avsettings/.test(b)) { r.destroy(); } }); r.on('close', () => res({ s: r.statusCode, h: r.headers, b })); r.on('end', () => res({ s: r.statusCode, h: r.headers, b })); }).on('error', rej));
  try {
    assert.equal((await get('/avatar')).s, 200);
    const lib = await get('/avatar-lib/pixi.min.js', { Origin: widget.PAGES_ORIGIN });
    assert.equal(lib.s, 200); assert.equal(lib.b, 'PIXI!'); assert.equal(lib.h['access-control-allow-origin'], widget.PAGES_ORIGIN); assert.equal(lib.h['cross-origin-resource-policy'], 'cross-origin');
    assert.equal((await get('/avatar-lib/nope.js')).s, 404);
    assert.equal((await get('/avatar-tracker')).s, 200);
    assert.match((await get('/events')).b, /event: avsettings\ndata: \{"ready":true/);
  } finally { srv.close(); }
});

test('лицо → параметры: прямой взгляд даёт нули, моргание закрывает глаз, рот открывается', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const f = M.faceFromMediaPipe([], I);
  assert.ok(Math.abs(f.yaw) < 1e-9 && Math.abs(f.pitch) < 1e-9 && Math.abs(f.roll) < 1e-9);
  const p0 = M.paramsFromFace(f, { yaw: 0, pitch: 0, roll: 0 });
  assert.equal(p0.ParamEyeLOpen, 1); assert.equal(p0.ParamMouthOpenY, 0); assert.equal(p0.ParamAngleX, 0);
  const g = M.faceFromMediaPipe([{ categoryName: 'eyeBlinkLeft', score: 0.9 }, { categoryName: 'jawOpen', score: 0.5 }, { categoryName: 'mouthSmileLeft', score: 0.8 }, { categoryName: 'mouthSmileRight', score: 0.8 }], I);
  const p = M.paramsFromFace(g, { yaw: 0, pitch: 0, roll: 0 });
  assert.equal(p.ParamEyeLOpen, 0); assert.equal(p.ParamEyeROpen, 1); assert.ok(p.ParamMouthOpenY > 0.7); assert.ok(p.ParamMouthForm > 0.5);
  // поворот головы: калибровка вычитается, зеркало меняет знак, углы ограничены
  const turned = { ...f, yaw: 50 };
  assert.equal(M.paramsFromFace(turned, { yaw: 50, pitch: 0, roll: 0 }).ParamAngleX, 0);
  assert.equal(M.paramsFromFace(turned, { yaw: 0, pitch: 0, roll: 0 }).ParamAngleX, 30);
  assert.equal(M.paramsFromFace(turned, { yaw: 0, pitch: 0, roll: 0 }, { mirror: true }).ParamAngleX, -30);
  assert.equal(M.faceFromMediaPipe([], [1, 2]), null); assert.equal(M.faceFromMediaPipe([], I.map((x, i) => (i === 3 ? NaN : x))), null);
});

test('сглаживание и калибровка', () => {
  const s = new M.Smoother();
  const a = s.step({ ParamEyeLOpen: 0 }, 0.033); assert.ok(a.ParamEyeLOpen < 1 && a.ParamEyeLOpen > 0);
  let v; for (let i = 0; i < 30; i++) v = s.step({ ParamEyeLOpen: 0 }, 0.033); assert.ok(v.ParamEyeLOpen < 0.01);
  assert.ok(Number.isFinite(s.step({}, NaN).ParamAngleX));
  const c = new M.Calibrator(2); c.add({ yaw: 10, pitch: 0, roll: 0 }); assert.equal(c.done, false); c.add({ yaw: 20, pitch: 0, roll: 0 }); assert.equal(c.done, true); assert.equal(c.result().yaw, 15);
});

const PAGE = require('../widget-avatar-page');
test('страница аватара для GitHub Pages совпадает с виджетом приложения (npm run pages)', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'docs', 'avatar', 'index.html'), 'utf8'), PAGE);
});
test('страница аватара слушает настройки и кадры, берёт файлы у приложения и не вставляет текст как разметку', () => {
  assert.match(PAGE, /addEventListener\('avsettings'/); assert.match(PAGE, /addEventListener\('aframe'/);
  assert.match(PAGE, /\/avatar-lib\/pixi\.min\.js/); assert.match(PAGE, /127\.0\.0\.1:'\+port\+'\/events/);
  assert.doesNotMatch(PAGE, /innerHTML/);
});

test('предпросмотр аватара: колесо, перетаскивание и сброс сообщают приложению размер и сдвиг', () => {
  assert.match(PAGE, /addEventListener\('wheel'/); assert.match(PAGE, /addEventListener\('pointerdown'/); assert.match(PAGE, /addEventListener\('dblclick'/);
  assert.match(PAGE, /echochat:'avatar-view'/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'avatar-ui.js'), 'utf8'), /avatar-view/);
});

test('кнопка «Скачать бесплатные модели» открывает только зашитый адрес Live2D', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /AV_MODELS_URL = 'https:\/\/www\.live2d\.com\/en\/learn\/sample\/'/);
  assert.match(main, /AV_MODELS3_URL = 'https:\/\/hub\.vroid\.com\/en'/);
  assert.match(main, /ipcMain\.handle\('avatar:open-models', \(_e, engine\) =>/); // в адрес из окна попадает только выбор движка, сам адрес зашит
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8'), /id="avGetModels"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8'), /id="av3GetModels"/);
});

// ---------- 3D (VRM) ----------
const glb = (json) => { const j = Buffer.from(JSON.stringify(json)); const pad = Buffer.alloc((4 - (j.length % 4)) % 4, 0x20); const jj = Buffer.concat([j, pad]);
  const h = Buffer.alloc(20); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + jj.length, 8); h.writeUInt32LE(jj.length, 12); h.writeUInt32LE(0x4e4f534a, 16); return Buffer.concat([h, jj]); };
const VRM1 = (name) => glb({ asset: { version: '2.0' }, extensions: { VRMC_vrm: { specVersion: '1.0', meta: { name } } } });
const VRM0 = (title) => glb({ asset: { version: '2.0' }, extensions: { VRM: { meta: { title } } } });

test('настройки 3D: свои значения, не мешают 2D, чужие id отбрасываются', () => {
  const s = av.cleanSettings({ v3: { scale: 9999, offsetX: -500, model: '../x', bg: 'red', mirror: 1 }, mode: '3d' });
  assert.deepEqual(s.v3, { model: 'builtin-seed', scale: 250, offsetX: -100, offsetY: 0, mirror: true, bg: 'transparent' });
  assert.equal(s.mode, '3d'); assert.equal(s.scale, 100); assert.equal(s.mirror, false);
  const t = av.cleanSettings({ scale: 150 }, s); assert.equal(t.v3.scale, 250); assert.equal(t.scale, 150); assert.equal(t.mode, '3d');
  assert.equal(av.cleanSettings({ mode: 'x' }).mode, '2d');
  assert.equal(av.cleanSettings({ v3: { model: 'vrm-0123abcd' } }).v3.model, 'vrm-0123abcd');
  assert.equal(av.cleanSettings({ v3: { model: 'builtin-twist' } }).v3.model, 'builtin-twist');
  // старый avatar.json без v3 читается
  assert.equal(av.cleanSettings({ model: 'builtin-Mao', scale: 120 }).v3.model, 'builtin-seed');
});

test('импорты "three" в модулях переписываются на локальные адреса', () => {
  const r = av.rewriteImports("import * as T from 'three';\nimport { G } from \"three/addons/loaders/GLTFLoader.js\";import{x}from'three/examples/jsm/utils/A.js';export*from'./three.core.js';const three='three';");
  assert.match(r, /from '\/avatar-lib\/three\/three\.module\.js'/);
  assert.match(r, /from "\/avatar-lib\/three\/addons\/loaders\/GLTFLoader\.js"/);
  assert.match(r, /from'\/avatar-lib\/three\/addons\/utils\/A\.js'/);
  assert.match(r, /export\*from'\.\/three\.core\.js'/); assert.match(r, /const three='three'/);
});

test('3D: установка компонентов отдельно от 2D, импорты переписаны, образцы проверяются по хэшу', async () => {
  const ud = tmp();
  const t = tgz({ 'package/build/three.module.js': B('export * from "./three.core.js";'), 'package/build/three.core.js': B('export const A=1;'), 'package/examples/jsm/loaders/GLTFLoader.js': B("import { X } from 'three';\nimport { y } from '../utils/BufferGeometryUtils.js';"), 'package/examples/jsm/utils/BufferGeometryUtils.js': B("import { Z } from 'three';"), 'package/build/three.cjs': B('no') });
  const v = tgz({ 'package/lib/three-vrm.module.js': B("import * as THREE from 'three';export const VRMLoaderPlugin=1;"), 'package/lib/other.js': B('no') });
  const mp = tgz({ 'package/vision_bundle.mjs': B('vb'), 'package/wasm/vision_wasm_internal.wasm': B('w') });
  const seed = B('seed-model'), twist = B('twist-model');
  const saved = av.COMPONENTS.map((c) => ({ ...c }));
  const byId = (id) => av.COMPONENTS.find((c) => c.id === id);
  for (const [id, d] of [['vrm-seed', seed], ['vrm-twist', twist], ['face', B('face')]]) Object.assign(byId(id), { size: d.length, sha256: crypto.createHash('sha256').update(d).digest('hex') });
  const tars = { three: t, '@pixiv%2fthree-vrm': v, '@mediapipe%2ftasks-vision': mp };
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const m = /registry\.npmjs\.org\/([^/]+(?:%2f[^/]+)?)\/(\d[^/]*)$/.exec(url);
    if (m) { const g = tars[m[1]]; return B(JSON.stringify({ dist: { tarball: 'https://registry.npmjs.org/p/-/' + m[1] + '.tgz', integrity: 'sha512-' + crypto.createHash('sha512').update(g).digest('base64') } })); }
    const t2 = /\/-\/(.+)\.tgz$/.exec(url); if (t2) return tars[t2[1]];
    if (url === byId('vrm-seed').url) return seed; if (url === byId('vrm-twist').url) return twist; if (url === byId('face').url) return B('face');
    throw new Error('неожиданный адрес ' + url);
  };
  try {
    assert.equal(av.status(ud, '3d').ready, false); assert.equal(av.status(ud, '3d').items.length, 6);
    await av.install(ud, { engine: '3d', fetch });
    assert.equal(av.status(ud, '3d').ready, true); assert.equal(av.status(ud, '2d').ready, false); // 2D-компоненты не трогали
    assert.equal(calls.some((u) => /pixi\.js|cubism|live2d/i.test(u)), false);
    const rt = av.runtimeDir(ud), rd = (f) => fs.readFileSync(path.join(rt, f), 'utf8');
    assert.match(rd('three/addons/loaders/GLTFLoader.js'), /from '\/avatar-lib\/three\/three\.module\.js'/);
    assert.match(rd('three/addons/loaders/GLTFLoader.js'), /'\.\.\/utils\/BufferGeometryUtils\.js'/); // относительные импорты не трогаем
    assert.match(rd('vrm/three-vrm.module.js'), /from '\/avatar-lib\/three\/three\.module\.js'/);
    assert.equal(fs.existsSync(path.join(rt, 'three', 'three.cjs')), false);
    assert.deepEqual(av.listVrm(ud).map((m) => m.id), ['builtin-seed', 'builtin-twist']);
    assert.match(av.listVrm(ud)[0].credit, /VirtualCast/);
    // испорченный образец отвергается
    const ud2 = tmp();
    await assert.rejects(av.install(ud2, { engine: '3d', fetch: async (u) => (u === byId('vrm-seed').url ? B('bad') : fetch(u)) }), /целостност/);
  } finally { av.COMPONENTS.forEach((c, i) => Object.assign(c, saved[i])); }
});

test('VRM: заголовок, импорт, список, удаление и защита путей', () => {
  const ud = tmp(), src = tmp();
  assert.deepEqual(av.readVrmHeader(path.join(src, 'нет.vrm')).ok, false);
  const f1 = path.join(src, 'a.vrm'); fs.writeFileSync(f1, VRM1('Мой аватар'));
  assert.deepEqual(av.readVrmHeader(f1), { ok: true, version: '1', name: 'Мой аватар' });
  const f0 = path.join(src, 'old.vrm'); fs.writeFileSync(f0, VRM0('Старый'));
  assert.equal(av.readVrmHeader(f0).version, '0');
  const plain = path.join(src, 'plain.vrm'); fs.writeFileSync(plain, glb({ asset: { version: '2.0' } })); assert.match(av.importVrm(ud, plain).error, /не VRM/);
  const junk = path.join(src, 'junk.vrm'); fs.writeFileSync(junk, B('not a glb at all, just text')); assert.match(av.importVrm(ud, junk).error, /не файл VRM/);
  const trunc = path.join(src, 't.vrm'); fs.writeFileSync(trunc, VRM1('x').subarray(0, 30)); assert.equal(av.importVrm(ud, trunc).ok, false);
  assert.match(av.importVrm(ud, path.join(src, 'x.glb')).error, /\.vrm/);
  const r = av.importVrm(ud, f1); assert.equal(r.ok, true); assert.match(r.id, /^vrm-[0-9a-f]{8}$/);
  const r0 = av.importVrm(ud, f0); assert.equal(r0.ok, true);
  assert.deepEqual(av.listVrm(ud).map((m) => m.name).sort(), ['Мой аватар', 'Старый']);
  assert.equal(av.activeVrm(ud, r0.id).id, r0.id); assert.equal(av.activeVrm(ud, 'nope').id !== undefined, true);
  // раздача: только свои файлы
  assert.ok(av.resolveAsset(ud, '/avatar-vrm/' + r.id + '.vrm'));
  for (const u of ['/avatar-vrm/../x.vrm', '/avatar-vrm/builtin-seed.vrm', '/avatar-vrm/vrm-ffffffff.vrm', '/avatar-vrm/%2e%2e%2fx.vrm', '/avatar-lib/three/three.cjs', '/avatar-lib/three/addons/../../secret.js']) assert.equal(av.resolveAsset(ud, u), null, u);
  assert.equal(av.removeVrm(ud, 'builtin-seed').ok, false); assert.equal(av.removeVrm(ud, '../x').ok, false);
  assert.equal(av.removeVrm(ud, r.id).ok, true); assert.equal(av.listVrm(ud).length, 1);
});

test('лицо → параметры 3D: закрытость глаз, рот, улыбка и углы без зеркала', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const f = M.faceFromMediaPipe([{ categoryName: 'eyeBlinkLeft', score: 0.9 }, { categoryName: 'jawOpen', score: 0.5 }, { categoryName: 'mouthSmileLeft', score: 0.8 }, { categoryName: 'mouthSmileRight', score: 0.8 }], I);
  const p = M.paramsFromFace(f, { yaw: 0, pitch: 0, roll: 0 });
  assert.equal(p.V_blinkL, 1); assert.equal(p.V_blinkR, 0); assert.ok(p.V_aa > 0.7); assert.ok(p.V_happy > 0.5);
  const turned = { ...f, yaw: 20 };
  assert.equal(M.paramsFromFace(turned, { yaw: 0, pitch: 0, roll: 0 }, { mirror: true }).V_yaw, 20); // зеркало для 3D применяет страница
  assert.equal(M.paramsFromFace({ ...f, yaw: 90 }, { yaw: 0, pitch: 0, roll: 0 }).V_yaw, 45);
  const out = new M.Smoother().step(p, 0.033); assert.ok('V_yaw' in out && 'V_aa' in out);
});

const PAGE3 = require('../widget-avatar3d-page');
test('страница 3D для GitHub Pages совпадает с виджетом приложения (npm run pages)', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'docs', 'avatar3d', 'index.html'), 'utf8'), PAGE3);
});
test('страница 3D слушает настройки и кадры, берёт библиотеки у приложения и не вставляет текст как разметку', () => {
  assert.match(PAGE3, /addEventListener\('av3settings'/); assert.match(PAGE3, /addEventListener\('aframe'/);
  assert.match(PAGE3, /\/avatar-lib\/three\/three\.module\.js/); assert.match(PAGE3, /\/avatar-lib\/vrm\/three-vrm\.module\.js/); assert.match(PAGE3, /\/avatar-vrm\//);
  assert.match(PAGE3, /echochat:'avatar-view',engine:'3d'/); assert.match(PAGE3, /127\.0\.0\.1:'\+port\+'\/events/);
  assert.doesNotMatch(PAGE3, /innerHTML/);
});

test('виджет-сервер: страница /avatar3d, файлы VRM и настройки 3D по SSE', async () => {
  const widget = require('../widget'), ud = tmp(), src = tmp();
  const f = path.join(src, 'm.vrm'); fs.writeFileSync(f, VRM1('Тест')); const id = av.importVrm(ud, f).id;
  const srv = await widget.start(() => ({}), 17992, { getAvatar3d: () => ({ ready: true, model: id }), getAvatarAsset: (u) => av.resolveAsset(ud, u), getTrackerPage: () => av.TRACKER_PAGE });
  const get = (p, h) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: srv.port, path: p, headers: h || {} }, (r) => { const ch = []; r.on('data', (c) => { ch.push(c); if (p === '/events' && /av3settings/.test(Buffer.concat(ch).toString())) r.destroy(); }); r.on('close', () => res({ s: r.statusCode, h: r.headers, b: Buffer.concat(ch) })); }).on('error', rej));
  try {
    assert.equal((await get('/avatar3d')).s, 200);
    const m = await get('/avatar-vrm/' + id + '.vrm', { Origin: widget.PAGES_ORIGIN });
    assert.equal(m.s, 200); assert.equal(m.h['content-type'], 'model/gltf-binary'); assert.equal(m.h['access-control-allow-origin'], widget.PAGES_ORIGIN); assert.deepEqual(m.b, VRM1('Тест'));
    assert.equal((await get('/avatar-vrm/vrm-ffffffff.vrm')).s, 404);
    assert.match((await get('/events')).b.toString(), new RegExp('event: av3settings\\ndata: \\{"ready":true,"model":"' + id));
  } finally { srv.close(); }
  assert.equal(widget.AVATAR3D_PAGES_URL, 'https://vladimirphoto.github.io/jonny-chat-tiktok/avatar3d/');
});

test('вкладка «Аватар»: переключатель 2D/3D и отдельные панели с отдельными настройками', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  assert.match(html, /data-mode="2d"/); assert.match(html, /data-mode="3d"/);
  for (const id of ['avPane', 'av3Pane', 'avScale', 'av3Scale', 'avMirror', 'av3Mirror', 'avUrl', 'av3Url', 'av3AddFile', 'av3Credit', 'av3Frame']) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /<span class="nav-pro" hidden>PRO<\/span>/);
  assert.match(html, />Аватар<span class="nav-pro"/);
});
