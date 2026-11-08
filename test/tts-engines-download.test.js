const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const te = require('../tts-engines');

const stream = (parts) => new ReadableStream({ start(c) { for (const b of parts) c.enqueue(b); c.close(); } });
const noWait = { delays: [0, 0, 0], sleep: async () => {} };

test('загрузчик: 504 повторяется и файл в итоге скачивается целиком', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-dl-'));
  const dest = path.join(dir, 'sub', 'f.bin');
  const real = global.fetch; let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls <= 2) return { ok: false, status: 504, body: null, headers: new Map() };
    return { ok: true, status: 200, headers: new Map([['content-length', '6']]), body: stream([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]) };
  };
  try {
    await te.download('https://example.test/f', dest, null, noWait);
    assert.equal(calls, 3);
    assert.deepEqual([...fs.readFileSync(dest)], [1, 2, 3, 4, 5, 6]);
    assert.equal(fs.existsSync(dest + '.part'), false);
  } finally { global.fetch = real; }
});

test('загрузчик: 404 не повторяется, обрыв потока повторяется', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-dl-'));
  const real = global.fetch; let calls = 0;
  try {
    global.fetch = async () => { calls++; return { ok: false, status: 404, body: null, headers: new Map() }; };
    await assert.rejects(te.download('https://example.test/x', path.join(dir, 'a.bin'), null, noWait), /HTTP 404/);
    assert.equal(calls, 1);

    calls = 0; // первая попытка обрывается на 3 из 6 байт
    global.fetch = async () => {
      calls++;
      const parts = calls === 1 ? [new Uint8Array([1, 2, 3])] : [new Uint8Array([1, 2, 3, 4, 5, 6])];
      return { ok: true, status: 200, headers: new Map([['content-length', '6']]), body: stream(parts) };
    };
    await te.download('https://example.test/y', path.join(dir, 'b.bin'), null, noWait);
    assert.equal(calls, 2);
    assert.equal(fs.statSync(path.join(dir, 'b.bin')).size, 6);
  } finally { global.fetch = real; }
});
