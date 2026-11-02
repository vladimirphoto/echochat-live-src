// Страница администратора лицензий (открывается по адресу <сервер>/admin). Секрет вводится на странице и хранится только в sessionStorage.
// Весь вывод строится через textContent, поэтому текст из заметок и ключей не может внедрить разметку.
export const ADMIN_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ЭхоЧат — лицензии</title>
<style>
:root{--bg:#0a0a11;--panel:rgba(255,255,255,.04);--line:rgba(255,255,255,.1);--text:#ecebf5;--muted:#8c8aa3;--a1:#8b5cf6;--a2:#ec4899;--ok:#34d399;--bad:#f87171}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:14px/1.45 "Segoe UI",system-ui,sans-serif;padding:28px;min-height:100vh}
body:before{content:"";position:fixed;width:520px;height:520px;border-radius:50%;filter:blur(130px);opacity:.25;background:var(--a1);top:-180px;left:-120px;pointer-events:none}
.wrap{position:relative;max-width:1100px;margin:0 auto}
h1{font-size:24px;margin-bottom:4px}p.sub{color:var(--muted);margin-bottom:22px}
.card{padding:18px;border-radius:16px;background:var(--panel);border:1px solid var(--line);margin-bottom:16px}
h2{font-size:15px;margin-bottom:12px}
label{display:block;color:var(--muted);font-size:12px;margin:0 0 5px}
input,select{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--text);font:inherit;outline:none}
input:focus,select:focus{border-color:rgba(139,92,246,.7)}
select option{background:#15151f}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;align-items:end}
button{cursor:pointer;border:0;border-radius:10px;padding:10px 16px;font:600 13px inherit;color:#fff;background:linear-gradient(135deg,var(--a1),var(--a2))}
button.ghost{background:var(--panel);border:1px solid var(--line);font-weight:500;padding:6px 10px;font-size:12px}
button.ghost:hover{background:rgba(255,255,255,.1)}button.danger{color:#fca5a5}
table{width:100%;border-collapse:collapse}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.6px;text-align:left;padding:8px 10px}
td{padding:10px;border-top:1px solid var(--line);vertical-align:top}
.key{font-family:Consolas,monospace;font-size:13px;cursor:pointer;user-select:all}
.tag{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;border:1px solid var(--line)}
.tag.ok{color:var(--ok);border-color:rgba(52,211,153,.4)}.tag.bad{color:var(--bad);border-color:rgba(248,113,113,.4)}.tag.mut{color:var(--muted)}
.acts{display:flex;flex-wrap:wrap;gap:6px}.muted{color:var(--muted)}.msg{margin-top:10px;min-height:20px}
.new{margin-top:12px;padding:12px;border-radius:12px;border:1px dashed rgba(139,92,246,.6);display:none}
.hide{display:none}
</style></head><body><div class="wrap">
<h1>Лицензии ЭхоЧат LIVE</h1><p class="sub" id="sub">Управление ключами, сроками и устройствами</p>

<div class="card" id="login"><h2>Вход</h2>
<label>Секрет ADMIN_TOKEN (задан в Cloudflare)</label>
<div class="row"><input id="tok" type="password" autocomplete="off" spellcheck="false"><button id="go">Войти</button></div>
<div class="msg muted" id="loginMsg"></div></div>

<div id="app" class="hide">
<div class="card"><h2>Выдать ключ</h2>
<div class="row">
<div><label>Тариф</label><select id="plan"><option value="pro">Pro (на срок)</option><option value="lifetime">Lifetime (бессрочно)</option></select></div>
<div id="daysBox"><label>Дней</label><input id="days" type="number" min="1" max="3650" value="30"></div>
<div><label>Устройств</label><input id="md" type="number" min="1" max="50" value="2"></div>
<div style="grid-column:span 2"><label>Заметка (кому выдан)</label><input id="note" maxlength="200" placeholder="например: Айдос, перевод 02.11"></div>
<div><button id="create">Создать ключ</button></div></div>
<div class="new" id="newBox"><div class="muted">Новый ключ (нажмите — скопируется):</div><div class="key" id="newKey" style="font-size:18px;margin-top:6px"></div></div>
<div class="msg" id="msg"></div></div>

<div class="card"><h2>Ключи <span class="muted" id="stat"></span></h2>
<div style="overflow:auto"><table><thead><tr><th>Ключ</th><th>Тариф</th><th>Статус</th><th>Срок</th><th>Устройства</th><th>Заметка</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
<div class="muted" id="empty" style="padding:14px 10px">Пока нет ключей</div></div>

<div class="card"><h2>Публичный ключ подписи</h2><div class="muted" style="margin-bottom:8px">Положите эту строку в assets/license-pub.txt, чтобы приложение проверяло подпись по закреплённому ключу.</div><div class="key" id="pub"></div></div>
</div></div>
<script>
var $=function(i){return document.getElementById(i)};
var tok=sessionStorage.getItem('adm')||'';
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function api(path,body){return fetch('/admin/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify(body||{})}).then(function(r){return r.json().then(function(j){j._status=r.status;return j})})}
function fmt(t){return t?new Date(t).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}):'—'}
function say(t,bad){var m=$('msg');m.textContent=t;m.style.color=bad?'var(--bad)':'var(--ok)'}
function copy(t){try{navigator.clipboard.writeText(t)}catch(e){}}
function act(label,cls,fn){var b=el('button','ghost '+(cls||''),label);b.onclick=fn;return b}
function run(path,body,okMsg){return api(path,body).then(function(j){if(j.ok){say(okMsg||'Готово');load()}else say(j.message||j.error||'Ошибка',true)})}

function row(l){
 var tr=el('tr');var now=Date.now();
 var c=el('td');var k=el('div','key',l.key);k.title='Нажмите, чтобы скопировать';k.onclick=function(){copy(l.key);say('Ключ скопирован')};c.appendChild(k);tr.appendChild(c);
 tr.appendChild(el('td',null,l.plan==='lifetime'?'Lifetime':'Pro'));
 var st=el('td');var tag;
 if(l.revoked)tag=el('span','tag bad','отозван');
 else if(l.plan!=='lifetime'&&l.expiresAt&&now>l.expiresAt)tag=el('span','tag bad','истёк');
 else if(!l.activatedAt)tag=el('span','tag mut','не активирован');
 else tag=el('span','tag ok','активен');
 st.appendChild(tag);tr.appendChild(st);
 var term=l.plan==='lifetime'?'бессрочно':(l.expiresAt?'до '+fmt(l.expiresAt):l.days+' дн. с активации');
 tr.appendChild(el('td',null,term));
 tr.appendChild(el('td',null,l.devices.length+' из '+l.maxDevices));
 tr.appendChild(el('td',null,l.note||''));
 var a=el('td');var box=el('div','acts');
 if(l.plan!=='lifetime')box.appendChild(act('+ дни',null,function(){var d=prompt('На сколько дней продлить?','30');if(d)run('extend',{key:l.key,days:Number(d)},'Продлено')}));
 box.appendChild(act('Устройства',null,function(){var n=prompt('Максимум устройств для ключа:',l.maxDevices);if(n)run('devices-max',{key:l.key,maxDevices:Number(n)})}));
 box.appendChild(act('Сбросить устройства',null,function(){if(confirm('Отвязать все устройства от ключа?'))run('devices-reset',{key:l.key},'Устройства сброшены')}));
 box.appendChild(act('Заметка',null,function(){var n=prompt('Заметка:',l.note||'');if(n!==null)run('note',{key:l.key,note:n})}));
 box.appendChild(act(l.revoked?'Вернуть':'Отозвать','danger',function(){run('revoke',{key:l.key,revoked:!l.revoked})}));
 box.appendChild(act('Удалить','danger',function(){if(confirm('Удалить ключ навсегда?'))run('delete',{key:l.key},'Удалено')}));
 a.appendChild(box);tr.appendChild(a);return tr}

function load(){
 api('list').then(function(j){
  if(j._status===401){sessionStorage.removeItem('adm');tok='';$('login').classList.remove('hide');$('app').classList.add('hide');$('loginMsg').textContent='Неверный секрет';return}
  if(!j.ok){$('loginMsg').textContent=j.message||j.error||'Ошибка';return}
  $('login').classList.add('hide');$('app').classList.remove('hide');
  var rows=$('rows');rows.textContent='';j.licenses.forEach(function(l){rows.appendChild(row(l))});
  $('empty').style.display=j.licenses.length?'none':'block';
  $('stat').textContent='· '+j.licenses.length+' шт. · установок: '+j.installs;
  $('pub').textContent=j.publicKey;$('pub').onclick=function(){copy(j.publicKey);say('Публичный ключ скопирован')};
 }).catch(function(){$('loginMsg').textContent='Нет связи с сервером'})}

$('go').onclick=function(){tok=$('tok').value.trim();if(!tok)return;sessionStorage.setItem('adm',tok);$('loginMsg').textContent='';load()};
$('tok').onkeydown=function(e){if(e.key==='Enter')$('go').click()};
$('plan').onchange=function(){$('daysBox').style.display=$('plan').value==='lifetime'?'none':''};
$('create').onclick=function(){
 api('create',{plan:$('plan').value,days:Number($('days').value),maxDevices:Number($('md').value),note:$('note').value}).then(function(j){
  if(!j.ok){say(j.message||j.error||'Ошибка',true);return}
  $('newKey').textContent=j.license.key;$('newBox').style.display='block';$('newKey').onclick=function(){copy(j.license.key);say('Ключ скопирован')};
  copy(j.license.key);say('Ключ создан и скопирован');$('note').value='';load()})};
if(tok)load();
</script></body></html>`;
