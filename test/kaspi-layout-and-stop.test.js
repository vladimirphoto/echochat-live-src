'use strict';
// «Донаты Каспи»: слева только подключение iPhone, справа видео → виджет → предпросмотр → настройки.
// Озвучка: выключили переключатель — очередь и текущая фраза этого источника обрываются сразу.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');

test('донаты Каспи: порядок блоков в колонках', () => {
  const sec = html.slice(html.indexOf('id="tab-kaspi"'), html.indexOf('<!-- НАСТРОЙКИ -->'));
  const at = (s) => { const i = sec.indexOf(s); assert.ok(i >= 0, s); return i; };
  const right = at('class="col-right"');
  assert.ok(at('class="col-left"') < at('card kc') && at('card kc') < right, 'слева подключение iPhone');
  const order = ['guide-card', 'Виджет донатов', 'preview-card', 'Настройки виджета'].map(at);
  assert.ok(order.every((v, i) => v > right && (i === 0 || v > order[i - 1])), 'справа: видео, виджет, предпросмотр, настройки');
  assert.equal((sec.match(/<div\b/g) || []).length, (sec.match(/<\/div>/g) || []).length, 'теги div сбалансированы');
});

test('донаты Каспи: CSS не переворачивает колонки обратно', () => {
  assert.ok(!/#tab-kaspi\s+\.col-(left|right)\s*\{[^}]*order\s*:/.test(css));
});

test('выключение озвучки сразу чистит очередь и обрывает текущую фразу', () => {
  assert.match(js, /function dropSrc\(src\)/);
  assert.match(js, /if \(!el\.checked\) dropSrc\(k\)/);
  for (const src of ["'ttChat'", "'twChat'", "'gifts'", "'follows'"]) assert.ok(js.includes(src), src);
  // поведение: берём сам dropSrc и гоняем на тестовой очереди
  const body = js.slice(js.indexOf('function dropSrc(src)'), js.indexOf('function silence()'));
  const queue = [{ src: 'ttChat' }, { src: 'twChat' }, { src: 'ttChat' }, { src: 'gifts' }];
  const cur = { src: 'ttChat' }; let skipped = 0;
  const drop = new Function('queue', 'curItem', 'skipPhrase', `${body}; return dropSrc;`)(queue, cur, () => { skipped++; });
  drop('ttChat');
  assert.deepEqual(queue.map((q) => q.src), ['twChat', 'gifts'], 'чужие фразы остаются');
  assert.equal(skipped, 1, 'текущая фраза TikTok оборвана');
  drop('twChat');
  assert.deepEqual(queue.map((q) => q.src), ['gifts']);
  assert.equal(skipped, 1, 'текущая фраза TikTok не мешает отключению Twitch');
});
