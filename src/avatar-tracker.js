'use strict';
// Окно трекера аватара (скрытое окно приложения): камера → MediaPipe → параметры Live2D → приложение.
// Картинка с камеры не сохраняется и не покидает компьютер: наружу уходят только числа параметров.
(() => {
  const host = window.avatarHost, M = window.AvatarMap;
  const video = document.getElementById('v');
  let vision = null, landmarker = null, stream = null, timer = null, gen = 0;
  let opts = { camera: '', mirror: false };
  let smoother = new M.Smoother(), calib = new M.Calibrator(30), neutral = null, lastT = 0, lastVideoT = -1, empty = 0, lostSent = false, fpsN = 0, fpsT = 0;

  const state = (s, extra) => host.state(Object.assign({ state: s }, extra || {}));
  const errText = (e) => {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Нет доступа к камере. Windows: Параметры → Конфиденциальность → Камера → разрешите классическим приложениям.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Камера не найдена. Подключите её или выберите другую.';
    if (n === 'NotReadableError') return 'Камеру занимает другая программа. Закройте её и попробуйте снова.';
    return String((e && e.message) || e);
  };

  async function loadVision() {
    if (landmarker) return;
    vision = vision || await import('/avatar-lib/mediapipe/vision_bundle.mjs');
    const fileset = await vision.FilesetResolver.forVisionTasks('/avatar-lib/mediapipe/wasm');
    const make = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: '/avatar-lib/mediapipe/face_landmarker.task', delegate },
      runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    try { landmarker = await make('GPU'); } catch (_) { landmarker = await make('CPU'); } // без видеокарты или с её сбоем — считаем процессором
  }

  async function cameras(ask) {
    const list = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    let l = await list();
    if (ask && l.length && l.every((d) => !d.label)) {
      try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); l = await list(); } catch (_) {}
    }
    return l.map((d, i) => ({ id: d.deviceId, label: d.label || 'Камера ' + (i + 1) }));
  }

  function stopAll() {
    gen++;
    clearInterval(timer); timer = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    video.srcObject = null;
  }

  async function start(o) {
    stopAll();
    const my = gen;
    opts = Object.assign(opts, o || {});
    smoother.reset(); calib.reset(); neutral = null; empty = 0; lostSent = false; lastVideoT = -1;
    state('starting');
    try {
      await loadVision();
      const v = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
      if (opts.camera) v.deviceId = { exact: opts.camera };
      let s;
      try { s = await navigator.mediaDevices.getUserMedia({ video: v }); }
      catch (e) { if (opts.camera && e && e.name === 'OverconstrainedError') { delete v.deviceId; s = await navigator.mediaDevices.getUserMedia({ video: v }); } else throw e; } // выбранной камеры больше нет — берём любую
      if (my !== gen) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s; video.srcObject = s; await video.play();
      lastT = performance.now(); fpsT = lastT; fpsN = 0;
      timer = setInterval(tick, 1000 / 30);
      state('on', { calibrating: true });
    } catch (e) { stopAll(); state('error', { error: errText(e) }); }
  }

  function tick() {
    if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoT) return;
    lastVideoT = video.currentTime;
    const now = performance.now();
    let res;
    try { res = landmarker.detectForVideo(video, now); } catch (_) { return; }
    const mat = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
    const face = mat && M.faceFromMediaPipe((res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories) || [], Array.from(mat.data));
    if (!face) {
      if (++empty > 20 && !lostSent) { lostSent = true; host.frame({ lost: true }); smoother.reset(); }
      return;
    }
    empty = 0; lostSent = false;
    if (!neutral) { // калибровка: пока человек смотрит прямо в камеру, усредняем углы головы
      calib.add(face);
      if (calib.done) { neutral = calib.result(); state('on', { calibrating: false }); } else if (calib.n === 1) state('on', { calibrating: true });
    }
    const dt = (now - lastT) / 1000; lastT = now;
    const p = smoother.step(M.paramsFromFace(face, neutral || { yaw: face.yaw, pitch: face.pitch, roll: face.roll }, { mirror: !!opts.mirror }), dt);
    host.frame({ p });
    fpsN++;
    if (now - fpsT >= 2000) { host.state({ state: 'on', fps: Math.round(fpsN * 1000 / (now - fpsT)), calibrating: !neutral }); fpsN = 0; fpsT = now; }
  }

  host.onCmd(async (c) => {
    if (!c || typeof c !== 'object') return;
    try {
      if (c.cmd === 'start') await start(c.opts);
      else if (c.cmd === 'stop') { stopAll(); state('off'); }
      else if (c.cmd === 'opts') { opts = Object.assign(opts, c.opts || {}); }
      else if (c.cmd === 'calibrate') { calib.reset(); neutral = null; if (stream) state('on', { calibrating: true }); }
      else if (c.cmd === 'cameras') host.reply(c.id, await cameras(!!c.ask));
    } catch (e) { if (c.id) host.reply(c.id, []); else state('error', { error: errText(e) }); }
  });
  host.ready();
})();
