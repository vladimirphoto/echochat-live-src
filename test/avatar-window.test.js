'use strict';
// Окна аватара для «Захвата окна» (TikTok LIVE Studio): расчёты в avatar.js и подключение в приложении.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const av = require('../avatar');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('окно аватара: имя окна, страница и движок для 2D и 3D', () => {
  assert.equal(av.winTitle('2d'), 'ЭхоЧат LIVE — аватар 2D');
  assert.equal(av.winTitle('3d'), 'ЭхоЧат LIVE — аватар 3D');
  assert.equal(av.winTitle('что-то'), 'ЭхоЧат LIVE — аватар 2D');
  assert.equal(av.winPage('2d'), 'avatar');
  assert.equal(av.winPage('3d'), 'avatar3d');
  assert.equal(av.winEngine('3d'), '3d');
  assert.equal(av.winEngine(undefined), '2d');
  assert.equal(av.WIN.bg, '#00b140'); // тот же зелёный, что у настройки «Зелёный фон»
});

test('окно аватара: сохранённое положение возвращается, только если окно видно на экране', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  assert.deepEqual(av.winBounds({ x: 100, y: 50, width: 480, height: 640 }, areas), { x: 100, y: 50, width: 480, height: 640 });
  assert.equal(av.winBounds({ x: 5000, y: 50, width: 480, height: 640 }, areas), null); // экран отключили
  assert.equal(av.winBounds({ x: 100, y: 50 }, areas), null);
  assert.equal(av.winBounds('x', areas), null);
  const small = av.winBounds({ x: 0, y: 0, width: 10, height: 10 }, areas);
  assert.equal(small.width, av.WIN.minW); assert.equal(small.height, av.WIN.minH); // слишком маленькое окно растёт до минимума
});

test('окно аватара: по умолчанию открывается по центру и помещается на маленьком экране', () => {
  const b = av.winDefaultBounds({ x: 0, y: 0, width: 1920, height: 1040 });
  assert.equal(b.width, av.WIN.defW); assert.equal(b.height, av.WIN.defH);
  assert.equal(b.x, Math.round((1920 - b.width) / 2));
  const s = av.winDefaultBounds({ x: 0, y: 0, width: 400, height: 500 });
  assert.ok(s.width <= 400 && s.height <= 500 && s.x >= 0 && s.y >= 0);
});

test('окно аватара: кнопки 2D и 3D, API, обработчик и закрытие вместе с приложением и при окончании тарифа', () => {
  const html = rd('src/index.html'), ui = rd('src/avatar-ui.js'), pre = rd('preload.js'), main = rd('main.js');
  for (const id of ['avWinBtn', 'avWinTxt', 'av3WinBtn', 'av3WinTxt']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /Захват окна/);
  assert.match(pre, /avatarWindow: \(engine, open\) => ipcRenderer\.invoke\('avatar:window', engine, open\)/);
  assert.match(ui, /api\.avatarWindow\(def\.engine, !open\)/);
  assert.match(ui, /onAvatarState\(\(d\) => \{ if \(d && d\.windows/);
  assert.match(main, /ipcMain\.handle\('avatar:window'/);
  assert.match(main, /backgroundColor: av\.WIN\.bg/);
  assert.match(main, /title: av\.winTitle\(k\)/);
  assert.match(main, /if \(locked\('widgets'\)\) return \{ ok: false, locked: true \}/); // как и сам аватар, окно только в Pro
  assert.match(main, /function closeAvatar\(\) \{ closeAvatarWindows\(\)/); // окна закрываются вместе с приложением
  assert.match(main, /closeOverlay\(\); closeAvatarWindows\(\); \}/); // и когда тариф закончился
  assert.match(main, /windows: avWinsState\(\), installing/);
});
