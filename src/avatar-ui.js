'use strict';
// Вкладка «Аватар»: установка компонентов, камера, выбор модели, настройки и предпросмотр. Всё хранится в приложении (avatar.json), не в браузере.
(() => {
  const $ = (s) => document.querySelector(s);
  const api = window.echo;
  let ST = null, cams = [], busy = false;
  const mb = (n) => Math.round(n / 1048576);

  const camOpts = () => [{ v: '', label: cams.length ? 'Камера по умолчанию' : 'Нажмите «Обновить камеры»' }, ...cams.map((c) => ({ v: c.id, label: c.label }))];
  const modelOpts = () => (ST ? ST.models : []).map((m) => ({ v: m.id, label: m.name + (m.builtin ? ' (образец)' : '') }));
  const camSel = makeSelect('avCamSel', { options: camOpts, get: () => (ST ? ST.settings.camera : ''), set: (v) => api.avatarSet({ camera: v }).then(show) });
  const modelSel = makeSelect('avModelSel', { options: modelOpts, get: () => (ST ? ST.settings.model : ''), set: (v) => api.avatarSet({ model: v }).then(show) });

  function run() {
    const r = (ST && ST.run) || { state: 'off' };
    const b = $('#avRun'), t = $('#avRunTxt');
    b.textContent = r.state === 'off' || r.state === 'error' ? 'Включить камеру' : (r.state === 'starting' ? 'Запуск…' : 'Выключить камеру');
    b.disabled = r.state === 'starting';
    $('#avCalib').disabled = r.state !== 'on';
    t.className = 'wstat' + (r.state === 'error' ? ' bad' : (r.state === 'on' ? ' ok' : ''));
    t.textContent = r.state === 'error' ? r.error : r.state === 'starting' ? 'Запускаю камеру и поиск лица…' : r.state === 'on' ? (r.calibrating ? 'Смотрите прямо в камеру: идёт калибровка…' : 'Камера работает' + (r.fps ? ' · ' + r.fps + ' кадр/с' : '')) : '';
  }
  function show(s) {
    if (!s) return;
    ST = Object.assign(ST || {}, s);
    const ready = ST.status && ST.status.ready;
    $('#avSetup').hidden = !!ready;
    $('#avMain').hidden = !ready;
    if (!ready) {
      const miss = ST.status.items.filter((i) => !i.ok);
      $('#avSetupTxt').textContent = 'Нужно один раз скачать компоненты (около ' + ST.status.totalMb + ' МБ): ' + miss.map((i) => i.title).join(', ') + '. Ядро Live2D и образцы моделей приходят из официального пакета Live2D, остальное — из npm и Google. Проверка целостности включена.'; // текст не меняется во время скачивания: ход загрузки пишется в отдельную строку #avProg
      $('#avInstall').disabled = !!ST.installing; $('#avInstall').textContent = ST.installing ? 'Скачиваю…' : 'Скачать компоненты';
    }
    $('#avMirror').checked = !!ST.settings.mirror;
    $('#avGreen').checked = ST.settings.bg === 'green';
    for (const [id, k] of [['avScale', 'scale'], ['avOx', 'offsetX'], ['avOy', 'offsetY']]) { $('#' + id).value = ST.settings[k]; }
    $('#avScaleVal').textContent = ST.settings.scale + '%'; $('#avOxVal').textContent = ST.settings.offsetX; $('#avOyVal').textContent = ST.settings.offsetY;
    $('#avRemove').disabled = !(ST.models || []).some((m) => m.id === ST.settings.model && !m.builtin);
    camSel(); modelSel(); run();
  }
  const setErr = (t) => { const e = $('#avSetupErr'); e.hidden = !t; e.textContent = t || ''; };
  const err = (el, t) => { el.className = 'wstat' + (t ? ' bad' : ''); el.textContent = t || ''; };

  $('#avInstall').onclick = async () => {
    if (busy) return; busy = true; $('#avInstall').disabled = true; $('#avBar').classList.add('on'); $('#avBarFill').style.width = '0'; setErr('');
    const r = await api.avatarInstall().catch((e) => ({ ok: false, error: String(e) }));
    busy = false; $('#avBar').classList.remove('on'); $('#avProg').textContent = '';
    if (!r.ok) { $('#avInstall').disabled = false; setErr(r.error || 'Не удалось скачать компоненты. Проверьте интернет и попробуйте ещё раз.'); return; }
    show(await api.avatarState()); loadPreview(true);
  };
  api.onAvatarProgress((p) => {
    if (!p) return;
    const f = p.total ? p.done / p.total : 0;
    $('#avBarFill').style.width = Math.round(((p.index - 1) + f) / Math.max(1, p.count) * 100) + '%';
    $('#avProg').textContent = (p.phase === 'unpack' ? 'Распаковываю' : 'Скачиваю') + ' ' + p.index + ' из ' + p.count + ': ' + String(p.title).split(' (')[0].split(' и ')[0] + (p.total ? ' · ' + mb(p.done) + ' из ' + mb(p.total) + ' МБ' : '');
  });
  api.onAvatarState((d) => { if (d && d.run && ST) { const was = ST.run && ST.run.state; ST.run = d.run; run(); if (was !== 'on' && d.run.state === 'on') refreshCams(true); } });

  async function refreshCams(ask) { cams = await api.avatarCameras(!!ask).catch(() => []); camSel(); }
  $('#avCamRefresh').onclick = () => refreshCams(true);
  $('#avRun').onclick = async () => {
    const on = ST && ST.run && (ST.run.state === 'on' || ST.run.state === 'starting');
    if (on) { await api.avatarStop(); return; }
    const r = await api.avatarStart().catch(() => null);
    if (r && !r.ok) { ST.run = { state: 'error', error: r.locked ? 'Аватар доступен в Pro.' : (r.error || 'Не удалось включить камеру.') }; run(); }
  };
  $('#avCalib').onclick = () => api.avatarCalibrate();
  const addModel = async (kind) => {
    const r = await api.avatarAdd(kind).catch((e) => ({ ok: false, error: String(e) }));
    if (r && r.canceled) return;
    if (!r || !r.ok) { err($('#avModelTxt'), (r && r.error) || 'Не удалось добавить модель'); return; }
    err($('#avModelTxt'), ''); show(r);
  };
  $('#avGetModels').onclick = () => api.avatarOpenModels();
  $('#avAddDir').onclick = () => addModel('dir');
  $('#avAddFile').onclick = () => addModel('file');
  $('#avRemove').onclick = async () => {
    const m = ST.models.find((x) => x.id === ST.settings.model);
    if (!m || m.builtin || !confirm('Удалить модель «' + m.name + '» из приложения? Исходные файлы на диске останутся.')) return;
    const r = await api.avatarRemove(m.id).catch(() => null); if (r && r.ok) show(r);
  };
  $('#avMirror').onchange = (e) => api.avatarSet({ mirror: e.target.checked }).then(show);
  $('#avGreen').onchange = (e) => api.avatarSet({ bg: e.target.checked ? 'green' : 'transparent' }).then(show);
  for (const [id, k] of [['avScale', 'scale'], ['avOx', 'offsetX'], ['avOy', 'offsetY']]) {
    $('#' + id).addEventListener('input', (e) => { const v = +e.target.value; $('#' + id + 'Val').textContent = k === 'scale' ? v + '%' : v; api.avatarSet({ [k]: v }); });
  }
  $('#avUrl').onfocus = (e) => e.target.select();
  $('#avCopy').onclick = async () => {
    const u = $('#avUrl').value, b = $('#avCopy');
    try { await navigator.clipboard.writeText(u); } catch (_) { $('#avUrl').select(); document.execCommand('copy'); }
    b.textContent = '✓'; setTimeout(() => { b.textContent = 'Копировать'; }, 1500);
  };

  // предпросмотр сообщает новый размер и сдвиг (колесо мыши и перетаскивание): сохраняем, ползунки обновятся сами
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== $('#avFrame').contentWindow || !d || d.echochat !== 'avatar-view') return;
    api.avatarSet({ scale: +d.scale, offsetX: +d.offsetX, offsetY: +d.offsetY }).then(show).catch(() => {});
  });
  let previewSet = false;
  async function loadPreview(force) {
    const fr = $('#avFrame');
    if (previewSet && !force) return;
    const base = await api.avatarUrl();
    if (!base) return;
    previewSet = true; fr.src = base;
  }
  let inited = false;
  async function open() {
    show(await api.avatarState().catch(() => null));
    if (!inited) {
      inited = true;
      const r = await api.avatarLink().catch(() => null);
      $('#avUrl').value = r && r.ok ? r.url : 'Не удалось запустить сервер виджета';
      // список камер не запрашиваем при открытии вкладки: для него поднимается окно трекера, а оно нужно только когда человек сам включает камеру
    }
    loadPreview();
  }
  document.querySelector('.nav[data-tab=avatar]').addEventListener('click', open);
})();
