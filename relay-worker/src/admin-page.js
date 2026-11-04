// Страница администратора лицензий (открывается по адресу <сервер>/admin). Секрет вводится на странице и хранится только в sessionStorage.
// Весь пользовательский текст (ключи, заметки) выводится через textContent, поэтому он не может внедрить разметку.
// Внимание: файл — один большой шаблонный литерал, внутри нельзя использовать обратные кавычки и подстановки с долларом и фигурной скобкой.
export const ADMIN_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Лицензии ЭхоЧат LIVE</title>
<style>
:root{--bg:#0a0a11;--panel:rgba(255,255,255,.045);--panel2:rgba(255,255,255,.08);--line:rgba(255,255,255,.1);--text:#ecebf5;--muted:#8c8aa3;--a1:#8b5cf6;--a2:#ec4899;--a3:#22d3ee;--ok:#34d399;--bad:#f87171;--warn:#fbbf24;--grad:linear-gradient(135deg,#8b5cf6,#ec4899);color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--text);font:14px/1.5 "Segoe UI Variable","Segoe UI",system-ui,-apple-system,sans-serif;min-height:100vh;
background-image:radial-gradient(900px 500px at -10% -10%,rgba(139,92,246,.22),transparent 60%),radial-gradient(800px 500px at 110% 0,rgba(236,72,153,.14),transparent 60%)}
button{font:inherit;color:inherit;cursor:pointer}
.hide{display:none!important}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:1100px;margin:0 auto;padding:24px 24px 8px}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:42px;height:42px;border-radius:13px;background:var(--grad);display:grid;place-items:center;box-shadow:0 10px 28px rgba(139,92,246,.4)}
.logo svg{width:22px;height:22px}
.brand b{display:block;font-size:17px;line-height:1.2}.brand small{color:var(--muted);font-size:12.5px}
.wrap{max-width:1100px;margin:0 auto;padding:14px 24px 56px}
.card{padding:22px;border-radius:18px;background:var(--panel);border:1px solid var(--line);backdrop-filter:blur(10px);margin-bottom:16px}
.card h2{font-size:17px;margin-bottom:3px}
.hint{color:var(--muted);font-size:13px;margin-bottom:18px}
label{display:block;color:var(--muted);font-size:12.5px;margin:0 0 7px}
.in{width:100%;padding:11px 13px;border-radius:12px;border:1px solid var(--line);background:rgba(0,0,0,.32);color:var(--text);font:inherit;outline:none;transition:.15s}
.in:focus{border-color:rgba(139,92,246,.8);box-shadow:0 0 0 3px rgba(139,92,246,.2)}
.in::placeholder{color:#6c6a84}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:12px;padding:11px 20px;font-weight:600;font-size:14px;color:#fff;background:var(--grad);box-shadow:0 8px 22px rgba(139,92,246,.28);transition:.15s}
.btn:hover{filter:brightness(1.1);transform:translateY(-1px)}
.btn:active{transform:none}
.btn.ghost{background:var(--panel);border:1px solid var(--line);box-shadow:none;font-weight:500}
.btn.ghost:hover{background:var(--panel2)}
.btn.danger{background:linear-gradient(135deg,#ef4444,#be123c);box-shadow:0 8px 22px rgba(239,68,68,.25)}
.btn.sm{padding:7px 12px;font-size:13px;border-radius:10px}
.btn.icon{padding:7px 9px}
.btn:focus-visible,.chip:focus-visible,.mi:focus-visible,.seg button:focus-visible{outline:2px solid var(--a3);outline-offset:2px}
.ico{display:inline-flex;width:16px;height:16px}.ico svg{width:100%;height:100%}

.login{max-width:420px;margin:9vh auto 0;text-align:center}
.login .lock{width:54px;height:54px;border-radius:16px;margin:0 auto 14px;background:var(--grad);display:grid;place-items:center;box-shadow:0 12px 32px rgba(139,92,246,.4)}
.login .lock svg{width:26px;height:26px}
.login .in{text-align:center;margin-bottom:12px}
.login .btn{width:100%}
.lmsg{min-height:20px;margin-top:12px;color:var(--bad);font-size:13px}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.stat{padding:16px 18px;border-radius:16px;background:var(--panel);border:1px solid var(--line)}
.stat b{display:block;font-size:30px;line-height:1.1;font-weight:700}
.stat span{color:var(--muted);font-size:12.5px}
.stat.ok b{color:var(--ok)}.stat.warn b{color:var(--warn)}.stat.bad b{color:var(--bad)}

.form{display:grid;grid-template-columns:1fr 1fr;gap:20px 24px;align-items:start}
.full{grid-column:1/-1}
.seg{display:inline-flex;padding:4px;border-radius:13px;background:rgba(0,0,0,.32);border:1px solid var(--line)}
.seg button{border:0;background:transparent;padding:9px 18px;border-radius:10px;color:var(--muted);font-weight:600;transition:.15s}
.seg button.on{background:var(--grad);color:#fff;box-shadow:0 6px 18px rgba(139,92,246,.35)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;border-radius:99px;border:1px solid var(--line);background:var(--panel);color:var(--text);font-size:13px;transition:.15s}
.chip:hover{background:var(--panel2)}
.chip.on{border-color:rgba(139,92,246,.85);background:rgba(139,92,246,.22)}
.chip .cnt{color:var(--muted);font-size:12px}.chip.on .cnt{color:#d8ccff}
.days{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.days .in{width:96px;text-align:center}
.step{display:inline-flex;align-items:stretch;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:rgba(0,0,0,.32)}
.step button{width:42px;border:0;background:var(--panel);font-size:18px;line-height:1}
.step button:hover{background:var(--panel2)}
.step input{width:60px;text-align:center;border:0;background:transparent;color:var(--text);font:inherit;font-weight:600;outline:none;-moz-appearance:textfield}
.step input::-webkit-outer-spin-button,.step input::-webkit-inner-spin-button{-webkit-appearance:none}
.sub2{color:var(--muted);font-size:12.5px;margin-top:7px}
.created{margin-top:18px;padding:16px 18px;border-radius:14px;border:1px dashed rgba(139,92,246,.7);background:rgba(139,92,246,.08);display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.created .k{font:700 19px Consolas,"Cascadia Mono",monospace;letter-spacing:.8px;user-select:all;word-break:break-all}
.created small{display:block;color:var(--ok);font-size:12.5px;margin-bottom:4px}

.tools{display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:16px}
.search{position:relative;flex:1;min-width:220px;max-width:360px}
.search .sico{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--muted);display:flex;pointer-events:none}
.search .in{padding-left:38px}
.lic{position:relative;display:grid;grid-template-columns:1fr auto;gap:14px;padding:16px 18px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.03);margin-bottom:10px;transition:.15s}
.lic:hover{border-color:rgba(139,92,246,.45);background:rgba(255,255,255,.05)}
.lic.dim{opacity:.72}
.lk{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:9px}
.lk .k{font:600 15.5px Consolas,"Cascadia Mono",monospace;letter-spacing:.6px;user-select:all}
.tag{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid var(--line);color:var(--muted)}
.tag:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.tag.pro{color:#d8ccff;border-color:rgba(139,92,246,.6);background:rgba(139,92,246,.18)}.tag.pro:before{display:none}
.tag.life{color:#fff;border:0;background:var(--grad)}.tag.life:before{display:none}
.tag.ok{color:var(--ok);border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.08)}
.tag.warn{color:var(--warn);border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.08)}
.tag.bad{color:var(--bad);border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.08)}
.meta{display:flex;gap:6px 24px;flex-wrap:wrap;color:var(--muted);font-size:13px}
.meta b{color:var(--text);font-weight:600}
.meta .dv{background:none;border:0;padding:0;color:var(--muted);font-size:13px;text-align:left}
.meta .dv.can{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
.meta .dv.can:hover{color:var(--text)}
.dots{display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle}
.dots i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.18)}.dots i.f{background:var(--a1)}
.lnote{margin-top:9px;font-size:13.5px;color:#d4d2e6}
.devl{margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.25);font-size:12.5px;color:var(--muted);display:grid;gap:4px}
.devl b{font-family:Consolas,monospace;color:var(--text);font-weight:600}
.acts{display:flex;gap:8px;align-items:flex-start;position:relative}
.mwrap{position:relative}
.menu{position:absolute;right:0;top:calc(100% + 6px);min-width:220px;padding:6px;border-radius:13px;background:#171724;border:1px solid var(--line);box-shadow:0 20px 54px rgba(0,0,0,.65);z-index:30}
.mi{display:block;width:100%;text-align:left;border:0;background:transparent;padding:9px 12px;border-radius:9px;font-size:13.5px}
.mi:hover{background:var(--panel2)}.mi.bad{color:#fca5a5}
.msep{height:1px;background:var(--line);margin:5px 4px}
.empty{padding:34px 10px;text-align:center;color:var(--muted)}
.empty b{display:block;color:var(--text);font-size:15px;margin-bottom:4px}

.modal{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:16px;background:rgba(5,5,10,.72);backdrop-filter:blur(5px)}
.dlg{width:min(430px,100%);padding:24px;border-radius:20px;background:linear-gradient(160deg,rgba(139,92,246,.18),rgba(236,72,153,.08)),#15151f;border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 90px rgba(0,0,0,.6)}
.dlg h3{font-size:18px;margin-bottom:6px}
.dtext{color:var(--muted);font-size:13.5px;margin-bottom:16px;word-break:break-word}
.dlg .chips{margin-bottom:14px}
.dbtns{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}
#toasts{position:fixed;right:18px;bottom:18px;display:grid;gap:8px;z-index:60;max-width:calc(100vw - 36px)}
.toast{padding:11px 16px;border-radius:12px;background:#171724;border:1px solid rgba(52,211,153,.5);color:var(--text);box-shadow:0 14px 40px rgba(0,0,0,.55);animation:up .25s}
.toast.bad{border-color:rgba(248,113,113,.6)}
@keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media(max-width:720px){
.top,.wrap{padding-left:14px;padding-right:14px}.card{padding:18px}
.form{grid-template-columns:1fr}.lic{grid-template-columns:1fr}.acts{flex-wrap:wrap}
.search{max-width:none}.stat b{font-size:26px}
}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body>
<header class="top">
<div class="brand"><span class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M4 10v4M8 6v12M12 3v18M16 8v8M20 10.5v3"/></svg></span><div><b>ЭхоЧат LIVE</b><small>Управление лицензиями</small></div></div>
<button class="btn ghost sm hide" id="logout" type="button">Выйти</button>
</header>
<main class="wrap">

<section class="card login" id="login">
<div class="lock"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>
<h2>Вход в админку</h2><p class="hint">Введите секрет ADMIN_TOKEN из настроек Cloudflare</p>
<input class="in" id="tok" type="password" autocomplete="off" spellcheck="false" placeholder="Секрет">
<button class="btn" id="go" type="button">Войти</button>
<div class="lmsg" id="loginMsg"></div>
</section>

<div id="app" class="hide">
<div class="stats" id="stats"></div>

<section class="card">
<h2>Выдать ключ</h2><p class="hint">Создайте ключ и отправьте его покупателю. Срок Pro отсчитывается с момента активации.</p>
<div class="form">
<div><label>Тариф</label><div class="seg" id="planSeg"><button type="button" data-plan="pro" class="on">Pro на срок</button><button type="button" data-plan="lifetime">Lifetime навсегда</button></div></div>
<div><label>Устройств на ключ</label><div class="step"><button type="button" id="mdMinus" aria-label="Меньше">−</button><input id="md" type="number" min="1" max="50" value="2"><button type="button" id="mdPlus" aria-label="Больше">+</button></div><div class="sub2">на скольких компьютерах можно использовать</div></div>
<div class="full" id="daysBox"><label>Срок Pro</label><div class="days"><div class="chips" id="dayChips"></div><input class="in" id="days" type="number" min="1" max="3650" value="30" aria-label="Свой срок в днях"><span class="sub2" style="margin:0">дней с активации</span></div></div>
<div class="full"><label>Заметка</label><input class="in" id="note" maxlength="200" placeholder="Кому выдан, например: Айдос, перевод 02.11"></div>
<div class="full"><button class="btn" id="create" type="button">Создать ключ</button></div>
</div>
<div class="created hide" id="newBox"><div><small>Ключ создан и скопирован в буфер обмена</small><div class="k" id="newKey"></div></div><button class="btn ghost" id="newCopy" type="button">Скопировать ещё раз</button></div>
</section>

<section class="card">
<h2>Ключи</h2><p class="hint" id="listHint"></p>
<div class="tools"><div class="chips" id="filters"></div><div class="search"><span class="sico" id="searchIco"></span><input class="in" id="search" type="search" placeholder="Поиск по ключу или заметке" autocomplete="off"></div></div>
<div id="list"></div>
</section>
</div>
</main>
<div class="modal hide" id="modal"><div class="dlg" id="dlg" role="dialog" aria-modal="true"></div></div>
<div id="toasts"></div>
<script>
var $=function(i){return document.getElementById(i)};
var tok=sessionStorage.getItem('adm')||'';
var data=null,filter='all',query='',plan='pro';
var ICONS={
 copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
 more:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
 search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
};
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function ico(n){var s=el('span','ico');s.innerHTML=ICONS[n];return s}
function api(path,body){return fetch('/admin/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(body||{})}).then(function(r){return r.json().then(function(j){j._status=r.status;return j})})}
function fmt(t){return t?new Date(t).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}):'—'}
function left(t){return Math.max(0,Math.ceil((t-Date.now())/86400000))}
function plural(n,a,b,c){var m=n%100,k=n%10;if(m>10&&m<20)return c;if(k===1)return a;if(k>1&&k<5)return b;return c}
function dn(n){return n+' '+plural(n,'день','дня','дней')}
function copy(t){try{var p=navigator.clipboard&&navigator.clipboard.writeText(t);if(p&&p.catch)p.catch(function(){})}catch(e){}}
function toast(t,bad){var b=el('div','toast'+(bad?' bad':''),t);$('toasts').appendChild(b);setTimeout(function(){b.remove()},3200)}
function statusOf(l){
 if(l.revoked)return 'revoked';
 if(l.plan!=='lifetime'&&l.expiresAt&&Date.now()>l.expiresAt)return 'expired';
 if(!l.activatedAt)return 'new';
 return 'active'}
function run(path,body,okMsg){return api(path,body).then(function(j){if(j.ok){toast(okMsg||'Готово');load()}else toast(j.message||j.error||'Ошибка',true)}).catch(function(){toast('Нет связи с сервером',true)})}

/* окно запроса вместо prompt и confirm */
function ask(o){
 return new Promise(function(resolve){
  var m=$('modal'),box=$('dlg'),inp=null;box.textContent='';
  box.appendChild(el('h3',null,o.title));
  if(o.text)box.appendChild(el('p','dtext',o.text));
  if(o.input){
   if(o.chips){var cr=el('div','chips');o.chips.forEach(function(v){var c=el('button','chip',v+' дн.');c.type='button';c.onclick=function(){inp.value=v;inp.focus()};cr.appendChild(c)});box.appendChild(cr)}
   box.appendChild(el('label',null,o.input.label));
   inp=el('input','in');inp.type=o.input.type||'text';inp.value=o.input.value==null?'':o.input.value;
   if(o.input.min!=null)inp.min=o.input.min;if(o.input.max!=null)inp.max=o.input.max;if(o.input.maxLength)inp.maxLength=o.input.maxLength;
   box.appendChild(inp)}
  var btns=el('div','dbtns'),no=el('button','btn ghost','Отмена'),yes=el('button','btn'+(o.danger?' danger':''),o.ok||'Готово');
  no.type=yes.type='button';btns.appendChild(no);btns.appendChild(yes);box.appendChild(btns);
  function close(v){m.classList.add('hide');document.removeEventListener('keydown',key);resolve(v)}
  function key(e){if(e.key==='Escape')close(null);else if(e.key==='Enter'&&inp&&document.activeElement===inp)yes.click()}
  no.onclick=function(){close(null)};yes.onclick=function(){close(inp?inp.value:true)};
  m.onclick=function(e){if(e.target===m)close(null)};
  document.addEventListener('keydown',key);
  m.classList.remove('hide');if(inp){inp.focus();inp.select()}else yes.focus()})}

function closeMenus(){document.querySelectorAll('.menu').forEach(function(m){m.classList.add('hide')})}
document.addEventListener('click',closeMenus);

function mi(menu,label,cls,fn){var b=el('button','mi'+(cls?' '+cls:''),label);b.type='button';b.onclick=function(e){e.stopPropagation();closeMenus();fn()};menu.appendChild(b)}

function card(l){
 var s=statusOf(l),life=l.plan==='lifetime';
 var c=el('div','lic'+(s==='revoked'||s==='expired'?' dim':''));
 var main=el('div');
 var lk=el('div','lk');lk.appendChild(el('span','k',l.key));
 lk.appendChild(el('span','tag '+(life?'life':'pro'),life?'Lifetime':'Pro'));
 var stText={active:['ok','Активен'],'new':['warn','Ждёт активации'],expired:['bad','Истёк'],revoked:['bad','Отозван']}[s];
 lk.appendChild(el('span','tag '+stText[0],stText[1]));
 main.appendChild(lk);
 var meta=el('div','meta');
 var term=el('span');term.appendChild(document.createTextNode('Срок: '));
 var tv;
 if(life)tv='бессрочно';
 else if(l.expiresAt)tv=Date.now()>l.expiresAt?'истёк '+fmt(l.expiresAt):'до '+fmt(l.expiresAt)+' (осталось '+dn(left(l.expiresAt))+')';
 else tv=dn(l.days||0)+' с активации';
 term.appendChild(el('b',null,tv));meta.appendChild(term);
 var dv=el('button','dv'+(l.devices.length?' can':''));dv.type='button';
 dv.appendChild(document.createTextNode('Устройства: '));dv.appendChild(el('b',null,l.devices.length+' из '+l.maxDevices));
 if(l.maxDevices<=8){var dots=el('span','dots');for(var i=0;i<l.maxDevices;i++)dots.appendChild(el('i',i<l.devices.length?'f':''));dv.appendChild(dots)}
 meta.appendChild(dv);
 var cr=el('span');cr.appendChild(document.createTextNode('Создан: '));cr.appendChild(el('b',null,fmt(l.createdAt)));meta.appendChild(cr);
 if(l.activatedAt){var ac=el('span');ac.appendChild(document.createTextNode('Активирован: '));ac.appendChild(el('b',null,fmt(l.activatedAt)));meta.appendChild(ac)}
 main.appendChild(meta);
 if(l.note)main.appendChild(el('div','lnote',l.note));
 var dl=el('div','devl hide');
 l.devices.forEach(function(d){var r=el('div');r.appendChild(document.createTextNode('Установка '));r.appendChild(el('b',null,String(d.iid||'').slice(0,8).toUpperCase()));r.appendChild(document.createTextNode(' · привязана '+fmt(d.at)));dl.appendChild(r)});
 main.appendChild(dl);
 if(l.devices.length)dv.onclick=function(){dl.classList.toggle('hide')};
 c.appendChild(main);

 var acts=el('div','acts');
 var cp=el('button','btn ghost sm');cp.type='button';cp.appendChild(ico('copy'));cp.appendChild(document.createTextNode('Копировать'));
 cp.onclick=function(){copy(l.key);toast('Ключ скопирован')};acts.appendChild(cp);
 if(!life){var ex=el('button','btn ghost sm','Продлить');ex.type='button';ex.onclick=function(){
  ask({title:'Продлить ключ',text:l.key,chips:[30,90,180,365],input:{type:'number',label:'На сколько дней продлить',value:30,min:1,max:3650},ok:'Продлить'}).then(function(v){if(v)run('extend',{key:l.key,days:Number(v)},'Срок продлён')})};acts.appendChild(ex)}
 var w=el('div','mwrap'),more=el('button','btn ghost sm icon');more.type='button';more.setAttribute('aria-label','Другие действия');more.appendChild(ico('more'));
 var menu=el('div','menu hide');
 mi(menu,'Изменить заметку','',function(){ask({title:'Заметка',text:l.key,input:{type:'text',label:'Кому выдан ключ',value:l.note||'',maxLength:200},ok:'Сохранить'}).then(function(v){if(v!==null)run('note',{key:l.key,note:v},'Заметка сохранена')})});
 mi(menu,'Лимит устройств','',function(){ask({title:'Лимит устройств',text:l.key,input:{type:'number',label:'Максимум устройств для ключа',value:l.maxDevices,min:1,max:50},ok:'Сохранить'}).then(function(v){if(v)run('devices-max',{key:l.key,maxDevices:Number(v)},'Лимит изменён')})});
 mi(menu,'Сбросить устройства','',function(){ask({title:'Сбросить устройства?',text:'От ключа отвяжутся все компьютеры, его можно будет ввести заново.',ok:'Сбросить'}).then(function(v){if(v)run('devices-reset',{key:l.key},'Устройства сброшены')})});
 menu.appendChild(el('div','msep'));
 if(l.revoked)mi(menu,'Вернуть ключ','',function(){run('revoke',{key:l.key,revoked:false},'Ключ возвращён')});
 else mi(menu,'Отозвать ключ','bad',function(){ask({title:'Отозвать ключ?',text:'Ключ перестанет работать при ближайшей проверке. Позже его можно вернуть.',ok:'Отозвать',danger:true}).then(function(v){if(v)run('revoke',{key:l.key,revoked:true},'Ключ отозван')})});
 mi(menu,'Удалить навсегда','bad',function(){ask({title:'Удалить ключ?',text:'Ключ будет стёрт без возможности восстановления.',ok:'Удалить',danger:true}).then(function(v){if(v)run('delete',{key:l.key},'Ключ удалён')})});
 more.onclick=function(e){e.stopPropagation();var open=!menu.classList.contains('hide');closeMenus();if(!open)menu.classList.remove('hide')};
 w.appendChild(more);w.appendChild(menu);acts.appendChild(w);c.appendChild(acts);
 return c}

function norm(s){return String(s||'').toLowerCase().split('-').join('').split(' ').join('')}
function render(){
 if(!data)return;
 var L=data.licenses,cnt={all:L.length,active:0,'new':0,ended:0};
 L.forEach(function(l){var s=statusOf(l);if(s==='active')cnt.active++;else if(s==='new')cnt['new']++;else cnt.ended++});
 var st=$('stats');st.textContent='';
 [['Всего ключей',cnt.all,''],['Активны',cnt.active,'ok'],['Ждут активации',cnt['new'],'warn'],['Истекли или отозваны',cnt.ended,'bad'],['Установок приложения',data.installs,'']].forEach(function(x){
  var d=el('div','stat '+x[2]);d.appendChild(el('b',null,String(x[1])));d.appendChild(el('span',null,x[0]));st.appendChild(d)});
 var fl=$('filters');fl.textContent='';
 [['all','Все'],['active','Активные'],['new','Не активированы'],['ended','Истекли / отозваны']].forEach(function(f){
  var b=el('button','chip'+(filter===f[0]?' on':''),f[1]+' ');b.type='button';b.appendChild(el('span','cnt',String(cnt[f[0]])));
  b.onclick=function(){filter=f[0];render()};fl.appendChild(b)});
 var q=norm(query);
 var shown=L.filter(function(l){
  var s=statusOf(l);
  if(filter==='active'&&s!=='active')return false;
  if(filter==='new'&&s!=='new')return false;
  if(filter==='ended'&&s!=='expired'&&s!=='revoked')return false;
  if(q&&norm(l.key+' '+(l.note||'')).indexOf(q)<0)return false;
  return true});
 $('listHint').textContent=L.length?'Показано '+shown.length+' из '+L.length+'. Нажмите на «Устройства», чтобы увидеть привязанные установки.':'';
 var list=$('list');list.textContent='';
 if(!shown.length){var e=el('div','empty');e.appendChild(el('b',null,L.length?'Ничего не найдено':'Ключей пока нет'));e.appendChild(el('span',null,L.length?'Измените поиск или фильтр':'Создайте первый ключ в блоке выше'));list.appendChild(e);return}
 shown.forEach(function(l){list.appendChild(card(l))})}

function load(){
 return api('list').then(function(j){
  if(j._status===401){sessionStorage.removeItem('adm');tok='';$('login').classList.remove('hide');$('app').classList.add('hide');$('logout').classList.add('hide');$('loginMsg').textContent='Неверный секрет';return}
  if(!j.ok){$('loginMsg').textContent=j.message||j.error||'Ошибка';return}
  $('login').classList.add('hide');$('app').classList.remove('hide');$('logout').classList.remove('hide');
  data=j;render();
 }).catch(function(){$('loginMsg').textContent='Нет связи с сервером'})}

/* форма выдачи ключа */
var DAYS=[30,90,180,365];
function setDays(v){$('days').value=v;[].forEach.call($('dayChips').children,function(b){b.classList.toggle('on',Number(b.dataset.d)===Number(v))})}
DAYS.forEach(function(d){var b=el('button','chip',dn(d));b.type='button';b.dataset.d=d;b.onclick=function(){setDays(d)};$('dayChips').appendChild(b)});
$('days').oninput=function(){setDays($('days').value)};
setDays(30);
[].forEach.call($('planSeg').children,function(b){b.onclick=function(){plan=b.dataset.plan;[].forEach.call($('planSeg').children,function(x){x.classList.toggle('on',x===b)});$('daysBox').classList.toggle('hide',plan==='lifetime')}});
function dev(n){var v=Math.max(1,Math.min(50,Math.round(Number($('md').value)||1)+n));$('md').value=v}
$('mdMinus').onclick=function(){dev(-1)};$('mdPlus').onclick=function(){dev(1)};
$('create').onclick=function(){
 var d=Number($('days').value);
 if(plan!=='lifetime'&&!(d>=1&&d<=3650)){toast('Срок: от 1 до 3650 дней',true);return}
 api('create',{plan:plan,days:d,maxDevices:Number($('md').value),note:$('note').value}).then(function(j){
  if(!j.ok){toast(j.message||j.error||'Ошибка',true);return}
  var k=j.license.key;$('newKey').textContent=k;$('newBox').classList.remove('hide');$('newCopy').onclick=function(){copy(k);toast('Ключ скопирован')};
  copy(k);toast('Ключ создан и скопирован');$('note').value='';load()
 }).catch(function(){toast('Нет связи с сервером',true)})};

/* вход и выход */
$('go').onclick=function(){tok=$('tok').value.trim();if(!tok)return;sessionStorage.setItem('adm',tok);$('loginMsg').textContent='';load()};
$('tok').onkeydown=function(e){if(e.key==='Enter')$('go').click()};
$('logout').onclick=function(){sessionStorage.removeItem('adm');tok='';data=null;$('tok').value='';$('app').classList.add('hide');$('logout').classList.add('hide');$('login').classList.remove('hide');$('newBox').classList.add('hide')};
$('search').oninput=function(){query=$('search').value;render()};
$('searchIco').appendChild(ico('search'));
if(tok)load();
</script></body></html>`;
