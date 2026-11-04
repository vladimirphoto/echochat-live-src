'use strict';
// Печатает результат автотеста собранного приложения (selftest.json) и ошибки как аннотации GitHub Actions.
const fs = require('fs');
const f = process.argv[2];
let r;
try { r = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log('::error title=SELFTEST::result unreadable: ' + e.message); process.exit(1); }
console.log('=== SELFTEST v' + r.version + ' electron ' + r.electron + ' ===');
for (const t of r.results || []) {
  console.log((t.ok ? '[PASS] ' : '[FAIL] ') + '[' + t.group + '] ' + t.name + ' :: ' + t.detail);
  if (!t.ok) console.log('::error title=SELFTEST FAIL [' + t.group + ']::' + (t.name + ' :: ' + t.detail).replace(/\r|\n/g, ' '));
}
console.log('critical failed: ' + r.criticalFailed);
process.exit(r.criticalFailed > 0 ? 1 : 0);
