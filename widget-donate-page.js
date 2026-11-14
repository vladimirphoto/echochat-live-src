'use strict';
// Страница виджета донатов (прозрачный фон). Показывает по одному донату: картинка в тему суммы, имя, сумма.
// Настройки и донаты приходят по SSE от приложения (как у виджета чата) и применяются на лету.
module.exports = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Донаты</title>
<style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif;height:100%}
#stage{position:fixed;inset:0;display:flex;padding:18px;box-sizing:border-box}
#stage.l{justify-content:flex-start}#stage.c{justify-content:center}#stage.r{justify-content:flex-end}
#stage.t{align-items:flex-start}#stage.m{align-items:center}#stage.b{align-items:flex-end}
.card{position:relative;display:flex;align-items:center;gap:18px;min-width:320px;max-width:560px;padding:16px 26px 16px 18px;border-radius:22px;color:#fff;
 background:linear-gradient(135deg,rgba(24,24,38,.94),rgba(40,22,36,.94));border:1px solid rgba(255,255,255,.14);
 box-shadow:0 10px 36px rgba(0,0,0,.55),0 0 0 2px var(--ac,#f14635),0 0 34px var(--ac,#f14635);
 animation:pop .55s cubic-bezier(.2,1.4,.4,1) both;box-sizing:border-box}
.card.out{animation:bye .45s ease-in both}
.card .art.img{background:none!important;box-shadow:none!important;border-radius:0!important;animation:none!important;font-size:0}
.art.img img{display:block;width:100%;height:100%;object-fit:contain}
.art{flex:none;width:92px;height:92px;border-radius:50%;display:grid;place-items:center;font-size:54px;line-height:1;
 background:radial-gradient(circle at 30% 25%,rgba(255,255,255,.28),rgba(255,255,255,.06));box-shadow:inset 0 0 0 2px rgba(255,255,255,.18);
 font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;animation:bob 1.8s ease-in-out infinite}
.tx{min-width:0}
.cap{font-size:13px;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.62)}
.nm{font-size:30px;font-weight:800;line-height:1.15;margin-top:2px;word-break:break-word}
.am{font-size:38px;font-weight:900;line-height:1.1;margin-top:2px;color:var(--ac,#f14635);text-shadow:0 0 18px color-mix(in srgb,var(--ac,#f14635) 55%,transparent)}
.ms{margin-top:6px;font-size:19px;line-height:1.3;color:rgba(255,255,255,.92);word-break:break-word}
.sp{position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:50%;background:var(--ac,#f14635);opacity:0;animation:spark 1.1s ease-out both}
@keyframes pop{from{opacity:0;transform:translateY(24px) scale(.82)}to{opacity:1;transform:none}}
@keyframes bye{to{opacity:0;transform:translateY(-14px) scale(.96)}}
@keyframes bob{50%{transform:translateY(-5px) rotate(-4deg)}}
@keyframes spark{0%{opacity:1;transform:translate(-50%,-50%)}100%{opacity:0;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(.4)}}
/* ---- оформления (S.design): classic — стандарт выше; neon, minimal, party ---- */
.d-neon{background:rgba(6,8,22,.9);border:2px solid var(--ac,#22d3ee);border-radius:14px;font-family:Consolas,"Courier New",monospace;
 box-shadow:0 0 0 1px rgba(255,255,255,.06),0 0 24px color-mix(in srgb,var(--ac,#22d3ee) 70%,transparent),inset 0 0 24px color-mix(in srgb,var(--ac,#22d3ee) 24%,transparent);animation:flick .8s both}
.d-neon .art{width:80px;height:80px;font-size:46px;border-radius:12px;background:transparent;animation:none;box-shadow:inset 0 0 0 2px var(--ac,#22d3ee),0 0 14px var(--ac,#22d3ee)}
.d-neon .cap{color:var(--ac,#22d3ee);letter-spacing:3px}
.d-neon .nm{text-transform:uppercase;letter-spacing:1px;font-size:27px}
.d-neon .am{color:#fff;text-shadow:0 0 8px var(--ac,#22d3ee),0 0 22px var(--ac,#22d3ee)}
.d-min{background:#fff;color:#14161f;border:none;border-radius:40px;padding:12px 32px 12px 12px;gap:14px;min-width:300px;box-shadow:0 8px 28px rgba(0,0,0,.3);animation:slide .5s cubic-bezier(.2,.9,.3,1) both}
.d-min .art{width:66px;height:66px;font-size:36px;animation:none;background:color-mix(in srgb,var(--ac,#f14635) 16%,#fff);box-shadow:none}
.d-min .cap{font-size:12px;color:#7a7f90}
.d-min .nm{font-size:22px;color:#14161f}
.d-min .am{font-size:28px;color:var(--ac,#f14635);text-shadow:none}
.d-min .ms{font-size:16px;color:#444a5c}
.d-min .sp{display:none}
.d-party{background:linear-gradient(135deg,var(--ac,#f14635),#7c3aed);border:3px solid rgba(255,255,255,.92);border-radius:28px;box-shadow:0 12px 34px rgba(0,0,0,.45);animation:boing .85s both}
.d-party .art{width:100px;height:100px;font-size:60px;background:rgba(255,255,255,.26);box-shadow:inset 0 0 0 3px rgba(255,255,255,.6);animation:bob 1s ease-in-out infinite}
.d-party .cap{color:rgba(255,255,255,.88)}
.d-party .nm{color:#fff;font-size:32px}
.d-party .am{display:inline-block;background:#fff;color:var(--ac,#f14635);padding:2px 16px;border-radius:999px;margin-top:8px;text-shadow:none}
.d-party .ms{color:#fff}
.sp.cf{width:8px;height:14px;border-radius:2px;background:var(--c);animation:conf 1.7s ease-out both}
@keyframes flick{0%{opacity:0}8%{opacity:1}12%{opacity:.3}18%{opacity:1}24%{opacity:.55}32%,100%{opacity:1}}
@keyframes slide{from{opacity:0;transform:translateX(-46px)}to{opacity:1;transform:none}}
@keyframes boing{0%{opacity:0;transform:scale(.3) rotate(-6deg)}50%{opacity:1;transform:scale(1.08) rotate(2deg)}70%{transform:scale(.96)}100%{opacity:1;transform:none}}
@keyframes conf{0%{opacity:1;transform:translate(-50%,-50%) rotate(0)}100%{opacity:0;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) rotate(var(--r))}}
.d-gold{position:relative;overflow:hidden;background:linear-gradient(135deg,#241804,#4a3208 55%,#241804);border:2px solid #f5c542;border-radius:16px;box-shadow:0 0 28px rgba(245,197,66,.5),0 10px 30px rgba(0,0,0,.5);animation:pop .55s cubic-bezier(.2,1.4,.4,1) both}
.d-gold::after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:40%;background:linear-gradient(100deg,transparent,rgba(255,244,190,.35),transparent);transform:skewX(-18deg);animation:shine 2.4s ease-in-out .5s infinite}
.d-gold .art{background:radial-gradient(circle at 30% 25%,rgba(255,230,140,.35),rgba(255,230,140,.06));box-shadow:inset 0 0 0 2px #f5c542}
.d-gold .cap{color:#f5c542;letter-spacing:2px}
.d-gold .nm{color:#ffe9a8}
.d-gold .am{background:linear-gradient(180deg,#fff6c4,#f5b301);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none}
.d-gold .ms{color:#f4e3b0}
.d-gold .sp{background:#f5c542}
.d-arc{background:#0b0b2b;border:4px solid #ff3df2;border-radius:0;font-family:"Courier New",Consolas,monospace;box-shadow:6px 6px 0 #00e5ff;animation:arc .45s cubic-bezier(.2,.9,.3,1.05) both;will-change:transform,opacity}
.d-arc .art{border-radius:0;width:80px;height:80px;font-size:46px;background:transparent;box-shadow:inset 0 0 0 3px #00e5ff;animation:none}
.d-arc .cap{color:#00e5ff;letter-spacing:2px;font-weight:700}
.d-arc .nm{text-transform:uppercase;font-size:26px;letter-spacing:1px}
.d-arc .am{color:#ffe600;text-shadow:3px 3px 0 #ff3df2}
.d-arc .sp{display:none}
.d-glass{background:linear-gradient(135deg,rgba(255,255,255,.22),rgba(255,255,255,.05)),rgba(18,20,40,.45);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.5);border-radius:28px;box-shadow:0 12px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.55);text-shadow:0 1px 8px rgba(0,0,0,.55);animation:fadeb .7s ease-out both}
.d-glass .art{background:rgba(255,255,255,.2);box-shadow:inset 0 0 0 2px rgba(255,255,255,.5);animation:none}
.d-glass .cap{color:rgba(255,255,255,.85)}
.d-glass .am{color:#fff;text-shadow:0 0 16px var(--ac,#f14635),0 1px 8px rgba(0,0,0,.5)}
.d-glass .sp{display:none}
.d-candy{background:linear-gradient(135deg,#ffd6ea,#ffc0d8 55%,#ffe6f2);color:#6b1f4a;border:3px solid #fff;border-radius:34px;box-shadow:0 10px 28px rgba(255,105,180,.55);animation:wob .8s both}
.d-candy .art{background:rgba(255,255,255,.65);box-shadow:inset 0 0 0 2px #fff;animation:bob 1.3s ease-in-out infinite}
.d-candy .cap{color:#b24a82}
.d-candy .nm{color:#6b1f4a}
.d-candy .am{color:#e0357e;text-shadow:none}
.d-candy .ms{color:#7d3a62}
.d-candy .sp{display:none}
.sp.ht{width:auto;height:auto;border-radius:0;background:none;color:var(--c);font-size:var(--s);line-height:1;animation:rise 1.9s ease-out both}
/* ---- раскладка «картинка сверху, имя и сумма снизу» (S.layout = top), как у DonationAlerts ---- */
.card.v-top{flex-direction:column;align-items:center;text-align:center;gap:12px;min-width:300px;max-width:520px;padding:22px 34px 22px}
.card.v-top .art{width:150px;height:150px;font-size:88px}
.card.v-top .tx{width:100%}
.card.v-top .nm{font-size:32px}
.card.v-top .am{font-size:44px}
.card.v-top.d-neon .art{width:130px;height:130px;font-size:76px}
.card.v-top.d-neon .nm{font-size:28px}
.card.v-top.d-min{border-radius:32px;padding:20px 38px 22px;gap:10px}
.card.v-top.d-min .art{width:112px;height:112px;font-size:62px}
.card.v-top.d-min .nm{font-size:24px}
.card.v-top.d-min .am{font-size:32px}
.card.v-top.d-party .art{width:160px;height:160px;font-size:96px}
.card.v-top.d-arc .art{width:130px;height:130px;font-size:76px}
.card.v-top.d-arc .nm{font-size:27px}
.card.v-top.d-candy,.card.v-top.d-glass{border-radius:34px}
@keyframes shine{0%{left:-60%}55%,100%{left:130%}}
@keyframes arc{0%{opacity:0;transform:translateY(30px)}100%{opacity:1;transform:none}}
@keyframes fadeb{from{opacity:0;transform:translateY(14px);filter:blur(8px)}to{opacity:1;transform:none;filter:none}}
@keyframes wob{0%{opacity:0;transform:scale(.5) rotate(8deg)}40%{opacity:1;transform:scale(1.06) rotate(-4deg)}60%{transform:rotate(3deg)}80%{transform:rotate(-1.5deg)}100%{opacity:1;transform:none}}
@keyframes rise{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}15%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(1)}}
</style></head><body>
<div id="nc" style="display:none;position:fixed;left:10px;top:10px;z-index:9999;background:rgba(0,0,0,.65);color:#fff;font:600 13px/1.3 'Segoe UI',Arial,sans-serif;padding:7px 12px;border-radius:999px">Нет связи с приложением ЭхоЧат — запустите его на этом компьютере</div>
<div id="stage" class="c b"></div>
<script>
var PREVIEW=/[?&]preview=1/.test(location.search);
var S={duration:8,scale:100,align:'center',vpos:'bottom',showMessage:true,design:'classic',layout:'top'};
var DESIGNS=['classic','neon','minimal','party','gold','arcade','glass','candy'];
var DCLS={neon:'d-neon',minimal:'d-min',party:'d-party',gold:'d-gold',arcade:'d-arc',glass:'d-glass',candy:'d-candy'};
function designOf(){return DESIGNS.indexOf(S.design)>=0?S.design:'classic';}
var stage=document.getElementById('stage');
// картинка в тему суммы (в тенге)
var TIERS=[
 {max:500,art:'\\u2615',cap:'Кофе',ac:'#f59e0b'},
 {max:2000,art:'\\ud83c\\udf55',cap:'Пицца',ac:'#fb7185'},
 {max:5000,art:'\\ud83c\\udf81',cap:'Подарок',ac:'#f14635'},
 {max:10000,art:'\\ud83d\\udc8e',cap:'Бриллиант',ac:'#22d3ee'},
 {max:Infinity,art:'\\ud83d\\ude80',cap:'Ракета',ac:'#a78bfa'}
];
function tierOf(a){for(var i=0;i<TIERS.length;i++)if(a<TIERS[i].max)return TIERS[i];return TIERS[TIERS.length-1];}
function fmt(n){return String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,'\\u00a0')+'\\u00a0\\u20b8';}
function zoomOf(){return Math.max(40,Math.min(250,+S.scale||100))/100;}
function apply(){
  stage.className=PREVIEW?'c m':({left:'l',center:'c',right:'r'}[S.align]||'c')+' '+({top:'t',center:'m',bottom:'b'}[S.vpos]||'b');
  var c=stage.firstChild;if(c&&c.style)c.style.zoom=zoomOf();
}
var BASE='',imgUrl='',imgFor=0;
// своя картинка: берём у приложения один раз на версию и держим в памяти
function loadImage(){
  var v=+S.imageV||0;
  if(!v){if(imgUrl){URL.revokeObjectURL(imgUrl);imgUrl='';}imgFor=0;return Promise.resolve();}
  if(imgFor===v&&imgUrl)return Promise.resolve();
  return fetch(BASE+'/donate-image?v='+v,{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.blob();}).then(function(b){
    if(imgUrl)URL.revokeObjectURL(imgUrl);imgUrl=URL.createObjectURL(b);imgFor=v;
  }).catch(function(){if(imgUrl){URL.revokeObjectURL(imgUrl);}imgUrl='';imgFor=v;});
}
var queue=[],busy=false;
function sparks(card,ac){
  for(var i=0;i<14;i++){var s=document.createElement('i');s.className='sp';var a=Math.random()*6.283,d=70+Math.random()*90;
    s.style.setProperty('--x',Math.cos(a)*d+'px');s.style.setProperty('--y',Math.sin(a)*d+'px');s.style.animationDelay=(Math.random()*.25)+'s';card.appendChild(s);}
}
function confetti(card){ // «Праздник»: разноцветное конфетти из центра карточки
  for(var i=0;i<28;i++){var s=document.createElement('i');s.className='sp cf';var a=Math.random()*6.283,d=90+Math.random()*130;
    s.style.setProperty('--c','hsl('+Math.floor(Math.random()*360)+',90%,60%)');s.style.setProperty('--x',Math.cos(a)*d+'px');s.style.setProperty('--y',(Math.sin(a)*d-40)+'px');
    s.style.setProperty('--r',(Math.random()*720-360)+'deg');s.style.animationDelay=(Math.random()*.3)+'s';card.appendChild(s);}
}
function hearts(card){ // «Конфетка»: сердечки поднимаются от карточки
  for(var i=0;i<16;i++){var s=document.createElement('i');s.className='sp ht';s.textContent='\u2665';
    s.style.setProperty('--c','hsl('+(325+Math.floor(Math.random()*30))+',85%,'+(55+Math.floor(Math.random()*15))+'%)');s.style.setProperty('--s',(14+Math.random()*16)+'px');
    s.style.setProperty('--x',(Math.random()*240-120)+'px');s.style.setProperty('--y',-(60+Math.random()*130)+'px');s.style.animationDelay=(Math.random()*.7)+'s';card.appendChild(s);}
}
function show(d){
  var t=tierOf(+d.amount||0);
  var c=document.createElement('div');var ds=designOf();c.className='card'+(DCLS[ds]?' '+DCLS[ds]:'')+(S.layout==='side'?'':' v-top');c.style.setProperty('--ac',t.ac);
  var a=document.createElement('div');a.className='art';
  if(imgUrl){a.className='art img';var im=document.createElement('img');im.alt='';im.src=imgUrl;a.appendChild(im);}else a.textContent=t.art;
  var x=document.createElement('div');x.className='tx';
  var cap=document.createElement('div');cap.className='cap';cap.textContent='Донат · '+t.cap;
  var nm=document.createElement('div');nm.className='nm';nm.textContent=d.name||'Аноним';
  var am=document.createElement('div');am.className='am';am.textContent=fmt(+d.amount||0);
  x.appendChild(cap);x.appendChild(nm);x.appendChild(am);
  if(S.showMessage&&d.message){var m=document.createElement('div');m.className='ms';m.textContent=d.message;x.appendChild(m);}
  c.style.zoom=zoomOf();c.appendChild(a);c.appendChild(x);stage.innerHTML='';stage.appendChild(c);if(ds==='party')confetti(c);else if(ds==='candy')hearts(c);else sparks(c,t.ac);
  var ms=Math.max(2,+S.duration||8)*1000;
  setTimeout(function(){c.classList.add('out');setTimeout(function(){c.remove();busy=false;next();},500);},ms);
}
function next(){if(busy||!queue.length)return;busy=true;loadImage().then(function(){var d=queue.shift();if(!d){busy=false;return;}show(d);});}
function add(d){queue.push(d);if(queue.length>20)queue.shift();next();}
var Q=new URLSearchParams(location.search),FIXED=+Q.get('port')||0;
var REMOTE=!(/^(127\\.0\\.0\\.1|localhost)$/.test(location.hostname)&&!FIXED);
var PORTS=[];if(FIXED)PORTS=[FIXED];else for(var pp=7878;pp<=7898;pp++)PORTS.push(pp);
var nc=document.getElementById('nc'),ncT=null;
function offline(){if(REMOTE&&!ncT)ncT=setTimeout(function(){nc.style.display='block'},4000);}
function online(){clearTimeout(ncT);ncT=null;nc.style.display='none';}
var told=false;
function tellReady(){if(told)return;told=true;try{if(window.parent&&window.parent!==window)window.parent.postMessage({echochat:'donate-ready'},'*');}catch(_){}}
function bind(es){
  es.addEventListener('dsettings',function(e){S=Object.assign(S,JSON.parse(e.data));apply();tellReady();});
  es.addEventListener('donate',function(e){add(JSON.parse(e.data));});
  es.addEventListener('clear',function(){queue=[];});
}
function connect(){
  if(!REMOTE){bind(new EventSource('/events'));return;}
  var i=0;
  (function probe(){
    var port=PORTS[i%PORTS.length];i++;
    var es=new EventSource('http://127.0.0.1:'+port+'/events'),got=false,t;
    function fail(){if(got)return;clearTimeout(t);es.close();offline();setTimeout(probe,PORTS.length>1&&i%PORTS.length?30:2500);}
    t=setTimeout(fail,1500);
    es.addEventListener('settings',function(){if(!got){got=true;clearTimeout(t);BASE='http://127.0.0.1:'+port;online();}});
    es.onerror=function(){if(got)offline();else fail();};
    es.onopen=function(){if(got)online();};
    bind(es);
  })();
}
apply();connect();
</script></body></html>`;
