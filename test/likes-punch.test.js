'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const LIKES = require('../widget-likes-page');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('топ лайков: удар рукой срабатывает только при смене лидера и отключается настройкой', () => {
  assert.match(LIKES, /function punch\(/);
  assert.match(LIKES, /nm\[0\]!==pv\[0\]\)punch\(0\)/); // сменился лидер
  assert.match(LIKES, /nm\[2\]===pv\[1\]\)punch\(1\)/); // новый второй бьёт вытесненного на 3 место
  assert.match(LIKES, /!pv\.length/); // первая таблица после подключения/сброса не бьёт
  assert.match(LIKES, /S\.punch===false/);
});

test('настройка «Удар рукой» есть в приложении и доходит до виджета', () => {
  assert.match(rd('main.js'), /punch: s\.punch !== false/);
  assert.match(rd('src/index.html'), /data-lk="punch"/);
  assert.match(rd('src/renderer.js'), /likes: \{[^}]*punch: true/);
});
