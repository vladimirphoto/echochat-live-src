'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DONATE = require('../widget-donate-page');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('виджет доната: стандарт и три дизайна, неизвестный дизайн откатывается на стандарт', () => {
  assert.match(DONATE, /var DESIGNS=\['classic','neon','minimal','party'\]/);
  for (const c of ['.d-neon', '.d-min', '.d-party']) assert.ok(DONATE.includes(c + '{') || DONATE.includes(c + ' '), c);
  assert.match(DONATE, /indexOf\(S\.design\)>=0\?S\.design:'classic'/);
  assert.match(DONATE, /if\(ds==='party'\)confetti\(c\)/);
  assert.equal(rd('docs/donate/index.html'), DONATE);
});

test('дизайн доходит до виджета и не ломает старые настройки', () => {
  const m = rd('main.js');
  assert.match(m, /design: DONATE_DESIGNS\.includes\(dset\.design\) \? dset\.design : 'classic'/);
  assert.match(m, /ipcMain\.handle\('donate:preview'/);
  assert.match(rd('preload.js'), /donatePreview/);
});

test('вкладка «Донаты Каспи»: выбор из четырёх дизайнов под «Подключением»', () => {
  const h = rd('src/index.html');
  for (const d of ['classic', 'neon', 'minimal', 'party']) assert.ok(h.includes('data-design="' + d + '"'), d);
  assert.ok(h.indexOf('id="dzGrid"') > h.indexOf('id="kBox"') && h.indexOf('id="dzGrid"') < h.indexOf('id="guideCard"'));
  assert.match(rd('src/renderer.js'), /design: 'classic'/);
});
