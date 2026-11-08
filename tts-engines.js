'use strict';
// Движки озвучки кроме Edge: Piper (офлайн, ставится по кнопке) и Google Cloud Text-to-Speech (ключ API пользователя).
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const PIPER_VER = '2023.11.14-2';
const PIPER_ZIP = { win32: 'piper_windows_amd64.zip', darwin: process.arch === 'arm64' ? 'piper_macos_aarch64.tar.gz' : 'piper_macos_x64.tar.gz' };
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU';
const PIPER_VOICES = [
  { id: 'irina', name: 'Ирина', gender: 'Ж', mb: 63 }, { id: 'ruslan', name: 'Руслан', gender: 'М', mb: 63 },
  { id: 'denis', name: 'Денис', gender: 'М', mb: 63 }, { id: 'dmitri', name: 'Дмитрий', gender: 'М', mb: 63 },
];
const GOOGLE_VOICES = [
  { id: 'ru-RU-Wavenet-A', name: 'Алиса', gender: 'Ж' }, { id: 'ru-RU-Wavenet-B', name: 'Борис', gender: 'М' },
  { id: 'ru-RU-Wavenet-C', name: 'Вера', gender: 'Ж' }, { id: 'ru-RU-Wavenet-D', name: 'Дмитрий', gender: 'М' },
];

const root = (userData) => path.join(userData, 'piper');
const exeName = () => (process.platform === 'win32' ? 'piper.exe' : 'piper');
const exePath = (ud) => path.join(root(ud), 'piper', exeName());
const modelPath = (ud, id) => path.join(root(ud), 'voices', `ru_RU-${id}-medium.onnx`);
const has = (f) => { try { return fs.statSync(f).size > 1000; } catch (_) { return false; } };

function status(ud, cfg) {
  return {
    engine: cfg.engine || 'edge',
    piper: { supported: !!PIPER_ZIP[process.platform], binary: has(exePath(ud)), voice: cfg.piperVoice || 'irina', voices: PIPER_VOICES.map((v) => ({ ...v, installed: has(modelPath(ud, v.id)) })) },
    google: { hasKey: !!cfg.googleKey, voice: cfg.googleVoice || 'ru-RU-Wavenet-A', voices: GOOGLE_VOICES },
  };
}

async function download(url, dest, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error('загрузка не удалась: HTTP ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0; let got = 0;
  const src = Readable.fromWeb(res.body);
  src.on('data', (c) => { got += c.length; if (total && onProgress) onProgress(got / total); });
  await pipeline(src, fs.createWriteStream(dest + '.part'));
  fs.renameSync(dest + '.part', dest);
}
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { windowsHide: true }, (e) => (e ? rej(e) : res())));

async function install(ud, voiceId, onProgress) {
  const v = PIPER_VOICES.find((x) => x.id === voiceId); if (!v) throw new Error('неизвестный голос');
  if (!PIPER_ZIP[process.platform]) throw new Error('Piper не поддерживается на этой системе');
  if (!has(exePath(ud))) {
    const arch = path.join(root(ud), PIPER_ZIP[process.platform]);
    await download(`https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/${PIPER_ZIP[process.platform]}`, arch, (p) => onProgress(p * 0.3));
    if (process.platform === 'win32') await run('powershell', ['-NoProfile', '-Command', 'Expand-Archive', '-LiteralPath', arch, '-DestinationPath', root(ud), '-Force']);
    else { await run('tar', ['-xzf', arch, '-C', root(ud)]); fs.chmodSync(exePath(ud), 0o755); }
    fs.rmSync(arch, { force: true });
  }
  if (!has(modelPath(ud, voiceId))) {
    const base = `${HF}/${voiceId}/medium/ru_RU-${voiceId}-medium.onnx`;
    await download(base + '.json', modelPath(ud, voiceId) + '.json');
    await download(base, modelPath(ud, voiceId), (p) => onProgress(0.3 + p * 0.7));
  }
  if (!has(exePath(ud))) throw new Error('после установки piper не найден');
}

// аргументы без shell: текст из чата уходит только в stdin
const piperArgs = (model, wav, rate) => ['--model', model, '--output_file', wav, '--length_scale', String(Math.min(2, Math.max(0.5, 1 / (Number(rate) || 1))).toFixed(2))];
function piperSynth(ud, cfg, text, rate) {
  const id = cfg.piperVoice || 'irina', exe = exePath(ud), model = modelPath(ud, id);
  if (!has(exe) || !has(model)) return Promise.reject(new Error('Piper не установлен'));
  const wav = path.join(require('os').tmpdir(), `echo-piper-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  return new Promise((resolve, reject) => {
    const p = spawn(exe, piperArgs(model, wav, rate), { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { p.kill(); reject(new Error('piper: таймаут')); }, 15000);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', () => { clearTimeout(timer); try { const b = fs.readFileSync(wav); fs.rmSync(wav, { force: true }); b.length ? resolve(b) : reject(new Error('piper: пустой звук')); } catch (e) { reject(e); } });
    p.stdin.end(String(text).replace(/\s+/g, ' ') + '\n');
  });
}

async function googleSynth(cfg, text, rate) {
  if (!cfg.googleKey) throw new Error('не указан ключ Google');
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.googleKey },
    body: JSON.stringify({ input: { text }, voice: { languageCode: 'ru-RU', name: cfg.googleVoice || 'ru-RU-Wavenet-A' }, audioConfig: { audioEncoding: 'MP3', speakingRate: Math.min(2, Math.max(0.5, Number(rate) || 1)) } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.audioContent) throw new Error('Google: ' + ((j.error && j.error.message) || 'HTTP ' + res.status));
  return Buffer.from(j.audioContent, 'base64');
}

module.exports = { status, install, piperSynth, googleSynth, piperArgs, PIPER_VOICES, GOOGLE_VOICES };
