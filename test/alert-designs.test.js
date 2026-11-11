'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const alerts = require('../alerts');
const ALERT = require('../widget-alert-page');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('оповещения: дизайн проверяется, неизвестный откатывается на стандарт, доходит до виджета', () => {
  assert.equal(alerts.cleanSettings({}).design, 'classic');
  assert.equal(alerts.cleanSettings({ design: 'neon' }).design, 'neon');
  assert.equal(alerts.cleanSettings({ design: 'что-то' }).design, 'classic');
  assert.equal(alerts.widgetSettings(alerts.cleanSettings({ design: 'candy' }), null).design, 'candy');
  assert.equal(alerts.DESIGNS.length, 8);
});

test('страница оповещений: восемь дизайнов, у каждого свой класс; для party конфетти, для gold/arcade/glass свои значки', () => {
  assert.match(ALERT, /var DESIGNS=\['classic','neon','minimal','party','gold','arcade','glass','candy'\]/);
  for (const c of ['.a-neon', '.a-min', '.a-party', '.a-gold', '.a-arc', '.a-glass', '.a-candy']) assert.ok(ALERT.includes(c + ' .plate{') || ALERT.includes(c + '{'), c);
  assert.match(ALERT, /ds==='party'/);
  assert.match(ALERT, /HGLYPH/);
  assert.equal(rd('docs/alert/index.html'), ALERT);
});

test('вкладка «Виджеты»: выбор из восьми дизайнов оповещения под предпросмотром', () => {
  const h = rd('src/index.html');
  for (const d of ['classic', 'neon', 'minimal', 'party', 'gold', 'arcade', 'glass', 'candy']) assert.ok(h.includes('data-adesign="' + d + '"'), d);
  assert.ok(h.indexOf('id="adzGrid"') > h.indexOf('id="alBox"'));
  assert.match(rd('src/renderer.js'), /design: 'classic' \},\n/);
});
