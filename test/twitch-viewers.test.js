'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { viewersOf } = require('../twitch');

const reply = (data) => async () => ({ ok: true, json: async () => data });

test('онлайн Twitch: число зрителей из ответа', async () => {
  assert.equal(await viewersOf('shroud', reply({ data: { user: { stream: { viewersCount: 4321 } } } })), 4321);
});

test('онлайн Twitch: стрима нет, канала нет, сбой сети, плохое имя — null', async () => {
  assert.equal(await viewersOf('shroud', reply({ data: { user: { stream: null } } })), null);
  assert.equal(await viewersOf('shroud', reply({ data: { user: null } })), null);
  assert.equal(await viewersOf('shroud', async () => { throw new Error('net'); }), null);
  assert.equal(await viewersOf('shroud', async () => ({ ok: false })), null);
  assert.equal(await viewersOf('a"b', reply({})), null);
});

test('аватарки Twitch: кэш отдаётся мгновенно, один запрос на ник, пустой кэш не ждёт сеть', async () => {
  const tw = require('../twitch');
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise((r) => setTimeout(r, 30)); return { text: async () => 'https://img.example/a.png' }; };
  try {
    assert.equal(tw.cachedAvatar('NewUser'), ''); // до загрузки — пусто и без ожидания
    const [a, b] = await Promise.all([tw.avatarOf('NewUser'), tw.avatarOf('newuser')]);
    assert.equal(a, 'https://img.example/a.png'); assert.equal(b, a);
    assert.equal(calls, 1);
    assert.equal(tw.cachedAvatar('NEWUSER'), 'https://img.example/a.png');
  } finally { globalThis.fetch = realFetch; }
});
