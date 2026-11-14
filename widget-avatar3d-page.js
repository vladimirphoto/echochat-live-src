'use strict';
// Страница виджета «3D аватар»: модель VRM повторяет лицо с камеры (three.js + three-vrm).
// Камеру и поиск лица делает окно приложения, сюда приходят только числа (SSE-событие aframe, ключи V_...) — картинка с камеры никуда не уходит.
// Библиотеки и файл модели страница берёт у локального сервера приложения: /avatar-lib и /avatar-vrm.
module.exports = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>3D аватар</title>
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
var BASE='',S={},V={},tracking=false,lastFrame=0,STALE_MS=800;
var T=null,VRMLIB=null,GLTFLoader=null,renderer=null,scene=null,camera=null,vrm=null,libsP=null,loadedKey='',gen=0,frame={cx:0,cy:1.2,d:2,fov:30};
var arms=null,nextBlink=0,blinkT=-1,clockT=0;
function live(){return tracking&&Date.now()-lastFrame<STALE_MS;}
function cl(v,a,b){return Math.max(a,Math.min(b,v));}
function libs(){
  if(libsP)return libsP;
  libsP=Promise.all([import(BASE+'/avatar-lib/three/three.module.js'),import(BASE+'/avatar-lib/three/addons/loaders/GLTFLoader.js'),import(BASE+'/avatar-lib/vrm/three-vrm.module.js')]).then(function(m){
    T=m[0];GLTFLoader=m[1].GLTFLoader;VRMLIB=m[2];
    renderer=new T.WebGLRenderer({alpha:true,antialias:true,premultipliedAlpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setSize(window.innerWidth,window.innerHeight);
    renderer.setClearColor(0x000000,0);
    document.body.appendChild(renderer.domElement);
    scene=new T.Scene();
    camera=new T.PerspectiveCamera(frame.fov,window.innerWidth/window.innerHeight,0.05,50);
    var sun=new T.DirectionalLight(0xffffff,Math.PI);sun.position.set(1,1.2,1.5);scene.add(sun);
    scene.add(new T.AmbientLight(0xffffff,0.45));
    requestAnimationFrame(tick);
  });
  libsP.catch(function(){libsP=null;});
  return libsP;
}
function bone(n){return vrm&&vrm.humanoid?vrm.humanoid.getNormalizedBoneNode(n):null;}
// Кадр: средний план (голова и плечи). Размер и сдвиг из настроек двигают камеру, а не модель
function layout(){
  if(!camera||!renderer)return;
  var W=window.innerWidth,H=window.innerHeight,k=(+S.scale||100)/100,t=Math.tan(frame.fov*Math.PI/360);
  var d=frame.d/k,halfH=d*t,halfW=halfH*W/H;
  var x=frame.cx-((+S.offsetX||0)/100)*halfW,y=frame.cy+((+S.offsetY||0)/100)*halfH;
  camera.aspect=W/H;camera.position.set(x,y,d);camera.lookAt(x,y,0);camera.updateProjectionMatrix();
}
function onResize(){if(!renderer)return;renderer.setSize(window.innerWidth,window.innerHeight);layout();}
window.addEventListener('resize',onResize);
function frameModel(){
  var box=new T.Box3().setFromObject(vrm.scene),h=Math.max(0.3,box.max.y-box.min.y);
  var head=bone('head'),hy=h*0.85;
  if(head){var p=new T.Vector3();head.getWorldPosition(p);if(p.y>0)hy=p.y;}
  var vis=h*0.5; // сколько метров по высоте видно в кадре
  frame.cy=hy-vis*0.12;frame.cx=0;frame.d=(vis/2)/Math.tan(frame.fov*Math.PI/360);
}
function raw(n){try{return vrm.humanoid.getRawBoneNode(n);}catch(_){return null;}}
function poseArms(){ // у VRM руки по умолчанию разведены в стороны (T-поза): опускаем. Знак поворота зависит от версии VRM (0.x и 1.0 смотрят в разные стороны), поэтому выбираем тот, при котором локоть оказывается ниже плеча
  [['left',-1],['right',1]].forEach(function(side){
    var up=bone(side[0]+'UpperArm'),lo=bone(side[0]+'LowerArm');
    if(!up)return;
    var best=side[1],drop=null;
    if(lo){
      var pu=new T.Vector3(),pl=new T.Vector3(),res=[];
      [side[1],-side[1]].forEach(function(sg){
        up.rotation.z=sg*1.25;vrm.update(0);var ru=raw(side[0]+'UpperArm'),rl=raw(side[0]+'LowerArm');
        if(ru&&rl){ru.updateWorldMatrix(true,false);rl.updateWorldMatrix(true,false);ru.getWorldPosition(pu);rl.getWorldPosition(pl);}res.push(pl.y-pu.y);
      });
      best=res[0]<=res[1]?side[1]:-side[1];
    }
    up.rotation.z=best*1.25;
    if(lo)lo.rotation.z=best*0.1;
  });
}
// Знак наклона и поворота «ухо к плечу» зависит от версии VRM: у VRM 0.x (после rotateVRM0) оси X и Z нормализованных костей зеркальны.
// Поэтому проверяем на самой модели: чуть наклоняем голову и смотрим, куда сместились глаза. xs: +1 — плюс по X поднимает лицо вверх; zs: +1 — плюс по Z наклоняет голову вправо по экрану. Без проверки (нет костей глаз) берём версию модели
var AX={xs:-1,zs:-1};
function detectAxes(){
  AX={xs:-1,zs:-1};
  var head=bone('head');
  try{
    var le=raw('leftEye'),re=raw('rightEye');
    if(head&&le&&re){
      var a=new T.Vector3(),b=new T.Vector3();
      var eyes=function(){vrm.update(0);le.getWorldPosition(a);re.getWorldPosition(b);return new T.Vector3().addVectors(a,b).multiplyScalar(0.5);};
      head.rotation.set(0,0,0);var p0=eyes();
      head.rotation.set(0.15,0,0);var px=eyes();
      head.rotation.set(0,0,0.15);var pz=eyes();
      head.rotation.set(0,0,0);vrm.update(0);
      if(Math.abs(px.y-p0.y)>1e-5)AX.xs=px.y>p0.y?1:-1;
      if(Math.abs(pz.x-p0.x)>1e-5)AX.zs=pz.x<p0.x?-1:1; // плюс по Z против часовой: глаза уезжают влево по экрану, тогда вправо наклоняет минус
      return;
    }
  }catch(_){}
  if(head)head.rotation.set(0,0,0);
  if(vrm&&vrm.meta&&vrm.meta.metaVersion==='0'){AX.xs=1;AX.zs=1;}
}
function setExp(n,v){var m=vrm&&vrm.expressionManager;if(m&&m.getExpression(n))m.setValue(n,v);}
function drive(dt,now){
  if(!vrm)return;
  var sign=S.mirror?-1:1,r=Math.PI/180;
  var head=bone('head'),neck=bone('neck'),chest=bone('upperChest')||bone('chest');
  if(live()){
    var yaw=(V.V_yaw||0)*sign,pit=V.V_pitch||0,rol=(V.V_roll||0)*sign;
    // поворот головы делят шея, голова и немного грудь: так естественнее
    var px=AX.xs*pit*r,pz=AX.zs*rol*r; // голова вверх (pit>0) должна поднимать лицо у любой версии VRM
    if(head)head.rotation.set(px*0.6,yaw*r*0.6,pz*0.6);
    if(neck)neck.rotation.set(px*0.3,yaw*r*0.3,pz*0.3);
    if(chest)chest.rotation.set(px*0.1,yaw*r*0.1,pz*0.1);
    setExp('blink',0);setExp('blinkLeft',V.V_blinkL||0);setExp('blinkRight',V.V_blinkR||0);
    setExp('aa',V.V_aa||0);setExp('happy',V.V_happy||0);
    if(vrm.lookAt){vrm.lookAt.yaw=(V.V_lookX||0)*sign*25;vrm.lookAt.pitch=(V.V_lookY||0)*20;}
  }else{
    // трекер молчит: дыхание, покачивание и моргание, чтобы аватар не «замерзал»
    var s=Math.sin(now/1000*1.6);
    if(head)head.rotation.set(0.02*s,0.05*Math.sin(now/1000*0.5),0);
    if(neck)neck.rotation.set(0,0,0);
    if(chest)chest.rotation.set(0.012*s,0,0);
    setExp('blinkLeft',0);setExp('blinkRight',0);setExp('aa',0);setExp('happy',0);
    if(now>nextBlink&&blinkT<0){blinkT=0;}
    if(blinkT>=0){blinkT+=dt;var ph=blinkT/0.18;setExp('blink',ph<1?Math.sin(ph*Math.PI):0);if(ph>=1){blinkT=-1;nextBlink=now+2500+Math.random()*3500;setExp('blink',0);}}
  }
  vrm.update(dt);
}
function tick(now){
  requestAnimationFrame(tick);
  var dt=clockT?Math.min((now-clockT)/1000,0.1):0.016;clockT=now;
  if(vrm)drive(dt,now);
  if(renderer&&scene&&camera)renderer.render(scene,camera);
}
function modelUrl(){return BASE+'/avatar-vrm/'+encodeURIComponent(S.model)+'.vrm';}
function dispose(){
  if(!vrm)return;
  scene.remove(vrm.scene);
  try{VRMLIB.VRMUtils.deepDispose(vrm.scene);}catch(_){}
  vrm=null;
}
function loadModel(){
  var key=String(S.model),my=++gen;
  if(key===loadedKey&&vrm){layout();return;}
  say('Загрузка модели…');
  libs().then(function(){
    if(my!==gen)return null;
    var loader=new GLTFLoader();
    loader.register(function(p){return new VRMLIB.VRMLoaderPlugin(p);});
    return loader.loadAsync(modelUrl());
  }).then(function(gltf){
    if(!gltf)return;
    var m=gltf.userData.vrm;
    if(!m)throw new Error('not vrm');
    if(my!==gen){try{VRMLIB.VRMUtils.deepDispose(m.scene);}catch(_){}return;}
    dispose();
    try{VRMLIB.VRMUtils.rotateVRM0(m);}catch(_){} // VRM 0.x смотрят в другую сторону: разворачиваем
    m.scene.traverse(function(o){o.frustumCulled=false;});
    vrm=m;loadedKey=key;scene.add(m.scene);poseArms();detectAxes();vrm.update(0);frameModel();nextBlink=0;layout();say('');
  }).catch(function(e){
    dispose();loadedKey='';
    say('Не удалось загрузить 3D-аватар. Откройте вкладку «Аватар» в ЭхоЧат, режим 3D, и проверьте компоненты и модель.');
    try{console.error('avatar3d',e);}catch(_){}
  });
}
function apply(){
  document.body.style.background=S.bg==='green'?'#00b140':'transparent';
  if(S.ready===false){say('Компоненты 3D ещё не установлены: вкладка «Аватар» в ЭхоЧат → 3D → «Скачать компоненты».');return;}
  if(!S.model){say('Модель не выбрана: вкладка «Аватар» в ЭхоЧат, режим 3D.');return;}
  loadModel();layout();
}
// Предпросмотр в приложении: колесо мыши — размер, перетаскивание левой кнопкой — сдвиг, двойной щелчок — сброс
var PREVIEW=window.parent!==window,drag=null,sendT=0,hold=0;
function viewSend(force){var n=Date.now();hold=n+500;if(!force&&n-sendT<60)return;sendT=n;try{window.parent.postMessage({echochat:'avatar-view',engine:'3d',scale:Math.round(+S.scale||100),offsetX:Math.round(+S.offsetX||0),offsetY:Math.round(+S.offsetY||0)},'*');}catch(_){}}
if(PREVIEW){
  document.body.style.cursor='grab';
  window.addEventListener('wheel',function(e){if(!vrm)return;e.preventDefault();S.scale=cl((+S.scale||100)*Math.exp(-e.deltaY*0.0015),40,250);layout();viewSend();},{passive:false});
  window.addEventListener('pointerdown',function(e){if(!vrm||e.button!==0)return;drag={x:e.clientX,y:e.clientY,ox:+S.offsetX||0,oy:+S.offsetY||0};try{document.body.setPointerCapture(e.pointerId);}catch(_){}document.body.style.cursor='grabbing';});
  window.addEventListener('pointermove',function(e){if(!drag)return;S.offsetX=cl(drag.ox+(e.clientX-drag.x)/(window.innerWidth/2)*100,-100,100);S.offsetY=cl(drag.oy+(e.clientY-drag.y)/(window.innerHeight/2)*100,-100,100);layout();viewSend();});
  var drop=function(){if(!drag)return;drag=null;document.body.style.cursor='grab';viewSend(true);};
  window.addEventListener('pointerup',drop);window.addEventListener('pointercancel',drop);
  window.addEventListener('dblclick',function(){if(!vrm)return;S.scale=100;S.offsetX=0;S.offsetY=0;layout();viewSend(true);});
}
function bind(es){
  es.addEventListener('av3settings',function(e){var d;try{d=JSON.parse(e.data)||{};}catch(_){return;}
    if(drag||Date.now()<hold){d.scale=S.scale;d.offsetX=S.offsetX;d.offsetY=S.offsetY;} // пока человек двигает или масштабирует, чужой «старый» ответ не перебивает
    S=d;apply();});
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
