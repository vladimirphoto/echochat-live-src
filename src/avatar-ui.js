'use strict';
// Вкладка «Аватар»: переключатель 2D (Live2D) / 3D (VRM). У каждого движка свои компоненты, модели, настройки, предпросмотр и ссылка.
// Камера и калибровка общие (камера одна). Всё хранится в приложении (avatar.json), не в браузере.
(() => {
  const $ = (s) => document.querySelector(s);
  const api = window.echo;
  let ST = null, cams = [], installing = '';
  const mb = (n) => Math.round(n / 1048576);

  // Описание движков: чем отличаются панели (префикс id, где лежат статус, модели и настройки)
  const E = {
    '2d': { P: 'av', engine: '2d', status: (s) => s.status, models: (s) => s.models, cfg: (s) => s.settings, patch: (p) => p },
    '3d': { P: 'av3', engine: '3d', status: (s) => s.status3, models: (s) => s.models3, cfg: (s) => s.settings.v3, patch: (p) => ({ v3: p }) },
  };
  const panes = {};

  function runText(P) {
    const r = (ST && ST.run) || { state: 'off' };
    const b = $('#' + P + 'Run'), t = $('#' + P + 'RunTxt');
    b.textContent = r.state === 'off' || r.state === 'error' ? 'Включить камеру' : (r.state === 'starting' ? 'Запуск…' : 'Выключить камеру');
    b.disabled = r.state === 'starting';
    $('#' + P + 'Calib').disabled = r.state !== 'on';
    t.className = 'wstat' + (r.state === 'error' ? ' bad' : (r.state === 'on' ? ' ok' : ''));
    t.textContent = r.state === 'error' ? r.error : r.state === 'starting' ? 'Запускаю камеру и поиск лица…' : r.state === 'on' ? (r.calibrating ? 'Смотрите прямо в камеру: идёт калибровка…' : 'Камера работает' + (r.fps ? ' · ' + r.fps + ' кадр/с' : '')) : '';
  }
  const setErr = (P, t) => { const e = $('#' + P + 'SetupErr'); e.hidden = !t; e.textContent = t || ''; };
  const errLine = (el, t) => { el.className = 'wstat' + (t ? ' bad' : ''); el.textContent = t || ''; };

  function makePane(def) {
    const P = def.P;
    const camOpts = () => [{ v: '', label: cams.length ? 'Камера по умолчанию' : 'Нажмите «Обновить камеры»' }, ...cams.map((c) => ({ v: c.id, label: c.label }))];
    const modelOpts = () => (ST ? def.models(ST) : []).map((m) => ({ v: m.id, label: m.name + (m.builtin ? ' (образец)' : '') }));
    const camSel = makeSelect(P + 'CamSel', { options: camOpts, get: () => (ST ? ST.settings.camera : ''), set: (v) => api.avatarSet({ camera: v }).then(show) });
    const modelSel = makeSelect(P + 'ModelSel', { options: modelOpts, get: () => (ST ? def.cfg(ST).model : ''), set: (v) => api.avatarSet(def.patch({ model: v })).then(show) });
    const q = (id) => $('#' + P + id);
    const p = { def, camSel, modelSel, previewSet: false, inited: false };

    p.render = () => {
      const st = def.status(ST), ready = st && st.ready, c = def.cfg(ST);
      q('Setup').hidden = !!ready; q('Main').hidden = !ready;
      if (!ready) {
        const miss = st.items.filter((i) => !i.ok);
        q('SetupTxt').textContent = 'Нужно один раз скачать компоненты (около ' + st.totalMb + ' МБ): ' + miss.map((i) => i.title).join(', ') + '. ' + (def.engine === '3d' ? 'Библиотеки приходят из npm, образцы моделей — с GitHub, модель лица — от Google.' : 'Ядро Live2D и образцы моделей приходят из официального пакета Live2D, остальное — из npm и Google.') + ' Проверка целостности включена.'; // текст не меняется во время скачивания: ход загрузки пишется в отдельную строку
        q('Install').disabled = !!installing; q('Install').textContent = installing === def.engine ? 'Скачиваю…' : 'Скачать компоненты';
      }
      q('Mirror').checked = !!c.mirror; q('Green').checked = c.bg === 'green';
      for (const [id, k] of [['Scale', 'scale'], ['Ox', 'offsetX'], ['Oy', 'offsetY']]) q(id).value = c[k];
      q('ScaleVal').textContent = c.scale + '%'; q('OxVal').textContent = c.offsetX; q('OyVal').textContent = c.offsetY;
      const models = def.models(ST), cur = models.find((m) => m.id === c.model);
      q('Remove').disabled = !(cur && !cur.builtin);
      const cr = q('Credit'); if (cr) { cr.hidden = !(cur && cur.credit); cr.textContent = cur && cur.credit ? 'Лицензия модели: ' + cur.credit : ''; }
      camSel(); modelSel(); runText(P);
    };

    q('Install').onclick = async () => {
      if (installing) return; installing = def.engine; q('Install').disabled = true; q('Bar').classList.add('on'); q('BarFill').style.width = '0'; setErr(P, ''); p.render();
      const r = await api.avatarInstall(def.engine).catch((e) => ({ ok: false, error: String(e) }));
      installing = ''; q('Bar').classList.remove('on'); q('Prog').textContent = '';
      if (!r.ok) { q('Install').disabled = false; q('Install').textContent = 'Скачать компоненты'; setErr(P, r.error || 'Не удалось скачать компоненты. Проверьте интернет и попробуйте ещё раз.'); return; }
      show(await api.avatarState()); p.loadPreview(true);
    };
    q('CamRefresh').onclick = () => refreshCams(true);
    q('Run').onclick = async () => {
      const on = ST && ST.run && (ST.run.state === 'on' || ST.run.state === 'starting');
      if (on) { await api.avatarStop(); return; }
      const r = await api.avatarStart().catch(() => null);
      if (r && !r.ok) { ST.run = { state: 'error', error: r.locked ? 'Аватар доступен в Pro.' : (r.error || 'Не удалось включить камеру.') }; runAll(); }
    };
    q('Calib').onclick = () => api.avatarCalibrate();
    q('GetModels').onclick = () => api.avatarOpenModels(def.engine);
    const addModel = async (kind) => {
      const r = await api.avatarAdd(kind).catch((e) => ({ ok: false, error: String(e) }));
      if (r && r.canceled) return;
      if (!r || !r.ok) { errLine(q('ModelTxt'), (r && r.error) || 'Не удалось добавить модель'); return; }
      errLine(q('ModelTxt'), ''); show(r);
    };
    if (def.engine === '3d') q('AddFile').onclick = () => addModel('vrm');
    else { q('AddDir').onclick = () => addModel('dir'); q('AddFile').onclick = () => addModel('file'); }
    q('Remove').onclick = async () => {
      const m = def.models(ST).find((x) => x.id === def.cfg(ST).model);
      if (!m || m.builtin || !confirm('Удалить модель «' + m.name + '» из приложения? Исходные файлы на диске останутся.')) return;
      const r = await api.avatarRemove(m.id).catch(() => null); if (r && r.ok) show(r);
    };
    q('Mirror').onchange = (e) => api.avatarSet(def.patch({ mirror: e.target.checked })).then(show);
    q('Green').onchange = (e) => api.avatarSet(def.patch({ bg: e.target.checked ? 'green' : 'transparent' })).then(show);
    for (const [id, k] of [['Scale', 'scale'], ['Ox', 'offsetX'], ['Oy', 'offsetY']]) {
      q(id).addEventListener('input', (e) => { const v = +e.target.value; q(id + 'Val').textContent = k === 'scale' ? v + '%' : v; api.avatarSet(def.patch({ [k]: v })); });
    }
    q('Url').onfocus = (e) => e.target.select();
    q('Copy').onclick = async () => {
      const u = q('Url').value, b = q('Copy');
      try { await navigator.clipboard.writeText(u); } catch (_) { q('Url').select(); document.execCommand('copy'); }
      b.textContent = '✓'; setTimeout(() => { b.textContent = 'Копировать'; }, 1500);
    };
    // предпросмотр грузится только у видимой панели: два 3D/2D-холста одновременно не нужны
    p.loadPreview = async (force) => {
      const fr = q('Frame');
      if (p.previewSet && !force) return;
      const base = await api.avatarUrl(def.engine);
      if (!base) return;
      p.previewSet = true; fr.src = base;
    };
    p.unloadPreview = () => { if (p.previewSet) { q('Frame').src = 'about:blank'; p.previewSet = false; } };
    p.init = async () => {
      if (p.inited) return; p.inited = true;
      const r = await api.avatarLink(def.engine).catch(() => null);
      q('Url').value = r && r.ok ? r.url : 'Не удалось запустить сервер виджета';
    };
    return p;
  }
  for (const k of Object.keys(E)) panes[k] = makePane(E[k]);
  const runAll = () => { for (const k of Object.keys(panes)) runText(E[k].P); };

  function show(s) {
    if (!s) return;
    ST = Object.assign(ST || {}, s);
    if (!ST.settings || !ST.status || !ST.status3) return;
    panes['2d'].render(); panes['3d'].render();
  }
  api.onAvatarProgress((p) => {
    if (!p || !installing) return;
    const P = E[installing].P, f = p.total ? p.done / p.total : 0;
    $('#' + P + 'BarFill').style.width = Math.round(((p.index - 1) + f) / Math.max(1, p.count) * 100) + '%';
    $('#' + P + 'Prog').textContent = (p.phase === 'unpack' ? 'Распаковываю' : 'Скачиваю') + ' ' + p.index + ' из ' + p.count + ': ' + String(p.title).split(' (')[0].split(' и ')[0] + (p.total ? ' · ' + mb(p.done) + ' из ' + mb(p.total) + ' МБ' : '');
  });
  api.onAvatarState((d) => { if (d && d.run && ST) { const was = ST.run && ST.run.state; ST.run = d.run; runAll(); if (was !== 'on' && d.run.state === 'on') refreshCams(true); } });
  async function refreshCams(ask) { cams = await api.avatarCameras(!!ask).catch(() => []); panes['2d'].camSel(); panes['3d'].camSel(); }

  // предпросмотр сообщает новый размер и сдвиг (колесо мыши и перетаскивание): сохраняем, ползунки обновятся сами
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.echochat !== 'avatar-view') return;
    const k = d.engine === '3d' ? '3d' : '2d';
    if (e.source !== $('#' + E[k].P + 'Frame').contentWindow) return;
    api.avatarSet(E[k].patch({ scale: +d.scale, offsetX: +d.offsetX, offsetY: +d.offsetY })).then(show).catch(() => {});
  });

  // переключатель 2D / 3D
  let mode = '2d';
  function setMode(m, save) {
    mode = m === '3d' ? '3d' : '2d';
    document.querySelectorAll('.avseg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('#avPane').hidden = mode !== '2d'; $('#av3Pane').hidden = mode !== '3d';
    const other = mode === '2d' ? '3d' : '2d';
    panes[other].unloadPreview(); panes[mode].init(); panes[mode].loadPreview();
    if (save) api.avatarSet({ mode }).catch(() => {});
  }
  document.querySelectorAll('.avseg button').forEach((b) => { b.onclick = () => setMode(b.dataset.mode, true); });

  async function open() {
    show(await api.avatarState().catch(() => null));
    setMode(ST && ST.settings ? ST.settings.mode : mode, false);
  }
  document.querySelector('.nav[data-tab=avatar]').addEventListener('click', open);
})();
