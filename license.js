'use strict';
// Лицензирование ЭхоЧат LIVE: отдельный модуль без Electron и без платёжной логики.
// Сервер выдаёт токен, подписанный Ed25519 (relay-worker/src/license-core.js); здесь токен проверяется публичным ключом,
// кэшируется и пересчитывается во времени, поэтому приложение работает и без интернета (в пределах льготного срока токена).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAY = 86400000;
const TRIAL_DAYS = 3;
const REFRESH_MS = 6 * 3600 * 1000;      // плановая проверка
const RETRY_MS = 90 * 1000;              // повтор, пока сервер недоступен
const CLOCK_SLACK = 10 * 60 * 1000;      // допуск на расхождение часов

// Тарифы. Чтобы добавить новый, достаточно записи здесь (и выдачи ключа на сервере): locked — вкладки, закрытые этим тарифом.
const PLANS = {
  lite: { title: 'Lite', locked: ['widgets', 'kaspi'] },
  trial: { title: 'Пробный период', locked: [] },
  pro: { title: 'Pro', locked: [] },
  lifetime: { title: 'Lifetime', locked: [] },
};
const PAID = new Set(['pro', 'lifetime']);

const b64uToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// проверка подписи токена публичным ключом; возвращает данные токена или null
function verifyToken(token, pubX) {
  try {
    if (!token || !pubX) return null;
    const [body, sig] = String(token).split('.');
    if (!body || !sig) return null;
    const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pubX }, format: 'jwk' });
    if (!crypto.verify(null, Buffer.from(body), key, b64uToBuf(sig))) return null;
    const p = JSON.parse(b64uToBuf(body).toString('utf8'));
    return p && p.v === 1 ? p : null;
  } catch (_) { return null; }
}

const daysLeft = (until, now) => (until ? Math.max(0, Math.ceil((until - now) / DAY)) : null);

// чистая функция: по сохранённому токену и времени получить действующий тариф (тестируется отдельно от файлов и сети)
function evaluate(tok, now, local) {
  const out = { plan: 'lite', until: null, reason: '', keyMasked: '', devices: 0, maxDevices: 0, graceUntil: null, localTrial: false };
  if (!tok) {
    const end = local.trialStart + TRIAL_DAYS * DAY;
    if (now <= end) return { ...out, plan: 'trial', until: end, localTrial: true };
    return { ...out, reason: 'trial-ended' };
  }
  out.keyMasked = tok.key || '';
  out.devices = tok.devices || 0;
  out.maxDevices = tok.maxDevices || 0;
  out.graceUntil = tok.exp;
  const fresh = now <= tok.exp; // токен ещё в пределах льготного срока без связи
  if (PAID.has(tok.plan)) {
    if (!fresh) return { ...out, reason: 'offline-expired', trialEnd: tok.trialEnd };
    if (tok.plan === 'pro' && tok.until && now > tok.until) {
      if (tok.trialEnd && now <= tok.trialEnd) return { ...out, plan: 'trial', until: tok.trialEnd, reason: 'sub-expired' };
      return { ...out, reason: 'sub-expired', trialEnd: tok.trialEnd };
    }
    return { ...out, plan: tok.plan, until: tok.plan === 'pro' ? tok.until : null, trialEnd: tok.trialEnd };
  }
  if (tok.plan === 'trial') {
    if (now <= tok.until) return { ...out, plan: 'trial', until: tok.until, trialEnd: tok.trialEnd };
    return { ...out, reason: 'trial-ended', trialEnd: tok.trialEnd };
  }
  return { ...out, reason: tok.reason || '', trialEnd: tok.trialEnd };
}

class LicenseManager {
  // dir — папка для license.json; getServer() — адрес сервера (строка или промис); pub — закреплённый публичный ключ (может быть пустым)
  constructor({ dir, getServer, pub = '', fetchImpl, now, onChange, timeoutMs = 8000, machine }) {
    this.machine = machine || (() => { try { return require('./machine').machineId(); } catch (_) { return ''; } });
    this.file = path.join(dir, 'license.json');
    this.getServer = getServer;
    this.pinned = String(pub || '').trim();
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.clock = now || (() => Date.now());
    this.onChange = onChange || (() => {});
    this.timeoutMs = timeoutMs;
    this.timer = null;
    this.serverOk = null;
    this.lastError = '';
    this.lastCheck = 0;
    this.lastSig = '';
    this.data = this.#load();
  }

  // ---- хранение: license.json отдельно от настроек, запись через временный файл, копия .bak на случай порчи ----
  #read(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
  #load() {
    let d = this.#read(this.file) || this.#read(this.file + '.bak') || {};
    if (typeof d !== 'object' || Array.isArray(d)) d = {};
    let dirty = false;
    if (!/^[A-Za-z0-9-]{16,64}$/.test(d.installId || '')) { d.installId = crypto.randomUUID(); dirty = true; }
    if (!Number.isFinite(d.localTrialStart)) { d.localTrialStart = this.clock(); dirty = true; }
    if (!Number.isFinite(d.maxSeen)) { d.maxSeen = 0; dirty = true; }
    this.data = d;
    if (dirty) this.#save();
    return d;
  }
  #save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      if (fs.existsSync(this.file)) { try { fs.copyFileSync(this.file, this.file + '.bak'); } catch (_) {} }
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (_) {}
  }

  get installId() { return this.data.installId; }
  // подписанный токен для сервера донатов (только действующий и выданный именно этой установке)
  rawToken() { return this.#token() ? String(this.data.token) : ''; }
  get pub() { return this.pinned || this.data.pub || ''; }

  // «доверенное» время: часы, отмотанные назад, не продлевают лицензию
  #now() {
    const real = this.clock();
    const tok = this.#token();
    const t = Math.max(real, this.data.maxSeen || 0, tok ? tok.iat || 0 : 0);
    if (t > (this.data.maxSeen || 0) + 5 * 60 * 1000) { this.data.maxSeen = t; this.#save(); }
    return { t, clockBack: real + CLOCK_SLACK < Math.max(this.data.maxSeen || 0, tok ? tok.iat || 0 : 0) };
  }
  #token() {
    const p = verifyToken(this.data.token, this.pub);
    return p && p.iid === this.data.installId ? p : null;
  }

  // состояние для интерфейса
  state() {
    const { t: now, clockBack } = this.#now();
    const tok = this.#token();
    const ev = evaluate(tok, now, { trialStart: this.data.localTrialStart });
    const plan = PLANS[ev.plan] ? ev.plan : 'lite';
    return {
      plan,
      title: PLANS[plan].title,
      paid: PAID.has(plan),
      until: ev.until,
      daysLeft: daysLeft(ev.until, now),
      reason: ev.reason,
      keyMasked: ev.keyMasked,
      devices: ev.devices,
      maxDevices: ev.maxDevices,
      locked: PLANS[plan].locked.slice(),
      offline: this.serverOk === false,
      graceUntil: ev.graceUntil,
      localTrial: ev.localTrial,
      clockBack,
      lastError: this.lastError,
      lastCheck: this.lastCheck,
      installShort: this.data.installId.slice(0, 8).toUpperCase(),
      hasPub: !!this.pub,
    };
  }
  isLocked(tab) { return this.state().locked.includes(tab); }

  #emit(meta) {
    const st = this.state();
    const sig = JSON.stringify([st.plan, st.until, st.reason, st.keyMasked, st.devices, st.maxDevices, st.offline, st.lastError]);
    if (sig !== this.lastSig || (meta && meta.force)) { this.lastSig = sig; try { this.onChange(st, meta || {}); } catch (_) {} }
    return st;
  }

  // ---- сеть ----
  async #post(route, body) {
    const base = String((await this.getServer()) || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('адрес сервера не задан');
    const r = await this.fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs), cache: 'no-store' });
    if (!r.ok && r.status >= 500) throw new Error('сервер ответил ' + r.status);
    let j;
    try { j = await r.json(); } catch (_) { throw new Error('неверный ответ сервера'); }
    return j;
  }

  async #ensurePub() {
    if (this.pub) return true;
    const base = String((await this.getServer()) || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return false;
    try {
      const r = await this.fetch(base + '/lic/pubkey', { signal: AbortSignal.timeout(this.timeoutMs), cache: 'no-store' });
      const j = await r.json();
      if (j && j.ok && /^[A-Za-z0-9_-]{40,50}$/.test(j.pub || '')) { this.data.pub = j.pub; this.#save(); return true; } // первое знакомство: запоминаем ключ
    } catch (_) {}
    return false;
  }

  #accept(j) {
    if (!j || !j.ok || !j.token) return false;
    const p = verifyToken(j.token, this.pub);
    if (!p || p.iid !== this.data.installId) return false;
    this.data.token = j.token;
    this.data.maxSeen = Math.max(this.data.maxSeen || 0, p.iat || 0);
    this.#save();
    return true;
  }

  // проверка статуса на сервере; при недоступности остаётся кэш
  async refresh() {
    this.lastCheck = this.clock();
    try {
      if (!(await this.#ensurePub())) throw new Error('нет связи с сервером лицензий');
      const j = await this.#post('/lic/status', { installId: this.data.installId, mid: this.machine() });
      if (!this.#accept(j)) throw new Error('сервер вернул неверную подпись');
      this.serverOk = true; this.lastError = '';
    } catch (e) {
      this.serverOk = false; this.lastError = String((e && e.message) || e);
    }
    this.#schedule();
    return this.#emit();
  }

  async activate(key) {
    const k = String(key || '').trim();
    if (!k) return { ok: false, error: 'empty', message: 'Введите ключ' };
    try {
      if (!(await this.#ensurePub())) return { ok: false, error: 'offline', message: 'Нет связи с сервером лицензий. Проверьте интернет и повторите' };
      const j = await this.#post('/lic/activate', { installId: this.data.installId, key: k });
      if (!j.ok) return { ok: false, error: j.error || 'error', message: j.message || 'Не удалось активировать ключ' };
      if (!this.#accept(j)) return { ok: false, error: 'signature', message: 'Сервер вернул неверную подпись' };
      this.serverOk = true; this.lastError = '';
      return { ok: true, state: this.#emit({ force: true, activated: true }) };
    } catch (e) {
      this.serverOk = false;
      return { ok: false, error: 'offline', message: 'Нет связи с сервером лицензий. Проверьте интернет и повторите' };
    }
  }

  // «Освободить устройство»: ключ отвязывается от этого компьютера, его можно ввести на другом
  async deactivate() {
    try {
      if (!(await this.#ensurePub())) return { ok: false, error: 'offline', message: 'Нет связи с сервером лицензий. Освободить устройство можно только онлайн' };
      const j = await this.#post('/lic/deactivate', { installId: this.data.installId });
      if (!this.#accept(j)) return { ok: false, error: 'signature', message: 'Сервер вернул неверную подпись' };
      this.serverOk = true; this.lastError = '';
      return { ok: true, state: this.#emit({ force: true }) };
    } catch (e) {
      this.serverOk = false;
      return { ok: false, error: 'offline', message: 'Нет связи с сервером лицензий. Освободить устройство можно только онлайн' };
    }
  }

  #schedule() {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.refresh(); }, this.serverOk === false ? RETRY_MS : REFRESH_MS);
    if (this.timer.unref) this.timer.unref();
  }
  start() { this.stopped = false; setTimeout(() => this.refresh(), 300).unref?.(); return this.#emit({ force: true }); }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
}

module.exports = { LicenseManager, verifyToken, evaluate, PLANS, TRIAL_DAYS, DAY };
