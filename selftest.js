// Автотест: запускает окно приложения, нажимает кнопки и проверяет реальные функции.
// Запуск: electron . --selftest --out=result.json
const fs = require('fs');

const { explain } = require('./errors');
const ev = require('./events');
function mainTests() {
  const R = [];
  const add = (name, ok, detail) => R.push({ group: 'logic', name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const e1 = explain(new Error("The requested user isn't online :("));
  add('«isn\'t online» → понятный русский', e1.code === 'offline' && /не в эфире/i.test(e1.error) && !/[a-z]{4,}/i.test(e1.error.replace(/TikTok|LIVE/g, '')), e1.error);
  const e2 = explain(new Error('Failed to retrieve Room ID from alternative source'));
  add('«Failed to retrieve Room ID» → понятный русский', e2.code === 'offline' && /не найден|не в эфире/i.test(e2.error) && !/Failed|Room/.test(e2.error), e2.error);
  const err = new Error('boom'); err.name = 'UserOfflineError';
  add('UserOfflineError → offline', explain(err).code === 'offline');
  add('сеть → русский текст', explain(new Error('getaddrinfo ENOTFOUND')).code === 'network');
  const o = explain(new Error('weird failure xyz'));
  add('неизвестная ошибка — русский текст без английского', o.code === 'other' && !/weird|xyz/.test(o.error), o.error);
  const ch = ev.chatOf({ content: 'привет', user: { nickname: 'Аня' } });
  add('событие чата: текст из content', ch.text === 'привет' && ch.name === 'Аня', JSON.stringify(ch));
  add('событие зрителей: total', ev.viewersOf({ total: 42 }) === 42 && ev.viewersOf({ viewerCount: 7 }) === 7);
  add('событие лайков: count/total', ev.likesOf({ count: 2, total: 55 }).total === 55);
  const kp = require('./kaspi');
  const kr = kp.parse('Перевод. Айдос А. отправил(а) вам 1 000 ₸');
  add('донаты: уведомление Каспи разбирается', kr.ok && kr.amount === 1000 && kr.name === 'Айдос А.', JSON.stringify(kr));
  add('донаты: покупка и баланс не считаются донатом', kp.parse('Покупка 4 500 ₸ Magnum').ok === false && kp.parse('Баланс: 90 000 ₸. Перевод от Аня Б. 700 ₸').amount === 700);
  add('донаты: страница виджета входит в сборку', /addEventListener\('donate'/.test(require('./widget-donate-page')));
  add('топ лайков: страница виджета входит в сборку', /addEventListener\('likes'/.test(require('./widget-likes-page')));
  add('событие подарка: серия не считается, пока идёт', ev.giftOf({ giftDetails: { giftName: 'Rose', giftType: 1 }, repeatEnd: false }).done === false && ev.giftOf({ giftDetails: { giftName: 'Rose', giftType: 1 }, repeatEnd: true }).done === true);
  return R;
}

const outArg = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);

const PAGE_TEST = `(async () => {
  const R = [];
  const add = (group, name, ok, detail) => R.push({ group, name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  try {
    // --- интерфейс (критично) ---
    add('ui', 'preload API', window.echo && ['connect','disconnect','synth','voices','checkUpdate'].every((k) => typeof window.echo[k] === 'function'));
    for (const t of ['voice', 'filters', 'widgets', 'kaspi', 'overlay', 'live']) {
      $('.nav[data-tab=' + t + ']').click();
      add('ui', 'вкладка ' + t, $('#tab-' + t).classList.contains('show') && $('#title').textContent.length > 0);
    }
    add('ui', 'вкладка «Виджеты»: ссылка и настройки', /^https:\\/\\/vladimirphoto\\.github\\.io\\/jonny-chat-tiktok\\/chat\\/\\?tt=(left|right)&tw=(left|right)&w=\\w+$/.test($('#wUrl').value) && !!$('#wAlignTtSel') && !!$('#wAlignTwSel') && document.querySelectorAll('#tab-widgets input[data-k]').length >= 5, $('#wUrl').value);
    add('ui', 'иконки в 4 плашках', document.querySelectorAll('.stat .ic').length === 4);
    add('ui', 'иконки в меню', document.querySelectorAll('.nav .ic').length === 8);
    add('ui', 'карточки голосов', document.querySelectorAll('#voices .voice').length >= 2, document.querySelectorAll('#voices .voice').length);
    add('ui', 'версия в сайдбаре', /\\d+\\.\\d+/.test($('#verLine').textContent), $('#verLine').textContent);

    // --- фильтры (критично) ---
    const E = window.__echo; E.S.maxLen = 60; E.S.noRepeat = false;
    const f = (s) => E.clean(s);
    add('logic', 'эмодзи убираются', f('Привет 😀') === 'Привет', f('Привет 😀'));
    add('logic', 'команды пропускаются', f('!hello привет') === null);
    add('logic', 'ссылки пропускаются', f('заходи на site.com') === null);
    add('logic', 'мат пропускается', f('ты пидор') === null);
    add('logic', 'нерусский пропускается', f('hello world') === null);
    add('logic', 'упоминания вырезаются', f('@vasya привет') === 'привет', f('@vasya привет'));
    add('logic', 'озвучка ника', E.speakName('Вася_Pro😎') === 'Вася Pro', E.speakName('Вася_Pro😎'));
    // --- голоса ---
    $('.nav[data-tab=voice]').click();
    const names = [...document.querySelectorAll('#voices .voice b')].map((b) => b.textContent.trim());
    add('ui', 'голоса: Светлана и Дмитрий первыми, есть мультиязычные', names.length >= 2 && names[0] === 'Светлана' && names[1] === 'Дмитрий', names.join(','));
    const pb = $('#voices .voice .play');
    pb.click(); await sleep(150);
    add('ui', 'кнопка Twitch есть', !!$('#btnTwitch'), !!$('#btnTwitch'));
    add('ui', 'кнопка ▶ при нажатии превращается в паузу', pb.classList.contains('active') && /rect/.test(pb.innerHTML) && /Остановить/.test($('#btnTest').textContent), pb.innerHTML.slice(0, 40) + ' | ' + $('#btnTest').textContent);
    pb.click(); await sleep(150);
    add('ui', 'повторное нажатие останавливает', !pb.classList.contains('active') && /path/.test(pb.innerHTML), pb.innerHTML.slice(0, 40));
    { const wh = $('[data-k=ttChat]').closest('.card'), mv = $('#voices').closest('.card'), st = $('#studio');
      add('ui', 'озвучка: слева «Что озвучивать» и студия, справа «Мои голоса»; карточки «Голоса платформ» нет', wh === $('#tab-voice .col-left').firstElementChild && st === wh.nextElementSibling && mv === $('#tab-voice .col-right').firstElementChild && !$('#voiceRoutes') && !$('#ttVoiceSel') && !$('#twVoiceSel')); }
    add('ui', '«Только подписчики» убрано', !document.querySelector('[data-k=subsOnly]') && !/Только подписчики/.test(document.body.innerText));
    // --- озвучка: отдельные кнопки для TikTok и Twitch ---
    const vb = (k) => document.querySelector('input[data-k=' + k + ']');
    add('ui', 'озвучка: отдельные переключатели TikTok (чат, подарки, подписки), Twitch (чат), заголовки без значков и «Читать ник»', ['ttChat', 'gifts', 'follows', 'twChat', 'readName'].every((k) => vb(k)) && !!document.querySelector('.vgroup.tt [data-k=ttChat]') && !!document.querySelector('.vgroup.tw [data-k=twChat]') && !document.querySelector('.vgroup .vg-head .vv-ic'));
    add('ui', 'озвучка: старые переключатели «Что озвучивать» убраны', !document.querySelector('input[data-k=chat]') && /Что озвучивать/.test($('#tab-voice').innerText));
    const tw0 = E.S.twChat;
    vb('twChat').click();
    add('ui', 'переключатель озвучки Twitch переключается отдельно от TikTok', E.S.twChat === !tw0 && vb('twChat').checked === E.S.twChat && E.S.ttChat === true && vb('ttChat').checked, E.S.twChat + ' / ' + E.S.ttChat);
    vb('twChat').click();
    // --- голос для TikTok и Twitch закрепляется кнопками в карточке выбранного голоса ---
    const evSel = $('#eventVoiceSel');
    add('ui', 'голос подарков и подписок — список в стиле виджета внутри «Что озвучивать»', !!evSel && evSel.classList.contains('csel') && evSel.closest('.card').querySelector('[data-k=ttChat]') !== null && evSel.querySelectorAll('.csel-opt').length >= 3);
    add('ui', 'старый <select> голоса подарков убран', !document.querySelector('#tab-voice select'));
    const card = (id) => document.querySelector('#voices .voice[data-id="' + id + '"]');
    card('b-dmitry').click(); await sleep(50);
    add('ui', 'выбранный голос подсвечен и показывает кнопки TikTok и Twitch', card('b-dmitry').classList.contains('sel') && !!card('b-dmitry').querySelector('.rbtn.tt') && !!card('b-dmitry').querySelector('.rbtn.tw') && !card('b-svetlana').querySelector('.rbtn'));
    card('b-dmitry').querySelector('.rbtn.tw').click(); await sleep(50);
    card('b-svetlana').click(); await sleep(50);
    card('b-svetlana').querySelector('.rbtn.tt').click(); await sleep(50);
    add('ui', 'кнопки закрепляют голос отдельно за Twitch и TikTok', E.S.twVoice === 'b-dmitry' && E.S.ttVoice === 'b-svetlana' && E.twPreset().voice !== E.ttPreset().voice && card('b-svetlana').querySelector('.rbtn.tt').classList.contains('on') && !card('b-svetlana').querySelector('.rbtn.tw').classList.contains('on'), E.S.ttVoice + ' / ' + E.S.twVoice);
    add('ui', 'на невыбранных карточках видны метки платформ', !!document.querySelector('#voices .vtags em.tw'));
    evSel.click(); await sleep(50); document.body.click(); await sleep(50);
    add('ui', 'список закрывается кликом вне него', !document.querySelector('.csel.open'));
    // --- шапка: обе платформы «не в эфире» до подключения ---
    add('ui', 'плашки: «Не в эфире TikTok» и «Не в эфире Twitch»', /Не в эфире TikTok/.test($('#pillTt').textContent) && /Не в эфире Twitch/.test($('#pillTw').textContent) && !$('#pillTt').hidden && !$('#pillTw').hidden, $('#pillTt').textContent.trim() + ' | ' + $('#pillTw').textContent.trim());
    add('ui', 'вместо «Подключённый ник» — «TikTok», ники на цветных плашках', !/Подключённый ник/.test(document.body.innerText) && /^TikTok$/.test($('#connNick').previousElementSibling.textContent.trim()) && $('#connNick').classList.contains('nk') && $('#connTw').classList.contains('nk'));
    E.setNk($('#connNick'), '@test');
    const nk = getComputedStyle($('#connNick'));
    add('ui', 'ник TikTok выделен цветом и фоном', !$('#connNick').classList.contains('off') && nk.backgroundColor !== 'rgba(0, 0, 0, 0)' && nk.color !== getComputedStyle($('#connStatus')).color, nk.color + ' / ' + nk.backgroundColor);
    E.setNk($('#connNick'), '—');
    // --- полоса прокрутки не вплотную к контенту ---
    const fd = getComputedStyle($('#feed'));
    add('ui', 'лента: полоса прокрутки отстоит от сообщений', parseFloat(fd.paddingRight) >= 8 && parseFloat(fd.marginRight) < 0, fd.paddingRight + ' / ' + fd.marginRight);
    const tb = getComputedStyle($('#tab-voice'));
    add('ui', 'вкладки: полоса прокрутки сдвинута вправо', parseFloat(tb.paddingRight) >= 8 && parseFloat(tb.marginRight) < 0, tb.paddingRight + ' / ' + tb.marginRight);
    // --- формат ссылки виджета ---
    add('ui', 'вариантов формата ссылки нет — одна рабочая ссылка', !$('#wHostSel'));
    // выравнивание отдельно для TikTok и Twitch
    const pick2 = async (id, re) => { $('#' + id).click(); await sleep(40); [...$('#' + id).querySelectorAll('.csel-opt')].find((o) => re.test(o.textContent)).click(); await sleep(40); };
    const cw = () => E.S.widgets.find((w) => w.id === E.S.wSel);
    await pick2('wAlignTtSel', /Справа/); await pick2('wAlignTwSel', /Слева/);
    const alOk1 = cw().tt === 'right' && cw().tw === 'left' && /\\?tt=right&tw=left&w=\\w+$/.test($('#wUrl').value);
    await pick2('wAlignTtSel', /Слева/); await pick2('wAlignTwSel', /Слева/);
    add('ui', 'выравнивание задаётся отдельно для TikTok и Twitch, ссылка меняется', alOk1 && cw().tt === 'left' && cw().tw === 'left' && /\\?tt=left&tw=left&w=\\w+$/.test($('#wUrl').value), cw().tt + ' / ' + cw().tw + ' | ' + $('#wUrl').value);
    // несколько виджетов: у каждого своя ссылка
    const tabs0 = document.querySelectorAll('#wTabs .wtab:not(.add)').length;
    const url1 = $('#wUrl').value;
    document.querySelectorAll('#wTabs .wtab:not(.add)')[1].click(); await sleep(60);
    const url2 = $('#wUrl').value;
    add('ui', 'два виджета с отдельными ссылками и выравниванием', tabs0 >= 2 && url1 !== url2 && /\\?tt=right&tw=right&w=\\w+$/.test(url2), url1 + ' | ' + url2);
    document.querySelectorAll('#wTabs .wtab:not(.add)')[0].click(); await sleep(60);
    // у каждого виджета свои настройки: масштаб, высота, время жизни и переключатели
    {
      const setR = (id, v) => { const el = $('#' + id); el.value = v; el.dispatchEvent(new Event('input')); };
      const wt = (i) => document.querySelectorAll('#wTabs .wtab:not(.add)')[i];
      const rd = () => [$('#wScale').value, $('#wHeight').value, $('#wFadeSec').value].join('/');
      wt(0).click(); await sleep(60);
      setR('wScale', 150); setR('wHeight', 60); setR('wFadeSec', 45);
      const tg = $('#tab-widgets input[data-k=wAvatars]'); tg.checked = false; tg.dispatchEvent(new Event('change'));
      wt(1).click(); await sleep(60);
      const second = rd(), secondAv = $('#tab-widgets input[data-k=wAvatars]').checked;
      setR('wScale', 80);
      wt(0).click(); await sleep(60);
      const first = rd(), firstAv = $('#tab-widgets input[data-k=wAvatars]').checked;
      const w0 = E.S.widgets[0], w1 = E.S.widgets[1];
      add('ui', 'настройки виджета у каждого свои', first === '150/60/45' && second === '100/100/20' && !firstAv && secondAv && w0.scale === 150 && w1.scale === 80 && w0.avatars === false && w1.avatars === true, first + ' | ' + second + ' | ' + firstAv + '/' + secondAv);
      tg.checked = true; tg.dispatchEvent(new Event('change'));
      setR('wScale', 100); setR('wHeight', 100); setR('wFadeSec', 20);
      wt(1).click(); await sleep(60); setR('wScale', 100); wt(0).click(); await sleep(60);
    }
    add('ui', 'кнопки «Тест» в карточке виджета нет, в предпросмотре есть', !$('#wTest') && !!$('#pvTest'));
    add('ui', 'старого общего выбора выравнивания нет', !$('#wAlignSel'));
    for (let i = 0; i < 40 && $('#wStat').dataset.state === 'checking'; i++) await sleep(250);
    add('ui', 'проверка страницы виджета завершилась; при успехе подпись не показывается', $('#wStat').dataset.state !== 'checking' && ($('#wStat').dataset.state !== 'ok' || $('#wStat').textContent === ''), $('#wStat').dataset.state + ' | ' + $('#wStat').textContent.slice(0, 60));
    add('ui', 'инструкции для OBS под ссылкой нет', !/OBS: Источники/.test($('#tab-widgets').innerText));
    add('ui', 'выбор голоса для подарков и подписок', !!$('#eventVoiceSel') && $('#eventVoiceSel').querySelectorAll('.csel-opt').length >= 3, $('#eventVoiceSel') ? $('#eventVoiceSel').querySelectorAll('.csel-opt').length : 'нет списка');
    add('ui', 'ElevenLabs и Microsoft-каталог убраны', !$('#newProv') && !$('#elKey') && !document.body.innerText.includes('ElevenLabs'));

    // --- кнопка обновления не меняет размер ---
    const ub = $('#btnUpdate');
    ub.style.setProperty('--p', 40); ub.classList.add('dl');
    const bf = getComputedStyle(ub, '::before');
    add('ui', 'кнопка обновления: яркая полоса прогресса под текстом', parseFloat(bf.width) > 0 && parseFloat(bf.width) < ub.getBoundingClientRect().width && /gradient/.test(bf.backgroundImage) && getComputedStyle(ub.firstElementChild).zIndex === '1', bf.width);
    ub.classList.remove('dl'); ub.style.removeProperty('--p');
    const h0 = ub.getBoundingClientRect().height, w0 = ub.getBoundingClientRect().width;
    add('ui', 'кнопка обновления: SVG-иконка вместо символа', !!ub.querySelector('svg') && !/[⟳⬇✓👁]/.test(ub.textContent), ub.textContent);
    const labels = ['Версия актуальна', 'Обновить до 10.20.30', 'Скачиваю… 100%', 'Страница загрузки', 'Проверяю…', 'Проверить обновления', 'Перезапуск…'];
    const bad = labels.filter((l) => { ub.textContent = l; const r = ub.getBoundingClientRect(); return Math.abs(r.height - h0) > 0.5 || Math.abs(r.width - w0) > 0.5; });
    add('ui', 'кнопка обновления не меняет размер', bad.length === 0, 'h=' + h0 + ' w=' + w0 + (bad.length ? ' плохие: ' + bad.join(' | ') : ''));
    ub.innerHTML = '<span>Проверить обновления</span>';

    // --- сеть: голоса Microsoft ---
    for (const b of E.builtin) {
      const t0 = Date.now();
      const r = await window.echo.synth({ text: 'Привет, как у вас дела?', voice: b.voice, rate: 1, pitch: '+0Hz' });
      add('net', 'голос ' + b.name + ' (' + b.voice + ')', r.ok && r.audio.length > 3000, r.ok ? ((Date.now() - t0) + ' мс, base64 ' + r.audio.length) : r.error);
    }
    const tw = Date.now();
    const w2 = await window.echo.synth({ text: 'Всем привет!', voice: 'ru-RU-SvetlanaNeural', rate: 1, pitch: '+0Hz' });
    add('net', 'задержка синтеза короткой фразы до 3 с', w2.ok && Date.now() - tw < 3000, (Date.now() - tw) + ' мс');
    const slow = await window.echo.synth({ text: 'Скорость и тон.', voice: 'ru-RU-SvetlanaNeural', rate: 1.3, pitch: '+10Hz' });
    add('net', 'скорость и тон принимаются', slow.ok, slow.ok ? slow.audio.length : slow.error);
    const cat = await window.echo.voices();
    add('net', 'каталог Microsoft (только русские)', cat.voices.length >= 2 && cat.voices.every((v) => /^ru-/i.test(v.id)), cat.ok + ' / ' + cat.voices.map((v) => v.id).join(','));

    // --- сеть: подключение к несуществующему эфиру ---
    $('.nav[data-tab=live]').click();
    $('#nick').value = 'zz_no_such_live_user_84317';
    $('#btnConnect').click();
    const t0 = Date.now();
    while (Date.now() - t0 < 50000 && !$('#feed .msg.notice')) await sleep(500);
    const noticeEl = $('#feed .msg.notice');
    const alertText = noticeEl ? noticeEl.textContent : '';
    const feedText = $('#feed').innerText;
    add('ui', 'при отсутствии эфира сообщение показано в ленте чата', !!noticeEl, alertText);
    add('ui', 'под кнопкой нет плашки с ошибкой', !$('#alert'));
    add('ui', 'кнопка TikTok вернулась в исходное состояние', $('#btnConnect').textContent === 'Подключить', $('#btnConnect').textContent);
    add('ui', 'ошибка подключения без технического мусора', !/TypeError|invoking remote|undefined|Cannot read|isn.?t online/i.test(alertText + feedText), alertText);
    add('net', 'текст ошибки об эфире по-русски', /не в эфире|эфир не найден/i.test(alertText) && !/Technical|Failed|Room/i.test(alertText), alertText);
    add('ui', 'сообщение об офлайне одно (без дублей)', $$('#feed .msg.notice').length === 1, $$('#feed .msg.notice').length);
    // --- вёрстка ---
    const rr = (el) => el.getBoundingClientRect();
    const f1 = rr($('#nick').closest('.nick-field')), f2 = rr($('#twNick').closest('.nick-field'));
    const b1 = rr($('#btnConnect')), b2 = rr($('#btnTwitch'));
    add('ui', 'поля ников TikTok и Twitch одного размера', Math.abs(f1.width - f2.width) < 1 && Math.abs(f1.height - f2.height) < 1, f1.width + 'x' + f1.height + ' / ' + f2.width + 'x' + f2.height);
    add('ui', 'кнопки TikTok и Twitch одного размера', Math.abs(b1.width - b2.width) < 1 && Math.abs(b1.height - b2.height) < 1, b1.width + 'x' + b1.height + ' / ' + b2.width + 'x' + b2.height);
    add('ui', 'статусы подключения: отдельно TikTok и Twitch', /Статус TikTok/.test($('#connStatus').previousElementSibling.textContent) && /Статус Twitch/.test($('#connTwStatus').previousElementSibling.textContent) && $('#connTwStatus').textContent.length > 0);
    const vtw = $('.vv.tw'), vtwHidden = vtw.hidden; vtw.hidden = false; // счётчик Twitch скрыт, пока Twitch не подключён: на время замера показываем
    add('ui', 'плашка «Зрители сейчас» делится на TikTok и Twitch', !!$('#sViewers') && !!$('#sViewersTw') && $('#sViewers').closest('.vv').classList.contains('tt') && $('#sViewersTw').closest('.vv').classList.contains('tw') && rr($('#sViewersTw')).left > rr($('#sViewers')).left);
    vtw.hidden = vtwHidden;
    { const tpEl = $('.tips'), cnEl = $('#btnConnect').closest('.card'), tp = rr(tpEl), cn = rr(cnEl);
      // «Перед эфиром» показывается всегда (в невысоком окне страница прокручивается)
      add('ui', 'эфир: «Перед эфиром» сверху, «Подключение» под ним', !!(tpEl.compareDocumentPosition(cnEl) & Node.DOCUMENT_POSITION_FOLLOWING) && (tp.height > 0 && tp.bottom <= cn.top + 1 && Math.abs(tp.left - cn.left) <= 1), JSON.stringify([tp.bottom, cn.top].map(Math.round)));
      add('ui', 'раздел называется «Озвучка»', $('.nav[data-tab=voice]').textContent.trim() === 'Озвучка'); }
    add('ui', 'вкладка «Эфир» без прокрутки (в высоком окне; в невысоком прокручивается)', innerHeight < 860 || $('#tab-live').scrollHeight <= $('#tab-live').clientHeight + 1, $('#tab-live').scrollHeight + '/' + $('#tab-live').clientHeight);
    const ca = rr($('#btnClear')), cf = rr($('.feed-card'));
    add('ui', 'кнопка «Очистить» внутри карточки ленты', ca.right <= cf.right && ca.left >= cf.left && ca.bottom <= cf.bottom, JSON.stringify([ca.right, cf.right]));
    $('.nav[data-tab=widgets]').click(); await sleep(400);
    { const fb = rr($('#pvFrame')), bb = rr($('.prev-box'));
      add('ui', 'предпросмотр целиком помещается в своём блоке', fb.left >= bb.left - 1 && fb.right <= bb.right + 1 && fb.top >= bb.top - 1 && fb.bottom <= bb.bottom + 1 && bb.height >= 60, JSON.stringify([fb.width, fb.height, bb.width, bb.height].map(Math.round))); }
    { const wl = rr($('#wCopy').closest('.card')), pv = rr($('#pvFrame').closest('.card')), st = rr($('#wScale').closest('.card'));
      add('ui', 'виджеты: предпросмотр справа от виджетов чата, одинаковой высоты', pv.left >= wl.right - 1 && Math.abs(pv.height - wl.height) <= 1 && Math.abs(pv.top - wl.top) <= 1, JSON.stringify([wl.height, pv.height].map(Math.round)));
      add('ui', 'виджеты: настройки выбранного виджета под верхним рядом', st.top >= Math.max(wl.bottom, pv.bottom) - 1, JSON.stringify([st.top, wl.bottom, pv.bottom].map(Math.round)));
      const lkEl = $('#lCount').closest('.card'), lpEl = $('#lkFrame').closest('.card'), lk = rr(lkEl), lp = rr(lpEl), tl = rr($('#lTest'));
      add('ui', 'топ лайков: настройки и ссылка слева, справа только предпросмотр с кнопкой «Тест»', lkEl.contains($('#lUrl')) && lk.right <= lp.left + 1 && lpEl.contains($('#lTest')) && tl.left >= lp.left && tl.right <= lp.right && lpEl.querySelectorAll('input,select,textarea').length === 0 && lpEl.querySelectorAll('button').length === 1 && Math.abs(lk.height - lp.height) <= 1, JSON.stringify([lk.height, lp.height].map(Math.round)));
    }
    const wc = rr($('#wClear')), wcard = rr($('#wClear').closest('.card'));
    add('ui', 'кнопки виджета не вылезают за карточку', wc.right <= wcard.right && wc.left >= wcard.left, JSON.stringify([wc.right, wcard.right]));
    $('.nav[data-tab=live]').click();
    add('ui', 'студия озвучки на месте', !!$('#btnStudio') && document.querySelectorAll('#chips .chip').length === 4);
    add('ui', 'переключателя голосов зрителей нет', !document.querySelector('[data-k=perViewer]'));

    // --- лента сама возвращается вниз после чтения; стрелка прокрутки кликабельна ---
    { $('.nav[data-tab=live]').click(); await sleep(200);
      const fd = document.getElementById('feed'); E.setFeedReturnMs(400);
      for (let i = 0; i < 40; i++) E.addMsg({ name: 'Тест' + i, text: 'сообщение для проверки прокрутки номер ' + i });
      fd.scrollTop = 0; fd.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      E.addMsg({ name: 'Новый', text: 'пришло во время чтения' });
      const kept = E.feedFromBottom() > 40;
      for (let i = 0; i < 40 && E.feedFromBottom() > 4; i++) await sleep(100);
      add('ui', 'лента: при чтении не сдёргивается вниз, потом сама плавно возвращается', kept && E.feedFromBottom() <= 4, kept + ' / ' + Math.round(E.feedFromBottom()));
      E.setFeedReturnMs(10000); $('#btnClear').click();
      $('.nav[data-tab=voice]').click(); await sleep(500);
      const tab = document.querySelector('.tab.show'), sh = document.getElementById('scrollHint');
      if (sh.classList.contains('on')) { sh.querySelector('.sh-btn').click(); for (let i = 0; i < 40 && tab.scrollHeight - tab.scrollTop - tab.clientHeight > 2; i++) await sleep(100); }
      add('ui', 'стрелка «листать»: клик плавно опускает страницу до конца', tab.scrollHeight - tab.scrollTop - tab.clientHeight <= 2, Math.round(tab.scrollHeight - tab.scrollTop - tab.clientHeight));
      // стрелка реагирует на смену вкладки сразу (раньше — с задержкой до 0,4 с), без мигания
      const hintOk = async (id) => { document.querySelector('.nav[data-tab=' + id + ']').click(); await sleep(70); const tb = document.querySelector('.tab.show'), rest = tb.scrollHeight - tb.scrollTop - tb.clientHeight, on = sh.classList.contains('on'); return (rest > 40 && on) || (rest <= 12 && !on) || (rest > 12 && rest <= 40); };
      const h1 = await hintOk('live'), h2 = await hintOk('voice'), h3 = await hintOk('filters'), h4 = await hintOk('widgets');
      add('ui', 'стрелка «листать»: состояние обновляется сразу при переключении вкладок', h1 && h2 && h3 && h4, [h1, h2, h3, h4].join(','));
      $('.nav[data-tab=live]').click(); }
    // --- проверка обновлений ---
    const up = await window.echo.checkUpdate();
    add('net', 'проверка обновлений', up.ok, JSON.stringify(up).slice(0, 160));
  } catch (e) {
    add('ui', 'исключение в тесте', false, e && e.stack || e);
  }
  add('ui', 'нет ошибок JS в окне', (window.__errors || []).length === 0, (window.__errors || []).join(' | '));
  return R;
})()`;

// Имитация событий TikTok: главный процесс шлёт их окну так же, как это делает библиотека
async function eventTests(win) {
  const R = [];
  const add = (name, ok, detail) => R.push({ group: 'ui', name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const send = (c, p) => win.webContents.send(c, p);
  const q = (js) => win.webContents.executeJavaScript(js, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await q("document.querySelector('.nav[data-tab=live]').click(); window.__echo.S.ttChat = false; window.__echo.S.twChat = false; window.__echo.S.gifts = false; window.__echo.S.follows = false; window.__echo.S.noRepeat = false;");
  send('tt:viewers', { count: 1234 });
  send('tt:like', { count: 3, total: 100 });
  send('tt:like', { count: 2, total: null });
  send('tt:like', { count: 1, total: 0 });
  send('tt:like', { count: 5, total: 50 });
  send('tt:gift', { name: 'Аня', gift: 'Rose', count: 3 });
  send('tt:follow', { name: 'Боря' });
  send('tt:chat', { name: 'Вика', text: 'привет всем', created: null });
  send('tt:chat', { name: 'Пустой', text: '', created: null });
  await wait(400);
  const digits = async (sel) => (await q(`document.querySelector('${sel}').textContent`)).replace(/\D/g, '');
  add('событие: зрители отображаются', (await digits('#sViewers')) === '1234', await digits('#sViewers'));
  add('событие: лайки отображаются и копятся', (await digits('#sLikes')) === '103', await digits('#sLikes'));
  add('событие: подарки считаются', (await digits('#sGifts')) === '3', await digits('#sGifts'));
  add('событие: подписки считаются', (await digits('#sFollows')) === '1', await digits('#sFollows'));
  const feed = await q("document.querySelector('#feed').innerText");
  add('событие: сообщение чата с текстом в ленте', /Вика/.test(feed) && /привет всем/.test(feed), feed.replace(/\n+/g, ' / ').slice(0, 160));
  add('событие: пустое сообщение не попадает в ленту', !/Пустой/.test(feed));
  // после отключения статистика обнуляется
  send('tt:status', { state: 'live', username: 'resettest' });
  send('tt:viewers', { count: 10 }); send('tt:like', { count: 4, total: 4 }); send('tt:gift', { name: 'Я', gift: 'Rose', count: 2 }); send('tt:follow', { name: 'Я' });
  await wait(150);
  const before = [await digits('#sViewers'), await digits('#sLikes'), await digits('#sGifts'), await digits('#sFollows')].join(',');
  send('tt:status', { state: 'offline' });
  await wait(150);
  const afterTxt = [await q("document.querySelector('#sViewers').textContent"), await digits('#sLikes'), await digits('#sGifts'), await digits('#sFollows')].join(',');
  add('отключение: зрители, лайки, подарки и подписки обнуляются', before !== '' && /^\d+,\d+,\d+,\d+$/.test(before) && afterTxt === '—,0,0,0', before + ' → ' + afterTxt);
  // пустой ник: поле подсвечивается
  await q("document.querySelector('#nick').value = ''; document.querySelector('#twNick').value = ''; document.querySelector('#btnConnect').click(); document.querySelector('#btnTwitch').click();");
  await wait(150);
  const errs = await q("['#nick', '#twNick'].map((i) => document.querySelector(i).closest('.nick-field').classList.contains('err')).join()");
  add('подключение без ника: поля TikTok и Twitch подсвечиваются', errs === 'true,true', errs);
  // онлайн Twitch виден, только если Twitch подключён
  const twVis = () => q("document.querySelector('.vv.tw').hidden");
  add('онлайн Twitch скрыт, пока Twitch не подключён', (await twVis()) === true);
  // онлайн Twitch отдельно от TikTok
  send('tt:viewers', { count: 1234 });
  send('tw:viewers', { count: 77 });
  await wait(100);
  add('событие: онлайн Twitch отдельно от TikTok', (await digits('#sViewersTw')) === '77' && (await digits('#sViewers')) === '1234', (await digits('#sViewersTw')) + ' / ' + (await digits('#sViewers')));
  send('tw:viewers', { count: null });
  await wait(100);
  add('событие: нет стрима на Twitch — прочерк', (await q("document.querySelector('#sViewersTw').textContent")) === '—');
  // статус каждой платформы в блоке подключения
  send('tw:status', { state: 'live', channel: 'testchan' });
  await wait(100);
  add('онлайн Twitch показан, когда Twitch подключён', (await twVis()) === false);
  add('событие: статус Twitch «Чат подключён»', (await q("document.querySelector('#connTwStatus').textContent")) === 'Чат подключён' && (await q("document.querySelector('#connTw').textContent")) === '#testchan');
  send('tw:status', { state: 'offline' });
  await wait(100);
  add('событие: после отключения Twitch статус «Не подключено»', (await q("document.querySelector('#connTwStatus').textContent")) === 'Не подключено');
  // озвучка выключена — чат всё равно остаётся в ленте
  await q("document.querySelector('#paused').checked = false; window.__echo.S.ttChat = false; window.__echo.S.twChat = false;");
  const calls0 = await q('window.__echo.voiceCalls');
  send('tt:chat', { name: 'ТТтихо', text: 'сообщение без озвучки', created: null });
  send('tw:chat', { name: 'ТВтихо', text: 'сообщение твича без озвучки', created: null, id: 'tv', avatar: '' });
  await wait(300);
  const feedQ = await q("document.querySelector('#feed').innerText");
  add('озвучка выключена: чат TikTok и Twitch остаётся в ленте', /сообщение без озвучки/.test(feedQ) && /сообщение твича без озвучки/.test(feedQ));
  add('озвучка выключена: сообщения не озвучиваются', (await q('window.__echo.voiceCalls')) === calls0, calls0 + ' → ' + (await q('window.__echo.voiceCalls')));
  await q("window.__echo.S.twChat = true");
  send('tw:chat', { name: 'ТВгромко', text: 'твич с озвучкой', created: null, id: 'tl', avatar: '' });
  await wait(300);
  add('озвучка Twitch включена отдельно от TikTok', (await q('window.__echo.voiceCalls')) === calls0 + 1);
  let resizePrevented = false;
  win.emit('will-resize', { preventDefault: () => { resizePrevented = true; } }, { x: 0, y: 0, width: 1400, height: 900 });
  const [minW, minH] = win.getMinimumSize();
  add('окно: можно растягивать мышью, разворачивать и на весь экран; меньше минимума (около 1060×720) нельзя', !resizePrevented && win.isResizable() && win.isMaximizable() && win.isFullScreenable() && minW >= 1060 && minH >= 720 && minW < 1200 && minH < 850, JSON.stringify([resizePrevented, win.isResizable(), win.isMaximizable(), win.isFullScreenable(), minW, minH])); // минимум считается вместе с рамкой окна, поэтому чуть больше 1060×720
  // вкладка «Настройки» и окно «Закрыть программу?»
  add('ui', 'вкладка «Настройки»: крестик, автозапуск, автообновление', await q("!!document.querySelector('.nav[data-tab=settings]') && !!document.querySelector('#tab-settings #closeModeSel .csel-drop') && !!document.querySelector('#setAutoUpd') && !!document.querySelector('#setAutostart') && !!document.querySelector('#setAutostartHidden')"));
  const autoUpd0 = await q('window.echo.appSettings().then((x) => x.autoUpdate)');
  await q("document.querySelector('#setAutoUpd').click()"); // как пользователь: клик по переключателю, интерфейс и основной процесс обновляются вместе
  await wait(250);
  const autoUpd1 = await q('window.echo.appSettings().then((x) => x.autoUpdate)');
  const uiOff = await q("document.querySelector('#setAutoUpd').checked");
  await q("document.querySelector('#setAutoUpd').click()"); // возвращаем как было
  await wait(250);
  add('настройки: автообновление выключается и сохраняется', autoUpd0 === true && autoUpd1 === false && uiOff === false, JSON.stringify([autoUpd0, autoUpd1, uiOff]));
  send('app:ask-close');
  await wait(250);
  const askShown = await q("!document.querySelector('#closeBack').hidden && /Свернуть в трей/.test(document.querySelector('#closeBack').innerText) && /Закрыть программу/.test(document.querySelector('#closeBack').innerText)");
  await q("document.querySelector('#closeCancel').click()");
  await wait(250);
  add('закрытие: окно с вопросом «свернуть в трей или закрыть» открывается и по «Отмена» закрывается', askShown === true && (await q("document.querySelector('#closeBack').hidden")) === true);
  await q("window.__echo.S.ttChat = false; window.__echo.S.twChat = false");
  const sysEl = await q("(() => { const t = document.querySelector('#feed .msg.sys .t'); if (!t) return null; const c = getComputedStyle(t); return { fs: parseFloat(c.fontSize), br: parseFloat(c.borderTopLeftRadius), line: getComputedStyle(t.parentElement, '::before').content }; })()");
  add('системные сообщения: крупная «таблетка» без линий', sysEl && sysEl.fs >= 13 && sysEl.br >= 12 && (sysEl.line === 'none' || sysEl.line === 'normal'), JSON.stringify(sysEl));
  await q("document.querySelector('#btnClear').click()");
  send('tt:chat', { name: 'Миша', text: 'после очистки', created: null });
  await wait(300);
  const feed2 = await q("document.querySelector('#feed').innerText");
  add('после очистки ленты новые сообщения появляются', /после очистки/.test(feed2), feed2.replace(/\n+/g, ' / ').slice(0, 120));
  // старые сообщения (хвост чата при подключении) не показываются и не озвучиваются, новые — проходят
  await q("window.__echo.since.tiktok = Date.now()");
  send('tt:chat', { name: 'Старый', text: 'сообщение до подключения', created: Date.now() - 120000 });
  send('tt:chat', { name: 'Новый', text: 'сообщение после подключения', created: Date.now() + 500 });
  await wait(300);
  const feed3 = await q("document.querySelector('#feed').innerText");
  add('подключение: старое сообщение пропущено', !/до подключения/.test(feed3), feed3.replace(/\n+/g, ' / ').slice(0, 160));
  add('подключение: новое сообщение показано', /после подключения/.test(feed3));
  await q("window.__echo.since.tiktok = 0");
  // пауза останавливает только ленту: новые сообщения в ленте не появляются, а озвучка идёт по настройкам страницы «Озвучка»
  await q("window.__echo.S.ttChat = false; window.__echo.S.twChat = false; window.__echo.S.noRepeat = false; document.querySelector('#btnClear').click();");
  for (let i = 0; i < 40; i++) send('tt:chat', { name: 'Ф' + i, text: 'заполнение ' + i, created: null });
  await wait(500);
  await q("window.__echo.S.ttChat = true; window.__echo.setPauseMs(900); (() => { const p = document.querySelector('#paused'); p.checked = true; p.dispatchEvent(new Event('change')); })(); document.querySelector('#feed').scrollTop = 0;");
  const callsP = await q('window.__echo.voiceCalls');
  send('tt:chat', { name: 'ПаузаТТ', text: 'сообщение во время паузы', created: null });
  await wait(300);
  const stP = JSON.parse(await q("JSON.stringify({ top: document.querySelector('#feed').scrollTop, lbl: document.querySelector('#pausedLbl').textContent, txt: document.querySelector('#feed').innerText })"));
  add('пауза: сообщение не попадает в ленту', !/во время паузы/.test(stP.txt));
  add('пауза: озвучка продолжает работать (пауза — только для ленты)', (await q('window.__echo.voiceCalls')) > callsP, callsP + ' → ' + (await q('window.__echo.voiceCalls')));
  await q('window.__echo.stopAllVoice()');
  add('пауза: таймера нет', stP.lbl === 'Пауза', stP.lbl);
  await wait(1300);
  add('пауза: остаётся включённой, пока не снимешь', await q("document.querySelector('#paused').checked") === true);
  await q("document.querySelector('#paused').checked = false; document.querySelector('#paused').dispatchEvent(new Event('change'))");
  await q("window.__echo.S.ttChat = false; window.__echo.S.twChat = false");
  // озвучка идёт с голосом своей платформы
  await q("document.querySelector('#paused').checked = false; window.__echo.S.ttVoice = 'b-svetlana'; window.__echo.S.twVoice = 'b-dmitry'");
  const pre = await q("[window.__echo.ttPreset().voice, window.__echo.twPreset().voice].join(',')");
  add('озвучка: у TikTok и Twitch разные голоса', pre === 'ru-RU-SvetlanaNeural,ru-RU-DmitryNeural', pre);
  // интернет: нет связи — обе плашки жёлтые, связь вернулась — обычные
  const pillNet = () => q("[...document.querySelectorAll('#status .pill')].map((p) => p.classList.contains('net')).join()");
  send('net:status', { online: false });
  await wait(150);
  const nOff = await pillNet(), nTxt = await q("document.querySelector('#pillTw .pt').textContent");
  const nDot = await q("getComputedStyle(document.querySelector('#pillTt s')).backgroundColor");
  add('интернет: нет связи — обе плашки жёлтые', nOff === 'true,true' && /Нет интернета/.test(nTxt) && /250, 204, 21/.test(nDot), nOff + ' / ' + nTxt + ' / ' + nDot);
  send('net:status', { online: true });
  await wait(150);
  add('интернет: связь вернулась — плашки обычные', (await pillNet()) === 'false,false', await pillNet());
  add('обновления: автопроверка раз в 6 часов', (await q('window.__echo.UPD_EVERY_MS')) === 21600000);
  // донаты Каспи: приёмник, разбор, виджет и тест-кнопка
  await q("window.__echo.K.voice = false");
  const dj = JSON.parse(await q("window.echo.donateSet({ ...window.__echo.K, enabled: true, token: 'selftesttoken', strict: true }).then((r) => JSON.stringify({ ok: r.ok, running: r.running, port: r.port }))"));
  add('донаты: приёмник уведомлений запускается', dj.ok && dj.running && dj.port >= 7899, JSON.stringify(dj));
  const pj = JSON.parse(await q("window.echo.kaspiProbe().then(JSON.stringify)"));
  add('донаты: пробное уведомление принято и разобрано', pj.ok && pj.accepted, JSON.stringify(pj));
  await wait(300);
  const feedD = await q("document.querySelector('#feed').innerText");
  add('донаты: донат из уведомления появился в ленте', /Тест Т\./.test(feedD) && /₸/.test(feedD), feedD.replace(/\n+/g, ' / ').slice(-120));
  await q("document.querySelector('#btnDonateTest').click()");
  await wait(300);
  const feedT = await q("document.querySelector('#feed').innerText");
  add('донаты: кнопка «Тест доната» работает', /Айдос А\./.test(feedT) && /500/.test(feedT), feedT.replace(/\n+/g, ' / ').slice(-100));
  const logTxt = await q("document.querySelector('#kLog').innerText");
  add('донаты: журнал показывает пришедшее уведомление', /Тест Т\./.test(logTxt), logTxt.replace(/\n+/g, ' / ').slice(0, 100));
  const get = (url, sse) => new Promise((resolve) => {
    let d = '';
    const rq = require('http').get(url, (res) => { res.on('data', (c) => { d += c; if (sse && d.includes('dsettings')) { rq.destroy(); resolve(d); } }); res.on('end', () => resolve(d)); });
    rq.on('error', () => resolve(d));
    setTimeout(() => { rq.destroy(); resolve(d); }, 4000);
  });
  const durl = await q('window.echo.donateUrl()');
  const dpage = await get(durl);
  add('донаты: приложение отдаёт страницу виджета', /addEventListener\('donate'/.test(dpage) && /Донат/.test(dpage), dpage.length);
  const dsse = await get(durl.replace('/donate', '/events'), true);
  add('донаты: виджет получает настройки по SSE', /event: dsettings/.test(dsse) && /"duration":8/.test(dsse), dsse.replace(/\n+/g, ' ').slice(0, 140));
  const dl = JSON.parse(await q('window.echo.donateLink().then(JSON.stringify)'));
  add('донаты: ссылка для OBS ведёт на страницу донатов', dl.ok && /\/jonny-chat-tiktok\/donate\/$/.test(dl.url), dl.url);
  await q("window.echo.donateSet({ ...window.__echo.K, enabled: false })");
  await q("document.querySelector('#paused').checked = false");
  // оверлей чата: включается из приложения, показывает ленту TikTok и Twitch, выключается, окно закрывается
  try {
    const { BrowserWindow } = require('electron');
    const ovWin = () => BrowserWindow.getAllWindows().find((w) => w !== win && !w.isDestroyed());
    add('оверлей: отдельная вкладка с переключателем, кнопками и настройками', await q("['#ovToggle', '#ovTest', '#ovClear', '#ovReset', '#ovOpacity', '#ovLock', '#ovOnTop', '#ovJoins', '#ovEvents', '#ovStats'].every((i) => !!document.querySelector('#tab-overlay ' + i)) && !document.querySelector('#tab-widgets #ovToggle')"));
    const on = await q('window.echo.overlayToggle(true)');
    await wait(1200);
    const w = ovWin();
    add('оверлей: окно открывается из приложения', on.ok === true && on.on === true && !!w, JSON.stringify(on));
    if (w) {
      const qo = (js) => w.webContents.executeJavaScript(js, true);
      add('оверлей: поверх всех окон, без рамки, с понятным именем для OBS', w.isAlwaysOnTop() && /оверлей чата/.test(w.getTitle()), w.getTitle());
      await q('window.echo.overlayTest()');
      await wait(2200);
      const rows = await qo("[...document.querySelectorAll('#feed .row')].map((r) => r.className + '|' + r.innerText.replace(/\\s+/g, ' ')).join(' // ')");
      add('оверлей: лента показывает и TikTok, и Twitch', /tiktok[^|]*\|.*Анна/.test(rows) && /twitch[^|]*\|.*Max/.test(rows), rows.slice(0, 200));
      add('оверлей: подписка и подарок в ленте', /Игорь/.test(rows) && /Роза/.test(rows) && /×5/.test(rows));
      const head = await qo("[document.querySelector('#badge').textContent, !!document.querySelector('#time'), document.querySelectorAll('#stats .st').length].join()");
      add('оверлей: шапка с таймером и счётчики', /^(LIVE|ОФЛАЙН),true,6$/.test(head), head);
      const gear = await qo("[!!document.querySelector('#btnSet'), !!document.querySelector('#stViews'), document.querySelector('#stTw svg path[d^=\"M4 2\"]') === null, getComputedStyle(document.querySelector('#stTw')).color === getComputedStyle(document.querySelector('#stViews')).color].join()");
      add('оверлей: шестерёнка, счётчик просмотров, у Twitch нет логотипа и цвет такой же', gear === 'true,true,true,true', gear);
      await qo("document.querySelector('#btnSet').click()");
      const pop1 = await qo("!document.querySelector('#pop').hidden && ['#sOpacity', '#sOnTop', '#sEvents', '#sJoins', '#sStats', '#btnClear'].every((i) => !!document.querySelector(i))");
      await qo("document.querySelector('#btnSet').click()");
      add('оверлей: шестерёнка открывает настройки', pop1 === true);
      await qo("window.__overlay.addEntry({ platform: 'tiktok', kind: 'join', name: 'Новенький' }, false)");
      const jn = await qo("[...document.querySelectorAll('.row.jn')].map((r) => r.innerText.replace(/\\s+/g, ' ')).join('|')");
      add('оверлей: «ник — теперь с нами» в ленте', /Новенький — теперь с нами/.test(jn), jn);
      // замок: окно нельзя сдвинуть, пока он закрыт; прозрачность убирает только фон
      const bg = () => qo("getComputedStyle(document.querySelector('.panel')).backgroundColor");
      await q('window.echo.overlaySet({ locked: true, opacity: 0 })');
      await wait(400);
      const lk = await qo("[document.body.classList.contains('locked'), getComputedStyle(document.querySelector('.top')).webkitAppRegion, getComputedStyle(document.querySelector('.grip.s')).display].join()");
      add('оверлей: замок блокирует окно (нельзя двигать, ручек растягивания нет)', w.isMovable() === false && lk === 'true,no-drag,none', 'movable=' + w.isMovable() + ' ' + lk);
      const bg0 = await bg();
      const vis = await qo("[getComputedStyle(document.querySelector('.panel')).borderTopColor, ...['.badge', '.time', '.row .nm', '#stats svg'].map((x) => getComputedStyle(document.querySelector(x)).opacity)].join()");
      add('оверлей: при нулевой прозрачности фон почти исчезает, а рамка и текст остаются видны', /rgba\(18, 18, 20, 0\.0[0-9]*\)/.test(bg0) && /rgb\(74, 74, 86\)/.test(vis) && w.getOpacity() === 1, bg0 + ' | ' + vis + ' | opacity ' + w.getOpacity());
      await q('window.echo.overlaySet({ locked: false, opacity: 100 })');
      await wait(400);
      add('оверлей: замок открывается, окно снова двигается', w.isMovable() === true && /rgba\(18, 18, 20, 1\)|rgb\(18, 18, 20\)/.test(await bg()));
      await q("window.echo.overlayClear()");
      await wait(300);
      add('оверлей: «Очистить чат» очищает ленту', (await qo("document.querySelectorAll('#feed .row').length")) === 0);
    }
    await q('window.echo.overlayToggle(false)');
    await wait(700);
    add('оверлей: выключение закрывает окно', !ovWin());
    const st = await q('window.echo.overlayState()');
    add('оверлей: состояние «выключен» после закрытия', st && st.on === false, JSON.stringify(st));
  } catch (err) { add('оверлей: проверка', false, String((err && err.message) || err)); }
  return R;
}

async function run(win, app) {
  const guard = setTimeout(() => finish([{ group: 'ui', name: 'таймаут автотеста', ok: false, detail: '' }]), 200000);
  const finish = (results) => {
    clearTimeout(guard);
    const failedCritical = results.filter((r) => !r.ok && r.group !== 'net');
    const report = { version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, results, criticalFailed: failedCritical.length };
    const txt = JSON.stringify(report, null, 2);
    console.log('SELFTEST_REPORT_BEGIN\n' + txt + '\nSELFTEST_REPORT_END');
    if (outArg) { try { fs.writeFileSync(outArg, txt); } catch (_) {} }
    app.exit(failedCritical.length ? 1 : 0);
  };
  try {
    await new Promise((resolve) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', resolve) : resolve()));
    await new Promise((r) => setTimeout(r, 800));
    const page = await win.webContents.executeJavaScript(PAGE_TEST, true);
    const ctx = { group: 'ui', name: 'меню по правой кнопке в полях ввода (вставка ника)', ok: win.webContents.listenerCount('context-menu') > 0, detail: '' };
    finish([...mainTests(), ...page, ...(await eventTests(win)), ctx]);
  } catch (e) {
    finish([{ group: 'ui', name: 'автотест не смог запуститься', ok: false, detail: String(e && e.stack || e) }]);
  }
}

module.exports = { run, PAGE_TEST };
