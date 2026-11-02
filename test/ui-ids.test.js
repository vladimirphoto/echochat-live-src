'use strict';
// каждый $('#id') из renderer.js должен существовать в index.html (иначе приложение падает при старте)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync(require('path').join(__dirname, '../src/index.html'), 'utf8');
const js = ['renderer.js', 'license-ui.js'].map((f) => fs.readFileSync(require('path').join(__dirname, '../src/' + f), 'utf8')).join('\n');
const DYNAMIC = new Set(['gKey', 'gSave', 'engErr', 'wRecheck']); // создаются кодом
test('все #id из renderer.js есть в index.html', () => {
  const ids = new Set([...js.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]));
  const missing = [...ids].filter((i) => !DYNAMIC.has(i) && !html.includes(`id="${i}"`));
  assert.deepEqual(missing, []);
});
