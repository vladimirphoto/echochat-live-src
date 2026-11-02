'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('видеоинструкция: /guide отдаёт страницу с плеером YouTube только для нормального ID', async () => {
  const W = require('../widget');
  const srv = await W.start(() => ({}), 7995);
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    const ok = await fetch(`${base}/guide?v=tYPJqC4Iuuw`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /text\/html/);
    assert.equal(ok.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    const html = await ok.text();
    assert.match(html, /https:\/\/www\.youtube-nocookie\.com\/embed\/tYPJqC4Iuuw\?/);
    assert.match(html, /allowfullscreen/);
    // без ID, короткий ID и попытка подставить разметку — 404
    for (const bad of ['/guide', '/guide?v=', '/guide?v=short', '/guide?v=' + encodeURIComponent('abc"><script>alert(1)</script>'), '/guide?v=tYPJqC4Iuuw12345']) {
      assert.equal((await fetch(base + bad)).status, 404, bad);
    }
  } finally { srv.close(); }
});
