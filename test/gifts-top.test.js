'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ev = require('../events');
const GIFTS = require('../widget-gifts-page');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('страница топа подарков для GitHub Pages совпадает с виджетом приложения (npm run pages)', () => {
  assert.equal(rd('docs/gifts/index.html'), GIFTS);
});

test('страница топа подарков слушает подарки и настройки, лидер ликует, а руки (как в лайках) нет', () => {
  assert.match(GIFTS, /127\.0\.0\.1:'\+port\+'\/events/);
  assert.match(GIFTS, /addEventListener\('gifts'/);
  assert.match(GIFTS, /addEventListener\('gsettings'/);
  assert.match(GIFTS, /function celebrate\(/);
  assert.match(GIFTS, /prev!==null/); // первая таблица после подключения/сброса не ликует
  assert.match(GIFTS, /S\.celebrate!==false/);
  assert.doesNotMatch(GIFTS, /function punch/);
});

test('подарки: очки = цена в монетах × количество, без цены — по 1 за подарок, таблица по убыванию', () => {
  assert.equal(ev.giftScore({ diamonds: 30, count: 3 }), 90);
  assert.equal(ev.giftScore({ diamonds: 0, count: 4 }), 4);
  assert.equal(ev.giftScore({}), 1);
  const g = ev.giftOf({ user: { uniqueId: 'a', nickname: 'Аня' }, giftDetails: { giftName: 'Роза', diamondCount: 1 }, repeatCount: 5 });
  assert.equal(g.diamonds, 1);
  const b = new ev.GiftsBoard();
  b.add({ id: 'a', name: 'Аня' }, 10); b.add({ id: 'b', name: 'Боб' }, 50); b.add({ id: 'a', name: 'Аня' }, 45);
  assert.deepEqual(b.top(2).map((x) => [x.name, x.likes]), [['Аня', 55], ['Боб', 50]]);
});

test('топ подарков подключён: сервер, настройки, интерфейс, сборка', () => {
  assert.match(rd('widget.js'), /u === '\/gifts'/);
  assert.match(rd('main.js'), /giftsBoard\.add\(g, ev\.giftScore\(g\)\)/);
  assert.match(rd('src/index.html'), /data-gf="celebrate"/);
  assert.ok(JSON.parse(rd('package.json')).build.files.includes('widget-gifts-page.js'));
});

test('в renderer.js блок топа подарков объявлен раньше стартовой инициализации (иначе const G в мёртвой зоне и приложение падает при запуске)', () => {
  const js = rd('src/renderer.js');
  assert.ok(js.indexOf('const G = S.gifts') < js.indexOf('refreshGiftsLink(); window.echo.giftsSet'));
});
