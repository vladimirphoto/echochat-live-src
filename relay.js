'use strict';
// Донаты Каспи через интернет: приложение раз в пару секунд спрашивает сервер-посредник (relay/poll.php),
// не прислал ли телефон новое уведомление. Модуль не зависит от Electron.

const POLL_MS = 3000;
const MAX_AGE_MS = 5 * 60 * 1000; // слишком старые уведомления не озвучиваем

// base — адрес папки с relay на сайте, например https://example.com/echochat
const normBase = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/\/(?:poll|notify)\.php$/i, '');
const isHttp = (u) => /^https?:\/\/[^\s/]+/i.test(String(u || ''));

function startRelay({ getConfig, onNotification, onState }) {
  let timer = null, stopped = false, after = 0, lastOk = null;
  const seen = new Set();
  const state = (ok, error) => { if (lastOk !== ok) { lastOk = ok; try { onState && onState({ ok, error: error || '' }); } catch (_) {} } };

  async function tick() {
    if (stopped) return;
    const c = getConfig();
    const base = normBase(c.relayUrl);
    try {
      if (!c.enabled || !c.token || !isHttp(base)) { state(false, 'адрес сервера не задан'); return; }
      const url = `${base}/poll.php?token=${encodeURIComponent(c.token)}&after=${after}`;
      const headers = c.licToken ? { 'X-Echo-License': String(c.licToken) } : {};
      const r = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store', headers });
      if (!r.ok) throw new Error('сервер ответил ' + r.status);
      const j = await r.json();
      if (!j || j.ok !== true || !Array.isArray(j.items)) throw new Error('неверный ответ сервера');
      if (j.needPro) { state(false, 'донаты Каспи доступны в Pro'); return; }
      state(true);
      for (const it of j.items) {
        const id = Number(it.id) || 0;
        if (id > after) after = id;
        if (seen.has(id)) continue;
        seen.add(id);
        if (seen.size > 500) seen.delete(seen.values().next().value);
        if (Date.now() - (Number(it.t) || 0) * 1000 > MAX_AGE_MS) continue;
        const text = [it.title, it.text].filter(Boolean).join('\n');
        try { onNotification(text); } catch (_) {}
      }
    } catch (e) {
      state(false, String((e && e.message) || e));
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  }

  timer = setTimeout(tick, 500);
  return { close() { stopped = true; if (timer) clearTimeout(timer); } };
}

module.exports = { startRelay, normBase, isHttp, POLL_MS };
