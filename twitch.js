'use strict';
// Чтение чата Twitch без ключей: анонимное IRC-подключение (justinfan) по TLS.
const tls = require('tls');

function parseLine(line) {
  let tags = {}, rest = line;
  if (rest[0] === '@') {
    const i = rest.indexOf(' ');
    rest.slice(1, i).split(';').forEach((p) => { const [k, v] = p.split('='); tags[k] = (v || '').replace(/\\s/g, ' ').replace(/\\:/g, ';'); });
    rest = rest.slice(i + 1);
  }
  const m = rest.match(/^:([^!\s]+)(?:![^\s]+)?\s+(\S+)\s*(\S*)\s*(?::(.*))?$/);
  if (!m) return rest.startsWith('PING') ? { cmd: 'PING', text: rest.slice(5).replace(/^:/, '') } : null;
  return { tags, nick: m[1], cmd: m[2], chan: m[3], text: m[4] || '' };
}

function connect(channel, handlers) {
  channel = String(channel || '').trim().toLowerCase().replace(/^@|^#/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/[/?].*$/, '');
  if (!/^\w{3,25}$/.test(channel)) return { ok: false, error: 'Неверное имя канала Twitch.' };
  let sock = null, closed = false, retry = 0, timer = null, buf = '';
  const open = () => {
    sock = tls.connect(6697, 'irc.chat.twitch.tv', { servername: 'irc.chat.twitch.tv' });
    sock.setEncoding('utf8');
    sock.on('secureConnect', () => {
      sock.write('CAP REQ :twitch.tv/tags twitch.tv/commands\r\nNICK justinfan' + (10000 + Math.floor(Math.random() * 80000)) + '\r\nJOIN #' + channel + '\r\n');
    });
    sock.on('data', (d) => {
      buf += d;
      const lines = buf.split('\r\n'); buf = lines.pop();
      for (const l of lines) {
        const p = parseLine(l); if (!p) continue;
        if (p.cmd === 'PING') sock.write('PONG :' + (p.text || 'tmi.twitch.tv') + '\r\n');
        else if (p.cmd === 'JOIN') { retry = 0; handlers.onStatus && handlers.onStatus('live'); }
        else if (p.cmd === 'PRIVMSG') {
          const t = p.tags, badges = t.badges || '';
          let text = p.text, action = false;
          const a = text.match(/^\u0001ACTION (.*)\u0001$/); if (a) { text = a[1]; action = true; }
          handlers.onChat && handlers.onChat({
            name: t['display-name'] || p.nick, id: p.nick, text, action,
            isSub: /subscriber|founder/.test(badges), isMod: /moderator|broadcaster/.test(badges),
            bits: Number(t.bits) || 0, userId: t['user-id'] || '', created: Number(t['tmi-sent-ts']) || Date.now(),
          });
        }
      }
    });
    const lost = () => {
      if (closed) return;
      handlers.onStatus && handlers.onStatus('reconnect');
      timer = setTimeout(open, Math.min(30000, 2000 * ++retry));
    };
    sock.on('error', () => {}); sock.on('close', lost);
  };
  open();
  return {
    ok: true, channel,
    close() { closed = true; clearTimeout(timer); try { sock && sock.destroy(); } catch (_) {} },
  };
}

// Аватарка Twitch без ключа API: публичный сервис decapi.me отдаёт ссылку текстом
const avatars = new Map(), avatarPending = new Map();
// то, что уже известно, — мгновенно и без сети (пусто, если ещё не загружено)
const cachedAvatar = (login) => avatars.get(String(login || '').toLowerCase()) || '';
function avatarOf(login) {
  login = String(login || '').toLowerCase();
  if (avatars.has(login)) return Promise.resolve(avatars.get(login));
  if (avatarPending.has(login)) return avatarPending.get(login); // один запрос на ник, даже если пишет подряд
  const p = (async () => {
    let url = '';
    try {
      const r = await fetch('https://decapi.me/twitch/avatar/' + encodeURIComponent(login), { signal: AbortSignal.timeout(5000) });
      const t = (await r.text()).trim();
      if (/^https:\/\//.test(t)) url = t;
    } catch (_) {}
    if (avatars.size > 2000) avatars.clear();
    avatars.set(login, url);
    avatarPending.delete(login);
    return url;
  })();
  avatarPending.set(login, p);
  return p;
}

// Сколько зрителей сейчас смотрит канал: публичный GraphQL Twitch (как у веб-версии), без ключей.
// null — стрима нет или узнать не удалось.
async function viewersOf(login, fetchImpl = globalThis.fetch) {
  login = String(login || '').toLowerCase();
  if (!/^\w{3,25}$/.test(login) || typeof fetchImpl !== 'function') return null;
  try {
    const r = await fetchImpl('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query{user(login:"' + login + '"){stream{viewersCount}}}' }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const n = (await r.json())?.data?.user?.stream?.viewersCount;
    return Number.isFinite(n) ? n : null;
  } catch (_) { return null; }
}

module.exports = { connect, avatarOf, cachedAvatar, parseLine, viewersOf };
