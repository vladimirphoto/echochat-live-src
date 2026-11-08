'use strict';
// Маршрутизация озвучки: какой движок говорит фразу и что делать при сбое.
//  • голос «silero:<имя>» — Silero (офлайн); если не установлен или сломался — Edge голосом того же пола;
//  • голос Edge — Edge; если Silero установлен, он страхует: подключается, когда Edge ответил ошибкой
//    или молчит дольше graceMs (раньше, чем ожидание фразы в окне, см. SYNTH_DEADLINE_MS в renderer.js). Побеждает первый, кто ответил.
const SILERO_PREFIX = 'silero:';
const EDGE_BY_GENDER = { M: 'ru-RU-DmitryNeural', F: 'ru-RU-SvetlanaNeural' };
const SILERO_BY_GENDER = { M: 'aidar', F: 'kseniya' };
const SILERO_SR = 48000;

const clampTempo = (r) => Math.min(2, Math.max(0.5, Number(r) || 1));

function createRouter({ edge, silero, graceMs = 4000 }) {
  // edge(text, voice, rate, pitch, { urgent }) -> Promise<Buffer>; silero: { installed(): bool, synth(text, speaker, sr): Promise<Buffer> }
  const viaEdge = async (o, voice) => ({ audio: (await edge(o.text, voice, o.rate, o.pitch, { urgent: !!o.urgent })).toString('base64'), mime: 'audio/mpeg' });
  const viaSilero = async (o, speaker) => ({ audio: (await silero.synth(o.text, speaker, SILERO_SR)).toString('base64'), mime: 'audio/wav', tempo: clampTempo(o.rate) });

  async function synth(o) {
    const text = String(o.text || '').slice(0, 400);
    if (!text.trim()) throw new Error('empty text');
    const req = { ...o, text };
    const gender = o.gender === 'M' ? 'M' : 'F';
    const voice = typeof o.voice === 'string' ? o.voice : '';

    if (voice.startsWith(SILERO_PREFIX)) {
      if (silero.installed()) {
        try { return await viaSilero(req, voice.slice(SILERO_PREFIX.length)); }
        catch (e) { if (e && e.code === 'EMPTY') throw new Error('empty text'); /* сбой — ниже говорим через Edge */ }
      }
      return viaEdge(req, EDGE_BY_GENDER[gender]);
    }
    if (!silero.installed()) return viaEdge(req, voice);

    return new Promise((resolve, reject) => {
      let done = false, open = 1, edgeErr = null, lastErr = null, started = false, timer = null;
      const ok = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
      const failed = (e) => { lastErr = lastErr || e; if (--open === 0 && !done) { done = true; clearTimeout(timer); reject(edgeErr || lastErr); } };
      const startSilero = () => {
        if (started || done) return;
        started = true; open++;
        viaSilero(req, SILERO_BY_GENDER[gender]).then(ok, failed);
      };
      viaEdge(req, voice).then(ok, (e) => { edgeErr = e; startSilero(); failed(e); });
      timer = setTimeout(startSilero, graceMs);
    });
  }
  return { synth };
}

module.exports = { createRouter, SILERO_PREFIX, EDGE_BY_GENDER, SILERO_BY_GENDER };
