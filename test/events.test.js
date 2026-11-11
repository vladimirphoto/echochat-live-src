'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../events');

test('чат: v1 comment и v2 content', () => {
  assert.equal(E.chatOf({ comment: 'привет', user: { nickname: 'Аня' } }).text, 'привет');
  assert.equal(E.chatOf({ content: 'привет', user: { nickname: 'Аня' } }).text, 'привет');
  assert.equal(E.chatOf({ comment: 'привет', nickname: 'Аня', uniqueId: 'anya' }).name, 'Аня');
  assert.equal(E.chatOf({}).text, '');
  assert.equal(E.chatOf({}).name, 'Гость');
});

test('время сообщения: секунды, миллисекунды, bigint, строка', () => {
  assert.equal(E.timeMs({ createTime: 1700000000 }), 1700000000000);
  assert.equal(E.timeMs({ createTime: '1700000000123' }), 1700000000123);
  assert.equal(E.timeMs({ common: { createTime: 1700000000123n } }), 1700000000123);
  assert.equal(E.timeMs({}), null);
});

test('зрители: viewerCount, total, totalUser', () => {
  assert.equal(E.viewersOf({ viewerCount: 630 }), 630);
  assert.equal(E.viewersOf({ total: 42, totalUser: 900 }), 42);
  assert.equal(E.viewersOf({ totalUser: 900 }), 900);
  assert.equal(E.viewersOf({ total: 7n }), 7);
  assert.equal(E.viewersOf({}), null);
});

test('лайки: likeCount/totalLikeCount и count/total', () => {
  assert.deepEqual(E.likesOf({ likeCount: 3, totalLikeCount: 100 }), { count: 3, total: 100 });
  assert.deepEqual(E.likesOf({ count: 2, total: 55 }), { count: 2, total: 55 });
  assert.deepEqual(E.likesOf({}), { count: 1, total: null });
});

test('подарки: v1 плоский, v2 giftDetails, v2 gift.name', () => {
  let g = E.giftOf({ giftName: 'Rose', giftType: 1, repeatCount: 3, repeatEnd: false, nickname: 'Аня' });
  assert.equal(g.gift, 'Rose'); assert.equal(g.done, false); assert.equal(g.name, 'Аня');
  g = E.giftOf({ giftName: 'Rose', giftType: 1, repeatCount: 3, repeatEnd: true });
  assert.equal(g.done, true); assert.equal(g.count, 3);
  g = E.giftOf({ giftDetails: { giftName: 'Galaxy', giftType: 2 }, repeatCount: 1, user: { nickname: 'Боря' } });
  assert.equal(g.gift, 'Galaxy'); assert.equal(g.done, true); assert.equal(g.name, 'Боря');
  g = E.giftOf({ gift: { name: 'Heart', type: 1 }, repeatCount: 5, repeatEnd: 1 });
  assert.equal(g.gift, 'Heart'); assert.equal(g.done, true);
  g = E.giftOf({});
  assert.equal(g.gift, 'подарок'); assert.equal(g.count, 1); assert.equal(g.done, true);
});

test('подписка из social', () => {
  assert.equal(E.isFollowSocial({ displayType: 'pm_main_follow_message_viewer_2' }), true);
  assert.equal(E.isFollowSocial({ action: 1 }), true);
  assert.equal(E.isFollowSocial({ displayType: 'pm_main_share_message' }), false);
  assert.equal(E.isFollowSocial({ common: { displayText: { key: 'pm_main_follow_message_viewer_2' } } }), true);
  // репост не должен считаться подпиской
  assert.equal(E.isFollowSocial({ label: '{0:user} shared the LIVE with 5 followers' }), false);
  assert.equal(E.isFollowSocial({ displayType: 'pm_mt_guidance_share_following' }), false);
  assert.equal(E.isFollowSocial({ displayType: 'pm_main_repost_message', label: 'reposted to followers' }), false);
  assert.equal(E.isShareSocial({ displayType: 'pm_mt_guidance_share_following' }), true);
  assert.equal(E.isFollowSocial({ label: '{0:user} followed the host' }), true);
  assert.equal(E.isFollowSocial({ action: 1, label: 'x' }), true);
  assert.equal(E.isFollowSocial({}), false);
});

test('подписчик канала: followInfo, followRole, isFollower, неизвестно', () => {
  assert.equal(E.userOf({ user: { nickname: 'А', followInfo: { followStatus: 1 } } }).isFollower, true);
  assert.equal(E.userOf({ user: { nickname: 'А', followInfo: { followStatus: 2 } } }).isFollower, true);
  assert.equal(E.userOf({ user: { nickname: 'А', followInfo: { followStatus: 0 } } }).isFollower, false);
  assert.equal(E.userOf({ nickname: 'А', followRole: 1 }).isFollower, true);
  assert.equal(E.userOf({ nickname: 'А', followRole: 0 }).isFollower, false);
  assert.equal(E.userOf({ user: { nickname: 'А', isFollower: true } }).isFollower, true);
  assert.equal(E.userOf({ user: { nickname: 'А' } }).isFollower, null);
});

test('лайки: total 0 означает «итога нет»', () => {
  assert.deepEqual(E.likesOf({ count: 4, total: 0 }), { count: 4, total: null });
});

test('аватарка и картинка подарка из разных версий событий', () => {
  assert.equal(E.userOf({ user: { nickname: 'А', profilePicture: { url: 'https://x/a.jpg' } } }).avatar, 'https://x/a.jpg');
  assert.equal(E.userOf({ user: { nickname: 'А', avatarThumb: { urlList: ['https://x/b.jpg'] } } }).avatar, 'https://x/b.jpg');
  assert.equal(E.userOf({ user: { nickname: 'А' } }).avatar, '');
  assert.equal(E.giftOf({ giftDetails: { giftName: 'Rose', giftImage: { urlList: ['https://x/r.png'] } } }).image, 'https://x/r.png');
});

test('Twitch IRC: разбор сообщения с тегами', () => {
  const T = require('../twitch');
  const p = T.parseLine('@badges=subscriber/1;display-name=Max;tmi-sent-ts=1700000000000 :max!max@max.tmi.twitch.tv PRIVMSG #chan :привет всем');
  assert.equal(p.cmd, 'PRIVMSG');
  assert.equal(p.tags['display-name'], 'Max');
  assert.equal(p.text, 'привет всем');
  assert.equal(T.parseLine('PING :tmi.twitch.tv').cmd, 'PING');
  assert.equal(T.connect('!!', {}).ok, false);
});

test('сервер виджета: страница, настройки и сообщения по SSE', async () => {
  const W = require('../widget');
  const srv = await W.start(() => ({ scale: 120 }), 7990);
  assert.ok(srv.port >= 7990);
  const page = await (await fetch(`http://127.0.0.1:${srv.port}/chat`)).text();
  assert.match(page, /EventSource/);
  const res = await fetch(`http://127.0.0.1:${srv.port}/events`);
  const reader = res.body.getReader();
  setTimeout(() => srv.broadcast('msg', { platform: 'twitch', name: 'Max', text: 'hi' }), 100);
  let got = '';
  const dec = new TextDecoder();
  while (!/hi/.test(got)) got += dec.decode((await reader.read()).value);
  assert.match(got, /"scale":120/);
  assert.match(got, /"platform":"twitch"/);
  await reader.cancel(); srv.close();
});

test('топ лайков: суммирует лайки по зрителям, сортирует, анонимов пропускает', () => {
  const b = new E.LikesBoard();
  const a = E.likerOf({ likeCount: 3, user: { uniqueId: 'anya', nickname: 'Аня' } });
  assert.equal(a.count, 3);
  assert.equal(b.add(a, a.count), true);
  b.add({ id: 'max', name: 'Max', avatar: 'https://x/a.png' }, 5);
  b.add({ id: 'anya', name: 'Аня' }, 4);
  assert.equal(b.add({ id: '', name: 'Гость' }, 9), false);
  assert.deepEqual(b.top(5).map((x) => [x.name, x.likes]), [['Аня', 7], ['Max', 5]]);
  assert.equal(b.top(1).length, 1);
  b.clear();
  assert.deepEqual(b.top(5), []);
});

test('события: просмотры за весь эфир отдельно от онлайна', () => {
  const ev2 = require('../events');
  assert.equal(ev2.totalViewsOf({ viewerCount: 50, totalUser: 1200 }), 1200);
  assert.equal(ev2.totalViewsOf({ viewerCount: 50 }), null); // числа нет — считаем сами
  assert.equal(ev2.viewersOf({ viewerCount: 50, totalUser: 1200 }), 50);
});

test('сервер виджета: закреп приходит новым подключениям, снимается null и истёкший не отдаётся', async () => {
  const W = require('../widget');
  const srv = await W.start(() => ({}), 7960);
  const read = async (until) => {
    const res = await fetch(`http://127.0.0.1:${srv.port}/events`);
    const reader = res.body.getReader(), dec = new TextDecoder();
    let got = '';
    while (!until.test(got)) got += dec.decode((await reader.read()).value);
    await reader.cancel();
    return got;
  };
  // закрепа нет: страница всё равно получает pin = null (после обрыва связи она не должна оставить снятый закреп)
  assert.match(await read(/event: pin\ndata: null/), /event: pin\ndata: null/);
  const pin = { entry: { platform: 'tiktok', kind: 'chat', name: 'Madara', text: 'закреплено' }, until: 0 };
  srv.broadcast('pin', pin);
  assert.match(await read(/закреплено/), /event: pin\ndata: \{"entry":\{"platform":"tiktok"/);
  srv.broadcast('pin', null);
  assert.match(await read(/event: pin\ndata: null/), /event: pin\ndata: null/);
  srv.broadcast('pin', { entry: pin.entry, until: Date.now() - 1000 }); // срок вышел, а страница ещё не подключалась
  assert.match(await read(/event: pin\ndata: null/), /event: pin\ndata: null/);
  srv.close();
});
