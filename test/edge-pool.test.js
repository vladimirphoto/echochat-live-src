'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { createEdgeSynth, escapeSsml } = require('../edge-pool');

// поддельная библиотека: считает соединения, ведёт себя по сценарию
function fakeLib(script) {
  const log = { instances: [], inputs: [], silent: new Set(), noPongs: false };
  class FakeTTS {
    constructor() { this.closed = false; this.n = log.instances.length; log.instances.push(this); }
    async setMetadata() {
      if (this.closed) throw new Error('closed');
      this.connects = (this.connects || 0) + 1;
      if (!this._ws) {
        if (log.connectDelay) await new Promise((r) => setTimeout(r, log.connectDelay)); // рукопожатие с сервером
        const ws = this._ws = new EventEmitter();
        ws.readyState = 1;
        ws.pings = 0;
        // как настоящий WebSocket: на пинг приходит pong; «молчащее» соединение не отвечает
        ws.ping = () => { ws.pings++; if (!log.noPongs && !log.silent.has(this.n)) setImmediate(() => ws.emit('pong')); };
      }
    }
    toStream(input) {
      log.inputs.push(input);
      const mode = script(this.n, log.inputs.length) || 'ok';
      const audioStream = new Readable({ read() {} });
      if (mode === 'ok') setImmediate(() => { audioStream.push(Buffer.from('mp3data')); audioStream.push(null); });
      else if (mode === 'fail') setImmediate(() => audioStream.destroy(new Error('boom')));
      // 'stuck' — молчит
      return { audioStream };
    }
    close() { this.closed = true; if (this._ws && this._ws.readyState === 1) { this._ws.readyState = 3; this._ws.emit('close'); } }
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('urgent (подарки/подписки): вторая попытка стартует сразу, не ждёт hedgeMs', async () => {
  const { e, log } = mk((inst) => (inst === 0 ? 'stuck' : 'ok'), { hedgeMs: 2000, timeoutMs: 5000 });
  const t0 = Date.now();
  const buf = await e.synth('спасибо', 'v1', 1, '+0Hz', { urgent: true });
  assert.equal(buf.toString(), 'mp3data');
  assert.ok(Date.now() - t0 < 300, 'не должно ждать 2 секунды');
  assert.equal(log.instances.length, 2);
  e.close();
});

test('сервер закрыл простаивающее соединение — новое открывается сразу, без ожидания проверки', async () => {
  const { e, log } = mk(() => "ok", { poolSize: 1 });
  e.setPinned(['v1']);
  await wait(20);
  assert.equal(log.instances.length, 1);
  log.instances[0].close(); // как если бы сервер оборвал связь
  await wait(20);
  assert.equal(log.instances.length, 2);
  assert.equal(log.instances[1].closed, false);
  e.close();
});

test('пинг: соединение, не ответившее pong, считается мёртвым и заменяется до первой фразы', async () => {
  const { e, log } = mk(() => 'ok', { refreshAfterMs: 1e9, poolSize: 1 });
  e.setPinned(['v1']);
  await wait(20);
  e._tick(); // отправлен пинг, ответ пришёл
  await wait(10);
  assert.equal(log.instances.length, 1, 'живое соединение остаётся');
  log.silent.add(0); // соединение «замолчало» (NAT/Wi-Fi), но формально открыто
  e._tick(); // пинг без ответа
  await wait(10);
  e._tick(); // ответа так и нет — заменяем
  await wait(20);
  assert.equal(log.instances.length, 2);
  assert.equal(log.instances[0].closed, true);
  await e.synth('привет', 'v1', 1, '+0Hz');
  await wait(20);
  assert.equal(log.instances.length, 3, 'фраза взяла готовое (2-е), а запасное (3-е) открылось фоном');
  assert.equal(log.instances[1].connects, 2, 'фраза шла по готовому соединению, а не по новому');
  e.close();
});

test('смена голоса: фраза ждёт уже открывающееся соединение и не открывает второе', async () => {
  const { e, log } = mk(() => "ok", { poolSize: 1 });
  log.connectDelay = 60;
  e.setPinned(['v2']); // как при выборе карточки: соединение открывается в фоне
  const t0 = Date.now();
  const buf = await e.synth('привет', 'v2', 1, '+0Hz');
  assert.equal(buf.toString(), 'mp3data');
  assert.ok(Date.now() - t0 < 400);
  assert.equal(log.instances.filter((i) => i.n === 0).length, 1);
  assert.ok(log.instances.length <= 2, 'второе соединение не открывается параллельно: ' + log.instances.length);
  e.close();
});

test('зависшее фоновое соединение: ждём не дольше pendingWaitMs, потом открываем своё', async () => {
  const { e, log } = mk(() => 'ok', { pendingWaitMs: 40, poolSize: 1 });
  log.connectDelay = 300;
  e.setPinned(['v3']);
  await wait(5);
  log.connectDelay = 0; // первое (фоновое) уже «зависло», своё откроется быстро
  const t0 = Date.now();
  await e.synth('привет', 'v3', 1, '+0Hz');
  assert.ok(Date.now() - t0 < 200, 'не ждёт долгое подключение целиком: ' + (Date.now() - t0));
  e.close();
});

test('выбранному голосу после взятия последнего готового сразу открывается запасное; чужому — нет', async () => {
  const { e, log } = mk(() => "ok", { poolSize: 1 });
  e.setPinned(['v1']);
  await wait(20);
  await e.synth('раз', 'v1', 1, '+0Hz');
  await wait(20);
  assert.equal(log.instances.length, 2, 'запасное открыто');
  assert.equal(e._idle.get('v1').length, 2);
  await e.synth('два', 'v9', 1, '+0Hz');
  await wait(20);
  assert.equal(log.instances.filter((i, k) => k >= 2).length, 1, 'для невыбранного голоса запасного нет');
  e.close();
});

test('пачка фраз сразу после смены голоса: все озвучены, лишних соединений нет', async () => {
  const { e, log } = mk(() => "ok", { poolSize: 1 });
  log.connectDelay = 30;
  e.setPinned(['v1']);
  const r = await Promise.all([1, 2, 3].map((i) => e.synth('фраза ' + i, 'v1', 1, '+0Hz')));
  assert.ok(r.every((b) => b.toString() === 'mp3data'));
  await wait(60);
  assert.ok(log.instances.length <= 4, 'соединений: ' + log.instances.length);
  e.close();
});

test('сервер вообще не отвечает на пинги — проверку отключаем, соединения не мельтешат', async () => {
  const { e, log } = mk(() => 'ok', { refreshAfterMs: 1e9 });
  log.noPongs = true;
  e.setPinned(['v1']);
  await wait(20);
  for (let i = 0; i < 8; i++) { e._tick(); await wait(5); }
  assert.ok(log.instances.length <= 4, 'без ответов на пинги не должно быть бесконечной замены: ' + log.instances.length);
  const n = log.instances.length;
  for (let i = 0; i < 5; i++) { e._tick(); await wait(5); }
  assert.equal(log.instances.length, n, 'после отключения проверки замены прекращаются');
  e.close();
});

test('выбранный голос не «забывается», даже если им давно не говорили', async () => {
  const { e, log } = mk(() => 'ok', { forgetMs: 5 });
  e.setPinned(['v1']);
  await wait(30);
  e._tick();
  await wait(10);
  assert.ok(log.instances.some((i) => !i.closed), 'готовое соединение осталось');
  await e.synth('привет', 'v1', 1, '+0Hz');
  assert.equal(log.instances.filter((i) => !i.closed).length >= 1, true);
  e.close();
});

test('закреплённый голос держит poolSize готовых соединений и открывает их параллельно', async () => {
  const { e, log } = mk(() => 'ok', { poolSize: 3 });
  e.setPinned(['v1']);
  await wait(20);
  assert.equal(log.instances.length, 3);
  assert.ok(log.instances.every((i) => !i.closed));
  e.close();
});

test('пачка из трёх фраз сразу: все берут готовые соединения, без открытия по одному', async () => {
  const { e, log } = mk(() => 'ok', { poolSize: 3, refreshAfterMs: 1e9 });
  e.setPinned(['v1']);
  await wait(20);
  const base = log.instances.length;
  const bufs = await Promise.all([e.synth('a', 'v1', 1, '+0Hz'), e.synth('b', 'v1', 1, '+0Hz'), e.synth('c', 'v1', 1, '+0Hz')]);
  assert.equal(bufs.length, 3);
  await wait(20);
  assert.equal(log.instances.length - base, 3, 'после пачки пул снова полный (замены открыты в фоне)');
  e.close();
});
