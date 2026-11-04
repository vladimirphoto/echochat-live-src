'use strict';
// Смена голоса чата или подарков: очередь старым голосом не дочитывается, играющая фраза обрывается
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

test('dropForVoiceChange: очередь очищается, фразы помечаются отменёнными, играющая обрывается', () => {
  const m = /function dropForVoiceChange\(\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(m, 'функция не найдена');
  const ended = [];
  const queue = [{ id: 1, onEnd: () => ended.push(1) }, { id: 2 }, { id: 3, onEnd: () => { throw new Error('сбой'); } }];
  const items = [...queue];
  let skipped = 0, warmed = 0;
  const fn = new Function('queue', 'skipPhrase', 'warmVoices', m[0] + '; return dropForVoiceChange;')(queue, () => { skipped++; }, () => { warmed++; });
  fn();
  assert.equal(warmed, 1, 'соединение для нового голоса открывается сразу');
  assert.equal(queue.length, 0);
  assert.ok(items.every((i) => i.cancelled === true));
  assert.deepEqual(ended, [1]);
  assert.equal(skipped, 1);
});

test('очередь сбрасывается только при реальной смене голоса: чат TikTok/Twitch и подарки/подписки', () => {
  assert.match(src, /was = S\[k\]; S\[k\] = p\.id;[^\n]*if \(was !== p\.id\) dropForVoiceChange\(\)/);
  assert.match(src, /const was = S\.eventVoice; S\.eventVoice = v;[^\n]*if \(was !== v\) dropForVoiceChange\(\)/);
});
