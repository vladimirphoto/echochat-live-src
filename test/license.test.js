'use strict';
// Сценарии лицензирования: сервер (relay-worker/src/license-core.js) + клиент (license.js) без сети и Electron
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LicenseManager, verifyToken, evaluate } = require('../license');

const DAY = 86400000;
let core;
test.before(async () => { core = await import('../relay-worker/src/license-core.js'); });

// хранилище как у Durable Object: get/put/delete/list({prefix}) -> Map
function memStorage() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { return m.delete(k); },
    async list({ prefix }) { return new Map([...m].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)])); },
  };
}
function server() {
  const clock = { t: Date.UTC(2026, 10, 2, 10, 0, 0) };
  const storage = memStorage();
  const svc = new core.LicenseService(storage, new core.Signer(storage), () => clock.t);
  return { svc, clock, storage };
}
// клиент ходит на «сервер» напрямую; online можно выключить
function net(srv) {
  const st = { online: true, down: false, calls: 0 };
  const fetchImpl = async (url, opt = {}) => {
    st.calls++;
    if (!st.online) throw new Error('fetch failed');
    if (st.down) return { ok: false, status: 503, json: async () => ({}) };
    const u = new URL(url);
    const b = opt.body ? JSON.parse(opt.body) : {};
    let res;
    if (u.pathname === '/lic/pubkey') res = await srv.svc.publicKey();
    else if (u.pathname === '/lic/status') res = await srv.svc.status(b.installId);
    else if (u.pathname === '/lic/activate') res = await srv.svc.activate(b.installId, b.key, '1.2.3.4');
    else if (u.pathname === '/lic/deactivate') res = await srv.svc.deactivate(b.installId);
    return { ok: true, status: 200, json: async () => res };
  };
  return { st, fetchImpl };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'echo-lic-'));
function client(srv, n, dir = tmp(), extra = {}) {
  const changes = [];
  const m = new LicenseManager({ dir, getServer: () => 'https://lic.example', fetchImpl: n.fetchImpl, now: () => srv.clock.t, onChange: (s, meta) => changes.push({ s, meta }), ...extra });
  return { m, dir, changes };
}

test('ключи: формат и нормализация', () => {
  const k = core.generateKey();
  assert.match(k, /^ECHO(-[A-Z2-9]{5}){4}$/);
  assert.equal(core.normalizeKey(k.toLowerCase().replace(/-/g, ' ')), k);
  assert.equal(core.normalizeKey('мусор'), '');
});

test('1-2. первый запуск: сервер начинает 3-дневный Trial, подпись проверяется', async () => {
  const srv = server(), n = net(srv), { m } = client(srv, n);
  const st = await m.refresh();
  assert.equal(st.plan, 'trial');
  assert.equal(st.daysLeft, 3);
  assert.deepEqual(st.locked, []);
  assert.equal(st.offline, false);
  assert.ok(verifyToken(m.data.token, m.pub));
});

test('3-5. Trial работает 3 дня, затем Lite с закрытыми «Виджеты» и «Донаты»', async () => {
  const srv = server(), n = net(srv), { m } = client(srv, n);
  await m.refresh();
  srv.clock.t += 2 * DAY + 23 * 3600e3;
  assert.equal(m.state().plan, 'trial'); // токен ещё в силе, клиент считает по времени сам
  srv.clock.t += 2 * 3600e3;
  let st = m.state();
  assert.equal(st.plan, 'lite');
  assert.equal(st.reason, 'trial-ended');
  assert.deepEqual(st.locked, ['widgets', 'kaspi']);
  assert.equal(m.isLocked('widgets'), true);
  st = await m.refresh();
  assert.equal(st.plan, 'lite');
  assert.equal(st.reason, 'trial-ended');
});

test('Trial не сбрасывается переустановкой приложения с тем же ID на сервере', async () => {
  const srv = server();
  assert.equal((await srv.svc.status('11111111-2222-3333-4444-555555555555')).state.plan, 'trial');
  srv.clock.t += 4 * DAY;
  assert.equal((await srv.svc.status('11111111-2222-3333-4444-555555555555')).state.plan, 'lite');
});

test('6-8. Pro по ключу: активация, срок отсчитывается с активации, анимация (justActivated)', async () => {
  const srv = server(), n = net(srv), { m, changes } = client(srv, n);
  const { license } = await srv.svc.createLicense({ plan: 'pro', days: 30, maxDevices: 2, note: 'тест' });
  await m.refresh();
  srv.clock.t += 5 * DAY; // ключ лежал, срок не шёл; Trial уже закончился
  await m.refresh();
  assert.equal(m.state().plan, 'lite');
  const r = await m.activate(license.key.toLowerCase());
  assert.equal(r.ok, true);
  assert.equal(r.state.plan, 'pro');
  assert.equal(r.state.daysLeft, 30);
  assert.deepEqual(r.state.locked, []);
  assert.match(r.state.keyMasked, /^ECHO-/);
  assert.ok(changes.some((c) => c.meta.activated));
});

test('9-10. продление и окончание подписки', async () => {
  const srv = server(), n = net(srv), { m } = client(srv, n);
  const { license } = await srv.svc.createLicense({ plan: 'pro', days: 30 });
  await m.activate(license.key);
  await srv.svc.extend(license.key, 30);
  assert.equal((await m.refresh()).daysLeft, 60);
  srv.clock.t += 58 * DAY;
  assert.equal((await m.refresh()).plan, 'pro');
  srv.clock.t += 3 * DAY;
  assert.equal(m.state().plan, 'lite'); // токен ещё свежий, но срок вышел — клиент понижает сам
  assert.equal(m.state().reason, 'sub-expired');
  assert.equal((await m.refresh()).plan, 'lite');
  // продление уже истёкшего ключа считается от сегодняшнего дня
  const r = await srv.svc.extend(license.key, 30);
  assert.equal(r.license.expiresAt, srv.clock.t + 30 * DAY);
});

test('11. временная лицензия от администратора (7 дней)', async () => {
  const srv = server(), n = net(srv), { m } = client(srv, n);
  const { license } = await srv.svc.createLicense({ plan: 'pro', days: 7, note: 'подарок' });
  const r = await m.activate(license.key);
  assert.equal(r.state.plan, 'pro');
  assert.equal(r.state.daysLeft, 7);
});

test('12. Lifetime: бессрочно, даже через годы онлайн', async () => {
  const srv = server(), n = net(srv), { m } = client(srv, n);
  const { license } = await srv.svc.createLicense({ plan: 'lifetime' });
  const r = await m.activate(license.key);
  assert.equal(r.state.plan, 'lifetime');
  assert.equal(r.state.until, null);
  srv.clock.t += 800 * DAY;
  assert.equal((await m.refresh()).plan, 'lifetime');
  assert.equal((await srv.svc.extend(license.key, 5)).ok, false);
});

test('13. перенос на другой компьютер: лимит устройств, освобождение, сброс админом', async () => {
  const srv = server(), n = net(srv);
  const { license } = await srv.svc.createLicense({ plan: 'pro', days: 30, maxDevices: 1 });
  const a = client(srv, n).m, b = client(srv, n).m;
  assert.equal((await a.activate(license.key)).ok, true);
  const denied = await b.activate(license.key);
  assert.equal(denied.ok, false);
  assert.equal(denied.error, 'device_limit');
  // освободили на первом — активировали на втором
  const rel = await a.deactivate();
  assert.equal(rel.ok, true);
  assert.notEqual(rel.state.plan, 'pro');
  assert.equal((await b.activate(license.key)).ok, true);
  // первый компьютер потерян: админ сбрасывает устройства, лимит можно поднять
  await srv.svc.resetDevices(license.key);
  assert.notEqual((await b.refresh()).plan, 'pro');
  assert.equal((await srv.svc.setMaxDevices(license.key, 3)).ok, true);
  assert.equal((await a.activate(license.key)).ok, true);
  assert.equal((await b.activate(license.key)).ok, true);
});

test('14. без интернета: кэш Pro живёт 7 дней, потом нужна проверка; сервер 503 не блокирует', async () => {
  const srv = server(), n = net(srv), { m } = client(srv, n);
  const { license } = await srv.svc.createLicense({ plan: 'pro', days: 90 });
  await m.activate(license.key);
  n.st.online = false;
  let st = await m.refresh();
  assert.equal(st.offline, true);
  assert.equal(st.plan, 'pro');
  srv.clock.t += 6 * DAY;
  assert.equal(m.state().plan, 'pro');
  n.st.online = true; n.st.down = true; // сервер лежит
  assert.equal((await m.refresh()).plan, 'pro');
  srv.clock.t += 2 * DAY; // 8 суток без успешной проверки
  st = m.state();
  assert.equal(st.plan, 'lite');
  assert.equal(st.reason, 'offline-expired');
  n.st.down = false; // связь вернулась — Pro восстанавливается сам
  st = await m.refresh();
  assert.equal(st.plan, 'pro');
  assert.equal(st.offline, false);
});

test('14б. первый запуск без интернета: локальный Trial 3 дня, потом сервер подтверждает', async () => {
  const srv = server(), n = net(srv); n.st.online = false;
  const { m } = client(srv, n);
  let st = await m.refresh();
  assert.equal(st.plan, 'trial');
  assert.equal(st.localTrial, true);
  srv.clock.t += 4 * DAY;
  assert.equal(m.state().plan, 'lite');
});

test('15. переустановка Windows: новый ID, тот же ключ работает; старое устройство освобождает админ', async () => {
  const srv = server(), n = net(srv);
  const { license } = await srv.svc.createLicense({ plan: 'pro', days: 30, maxDevices: 1 });
  const old = client(srv, n).m;
  assert.equal((await old.activate(license.key)).ok, true);
  const fresh = client(srv, n).m; // чистая папка = новая установка
  assert.notEqual(fresh.installId, old.installId);
  assert.equal((await fresh.activate(license.key)).error, 'device_limit');
  await srv.svc.resetDevices(license.key);
  assert.equal((await fresh.activate(license.key)).state.plan, 'pro');
});

test('настройки и ID переживают перезапуск; повреждённый license.json восстанавливается из копии', async () => {
  const srv = server(), n = net(srv), dir = tmp();
  const a = client(srv, n, dir).m;
  await a.refresh();
  const id = a.installId;
  await a.refresh(); // второй сохранение создаёт .bak
  fs.writeFileSync(path.join(dir, 'license.json'), '{broken');
  const b = client(srv, n, dir).m;
  assert.equal(b.installId, id);
  assert.equal(b.state().plan, 'trial');
});

test('безопасность: подделанный токен и чужой токен отвергаются, часы назад не продлевают', async () => {
  const srv = server(), n = net(srv), { m, dir } = client(srv, n);
  const { license } = await srv.svc.createLicense({ plan: 'pro', days: 5 });
  await srv.svc.createLicense({ plan: 'lifetime' });
  await m.activate(license.key);
  // подмена плана в токене
  const body = JSON.parse(Buffer.from(m.data.token.split('.')[0], 'base64url'));
  body.plan = 'lifetime'; body.until = null;
  const forged = Buffer.from(JSON.stringify(body)).toString('base64url') + '.' + m.data.token.split('.')[1];
  assert.equal(verifyToken(forged, m.pub), null);
  // чужой токен (другой installId)
  const other = client(srv, n).m;
  await other.refresh();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'license.json'), 'utf8'));
  saved.token = other.data.token;
  fs.writeFileSync(path.join(dir, 'license.json'), JSON.stringify(saved));
  const c = client(srv, n, dir).m;
  assert.notEqual(c.state().plan, 'pro'); // токен не от этой установки
  // откат часов
  const d2 = client(srv, n).m;
  await d2.activate(license.key);
  srv.clock.t += 6 * DAY; // подписка кончилась
  d2.state();
  srv.clock.t -= 6 * DAY; // пользователь отмотал часы
  assert.equal(d2.state().plan, 'lite');
  assert.equal(d2.state().clockBack, true);
});

test('защита ключей: после 10 неверных ключей — блок на час; отозванный и неизвестный ключи', async () => {
  const srv = server(), id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  for (let i = 0; i < 10; i++) assert.equal((await srv.svc.activate(id, 'ECHO-AAAAA-AAAAA-AAAAA-AAAAA')).error, 'key_not_found');
  const { license } = await srv.svc.createLicense({ plan: 'pro', days: 30 });
  assert.equal((await srv.svc.activate(id, license.key)).error, 'rate_limited');
  srv.clock.t += 2 * 3600e3;
  assert.equal((await srv.svc.activate(id, license.key)).ok, true);
  await srv.svc.setRevoked(license.key, true);
  assert.equal((await srv.svc.status(id)).state.plan, 'trial'); // отозван — вернулся Trial (ещё не кончился)
  assert.equal((await srv.svc.status(id)).state.reason, 'revoked');
  assert.equal((await srv.svc.activate('bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', license.key)).error, 'key_revoked');
});

test('evaluate: чистая логика тарифов', () => {
  const now = 1_000_000_000_000;
  assert.equal(evaluate(null, now, { trialStart: now - DAY }).plan, 'trial');
  assert.equal(evaluate(null, now, { trialStart: now - 4 * DAY }).plan, 'lite');
  const pro = { plan: 'pro', until: now + DAY, exp: now + DAY, trialEnd: now - DAY };
  assert.equal(evaluate(pro, now, {}).plan, 'pro');
  assert.equal(evaluate({ ...pro, until: now - 1 }, now, {}).plan, 'lite');
});
