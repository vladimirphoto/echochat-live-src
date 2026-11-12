'use strict';
// Страница виджета «DonationAlerts» (прозрачный фон): по одному донату — картинка, имя, сумма в валюте перевода, сообщение.
// Оформления (8 штук) берутся из CSS виджета «Донаты Каспи», поэтому выглядят одинаково и всегда совпадают с ним.
// Настройки и донаты приходят от приложения по SSE (события dasettings / dadonate) и применяются на лету.
// Звук играет само приложение, а не эта страница: так он не звучит дважды (в предпросмотре и в OBS).
const DONATE = require('./widget-donate-page');
const m = /<style>([\s\S]*?)<\/style>/.exec(DONATE);
if (!m) throw new Error('widget-da-page: не нашли стили в widget-donate-page.js');
const CSS = m[1];

module.exports = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>DonationAlerts</title>
<style>${CSS}
/* картинка вместо эмодзи: своя или готовая из файла */
.art.pic{width:auto!important;height:auto!important;min-width:92px;min-height:92px;max-width:170px;max-height:130px;border-radius:14px!important;background:none!important;box-shadow:none!important;animation:bob 2.4s ease-in-out infinite}
.art.pic img{display:block;max-width:170px;max-height:130px;object-fit:contain;filter:drop-shadow(0 6px 14px rgba(0,0,0,.5))}
</style></head><body>
<div id="nc" style="display:none;position:fixed;left:10px;top:10px;z-index:9999;background:rgba(0,0,0,.65);color:#fff;font:600 13px/1.3 'Segoe UI',Arial,sans-serif;padding:7px 12px;border-radius:999px">Нет связи с приложением ЭхоЧат — запустите его на этом компьютере</div>
<div id="stage" class="c b"></div>
<script>
var PREVIEW=/[?&]preview=1/.test(location.search);
var S={duration:8,scale:100,showMessage:true,design:'classic',art:'',imageV:0};
var DESIGNS=['classic','neon','minimal','party','gold','arcade','glass','candy'];
var DCLS={neon:'d-neon',minimal:'d-min',party:'d-party',gold:'d-gold',arcade:'d-arc',glass:'d-glass',candy:'d-candy'};
function designOf(){return DESIGNS.indexOf(S.design)>=0?S.design:'classic';}
var stage=document.getElementById('stage');
// картинка «по сумме»: порог в тенге (приложение присылает сумму в тенге в поле kzt)
var TIERS=[
 {max:500,art:'\\u2615',cap:'Кофе',ac:'#f59e0b'},
 {max:2000,art:'\\ud83c\\udf55',cap:'Пицца',ac:'#fb7185'},
 {max:5000,art:'\\ud83c\\udf81',cap:'Подарок',ac:'#f14635'},
 {max:10000,art:'\\ud83d\\udc8e',cap:'Бриллиант',ac:'#22d3ee'},
 {max:Infinity,art:'\\ud83d\\ude80',cap:'Ракета',ac:'#a78bfa'}
];
function tierOf(a){for(var i=0;i<TIERS.length;i++)if(a<TIERS[i].max)return TIERS[i];return TIERS[TIERS.length-1];}
function zoomOf(){return Math.max(40,Math.min(250,+S.scale||100))/100;}
function apply(){
  stage.className='c '+(PREVIEW?'m':'b');
  var c=stage.firstChild;if(c&&c.style)c.style.zoom=zoomOf();
}
var BASE='',imgUrl='',imgFor=0;
// своя картинка: берём у приложения один раз на версию и держим в памяти
function loadImage(){
  var v=+S.imageV||0;
  if(!v){if(imgUrl){URL.revokeObjectURL(imgUrl);imgUrl='';}imgFor=0;return Promise.resolve();}
  if(imgFor===v&&imgUrl)return Promise.resolve();
  return fetch(BASE+'/da-image?v='+v,{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.blob();}).then(function(b){
    if(imgUrl)URL.revokeObjectURL(imgUrl);imgUrl=URL.createObjectURL(b);imgFor=v;
  }).catch(function(){if(imgUrl){URL.revokeObjectURL(imgUrl);}imgUrl='';imgFor=v;});
}
var queue=[],busy=false,curCard=null,curT1=0,curT2=0;
function sparks(card){
  for(var i=0;i<14;i++){var s=document.createElement('i');s.className='sp';var a=Math.random()*6.283,d=70+Math.random()*90;
    s.style.setProperty('--x',Math.cos(a)*d+'px');s.style.setProperty('--y',Math.sin(a)*d+'px');s.style.animationDelay=(Math.random()*.25)+'s';card.appendChild(s);}
}
function confetti(card){
  for(var i=0;i<28;i++){var s=document.createElement('i');s.className='sp cf';var a=Math.random()*6.283,d=90+Math.random()*130;
    s.style.setProperty('--c','hsl('+Math.floor(Math.random()*360)+',90%,60%)');s.style.setProperty('--x',Math.cos(a)*d+'px');s.style.setProperty('--y',(Math.sin(a)*d-40)+'px');
    s.style.setProperty('--r',(Math.random()*720-360)+'deg');s.style.animationDelay=(Math.random()*.3)+'s';card.appendChild(s);}
}
function hearts(card){
  for(var i=0;i<16;i++){var s=document.createElement('i');s.className='sp ht';s.textContent='\\u2665';
    s.style.setProperty('--c','hsl('+(325+Math.floor(Math.random()*30))+',85%,'+(55+Math.floor(Math.random()*15))+'%)');s.style.setProperty('--s',(14+Math.random()*16)+'px');
    s.style.setProperty('--x',(Math.random()*240-120)+'px');s.style.setProperty('--y',-(60+Math.random()*130)+'px');s.style.animationDelay=(Math.random()*.7)+'s';card.appendChild(s);}
}
function build(d){
  var t=tierOf(+d.kzt||0);
  var c=document.createElement('div');var ds=designOf();c.className='card'+(DCLS[ds]?' '+DCLS[ds]:'');c.style.setProperty('--ac',t.ac);
  var a=document.createElement('div');a.className='art';
  var cap='Донат';
  if(imgUrl){a.className='art pic';var im=document.createElement('img');im.alt='';im.src=imgUrl;a.appendChild(im);}
  else if(S.art){a.textContent=S.art;}
  else{a.textContent=t.art;cap='Донат · '+t.cap;}
  var x=document.createElement('div');x.className='tx';
  var cp=document.createElement('div');cp.className='cap';cp.textContent=cap;
  var nm=document.createElement('div');nm.className='nm';nm.textContent=d.name||'Аноним';
  var am=document.createElement('div');am.className='am';am.textContent=d.money||'';
  x.appendChild(cp);x.appendChild(nm);x.appendChild(am);
  if(S.showMessage&&d.message){var m=document.createElement('div');m.className='ms';m.textContent=d.message;x.appendChild(m);}
  c.style.zoom=zoomOf();c.appendChild(a);c.appendChild(x);
  return {el:c,ds:ds,ac:t.ac};
}
function show(d){
  loadImage().then(function(){
    var b=build(d),c=b.el;
    stage.innerHTML='';stage.appendChild(c);curCard=c;
    if(b.ds==='party')confetti(c);else if(b.ds==='candy')hearts(c);else sparks(c);
    var ms=Math.max(2,+S.duration||8)*1000;
    curT1=setTimeout(function(){c.classList.add('out');curT2=setTimeout(function(){c.remove();curCard=null;busy=false;next();},500);},ms);
  });
}
function next(){if(busy||!queue.length)return;busy=true;show(queue.shift());}
// пробный показ из приложения (выбрали шаблон или картинку) сразу заменяет текущую карточку, а не встаёт в очередь
function add(d){
  if(d.preview){clearTimeout(curT1);clearTimeout(curT2);if(curCard){curCard.remove();curCard=null;}queue=[];busy=false;}
  queue.push(d);if(queue.length>20)queue.shift();next();}
var Q=new URLSearchParams(location.search),FIXED=+Q.get('port')||0;
var REMOTE=!(/^(127\\.0\\.0\\.1|localhost)$/.test(location.hostname)&&!FIXED);
var PORTS=[];if(FIXED)PORTS=[FIXED];else for(var pp=7878;pp<=7898;pp++)PORTS.push(pp);
var nc=document.getElementById('nc'),ncT=null;
function offline(){if(REMOTE&&!ncT)ncT=setTimeout(function(){nc.style.display='block'},4000);}
function online(){clearTimeout(ncT);ncT=null;nc.style.display='none';}
var told=false;
function tellReady(){if(told)return;told=true;try{if(window.parent&&window.parent!==window)window.parent.postMessage({echochat:'da-ready'},'*');}catch(_){}}
function bind(es){
  es.addEventListener('dasettings',function(e){S=Object.assign(S,JSON.parse(e.data));apply();loadImage();tellReady();});
  es.addEventListener('dadonate',function(e){add(JSON.parse(e.data));});
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
