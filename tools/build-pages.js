'use strict';
// Собирает страницы для GitHub Pages (папка docs/). Запуск: npm run pages
const fs = require('fs');
const path = require('path');
const PAGE = require('../widget-page');
const DONATE = require('../widget-donate-page');
const LIKES = require('../widget-likes-page');
const GIFTS = require('../widget-gifts-page');
const ALERT = require('../widget-alert-page');

const docs = path.join(__dirname, '..', 'docs');
fs.mkdirSync(path.join(docs, 'chat'), { recursive: true });
fs.writeFileSync(path.join(docs, 'chat', 'index.html'), PAGE);
fs.mkdirSync(path.join(docs, 'donate'), { recursive: true });
fs.writeFileSync(path.join(docs, 'donate', 'index.html'), DONATE);
fs.mkdirSync(path.join(docs, 'likes'), { recursive: true });
fs.writeFileSync(path.join(docs, 'likes', 'index.html'), LIKES);
fs.mkdirSync(path.join(docs, 'gifts'), { recursive: true });
fs.writeFileSync(path.join(docs, 'gifts', 'index.html'), GIFTS);
fs.mkdirSync(path.join(docs, 'alert'), { recursive: true });
fs.writeFileSync(path.join(docs, 'alert', 'index.html'), ALERT);
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
fs.writeFileSync(path.join(docs, 'index.html'), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ЭхоЧат LIVE</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090c12;color:#e8edf5;font:16px/1.5 "Segoe UI",system-ui,sans-serif}main{max-width:520px;padding:24px}h1{margin:0 0 8px}a{color:#7fa8f8}</style></head>
<body><main><h1>ЭхоЧат LIVE</h1><p>Здесь живут страницы виджетов чата и донатов для TikTok LIVE Studio и OBS. Ссылку на виджет показывает само приложение: вкладка «Виджеты» → «Копировать».</p><p><a href="https://github.com/vladimirphoto/jonny-chat-tiktok/releases">Скачать приложение</a></p></main></body></html>`);
console.log('docs/ собрана');
