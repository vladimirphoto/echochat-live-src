'use strict';
// Лицо → параметры Live2D. Чистая математика без зависимостей: работает и в окне трекера (браузер), и в тестах (Node).
// Идея и формулы углов взяты из VTubeLeaf (MIT, github.com/moonrailgun/vtubeleaf): матрица лица MediaPipe → углы головы, оценки blendshapes → глаза, рот, брови.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AvatarMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DEG = 180 / Math.PI;
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

  // Значения параметров «по умолчанию» (лицо смотрит прямо, глаза открыты, рот закрыт)
  const REST = {
    ParamAngleX: 0, ParamAngleY: 0, ParamAngleZ: 0,
    ParamEyeLOpen: 1, ParamEyeROpen: 1, ParamEyeLSmile: 0, ParamEyeRSmile: 0,
    ParamEyeBallX: 0, ParamEyeBallY: 0,
    ParamBrowLY: 0, ParamBrowRY: 0,
    ParamMouthOpenY: 0, ParamMouthForm: 0,
    ParamBodyAngleX: 0, ParamBodyAngleY: 0, ParamBodyAngleZ: 0,
    // для 3D (VRM): углы головы в градусах без зеркала (зеркало применяет страница 3D), закрытость глаз 0…1, рот, улыбка, взгляд
    V_yaw: 0, V_pitch: 0, V_roll: 0, V_blinkL: 0, V_blinkR: 0, V_aa: 0, V_happy: 0, V_lookX: 0, V_lookY: 0,
  };
  // постоянная сглаживания, секунды: глаза и рот быстрые (морганье не должно запаздывать), голова спокойнее
  const TAU = {
    ParamEyeLOpen: 0.03, ParamEyeROpen: 0.03, ParamMouthOpenY: 0.045, ParamMouthForm: 0.08,
    ParamEyeLSmile: 0.1, ParamEyeRSmile: 0.1, ParamEyeBallX: 0.05, ParamEyeBallY: 0.05,
    ParamBrowLY: 0.1, ParamBrowRY: 0.1,
    ParamAngleX: 0.07, ParamAngleY: 0.07, ParamAngleZ: 0.07,
    ParamBodyAngleX: 0.18, ParamBodyAngleY: 0.18, ParamBodyAngleZ: 0.18,
    V_yaw: 0.06, V_pitch: 0.06, V_roll: 0.06, V_blinkL: 0.03, V_blinkR: 0.03, V_aa: 0.045, V_happy: 0.1, V_lookX: 0.05, V_lookY: 0.05,
  };

  // Блендшейпы + матрица 4×4 (по столбцам, как отдаёт MediaPipe) → лицо. Если данные неполные — null.
  function faceFromMediaPipe(categories, m) {
    if (!m || m.length !== 16) return null;
    for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) return null;
    const b = {};
    for (const c of categories || []) if (c && typeof c.categoryName === 'string') b[c.categoryName] = c.score;
    const s = (name) => clamp(num(b[name]), 0, 1);
    return {
      yaw: Math.asin(clamp(-m[2], -1, 1)) * DEG,
      // у Live2D AngleY положителен, когда смотрят вверх; поворот по X у MediaPipe — наоборот
      pitch: -Math.atan2(m[6], m[10]) * DEG,
      // у камеры +Y смотрит вверх, у Live2D AngleZ положителен при наклоне вправо по экрану
      roll: -Math.atan2(m[1], m[0]) * DEG,
      blinkL: s('eyeBlinkLeft'),
      blinkR: s('eyeBlinkRight'),
      jaw: s('jawOpen'),
      smile: (s('mouthSmileLeft') + s('mouthSmileRight')) / 2,
      frown: (s('mouthFrownLeft') + s('mouthFrownRight')) / 2,
      gazeX: (s('eyeLookOutLeft') - s('eyeLookInLeft') + s('eyeLookInRight') - s('eyeLookOutRight')) / 2,
      gazeY: (s('eyeLookUpLeft') + s('eyeLookUpRight') - s('eyeLookDownLeft') - s('eyeLookDownRight')) / 2,
      browL: clamp(s('browInnerUp') + s('browOuterUpLeft') - s('browDownLeft'), -1, 1),
      browR: clamp(s('browInnerUp') + s('browOuterUpRight') - s('browDownRight'), -1, 1),
    };
  }

  // угол относительно «нейтрального» положения, приведённый к диапазону −180…180
  const rel = (v, n) => ((((num(v) - num(n) + 540) % 360) + 360) % 360) - 180;

  // Лицо → цели параметров Live2D (ещё без сглаживания).
  // neutral — углы головы, когда человек смотрит прямо в камеру ({yaw,pitch,roll}); mirror — зеркальный режим (поворот и наклон меняют знак)
  function paramsFromFace(face, neutral, opts) {
    const n = neutral || {};
    const sign = opts && opts.mirror ? -1 : 1;
    const yaw = rel(face.yaw, n.yaw) * sign;
    const pitch = rel(face.pitch, n.pitch);
    const roll = rel(face.roll, n.roll) * sign;
    // моргание: 0,1 и меньше — глаз открыт, 0,7 и больше — закрыт (оценки у MediaPipe редко доходят до 1)
    const eye = (blink) => clamp(1 - (blink - 0.1) / 0.6, 0, 1);
    const smile = clamp(face.smile * 1.8 - face.frown * 1.2, -1, 1);
    const eyeSmile = clamp((face.smile - 0.4) * 2, 0, 1);
    return {
      ParamAngleX: clamp(yaw, -30, 30),
      ParamAngleY: clamp(pitch, -30, 30),
      ParamAngleZ: clamp(roll, -30, 30),
      ParamBodyAngleX: clamp(yaw * 0.33, -10, 10),
      ParamBodyAngleY: clamp(pitch * 0.33, -10, 10),
      ParamBodyAngleZ: clamp(roll * 0.33, -10, 10),
      ParamEyeLOpen: eye(face.blinkL),
      ParamEyeROpen: eye(face.blinkR),
      ParamEyeLSmile: eyeSmile,
      ParamEyeRSmile: eyeSmile,
      ParamEyeBallX: clamp(face.gazeX * sign, -1, 1),
      ParamEyeBallY: clamp(face.gazeY, -1, 1),
      ParamBrowLY: clamp(face.browL, -1, 1),
      ParamBrowRY: clamp(face.browR, -1, 1),
      ParamMouthOpenY: clamp(face.jaw * 1.5, 0, 1),
      ParamMouthForm: smile,
      V_yaw: clamp(rel(face.yaw, n.yaw), -45, 45),
      V_pitch: clamp(rel(face.pitch, n.pitch), -45, 45),
      V_roll: clamp(rel(face.roll, n.roll), -45, 45),
      V_blinkL: 1 - eye(face.blinkL),
      V_blinkR: 1 - eye(face.blinkR),
      V_aa: clamp(face.jaw * 1.5, 0, 1),
      V_happy: clamp(face.smile * 1.8 - face.frown * 1.2, 0, 1),
      V_lookX: clamp(face.gazeX, -1, 1),
      V_lookY: clamp(face.gazeY, -1, 1),
    };
  }

  // Экспоненциальное сглаживание с учётом реального времени между кадрами
  class Smoother {
    constructor() { this.cur = { ...REST }; }
    reset() { this.cur = { ...REST }; }
    step(target, dt) {
      const d = clamp(num(dt, 0.033), 0.001, 0.1);
      const out = {};
      for (const id of Object.keys(REST)) {
        const goal = Object.prototype.hasOwnProperty.call(target, id) ? target[id] : REST[id];
        const tau = TAU[id] || 0.08;
        const a = 1 - Math.exp(-d / tau);
        const v = this.cur[id] + (goal - this.cur[id]) * a;
        this.cur[id] = v;
        out[id] = Math.round(v * 1000) / 1000; // три знака хватает, а кадры по сети получаются короче
      }
      return out;
    }
  }

  // Калибровка: усредняем углы головы по нескольким кадрам, пока человек смотрит прямо в камеру
  class Calibrator {
    constructor(frames = 30) { this.need = frames; this.reset(); }
    reset() { this.n = 0; this.sum = { yaw: 0, pitch: 0, roll: 0 }; }
    get done() { return this.n >= this.need; }
    add(face) { if (this.done) return; this.n++; this.sum.yaw += face.yaw; this.sum.pitch += face.pitch; this.sum.roll += face.roll; }
    result() { const k = Math.max(1, this.n); return { yaw: this.sum.yaw / k, pitch: this.sum.pitch / k, roll: this.sum.roll / k }; }
  }

  return { faceFromMediaPipe, paramsFromFace, Smoother, Calibrator, REST, clamp };
});
