# -*- coding: utf-8 -*-
"""Озвучка Silero для ЭхоЧата: долгоживущий процесс, общается с приложением строками JSON.

Запрос (stdin):  {"id": 1, "text": "...", "speaker": "aidar", "sr": 48000}
Ответ  (stdout): {"id": 1, "ok": true, "wav": "<base64 WAV>"}  или  {"id": 1, "ok": false, "error": "..."}
Первая строка после загрузки модели: {"ready": true}.
В stdout пишется только протокол; всё остальное (в том числе print из библиотек) уходит в stderr.

Аргументы: путь к файлу модели v5_ru.pt. Переменная ECHO_SILERO_STUB включает режим проверки без PyTorch
(короткий тон вместо речи; значения «hang» и «crash» имитируют зависание и падение) — только для тестов приложения.
"""
import sys
import os
import io
import json
import time
import base64
import wave
import math
import struct

sys.stdin.reconfigure(encoding='utf-8')
_out = sys.stdout
sys.stdout = sys.stderr

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from silero_text import prepare  # noqa: E402

SPEAKERS = ('aidar', 'baya', 'kseniya', 'xenia', 'eugene')
SAMPLE_RATES = (8000, 24000, 48000)
STUB = os.environ.get('ECHO_SILERO_STUB', '')


def send(obj):
    _out.write(json.dumps(obj, ensure_ascii=True) + '\n')
    _out.flush()


def wav_bytes(samples, sr):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(samples)
    return buf.getvalue()


def load_model(path):
    import torch
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 2)))
    model = torch.package.PackageImporter(path).load_pickle('tts_models', 'model')
    model.to('cpu')
    return torch, model


def main():
    torch = model = None
    if not STUB:
        if len(sys.argv) < 2 or not os.path.isfile(sys.argv[1]):
            send({'ready': False, 'error': 'model file not found'})
            return 2
        torch, model = load_model(sys.argv[1])
    send({'ready': True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get('id')
            speaker = req.get('speaker') or 'kseniya'
            sr = int(req.get('sr') or 48000)
            if speaker not in SPEAKERS:
                raise ValueError('unknown speaker')
            if sr not in SAMPLE_RATES:
                raise ValueError('unsupported sample rate')
            text = prepare(req.get('text') or '')
            if not text:
                send({'id': rid, 'ok': False, 'error': 'empty'})
                continue
            if STUB == 'crash':
                os._exit(3)
            if STUB == 'hang':
                time.sleep(3600)
            if STUB:
                n = int(sr * 0.2)
                pcm = struct.pack('<%dh' % n, *[int(8000 * math.sin(2 * math.pi * 440 * i / sr)) for i in range(n)])
            else:
                audio = model.apply_tts(text=text, speaker=speaker, sample_rate=sr, put_accent=True, put_yo=True)
                pcm = _pcm(torch, audio)
            send({'id': rid, 'ok': True, 'wav': base64.b64encode(wav_bytes(pcm, sr)).decode('ascii')})
        except Exception as e:  # один плохой запрос не должен ронять процесс
            send({'id': rid, 'ok': False, 'error': (type(e).__name__ + ': ' + str(e))[:300]})
    return 0


def _pcm(torch, audio):
    """Тензор float [-1, 1] -> байты int16 little-endian без numpy."""
    import array
    a = array.array('h', (audio.detach().clamp(-1, 1) * 32767).to(torch.int16).tolist())
    if sys.byteorder == 'big':
        a.byteswap()
    return a.tobytes()


if __name__ == '__main__':
    sys.exit(main())
