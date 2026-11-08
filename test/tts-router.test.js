'use strict';
// Маршрутизация озвучки: Silero и Edge, откат при сбое
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter } = require('../tts-router');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function make({ installed = true, edgeFn, silFn, graceMs = 4000 } = {}) {
  const calls = { edge: [], silero: [] };
  const edge = async (text, voice, rate, pitch, o) => { calls.edge.push({ text, voice, rate, pitch, o }); return edgeFn ? edgeFn(voice) : Buffer.from('EDGE'); };
  const silero = { installed: () => installed, synth: async (text, speaker, sr) => { calls.silero.push({ text, speaker, sr }); return silFn ? silFn(speaker) : Buffer.from('SIL'); } };
  return { calls, router: createRouter({ edge, silero, graceMs }) };
}
const dec = (r) => Buffer.from(r.audio, 'base64').toString();

test('голос Silero: говорит Silero, возвращает wav и темп', async () => {
  const { router, calls } = make();
  const r = await router.synth({ text: 'привет', voice: 'silero:aidar', rate: 1.2, gender: 'M' });
  assert.equal(dec(r), 'SIL'); assert.equal(r.mime, 'audio/wav'); assert.equal(r.tempo, 1.2);
  assert.deepEqual(calls.silero, [{ text: 'привет', speaker: 'aidar', sr: 48000 }]);
  assert.equal(calls.edge.length, 0);
});

test('голос Silero сломался: говорит Edge голосом того же пола', async () => {
  for (const [gender, voice] of [['M', 'ru-RU-DmitryNeural'], ['F', 'ru-RU-SvetlanaNeural']]) {
    const { router, calls } = make({ silFn: () => { throw new Error('boom'); } });
    const r = await router.synth({ text: 'привет', voice: 'silero:baya', gender });
    assert.equal(dec(r), 'EDGE'); assert.equal(r.mime, 'audio/mpeg');
    assert.equal(calls.edge[0].voice, voice);
  }
});

test('Silero не установлен, а выбран его голос: говорит Edge', async () => {
  const { router, calls } = make({ installed: false });
  const r = await router.synth({ text: 'привет', voice: 'silero:aidar', gender: 'M' });
  assert.equal(dec(r), 'EDGE'); assert.equal(calls.silero.length, 0); assert.equal(calls.edge[0].voice, 'ru-RU-DmitryNeural');
});

test('голос Edge без Silero: только Edge, свой голос, параметры доходят', async () => {
  const { router, calls } = make({ installed: false });
  const r = await router.synth({ text: 'привет', voice: 'ru-RU-SvetlanaNeural', rate: 1.1, pitch: '+5Hz', urgent: true });
  assert.equal(dec(r), 'EDGE'); assert.equal(r.tempo, undefined);
  assert.deepEqual([calls.edge[0].voice, calls.edge[0].rate, calls.edge[0].pitch, calls.edge[0].o.urgent], ['ru-RU-SvetlanaNeural', 1.1, '+5Hz', true]);
});

test('Edge ответил быстро: Silero не запускается', async () => {
  const { router, calls } = make({ graceMs: 40 });
  await router.synth({ text: 'привет', voice: 'ru-RU-SvetlanaNeural' });
  await wait(120);
  assert.equal(calls.silero.length, 0);
});

test('Edge ошибка: Silero подхватывает голосом по полу', async () => {
  for (const [gender, speaker] of [['M', 'aidar'], ['F', 'kseniya']]) {
    const { router, calls } = make({ edgeFn: () => { throw new Error('edge down'); } });
    const r = await router.synth({ text: 'привет', voice: 'ru-RU-DmitryNeural', gender });
    assert.equal(dec(r), 'SIL'); assert.equal(calls.silero[0].speaker, speaker);
  }
});

test('Edge молчит дольше паузы: выигрывает Silero, поздний Edge игнорируется', async () => {
  const { router } = make({ graceMs: 30, edgeFn: async () => { await wait(300); return Buffer.from('LATE'); } });
  const t0 = Date.now();
  const r = await router.synth({ text: 'привет', voice: 'ru-RU-SvetlanaNeural', gender: 'F' });
  assert.equal(dec(r), 'SIL'); assert.ok(Date.now() - t0 < 250);
  await wait(350); // поздний Edge завершился — без ошибок и повторного ответа
});

test('Edge быстрее Silero после паузы: берётся первый ответивший', async () => {
  const { router } = make({ graceMs: 20, edgeFn: async () => { await wait(80); return Buffer.from('EDGE'); }, silFn: async () => { await wait(400); return Buffer.from('SIL'); } });
  assert.equal(dec(await router.synth({ text: 'привет', voice: 'ru-RU-SvetlanaNeural' })), 'EDGE');
});

test('отказали оба: ошибка Edge', async () => {
  const { router } = make({ edgeFn: () => { throw new Error('edge down'); }, silFn: () => { throw new Error('sil down'); } });
  await assert.rejects(router.synth({ text: 'привет', voice: 'ru-RU-SvetlanaNeural' }), /edge down/);
});

test('пустой текст и «нечего читать» для Silero: empty text, без запасного голоса', async () => {
  const { router, calls } = make({ silFn: () => { throw Object.assign(new Error('x'), { code: 'EMPTY' }); } });
  await assert.rejects(router.synth({ text: '   ', voice: 'silero:aidar' }), /empty text/);
  await assert.rejects(router.synth({ text: '😀', voice: 'silero:aidar' }), /empty text/);
  assert.equal(calls.edge.length, 0);
});

test('текст обрезается до 400 символов', async () => {
  const { router, calls } = make({ installed: false });
  await router.synth({ text: 'а'.repeat(900), voice: 'ru-RU-SvetlanaNeural' });
  assert.equal(calls.edge[0].text.length, 400);
});
