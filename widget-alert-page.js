'use strict';
// Страница виджета «Оповещения» (прозрачный фон): когда кто-то подписывается, на экране появляется плашка.
// По умолчанию — анимированное сердечко, ник, аватарка и летящие сердечки; вместо сердечка можно показать свою картинку.
// Настройки и оповещения приходят от приложения по SSE (как у виджетов чата и донатов) и применяются на лету.
// Звук играет само приложение, а не эта страница: так он не звучит дважды (в предпросмотре и в OBS) и идёт в общей очереди озвучки.
module.exports = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Оповещения</title>
<style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif;height:100%}
#stage{position:fixed;inset:0;display:flex;padding:18px;box-sizing:border-box}
#stage.l{justify-content:flex-start}#stage.c{justify-content:center}#stage.r{justify-content:flex-end}
#stage.t{align-items:flex-start}#stage.m{align-items:center}#stage.b{align-items:flex-end}
.al{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;max-width:560px;animation:pop .8s cubic-bezier(.2,1.5,.35,1) both}
.al.out{animation:bye .5s ease-in both}
.al.still{animation:none}
.vis{position:relative;display:grid;place-items:center;min-width:170px;min-height:170px}
.vis svg{width:170px;height:170px;overflow:visible}
.vis .heart{transform-origin:80px 84px;animation:beat 1.6s ease-in-out infinite}
.vis .glow{transform-origin:80px 80px;animation:glow 1.6s ease-in-out infinite}
.vis .plus{transform-origin:118px 42px;animation:plus .9s cubic-bezier(.2,1.6,.4,1) .35s both}
.vis .pic{display:block;max-width:340px;max-height:240px;object-fit:contain;filter:drop-shadow(0 10px 26px rgba(0,0,0,.55));animation:bob 2.6s ease-in-out infinite}
.plate{position:relative;display:flex;align-items:center;gap:16px;min-width:300px;max-width:560px;padding:14px 32px 14px 16px;box-sizing:border-box;border-radius:28px;color:#fff;overflow:hidden;
 background:linear-gradient(135deg,rgba(28,22,48,.95),rgba(56,26,66,.95));border:1px solid rgba(255,255,255,.18);
 box-shadow:0 12px 40px rgba(0,0,0,.55),0 0 0 2px rgba(255,92,147,.7),0 0 38px rgba(255,92,147,.5)}
.plate.noav{padding-left:32px}
.plate:after{content:"";position:absolute;top:0;bottom:0;left:-60%;width:40%;transform:skewX(-20deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);animation:shine 2.8s ease-in-out .6s infinite}
.av{position:relative;flex:none;width:72px;height:72px;border-radius:50%;background:#6b7280 center/cover no-repeat;display:grid;place-items:center;font-size:32px;font-weight:800;color:#fff;
 box-shadow:0 0 0 3px #ff5c93,0 0 20px rgba(255,92,147,.75)}
.tx{position:relative;min-width:0;text-align:left}
.cap{font-size:13px;letter-spacing:1.8px;text-transform:uppercase;color:rgba(255,255,255,.72)}
.nm{margin-top:2px;font-size:36px;font-weight:900;line-height:1.12;word-break:break-word;background:linear-gradient(90deg,#fff 30%,#ffb8d2);-webkit-background-clip:text;background-clip:text;color:transparent;
 filter:drop-shadow(0 2px 10px rgba(255,92,147,.45))}
.hp{position:absolute;bottom:20%;font-style:normal;line-height:1;opacity:0;pointer-events:none;color:#ff5c93;text-shadow:0 0 12px rgba(255,92,147,.9);animation:rise 2.6s ease-out both}
.hp.v{color:#b79cff;text-shadow:0 0 12px rgba(139,92,246,.9)}
@keyframes pop{from{opacity:0;transform:translateY(34px) scale(.6)}to{opacity:1;transform:none}}
@keyframes bye{to{opacity:0;transform:translateY(-18px) scale(.94)}}
@keyframes beat{0%,100%{transform:scale(1)}14%{transform:scale(1.11)}28%{transform:scale(1)}42%{transform:scale(1.07)}56%{transform:scale(1)}}
@keyframes glow{0%,100%{opacity:.55;transform:scale(.92)}14%{opacity:1;transform:scale(1.12)}}
@keyframes plus{from{opacity:0;transform:scale(0) rotate(-90deg)}to{opacity:1;transform:none}}
@keyframes bob{50%{transform:translateY(-7px) rotate(-1.5deg)}}
@keyframes shine{0%{left:-60%}55%,100%{left:130%}}
@keyframes rise{0%{opacity:0;transform:translate(0,0) scale(.5)}12%{opacity:1}100%{opacity:0;transform:translate(var(--dx),-230px) scale(1.15) rotate(var(--rot))}}
/* ---- оформления плашки (S.design): classic — стандарт выше; neon, minimal, party, gold, arcade, glass, candy ---- */
.a-neon{animation:flick .8s both}
.a-neon .plate{background:rgba(6,8,22,.9);border:2px solid #22d3ee;border-radius:14px;font-family:Consolas,"Courier New",monospace;box-shadow:0 0 0 1px rgba(255,255,255,.06),0 0 26px rgba(34,211,238,.7),inset 0 0 24px rgba(34,211,238,.22)}
.a-neon .plate:after{display:none}
.a-neon .av{border-radius:12px;box-shadow:0 0 0 2px #22d3ee,0 0 14px #22d3ee}
.a-neon .cap{color:#22d3ee;letter-spacing:3px}
.a-neon .nm{background:none;-webkit-background-clip:border-box;background-clip:border-box;color:#fff;filter:none;text-transform:uppercase;font-size:32px;letter-spacing:1px;text-shadow:0 0 8px #22d3ee,0 0 22px #22d3ee}
.a-neon .hp{color:#22d3ee;text-shadow:0 0 12px #22d3ee}.a-neon .hp.v{color:#e879f9;text-shadow:0 0 12px #e879f9}
.a-min{animation:slide .5s cubic-bezier(.2,.9,.3,1) both}
.a-min .plate{background:#fff;color:#14161f;border:none;border-radius:46px;padding:10px 32px 10px 10px;min-width:260px;box-shadow:0 8px 28px rgba(0,0,0,.3)}
.a-min .plate:after{display:none}
.a-min .av{width:64px;height:64px;box-shadow:none}
.a-min .cap{font-size:12px;color:#7a7f90}
.a-min .nm{background:none;-webkit-background-clip:border-box;background-clip:border-box;color:#14161f;filter:none;font-size:30px}
.a-party{animation:boing .85s both}
.a-party .plate{background:linear-gradient(135deg,#ff5c93,#7c3aed);border:3px solid rgba(255,255,255,.92);border-radius:30px;box-shadow:0 12px 34px rgba(0,0,0,.45)}
.a-party .plate:after{background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent)}
.a-party .av{box-shadow:0 0 0 3px #fff}
.a-party .cap{color:rgba(255,255,255,.9)}
.a-party .nm{background:none;-webkit-background-clip:border-box;background-clip:border-box;color:#fff;filter:none}
.hp.cf{width:8px;height:14px;border-radius:2px;background:var(--c);text-shadow:none;font-size:0}
.a-gold .plate{background:linear-gradient(135deg,#241804,#4a3208 55%,#241804);border:2px solid #f5c542;border-radius:18px;box-shadow:0 0 30px rgba(245,197,66,.5),0 10px 30px rgba(0,0,0,.5)}
.a-gold .plate:after{background:linear-gradient(90deg,transparent,rgba(255,244,190,.35),transparent)}
.a-gold .av{box-shadow:0 0 0 3px #f5c542,0 0 18px rgba(245,197,66,.7)}
.a-gold .cap{color:#f5c542;letter-spacing:2px}
.a-gold .nm{background:linear-gradient(180deg,#fff6c4,#f5b301);-webkit-background-clip:text;background-clip:text;color:transparent;filter:none}
.a-gold .hp{color:#f5c542;text-shadow:0 0 10px rgba(245,197,66,.9)}.a-gold .hp.v{color:#fff1a8}
.a-arc{animation:arc .45s cubic-bezier(.2,.9,.3,1.05) both;will-change:transform,opacity}
.a-arc .plate{background:#0b0b2b;border:4px solid #ff3df2;border-radius:0;font-family:"Courier New",Consolas,monospace;box-shadow:6px 6px 0 #00e5ff}
.a-arc .plate:after{display:none}
.a-arc .av{border-radius:0;box-shadow:0 0 0 3px #00e5ff}
.a-arc .cap{color:#00e5ff;letter-spacing:2px;font-weight:700}
.a-arc .nm{background:none;-webkit-background-clip:border-box;background-clip:border-box;color:#ffe600;filter:none;text-transform:uppercase;font-size:32px;text-shadow:3px 3px 0 #ff3df2}
.a-arc .hp{color:#00e5ff;text-shadow:none}.a-arc .hp.v{color:#ff3df2}
.a-glass{animation:fadeb .7s ease-out both}
.a-glass .plate{background:linear-gradient(135deg,rgba(255,255,255,.22),rgba(255,255,255,.05)),rgba(18,20,40,.45);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.5);border-radius:30px;box-shadow:0 12px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.55);text-shadow:0 1px 8px rgba(0,0,0,.55)}
.a-glass .av{box-shadow:0 0 0 2px rgba(255,255,255,.7)}
.a-glass .nm{background:none;-webkit-background-clip:border-box;background-clip:border-box;color:#fff;filter:none}
.a-glass .hp{color:#fff;text-shadow:0 0 12px rgba(255,255,255,.8)}.a-glass .hp.v{color:#cfe3ff}
.a-candy{animation:wob .8s both}
.a-candy .plate{background:linear-gradient(135deg,#ffd6ea,#ffc0d8 55%,#ffe6f2);color:#6b1f4a;border:3px solid #fff;border-radius:36px;box-shadow:0 10px 28px rgba(255,105,180,.55)}
.a-candy .plate:after{background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent)}
.a-candy .av{box-shadow:0 0 0 3px #fff,0 0 14px rgba(255,105,180,.6)}
.a-candy .cap{color:#b24a82}
.a-candy .nm{background:none;-webkit-background-clip:border-box;background-clip:border-box;color:#e0357e;filter:none}
.a-candy .hp{color:#ff6fa8;text-shadow:0 0 10px rgba(255,105,180,.7)}.a-candy .hp.v{color:#ff9ec7}
@keyframes flick{0%{opacity:0}8%{opacity:1}12%{opacity:.3}18%{opacity:1}24%{opacity:.55}32%,100%{opacity:1}}
@keyframes slide{from{opacity:0;transform:translateX(-46px)}to{opacity:1;transform:none}}
@keyframes boing{0%{opacity:0;transform:scale(.3) rotate(-6deg)}50%{opacity:1;transform:scale(1.08) rotate(2deg)}70%{transform:scale(.96)}100%{opacity:1;transform:none}}
@keyframes arc{0%{opacity:0;transform:translateY(30px)}100%{opacity:1;transform:none}}
@keyframes fadeb{from{opacity:0;transform:translateY(14px);filter:blur(8px)}to{opacity:1;transform:none;filter:none}}
@keyframes wob{0%{opacity:0;transform:scale(.5) rotate(8deg)}40%{opacity:1;transform:scale(1.06) rotate(-4deg)}60%{transform:rotate(3deg)}80%{transform:rotate(-1.5deg)}100%{opacity:1;transform:none}}
</style></head><body>
<div id="nc" style="display:none;position:fixed;left:10px;top:10px;z-index:9999;background:rgba(0,0,0,.65);color:#fff;font:600 13px/1.3 'Segoe UI',Arial,sans-serif;padding:7px 12px;border-radius:999px">Нет связи с приложением ЭхоЧат — запустите его на этом компьютере</div>
<div id="stage" class="c m"></div>
<script>
var PREVIEW=/[?&]preview=1/.test(location.search);
var S={duration:6,scale:100,align:'center',vpos:'middle',showAvatar:true,imageV:0,design:'classic'};
var DESIGNS=['classic','neon','minimal','party','gold','arcade','glass','candy'];
var DCLS={neon:'a-neon',minimal:'a-min',party:'a-party',gold:'a-gold',arcade:'a-arc',glass:'a-glass',candy:'a-candy'};
var HGLYPH={gold:'\\u2605',arcade:'\\u25a0',glass:'\\u2726'};
var CONF=['#ff5c93','#7c3aed','#22d3ee','#facc15','#34d399','#fb923c'];
function designOf(){return DESIGNS.indexOf(S.design)>=0?S.design:'classic';}
var stage=document.getElementById('stage');
var BASE='',imgUrl='',imgFor=0;
var COLORS=['#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6','#a855f7','#f97316','#22c55e'];
function colorOf(s){var h=0,i;for(i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return COLORS[h%COLORS.length];}
function zoomOf(){return Math.max(40,Math.min(250,+S.scale||100))/100;}
function apply(){
  stage.className=PREVIEW?'c m':({left:'l',center:'c',right:'r'}[S.align]||'c')+' '+({top:'t',center:'m',middle:'m',bottom:'b'}[S.vpos]||'m');
  var c=stage.firstChild;if(c&&c.style)c.style.zoom=zoomOf();
}
// своя картинка: берём у приложения один раз на версию и держим в памяти (так же, как страница ходит за настройками — через CORS)
function loadImage(){
  var v=+S.imageV||0;
  if(!v){if(imgUrl){URL.revokeObjectURL(imgUrl);imgUrl='';}imgFor=0;return Promise.resolve();}
  if(imgFor===v&&imgUrl)return Promise.resolve();
  return fetch(BASE+'/alert-image?v='+v,{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.blob();}).then(function(b){
    if(imgUrl)URL.revokeObjectURL(imgUrl);imgUrl=URL.createObjectURL(b);imgFor=v;
  }).catch(function(){if(imgUrl){URL.revokeObjectURL(imgUrl);}imgUrl='';imgFor=v;});
}
var HEART='<svg viewBox="0 0 160 160" aria-hidden="true"><defs>'
 +'<linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7aa8"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient>'
 +'<radialGradient id="gl"><stop offset="0" stop-color="#ff5c93" stop-opacity=".6"/><stop offset="1" stop-color="#ff5c93" stop-opacity="0"/></radialGradient>'
 +'<linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5c93"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>'
 +'<circle class="glow" cx="80" cy="80" r="78" fill="url(#gl)"/>'
 +'<g class="heart"><path d="M80 134C24 96 18 56 43 42c17-9 32-2 37 12 5-14 20-21 37-12 25 14 19 54-37 92z" fill="url(#hg)"/>'
 +'<path d="M50 54c6-6 15-6 21 1" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="6" stroke-linecap="round"/></g>'
 +'<g class="plus"><circle cx="118" cy="42" r="22" fill="#fff"/><circle cx="118" cy="42" r="22" fill="none" stroke="url(#pg)" stroke-width="3"/>'
 +'<path d="M118 31v22M107 42h22" stroke="url(#pg)" stroke-width="6" stroke-linecap="round"/></g></svg>';
function visual(){
  var v=document.createElement('div');v.className='vis';
  if(imgUrl){
    var im=document.createElement('img');im.className='pic';im.alt='';im.src=imgUrl;
    im.onerror=function(){v.innerHTML=HEART;}; // файл не открылся — показываем сердечко
    v.appendChild(im);
  }else v.innerHTML=HEART;
  return v;
}
// летящие вверх сердечки вокруг плашки
function hearts(box,total){
  var n=22,i;
  for(i=0;i<n;i++){
    var h=document.createElement('i'),ds=designOf();h.className='hp'+(i%3===0?' v':'');
    if(ds==='party'){h.className='hp cf';h.style.setProperty('--c',CONF[i%CONF.length]);}else h.textContent=HGLYPH[ds]||'\\u2665';
    h.style.left=(8+Math.random()*84)+'%';h.style.fontSize=(14+Math.random()*20)+'px';
    h.style.setProperty('--dx',(Math.random()*90-45)+'px');h.style.setProperty('--rot',(Math.random()*50-25)+'deg');
    h.style.animationDelay=(.15+Math.random()*Math.max(1,total*.55))+'s';h.style.animationDuration=(2.1+Math.random()*1.4)+'s';
    box.appendChild(h);
  }
}
function build(d,still){
  var c=document.createElement('div'),ds=designOf();c.className='al'+(DCLS[ds]?' '+DCLS[ds]:'')+(still?' still':'');
  c.appendChild(visual());
  var p=document.createElement('div');
  var nm=String(d.name||'Гость');
  var av=/^https?:\\/\\//.test(d.avatar||'')?d.avatar:'';
  p.className='plate'+(S.showAvatar?'':' noav');
  if(S.showAvatar){
    var a=document.createElement('div');a.className='av';
    if(av){a.style.backgroundImage='url("'+av.replace(/"/g,'%22')+'")';}
    else{a.style.background=colorOf(nm);a.textContent=nm.charAt(0).toUpperCase();}
    p.appendChild(a);
  }
  var x=document.createElement('div');x.className='tx';
  var cap=document.createElement('div');cap.className='cap';cap.textContent='Новый подписчик';
  var n=document.createElement('div');n.className='nm';n.textContent=nm;
  x.appendChild(cap);x.appendChild(n);p.appendChild(x);
  c.appendChild(p);
  c.style.zoom=zoomOf();
  return c;
}
var queue=[],busy=false,demoT=null,sticky=false;
function show(d){
  clearTimeout(demoT);sticky=false;
  var c=build(d,false);stage.innerHTML='';stage.appendChild(c);
  var ms=Math.max(2,+S.duration||6)*1000;
  hearts(c,ms/1000);
  setTimeout(function(){c.classList.add('out');setTimeout(function(){c.remove();busy=false;next();if(!busy)idle();},520);},ms);
}
function next(){if(busy||!queue.length)return;busy=true;loadImage().then(function(){show(queue.shift());});}
function add(d){queue.push(d);if(queue.length>20)queue.shift();next();}
// предпросмотр в приложении: когда ничего не идёт, висит образец — видно, как выглядит плашка с вашей картинкой и настройками
function idle(){
  if(!PREVIEW||busy||queue.length)return;
  clearTimeout(demoT);
  demoT=setTimeout(function(){
    if(busy||queue.length)return;
    loadImage().then(function(){
      if(busy||queue.length)return;
      stage.innerHTML='';stage.appendChild(build({name:'Анна К.'},true));sticky=true;
    });
  },700);
}
var Q=new URLSearchParams(location.search),FIXED=+Q.get('port')||0;
var REMOTE=!(/^(127\\.0\\.0\\.1|localhost)$/.test(location.hostname)&&!FIXED);
var PORTS=[];if(FIXED)PORTS=[FIXED];else for(var pp=7878;pp<=7898;pp++)PORTS.push(pp);
var nc=document.getElementById('nc'),ncT=null;
function offline(){if(REMOTE&&!ncT)ncT=setTimeout(function(){nc.style.display='block'},4000);}
function online(){clearTimeout(ncT);ncT=null;nc.style.display='none';}
var told=false;
function tellReady(){if(told)return;told=true;try{if(window.parent&&window.parent!==window)window.parent.postMessage({echochat:'alert-ready'},'*');}catch(_){}}
function bind(es){
  es.addEventListener('asettings',function(e){
    S=Object.assign(S,JSON.parse(e.data));apply();tellReady();
    // картинку или настройки поменяли — образец в предпросмотре рисуем заново
    if(PREVIEW&&sticky){sticky=false;loadImage().then(function(){if(!busy&&!queue.length){stage.innerHTML='';stage.appendChild(build({name:'Анна К.'},true));sticky=true;}});}
    else if(PREVIEW)idle();
  });
  es.addEventListener('alert',function(e){add(JSON.parse(e.data));});
  es.addEventListener('clear',function(){queue=[];});
}
function connect(){
  if(!REMOTE){BASE='';bind(new EventSource('/events'));return;}
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
