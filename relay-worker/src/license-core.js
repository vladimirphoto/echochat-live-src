// ЭхоЧат LIVE — ядро лицензирования (без привязки к Cloudflare: работает с любым хранилищем get/put/delete/list).
// Сервер выдаёт клиенту подписанный токен (Ed25519). Приватный ключ живёт только здесь, в приложении — публичный.

export const DAY = 86400000;
export const TRIAL_DAYS = 3;
export const DEFAULT_MAX_DEVICES = 2;
// сколько приложение может работать без связи с сервером по уже выданному токену
export const GRACE_MS = { trial: 3 * DAY, lite: 7 * DAY, pro: 7 * DAY, lifetime: 30 * DAY };
// тарифы, которые можно выдавать ключом (для будущих тарифов достаточно добавить сюда)
export const KEY_PLANS = ['pro', 'lifetime'];

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов: 0/O, 1/I
const enc = new TextEncoder();

export const b64u = {
  fromBytes(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  fromString(str) { return b64u.fromBytes(enc.encode(str)); },
};

const fromB64u = (s) => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const pubKeys = new Map();

// Проверка подписанного токена лицензии на стороне сервера (без обращения к базе): подпись, срок и тариф.
// Возвращает данные токена, если он действителен и тариф открывает Pro-разделы (trial, pro, lifetime), иначе null.
export async function verifyLicenseToken(token, pubX, now = Date.now()) {
  try {
    if (!token || !pubX) return null;
    const [body, sig] = String(token).split('.');
    if (!body || !sig || body.length > 2000) return null;
    let key = pubKeys.get(pubX);
    if (!key) {
      key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: pubX }, { name: 'Ed25519' }, false, ['verify']);
      pubKeys.set(pubX, key);
    }
    if (!(await crypto.subtle.verify({ name: 'Ed25519' }, key, fromB64u(sig), enc.encode(body)))) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    if (!p || p.v !== 1 || !(now <= p.exp)) return null;
    if (!['trial', 'pro', 'lifetime'].includes(p.plan)) return null;
    if (p.plan === 'pro' && p.until && now > p.until) return null;
    if (p.plan === 'trial' && p.until && now > p.until) return null;
    return p;
  } catch (_) { return null; }
}

export const validInstallId = (s) => typeof s === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(s);

export function normalizeKey(k) {
  const s = String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = /^ECHO([A-Z0-9]{20})$/.exec(s);
  if (!m) return '';
  return 'ECHO-' + m[1].match(/.{5}/g).join('-');
}

export function generateKey() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('');
  return 'ECHO-' + body.match(/.{5}/g).join('-');
}

export const maskKey = (k) => (k ? k.slice(0, 5) + '•••••-•••••-•••••-' + k.slice(-5) : '');

// ---- подпись токенов ----
export class Signer {
  constructor(storage) { this.storage = storage; this.key = null; this.pub = ''; }

  async init() {
    if (this.key) return this;
    let jwk = await this.storage.get('sig:jwk');
    if (!jwk) {
      const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
      jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
      await this.storage.put('sig:jwk', jwk);
    }
    this.pub = jwk.x;
    this.key = await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['sign']);
    return this;
  }

  async sign(payload) {
    await this.init();
    const body = b64u.fromString(JSON.stringify(payload));
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', this.key, enc.encode(body)));
    return body + '.' + b64u.fromBytes(sig);
  }
}

const fail = (error, message) => ({ ok: false, error, message });
const validMachineId = (m) => typeof m === 'string' && /^[a-f0-9]{64}$/.test(m);

export class LicenseService {
  constructor(storage, signer, now = () => Date.now()) {
    this.s = storage;
    this.signer = signer;
    this.now = now;
  }

  // ---------- клиентские операции ----------
  async #install(iid, mid) {
    const now = this.now();
    let inst = await this.s.get('inst:' + iid);
    if (!inst) {
      inst = { id: iid, createdAt: now, trialStart: now, lastSeen: now };
    } else {
      inst.lastSeen = now;
    }
    // пробный период привязан и к компьютеру: переустановка с новым ID его не продлевает
    if (validMachineId(mid)) {
      const m = await this.s.get('mach:' + mid);
      if (m) {
        if (m.trialStart < inst.trialStart) inst.trialStart = m.trialStart;
      } else {
        await this.s.put('mach:' + mid, { trialStart: inst.trialStart, firstIid: iid, createdAt: now });
      }
      inst.mid = mid;
    }
    await this.s.put('inst:' + iid, inst);
    return inst;
  }

  // какой тариф действует для установки прямо сейчас
  async #resolve(inst) {
    const now = this.now();
    const out = { plan: 'lite', until: null, reason: '', key: '', devices: 0, maxDevices: 0 };
    const trialEnd = inst.trialStart + TRIAL_DAYS * DAY;
    out.trialEnd = trialEnd;

    const bound = await this.s.get('bind:' + inst.id);
    if (bound) {
      const lic = await this.s.get('lic:' + bound);
      const dev = lic ? await this.s.get(`dev:${bound}:${inst.id}`) : null;
      if (!lic || !dev) {
        await this.s.delete('bind:' + inst.id);
      } else if (lic.revoked) {
        out.reason = 'revoked';
      } else if (lic.plan !== 'lifetime' && lic.expiresAt && now > lic.expiresAt) {
        out.reason = 'sub-expired';
      } else {
        out.plan = lic.plan;
        out.until = lic.plan === 'lifetime' ? null : lic.expiresAt;
        out.key = maskKey(bound);
        out.maxDevices = lic.maxDevices;
        out.devices = (await this.s.list({ prefix: `dev:${bound}:` })).size;
        return out;
      }
    }
    if (now < trialEnd) { out.plan = 'trial'; out.until = trialEnd; out.reason = out.reason || ''; return out; }
    out.reason = out.reason || 'trial-ended';
    return out;
  }

  async #token(inst) {
    const r = await this.#resolve(inst);
    const now = this.now();
    const grace = GRACE_MS[r.plan] || GRACE_MS.lite;
    let exp = now + grace;
    if (r.plan === 'trial') exp = Math.min(exp, r.until);
    const payload = { v: 1, iid: inst.id, plan: r.plan, until: r.until, trialEnd: r.trialEnd, reason: r.reason, key: r.key, devices: r.devices, maxDevices: r.maxDevices, iat: now, exp };
    return { ok: true, token: await this.signer.sign(payload), state: payload };
  }

  async status(installId, mid) {
    if (!validInstallId(installId)) return fail('bad_request', 'Неверный ID установки');
    return this.#token(await this.#install(installId, mid));
  }

  async #checkFails(iid, ip) {
    const now = this.now();
    for (const k of ['fail:' + iid, ip ? 'failip:' + ip : '']) {
      if (!k) continue;
      const f = await this.s.get(k);
      if (f && now - f.t < 3600000 && f.n >= 10) return true;
    }
    return false;
  }

  async #addFail(iid, ip) {
    const now = this.now();
    for (const k of ['fail:' + iid, ip ? 'failip:' + ip : '']) {
      if (!k) continue;
      let f = await this.s.get(k);
      if (!f || now - f.t >= 3600000) f = { n: 0, t: now };
      f.n += 1;
      await this.s.put(k, f);
    }
  }

  async activate(installId, rawKey, ip = '') {
    if (!validInstallId(installId)) return fail('bad_request', 'Неверный ID установки');
    if (await this.#checkFails(installId, ip)) return fail('rate_limited', 'Слишком много неверных попыток. Попробуйте через час');
    const key = normalizeKey(rawKey);
    const lic = key ? await this.s.get('lic:' + key) : null;
    if (!lic) { await this.#addFail(installId, ip); return fail('key_not_found', 'Ключ не найден. Проверьте, что он введён без ошибок'); }
    if (lic.revoked) return fail('key_revoked', 'Этот ключ отозван. Напишите автору');
    const now = this.now();
    if (lic.plan !== 'lifetime' && lic.expiresAt && now > lic.expiresAt) return fail('key_expired', 'Срок действия этого ключа закончился');

    const inst = await this.#install(installId);
    const devKey = `dev:${key}:${installId}`;
    const already = await this.s.get(devKey);
    if (!already) {
      const count = (await this.s.list({ prefix: `dev:${key}:` })).size;
      if (count >= lic.maxDevices) return fail('device_limit', `Ключ уже активирован на ${count} устр. из ${lic.maxDevices}. Освободите одно из устройств в приложении или попросите автора сбросить`);
    }
    // установка может быть привязана к другому ключу — отвязываем
    const prev = await this.s.get('bind:' + installId);
    if (prev && prev !== key) await this.s.delete(`dev:${prev}:${installId}`);

    if (!lic.activatedAt) {
      lic.activatedAt = now;
      if (lic.plan !== 'lifetime' && lic.days) lic.expiresAt = now + lic.days * DAY;
      await this.s.put('lic:' + key, lic);
    }
    if (!already) await this.s.put(devKey, { iid: installId, at: now });
    await this.s.put('bind:' + installId, key);
    return this.#token(inst);
  }

  async deactivate(installId) {
    if (!validInstallId(installId)) return fail('bad_request', 'Неверный ID установки');
    const inst = await this.#install(installId);
    const key = await this.s.get('bind:' + installId);
    if (key) {
      await this.s.delete(`dev:${key}:${installId}`);
      await this.s.delete('bind:' + installId);
    }
    return this.#token(inst);
  }

  // ---------- администратор ----------
  async createLicense({ plan = 'pro', days = 30, maxDevices = DEFAULT_MAX_DEVICES, note = '' } = {}) {
    if (!KEY_PLANS.includes(plan)) return fail('bad_plan', 'Неизвестный тариф');
    const d = Math.round(Number(days));
    if (plan !== 'lifetime' && !(d >= 1 && d <= 3650)) return fail('bad_days', 'Срок: от 1 до 3650 дней');
    const md = Math.round(Number(maxDevices));
    if (!(md >= 1 && md <= 50)) return fail('bad_devices', 'Устройств: от 1 до 50');
    let key = generateKey();
    while (await this.s.get('lic:' + key)) key = generateKey();
    const lic = { key, plan, days: plan === 'lifetime' ? null : d, maxDevices: md, note: String(note || '').slice(0, 200), createdAt: this.now(), activatedAt: null, expiresAt: null, revoked: false };
    await this.s.put('lic:' + key, lic);
    return { ok: true, license: lic };
  }

  async listLicenses() {
    const all = await this.s.list({ prefix: 'lic:' });
    const out = [];
    for (const lic of all.values()) {
      const devs = await this.s.list({ prefix: `dev:${lic.key}:` });
      out.push({ ...lic, devices: [...devs.values()].map((d) => ({ iid: d.iid, at: d.at })) });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true, licenses: out, installs: (await this.s.list({ prefix: 'inst:' })).size, publicKey: (await this.signer.init()).pub };
  }

  async #get(key) {
    const k = normalizeKey(key);
    const lic = k ? await this.s.get('lic:' + k) : null;
    return { k, lic };
  }

  async extend(key, days) {
    const { k, lic } = await this.#get(key);
    if (!lic) return fail('key_not_found', 'Ключ не найден');
    if (lic.plan === 'lifetime') return fail('bad_plan', 'Lifetime не нужно продлевать');
    const d = Math.round(Number(days));
    if (!(d >= 1 && d <= 3650)) return fail('bad_days', 'Срок: от 1 до 3650 дней');
    const now = this.now();
    if (lic.expiresAt) lic.expiresAt = Math.max(lic.expiresAt, now) + d * DAY; // продлеваем от конца срока, а если он прошёл — от сегодняшнего дня
    else lic.days = (lic.days || 0) + d;
    await this.s.put('lic:' + k, lic);
    return { ok: true, license: lic };
  }

  async setRevoked(key, revoked) {
    const { k, lic } = await this.#get(key);
    if (!lic) return fail('key_not_found', 'Ключ не найден');
    lic.revoked = !!revoked;
    await this.s.put('lic:' + k, lic);
    return { ok: true, license: lic };
  }

  async setMaxDevices(key, n) {
    const { k, lic } = await this.#get(key);
    if (!lic) return fail('key_not_found', 'Ключ не найден');
    const md = Math.round(Number(n));
    if (!(md >= 1 && md <= 50)) return fail('bad_devices', 'Устройств: от 1 до 50');
    lic.maxDevices = md;
    await this.s.put('lic:' + k, lic);
    return { ok: true, license: lic };
  }

  async setNote(key, note) {
    const { k, lic } = await this.#get(key);
    if (!lic) return fail('key_not_found', 'Ключ не найден');
    lic.note = String(note || '').slice(0, 200);
    await this.s.put('lic:' + k, lic);
    return { ok: true, license: lic };
  }

  async resetDevices(key) {
    const { k, lic } = await this.#get(key);
    if (!lic) return fail('key_not_found', 'Ключ не найден');
    const devs = await this.s.list({ prefix: `dev:${k}:` });
    for (const [dk, d] of devs) {
      await this.s.delete(dk);
      if ((await this.s.get('bind:' + d.iid)) === k) await this.s.delete('bind:' + d.iid);
    }
    return { ok: true };
  }

  async deleteLicense(key) {
    const { k, lic } = await this.#get(key);
    if (!lic) return fail('key_not_found', 'Ключ не найден');
    await this.resetDevices(k);
    await this.s.delete('lic:' + k);
    return { ok: true };
  }

  async publicKey() { return { ok: true, pub: (await this.signer.init()).pub }; }
}
