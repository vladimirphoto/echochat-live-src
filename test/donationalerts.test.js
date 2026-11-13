'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const da = require('../donationalerts');

test('вход: адрес запроса содержит client_id, scope и response_type=token', () => {
  const u = new URL(da.authorizeUrl({ clientId: 42, state: 's1' }));
  assert.equal(u.origin + u.pathname, 'https://www.donationalerts.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), '42');
  assert.equal(u.searchParams.get('response_type'), 'token');
  assert.equal(u.searchParams.get('scope'), 'oauth-user-show oauth-donation-subscribe');
  assert.equal(u.searchParams.get('redirect_uri'), da.REDIRECT_URI);
});

test('вход: токен берётся из части после #, чужой state и отказ распознаются', () => {
  assert.deepEqual(da.parseRedirect(da.REDIRECT_URI + '#access_token=T&expires_in=99&state=s1', 's1'), { ok: true, token: 'T', expiresIn: 99 });
  assert.equal(da.parseRedirect(da.REDIRECT_URI + '#access_token=T&state=zzz', 's1').ok, false);
  assert.equal(da.parseRedirect(da.REDIRECT_URI + '#error=access_denied', 's1').error, 'Вход отменён');
  assert.equal(da.parseRedirect('https://example.com/#access_token=T', 's1').notRedirect, true);
});

test('донат: разбор сообщения канала', () => {
  const d = da.parseDonation({ id: 7, name: 'donation', username: ' Иван ', message_type: 'text', message: 'Привет', amount: 500, currency: 'rub' });
  assert.deepEqual(d, { id: '7', name: 'Иван', amount: 500, currency: 'RUB', message: 'Привет' });
  assert.equal(da.parseDonation({ amount: 0 }), null);
  assert.equal(da.parseDonation({ name: 'merchandise-sale', amount: 10 }), null);
  assert.equal(da.parseDonation({ username: 'X', amount: 5, message_type: 'audio', message: 'http://a.mp3', currency: 'USD' }).message, '');
  assert.equal(da.parseDonation({ data: { username: 'Y', amount: 3, currency: 'EUR' } }).name, 'Y');
  assert.equal(da.parseDonation(null), null);
});

test('деньги и озвучка', () => {
  assert.equal(da.formatMoney(1500, 'RUB'), '1\u00a0500\u00a0\u20bd');
  assert.equal(da.formatMoney(10.5, 'USD'), '10,50\u00a0$');
  assert.equal(da.speakAmount(500, 'KZT'), '500 тенге');
});

test('настройки приводятся к допустимым значениям', () => {
  const s = da.cleanSettings({ duration: 999, scale: 1, design: 'bad', imageKind: 'nope', soundKind: 'fanfare', minAmount: -5, voice: false });
  assert.equal(s.duration, 30); assert.equal(s.scale, 50); assert.equal(s.design, 'classic');
  assert.equal(s.imageKind, 'auto'); assert.equal(s.soundKind, 'fanfare'); assert.equal(s.minAmount, 0); assert.equal(s.voice, false);
  assert.deepEqual(da.cleanSettings(null), da.cleanSettings({}));
});

test('виджет: готовая картинка, своя картинка и «по сумме»', () => {
  assert.equal(da.cleanSettings({ imageKind: 'rocket' }).imageKind, 'auto'); // старые готовые картинки заменены картинками шаблонов
  assert.equal(da.widgetSettings(da.cleanSettings({ imageKind: 'rocket' }), null).art, '');
  assert.equal(da.widgetSettings(da.cleanSettings({ imageKind: 'auto' }), null).art, '');
  const w = da.widgetSettings(da.cleanSettings({ imageKind: 'custom' }), { mtime: 123 });
  assert.equal(w.art, ''); assert.equal(w.imageV, 123);
  assert.equal(da.widgetSettings(da.cleanSettings({ imageKind: 'custom' }), null).imageV, 0); // файла нет — картинка не требуется
});

test('все пресеты картинок и звуков уникальны', () => {
  const ids = (a) => a.map((p) => p.id);
  assert.equal(new Set(ids(da.IMAGE_PRESETS)).size, da.IMAGE_PRESETS.length);
  assert.equal(new Set(ids(da.SOUND_PRESETS)).size, da.SOUND_PRESETS.length);
});

test('свои файлы: картинка и звук сохраняются отдельно от оповещений о подписках', () => {
  const alerts = require('../alerts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'da-'));
  const src = path.join(dir, 'a.png'); fs.writeFileSync(src, Buffer.from([1, 2, 3]));
  assert.equal(alerts.saveFile(dir, da.IMAGE_BASE, alerts.IMAGE_EXT, src, 'image').ok, true);
  assert.ok(alerts.findFile(dir, da.IMAGE_BASE, alerts.IMAGE_EXT));
  assert.equal(alerts.findImage(dir), null); // картинка подписок не затронута
  alerts.clearFiles(dir, da.IMAGE_BASE);
  assert.equal(alerts.findFile(dir, da.IMAGE_BASE, alerts.IMAGE_EXT), null);
});

// ---- мок-серверы: REST DonationAlerts и Centrifugo 2 (протокол из документации) ----
function mockServers({ authOk = true } = {}) {
  const log = { connectToken: null, subscribeBody: null, auth: [] };
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let m = JSON.parse(String(raw)); if (Array.isArray(m)) m = m[0]; // клиент Centrifugo 2 может слать массив команд
      const reply = (result) => ws.send(JSON.stringify({ id: m.id, result }));
      if (m.method === 0 || m.method === undefined) { log.connectToken = m.params && m.params.token; return reply({ client: 'd558c046-c679-43e3-a62d-65989ab55f7c', version: '2.2.1', expires: false, ttl: 0 }); }
      if (m.method === 1) { log.subToken = m.params.token; log.subChannel = m.params.channel; reply({}); return ws.emit('subscribed'); }
      if (m.method === 7) return reply({}); // ping
    });
    ws.on('subscribed', () => {
      setTimeout(() => {
        const push = (data) => ws.send(JSON.stringify({ result: { type: 0, channel: log.subChannel, data: { data } } }));
        push({ id: 101, name: 'donation', username: 'Ivan', message_type: 'text', message: 'Hello!', amount: 500, currency: 'RUB' });
        push({ id: 101, name: 'donation', username: 'Ivan', message_type: 'text', message: 'Hello!', amount: 500, currency: 'RUB' }); // повтор того же доната
        push({ id: 102, name: 'donation', username: 'Анна', message_type: 'text', message: '', amount: 10.5, currency: 'USD' });
      }, 30);
    });
  });
  const api = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      log.auth.push(req.headers.authorization);
      if (!authOk) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"message":"Unauthenticated."}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/v1/user/oauth') return res.end(JSON.stringify({ data: { id: 3, code: 'tris', name: 'Tris', avatar: 'https://x/a.png', socket_connection_token: 'SOCK' } }));
      if (req.url === '/api/v1/centrifuge/subscribe') { log.subscribeBody = JSON.parse(body); return res.end(JSON.stringify({ channels: log.subscribeBody.channels.map((c) => ({ channel: c, token: 'CHTOKEN' })) })); }
      res.end('{}');
    });
  });
  return new Promise((resolve) => api.listen(0, '127.0.0.1', () => resolve({
    log, wsUrl: 'ws://127.0.0.1:' + wss.address().port,
    // запросы к DonationAlerts идут на наш мок
    fetchImpl: (url, init) => fetch(String(url).replace('https://www.donationalerts.com', 'http://127.0.0.1:' + api.address().port), init),
    close() { wss.close(); api.close(); },
  })));
}
const waitFor = (fn, ms = 6000) => new Promise((res, rej) => { const t0 = Date.now(); (function k() { const v = fn(); if (v) return res(v); if (Date.now() - t0 > ms) return rej(new Error('timeout')); setTimeout(k, 20); })(); });

test('приём: профиль → подключение → подпись канала → донаты (повтор отбрасывается)', async () => {
  const m = await mockServers();
  const got = [], states = [];
  const h = da.start({ token: 'ACCESS', wsUrl: m.wsUrl, fetchImpl: m.fetchImpl, onDonation: (d) => got.push(d), onState: (s) => states.push(s.state) });
  try {
    await waitFor(() => got.length >= 2);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(m.log.connectToken, 'SOCK');                       // подключились токеном из /user/oauth
    assert.equal(m.log.subChannel, '$alerts:donation_3');             // канал именно этого человека
    assert.equal(m.log.subToken, 'CHTOKEN');                         // подпись канала выдал «DonationAlerts»
    assert.deepEqual(m.log.subscribeBody.channels, ['$alerts:donation_3']);
    assert.equal(m.log.subscribeBody.client, 'd558c046-c679-43e3-a62d-65989ab55f7c');
    assert.ok(m.log.auth.every((a) => a === 'Bearer ACCESS'));
    assert.deepEqual(got.map((d) => d.name), ['Ivan', 'Анна']);       // повтор id=101 отброшен
    assert.equal(got[1].amount, 10.5); assert.equal(got[1].currency, 'USD');
    assert.ok(states.includes('connecting') && states.includes('live'));
  } finally { h.stop(); m.close(); }
});

test('приём: токен не принят → состояние «auth», повторов нет', async () => {
  const m = await mockServers({ authOk: false });
  const states = [];
  const h = da.start({ token: 'BAD', wsUrl: m.wsUrl, fetchImpl: m.fetchImpl, onDonation: () => {}, onState: (s) => states.push(s) });
  try {
    await waitFor(() => states.some((s) => s.state === 'auth'));
    const n = m.log.auth.length;
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(m.log.auth.length, n); // не долбим сервер
  } finally { h.stop(); m.close(); }
});
