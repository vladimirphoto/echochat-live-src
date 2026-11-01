const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'vladimirphoto/jonny-chat-tiktok';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGE = `https://github.com/${REPO}/releases/latest`;

const parse = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
function isNewer(remote, local) {
  const a = parse(remote), b = parse(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

let found = null;

// установленная версия (из setup-файла): подменять нечего, обновляемся запуском нового установщика
const isInstalled = () => process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE;
const isSetupName = (name) => /setup/i.test(String(name || ''));
// нужный файл релиза: установленной версии — установщик (без него обновления нет), portable — обычный exe (а если его нет, любой exe)
function pickAsset(assets, installed) {
  const exes = (assets || []).filter((a) => a && /\.exe$/i.test(a.name));
  return exes.find((a) => isSetupName(a.name) === !!installed) || (installed ? null : exes[0]) || null;
}

// самый свежий не черновой и не пред-релиз со скачиваемым EXE (последний релиз мог выйти без EXE)
function pickRelease(list, installed) {
  let best = null;
  for (const rel of list || []) {
    if (!rel || rel.draft || rel.prerelease) continue;
    const asset = pickAsset(rel.assets, installed);
    if (!asset) continue;
    const version = String(rel.tag_name || '').replace(/^v/i, '');
    if (!best || isNewer(version, best.version)) best = { version, asset, notes: rel.body || '' };
  }
  return best;
}

// запасной путь, когда API GitHub отвечает 403/429 (лимит 60 запросов в час на IP без токена): обычные страницы сайта.
// Лента релизов (atom) даёт теги, страница expanded_assets — ссылку на exe
async function pickViaWeb(installed) {
  const H = { 'User-Agent': 'EchoChat-LIVE' };
  const feed = await fetch(`https://github.com/${REPO}/releases.atom`, { headers: H });
  if (!feed.ok) throw new Error('GitHub ответил ' + feed.status);
  const xml = await feed.text();
  const tags = [...xml.matchAll(/<link[^>]+href="https:\/\/github\.com\/[^"]+\/releases\/tag\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  let best = null;
  for (const tag of tags.slice(0, 8)) {
    const version = tag.replace(/^v/i, '');
    if (best && !isNewer(version, best.version)) continue;
    const r = await fetch(`https://github.com/${REPO}/releases/expanded_assets/${encodeURIComponent(tag)}`, { headers: H });
    if (!r.ok) continue;
    const links = [...(await r.text()).matchAll(/href="(\/[^"]+\/releases\/download\/[^"]+?\.exe)"/gi)].map((m) => ({ name: decodeURIComponent(m[1].split('/').pop()), href: m[1] }));
    const a = pickAsset(links, installed);
    if (a) best = { version, asset: { browser_download_url: 'https://github.com' + a.href.replace(/&amp;/g, '&'), size: 0 }, notes: '' };
  }
  return best;
}

async function check() {
  if (/paidtest/.test(app.getVersion())) return { ok: true, available: false, current: app.getVersion() }; // тестовая платная сборка не обновляется из основной ветки
  let best;
  const installed = isInstalled();
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=15`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EchoChat-LIVE' },
  }).catch(() => null);
  if (res && res.status === 404) return { ok: true, available: false, current: app.getVersion() };
  if (res && res.ok) best = pickRelease(await res.json(), installed);
  else {
    try { best = await pickViaWeb(installed); }
    catch (e) { throw new Error(res ? 'GitHub ответил ' + res.status + (res.status === 403 || res.status === 429 ? ' (лимит запросов, попробуй позже)' : '') : String((e && e.message) || e)); }
  }
  if (!best) return { ok: true, available: false, current: app.getVersion() };
  const available = isNewer(best.version, app.getVersion());
  found = available ? { version: best.version, url: best.asset.browser_download_url, size: best.asset.size } : null;
  return { ok: true, available, current: app.getVersion(), version: best.version, notes: best.notes, portable: !!process.env.PORTABLE_EXECUTABLE_FILE, installed };
}

async function install(onProgress) {
  if (!found) throw new Error('Сначала проверь обновления');
  const target = process.env.PORTABLE_EXECUTABLE_FILE;
  const installed = isInstalled();
  if (!target && !installed) {
    // запуск не из portable exe и не из установки (например npm start) — просто открываем страницу релиза
    shell.openExternal(PAGE);
    return { ok: true, manual: true };
  }

  const tmp = installed
    ? path.join(os.tmpdir(), `EchoChat-LIVE-Setup-${found.version}.exe`)
    : path.join(os.tmpdir(), `EchoChat-LIVE-${found.version}.exe.download`);
  const res = await fetch(found.url, { headers: { 'User-Agent': 'EchoChat-LIVE' } });
  if (!res.ok || !res.body) throw new Error('Не удалось скачать: ' + res.status);
  const total = Number(res.headers.get('content-length')) || found.size || 0;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (total) onProgress(Math.round((got / total) * 100));
  }
  await new Promise((r, j) => { out.end(r); out.on('error', j); });
  if (total && got < total) throw new Error('Загрузка прервана');

  if (installed) {
    // тихая установка поверх: установщик сам закроет старую версию, обновит файлы и запустит приложение
    spawn(tmp, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  }

  // bat ждёт закрытия приложения, подменяет exe и запускает новую версию
  const bat = path.join(os.tmpdir(), 'echochat-update.bat');
  fs.writeFileSync(bat, [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'set /a n=0',
    'timeout /t 2 /nobreak >nul',
    ':retry',
    `move /y "${tmp}" "${target}" >nul 2>&1`,
    'if errorlevel 1 (',
    '  set /a n+=1',
    '  if %n% GEQ 40 exit /b 1',
    '  timeout /t 1 /nobreak >nul',
    '  goto retry',
    ')',
    `start "" "${target}"`,
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n'));
  spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  setTimeout(() => app.quit(), 400);
  return { ok: true };
}

module.exports = { check, install, pickRelease, isNewer };
