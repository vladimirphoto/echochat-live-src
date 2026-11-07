'use strict';
// Движок Azure AI Speech: SSML, проверка ключа и региона, каталог голосов, повторы, «предохранитель», подключение к приложению
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createAzure, buildSsml, pickRussian, isRegion, isKey, AzureError } = require('../azure-tts');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const KEY = 'abcdef0123456789abcdef0123456789';
const AUDIO = Buffer.alloc(4000, 7);
const mk = (replies, cfg = { key: KEY, region: 'westeurope' }) => {
  const calls = [];
  const az = createAzure({
    getConfig: () => cfg, retryDelayMs: [1, 1],
    request: async (p) => {
      calls.push(p);
      const r = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  });
  return { az, calls };
};
const ok = (body = AUDIO) => ({ status: 200, headers: {}, body });
const st = (status) => ({ status, headers: {}, body: Buffer.from('x') });

test('SSML: родной русский голос, скорость и тон, экранирование текста', () => {
  const x = buildSsml({ text: 'Том & Джерри <3 "да"', voice: 'ru-RU-SvetlanaNeural', rate: 1.2, pitch: '+5Hz' });
  assert.match(x, /xml:lang="ru-RU"/);
  assert.match(x, /<voice name="ru-RU-SvetlanaNeural">/);
  assert.match(x, /<prosody rate="\+20%" pitch="\+5Hz">/);
  assert.ok(x.includes('Том &amp; Джерри') && !x.includes('<3') && x.includes('&quot;да&quot;'));
  assert.ok(!x.includes('<lang'), 'у родного русского голоса подсказка языка не нужна');
});

test('SSML: без изменений скорости и тона тега prosody нет, медленнее нормы — минус', () => {
  assert.ok(!buildSsml({ text: 'привет', voice: 'ru-RU-DmitryNeural', rate: 1, pitch: '+0Hz' }).includes('prosody'));
  assert.match(buildSsml({ text: 'привет', voice: 'ru-RU-DmitryNeural', rate: 0.8, pitch: '-10Hz' }), /rate="-20%" pitch="-10Hz"/);
  assert.match(buildSsml({ text: 'привет', voice: 'ru-RU-DmitryNeural', rate: 9 }), /rate="\+100%"/, 'скорость ограничена');
  assert.match(buildSsml({ text: 'привет', voice: 'ru-RU-DmitryNeural', rate: 0.1 }), /rate="-50%"/);
  assert.ok(!buildSsml({ text: 'привет', voice: 'ru-RU-DmitryNeural', rate: 1, pitch: '5; drop' }).includes('pitch='), 'мусор в тоне игнорируется');
});

test('SSML: многоязычный голос получает подсказку ru-RU только для кириллицы и en-US в корне', () => {
  const ru = buildSsml({ text: 'Привет, мир', voice: 'en-US-AvaMultilingualNeural', rate: 1, pitch: '+0Hz' });
  assert.match(ru, /<speak [^>]*xml:lang="en-US"/);
  assert.match(ru, /<lang xml:lang="ru-RU">Привет, мир<\/lang>/);
  const en = buildSsml({ text: 'Hello there', voice: 'en-US-AvaMultilingualNeural', rate: 1, pitch: '+0Hz' });
  assert.ok(!en.includes('<lang'));
  assert.match(buildSsml({ text: 'Привет', voice: 'en-US-Ava:DragonHDLatestNeural', rate: 1.1 }), /<lang xml:lang="ru-RU">.*<\/lang>/);
});

test('SSML: имя голоса с разметкой отклоняется', () => {
  assert.throws(() => buildSsml({ text: 'a', voice: 'x"><evil/>', rate: 1 }), AzureError);
  assert.throws(() => buildSsml({ text: 'a', voice: '', rate: 1 }), AzureError);
});

test('регион и ключ: только безопасные значения (регион попадает в адрес сервера)', () => {
  assert.ok(isRegion('westeurope') && isRegion('eastus2') && isRegion('germany-westcentral'));
  for (const bad of ['', 'evil.com/x', 'a b', 'west_europe', 'WESTEUROPE', 'x', 'a'.repeat(40), 'west@evil.com', null, 5]) assert.ok(!isRegion(bad), String(bad));
  assert.ok(isKey(KEY));
  for (const bad of ['', 'short', 'ключ-не-ascii-ключ-не-ascii', 'has space in key 1234567890', KEY + '\r\nX-Evil: 1', 'a'.repeat(300), null]) assert.ok(!isKey(bad), String(bad));
});

test('каталог: русские и многоязычные с ru-RU, предварительные пропускаются, родные и HD первыми', () => {
  const list = [
    { ShortName: 'en-US-JennyNeural', Locale: 'en-US', Gender: 'Female', LocalName: 'Jenny' },
    { ShortName: 'en-US-AvaMultilingualNeural', Locale: 'en-US', Gender: 'Female', LocalName: 'Ava Multilingual', SecondaryLocaleList: ['ru-RU', 'de-DE'] },
    { ShortName: 'ru-RU-DmitryNeural', Locale: 'ru-RU', Gender: 'Male', LocalName: 'Дмитрий' },
    { ShortName: 'ru-RU-SvetlanaNeural', Locale: 'ru-RU', Gender: 'Female', LocalName: 'Светлана' },
    { ShortName: 'en-US-Ava:DragonHDLatestNeural', Locale: 'en-US', Gender: 'Female', LocalName: 'Ava HD', SecondaryLocaleList: ['ru-RU'] },
    { ShortName: 'en-US-NewOneNeural', Locale: 'en-US', Gender: 'Male', Status: 'Preview', SecondaryLocaleList: ['ru-RU'] },
    { ShortName: 'de-DE-KatjaNeural', Locale: 'de-DE', Gender: 'Female', SecondaryLocaleList: ['de-AT'] },
    { ShortName: 'bad name"', Locale: 'ru-RU' }, null, 5,
  ];
  const v = pickRussian(list);
  assert.deepEqual(v.map((x) => x.id), ['ru-RU-DmitryNeural', 'ru-RU-SvetlanaNeural', 'en-US-Ava:DragonHDLatestNeural', 'en-US-AvaMultilingualNeural']);
  assert.equal(v[0].name, 'Дмитрий');
  assert.equal(v[0].gender, 'M');
  assert.ok(v[0].native && !v[0].multilingual);
  assert.ok(v[2].hd && v[2].multilingual);
  assert.equal(v[3].name, 'Ава');
  assert.deepEqual(pickRussian(null), []);
});

test('синтез: запрос уходит на хост региона с ключом, SSML и форматом MP3', async () => {
  const { az, calls } = mk([ok()]);
  const b = await az.synth('Привет', 'ru-RU-SvetlanaNeural', 1, '+0Hz');
  assert.ok(Buffer.isBuffer(b) && b.length === 4000);
  const c = calls[0];
  assert.equal(c.host, 'westeurope.tts.speech.microsoft.com');
  assert.equal(c.method, 'POST');
  assert.equal(c.path, '/cognitiveservices/v1');
  assert.equal(c.headers['Ocp-Apim-Subscription-Key'], KEY);
  assert.equal(c.headers['Content-Type'], 'application/ssml+xml');
  assert.equal(c.headers['X-Microsoft-OutputFormat'], 'audio-24khz-96kbitrate-mono-mp3');
  assert.match(c.body, /<voice name="ru-RU-SvetlanaNeural">Привет<\/voice>/);
});

test('синтез: нет ключа или неверный регион — ошибка no-key без обращения к сети', async () => {
  for (const cfg of [{ key: '', region: 'westeurope' }, { key: KEY, region: 'evil.com/x' }, {}]) {
    const { az, calls } = mk([ok()], cfg);
    await assert.rejects(az.synth('a', 'ru-RU-SvetlanaNeural', 1), (e) => e.code === 'no-key');
    assert.equal(calls.length, 0);
    assert.equal(az.configured(), false);
  }
});

test('неверный ключ (401): без повторов, дальше фразы не ходят в сеть, а после смены настроек снова ходят', async () => {
  const { az, calls } = mk([st(401)]);
  await assert.rejects(az.synth('a', 'ru-RU-SvetlanaNeural', 1), (e) => e.code === 'auth');
  assert.equal(calls.length, 1);
  await assert.rejects(az.synth('b', 'ru-RU-SvetlanaNeural', 1), (e) => e.code === 'auth');
  assert.equal(calls.length, 1, 'предохранитель: сеть не трогаем');
  assert.equal(az.state().blocked, 'auth');
  az.reset();
  await assert.rejects(az.synth('c', 'ru-RU-SvetlanaNeural', 1), (e) => e.code === 'auth');
  assert.equal(calls.length, 2);
});

test('лимит (429) и сбой сервера (5xx): повторы, затем успех или ошибка', async () => {
  const a = mk([st(429), st(503), ok()]);
  assert.equal((await a.az.synth('a', 'ru-RU-SvetlanaNeural', 1)).length, 4000);
  assert.equal(a.calls.length, 3);
  const b = mk([st(500)]);
  await assert.rejects(b.az.synth('a', 'ru-RU-SvetlanaNeural', 1), (e) => e.code === 'server');
  assert.equal(b.calls.length, 3, 'первая попытка и два повтора');
  const c = mk([st(429)]);
  await assert.rejects(c.az.synth('a', 'ru-RU-SvetlanaNeural', 1), (e) => e.code === 'quota');
});

test('сеть: обрыв и таймаут различаются; пустой звук — ошибка', async () => {
  const n = mk([Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })]);
  await assert.rejects(n.az.synth('a', 'ru-RU-SvetlanaNeural', 1), (e) => e.code === 'network');
  const t = mk([Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })]);
  await assert.rejects(t.az.synth('a', 'ru-RU-SvetlanaNeural', 1), (e) => e.code === 'timeout');
  const e0 = mk([ok(Buffer.alloc(10))]);
  await assert.rejects(e0.az.synth('a', 'ru-RU-SvetlanaNeural', 1), (e) => e.code === 'empty');
});

test('ключ не попадает в текст ошибок', async () => {
  for (const r of [st(401), st(429), st(500), new Error('boom ' + KEY)]) {
    const { az } = mk([r]);
    await assert.rejects(az.synth('a', 'ru-RU-SvetlanaNeural', 1), (e) => !String(e.message).includes(KEY));
  }
});

test('голоса аккаунта: проверка ключа, кэш на 10 минут, принудительное обновление', async () => {
  const list = [{ ShortName: 'ru-RU-SvetlanaNeural', Locale: 'ru-RU', Gender: 'Female' }, { ShortName: 'en-US-JennyNeural', Locale: 'en-US' }];
  const { az, calls } = mk([{ status: 200, headers: {}, body: Buffer.from(JSON.stringify(list)) }]);
  const r = await az.voices();
  assert.equal(r.all, 2);
  assert.deepEqual(r.voices.map((v) => v.id), ['ru-RU-SvetlanaNeural']);
  assert.equal(calls[0].path, '/cognitiveservices/voices/list');
  await az.voices();
  assert.equal(calls.length, 1, 'из кэша');
  await az.voices({ force: true });
  assert.equal(calls.length, 2);
  const bad = mk([{ status: 200, headers: {}, body: Buffer.from('<html>') }]);
  await assert.rejects(bad.az.voices(), (e) => e.code === 'server');
  const noauth = mk([st(401)]);
  await assert.rejects(noauth.az.voices(), (e) => e.code === 'auth');
  assert.equal(noauth.az.state().blocked, null, 'проверка ключа не включает предохранитель синтеза');
});

test('main.js: ветка Azure в tts:synth с откатом на Edge, команды az:*, ключ шифруется и не уходит в окно', () => {
  const m = read('main.js');
  assert.match(m, /o\.engine === 'azure'/);
  assert.match(m, /az\.synth\(/);
  assert.match(m, /fallback: true, azureCode/);
  assert.match(m, /edgeSynth\(text, edgeFallbackVoice\(o\)/);
  for (const ch of ['az:status', 'az:set', 'az:test', 'az:warm']) assert.ok(m.includes(`'${ch}'`), ch);
  assert.match(m, /safeStorage\.encryptString/);
  const status = /const azStatus = \(\) => \{[^\n]*\n/.exec(m)[0];
  assert.ok(!/key:\s*c\.key|key: azCfg/.test(status), 'ключ не возвращается в окно');
  assert.ok(status.includes('keyTail'));
});

test('preload и сборка: az-методы доступны окну, azure-tts.js попадает в пакет', () => {
  const pre = read('preload.js');
  for (const n of ['azStatus', 'azSet', 'azTest', 'azWarm']) assert.ok(pre.includes(n + ':'), n);
  assert.ok(JSON.parse(read('package.json')).build.files.includes('azure-tts.js'));
});

test('окно: вкладки движков, форма подключения, движок и запасной голос уходят в синтез', () => {
  const r = read('src/renderer.js'), h = read('src/index.html');
  for (const id of ['engSeg', 'routeSum', 'azBox', 'azKey', 'azRegion', 'azSave', 'azForget', 'azStat', 'azPill']) assert.ok(h.includes(`id="${id}"`), id);
  assert.match(h, /data-eng="edge"/);
  assert.match(h, /data-eng="azure"/);
  assert.match(h, /id="azKey"[^>]*type="password"|type="password"[^>]*id="azKey"/, 'ключ скрыт точками');
  assert.match(r, /engine: az \? 'azure' : 'edge'/);
  assert.match(r, /fallbackVoice:/);
  assert.match(r, /S\.presets\.filter\(\(p\) => engOf\(p\) === S\.engView\)/, 'на вкладке только голоса её движка');
  assert.match(r, /p\.provider === 'azure' \|\| BASE_IDS\.includes\(p\.id\)/, 'каталог Edge не удаляет голоса Azure');
  assert.match(r, /filter\(\(p\) => engOf\(p\) === 'edge'\)/, 'пул Edge прогревается только голосами Edge');
});
