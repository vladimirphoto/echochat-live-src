'use strict';
// Оверлей чата: отдельное окно поверх всех окон (как окно чата в TikTok LIVE Studio) с лентой TikTok + Twitch,
// счётчиками эфира и таймером. Здесь — логика без Electron, чтобы её можно было проверить тестами:
// настройки, положение окна и модель (лента сообщений + счётчики), которую питают те же события, что и главное окно.

// opacity — прозрачность только ФОНА окна (0 — фона нет совсем); рамка, текст и значки всегда видны полностью. Размер окна не масштабируется (всегда 100%).
// locked — окно заблокировано: его нельзя ни сдвинуть, ни растянуть, пока замок не откроют
const DEFAULTS = { opacity: 100, onTop: true, locked: false, events: true, stats: true };
const LIMITS = { opacity: [0, 100] };
const SIZE = { minW: 280, minH: 320, maxW: 1400, maxH: 2400, defW: 400, defH: 560 };

const clampInt = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };

// Настройки из любого входа: неизвестные поля отбрасываются, числа ограничиваются, а то, чего нет, берётся из base
function cleanSettings(o, base = DEFAULTS) {
  o = o && typeof o === 'object' ? o : {};
  const out = { ...DEFAULTS, ...base };
  out.opacity = clampInt(o.opacity !== undefined ? o.opacity : out.opacity, LIMITS.opacity[0], LIMITS.opacity[1], DEFAULTS.opacity);
  for (const k of ['onTop', 'locked', 'events', 'stats']) out[k] = typeof o[k] === 'boolean' ? o[k] : !!out[k];
  return { opacity: out.opacity, onTop: out.onTop, locked: out.locked, events: out.events, stats: out.stats };
}

// Положение окна, которое можно восстановить: размеры в разумных пределах и окно хотя бы частично на каком-то экране
// (если монитор отключили, окно не должно остаться за пределами видимого). Иначе null — окно встанет в угол по умолчанию.
function fitBounds(b, areas) {
  if (!b || typeof b !== 'object') return null;
  const x = Number(b.x), y = Number(b.y), w = Number(b.width), h = Number(b.height);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const width = Math.min(SIZE.maxW, Math.max(SIZE.minW, Math.round(w)));
  const height = Math.min(SIZE.maxH, Math.max(SIZE.minH, Math.round(h)));
  const X = Math.round(x), Y = Math.round(y);
  const vis = (areas || []).some((a) => {
    const ix = Math.min(X + width, a.x + a.width) - Math.max(X, a.x);
    const iy = Math.min(Y + height, a.y + a.height) - Math.max(Y, a.y);
    return ix >= 120 && iy >= 80; // видна заметная часть, за которую можно взяться и перетащить
  });
  return vis ? { x: X, y: Y, width, height } : null;
}

// Угол рабочей области по умолчанию (справа внизу), не больше самой области
function defaultBounds(area) {
  const width = Math.min(SIZE.defW, area.width), height = Math.min(SIZE.defH, Math.max(SIZE.minH, area.height - 48));
  // на очень маленьком экране отступ в 24 px не должен выталкивать окно за край области
  return { width, height, x: Math.max(area.x, area.x + area.width - width - 24), y: Math.max(area.y, area.y + area.height - height - 24) };
}

const cut = (s, n) => String(s == null ? '' : s).slice(0, n);
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Модель: что показывает оверлей. track() получает те же события, что и главное окно (каналы tt:* и tw:*),
// обновляет счётчики так же, как главное окно, и возвращает запись для ленты (если событие её даёт).
class OverlayModel {
  constructor({ max = 80, now = Date.now, color = () => '#6b7280' } = {}) {
    this.max = max; this.now = now; this.color = color;
    this.entries = []; this.seq = 0;
    this.ttOn = false; this.twOn = false; this.since = 0;
    this.resetCounters();
    this.twViewers = null;
  }
  resetCounters() { this.likes = 0; this.gifts = 0; this.follows = 0; this.ttViewers = null; }
  stats() {
    return { ttOn: this.ttOn, twOn: this.twOn, since: this.since, ttViewers: this.ttViewers, twViewers: this.twViewers, likes: this.likes, gifts: this.gifts, follows: this.follows };
  }
  feed() { return this.entries.slice(); }
  clearFeed() { this.entries = []; }
  // таймер идёт с первой подключённой платформы и останавливается, когда не осталось ни одной
  _timer() {
    if (!this.since && (this.ttOn || this.twOn)) this.since = this.now();
    else if (!this.ttOn && !this.twOn) this.since = 0;
  }
  _push(e) {
    e.id = ++this.seq; e.t = this.now();
    this.entries.push(e);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    return e;
  }
  // → { stats: изменились ли счётчики/статус, entry: новая запись ленты или null }
  track(channel, p) {
    p = p && typeof p === 'object' ? p : {};
    const r = { stats: false, entry: null };
    switch (channel) {
      case 'tt:status': {
        const on = p.state === 'live';
        this.ttOn = on;
        if (!on) this.resetCounters(); // эфир закончился или отключили: счётчики с нуля, как в главном окне
        this._timer(); r.stats = true; break;
      }
      case 'tw:status': {
        this.twOn = p.state === 'live' || p.state === 'reconnect';
        if (!this.twOn) this.twViewers = null;
        this._timer(); r.stats = true; break;
      }
      case 'tt:viewers': if (isNum(p.count)) { this.ttViewers = p.count; r.stats = true; } break;
      case 'tw:viewers': { const v = isNum(p.count) ? p.count : null; if (v !== this.twViewers) { this.twViewers = v; r.stats = true; } break; }
      case 'tt:like': {
        // итог от TikTok надёжнее суммы событий; если итога нет (или 0) — копим сами
        this.likes = p.total > 0 ? Math.max(this.likes, p.total) : this.likes + (p.count || 1);
        r.stats = true; break;
      }
      case 'tt:gift': {
        const n = Math.max(1, Math.round(Number(p.count)) || 1);
        this.gifts += n; r.stats = true;
        r.entry = this._push({ platform: 'tiktok', kind: 'gift', name: cut(p.name, 60) || 'Гость', avatar: cut(p.avatar, 500), color: this.color(p.name || ''), gift: { name: cut(p.gift, 60) || 'подарок', count: n, image: cut(p.image, 500) } });
        break;
      }
      case 'tt:follow': {
        this.follows += 1; r.stats = true;
        r.entry = this._push({ platform: 'tiktok', kind: 'follow', name: cut(p.name, 60) || 'Гость', avatar: cut(p.avatar, 500), color: this.color(p.name || '') });
        break;
      }
      case 'tt:chat': case 'tw:chat': {
        const text = cut(p.text, 500);
        if (!text.trim()) break; // пустые сообщения не показываем
        r.entry = this._push({ platform: channel === 'tw:chat' ? 'twitch' : 'tiktok', kind: 'chat', name: cut(p.name, 60) || 'Гость', text, avatar: cut(p.avatar, 500), color: this.color(p.name || '') });
        break;
      }
      default: break;
    }
    return r;
  }
}

// Примеры для кнопки «Тест»: видно и TikTok, и Twitch, подарок и подписку
const SAMPLE = [
  { platform: 'tiktok', kind: 'chat', name: 'Анна', text: 'Привет из TikTok! Так выглядит оверлей чата' },
  { platform: 'twitch', kind: 'chat', name: 'Max', text: 'Привет из Twitch!' },
  { platform: 'tiktok', kind: 'follow', name: 'Игорь' },
  { platform: 'tiktok', kind: 'gift', name: 'Дина', gift: { name: 'Роза', count: 5, image: '' } },
  { platform: 'tiktok', kind: 'chat', name: 'Марат', text: 'Отличный стрим, спасибо!' },
];

module.exports = { DEFAULTS, LIMITS, SIZE, cleanSettings, fitBounds, defaultBounds, OverlayModel, SAMPLE };
