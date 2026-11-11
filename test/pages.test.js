'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = require('../widget-page');

test('страница для GitHub Pages совпадает с виджетом приложения (npm run pages)', () => {
  const f = path.join(__dirname, '..', 'docs', 'chat', 'index.html');
  assert.equal(fs.readFileSync(f, 'utf8'), PAGE);
});

test('страница берёт адрес приложения из параметра port', () => {
  assert.match(PAGE, /new URLSearchParams\(location\.search\)/);
  assert.match(PAGE, /\.get\('port'\)/);
  assert.match(PAGE, /127\.0\.0\.1:'\+port\+'\/events/); // страница сама перебирает порты 7878-7898
});

const DONATE = require('../widget-donate-page');
test('страница донатов для GitHub Pages совпадает с виджетом приложения (npm run pages)', () => {
  const f = path.join(__dirname, '..', 'docs', 'donate', 'index.html');
  assert.equal(fs.readFileSync(f, 'utf8'), DONATE);
});

test('страница донатов подключается к приложению и слушает события донатов', () => {
  assert.match(DONATE, /127\.0\.0\.1:'\+port\+'\/events/);
  assert.match(DONATE, /addEventListener\('donate'/);
  assert.match(DONATE, /addEventListener\('dsettings'/);
});

const LIKES = require('../widget-likes-page');
test('страница топа лайков для GitHub Pages совпадает с виджетом приложения (npm run pages)', () => {
  const f = path.join(__dirname, '..', 'docs', 'likes', 'index.html');
  assert.equal(fs.readFileSync(f, 'utf8'), LIKES);
});

test('страница топа лайков подключается к приложению и слушает лайки и настройки', () => {
  assert.match(LIKES, /127\.0\.0\.1:'\+port\+'\/events/);
  assert.match(LIKES, /addEventListener\('likes'/);
  assert.match(LIKES, /addEventListener\('lsettings'/);
});

test('страница чата показывает закреп: слушает pin, ставит плашку сверху и убирает по сроку', () => {
  assert.match(PAGE, /addEventListener\('pin'/);
  assert.match(PAGE, /id="pinw"/);
  assert.match(PAGE, /function setPin\(/);
  assert.match(PAGE, /PIN\.until/); // срок проверяется на самой странице
  assert.match(PAGE, /textContent=e\.text/); // текст вставляется только как текст, без разметки
  assert.doesNotMatch(PAGE, /innerHTML=e\.text|innerHTML\+=e\.text/);
});
