'use strict';
// Озвучка Microsoft Edge TTS через постоянные соединения.
// Раньше на каждую фразу открывалось новое соединение (рукопожатие + TLS ≈ 0,3–1,5 с, а при сбоях сервера и дольше).
// Теперь готовые соединения лежат в пуле и переиспользуются: фраза уходит сразу.
// Один запрос = одно соединение целиком (параллельные фразы берут разные соединения), поэтому запросы не мешают друг другу.

// Текст идёт в SSML (XML) как есть. Символы «&», «<», «>» в чате («Том & Джерри», «<3») делали SSML невалидным, и фраза молча пропадала.
function escapeSsml(s) {
  return String(s)
    .replace(/<3+/g, ' ') // «<3» — сердечко из чата, вслух не читаем
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ' ') // символы, запрещённые в XML
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function createEdgeSynth(opts) {
  const {
    loadTts,                       // async () => ({ MsEdgeTTS, OUTPUT_FORMAT })
    hedgeMs = 1500,                // нет ответа столько — параллельно запускаем ещё одну попытку на новом соединении
    maxAttempts = 4,
    timeoutMs = 6000,              // одна попытка без данных дольше этого — обрыв
    reuseMaxAgeMs = 90000,         // простаивавшее дольше соединение при выдаче заменяется новым
    refreshAfterMs = 40000,        // фоновая проверка обновляет простаивающие дольше этого
    tickMs = 10000,
    forgetMs = 10 * 60 * 1000,     // голос не подтверждали (окно напоминает об используемых голосах раз в 5 мин) — перестаём держать для него соединение
    idleMax = 2,
  } = opts || {};

  const idle = new Map();   // голос -> [{ tts, at }]
  const known = new Map();  // голос -> когда использовался последний раз
  const pending = new Set(); // голоса, для которых прямо сейчас открывается соединение
  let lib = null, timer = null, closed = false;

  const getLib = async () => lib || (lib = await loadTts());
  const fmtOf = (m) => m.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3 || m.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
  const kill = (c) => { try { c.tts.close(); } catch (_) {} };
  const isOpen = (tts) => { const ws = tts && tts._ws; return !ws || ws.readyState === 1; }; // не знаем — считаем живым

  async function open(voice) {
    const m = await getLib();
    const tts = new m.MsEdgeTTS();
    try { await tts.setMetadata(voice, fmtOf(m)); } catch (e) { try { tts.close(); } catch (_) {} throw e; }
    return { tts, at: Date.now() };
  }

  async function acquire(voice) {
    const list = idle.get(voice) || [];
    while (list.length) {
      const c = list.pop();
      if (Date.now() - c.at > reuseMaxAgeMs) { kill(c); continue; }
      try {
        const m = await getLib();
        await c.tts.setMetadata(voice, fmtOf(m)); // соединение живо — вернётся сразу; закрылось — переподключится
        return c;
      } catch (_) { kill(c); }
    }
    return open(voice);
  }

  function release(voice, c) {
    c.at = Date.now();
    const list = idle.get(voice) || [];
    idle.set(voice, list);
    if (closed || list.length >= idleMax) return kill(c);
    list.push(c);
  }

  async function once(text, voice, rate, pitch) {
    const c = await acquire(voice);
    let ok = false, res = null, t;
    try {
      res = await c.tts.toStream(escapeSsml(text), { rate: Number(rate) || 1, pitch: pitch || '+0Hz' });
      const chunks = [];
      await Promise.race([
        new Promise((resolve, reject) => {
          res.audioStream.on('data', (ch) => chunks.push(ch));
          res.audioStream.on('end', resolve);
          res.audioStream.on('close', resolve);
          res.audioStream.on('error', reject);
        }),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error('tts timeout')), timeoutMs); }),
      ]);
      const buf = Buffer.concat(chunks);
      if (!buf.length) throw new Error('empty audio');
      ok = true;
      return buf;
    } finally {
      clearTimeout(t);
      if (ok) release(voice, c);
      else { try { res && res.audioStream.destroy(); } catch (_) {} kill(c); } // неудачное соединение больше не используем
    }
  }

  // Сервер Microsoft иногда отвечает медленно или обрывает поток. Нет ответа за hedgeMs — параллельно новая попытка
  // (уже на другом соединении), берём первую успешную.
  function synth(text, voice, rate, pitch) {
    voice = voice || 'ru-RU-SvetlanaNeural';
    known.set(voice, Date.now());
    startTimer();
    return new Promise((resolve, reject) => {
      let done = false, started = 0, failed = 0, last, t;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(t); fn(v); };
      const schedule = (ms) => { clearTimeout(t); if (!done && started < maxAttempts) t = setTimeout(launch, ms); };
      function launch() {
        if (done || started >= maxAttempts) return;
        started++;
        once(text, voice, rate, pitch).then((buf) => finish(resolve, buf)).catch((err) => {
          last = err; failed++;
          if (failed >= maxAttempts) return finish(reject, last);
          if (failed >= started) schedule(Math.min(150 * failed, 600)); // ничего не в работе — следующая попытка почти сразу
        });
        schedule(hedgeMs);
      }
      launch();
    });
  }

  // держим для голоса готовое соединение: открываем в фоне, не дублируя уже идущее подключение
  function refill(voice) {
    if (closed || pending.has(voice)) return;
    pending.add(voice);
    open(voice).then((c) => release(voice, c)).catch(() => {}).finally(() => pending.delete(voice));
  }

  // заранее открыть соединение для голосов, чтобы первая фраза эфира не ждала рукопожатия
  function warm(voices) {
    for (const v of voices || []) {
      if (!v || closed) continue;
      known.set(v, Date.now());
      if (!(idle.get(v) || []).some((c) => isOpen(c.tts))) refill(v);
    }
    startTimer();
  }

  // раз в несколько секунд: убираем оборвавшиеся соединения и обновляем простаивающие.
  // Новое открываем ДО закрытия старого — у готового соединения нет «окна», когда фразе пришлось бы подключаться самой.
  function tick() {
    const now = Date.now();
    for (const [voice, used] of [...known]) {
      let list = idle.get(voice) || [];
      if (now - used > forgetMs) { known.delete(voice); list.forEach(kill); idle.delete(voice); continue; }
      const dead = list.filter((c) => !isOpen(c.tts));
      if (dead.length) { dead.forEach(kill); list = list.filter((c) => !dead.includes(c)); idle.set(voice, list); }
      if (!list.length) { refill(voice); continue; }
      for (const old of list.filter((c) => now - c.at > refreshAfterMs && !c.renewing)) {
        old.renewing = true;
        open(voice).then((n) => {
          const l = idle.get(voice) || [];
          if (l.includes(old)) { idle.set(voice, l.filter((x) => x !== old)); kill(old); }
          release(voice, n);
        }).catch(() => { old.renewing = false; });
      }
    }
  }
  function startTimer() {
    if (timer || closed) return;
    timer = setInterval(tick, tickMs);
    if (timer.unref) timer.unref();
  }

  function close() {
    closed = true;
    if (timer) { clearInterval(timer); timer = null; }
    for (const list of idle.values()) list.forEach(kill);
    idle.clear(); known.clear();
  }

  return { synth, warm, close, _idle: idle, _tick: tick };
}

module.exports = { createEdgeSynth, escapeSsml };
