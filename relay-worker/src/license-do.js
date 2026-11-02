// Durable Object «Licenses»: одна глобальная база лицензий (ключи, устройства, установки, ключ подписи).
// Все запросы выполняются по очереди, поэтому гонок при активации ключей не бывает.
import { LicenseService, Signer } from './license-core.js';

const OPS = new Set([
  'status', 'activate', 'deactivate', 'publicKey',
  'createLicense', 'listLicenses', 'extend', 'setRevoked', 'setMaxDevices', 'setNote', 'resetDevices', 'deleteLicense',
]);

export class Licenses {
  constructor(state) {
    this.state = state;
    this.svc = new LicenseService(state.storage, new Signer(state.storage));
  }

  async fetch(request) {
    let body;
    try { body = await request.json(); } catch (_) { return Response.json({ ok: false, error: 'bad_request' }, { status: 400 }); }
    const { op, args } = body || {};
    if (!OPS.has(op) || !Array.isArray(args)) return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
    return this.state.blockConcurrencyWhile(async () => {
      try {
        const res = await this.svc[op](...args);
        return Response.json(res);
      } catch (e) {
        return Response.json({ ok: false, error: 'server_error', message: String((e && e.message) || e) }, { status: 500 });
      }
    });
  }
}
