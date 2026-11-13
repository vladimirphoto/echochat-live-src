'use strict';
// Локальный сервер виджета чата. Слушает только этот компьютер (127.0.0.1).
// Ссылка для OBS / TikTok LIVE Studio — настоящий https-адрес страницы на GitHub Pages: она подключается
// к этому серверу из браузера на этом же компьютере. Поэтому разрешаем запросы только с адреса страницы.
const http = require('http');
const PAGE = require('./widget-page');
const DONATE_PAGE = require('./widget-donate-page');
const LIKES_PAGE = require('./widget-likes-page');
const GIFTS_PAGE = require('./widget-gifts-page');
const ALERT_PAGE = require('./widget-alert-page');
const AVATAR_PAGE = require('./widget-avatar-page');
const AVATAR3D_PAGE = require('./widget-avatar3d-page');
const fs = require('fs');
const DA_PAGE = require('./widget-da-page');

const PAGES_ORIGIN = 'https://vladimirphoto.github.io';
const PAGES_URL = PAGES_ORIGIN + '/jonny-chat-tiktok/chat/';
const DONATE_PAGES_URL = PAGES_ORIGIN + '/jonny-chat-tiktok/donate/';
const LIKES_PAGES_URL = PAGES_ORIGIN + '/jonny-chat-tiktok/likes/';
const GIFTS_PAGES_URL = PAGES_ORIGIN + '/jonny-chat-tiktok/gifts/';
const ALERT_PAGES_URL = PAGES_ORIGIN + '/jonny-chat-tiktok/alert/';
const AVATAR_PAGES_URL = PAGES_ORIGIN + '/jonny-chat-tiktok/avatar/';
const AVATAR3D_PAGES_URL = PAGES_ORIGIN + '/jonny-chat-tiktok/avatar3d/';
const DA_PAGES_URL = PAGES_ORIGIN + '/jonny-chat-tiktok/da/';

// страница-обёртка с плеером YouTube (идентификатор ролика проверяется в маршруте: 11 символов a-z, A-Z, 0-9, _ и -)
const guidePage = (id) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin"><title>Видеоинструкция</title><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1" title="Видеоинструкция" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></body></html>`;

function start(getSettings, port = 7878, opts = {}) {
  const origins = opts.origins || [PAGES_ORIGIN];
  const clients = new Set();
  const history = [];
  let lastPin = null; // закреплённое сообщение: страница, подключившаяся позже (или после обрыва), сразу получает его
  const host = '127.0.0.1';
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const origin = req.headers.origin;
    const cors = origin && origins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Private-Network': 'true' }
      : {};
    if (req.method === 'OPTIONS') { // предварительный запрос браузера (CORS / доступ к локальной сети)
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    if (u === '/' || u === '/chat') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(PAGE); }
    if (u === '/donate') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(DONATE_PAGE); }
    if (u === '/gifts') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(GIFTS_PAGE); }
    if (u === '/likes') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(LIKES_PAGE); }
    if (u === '/avatar3d') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(AVATAR3D_PAGE); }
    if (u === '/avatar') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(AVATAR_PAGE); }
    // окно трекера аватара: страницу открывает только приложение; файлы библиотек и модели — из папки данных приложения (avatar.js)
    if (u === '/avatar-tracker' && opts.getTrackerPage) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(opts.getTrackerPage()); }
    if ((u.startsWith('/avatar-lib/') || u.startsWith('/avatar-model/') || u.startsWith('/avatar-vrm/')) && opts.getAvatarAsset && req.method === 'GET') {
      const a = opts.getAvatarAsset(u);
      if (!a) { res.writeHead(404, cors); return res.end(); }
      const own = /^\/avatar-lib\/avatar-/.test(u);
      res.writeHead(200, { 'Content-Type': a.mime, 'Cache-Control': own ? 'no-store' : 'max-age=3600', 'Cross-Origin-Resource-Policy': 'cross-origin', ...cors });
      const st = fs.createReadStream(a.file);
      st.on('error', () => res.destroy());
      return st.pipe(res);
    }
    if (u === '/da') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(DA_PAGE); }
    if (u === '/alert') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(ALERT_PAGE); }
    // своя картинка оповещения о подписке: страница на GitHub Pages забирает её отсюда (CORS как у /events), версия в адресе — чтобы не показывалась старая
    if (u === '/alert-image') {
      const im = opts.getAlertImage && opts.getAlertImage();
      if (!im) { res.writeHead(404, cors); return res.end(); }
      res.writeHead(200, { 'Content-Type': im.mime, 'Content-Length': im.data.length, 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'cross-origin', ...cors });
      return res.end(im.data);
    }
    // своя картинка доната DonationAlerts: так же, как картинка оповещения (CORS как у /events, версия в адресе)
    if (u === '/da-image') {
      const im = opts.getDaImage && opts.getDaImage();
      if (!im) { res.writeHead(404, cors); return res.end(); }
      res.writeHead(200, { 'Content-Type': im.mime, 'Content-Length': im.data.length, 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'cross-origin', ...cors });
      return res.end(im.data);
    }
    // видеоинструкция во вкладке «Донаты Каспи»: плеер YouTube открывается со страницы на 127.0.0.1, а не с file://
    // (с file:// YouTube часто отвечает «ошибка 153», потому что у запроса нет адреса-источника)
    if (u === '/guide') {
      const m = /[?&]v=([\w-]{11})(?:&|$)/.exec(req.url);
      if (!m) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
      return res.end(guidePage(m[1]));
    }
    if (u === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...cors });
      res.write('retry: 2000\n\n');
      res.write('event: settings\ndata: ' + JSON.stringify(getSettings()) + '\n\n');
      // закреп шлётся всегда, а если его нет — null: страница после обрыва связи не должна оставить закреп, который уже сняли
      res.write('event: pin\ndata: ' + JSON.stringify(lastPin && (!lastPin.until || lastPin.until > Date.now()) ? lastPin : null) + '\n\n');
      if (opts.getDonate) res.write('event: dsettings\ndata: ' + JSON.stringify(opts.getDonate()) + '\n\n');
      if (opts.getAvatar3d) res.write('event: av3settings\ndata: ' + JSON.stringify(opts.getAvatar3d()) + '\n\n');
      if (opts.getAvatar) res.write('event: avsettings\ndata: ' + JSON.stringify(opts.getAvatar()) + '\n\n');
      if (opts.getDa) res.write('event: dasettings\ndata: ' + JSON.stringify(opts.getDa()) + '\n\n');
      if (opts.getAlerts) res.write('event: asettings\ndata: ' + JSON.stringify(opts.getAlerts()) + '\n\n');
      if (opts.getLikes) { const l = opts.getLikes(); res.write('event: lsettings\ndata: ' + JSON.stringify(l.settings) + '\n\n'); res.write('event: likes\ndata: ' + JSON.stringify(l.top) + '\n\n'); }
      if (opts.getGifts) { const g = opts.getGifts(); res.write('event: gsettings\ndata: ' + JSON.stringify(g.settings) + '\n\n'); res.write('event: gifts\ndata: ' + JSON.stringify(g.top) + '\n\n'); }
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404); res.end();
  });
  const ping = setInterval(() => clients.forEach((c) => c.write(': ping\n\n')), 20000);
  const broadcast = (event, data) => {
    const s = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
    clients.forEach((c) => c.write(s));
  };
  return new Promise((resolve) => {
    let p = port, tries = 0, ready = false;
    const api = {
      port: 0,
      broadcast(event, data) { if (event === 'pin') lastPin = data || null; if (event === 'msg') { history.push(data); if (history.length > 50) history.shift(); } broadcast(event, data); },
      close() { clearInterval(ping); clients.forEach((c) => { try { c.end(); } catch (_) {} }); server.close(); },
    };
    server.on('error', (e) => {
      if (ready) return;
      if (e.code === 'EADDRINUSE' && tries++ < 20) server.listen(++p, host);
      else resolve({ port: 0, broadcast() {}, close() {} });
    });
    server.on('listening', () => { if (!ready) { ready = true; api.port = p; resolve(api); } });
    server.listen(p, host);
  });
}
module.exports = { start, guidePage, PAGES_URL, DONATE_PAGES_URL, LIKES_PAGES_URL, GIFTS_PAGES_URL, ALERT_PAGES_URL, AVATAR_PAGES_URL, AVATAR3D_PAGES_URL, DA_PAGES_URL, PAGES_ORIGIN };
