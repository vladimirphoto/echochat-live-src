'use strict';
// Отпечаток компьютера для учёта пробного периода: SHA-256 от системного идентификатора с солью.
// Сам идентификатор никуда не отправляется, на сервер уходит только хеш.
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

let cache = '';

function rawId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { timeout: 4000, windowsHide: true, encoding: 'utf8' });
      const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{8,})/.exec(out);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 4000, encoding: 'utf8' });
      const m = /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{8,})"/.exec(out);
      if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try { const t = fs.readFileSync(f, 'utf8').trim(); if (t) return t; } catch (_) {}
      }
    }
  } catch (_) {}
  return '';
}

function machineId() {
  if (cache) return cache;
  let id = rawId();
  if (!id) {
    const c = (os.cpus() || [])[0];
    id = [os.hostname(), os.platform(), os.arch(), c && c.model, os.totalmem()].join('|');
  }
  cache = crypto.createHash('sha256').update('echochat-mid-v1|' + String(id).toLowerCase()).digest('hex');
  return cache;
}

module.exports = { machineId };
