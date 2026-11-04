'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const { createEdgeSynth, escapeSsml } = require('../edge-pool');

// поддельная библиотека: считает соединения, ведёт себя по сценарию
function fakeLib(script) {
  const log = { instances: [], inputs: [] };
  class FakeTTS {
    constructor() { this.closed = false; this.n = log.instances.length; log.instances.push(this); }
    async setMetadata() { if (this.closed) throw new Error('closed'); this.connects = (this.connects || 0) + 1; }
    toStream(input) {
      log.inputs.push(input);
      const mode = script(this.n, log.inputs.length) || 'ok';
      const audioStream = new Readable({ read() {} });
      if (mode === 'ok') setImmediate(() => { audioStream.push(Buffer.from('mp3data')); audioStream.push(null); });
      else if (mode === 'fail') setImmediate(() => audioStream.destroy(new Error('boom')));
      // 'stuck' — молчит
      return { audioStream };
    }
    close() { this.closed = true; }
  }
  return { loadTts: async () => ({ MsEdgeTTS: FakeTTS, OUTPUT_FORMAT: { AUDIO_24KHZ_96KBITRATE_MONO_MP3: 'mp3' } }), log };
}
const mk = (script, extra) => { const f = fakeLib(script); const e = createEdgeSynth({ loadTts: f.loadTts, tickMs: 1e6, ...extra }); return { e, log: f.log }; };

test('SSML: & < > и кавычки экранируются, «<3» и управляющие символы убираются', () => {
  assert.equal(escapeSsml('Том & Джерри'), 'Том &amp; Джерри');
  assert.equal(escapeSsml('a<b>c'), 'a&lt;b&gt;c');
  assert.equal(escapeSsml('люблю вас <3'), 'люблю вас  ');
  assert.equal(escapeSsml('x\u0001y'), 'x y');
  assert.equal(escapeSsml('"да" и \'нет\''), '&quot;да&quot; и &apos;нет&apos;');
});

test('в библиотеку уходит уже экранированный текст', async () => {
  const { e, log } = mk(() => 'ok');
  await e.synth('a & b < c', 'ru-RU-SvetlanaNeural', 1, '+0Hz');
  assert.equal(log.inputs[0], 'a &amp; b &lt; c');
  e.close();
});

test('соединение переиспользуется: две фразы подряд — один экземпляр', async () => {
  const { e, log } = mk(() => 'ok');
  const a = await e.synth('раз', 'v1', 1, '+0Hz');
  const b = await e.synth('два', 'v1', 1, '+0Hz');
  assert.equal(a.toString(), 'mp3data'); assert.equal(b.toString(), 'mp3data');
  assert.equal(log.instances.length, 1);
  e.close();
});

test('разные голоса — разные соединения', async () => {
  const { e, log } = mk(() => 'ok');
  await e.synth('раз', 'v1', 1, '+0Hz');
  await e.synth('два', 'v2', 1, '+0Hz');
  assert.equal(log.instances.length, 2);
  e.close();
});

test('зависшая попытка: через hedgeMs стартует вторая на новом соединении и побеждает', async () => {
  const { e, log } = mk((inst) => (inst === 0 ? 'stuck' : 'ok'), { hedgeMs: 30, timeoutMs: 2000 });
  const t0 = Date.now();
  const buf = await e.synth('привет', 'v1', 1, '+0Hz');
  assert.equal(buf.toString(), 'mp3data');
  assert.ok(Date.now() - t0 < 500, 'не должно ждать тайм-аут зависшей попытки');
  assert.equal(log.instances.length, 2);
  e.close();
});

test('неудачное соединение закрывается и не берётся повторно', async () => {
  const { e, log } = mk((inst) => (inst === 0 ? 'fail' : 'ok'), { hedgeMs: 1000 });
  const buf = await e.synth('привет', 'v1', 1, '+0Hz');
  assert.equal(buf.toString(), 'mp3data');
  assert.equal(log.instances[0].closed, true);
  assert.equal(log.instances.length, 2);
  e.close();
});

test('все попытки неудачны — промис отклоняется после maxAttempts', async () => {
  const { e, log } = mk(() => 'fail', { maxAttempts: 3 });
  await assert.rejects(() => e.synth('привет', 'v1', 1, '+0Hz'), /boom/);
  assert.equal(log.instances.length, 3);
  e.close();
});

test('прогрев: соединение открыто заранее, первая фраза его использует', async () => {
  const { e, log } = mk(() => 'ok');
  e.warm(['v1']);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(log.instances.length, 1);
  await e.synth('привет', 'v1', 1, '+0Hz');
  assert.equal(log.instances.length, 1);
  e.close();
});

test('close() закрывает все простаивающие соединения', async () => {
  const { e, log } = mk(() => 'ok');
  await e.synth('раз', 'v1', 1, '+0Hz');
  e.close();
  assert.ok(log.instances.every((i) => i.closed));
});

test('оборвавшееся простаивающее соединение заменяется фоном, до первой фразы', async () => {
  const { e, log } = mk(() => 'ok', { refreshAfterMs: 1e9 });
  e.warm(['v1']);
  await new Promise((r) => setTimeout(r, 20));
  log.instances[0]._ws = { readyState: 3 }; // сервер закрыл соединение
  e._tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(log.instances.length, 2);
  assert.equal(log.instances[0].closed, true);
  await e.synth('привет', 'v1', 1, '+0Hz');
  assert.equal(log.instances.length, 2, 'фраза не открывает своё соединение');
  e.close();
});

test('обновление: новое открывается до закрытия старого, готовое всегда есть', async () => {
  const { e, log } = mk(() => 'ok', { refreshAfterMs: 5 });
  e.warm(['v1']);
  await new Promise((r) => setTimeout(r, 20));
  e._tick();
  assert.equal(log.instances[0].closed, false, 'старое ещё живо, пока открывается новое');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(log.instances.length, 2);
  assert.equal(log.instances[0].closed, true);
  assert.equal(log.instances[1].closed, false);
  e.close();
});

test('голос, о котором давно не напоминали, забывается', async () => {
  const { e, log } = mk(() => 'ok', { forgetMs: 5 });
  e.warm(['v1']);
  await new Promise((r) => setTimeout(r, 20));
  e._tick();
  assert.equal(log.instances[0].closed, true);
  e.close();
});
