'use strict';
// Интерфейс лицензии: вкладка «Лицензия», статус в сайдбаре, размытие закрытых разделов, окно покупки Pro,
// экран конца пробного периода и плавное открытие Pro. Логика тарифов живёт в основном процессе (license.js),
// здесь только показ состояния. Использует $ и askConfirm из renderer.js.
(() => {
  const echo = window.echo;
  const LOCKABLE = { widgets: 'Виджеты', kaspi: 'Донаты Каспи', overlay: 'Оверлей чата', avatar: 'Аватар' };
  const LOCK_KEY = { overlay: 'widgets', avatar: 'widgets' }; // оверлей и аватар закрываются вместе с виджетами; DonationAlerts открыт на всех тарифах
  const DAY = 86400000;
  const qa = (s) => [...document.querySelectorAll(s)];
  const plural = (n, [a, b, c]) => { const m = n % 100, d = n % 10; return m > 10 && m < 20 ? c : d === 1 ? a : d >= 2 && d <= 4 ? b : c; };
  const days = (n) => `${n} ${plural(n, ['день', 'дня', 'дней'])}`;
  const fmtDate = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtTime = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const money = (n) => Number(n).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₸';
  const goTab = (tab) => { const b = document.querySelector(`.nav[data-tab="${tab}"]`); if (b) b.click(); };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }, del: (k) => { try { localStorage.removeItem(k); } catch (_) {} } };

  let st = null;          // последнее состояние лицензии
  let purchase = null;    // данные экрана покупки (assets/purchase.json, pay-qr.png)
  let buyKind = 'pro';

  // ---------- закрытые разделы: размытие + карточка ----------
  const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>';
  function lockText(tab, s) {
    const what = LOCKABLE[tab];
    if (s.reason === 'trial-ended') return [`Пробный период закончился`, `Раздел «${what}» входит в Pro. Остальные разделы продолжают работать`];
    if (s.reason === 'sub-expired') return [`Подписка Pro закончилась`, `Продлите Pro, чтобы снова пользоваться разделом «${what}»`];
    if (s.reason === 'offline-expired') return [`Нужна проверка лицензии`, `Подключитесь к интернету: лицензия подтвердится сама, и «${what}» откроется`];
    if (s.reason === 'revoked') return [`Ключ отозван`, `Напишите автору или введите другой ключ на вкладке «Лицензия»`];
    return [`Раздел доступен в Pro`, `«${what}» открывается с тарифом Pro. Эфир, озвучка и фильтры остаются бесплатными`];
  }
  function applyLocks(s, unlockAnim) {
    for (const tab of Object.keys(LOCKABLE)) {
      const el = document.getElementById('tab-' + tab);
      if (!el) continue;
      const must = s.locked.includes(LOCK_KEY[tab] || tab);
      // слой блокировки лежит в <main> поверх всей страницы (шапка, счётчики, вкладка), а не внутри вкладки: так размытие общее и не зависит от анимации вкладки
      const main = el.parentElement;
      let ov = main.querySelector(`:scope > .lock-ov[data-for="${tab}"]`);
      const kids = [...el.children];
      if (must) {
        clearTimeout(el._unlock);
        el.classList.remove('unlocking');
        el.classList.add('is-locked');
        kids.forEach((k) => k.setAttribute('inert', ''));
        if (!ov) {
          ov = document.createElement('div');
          ov.className = 'lock-ov';
          ov.dataset.for = tab;
          ov.innerHTML = `<div class="lock-card"><div class="lock-ic">${LOCK_SVG}</div><h3></h3><p></p><button class="btn primary" type="button">Открыть Pro</button></div>`;
          ov.querySelector('button').addEventListener('click', () => { goTab('license'); openBuy('pro'); });
          main.appendChild(ov);
        }
        ov.classList.remove('out');
        const [h, p] = lockText(tab, s);
        ov.querySelector('h3').textContent = h;
        ov.querySelector('p').textContent = p;
      } else if (el.classList.contains('is-locked')) {
        // плавное открытие: размытие уходит, карточка тает
        kids.forEach((k) => k.removeAttribute('inert'));
        el.classList.remove('is-locked');
        if (ov) {
          el.classList.add('unlocking');
          ov.classList.add('out');
          clearTimeout(el._unlock);
          el._unlock = setTimeout(() => { el.classList.remove('unlocking'); ov.remove(); }, unlockAnim ? 1000 : 50);
        }
      }
    }
  }

  // ---------- вкладка «Лицензия» и чип в сайдбаре ----------
  const BADGE = { lite: 'LITE', trial: 'ПРОБНЫЙ ПЕРИОД', pro: 'PRO', lifetime: 'LIFETIME' };
  function describe(s) {
    const left = s.daysLeft;
    if (s.plan === 'pro') return { title: 'Pro активен', sub: s.until ? `Действует до ${fmtDate(s.until)} · осталось ${days(left)}` : '', frac: s.until ? Math.min(1, Math.max(0.02, (s.until - Date.now()) / (30 * DAY))) : 1 };
    if (s.plan === 'lifetime') return { title: 'Pro навсегда', sub: 'Бессрочная лицензия, продлевать не нужно', frac: 1 };
    if (s.plan === 'trial') return { title: 'Все функции открыты', sub: left != null ? `Пробный период: осталось ${days(left)}, до ${fmtDate(s.until)}` : '', frac: s.until ? Math.min(1, Math.max(0.02, (s.until - Date.now()) / (3 * DAY))) : 1 };
    const why = { 'trial-ended': 'Пробный период закончился. Эфир, озвучка и фильтры работают, «Виджеты», «Оверлей чата», «Аватар», «Донаты Каспи» откроются с Pro', 'sub-expired': 'Подписка Pro закончилась. Продлите её, чтобы вернуть «Виджеты», «Оверлей чата», «Аватар», «Донаты Каспи»', 'offline-expired': 'Лицензию не удалось проверить давно. Подключитесь к интернету, и Pro вернётся сам', revoked: 'Ключ отозван. Напишите автору или введите другой ключ' }[s.reason];
    if (s.reason === 'trial-ended') return { title: 'Пробный период закончился', sub: 'Действует тариф Lite', frac: 0 };
    return { title: 'Бесплатный тариф', sub: why || 'Эфир, озвучка и фильтры. «Виджеты», «Оверлей чата», «Аватар», «Донаты Каспи» открываются с Pro', frac: 0 };
  }
  function renderStatus(s) {
    const d = describe(s);
    const card = $('#licCard');
    card.className = 'card lic-status ' + s.plan;
    $('#licBadge').textContent = BADGE[s.plan] || s.plan.toUpperCase();
    $('#licTitle').textContent = d.title;
    $('#licSub').textContent = d.sub;
    $('#licBar').style.width = Math.round(d.frac * 100) + '%';
    const net = $('#licNet');
    net.classList.toggle('off', !!s.offline);
    net.classList.toggle('idle', !s.paid && !s.offline);
    // зелёная точка и «активна» только у активированного ключа; без ключа это просто тариф Lite
    $('#licNetT').textContent = s.offline
      ? (s.paid && s.graceUntil ? `Нет связи. Офлайн-доступ до ${fmtDate(s.graceUntil)}` : 'Нет связи с сервером лицензий')
      : !s.paid ? 'Лицензия Lite'
      : s.lastCheck ? `Лицензия ${s.plan === 'lifetime' ? 'Lifetime' : 'Pro'} активна` : 'Проверяем…';
    $('#licKey').textContent = s.keyMasked || '—';
    $('#licDev').textContent = s.paid && s.maxDevices ? `${s.devices} из ${s.maxDevices}` : '—';
    $('#licCheck').textContent = s.lastCheck ? (s.offline ? `${fmtTime(s.lastCheck)} · не удалась` : `сегодня, ${fmtTime(s.lastCheck)}`) : '—';
    $('#licIid').textContent = s.installShort || '—';
    $('#licRelease').hidden = !s.paid;
    $('#licKeyCard').hidden = !!s.paid;
    $('#licCols').classList.toggle('paid', !!s.paid);
    $('#licBuy').textContent = s.plan === 'pro' ? 'Продлить Pro' : 'Купить Pro';
    document.querySelector('.lic-plans').hidden = s.plan === 'lifetime';
  }
  function renderChip(s) {
    const chip = $('#licChip');
    const expired = s.plan === 'lite' && ['trial-ended', 'sub-expired'].includes(s.reason);
    chip.className = 'lic-chip ' + s.plan + (expired ? ' expired' : '');
    const T = $('#licChipT'), S = $('#licChipS'), C = $('#licChipCta');
    let t, sub, cta = '';
    if (s.plan === 'lifetime') { t = 'Lifetime'; sub = 'Бессрочная лицензия'; }
    else if (s.plan === 'pro') { t = 'Pro'; sub = s.until ? `Действует до ${fmtDate(s.until)}` : 'Все функции открыты'; cta = s.daysLeft != null && s.daysLeft <= 5 ? 'Продлить' : ''; }
    else if (s.plan === 'trial') { t = 'Пробный период'; sub = s.daysLeft != null ? `Осталось ${days(s.daysLeft)}, потом Lite` : 'Все функции открыты'; cta = 'Купить Pro'; }
    else if (expired) { t = s.reason === 'sub-expired' ? 'Подписка закончилась' : 'Пробный период закончился'; sub = 'Виджеты, аватар и Каспи закрыты'; cta = s.reason === 'sub-expired' ? 'Продлить Pro' : 'Открыть Pro'; }
    else { t = 'Тариф Lite'; sub = 'Откройте виджеты, аватар и Каспи'; cta = 'Открыть Pro'; }
    T.textContent = t; S.textContent = sub;
    C.textContent = cta; C.hidden = !cta;
  }

  // ---------- окно покупки Pro ----------
  async function loadPurchase() {
    if (!purchase) { try { purchase = await echo.licPurchase(); } catch (_) { purchase = null; } }
    return purchase || { price: 5000, days: 30, payNote: '', contactLabel: '', contactUrl: '', qr: '' };
  }
  async function openBuy(kind) {
    buyKind = kind;
    const p = await loadPurchase();
    const life = kind === 'life';
    $('#licBuyBadge').textContent = life ? 'Lifetime' : 'Pro';
    $('#licBuyTitle').textContent = life ? 'Lifetime Pro — партнёрская лицензия' : `Pro на ${days(p.days)}`;
    $('.lb-price').hidden = life;
    $('#licPrice').textContent = life ? '' : money(p.price);
    $('#licPriceSub').textContent = life ? '' : `за ${days(p.days)}`;
    $('#licPayNote').textContent = life ? 'Получите полную версию Pro навсегда бесплатно за продвижение программы на своих площадках (TikTok, Twitch и других).\nУсловия получения согласовываются индивидуально.' : (p.payNote || 'Оплатите по QR-коду');
    const card = !life && p.cardNumber ? p.cardNumber : '';
    $('#licCardBox').hidden = !card;
    $('#licReceipt').hidden = life;
    $('#licKeySub').textContent = (life ? 'Lifetime Pro' : 'Pro') + ' откроется сразу, перезапуск не нужен';
    $('#licCardNum').textContent = card;
    const cb = $('#licCardCopy'); cb.classList.remove('done'); cb.querySelector('span').textContent = 'Копировать';
    const showQr = !life && !!p.qr;
    $('#licQrBox').hidden = !showQr;
    if (showQr) $('#licQr').src = p.qr;
    $('#licQrBox').parentElement.classList.toggle('noqr', !showQr);
    const c = $('#licContact');
    c.hidden = !p.contactUrl;
    if (p.contactUrl) { c.href = p.contactUrl; c.textContent = p.contactLabel || 'Написать автору'; }
    setMsg('#licBuyMsg', '');
    $('#licBuyKey').value = '';
    $('#licBuyBack').hidden = false;
    setTimeout(() => $('#licBuyKey').focus(), 60);
  }
  async function copyCard() {
    const text = $('#licCardNum').textContent.trim();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch (_) { const t = document.createElement('input'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    const b = $('#licCardCopy');
    b.classList.add('done'); b.querySelector('span').textContent = 'Скопировано';
    clearTimeout(b._t); b._t = setTimeout(() => { b.classList.remove('done'); b.querySelector('span').textContent = 'Копировать'; }, 1800);
  }
  const closeBuy = () => { $('#licBuyBack').hidden = true; };

  // ---------- активация ключа ----------
  function setMsg(sel, text, kind) { const m = $(sel); m.textContent = text || ''; m.className = 'lic-msg' + (kind ? ' ' + kind : ''); }
  const cleanKey = (inp) => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 29); };
  async function activate({ input, msg, btn }) {
    const inp = $(input);
    const key = inp.value.trim();
    if (!key) { setMsg(msg, 'Введите ключ', 'bad'); if (typeof flagField === 'function') flagField(inp); return; }
    const b = $(btn), label = b.textContent;
    b.style.pointerEvents = 'none'; b.textContent = 'Проверяю…'; setMsg(msg, '');
    let r;
    try { r = await echo.licActivate(key); } catch (e) { r = { ok: false, message: 'Не удалось связаться с программой. Перезапустите её' }; }
    b.style.pointerEvents = ''; b.textContent = label;
    if (!r || !r.ok) { setMsg(msg, (r && r.message) || 'Не удалось активировать ключ', 'bad'); if (typeof flagField === 'function') flagField(inp); return; }
    inp.value = '';
    setMsg(msg, 'Ключ принят', 'ok');
    closeBuy();
    if (r.state) apply(r.state, { activated: true });
  }

  // ---------- плавное открытие Pro ----------
  function celebrate(s) {
    const wow = $('#licWow');
    $('#licWowT').textContent = s.plan === 'lifetime' ? 'Lifetime активирован' : 'Pro активирован';
    $('#licWowS').textContent = s.plan === 'lifetime' ? 'Все разделы открыты навсегда' : s.until ? `Все разделы открыты до ${fmtDate(s.until)}` : 'Все разделы открыты';
    const sp = $('#licSpark'), colors = ['#8b5cf6', '#ec4899', '#22d3ee', '#fbbf24', '#ffffff'];
    sp.textContent = '';
    for (let i = 0; i < 18; i++) {
      const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.35, r = 150 + Math.random() * 130, e = document.createElement('i');
      e.style.cssText = `--x:${Math.round(Math.cos(a) * r * 1.25)}px;--y:${Math.round(Math.sin(a) * r * 0.8)}px;--s:${4 + Math.round(Math.random() * 5)}px;--d:${(0.25 + Math.random() * 0.35).toFixed(2)}s;--c:${colors[i % colors.length]}`;
      sp.appendChild(e);
    }
    wow.hidden = true; void wow.offsetWidth; wow.hidden = false;
    clearTimeout(wow._t); wow._t = setTimeout(() => { wow.hidden = true; }, 3000);
    const chip = $('#licChip'); chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
  }

  // ---------- конец пробного периода ----------
  function maybeEndScreen(s) {
    if (s.paid) { store.del('licEndSeen'); return; }
    if (s.plan !== 'lite' || !['trial-ended', 'sub-expired'].includes(s.reason)) return;
    if (store.get('licEndSeen') === s.reason) return;
    const sub = s.reason === 'sub-expired';
    $('#licEndTitle').textContent = sub ? 'Подписка Pro закончилась' : 'Пробный период закончился';
    $('#licEndText').textContent = sub
      ? 'Вы перешли на тариф Lite. Эфир, озвучка и фильтры работают как раньше, а «Виджеты», «Оверлей чата», «Аватар», «Донаты Каспи» вернутся после продления'
      : 'Вы остались на тарифе Lite. Эфир, озвучка и фильтры работают как раньше, а «Виджеты», «Оверлей чата», «Аватар», «Донаты Каспи» откроются с Pro';
    $('#licEndBack').hidden = false;
  }
  const closeEnd = () => { $('#licEndBack').hidden = true; if (st) store.set('licEndSeen', st.reason); };

  // ---------- общий вход: новое состояние ----------
  function apply(s, meta = {}) {
    if (!s) return;
    const was = st;
    st = s;
    window.dispatchEvent(new CustomEvent('lic-change', { detail: s }));
    renderStatus(s);
    renderChip(s);
    document.querySelectorAll('.nav-pro').forEach((b) => { b.hidden = !!s.paid; });
    const becamePaid = !!was && !was.paid && s.paid;
    applyLocks(s, becamePaid || !!meta.activated);
    if (becamePaid) celebrate(s);
    if (!was || was.plan !== s.plan || was.reason !== s.reason) maybeEndScreen(s);
  }

  // ---------- события ----------
  $('#licChip').addEventListener('click', () => goTab('license'));
  $('#licBuy').addEventListener('click', () => openBuy('pro'));
  $('#licBuyLife').addEventListener('click', () => openBuy('life'));
  $('#licBuyX').addEventListener('click', closeBuy);
  $('#licCardCopy').addEventListener('click', copyCard);
  $('#licBuyBack').addEventListener('click', (e) => { if (e.target === $('#licBuyBack')) closeBuy(); });
  $('#licActivate').addEventListener('click', () => activate({ input: '#licKeyInput', msg: '#licMsg', btn: '#licActivate' }));
  $('#licBuyAct').addEventListener('click', () => activate({ input: '#licBuyKey', msg: '#licBuyMsg', btn: '#licBuyAct' }));
  for (const id of ['#licKeyInput', '#licBuyKey']) {
    const inp = $(id);
    inp.addEventListener('input', () => { cleanKey(inp); inp.closest('.nick-field').classList.remove('err'); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') (id === '#licKeyInput' ? $('#licActivate') : $('#licBuyAct')).click(); });
  }
  let statT = null;
  function statMsg(text, kind, ms = 5000) {
    const m = $('#licStatMsg');
    m.textContent = text; m.className = 'lic-msg lic-statmsg' + (kind ? ' ' + kind : '');
    clearTimeout(statT); if (text && ms) statT = setTimeout(() => { m.textContent = ''; }, ms);
  }
  // результат проверки показывается прямо в кнопке и через пару секунд возвращается к «Проверить сейчас»
  const REFRESH_LABEL = 'Проверить сейчас';
  $('#licRefresh').addEventListener('click', async () => {
    const b = $('#licRefresh');
    clearTimeout(b._t); b.className = 'btn ghost';
    b.textContent = 'Проверяю…'; b.style.pointerEvents = 'none'; statMsg('');
    let text, kind = '';
    try {
      const s = await echo.licRefresh(); apply(s);
      const off = !!(s && s.offline), paid = !!(s && s.paid);
      if (off) { text = 'Нет связи, работаем офлайн'; kind = 'bad'; setMsg('#licMsg', 'Сервер лицензий недоступен. Работаем по сохранённой лицензии', 'bad'); }
      else if (paid) { text = `Лицензия ${s.plan === 'lifetime' ? 'Lifetime' : 'Pro'} активна`; kind = 'ok'; setMsg('#licMsg', ''); }
      else { text = s && s.plan === 'trial' ? 'Ключ не активирован. Идёт пробный период' : 'Ключ не активирован. Действует тариф Lite'; setMsg('#licMsg', ''); }
    } catch (_) { text = 'Не удалось проверить лицензию'; kind = 'bad'; }
    b.textContent = text; b.style.pointerEvents = '';
    if (kind) b.classList.add('res-' + kind);
    b._t = setTimeout(() => { b.textContent = REFRESH_LABEL; b.classList.remove('res-ok', 'res-bad'); }, 4000);
  });
  $('#licRelease').addEventListener('click', async () => {
    const ok = await askConfirm({ title: 'Освободить это устройство?', text: 'Лицензия отвяжется от этого компьютера, и здесь вернётся тариф Lite. Ключ можно будет ввести на другом компьютере', ok: 'Освободить', cancel: 'Отмена', danger: true });
    if (!ok) return;
    const r = await echo.licDeactivate();
    if (!r || !r.ok) { statMsg((r && r.message) || 'Не удалось освободить устройство', 'bad'); return; }
    setMsg('#licMsg', 'Устройство освобождено. Ключ можно ввести на другом компьютере', 'ok');
    if (r.state) apply(r.state);
  });
  $('#licEndLite').addEventListener('click', closeEnd);
  $('#licEndPro').addEventListener('click', () => { closeEnd(); goTab('license'); openBuy('pro'); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#licBuyBack').hidden) closeBuy();
    else if (!$('#licEndBack').hidden) closeEnd();
  });
  window.__lic = { get state() { return st; }, buy: () => { goTab('license'); openBuy('pro'); } };
  echo.onLic((s) => apply(s, { activated: !!(s && s.justActivated) }));

  // цену на карточке тарифа берём из того же файла, что и окно покупки
  loadPurchase().then((p) => { $('#licPlanPrice').textContent = money(p.price); $('#licPlanDays').textContent = `/ ${days(p.days)}`; });

  // старт и плановое обновление: срок и дни считаются в основном процессе, раз в минуту подтягиваем актуальное
  echo.licState().then((s) => apply(s));
  setInterval(() => echo.licState().then((s) => s && apply(s)).catch(() => {}), 60000);
  window.addEventListener('online', () => echo.licRefresh().then((s) => s && apply(s)).catch(() => {}));
})();
