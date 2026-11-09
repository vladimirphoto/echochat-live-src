'use strict';
// Оповещения о подписках: настройки и свои файлы (картинка и звук лежат в папке данных приложения).
// Модуль не зависит от Electron, поэтому его можно проверять обычными тестами.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024; // и картинка, и звук — до 5 МБ
const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const SOUND_EXT = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm' };
const IMAGE_BASE = 'alert-image';
const SOUND_BASE = 'alert-sound';

const DEFAULTS = { enabled: true, sound: true, showAvatar: true, duration: 6, scale: 100, imageName: '', soundName: '' };

const clampN = (v, lo, hi, d) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

// настройки из окна приложения приводим к допустимым значениям
function cleanSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    enabled: s.enabled !== false,
    sound: s.sound !== false,
    showAvatar: s.showAvatar !== false,
    duration: clampN(s.duration, 3, 20, DEFAULTS.duration),
    scale: clampN(s.scale, 50, 200, DEFAULTS.scale),
    imageName: String(s.imageName || '').slice(0, 120),
    soundName: String(s.soundName || '').slice(0, 120),
  };
}

// свой файл: ищем в папке по имени alert-image.<расширение> / alert-sound.<расширение>
function findFile(dir, base, exts) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return null; }
  const re = new RegExp('^' + base + '\\.([a-z0-9]+)$');
  for (const f of names) {
    const m = re.exec(f);
    if (!m || !exts[m[1]]) continue;
    try {
      const st = fs.statSync(path.join(dir, f));
      if (st.isFile()) return { file: path.join(dir, f), name: f, ext: m[1], mime: exts[m[1]], size: st.size, mtime: Math.floor(st.mtimeMs) };
    } catch (_) {}
  }
  return null;
}

function clearFiles(dir, base) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  const re = new RegExp('^' + base + '\\.[a-z0-9]+$');
  names.filter((f) => re.test(f)).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} });
}

// копирует выбранный человеком файл в папку данных; прежний файл удаляется. Ошибка — понятным текстом
function saveFile(dir, base, exts, src, kind) {
  const ext = path.extname(src).slice(1).toLowerCase();
  if (!exts[ext]) return { ok: false, error: 'Нужен файл ' + Object.keys(exts).join(', ') };
  let st;
  try { st = fs.statSync(src); } catch (_) { return { ok: false, error: 'Не удалось открыть файл' }; }
  if (!st.isFile()) return { ok: false, error: 'Не удалось открыть файл' };
  if (st.size > MAX_BYTES) return { ok: false, error: 'Файл больше 5 МБ: возьмите ' + (kind === 'image' ? 'картинку полегче' : 'звук покороче') };
  if (st.size < 1) return { ok: false, error: 'Файл пустой' };
  try { clearFiles(dir, base); fs.copyFileSync(src, path.join(dir, base + '.' + ext)); } catch (e) { return { ok: false, error: 'Не удалось сохранить файл: ' + ((e && e.message) || e) }; }
  return { ok: true, name: path.basename(src) };
}

const findImage = (dir) => findFile(dir, IMAGE_BASE, IMAGE_EXT);
const findSound = (dir) => findFile(dir, SOUND_BASE, SOUND_EXT);

// что получает страница виджета: версия картинки (время файла) говорит странице, когда её надо загрузить заново; 0 — картинки нет
function widgetSettings(s, imageInfo) {
  return {
    duration: s.duration, scale: s.scale, align: 'center', vpos: 'middle',
    showAvatar: s.showAvatar !== false,
    imageV: imageInfo ? Math.max(1, imageInfo.mtime) : 0,
  };
}

module.exports = {
  MAX_BYTES, IMAGE_EXT, SOUND_EXT, IMAGE_BASE, SOUND_BASE, DEFAULTS,
  cleanSettings, findFile, clearFiles, saveFile, findImage, findSound, widgetSettings,
};
