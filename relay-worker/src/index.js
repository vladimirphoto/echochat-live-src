// ЭхоЧат LIVE — сервер-посредник для донатов Каспи на Cloudflare Workers.
// Тот же протокол, что у папки relay/ (PHP): приложение ходит на /notify.php и /poll.php,
// поэтому приложение менять не нужно. Очередь каждого токена лежит в своём Durable Object.

import { handleLicense } from './license-router.js';
export { Licenses } from './license-do.js';

const MAX_BODY = 8192;        // байт на одно уведомление
const MAX_QUEUE = 200;        // сколько уведомлений ждёт забора на один токен
const TTL_SEC = 300;          // уведомление старше 5 минут не нужно
const RATE_PER_MINUTE = 40;   // защита от флуда на один токен

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

const validToken = (t) => /^[A-Za-z0-9_-]{16,64}$/.test(t);

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// параметры из строки запроса, формы или JSON-тела; строка запроса важнее тела (как в PHP-версии)
async function readParams(request, url) {
  const query = Object.fromEntries(url.searchParams);
  if (request.method !== 'POST') return query;
  const raw = await request.text();
  if (raw.length > MAX_BODY) return null;
  let body = {};
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('json') || /^\s*\{/.test(raw)) {
    try { const j = JSON.parse(raw); if (j && typeof j === 'object' && !Array.isArray(j)) body = j; } catch (_) {}
  } else if (ct.includes('x-www-form-urlencoded') || /^[\w.-]+=/.test(raw)) {
    body = Object.fromEntries(new URLSearchParams(raw));
  } else if (raw) {
    body = { text: raw };
  }
  return { ...body, ...query };
}

const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');

// Очередь одного токена. Хранение: одна запись на уведомление, ключ — id с ведущими нулями (для сортировки).
export class Queue {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const op = url.pathname;
    const body = await request.json();
    const s = this.state.storage;

    return this.state.blockConcurrencyWhile(async () => {
      const now = Math.floor(Date.now() / 1000);
      const all = await s.list({ prefix: 'i:' });
      const items = [];
      for (const [key, v] of all) {
        if (now - v.t > TTL_SEC) await s.delete(key);
        else items.push(v);
      }

      if (op === '/push') {
        const recent = items.filter((i) => now - i.t < 60).length;
        if (recent >= RATE_PER_MINUTE || items.length >= MAX_QUEUE) return json(429, { ok: false });
        await s.put(`i:${String(body.item.id).padStart(20, '0')}`, body.item);
        return json(200, { ok: true });
      }

      if (op === '/poll') {
        const after = Number(body.after) || 0;
        const left = [];
        for (const i of items) {
          if (Number(i.id) <= after) await s.delete(`i:${String(i.id).padStart(20, '0')}`);
          else left.push(i);
        }
        left.sort((a, b) => Number(a.id) - Number(b.id));
        return json(200, { ok: true, items: left });
      }

      return json(404, { ok: false });
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '') return json(200, { ok: true, service: 'echochat-relay' });

    // лицензирование: /lic/* (приложение) и /admin (автор)
    const lic = await handleLicense(request, env, url);
    if (lic) return lic;

    if (url.pathname !== '/notify.php' && url.pathname !== '/poll.php') return json(404, { ok: false });

    const p = await readParams(request, url);
    if (p === null) return json(413, { ok: false, error: 'too large' });

    const token = str(p.token, 100);
    if (!validToken(token)) return json(404, { ok: false }); // не подсказываем, что именно не так

    const stub = env.QUEUE.get(env.QUEUE.idFromName(await sha256Hex(token)));

    if (url.pathname === '/poll.php') {
      const after = Number(p.after) || 0;
      const r = await stub.fetch('https://queue/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ after }),
      });
      return r;
    }

    // /notify.php
    const text = str(p.text, 1500);
    const title = str(p.ttl !== undefined && p.ttl !== '' ? p.ttl : p.title, 200);
    if (text === '' && title === '') return json(400, { ok: false, error: 'empty' });

    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000); // растёт со временем
    const item = {
      id,
      t: Math.floor(Date.now() / 1000),
      text,
      title,
      app: str(p.app, 80),
      bank: str(p.bank, 20),
    };

    const r = await stub.fetch('https://queue/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item }),
    });
    const res = await r.json();
    return json(r.status, { ok: !!res.ok });
  },
};
