'use strict';
// Страница виджета «Топ лайков»: 5–10 закруглённых квадратиков с аватарками, под каждым — ник.
// Настройки (сколько показывать, масштаб, выравнивание) приходят от приложения по SSE и применяются на лету.
module.exports = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Топ лайков</title>
<style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI",Arial,sans-serif;height:100%}
#root{position:fixed;left:0;top:0;display:flex;flex-wrap:wrap;justify-content:center;align-content:center;gap:18px 16px;padding:10px;box-sizing:border-box;width:640px;transform-origin:top left}
.t{width:108px;display:flex;flex-direction:column;align-items:center;gap:6px;color:#fff;animation:in .3s ease-out}
.a{position:relative;width:108px;height:108px;border-radius:25px;background:#6b7280 center/cover no-repeat;display:grid;place-items:center;font-weight:700;font-size:42px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.r{position:absolute;left:7px;top:7px;min-width:26px;height:26px;padding:0 6px;box-sizing:border-box;border-radius:13px;background:rgba(0,0,0,.62);font-size:15px;font-weight:700;line-height:26px;text-align:center}
.t:nth-of-type(1) .r{background:#f5b301;color:#2a1c00}.t:nth-of-type(2) .r{background:#cfd4dc;color:#1c2230}.t:nth-of-type(3) .r{background:#c98542;color:#2b1800}
.l{display:flex;align-items:center;justify-content:center;gap:5px;min-width:64px;height:30px;padding:0 12px;box-sizing:border-box;border-radius:15px;background:rgba(0,0,0,.72);color:#fff;font-size:20px;font-weight:800;line-height:30px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.l i{font-style:normal;color:#ff4d6d;font-size:18px}
.n{max-width:112px;font-size:19px;font-weight:700;text-align:center;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh .n{text-shadow:0 0 3px rgba(0,0,0,.95),0 1px 4px rgba(0,0,0,.9),0 2px 8px rgba(0,0,0,.8)}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes lk{50%{transform:scale(1.25);background:#ff4d6d}}
.t.bl .l{animation:lk .45s ease-in-out 2}
/* удар рукой: слой с рукой лежит над всеми плитками, кроме первой, — так рука «выходит» из аватарки лидера и ложится поверх 2 места */
.t:nth-of-type(1){z-index:3}
#fx{position:absolute;left:0;top:0;width:0;height:0;z-index:2;pointer-events:none}
.hd{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;will-change:transform}
.arm{position:absolute;left:0;top:-9px;height:18px;box-sizing:border-box;background:linear-gradient(#ffd9b0,#f2b27c);border:3px solid #7a3f17;border-left:0;border-right:0}
.gp{position:absolute;left:0;top:0;will-change:transform}
.cuff{position:absolute;left:-86px;top:-17px;width:22px;height:34px;box-sizing:border-box;border-radius:7px;background:linear-gradient(90deg,#fff,#dfe5f2);border:3px solid #7a3f17}
.fist{position:absolute;left:-68px;top:-26px;width:68px;height:52px;overflow:visible}
.bs{position:absolute;width:0;height:0}
.bs i{position:absolute;left:-3px;top:-9px;width:6px;height:18px;border-radius:3px;background:#fff3a8;box-shadow:0 0 0 2px #7a3f17}
</style></head><body class="sh">
<div id="nc" style="display:none;position:fixed;left:10px;top:10px;z-index:9999;background:rgba(0,0,0,.65);color:#fff;font:600 13px/1.3 'Segoe UI',Arial,sans-serif;padding:7px 12px;border-radius:999px">Нет связи с приложением ЭхоЧат — запустите его на этом компьютере</div><div id="root"><aside id="fx"></aside></div>
<script>
var S={count:5,scale:100,align:'center',showCount:true,showRank:true,shadow:true,punch:true},PK=1,LIST=[],PREV={},TOP=null,FX=null;
var root=document.getElementById('root');
var COLORS=['#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6','#a855f7','#f97316','#22c55e'];
function colorOf(s){var h=0,i;for(i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return COLORS[h%COLORS.length];}
function fmt(n){n=+n||0;if(n>=1e6)return (n/1e6).toFixed(n>=1e7?0:1).replace('.0','')+'M';if(n>=1e4)return (n/1e3).toFixed(n>=1e5?0:1).replace('.0','')+'K';return String(n);}
function apply(){
  var sc=Math.max(30,Math.min(300,+S.scale||100))/100*PK;
  document.body.className=S.shadow?'sh':'';
  root.style.transform='scale('+sc+')';
  root.style.height=(100/sc)+'vh';
  // ряд всегда 640 px, по центру экрана (и по вертикали через align-content)
  // левый край блока с учётом масштаба: (ширина экрана − видимая ширина ряда) / 2
  root.style.left='calc((100vw - '+(640*sc)+'px) / 2)';
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
    l.innerHTML='<i>♥</i>';l.appendChild(document.createTextNode(fmt(d.likes)));l.style.display=S.showCount?'':'none';
    t.querySelector('.n').textContent=nm;
    // лайки выросли — мигаем плашкой (первая отрисовка без мигания)
    if(PREV[nm]!==undefined&&d.likes>PREV[nm]){t.classList.remove('bl');void t.offsetWidth;t.classList.add('bl');}
    PREV[nm]=d.likes;
  }
}
// ---- удар рукой: зритель вышел на 1 место — из аватарки лидера выскакивает рука и бьёт по аватарке 2 места, та трясётся
var FIST='<svg class="fist" viewBox="0 0 68 52"><g stroke="#7a3f17" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" fill="#ffd1a0"><path d="M3 11Q3 5 10 5H42Q65 5 65 17V35Q65 47 42 47H10Q3 47 3 41Z"/><path d="M44 16.5H64M44 26H65M44 35.5H64" fill="none"/><rect x="20" y="30" width="32" height="15" rx="7.5" fill="#ffc48a"/></g></svg>';
function eOB(x){var c=1.70158;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2);}
function eOC(x){return 1-Math.pow(1-x,3);}
function eIC(x){return x*x*x;}
function eIO(x){return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;}
function stopFx(){if(!FX)return;cancelAnimationFrame(FX.raf);FX.hd.remove();FX=null;}
function shake(a){ // слегка трясём аватарку, по которой попали: размах до 9 px
  if(!a||!a.animate)return;
  a.animate([{transform:'none'},{transform:'translate(9px,-2px) rotate(4deg)',offset:.14},{transform:'translate(-7px,1px) rotate(-3.5deg)',offset:.3},{transform:'translate(5px,0) rotate(2.5deg)',offset:.46},{transform:'translate(-3px,0) rotate(-1.5deg)',offset:.62},{transform:'translate(2px,0) rotate(1deg)',offset:.78},{transform:'none'}],{duration:520,easing:'ease-out'});
}
function burst(x,y){ // «звёздочка» удара в точке попадания
  var b=document.createElement('div'),i,s='',r;
  b.className='bs';b.style.left=x+'px';b.style.top=y+'px';
  for(i=0;i<8;i++)s+='<i></i>';
  b.innerHTML=s;document.getElementById('fx').appendChild(b);
  for(i=0;i<8;i++){r=b.children[i];if(r.animate)r.animate([{transform:'rotate('+i*45+'deg) translateY(-16px) scaleY(.5)',opacity:1},{transform:'rotate('+i*45+'deg) translateY(-42px) scaleY(1)',opacity:0}],{duration:360,easing:'ease-out',fill:'forwards'});}
  setTimeout(function(){b.remove();},450);
}
function punch(){
  var ts=root.getElementsByClassName('t');
  if(FX||ts.length<2)return;
  var a1=ts[0].firstChild,a2=ts[1].firstChild;
  // рука растёт из центра аватарки 1 (её закрывает сама плитка, поэтому видно только то, что вылезло наружу) и целится в левую верхнюю часть аватарки 2
  var px=a1.offsetLeft+a1.offsetWidth/2,py=a1.offsetTop+a1.offsetHeight/2;
  var dx=a2.offsetLeft+a2.offsetWidth*.34-px,dy=a2.offsetTop+a2.offsetHeight*.42-py;
  var ha=Math.atan2(dy,dx)*180/Math.PI,hr=Math.sqrt(dx*dx+dy*dy),hrad=ha*Math.PI/180;
  var hd=document.createElement('div');hd.className='hd';
  hd.innerHTML='<div class="arm"></div><div class="gp"><div class="cuff"></div>'+FIST+'</div>';
  var arm=hd.firstChild,gp=hd.lastChild;
  // этапы [мс, угол°, радиус px, плавность]: выскакивает вверх → замирает → замах назад → удар → отдача → прячется в аватарку
  var SEG=[[260,-90,92,eOB],[90,-90,92,null],[170,-124,78,eOC],[150,ha,hr,eIC],[110,ha,hr-8,eOC],[330,ha,30,eIO]];
  var k,HIT=0,END=0,st=null,hit=false;
  for(k=0;k<SEG.length;k++){END+=SEG[k][0];if(k<4)HIT=END;}
  function pose(t){
    var i,a=-90,r=30,d,e;
    for(i=0;i<SEG.length;i++){
      d=SEG[i][0];
      if(t<d){e=SEG[i][3]?SEG[i][3](t/d):t/d;return [a+(SEG[i][1]-a)*e,r+(SEG[i][2]-r)*e];}
      t-=d;a=SEG[i][1];r=SEG[i][2];
    }
    return [a,r];
  }
  function draw(t){
    var p=pose(t);
    hd.style.transform='translate('+px+'px,'+py+'px) rotate('+p[0]+'deg)';
    arm.style.width=Math.max(0,p[1]-70)+'px';
    gp.style.transform='translateX('+p[1]+'px)';
  }
  function step(now){
    if(st===null)st=now;
    var t=Math.max(0,now-st);
    draw(t);
    if(!hit&&t>=HIT){hit=true;shake(a2);burst(px+hr*Math.cos(hrad),py+hr*Math.sin(hrad));}
    if(t>=END){stopFx();return;}
    FX.raf=requestAnimationFrame(step);
  }
  draw(0);
  document.getElementById('fx').appendChild(hd);
  FX={hd:hd,raf:0};
  FX.raf=requestAnimationFrame(step);
}
function lead(){ // смена лидера: прежнего лидера (теперь он на 2 месте) бьёт новый
  var top=LIST.length?String(LIST[0].name||'Гость'):null,prev=TOP;
  TOP=top;
  if(!LIST.length)stopFx();
  if(prev!==null&&top!==null&&top!==prev&&S.punch!==false&&LIST.length>1)punch();
}
var Q=new URLSearchParams(location.search),FIXED=+Q.get('port')||0;
var REMOTE=!(/^(127\\.0\\.0\\.1|localhost)$/.test(location.hostname)&&!FIXED);
var PORTS=[];if(FIXED)PORTS=[FIXED];else for(var pp=7878;pp<=7898;pp++)PORTS.push(pp);
var nc=document.getElementById('nc'),ncT=null;
function offline(){if(REMOTE&&!ncT)ncT=setTimeout(function(){nc.style.display='block'},4000);}
function online(){clearTimeout(ncT);ncT=null;nc.style.display='none';}
var told=false;
function tellReady(){if(told)return;told=true;try{if(window.parent&&window.parent!==window)window.parent.postMessage({echochat:'likes-ready'},'*');}catch(_){}}
// предпросмотр в приложении: масштаб подгоняет приложение (iframe сам не масштабируется)
window.addEventListener('message',function(e){var d=e.data;if(window.parent!==window&&e.source===window.parent&&d&&d.echochat==='fit'){var k=+d.k;if(k>0.1&&k<=1.5&&k!==PK){PK=k;apply();}}});
function bind(es){
  es.addEventListener('lsettings',function(e){S=Object.assign(S,JSON.parse(e.data));apply();tellReady();});
  es.addEventListener('likes',function(e){var d=JSON.parse(e.data);LIST=Array.isArray(d)?d:[];render();lead();});
  es.addEventListener('clear',function(){LIST=[];TOP=null;stopFx();render();});
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
