'use strict';
// Подключение Silero: файлы в сборке, маршрутизатор в main.js, голоса не скрываются каталогом Microsoft, тип звука доходит до плеера
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const main = read('main.js');
const renderer = read('src/renderer.js');

test('сборка: новые файлы перечислены и существуют', () => {
  const files = pkg.build.files;
  for (const f of ['tts-router.js', 'silero.js', 'silero/**/*']) assert.ok(files.includes(f), f + ' не в build.files');
  for (const f of ['tts-router.js', 'silero.js', 'silero/silero_server.py', 'silero/silero_text.py']) assert.ok(fs.existsSync(path.join(root, f)), f);
});

test('main.js: озвучка идёт через маршрутизатор, Silero прогревается, процесс останавливается при выходе', () => {
  assert.match(main, /createRouter\(\{ edge: edgeSynth, silero:/);
  assert.match(main, /router\.synth\(/);
  assert.match(main, /startsWith\('silero:'\)[\s\S]{0,120}silGet\(\)\.start\(\)/);
  assert.match(main, /before-quit[^\n]*silClient && silClient\.stop\(\)/);
  assert.match(main, /ipcMain\.handle\('sil:install'/);
});

test('renderer: голоса Silero не скрываются каталогом Microsoft; тип звука и темп доходят до плеера; пол уходит в синтез', () => {
  assert.match(renderer, /p\.provider === 'silero' \|\| have\.has\(p\.voice\)/);
  assert.match(renderer, /playBlob\(r\.audio, rate \* tempo, r\.mime\)/);
  assert.match(renderer, /type: mime \|\| 'audio\/mpeg'/);
  assert.match(renderer, /urgent: !!urgent, gender: p\.gender/);
});

test('preload: методы Silero доступны окну', () => {
  const pre = read('preload.js');
  for (const k of ['silStatus', 'silInstall', 'onSilProgress']) assert.match(pre, new RegExp(k));
});

test('в changelog и README есть запись про версию из package.json', () => {
  assert.match(renderer, new RegExp(`'${pkg.version.replace(/\./g, '\\.')}':`));
  assert.match(read('README.md'), new RegExp('## Что нового в ' + pkg.version.replace(/\./g, '\\.')));
});
