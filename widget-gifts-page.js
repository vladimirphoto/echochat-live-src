'use strict';
// Страница виджета «Топ подарков»: вертикальный список (5–10 строк: аватарка, справа ник и монеты), в остальном как «Топ лайков», но по подаркам; у вышедшего на 1 место аватарка прыгает и светится.
// Настройки (сколько показывать, масштаб, выравнивание) приходят от приложения по SSE и применяются на лету.
module.exports = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Топ подарков</title>
<style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif;height:100%}
#root{position:fixed;left:0;top:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:14px;padding:10px;box-sizing:border-box;width:320px;transform-origin:top left}
.t{width:300px;display:grid;grid-template-columns:84px 1fr;grid-template-rows:1fr 1fr;column-gap:14px;row-gap:4px;align-items:center;color:#fff;animation:in .3s ease-out}
.a{grid-row:1/3;position:relative;width:84px;height:84px;border-radius:21px;background:#6b7280 center/cover no-repeat;display:grid;place-items:center;font-weight:700;font-size:34px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.r{position:absolute;left:5px;top:5px;min-width:24px;height:24px;padding:0 6px;box-sizing:border-box;border-radius:12px;background:rgba(0,0,0,.62);font-size:14px;font-weight:700;line-height:24px;text-align:center}
.t:nth-of-type(1) .r{background:#f5b301;color:#2a1c00}.t:nth-of-type(2) .r{background:#cfd4dc;color:#1c2230}.t:nth-of-type(3) .r{background:#c98542;color:#2b1800}
.l{grid-column:2;grid-row:2;align-self:start;justify-self:start;display:flex;align-items:center;justify-content:center;gap:5px;min-width:64px;height:30px;padding:0 12px;box-sizing:border-box;border-radius:15px;background:rgba(0,0,0,.72);color:#fff;font-size:20px;font-weight:800;line-height:30px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.l i{display:flex;color:#ff6bd6}.l svg{width:19px;height:19px}
.n{grid-column:2;grid-row:1;align-self:end;max-width:100%;min-width:0;font-size:22px;font-weight:700;text-align:left;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh .n{text-shadow:0 0 3px rgba(0,0,0,.95),0 1px 4px rgba(0,0,0,.9),0 2px 8px rgba(0,0,0,.8)}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes lk{50%{transform:scale(1.25);background:#ff6bd6}}
.t.bl .l{animation:lk .45s ease-in-out 2}
@keyframes ic{50%{color:#fff}}
.t.bl .l i{animation:ic .45s ease-in-out 2}
/* ликование лидера: аватарка слегка подпрыгивает и светится золотом */
.a.cel{animation:hop 1.9s ease-in-out,glow 1.9s ease-in-out;z-index:2}
@keyframes hop{0%,100%{transform:none}12%{transform:translateY(-14px) scale(1.07)}26%{transform:none}40%{transform:translateY(-9px) scale(1.04)}54%{transform:none}68%{transform:translateY(-4px) scale(1.02)}80%{transform:none}}
@keyframes glow{0%,100%{box-shadow:0 4px 14px rgba(0,0,0,.35);filter:none}20%,60%{box-shadow:0 0 0 3px #ffd54a,0 0 30px 9px rgba(255,200,60,.85),0 4px 14px rgba(0,0,0,.35);filter:brightness(1.18)}}
</style></head><body class="sh">
<div id="nc" style="display:none;position:fixed;left:10px;top:10px;z-index:9999;background:rgba(0,0,0,.65);color:#fff;font:600 13px/1.3 'Segoe UI',Arial,sans-serif;padding:7px 12px;border-radius:999px">Нет связи с приложением ЭхоЧат — запустите его на этом компьютере</div><div id="root"></div>
<script>
var S={count:5,scale:100,align:'center',showCount:true,showRank:true,shadow:true,celebrate:true},PK=1,LIST=[],PREV={},TOP=null;
var root=document.getElementById('root');
var COLORS=['#2f6fed','#0e9fbc','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6','#a855f7','#f97316','#22c55e'];
function colorOf(s){var h=0,i;for(i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return COLORS[h%COLORS.length];}
function fmt(n){n=+n||0;if(n>=1e6)return (n/1e6).toFixed(n>=1e7?0:1).replace('.0','')+'M';if(n>=1e4)return (n/1e3).toFixed(n>=1e5?0:1).replace('.0','')+'K';return String(n);}
function apply(){
  var sc=Math.max(30,Math.min(300,+S.scale||100))/100*PK;
  document.body.className=S.shadow?'sh':'';
  root.style.transform='scale('+sc+')';
  root.style.height=(100/sc)+'vh';
  // колонка всегда 320 px, по центру экрана (и по вертикали через justify-content)
  // левый край блока с учётом масштаба: (ширина экрана − видимая ширина колонки) / 2
  root.style.left='calc((100vw - '+(320*sc)+'px) / 2)';
  render();
}
function render(){
  var n=Math.max(1,Math.min(10,Math.round(+S.count)||5)),items=LIST.slice(0,n),ts=root.getElementsByClassName('t'),i;
  while(ts.length>items.length)ts[ts.length-1].remove();
  for(i=0;i<items.length;i++){
    var d=items[i],t=ts[i];
    if(!t){
      t=document.createElement('div');t.className='t';
      t.innerHTML='<div class="a"><span class="ch"></span><div class="r"></div></div><div class="n"></div><div class="l"></div>';
      root.appendChild(t);
    }
    var a=t.firstChild,nm=d.name||'Гость',av=/^https?:\\/\\//.test(d.avatar||'')?d.avatar:'';
    if(a.dataset.av!==av||a.dataset.nm!==nm){
      a.dataset.av=av;a.dataset.nm=nm;
      a.style.backgroundImage=av?'url("'+av.replace(/"/g,'%22')+'")':'none';
      a.style.backgroundColor=av?'#374151':colorOf(nm);
      a.querySelector('.ch').textContent=av?'':nm.charAt(0).toUpperCase();
    }
    var r=a.querySelector('.r'),l=t.querySelector('.l');
    r.textContent=i+1;r.style.display=S.showRank?'':'none';
    l.innerHTML='<i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg></i>';l.appendChild(document.createTextNode(fmt(d.likes)));l.style.display=S.showCount?'':'none';
    t.querySelector('.n').textContent=nm;
    // лайки выросли — мигаем плашкой (первая отрисовка без мигания)
    if(PREV[nm]!==undefined&&d.likes>PREV[nm]){t.classList.remove('bl');void t.offsetWidth;t.classList.add('bl');}
    PREV[nm]=d.likes;
  }
}
// ---- ликование нового лидера: аватарка на 1 месте слегка прыгает и светится
var CT=null;
function celebrate(){
  var ts=root.getElementsByClassName('t');if(!ts.length)return;
  var a=ts[0].firstChild;
  a.classList.remove('cel');void a.offsetWidth;a.classList.add('cel');
  clearTimeout(CT);CT=setTimeout(function(){a.classList.remove('cel');},2100);
}
function lead(){ // сменился лидер (первая таблица после подключения/сброса — не в счёт)
  var top=LIST.length?String(LIST[0].name||'Гость'):null,prev=TOP;
  TOP=top;
  if(prev!==null&&top!==null&&top!==prev&&S.celebrate!==false)celebrate();
}
var Q=new URLSearchParams(location.search),FIXED=+Q.get('port')||0;
var REMOTE=!(/^(127\\.0\\.0\\.1|localhost)$/.test(location.hostname)&&!FIXED);
var PORTS=[];if(FIXED)PORTS=[FIXED];else for(var pp=7878;pp<=7898;pp++)PORTS.push(pp);
var nc=document.getElementById('nc'),ncT=null;
function offline(){if(REMOTE&&!ncT)ncT=setTimeout(function(){nc.style.display='block'},4000);}
function online(){clearTimeout(ncT);ncT=null;nc.style.display='none';}
var told=false;
function tellReady(){if(told)return;told=true;try{if(window.parent&&window.parent!==window)window.parent.postMessage({echochat:'gifts-ready'},'*');}catch(_){}}
// предпросмотр в приложении: масштаб подгоняет приложение (iframe сам не масштабируется)
window.addEventListener('message',function(e){var d=e.data;if(window.parent!==window&&e.source===window.parent&&d&&d.echochat==='fit'){var k=+d.k;if(k>0.1&&k<=1.5&&k!==PK){PK=k;apply();}}});
function bind(es){
  es.addEventListener('gsettings',function(e){S=Object.assign(S,JSON.parse(e.data));apply();tellReady();});
  es.addEventListener('gifts',function(e){var d=JSON.parse(e.data);LIST=Array.isArray(d)?d:[];render();lead();});
  es.addEventListener('clear',function(){LIST=[];TOP=null;render();});
}
function connect(){
  if(!REMOTE){bind(new EventSource('/events'));return;}
  var i=0;
  (function probe(){
    var port=PORTS[i%PORTS.length];i++;
    var es=new EventSource('http://127.0.0.1:'+port+'/events'),got=false,t;
    function fail(){if(got)return;clearTimeout(t);es.close();offline();setTimeout(probe,PORTS.length>1&&i%PORTS.length?30:2500);}
    t=setTimeout(fail,1500);
    es.addEventListener('settings',function(){if(!got){got=true;clearTimeout(t);online();}});
    es.onerror=function(){if(got)offline();else fail();};
    es.onopen=function(){if(got)online();};
    bind(es);
  })();
}
window.addEventListener('resize',apply);
apply();connect();
</script></body></html>`;
