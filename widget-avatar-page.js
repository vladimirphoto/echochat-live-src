'use strict';
// Страница виджета «Аватар»: Live2D-персонаж на прозрачном фоне, повторяет лицо с камеры.
// Камеру и поиск лица делает окно приложения (скрытое окно трекера), сюда приходят только готовые числа параметров по SSE (событие aframe) — картинка с камеры никуда не уходит.
// Рисовальные библиотеки (PixiJS, Live2D, ядро Cubism) и файлы модели страница берёт у локального сервера приложения: /avatar-lib и /avatar-model.
module.exports = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Аватар</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;font-family:"Segoe UI",Arial,sans-serif}
canvas{display:block;position:fixed;left:0;top:0}
#msg{position:fixed;left:10px;right:10px;bottom:10px;display:none;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.72);color:#fff;font-size:14px;line-height:1.4;text-align:center}
#nc{position:fixed;left:10px;top:10px;display:none;padding:5px 10px;border-radius:8px;background:rgba(0,0,0,.65);color:#fbbf24;font-size:13px}
</style></head><body>
<div id="nc">Нет связи с приложением ЭхоЧат LIVE</div>
<div id="msg"></div>
<script>
var Q=new URLSearchParams(location.search),FIXED=+Q.get('port')||0;
var REMOTE=!(/^(127\\.0\\.0\\.1|localhost)$/.test(location.hostname)&&!FIXED);
var PORTS=[];if(FIXED)PORTS=[FIXED];else for(var pp=7878;pp<=7898;pp++)PORTS.push(pp);
var SHOWMSG=window.parent!==window||Q.has('debug'); // подсказки об ошибках видны в предпросмотре приложения, а в OBS страница остаётся чистой
var msg=document.getElementById('msg'),nc=document.getElementById('nc'),ncT=null;
function say(t){if(!SHOWMSG)return;msg.textContent=t||'';msg.style.display=t?'block':'none';}
function offline(){if(REMOTE&&!ncT)ncT=setTimeout(function(){nc.style.display='block'},4000);}
function online(){clearTimeout(ncT);ncT=null;nc.style.display='none';}
var BASE='',S={},V={},tracking=false,lastFrame=0;
var app=null,model=null,libsP=null,loadedKey='',gen=0;
var STALE_MS=800; // нет кадров от трекера дольше — персонаж снова сам моргает и дышит
function live(){return tracking&&Date.now()-lastFrame<STALE_MS;}
function loadScript(src){return new Promise(function(ok,bad){var s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=function(){bad(new Error(src))};document.head.appendChild(s);});}
function libs(){
  if(libsP)return libsP;
  libsP=loadScript(BASE+'/avatar-lib/pixi.min.js').then(function(){return loadScript(BASE+'/avatar-lib/live2dcubismcore.min.js');}).then(function(){return loadScript(BASE+'/avatar-lib/cubism4.min.js');}).then(function(){
    try{PIXI.live2d.Live2DModel.registerTicker(PIXI.Ticker);}catch(_){}
    try{PIXI.extensions.remove(PIXI.InteractionManager,PIXI.AccessibilityManager);}catch(_){} // по странице никто не кликает: лишние проверки указателя не нужны
    app=new PIXI.Application({backgroundAlpha:0,antialias:true,resizeTo:window,autoDensity:true,resolution:window.devicePixelRatio||1});
    document.body.appendChild(app.view);
  });
  libsP.catch(function(){libsP=null;});
  return libsP;
}
function layout(){
  if(!model||!app)return;
  var iw=model.internalModel.width||1,ih=model.internalModel.height||1,W=window.innerWidth,H=window.innerHeight;
  var k=Math.min(W/iw,H/ih)*0.95*((+S.scale||100)/100);
  model.anchor.set(0.5,0.5);
  model.scale.set(k);
  model.position.set(W/2+((+S.offsetX||0)/100)*W/2,H/2+((+S.offsetY||0)/100)*H/2);
}
function hook(m){
  var internal=m.internalModel,core=internal.coreModel,blink=internal.eyeBlink;
  // ставим значения от трекера после движений модели, но до дыхания, фокуса и физики: волосы и одежда следуют за головой
  internal.on('beforeMotionUpdate',function(){internal.eyeBlink=live()?undefined:blink;});
  internal.on('afterMotionUpdate',function(){if(!live())return;for(var id in V)core.setParameterValueById(id,V[id]);});
  var nat=internal.updateNaturalMovements.bind(internal);
  internal.updateNaturalMovements=function(dt,now){
    if(!live())return nat(dt,now);
    var ids=Object.keys(V),saved=ids.map(function(id){return core.getParameterValueById(id);});
    nat(dt,now); // дыхание и «взгляд» не должны сдвигать то, что задал трекер
    for(var i=0;i<ids.length;i++)core.setParameterValueById(ids[i],saved[i]);
  };
}
function entryUrl(){return BASE+'/avatar-model/'+encodeURIComponent(S.model)+'/'+String(S.entry).split('/').map(encodeURIComponent).join('/');}
function loadModel(){
  var key=S.model+'|'+S.entry,my=++gen;
  if(key===loadedKey&&model){layout();return;}
  say('Загрузка модели…');
  libs().then(function(){
    if(my!==gen)return null;
    return PIXI.live2d.Live2DModel.from(entryUrl(),{autoInteract:false,motionPreload:'NONE',idleMotionGroup:'__none__'});
  }).then(function(m){
    if(!m)return;
    if(my!==gen){try{m.destroy();}catch(_){}return;}
    if(model){app.stage.removeChild(model);try{model.destroy();}catch(_){}}
    model=m;loadedKey=key;hook(m);app.stage.addChild(m);layout();say('');
  }).catch(function(e){
    model=null;loadedKey='';
    say('Не удалось загрузить аватар. Откройте вкладку «Аватар» в ЭхоЧат и проверьте компоненты и модель.');
    try{console.error('avatar',e);}catch(_){}
  });
}
function apply(){
  document.body.style.background=S.bg==='green'?'#00b140':'transparent';
  if(S.ready===false){say('Компоненты аватара ещё не установлены: вкладка «Аватар» в ЭхоЧат → «Скачать компоненты».');return;}
  if(!S.model||!S.entry){say('Модель не выбрана: вкладка «Аватар» в ЭхоЧат.');return;}
  loadModel();
}
window.addEventListener('resize',layout);
function bind(es){
  es.addEventListener('avsettings',function(e){try{S=JSON.parse(e.data)||{};}catch(_){return;}apply();});
  es.addEventListener('aframe',function(e){
    var d;try{d=JSON.parse(e.data);}catch(_){return;}
    if(d&&d.p){V=d.p;tracking=true;lastFrame=Date.now();}
    else if(d&&d.lost){tracking=false;V={};}
  });
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
connect();
</script></body></html>`;
