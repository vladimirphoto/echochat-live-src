// Повторы для скачивания: CDN GitHub временами отвечает 502/503/504 или обрывает соединение,
// и одна такая неудача не должна сразу превращаться в «Не удалось скачать».
// Модуль без зависимостей от Electron, чтобы его можно было проверить обычным тестом.

const DELAYS = [2000, 5000, 10000, 20000]; // паузы перед 2-й, 3-й, 4-й и 5-й попыткой
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ответы, после которых имеет смысл попробовать ещё раз (404, 403 и т.п. повторять бесполезно)
const retryableStatus = (s) => s === 408 || s === 425 || s === 429 || s >= 500;

// attempt(i) выполняет одну попытку целиком. Ошибка с fatal = true прекращает повторы сразу.
// Любая другая ошибка (сетевой сбой, обрыв потока, 5xx) повторяется с паузами из delays.
async function downloadWithRetry(attempt, opts = {}) {
  const delays = opts.delays || DELAYS;
  const wait = opts.sleep || sleep;
  let lastErr;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await attempt(i);
    } catch (e) {
      lastErr = e;
      if (e && e.fatal) throw e;
      if (i < delays.length) {
        if (opts.onRetry) opts.onRetry(i + 1, e);
        await wait(delays[i]);
      }
    }
  }
  throw lastErr;
}

module.exports = { downloadWithRetry, retryableStatus, DELAYS };
