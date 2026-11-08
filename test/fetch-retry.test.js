const test = require('node:test');
const assert = require('node:assert/strict');
const { downloadWithRetry, retryableStatus } = require('../fetch-retry');

const noWait = { sleep: async () => {} };

test('повторы скачивания: 5xx и сетевые сбои повторяются, 404 и 403 — нет', () => {
  for (const s of [500, 502, 503, 504, 429, 408]) assert.equal(retryableStatus(s), true, String(s));
  for (const s of [400, 401, 403, 404]) assert.equal(retryableStatus(s), false, String(s));
});

test('повторы скачивания: после двух сбоев третья попытка проходит', async () => {
  let calls = 0;
  const retries = [];
  const r = await downloadWithRetry(async (i) => {
    calls++;
    if (i < 2) throw new Error('Не удалось скачать: 504');
    return 'ok';
  }, { ...noWait, onRetry: (n) => retries.push(n) });
  assert.equal(r, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(retries, [1, 2]);
});

test('повторы скачивания: фатальная ошибка не повторяется', async () => {
  let calls = 0;
  await assert.rejects(downloadWithRetry(async () => {
    calls++;
    const e = new Error('Не удалось скачать: 404');
    e.fatal = true;
    throw e;
  }, noWait), /404/);
  assert.equal(calls, 1);
});

test('повторы скачивания: когда попытки кончились, отдаётся последняя ошибка', async () => {
  let calls = 0;
  await assert.rejects(downloadWithRetry(async (i) => {
    calls++;
    throw new Error('сбой ' + i);
  }, { ...noWait, delays: [1, 1, 1] }), /сбой 3/);
  assert.equal(calls, 4); // первая попытка и три повтора
});

test('повторы скачивания: паузы берутся из списка по порядку', async () => {
  const waits = [];
  await assert.rejects(downloadWithRetry(async () => { throw new Error('x'); }, { delays: [10, 20], sleep: async (ms) => { waits.push(ms); } }));
  assert.deepEqual(waits, [10, 20]);
});
