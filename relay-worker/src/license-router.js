// Маршруты лицензирования: /lic/* — для приложения, /admin и /admin/api/* — для автора (по секрету ADMIN_TOKEN).
import { ADMIN_HTML } from './admin-page.js';

const MAX_BODY = 4096;
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
async function sameSecret(a, b) {
  const x = await sha256(a), y = await sha256(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function readBody(request) {
  if (request.method !== 'POST') return {};
  const raw = await request.text();
  if (raw.length > MAX_BODY) return null;
  try { const j = JSON.parse(raw || '{}'); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch (_) { return {}; }
}

const stub = (env) => env.LICENSES.get(env.LICENSES.idFromName('global'));
async function call(env, op, ...args) {
  const r = await stub(env).fetch('https://licenses/op', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) });
  return r.json();
}

export async function handleLicense(request, env, url) {
  const p = url.pathname;
  const isLic = p.startsWith('/lic/');
  const isAdmin = p === '/admin' || p === '/admin/' || p.startsWith('/admin/api/');
  if (!isLic && !isAdmin) return null;
  if (!env.LICENSES) return json(503, { ok: false, error: 'licenses_not_configured' });

  // ---- приложение ----
  if (isLic) {
    if (p === '/lic/pubkey' && request.method === 'GET') return json(200, await call(env, 'publicKey'));
    if (request.method !== 'POST') return json(405, { ok: false, error: 'method' });
    const b = await readBody(request);
    if (b === null) return json(413, { ok: false, error: 'too_large' });
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (p === '/lic/status') return json(200, await call(env, 'status', b.installId, b.mid));
    if (p === '/lic/activate') return json(200, await call(env, 'activate', b.installId, b.key, ip));
    if (p === '/lic/deactivate') return json(200, await call(env, 'deactivate', b.installId));
    return json(404, { ok: false });
  }

  // ---- админка ----
  if (p === '/admin' || p === '/admin/') {
    return new Response(ADMIN_HTML, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  const secret = typeof env.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : '';
  if (secret.length < 16) return json(503, { ok: false, error: 'admin_disabled', message: 'Секрет ADMIN_TOKEN не задан или короче 16 символов' });
  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!auth || !(await sameSecret(auth, secret))) return json(401, { ok: false, error: 'unauthorized' });
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method' });
  const b = await readBody(request);
  if (b === null) return json(413, { ok: false, error: 'too_large' });

  switch (p) {
    case '/admin/api/list': return json(200, await call(env, 'listLicenses'));
    case '/admin/api/create': return json(200, await call(env, 'createLicense', { plan: b.plan, days: b.days, maxDevices: b.maxDevices, note: b.note }));
    case '/admin/api/extend': return json(200, await call(env, 'extend', b.key, b.days));
    case '/admin/api/revoke': return json(200, await call(env, 'setRevoked', b.key, !!b.revoked));
    case '/admin/api/devices-max': return json(200, await call(env, 'setMaxDevices', b.key, b.maxDevices));
    case '/admin/api/note': return json(200, await call(env, 'setNote', b.key, b.note));
    case '/admin/api/devices-reset': return json(200, await call(env, 'resetDevices', b.key));
    case '/admin/api/delete': return json(200, await call(env, 'deleteLicense', b.key));
    default: return json(404, { ok: false });
  }
}
