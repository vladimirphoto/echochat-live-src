'use strict';
// macOS на Apple Silicon не запускает неподписанные приложения («повреждён»). Без сертификата Apple
// подписываем приложение «ad-hoc» после упаковки — тогда оно запускается. Gatekeeper всё равно блокирует скачанное приложение:
// на macOS 15+ нужно «Системные настройки → Конфиденциальность и безопасность → Всё равно открыть» (или xattr -cr).
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
