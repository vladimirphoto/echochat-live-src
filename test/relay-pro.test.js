'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startRelay } = require('../relay');

// сервер отвечает «нужен Pro» (лицензия истекла): приложение должно отличить это от обрыва связи
const run = (fetchImpl) => new Promise((resolve) => {
  const real = global.fetch; global.fetch = fetchImpl;
  const r = startRelay({ getConfig: () => ({ enabled: true, token: 't', relayUrl: 'https://x.test/relay', licToken: 'L' }), onNotification() {}, onState: (s) => { r.close(); global.fetch = real; resolve(s); } });
});

test('донаты: «нужен Pro» от сервера — код pro, а не «нет связи»', async () => {
  const s = await run(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, items: [], needPro: true }) }));
  assert.equal(s.ok, false);
  assert.equal(s.code, 'pro');
});

test('донаты: обрыв связи — без кода pro', async () => {
  const s = await run(async () => { throw new Error('network down'); });
  assert.equal(s.ok, false);
  assert.equal(s.code, '');
});
