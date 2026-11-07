'use strict';
// Озвучка Azure AI Speech (REST). Отдельный движок рядом с Microsoft Edge: свой ключ и регион пользователя, платные/бесплатные квоты Azure.
// Соединения постоянные (keep-alive), поэтому фраза уходит без нового рукопожатия TLS. Ключ нигде не логируется и в окно не возвращается.
const https = require('https');
const { escapeSsml } = require('./edge-pool');

const OUTPUT_FORMAT = 'audio-24khz-96kbitrate-mono-mp3';
const REGION_RE = /^[a-z][a-z0-9-]{2,30}$/;        // регион попадает в имя хоста — только безопасные символы
const KEY_RE = /^[\x21-\x7E]{16,200}$/;            // печатные ASCII без пробелов: ключ уходит в заголовок
const VOICE_RE = /^[\w.:-]{3,90}$/;                // ru-RU-SvetlanaNeural, en-US-Ava:DragonHDLatestNeural

// частые регионы для подсказки в окне (можно вписать любой)
const REGIONS = [
  ['westeurope', 'Западная Европа'], ['northeurope', 'Северная Европа'], ['swedencentral', 'Швеция'], ['germanywestcentral', 'Германия'],
  ['francecentral', 'Франция'], ['uksouth', 'Великобритания'], ['eastus', 'США · восток'], ['eastus2', 'США · восток 2'],
  ['centralus', 'США · центр'], ['westus2', 'США · запад 2'], ['southeastasia', 'Юго-Восточная Азия'], ['uaenorth', 'ОАЭ'],
].map(([id, name]) => ({ id, name }));

class AzureError extends Error {
  constructor(code, message) { super(message); this.name = 'AzureError'; this.code = code; }
}
const MSG = {
  'no-key': 'Azure: не указан ключ или регион',
  auth: 'Azure: неверный ключ или регион',
  quota: 'Azure: превышен лимит запросов или квота',
  bad: 'Azure: сервис не принял запрос',
  server: 'Azure: сервис временно недоступен',
  network: 'Azure: нет связи с сервером',
  timeout: 'Azure: сервер не ответил вовремя',
  empty: 'Azure: пришёл пустой звук',
};
const err = (code) => new AzureError(code, MSG[code] || MSG.server);

const isRegion = (r) => typeof r === 'string' && REGION_RE.test(r);
const isKey = (k) => typeof k === 'string' && KEY_RE.test(k);
const hostFor = (region) => `${region}.tts.speech.microsoft.com`;

// ---------- SSML ----------
const localeOf = (voice) => (/^([a-z]{2,3}-[A-Z]{2,4})-/.exec(voice) || [])[1] || 'en-US';
const isMultilingual = (voice) => /Multilingual|Dragon/i.test(voice);
const hasCyrillic = (s) => /[Ѐ-ӿ]/.test(s);

// rate приходит множителем (1 = как есть), pitch — строкой «+5Hz»
function buildSsml({ text, voice, rate, pitch }) {
  if (!VOICE_RE.test(String(voice || ''))) throw err('bad');
  const multi = isMultilingual(voice);
  const pct = Math.max(-50, Math.min(100, Math.round(((Number(rate) || 1) - 1) * 100)));
  const hz = /^[+-]\d{1,3}Hz$/.test(String(pitch || '')) ? String(pitch) : '+0Hz';
  let body = escapeSsml(text);
  // многоязычные голоса сами определяют язык, но на коротких русских фразах ошибаются — подсказываем язык, если в тексте кириллица
  if (multi && hasCyrillic(text)) body = `<lang xml:lang="ru-RU">${body}</lang>`;
  const attrs = [pct !== 0 ? `rate="${pct > 0 ? '+' : ''}${pct}%"` : '', hz !== '+0Hz' && hz !== '-0Hz' ? `pitch="${hz}"` : ''].filter(Boolean).join(' ');
  if (attrs) body = `<prosody ${attrs}>${body}</prosody>`;
  const lang = multi ? 'en-US' : localeOf(voice); // для многоязычных голосов документация требует en-US в корне
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}">${body}</voice></speak>`;
}

// ---------- каталог: только русские и те многоязычные, что умеют ru-RU ----------
const FRIENDLY = {
  SvetlanaNeural: 'Светлана', DmitryNeural: 'Дмитрий', DariyaNeural: 'Дария',
  AvaMultilingualNeural: 'Ава', EmmaMultilingualNeural: 'Эмма', AndrewMultilingualNeural: 'Эндрю', BrianMultilingualNeural: 'Брайан',
  VivienneMultilingualNeural: 'Вивьен', RemyMultilingualNeural: 'Реми', SeraphinaMultilingualNeural: 'Серафина', FlorianMultilingualNeural: 'Флориан',
};
function pickRussian(list) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    if (!v || typeof v.ShortName !== 'string' || !VOICE_RE.test(v.ShortName)) continue;
    if (v.Status && v.Status !== 'GA') continue;                     // предварительные голоса нестабильны
    const secondary = Array.isArray(v.SecondaryLocaleList) ? v.SecondaryLocaleList : [];
    const native = /^ru-/i.test(v.Locale || v.ShortName);
    if (!native && !secondary.includes('ru-RU')) continue;
    const id = v.ShortName;
    const tail = id.replace(/^[a-z]{2,3}-[A-Z]{2,4}-/, '');          // SvetlanaNeural | Ava:DragonHDLatestNeural
    const person = tail.split(':')[0];
    const hd = /HD/i.test(id);
    out.push({
      id,
      name: FRIENDLY[tail] || FRIENDLY[person] || String(v.LocalName || v.DisplayName || person).replace(/\s*Multilingual$/i, '').trim() || person,
      locale: v.Locale || '',
      gender: /^f/i.test(v.Gender || '') ? 'F' : 'M',
      native, multilingual: !native, hd,
      styles: Array.isArray(v.StyleList) ? v.StyleList.slice(0, 12) : [],
    });
  }
  // сначала родные русские, затем HD, затем остальные по имени
  return out.sort((a, b) => (b.native - a.native) || (b.hd - a.hd) || a.name.localeCompare(b.name, 'ru'));
}

// ---------- HTTP ----------
function httpsRequest(agent, { host, path, method, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body) h['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({ host, path, method, headers: h, agent, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function createAzure(opts) {
  const {
    getConfig,                       // () => ({ key, region })
    request,                         // подмена сети в тестах: (params) => Promise<{ status, headers, body }>
    timeoutMs = 8000,
    retries = 2,                     // повторов при сбое сети, 5xx и 429
    retryDelayMs = [300, 800],
    now = () => Date.now(),
  } = opts || {};
  const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 20000, maxSockets: 8 });
  const send = request || ((p) => httpsRequest(agent, p));
  let blockedUntil = 0, blockedCode = null; // «предохранитель»: после явной ошибки не мучаем сервис каждой фразой, фраза сразу идёт запасным голосом
  let catalog = null, catalogAt = 0;

  const cfg = () => {
    const c = (getConfig && getConfig()) || {};
    if (!isKey(c.key) || !isRegion(c.region)) throw err('no-key');
    return c;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const codeOfStatus = (s) => (s === 401 || s === 403 ? 'auth' : s === 429 ? 'quota' : s >= 500 ? 'server' : 'bad');
  const block = (code) => { blockedCode = code; blockedUntil = now() + ({ auth: 5 * 60e3, 'no-key': 0, quota: 60e3, bad: 0, server: 20e3, network: 20e3, timeout: 20e3 }[code] || 0); };

  async function call(params, { guard = true } = {}) {
    const c = cfg();
    if (guard && now() < blockedUntil) throw err(blockedCode);
    let last = null;
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await send({ host: hostFor(c.region), timeoutMs, ...params, headers: { 'Ocp-Apim-Subscription-Key': c.key, 'User-Agent': 'EchoChatLive', ...params.headers } });
        if (r.status >= 200 && r.status < 300) { blockedUntil = 0; return r; }
        last = err(codeOfStatus(r.status));
        if (last.code === 'auth' || last.code === 'bad') break;      // повтор не поможет
      } catch (e) {
        last = err(e && (e.code === 'ETIMEDOUT' || /timeout/i.test(e.message)) ? 'timeout' : 'network');
      }
      if (i < retries) await sleep(retryDelayMs[i] || 800);
    }
    if (guard) block(last.code);
    throw last;
  }

  async function synth(text, voice, rate, pitch) {
    const body = buildSsml({ text, voice, rate, pitch });
    const r = await call({ method: 'POST', path: '/cognitiveservices/v1', body, headers: { 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': OUTPUT_FORMAT } });
    if (!r.body || r.body.length < 200) throw err('empty');
    return r.body;
  }

  // проверка ключа и загрузка голосов аккаунта; список кэшируется на 10 минут
  async function voices({ force = false } = {}) {
    if (!force && catalog && now() - catalogAt < 10 * 60e3) return catalog;
    const r = await call({ method: 'GET', path: '/cognitiveservices/voices/list' }, { guard: false });
    let list;
    try { list = JSON.parse(r.body.toString('utf8')); } catch (_) { throw err('server'); }
    catalog = { all: Array.isArray(list) ? list.length : 0, voices: pickRussian(list) };
    catalogAt = now();
    blockedUntil = 0;
    return catalog;
  }

  // ключ или регион изменились: забываем кэш и снимаем блокировку
  function reset() { blockedUntil = 0; blockedCode = null; catalog = null; catalogAt = 0; try { agent.destroy(); } catch (_) {} }
  // заранее открыть соединение (ответ не важен): первая фраза не платит за TLS
  function warm() { try { const c = cfg(); send({ host: hostFor(c.region), method: 'HEAD', path: '/', headers: {}, timeoutMs: 4000 }).catch(() => {}); } catch (_) {} }
  const configured = () => { try { cfg(); return true; } catch (_) { return false; } };
  const state = () => ({ blocked: now() < blockedUntil ? blockedCode : null });

  return { synth, voices, reset, warm, configured, state };
}

module.exports = { createAzure, buildSsml, pickRussian, isRegion, isKey, AzureError, REGIONS, OUTPUT_FORMAT, MSG };
