'use strict';
// звук доната: переключатель, кнопка «Прослушать», звук играет по очереди перед голосом и обрывается при выключении
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');

test('звук доната: переключатель и кнопка есть в настройках виджета', () => {
  const sec = html.slice(html.indexOf('id="tab-kaspi"'), html.indexOf('<!-- НАСТРОЙКИ -->'));
  const set = sec.indexOf('Настройки виджета');
  assert.ok(set > 0 && sec.indexOf('data-kk="sound"') > set, 'переключатель в «Настройках виджета»');
  assert.ok(sec.indexOf('id="kSoundTest"') > set, 'кнопка «Прослушать звук»');
  assert.equal((sec.match(/<div\b/g) || []).length, (sec.match(/<\/div>/g) || []).length);
});

test('звук доната: включён по умолчанию, играет перед голосом, выключение обрывает его', () => {
  assert.match(js, /showMessage: true, voice: true, sound: true/);
  const don = js.slice(js.indexOf('window.echo.onDonate('), js.indexOf('// предпросмотр виджета донатов'));
  assert.ok(don.indexOf('K.sound') > 0 && don.indexOf('K.sound') < don.indexOf('K.voice'), 'звук раньше голоса');
  assert.match(js, /dropSrc\('donateSound'\)/);
  assert.match(js, /if \(item\.chime\) \{ await playChime\(\); return; \}/);
  assert.match(js, /if \(chimeStop\)/); // общая остановка озвучки обрывает и звук
});

test('звук доната: playChime завершается и обрывается через chimeStop (заглушка Web Audio)', async () => {
  const start = js.indexOf('let actx = null;'), end = js.indexOf('async function speakItem');
  const code = js.slice(start, end);
  const made = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createGain() { const g = { gain: param(), connect() {} }; made.push(g); return g; }
    createOscillator() { return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
    resume() {}
  }
  const S = { vol: 80 };
  const env = { chimeStop: null };
  const make = new Function('window', 'S', 'env', `let chimeStop = null; ${code}; return { playChime, stop: () => chimeStop && chimeStop(), has: () => !!chimeStop };`);
  const api = make({ AudioContext: Ctx }, S, env);
  const p = api.playChime();
  assert.ok(api.has(), 'звук можно оборвать, пока он играет');
  api.stop();
  await p; // обрыв сразу завершает промис
  assert.ok(!api.has());
  assert.ok(made.length > 4, 'ноты созданы');
});
