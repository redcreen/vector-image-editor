(function(root){
 'use strict';
 const copy=v=>JSON.parse(JSON.stringify(v));
 // Extract a seam without touching its original nodes or handles.
 function cut(G,path,start,end,otherSide=false){
  let a={...start},b={...end},reverse=false;
  const count=G.segmentCount(path),order=p=>p.index+p.t;
  if(!path.closed&&order(a)>order(b)||path.closed&&otherSide){[a,b]=[b,a];reverse=true;}
  let last=b.index;if(path.closed&&order(b)<=order(a))last+=count;
  const nodes=[];
  for(let i=a.index;i<=last;i++){
   const j=i%count,lo=i===a.index?a.t:0,hi=i===last?b.t:1;
   if(hi-lo<1e-9)continue;
   const part={closed:false,nodes:[copy(path.nodes[j]),copy(path.nodes[(j+1)%path.nodes.length])]};
   if(hi<1)G.split(part,0,hi);
   part.nodes=part.nodes.slice(0,2);
   if(lo>0){G.split(part,0,lo/hi);part.nodes=part.nodes.slice(1);}
   if(nodes.length)nodes.at(-1).out=copy(part.nodes[0].out);else nodes.push(part.nodes[0]);
   nodes.push(part.nodes[1]);
  }
  if(nodes.length<2)throw Error('请在同一条缝边上选择两个不同位置');
  if(!path.closed&&otherSide)reverse=!reverse;
  if(reverse){nodes.reverse();for(const n of nodes)[n.in,n.out]=[n.out,n.in];}
  nodes[0].in=G.point(nodes[0]);nodes.at(-1).out=G.point(nodes.at(-1));
  return {closed:false,nodes};
 }
 // Carry a complete notch along the original seam as a rigid shape.
 function moveMark(G,W,path,track,from,to){
  const a=W.at(track,from),b=W.at(track,to),c=a.tangent.x*b.tangent.x+a.tangent.y*b.tangent.y,s=a.tangent.x*b.tangent.y-a.tangent.y*b.tangent.x;
  const point=p=>{const x=p.x-a.point.x,y=p.y-a.point.y;return {x:b.point.x+c*x-s*y,y:b.point.y+s*x+c*y};};
  return path.nodes.map(n=>({...n,...point(n),in:point(n.in),out:point(n.out)}));
 }
 function selection(G,path,indices){
  const set=new Set(indices);if(set.size<2)return null;
  const n=path.nodes.length;for(const i of set)if(!Number.isInteger(i)||i<0||i>=n)throw Error('请框选同一条轮廓上的连续节点');
  let start,end;
  if(path.closed){
   if(set.size===n)return [{index:0,t:0},{index:n-1,t:1}];
   const starts=[...set].filter(i=>!set.has((i+n-1)%n));if(starts.length!==1)throw Error('所选节点不连续，请框选一段连续节点');
   start=starts[0];end=start;let used=1;while(set.has((end+1)%n)){end=(end+1)%n;used++;}if(used!==set.size)throw Error('所选节点不连续');
  }else{const sorted=[...set].sort((a,b)=>a-b);start=sorted[0];end=sorted.at(-1);if(end-start+1!==set.size)throw Error('所选节点不连续，请框选一段连续节点');}
  return [{index:start,t:0},{index:(end+n-1)%n,t:1}];
 }
 function interval(G,path,points){
  const count=G.segmentCount(path),order=p=>p.index+p.t;let a=order(points[0]),b=order(points[1]);
  if(path.closed){a=((a%count)+count)%count;b=((b%count)+count)%count;if(b<=a)b+=count;}else if(b<a)[a,b]=[b,a];
  return {a,b,count};
 }
 function spansInRange(G,path,points){
  const {a,b,count}=interval(G,path,points),spans=[];
  for(let i=Math.floor(a);i<=Math.floor(b);i++){const lo=Math.max(0,a-i),hi=Math.min(1,b-i);if(hi-lo>1e-9)spans.push({index:i%count,lo,hi});}
  return spans;
 }
 function inside(G,path,points,index,t){const {a,b,count}=interval(G,path,points);let value=index+t;if(path.closed){value=((value%count)+count)%count;if(value<a-1e-8)value+=count;}return value>=a-1e-8&&value<=b+1e-8;}
 function remainder(G,path,points){
  const {a,b,count}=interval(G,path,points);if(path.closed)return b-a>=count-1e-8?[]:[cut(G,path,...points,true)];
  const low=Math.abs(a-points[0].index-points[0].t)<1e-8?points[0]:points[1],high=low===points[0]?points[1]:points[0],result=[];
  if(a>1e-8)result.push(cut(G,path,{index:0,t:0},low));if(b<count-1e-8)result.push(cut(G,path,high,{index:count-1,t:1}));return result;
 }
 function rangeFrame(path,points,reversed){
  const [start,end]=reversed?[points[1],points[0]]:points;
  return {start,end,direction:path.closed?(reversed?-1:1):Math.sign(end.index+end.t-start.index-start.t)};
 }
 function walkEnd(G,W,path,start,length,direction){
  const count=G.segmentCount(path);let remaining=length,walked=0,end={...start};
  for(let step=0;step<=count;step++){
   const index=start.index+step*direction;if(!path.closed&&(index<0||index>=count))break;
   const i=(index%count+count)%count,from=step===0?start.t:direction>0?0:1,to=path.closed&&step===count?start.t:direction>0?1:0;
   if(Math.abs(to-from)<1e-9)continue;
   const full={closed:false,nodes:[copy(path.nodes[i]),copy(path.nodes[(i+1)%path.nodes.length])]};
   if(G.segmentLength(full,0)<1e-9)continue;
   const part=cut(G,full,{index:0,t:from},{index:0,t:to}),track=W.track(part);
   if(remaining<=track.length+1e-6){const q=W.at(track,Math.min(remaining,track.length)).point;return {position:{index:i,t:G.nearest(full,q).t},walked:walked+Math.min(remaining,track.length)};}
   remaining-=track.length;walked+=track.length;end={index:i,t:to};
  }
  return {position:end,walked};
 }
 function targetRangeFromNode(G,W,path,index,length,reversed=false){
  const count=G.segmentCount(path);
  if(!Number.isInteger(index)||index<0||index>=path.nodes.length||!count)throw Error('请选择轨道上的有效节点');
  if(!(length>1e-9))throw Error('拟合范围太短');
  const start=index===count?{index:count-1,t:1}:{index,t:0};
  let walk=walkEnd(G,W,path,start,length,reversed?-1:1);
  // At an open end there is only one usable direction, including coincident ends.
  if(!path.closed&&walk.walked<1e-8){reversed=!reversed;walk=walkEnd(G,W,path,start,length,reversed?-1:1);}
  if(walk.walked<1e-8)throw Error('这个节点附近没有可用轨道');
  return {points:reversed?[walk.position,start]:[start,walk.position],reversed};
 }
 function sourceRangeFromNode(G,path,points,index,end='start',reversed=false){
  const count=G.segmentCount(path);
  if(!Number.isInteger(index)||index<0||index>=path.nodes.length||!count)throw Error('请选择原曲线上的有效节点');
  const frame=rangeFrame(path,points,reversed),node=index===count?{index:count-1,t:1}:{index,t:0};
  let start=end==='start'?node:frame.start,finish=end==='end'?node:frame.end;
  if(!path.closed){
   // Clicking the current end as a new start reverses the existing range.
   if(Math.abs(start.index+start.t-finish.index-finish.t)<1e-8&&end==='start')finish=frame.start;
   if(Math.abs(start.index+start.t-finish.index-finish.t)<1e-8)throw Error('起点与终点需要是不同节点');
   reversed=start.index+start.t>finish.index+finish.t;
  }
  return {points:reversed?[finish,start]:[start,finish],reversed};
 }
 // Extend one continuous seam. Both physical starts stay fixed and the target
 // advances by the new source arc length; no geometry or existing edit is baked.
 function extend(G,W,source,sourcePoints,target,targetPoints,options={}){
  const sf=rangeFrame(source,sourcePoints,options.sourceReverse),tf=rangeFrame(target,targetPoints,options.targetReverse),count=G.segmentCount(source);
  const oldLength=W.track(cut(G,source,...sourcePoints)).length,total=W.track(source).length;
  if(source.closed&&oldLength>=total-1e-5)throw Error('原曲线已经到头，没有下一段了');
  let index=sf.end.index,t=sf.end.t,next;
  for(let step=0;step<count;step++){
   if(sf.direction>0?t>=1-1e-8:t<=1e-8)index+=sf.direction;
   if(!source.closed&&(index<0||index>=count))throw Error('原曲线已经到头，没有下一段了');
   index=(index%count+count)%count;t=sf.direction>0?1:0;next={index,t};
   if(G.segmentLength(source,index)>1e-9)break;
  }
  const sp=copy(sourcePoints),slot=options.sourceReverse?0:1;sp[slot]=next;
  let sourceLength=W.track(cut(G,source,...sp)).length;
  if(source.closed&&sourceLength<oldLength+1e-5){sp[slot]={...sf.start};sourceLength=total;}
  const resolved=options.resolveSourceRange?.(sp);
  if(resolved){sp.splice(0,sp.length,...resolved.points);sourceLength=W.track(cut(G,resolved.path,...sp)).length;}
  const wanted=resolved?sourceLength+Math.max(options.offset||0,0):Math.max(sourceLength+Math.max(options.offset||0,0),W.track(cut(G,target,...targetPoints)).length),walk=walkEnd(G,W,target,tf.start,wanted,tf.direction);
  if(walk.walked<wanted-1e-4)throw Error('固定轨道已到头，不能继续贴合这一段；原曲线保持原长');
  const tp=copy(targetPoints);tp[options.targetReverse?0:1]=walk.position;
  return {sourcePoints:sp,targetPoints:tp,sourceLength,targetLength:walk.walked};
 }
 function route(G,W,path,points,reversed=false){
  const {start,direction}=rangeFrame(path,points,reversed);
  const result=path.closed?cut(G,path,start,start):copy(path);
  let origin=0;
  if(!path.closed&&start.index+start.t>1e-9)origin=W.track(cut(G,path,{index:0,t:0},start)).length;
  if(direction<0){result.nodes.reverse();for(const n of result.nodes)[n.in,n.out]=[n.out,n.in];if(!path.closed)origin=W.track(result).length-origin;}
  return {path:result,origin,loop:Boolean(path.closed)};
 }
 function create(options){
  const {G,L,svg,view,getDoc,getCamera,getSelection,getNodeSelection=()=>[],getHistoryRevision=()=>0,getTool=()=>'node',getNativeGesture=()=>false,onHistoryChange=()=>{},onPickRange,onBegin,onDraft,onCommit,onRender,status,lengthText}=options;
  const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg',W=root.CurveWalk,N=root.CurveNotches,R=root.CurveFittingRange;
  const baseline=path=>{const p=N.baseline(G,path);for(const n of p.nodes)delete n.notchId;return p;};
  // A clicked notch tip selects its mouth station, never the cut-edge detour.
  // Only temporary calculation copies are flattened; the complete notch is rigid.
  const targetBaseline=(path=state.target)=>baseline(path);
  const boundaryNotches=(path,points,allowed=null)=>N.groups(path).filter(g=>(!allowed||allowed.includes(g.id))&&points.some(p=>{const n=path.nodes.length,v=((p.index+p.t-g.start)%n+n)%n;return v>1e-8&&v<g.indices.length-1-1e-8;})).map(g=>g.id);
  const sourceBaseline=(path=state.source)=>baseline(path);
  function protectRange(path,points,ids=state.sourceBoundaryNotches){
   let {a,b,count}=interval(G,path,points);const previous=[a,b];
   for(const g of N.groups(path).filter(g=>path.id!==state?.source?.id||!ids.includes(g.id)))for(const lap of [-1,0,1,2]){
    const start=g.start+lap*count,end=start+g.indices.length-1;
    if(a>start+1e-8&&a<end-1e-8)a=start;
    if(b>start+1e-8&&b<end-1e-8)b=end;
   }
   if(a===previous[0]&&b===previous[1])return points;
   const start={index:((Math.floor(a)%count)+count)%count,t:a-Math.floor(a)},ceil=Math.ceil(b),end={index:((ceil-1)%count+count)%count,t:b-ceil+1};
   return !path.closed&&points[0].index+points[0].t>points[1].index+points[1].t?[end,start]:[start,end];
  }
  // Rendering may include a complete boundary notch beyond the calculation
  // endpoints. Keep clipPoints/sourcePoints unchanged for length and history.
  const displayRange=path=>protectRange(path,state.clipPoints,[]);
  const originals=document.createElementNS(NS,'g');originals.id='fitting-originals';originals.setAttribute('pointer-events','none');view.append(originals);
  const group=document.createElementNS(NS,'g');group.id='fitting-preview';view.append(group);
  let state=null,gesture=null,motion=null,animationFrame=null,suppressDoubleUntil=0;
  let guideMode='expanded';
  try{const saved=root.localStorage.getItem('curve-editor.fitting-guide-view');if(['expanded','minimized'].includes(saved))guideMode=saved;}catch(_err){}
  // Floating guide placement is a browser preference, never artwork history.
  const guide=$('fitting-guide'),guideBar=guide.querySelector('.fitting-guide-bar');
  let guidePositions={},guideDrag=null;
  try{const saved=JSON.parse(root.localStorage.getItem('curve-editor.fitting-guide-position'));for(const mode of ['expanded','minimized'])if(Number.isFinite(saved?.[mode]?.x)&&Number.isFinite(saved?.[mode]?.y))guidePositions[mode]=saved[mode];}catch(_err){}
  function placeGuide(){
   if(guide.hidden)return;
   const position=guidePositions[guideMode];
   if(!position){delete guide.dataset.positioned;for(const key of ['left','top','right','bottom','margin'])guide.style.removeProperty(key);return;}
   guide.dataset.positioned='true';Object.assign(guide.style,{right:'auto',bottom:'auto',margin:'0'});
   const box=guide.getBoundingClientRect(),parent=guide.offsetParent;
   if(!parent)return;
   const x=Math.max(4,Math.min(position.x,parent.clientWidth-box.width-4)),y=Math.max(4,Math.min(position.y,parent.clientHeight-box.height-4));
   guide.style.left=x+'px';guide.style.top=y+'px';
  }
  function endGuideDrag(cancel=false){
   const drag=guideDrag;if(!drag)return;guideDrag=null;delete guide.dataset.dragging;
   if(cancel){if(drag.before)guidePositions[drag.mode]=drag.before;else delete guidePositions[drag.mode];placeGuide();}
   else try{root.localStorage.setItem('curve-editor.fitting-guide-position',JSON.stringify(guidePositions));}catch(_err){}
   if(guideBar.hasPointerCapture(drag.id))guideBar.releasePointerCapture(drag.id);
  }
  guideBar.addEventListener('pointerdown',e=>{
   if(e.button!==0||e.target.closest('button'))return;e.preventDefault();e.stopPropagation();endGuideDrag(true);
   const box=guide.getBoundingClientRect(),parent=guide.offsetParent.getBoundingClientRect();
   guideDrag={id:e.pointerId,mode:guideMode,before:guidePositions[guideMode],x:box.x-parent.x,y:box.y-parent.y,startX:e.clientX,startY:e.clientY};
   guide.dataset.dragging='true';guideBar.setPointerCapture(e.pointerId);
  });
  guideBar.addEventListener('pointermove',e=>{
   const drag=guideDrag;if(!drag||e.pointerId!==drag.id)return;e.preventDefault();
   guidePositions[drag.mode]={x:drag.x+e.clientX-drag.startX,y:drag.y+e.clientY-drag.startY};placeGuide();
   // Persist the actual visible position, including edge clamping.
   guidePositions[drag.mode]={x:parseFloat(guide.style.left),y:parseFloat(guide.style.top)};
  });
  guideBar.addEventListener('pointerup',e=>{if(e.pointerId===guideDrag?.id)endGuideDrag();});
  for(const event of ['pointercancel','lostpointercapture'])guideBar.addEventListener(event,e=>{if(e.pointerId===guideDrag?.id)endGuideDrag(true);});
  document.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229)return;if(guideDrag&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();endGuideDrag(true);}},true);
  const guideObserver=new ResizeObserver(placeGuide);guideObserver.observe(guide);guideObserver.observe(guide.parentElement);
  const appearance={source:'#176bce',target:'#13816c',labels:false};
  try{const saved=JSON.parse(root.localStorage.getItem('curve-editor.fitting-appearance'));for(const key of ['source','target'])if(/^#[0-9a-f]{6}$/i.test(saved?.[key]))appearance[key]=saved[key];if(typeof saved?.labels==='boolean')appearance.labels=saved.labels;}catch(_err){}
  function syncAppearance(){
   for(const key of ['source','target']){document.documentElement.style.setProperty('--fitting-'+key+'-color',appearance[key]);$('fitting-'+key+'-color').value=appearance[key];$('fitting-guide-'+key+'-color').querySelector('i').style.background=appearance[key];}
   $('fitting-show-labels').checked=appearance.labels;document.body.classList.toggle('fitting-labels-hidden',!appearance.labels);
  }
  function saveAppearance(){try{root.localStorage.setItem('curve-editor.fitting-appearance',JSON.stringify(appearance));}catch(_err){}syncAppearance();render();}
  const colorPicker=$('fitting-color-picker'),colorField=$('fitting-color-field');
  let colorKind=null,colorHSV={h:210,s:1,v:1},colorPointer=null;
  function readColor(hex){
   const [r,g,b]=hex.slice(1).match(/../g).map(n=>parseInt(n,16)/255),v=Math.max(r,g,b),d=v-Math.min(r,g,b);
   const h=d?((v===r?(g-b)/d:v===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360:colorHSV.h;
   colorHSV={h,s:v?d/v:0,v};
  }
  function colorHex(){
   const {h,s,v}=colorHSV,c=v*s,x=c*(1-Math.abs(h/60%2-1)),m=v-c;
   const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
   return '#'+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('');
  }
  function syncColorPicker(){
   if(!colorKind)return;
   $('fitting-color-title').textContent=(colorKind==='source'?'原曲线 / 拟合线':'目标曲线')+'颜色';
   colorField.style.backgroundColor=`hsl(${colorHSV.h} 100% 50%)`;
   Object.assign($('fitting-color-cursor').style,{left:colorHSV.s*100+'%',top:(1-colorHSV.v)*100+'%'});
   $('fitting-color-hue').value=Math.round(colorHSV.h);$('fitting-color-hex').value=appearance[colorKind];$('fitting-color-hex').setAttribute('aria-invalid','false');
   for(const button of $('fitting-color-swatches').children)button.setAttribute('aria-pressed',button.dataset.fittingColor===appearance[colorKind].toLowerCase());
  }
  function closeColorPicker(){
   colorKind=null;colorPicker.hidden=true;colorPointer=null;
   for(const key of ['source','target'])$('fitting-guide-'+key+'-color').setAttribute('aria-expanded','false');
  }
  function applyColor(){if(!colorKind)return;appearance[colorKind]=colorHex();syncColorPicker();saveAppearance();}
  const swatches=['#176bce','#13816c','#e04544','#c47713','#9858b1','#c43283','#087f8c','#78513e','#ef8c23','#f2c94c','#6dbb45','#29b6a8','#50a8ed','#9a7ee8','#ef86ae','#d4a573','#172b4d','#586b80','#97a6b5','#ffffff'];
  for(const color of swatches){
   const button=document.createElement('button');button.type='button';button.dataset.fittingColor=color;button.style.background=color;button.setAttribute('aria-label','选择颜色 '+color);button.title=color;
   button.onclick=()=>{if(!colorKind)return;readColor(color);applyColor();};$('fitting-color-swatches').append(button);
  }
  for(const key of ['source','target'])$('fitting-guide-'+key+'-color').onclick=()=>{
   if(colorKind===key){closeColorPicker();return;}colorKind=key;readColor(appearance[key]);colorPicker.hidden=false;
   for(const kind of ['source','target'])$('fitting-guide-'+kind+'-color').setAttribute('aria-expanded',kind===key);
   syncColorPicker();placeGuide();
  };
  $('fitting-color-done').onclick=closeColorPicker;
  $('fitting-color-hue').oninput=e=>{colorHSV.h=Number(e.target.value);applyColor();};
  const applyHex=()=>{const value=$('fitting-color-hex').value.trim();if(!/^#[0-9a-f]{6}$/i.test(value)){$('fitting-color-hex').setAttribute('aria-invalid','true');return;}readColor(value);applyColor();};
  $('fitting-color-hex').onchange=applyHex;
  colorPicker.addEventListener('keydown',e=>{if(e.isComposing||e.keyCode===229)return;
   e.stopPropagation();
   if(e.key==='Escape'){e.preventDefault();const key=colorKind;closeColorPicker();if(key)$('fitting-guide-'+key+'-color').focus();}
   else if(e.key==='Enter'&&e.target===$('fitting-color-hex')){e.preventDefault();applyHex();}
   else if(e.target===colorField&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
    e.preventDefault();const step=e.shiftKey ? .1 : .01;
    colorHSV.s=Math.max(0,Math.min(1,colorHSV.s+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0)));
    colorHSV.v=Math.max(0,Math.min(1,colorHSV.v+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0)));applyColor();
   }
  });
  function pickColor(e){const box=colorField.getBoundingClientRect();colorHSV.s=Math.max(0,Math.min(1,(e.clientX-box.x)/box.width));colorHSV.v=1-Math.max(0,Math.min(1,(e.clientY-box.y)/box.height));applyColor();}
  colorField.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();colorField.focus();colorPointer=e.pointerId;colorField.setPointerCapture(e.pointerId);pickColor(e);};
  colorField.onpointermove=e=>{if(colorPointer===e.pointerId)pickColor(e);};
  colorField.onpointerup=e=>{if(colorPointer!==e.pointerId)return;pickColor(e);colorPointer=null;if(colorField.hasPointerCapture(e.pointerId))colorField.releasePointerCapture(e.pointerId);};
  colorField.onpointercancel=colorField.onlostpointercapture=()=>{colorPointer=null;};
  syncAppearance();
  function setGuideMode(mode){endGuideDrag(true);if(mode==='minimized')closeColorPicker();guideMode=mode;try{root.localStorage.setItem('curve-editor.fitting-guide-view',mode);}catch(_err){}updateUI();}
  const changedVisuals=new Map();
  const taps=root.CurveInteractions?.createTapTracker();
  function element(tag,attrs,parent=group){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);parent.append(e);return e;}
  const originalEditing=()=>!!state?.map&&!state.editing&&!state.adjusting;
  const capturesCanvas=()=>!!state&&(!state.map||state.editing||state.adjusting);
  const controlsEnabled=()=>capturesCanvas()||['node','select'].includes(getTool());
  function targetNode(target){
   if(!state?.target||state.adjusting||state.topologyChanged||state.syncInvalid||!controlsEnabled()||target.hasAttribute('data-side'))return null;
   const index=target.getAttribute('data-node'),pathId=target.getAttribute('data-path');
   return pathId===state.target.id&&index!==null?{pathId,index:Number(index),end:state.targetPick}:null;
  }
  function pickNode(target,point){
   if(directPicking()&&point&&target.hasAttribute('data-fit-pick-kind')){
    let nearest=null;
    for(const path of endpointCandidates(state.pickKind))for(const [index,q]of path.nodes.entries()){
     const distance=G.dist(point,q)*getCamera().z;
     if(distance<=10&&(!nearest||distance<nearest.distance))nearest={pathId:path.id,index,distance};
    }
    if(nearest)return {direct:true,kind:state.pickKind,end:state[state.pickKind+'Pick'],pathId:nearest.pathId,index:nearest.index};
   }
   if(directPicking()){const index=target.getAttribute('data-node'),pathId=target.getAttribute('data-path');if(index!==null&&pathId&&!target.hasAttribute('data-side'))return {direct:true,kind:state.pickKind,end:state[state.pickKind+'Pick'],pathId,index:Number(index)};}
   if(state?.source&&state.sourcePick!=='none'&&!state.adjusting&&!state.topologyChanged&&!state.syncInvalid&&controlsEnabled()&&!target.hasAttribute('data-side')){
    const index=target.getAttribute('data-node'),pathId=target.getAttribute('data-path');
    if(pathId===state.source.id&&index!==null)return {kind:'source',pathId,index:Number(index),end:state.sourcePick};
   }
   const targetPick=targetNode(target);return targetPick?{kind:'target',...targetPick}:null;
  }
  function chooseNode(pick){if(pick.direct){chooseEndpoint(pick);return;}if(pick.kind==='source')chooseSourceNode(pick.pathId,pick.index,pick.end);else chooseTargetNode(pick.pathId,pick.index,pick.end);}
  function handlesEvent(e){const node=pickNode(e.target);return capturesCanvas()||!!state?.map&&controlsEnabled()&&(!!e.target.closest?.('[data-fit-offset],[data-fit-marker],[data-fit-notch-id],[data-fit-start-end],[data-fit-target-start-end]')||!!node&&(getTool()!=='node'||!L.editable(getDoc(),node.pathId)));}
  function originalMode(){if(!state?.map)return;cancel();state.editing=false;state.adjusting=false;state.node=null;state.feedback='';locks(false);}
  const geometryKey=p=>JSON.stringify([p.closed,p.nodes.map(n=>[n.x,n.y,n.in,n.out,n.notchId])]);
  const documentKey=()=>JSON.stringify([getDoc().paths,getDoc().texts,getDoc().layers]);
  function observe(){state.observedSource=copy(getDoc().paths.find(p=>p.id===state.source.id)||state.source);state.observedTarget=copy(getDoc().paths.find(p=>p.id===state.target.id)||state.target);state.observedKey=documentKey();}
  function syncOriginals(fromFitting=false){
   if(!state?.map)return;
   const key=documentKey();if(key===state.observedKey)return;
   if(fromFitting){state.lastMutation='fitting';observe();return;}
   state.lastMutation='original';
   const source=getDoc().paths.find(p=>p.id===state.source.id),target=getDoc().paths.find(p=>p.id===state.target.id);
   if(!source||!target||!G.segmentCount(source)||!G.segmentCount(target)){stop();status('拟合所用曲线已删除或没有线段，已结束预览；其他修改保留。');return;}
   const previousSource=state.observedSource,previousTarget=state.observedTarget;
   const sourceChanged=geometryKey(source)!==geometryKey(previousSource),targetChanged=geometryKey(target)!==geometryKey(previousTarget);
   if(sourceChanged||targetChanged||state.syncInvalid){
    stopMotion();const previous={...state};
    try{
     const sourcePoints=R.rebase(G,previousSource,state.clipPoints,source),targetPoints=R.rebase(G,previousTarget,state.targetPoints,target);
     // Range history belongs to the same original curve, even after insert/delete.
     const steps=[...state.undoSteps,...state.redoSteps].map(step=>({...step,before:copy(step.before),after:copy(step.after)}));
     const endFor=(sp,tp,ids)=>{if(state.targetEndPinned)return tp;const tf=rangeFrame(target,tp,state.targetReverse),length=W.track(cut(G,sourceBaseline(source,ids),...protectRange(source,sp,ids))).length,walk=walkEnd(G,W,targetBaseline(target),tf.start,length+Math.max(state.offset,0),tf.direction);tp[state.targetReverse?0:1]=walk.position;return tp;};
     for(const step of steps)for(const v of [step.before,step.after]){v.sourcePoints=R.rebase(G,state.source,v.sourcePoints,source);v.sourceBoundaryNotches=boundaryNotches(source,v.sourcePoints,v.sourceBoundaryNotches);v.targetPoints=endFor(v.sourcePoints,R.rebase(G,previousTarget,v.targetPoints,target),v.sourceBoundaryNotches);}
     state.source=copy(source);state.target=copy(target);state.sourcePoints=sourcePoints;state.sourceBoundaryNotches=boundaryNotches(source,sourcePoints,state.sourceBoundaryNotches);state.targetPoints=endFor(sourcePoints,targetPoints,state.sourceBoundaryNotches);state.topologyChanged=false;state.syncInvalid=null;
     const split=state.undoSteps.length;state.undoSteps=steps.slice(0,split);state.redoSteps=steps.slice(split);build();
    }catch(_err){Object.assign(state,previous);state.syncInvalid=true;state.failed=true;state.feedback='原曲线已修改，这个范围暂时无法预览；可继续编辑原图、撤销或展开，修改会保留。';state.observedKey=key;return;}
   }else{state.source.name=source.name;state.target.name=target.name;}
   observe();
  }
  function locks(active){document.body.classList.toggle('fitting-exclusive',active);for(const e of document.querySelectorAll('.panel-group:not([data-panel="fitting"]),.actionbar .group:not([aria-label="操作历史"]),#show-history,#new,#open,#import'))e.inert=active;}
  function restoreLines(){for(const [e,d]of changedVisuals)if(e.isConnected)e.setAttribute('d',d);changedVisuals.clear();for(const line of $('paths').querySelectorAll('.hit-line')){line.style.removeProperty('pointer-events');line.style.removeProperty('opacity');line.previousElementSibling?.style.removeProperty('opacity');}}
  function start(){
   state={phase:'source',selection:getSelection().filter(id=>L.editable(getDoc(),id)),ids:new Set(),source:null,target:null,sourcePoints:[],targetPoints:[],clipPoints:[],sourcePick:'start',targetPick:'start',pickKind:'source',endpointPicking:false,endpointDrafts:{},endpointReplacement:null,targetEndPinned:false,showFitted:true,sourceBoundaryNotches:[],undoSteps:[],redoSteps:[],partial:!$('fitting-whole').checked,topologyChanged:false,sourceReverse:false,targetReverse:false,map:null,selected:null,node:null,offset:0,editing:false,adjusting:false,failed:false,feedback:'',cache:null,hover:null};
   if(state.partial){
    const nodes=getNodeSelection().filter(n=>L.editable(getDoc(),n.pathId));
    try{if(nodes.length>=2){const ids=new Set(nodes.map(n=>n.pathId));if(ids.size!==1)throw Error('请先选同一条轮廓上的一段连续节点，再点对边');const path=getDoc().paths.find(p=>p.id===nodes[0].pathId),points=selection(G,path,nodes.map(n=>n.index));if(points){state.source=copy(path);state.sourcePoints=points;choosePiece(path);state.phase='target';}}}catch(err){state.feedback=err.message;}
   }
   if(!state.source&&!state.feedback&&state.selection.length===1){const path=getDoc().paths.find(p=>p.id===state.selection[0]);if(G.segmentCount(path)){state.source=copy(path);state.sourcePoints=[{index:0,t:0},{index:G.segmentCount(path)-1,t:1}];choosePiece(path);state.phase='target';}}
   setGuideMode('expanded');taps?.reset();locks(true);document.body.classList.add('fitting-active');$('fit-curves').setAttribute('aria-pressed','true');render();
  }
  function stop(){if(!state)return;endGuideDrag(true);cancel();state=null;locks(false);restoreLines();document.body.classList.remove('fitting-active');$('fit-curves').setAttribute('aria-pressed','false');group.replaceChildren();originals.replaceChildren();$('handles').style.display='';$('node-colors').style.display='';$('selection-overlay').style.display='';$('fitting-guide').hidden=true;svg.style.cursor='default';updateUI();}
  function hit(p,candidates){let best=null;for(const path of candidates){const h=G.nearest(path,p);if(h.distance<=(best?.hit.distance??Infinity)-1e-7)best={path,hit:h};}if(!best||best.hit.distance>14/getCamera().z)return null;const h=best.hit,a=best.path.nodes[h.index],b=best.path.nodes[(h.index+1)%best.path.nodes.length];if(G.dist(a,p)*getCamera().z<8)h.t=0;else if(G.dist(b,p)*getCamera().z<8)h.t=1;return best;}
  const seamPoint=(path,p)=>G.at(path.nodes[p.index],path.nodes[(p.index+1)%path.nodes.length],p.t);
  function reverse(path){path.nodes.reverse();for(const n of path.nodes)[n.in,n.out]=[n.out,n.in];return path;}
  function sourceSeam(){state.sourceBoundaryNotches=boundaryNotches(state.source,state.sourcePoints,state.sourceBoundaryNotches);state.sourcePoints=protectRange(state.source,state.sourcePoints);const s=cut(G,sourceBaseline(),...state.sourcePoints);return state.sourceReverse?reverse(s):s;}
  function autoEnd(path,index,length,startT=0){
   let remaining=length;
   for(let step=0;step<G.segmentCount(path);step++){
    const i=(index+step)%G.segmentCount(path),full={closed:false,nodes:[copy(path.nodes[i]),copy(path.nodes[(i+1)%path.nodes.length])]},lo=step===0?startT:0;
    if(lo>=1||G.segmentLength(full,0)<1e-9)continue;
    const segment=lo>0?cut(G,full,{index:0,t:lo},{index:0,t:1}):full,track=W.track(segment);
    if(remaining<=track.length+.00001){const q=W.at(track,Math.min(remaining,track.length)).point;return {index:i,t:G.nearest(full,q).t};}
    remaining-=track.length;
    if(!path.closed&&i===G.segmentCount(path)-1)return {index:i,t:1};
   }
   return {index,t:0};
  }
  function build(){
   const s=sourceSeam(),target=targetBaseline(),t=cut(G,target,...state.targetPoints);if(state.targetReverse)reverse(t);
   // Fitted-view edits use this reference until an explicit original edit rebases it.
   const targetRoute=route(G,W,target,state.targetPoints,state.targetReverse),map=root.CurveBend.create(s,t,{offset:state.offset,targetRoute:targetRoute.path,targetOrigin:targetRoute.origin,targetLoop:targetRoute.loop});
   state.routeTrack=W.track(targetRoute.path);state.routeOrigin=targetRoute.origin;state.routeLoop=targetRoute.loop;
   state.map=map;state.sourceTrack=W.track(s);state.targetTrack=W.track(t);state.phase='ready';state.node=null;state.cache=null;state.failed=false;state.feedback='';
   state.selected=state.source.id;
   if(!state.topologyChanged)state.clipPoints=copy(state.sourcePoints);
   if(!state.observedSource)observe();
   $('fitting-offset').min=-map.sourceLength;$('fitting-offset').max=map.targetLength;
  }
  function continueFitting(){
   if(!state?.map||state.failed)return;
   if(state.topologyChanged){feedback('已增删节点，请先展开，再重新选择范围。');return;}
   cancel();const before={...state};
   try{
    let ids;
    const next=extend(G,W,sourceBaseline(),state.sourcePoints,targetBaseline(),state.targetPoints,{...state,resolveSourceRange(points){
     ids=boundaryNotches(state.source,points,state.sourceBoundaryNotches);
     return {points:protectRange(state.source,points,ids),path:sourceBaseline(state.source,ids)};
    }});
    if(state.targetEndPinned){if(next.sourceLength+Math.max(state.offset,0)>W.track(cut(G,targetBaseline(),...state.targetPoints)).length+1e-4)throw Error('已到指定目标终点，请先调整目标终点');next.targetPoints=copy(state.targetPoints);}
    state.sourceBoundaryNotches=ids;state.sourcePoints=next.sourcePoints;state.targetPoints=next.targetPoints;state.editing=false;state.adjusting=false;
    build();render();
    if(state.failed)throw Error('这一段弯曲后发生重叠，请调整范围后再试');
    state.undoSteps.push({before:copy({sourcePoints:before.sourcePoints,targetPoints:before.targetPoints,sourceBoundaryNotches:before.sourceBoundaryNotches}),after:copy({sourcePoints:state.sourcePoints,targetPoints:state.targetPoints,sourceBoundaryNotches:state.sourceBoundaryNotches}),revision:getHistoryRevision()});
    if(state.undoSteps.length>100)state.undoSteps.shift();state.redoSteps.length=0;updateUI();onHistoryChange();
    status(`已连续对合 ${G.segmentCount(state.sourceTrack.path)} 段，原起点保持，缝边未拉长`);
   }catch(err){
    Object.assign(state,before);
    feedback(`${err.message}。已保留上一次对合和已有修改。`);
   }
  }
  function canHistory(back){const step=(back?state?.undoSteps:state?.redoSteps)?.at(-1);return !!state?.map&&!state.topologyChanged&&!!step&&step.revision===getHistoryRevision();}
  function history(back,explicit=false){
   if(!state?.map||state.topologyChanged)return false;
   const from=back?state.undoSteps:state.redoSteps,to=back?state.redoSteps:state.undoSteps,step=from.at(-1);if(!step||!explicit&&!canHistory(back))return false;
   cancel();const before={...state};
   try{Object.assign(state,copy(back?step.before:step.after));state.adjusting=false;state.editing=false;build();render();if(state.failed)throw Error();}
   catch(_err){Object.assign(state,before);feedback('这个范围暂时无法预览，已保留当前对合与修改。');return true;}
   from.pop();to.push({...step,revision:getHistoryRevision()});updateUI();onHistoryChange();status(`${back?'已退回':'已重做'}：当前对合 ${G.segmentCount(state.sourceTrack.path)} 段，剪口及曲线修改保留`);return true;
  }
  function choosePiece(path){
   const doc=getDoc(),targetId=state.target?.id||state.endpointDrafts.target?.pathId,selected=doc.paths.filter(p=>state.selection.includes(p.id)&&p.id!==targetId);
   // A layer often contains several pieces. Never infer that all its contours move.
   const explicit=selected.some(p=>p.id===path.id)&&selected.filter(p=>p.closed).length<=1;
   state.ids=new Set(!state.partial&&explicit?selected.map(p=>p.id):[path.id]);
   const track=W.track(path),layer=L.layerFor(doc,path.id),limit=Math.max(W.track(sourceSeam()).length*.22,.01);
   for(const p of doc.paths)if(p.id!==path.id&&p.id!==targetId&&!p.closed&&p.nodes.length>=2&&p.nodes.length<=6&&L.editable(doc,p.id)&&L.layerFor(doc,p.id)?.id===layer?.id&&G.pathLength(p)<=limit){
    if(Math.min(W.nearest(track,p.nodes[0]).distance,W.nearest(track,p.nodes.at(-1)).distance)<=Math.max(track.length*.002,.05))state.ids.add(p.id);
   }
  }
  const directPicking=()=>!!state?.endpointPicking&&!state.adjusting&&!state.topologyChanged&&!state.syncInvalid&&(!state[state.pickKind]||state[state.pickKind+'Pick']==='start');
  function endpointCandidates(kind){
   const other=kind==='source'?'target':'source',otherId=state[other]?.id||state.endpointDrafts[other]?.pathId;
   return getDoc().paths.filter(p=>G.segmentCount(p)&&L.visible(getDoc(),p.id)&&p.id!==otherId&&(kind!=='target'||!state.ids.has(p.id))&&(kind==='target'||L.editable(getDoc(),p.id)));
  }
  function advanceEndpoint(kind,end){
   if(!state.endpointPicking)return;
   const draft=state.endpointDrafts[kind];let nextKind=kind,nextEnd;
   if(draft&&draft.start===undefined)nextEnd='start';
   else if(draft&&draft.end===undefined)nextEnd='end';
   else if(end==='start')nextEnd='end';
   else if(kind==='source'){nextKind='target';nextEnd='start';}
   else{state.endpointPicking=false;return;}
   state.pickKind=nextKind;state[nextKind+'Pick']=nextEnd;
   if(nextKind==='target')state.sourcePick='none';
  }
  function chooseEndpoint({kind,end,pathId,index}){
   const path=endpointCandidates(kind).find(p=>p.id===pathId);if(!path||!path.nodes[index]){feedback('请点另一条可用曲线的节点');return;}
   if(state[kind]?.id===pathId){if(kind==='source')chooseSourceNode(pathId,index,end);else chooseTargetNode(pathId,index,end);return;}
   const previous=state.endpointDrafts[kind];
   if(previous&&previous.pathId!==pathId){feedback('起点和终点需要在同一条曲线上，请点已标记曲线的节点');return;}
   const draft={...previous,pathId,[end]:index};
   if(!path.closed&&draft.start!==undefined&&draft.start===draft.end){feedback('起点与终点需要是不同节点');return;}
   const before={...state};
   try{
    if(state[kind]){if(state.map)state.endpointReplacement=before;state[kind]=null;state[kind+'Points']=[];state.map=null;state.cache=null;state.observedSource=null;state.observedTarget=null;state.observedKey=null;state.undoSteps=[];state.redoSteps=[];state.phase=state.source?'target':'source';if(kind==='source')state.ids=new Set();}
    state.endpointDrafts={...state.endpointDrafts,[kind]:draft};state.hover=null;state.feedback='';
    if(draft.start===undefined||draft.end===undefined){advanceEndpoint(kind,end);render();status(`已设置${kind==='source'?'原':'目标'}曲线${end==='start'?'起点':'终点'}，请直接点选另一端`);return;}
    const count=G.segmentCount(path),position=i=>i===count?{index:count-1,t:1}:{index:i,t:0},reversed=!path.closed&&draft.start>draft.end;
    state[kind]=copy(path);state[kind+'Reverse']=reversed;state[kind+'Points']=(reversed?[draft.end,draft.start]:[draft.start,draft.end]).map(position);
    if(kind==='source'){
     state.sourceBoundaryNotches=boundaryNotches(state.source,state.sourcePoints);sourceSeam();choosePiece(state.source);state.clipPoints=copy(state.sourcePoints);
    }else state.targetEndPinned=true;
    state.endpointDrafts={...state.endpointDrafts,[kind]:null};state.phase=state.source?'target':'source';
    if(state.source&&state.target){state.offset=0;build();}
    render();if(state.failed)throw Error('这个范围暂时无法对合');state.endpointReplacement=null;onHistoryChange();advanceEndpoint(kind,'end');render();
    status(state.map?'已按四个端点对合，方向见画布箭头':`已确定${kind==='source'?'原':'目标'}曲线范围，请选择另一条曲线的起终点`);
   }catch(err){Object.assign(state,before.endpointReplacement||before);render();onHistoryChange();feedback(err.message+'，已保留原有范围与端点');}
  }
  function drawEndpointSelection(){
   if(!state?.endpointPicking)return;
   const z=getCamera().z;
   for(const kind of ['source','target']){
    const draft=state.endpointDrafts[kind],path=draft&&getDoc().paths.find(p=>p.id===draft.pathId);if(!path)continue;
    const base=baseline(path),color=appearance[kind];
    for(const end of ['start','end'])if(draft[end]!==undefined){const q=base.nodes[draft[end]];
     element('circle',{cx:q.x,cy:q.y,r:4/z,fill:color,stroke:'white','stroke-width':1.5/z,'pointer-events':'none','data-fit-pending':kind+'-'+end});
     element('text',{x:q.x+10/z,y:q.y-12/z,fill:color,'font-size':12/z,'paint-order':'stroke',stroke:'white','stroke-width':3/z,'pointer-events':'none'}).textContent=`${kind==='source'?'原曲线':'目标曲线'}${end==='start'?'起点':'终点'}`;
    }
   }
   if(!state.map&&state.target){
    const base=targetBaseline(),frame=rangeFrame(base,state.targetPoints,state.targetReverse),track=W.track(state.targetReverse?reverse(cut(G,base,...state.targetPoints)):cut(G,base,...state.targetPoints)),color=appearance.target;
    for(const [end,position]of [['start',frame.start],['end',frame.end]]){const q=seamPoint(base,position);element('text',{x:q.x+10/z,y:q.y-12/z,fill:color,'font-size':12/z,'paint-order':'stroke',stroke:'white','stroke-width':3/z,'pointer-events':'none','data-fit-pending-target-label':end}).textContent='目标曲线'+(end==='start'?'起点':'终点');}
    const {point:q,tangent:t}=W.at(track,track.length*.5),size=7/z;
    element('path',{d:`M ${q.x-t.x*size-t.y*size*.6} ${q.y-t.y*size+t.x*size*.6} L ${q.x} ${q.y} L ${q.x-t.x*size+t.y*size*.6} ${q.y-t.y*size-t.x*size*.6}`,fill:'none',stroke:color,'stroke-width':2/z,'pointer-events':'none'});
   }
   const kind=state.pickKind;
   const paths=directPicking()?endpointCandidates(kind):!state.map&&state[kind]?[state[kind]]:[];
   const nativeNodes=new Set([...$('handles').querySelectorAll('.anchor')].map(n=>`${n.getAttribute('data-path')}:${n.getAttribute('data-node')}`));
   for(const path of paths)for(const [i,q]of path.nodes.entries()){
    element('circle',{cx:q.x,cy:q.y,r:6/z,fill:'transparent',stroke:'transparent','stroke-width':4/z,'data-fit-pick-kind':kind,'data-path':path.id,'data-node':i,'pointer-events':state.map&&getTool()==='node'&&nativeNodes.has(`${path.id}:${i}`)?'none':'all',cursor:'pointer'});
    element('circle',{cx:q.x,cy:q.y,r:3/z,fill:'white',stroke:appearance[kind],'stroke-width':1.2/z,'pointer-events':'none'});
   }
  }
  function candidates(){const doc=getDoc();return doc.paths.filter(p=>G.segmentCount(p)&&L.visible(doc,p.id)&&(state.phase==='source'?L.editable(doc,p.id):!state.ids.has(p.id)));}
  function feedback(message){state.feedback=message;render();status(message);}
  function selectSeam(p){
   const chosen=hit(p,candidates());if(!chosen){feedback(state.phase==='source'?'还没点到边线，请靠近要弯的那段边再点一下。':'请点另一片的边线；原曲线段已经选好了。');return;}
   const i=chosen.hit.index;
   if(state.phase==='source'){
    state.source=copy(chosen.path);state.sourcePoints=[{index:i,t:0},{index:i,t:1}];state.sourceReverse=false;
    const index=chosen.hit.t===0?i:chosen.hit.t===1?(i+1)%chosen.path.nodes.length:null;
    if(index!==null){
     if(index<G.segmentCount(chosen.path))state.sourcePoints=[{index,t:0},{index,t:1}];else state.sourceReverse=true;
     state.sourceBoundaryNotches=N.groups(chosen.path).filter(g=>g.indices.slice(1,-1).includes(index)).map(g=>g.id);
    }
    try{
     // Zero-width slits collapse to one station. Start at that station and
     // advance across collapsed segments to the first usable seam segment.
     if(state.sourceBoundaryNotches.length){
      const base=sourceBaseline();let end=state.sourcePoints[1].index;
      for(let step=0;step<G.segmentCount(base)&&G.segmentLength(base,end)<1e-9;step++){
       if(!base.closed&&end+1>=G.segmentCount(base))break;
       end=(end+1)%G.segmentCount(base);state.sourcePoints[1]={index:end,t:1};
      }
     }
     sourceSeam();choosePiece(chosen.path);
    }catch(_err){feedback('这段边太短，请换一段边线。');return;}
    state.phase='target';state.feedback='';state.hover=null;render();return;
   }
   state.target=copy(chosen.path);state.hover=null;
   try{
    const index=chosen.hit.t===0?i:chosen.hit.t===1?(i+1)%chosen.path.nodes.length:null,length=W.track(sourceSeam()).length;
    state.targetNotchId=index===null?undefined:N.groups(chosen.path).find(g=>g.indices.slice(1,-1).includes(index))?.id;
    if(index!==null){const next=targetRangeFromNode(G,W,targetBaseline(),index,length,state.targetReverse);const count=G.segmentCount(state.target);state.targetPoints=state.target.closed?next.points.map(p=>{const value=(p.index+p.t)%count;return {index:Math.floor(value),t:value-Math.floor(value)};}):next.points;state.targetReverse=next.reversed;}
    else state.targetPoints=[{index:i,t:0},autoEnd(targetBaseline(),i,length)];
    build();render();
   }catch(_err){state.map=null;state.phase='target';feedback('这段边暂时无法对合，原线仍在。请换一段贴合轨道，或重新选择。');}
  }
  function mapPoint(p){return state.map.forward(p);}
  function displayPoint(p){return state.map.preview?state.map.preview(p):mapPoint(p);}
  function sourceFrame(s){const edge=W.at(state.sourceTrack,Math.max(0,Math.min(state.sourceTrack.length,s))),extra=s-edge.s;return {point:{x:edge.point.x+edge.tangent.x*extra,y:edge.point.y+edge.tangent.y*extra},tangent:edge.tangent};}
  function sourceStation(p){
   let best=W.nearest(state.sourceTrack,p);
   for(const s of [0,state.sourceTrack.length]){const f=sourceFrame(s),along=(p.x-f.point.x)*f.tangent.x+(p.y-f.point.y)*f.tangent.y;if(s===0?along>=0:along<=0)continue;const q={x:f.point.x+along*f.tangent.x,y:f.point.y+along*f.tangent.y},distance=G.dist(p,q);if(distance<best.distance)best={s:s+along,distance};}
   return best.s;
  }
  function inlineNotches(path){return N.groups(path).filter(g=>!state.partial||path.id!==state.source.id||g.indices.every(i=>inside(G,path,displayRange(path),i,0)));}
  function notchProjection(path,g){
   const station=sourceStation(g.anchor),from={point:g.anchor,tangent:sourceFrame(station).tangent},to={point:displayPoint(g.anchor),tangent:targetPosition(station+state.offset).tangent};
   const projected=N.rigid(G,path,g,from,to),indices=new Set(g.indices);
   const c=from.tangent.x*to.tangent.x+from.tangent.y*to.tangent.y,s=from.tangent.x*to.tangent.y-from.tangent.y*to.tangent.x;
   const point=p=>{const x=p.x-from.point.x,y=p.y-from.point.y;return {x:to.point.x+c*x-s*y,y:to.point.y+s*x+c*y};};
   return {g,station,projected,indices,point,d:G.pathD({closed:false,nodes:g.indices.map(i=>projected.nodes[i])})};
  }
  function protectedPathData(path,notches){
   const spans=state.partial&&path.id===state.source.id?spansInRange(G,path,displayRange(path)):Array.from({length:G.segmentCount(path)},(_,index)=>({index,lo:0,hi:1})),points=[];
   for(const {index,lo,hi}of spans){
    const next=(index+1)%path.nodes.length,a=path.nodes[index],b=path.nodes[next],notch=notches.find(n=>n.g.indices.slice(0,-1).includes(index)),steps=Math.max(12,Math.min(80,Math.ceil(G.segmentLength(path,index)/4)));
    for(let j=0;j<=steps;j++){
     const t=lo+(hi-lo)*j/steps,p=G.at(a,b,t),endpoint=t<1e-9?notches.find(n=>n.indices.has(index)):t>1-1e-9?notches.find(n=>n.indices.has(next)):null;
     points.push((notch||endpoint)?.point(p)||displayPoint(p));
    }
   }
   return points.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(4)} ${p.y.toFixed(4)}`).join(' ')+(!state.partial&&path.closed?' Z':'');
  }
  function pathData(path,project=displayPoint){
   const points=[];if(!path.nodes.length)return '';
   // Sampling is independent of zoom, so zooming cannot change mapping validity.
   for(let i=0;i<G.segmentCount(path);i++){
    const n=Math.max(12,Math.min(80,Math.ceil(G.segmentLength(path,i)/4)));
    for(let j=0;j<n;j++)points.push(project(G.at(path.nodes[i],path.nodes[(i+1)%path.nodes.length],j/n)));
   }
   points.push(project(path.closed?path.nodes[0]:path.nodes.at(-1)));
   return points.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(4)} ${p.y.toFixed(4)}`).join(' ')+(path.closed?' Z':'');
  }
  function targetPosition(s){const track=state.routeTrack;let value=s+state.routeOrigin;if(state.routeLoop)value=((value%track.length)+track.length)%track.length;const end=Math.max(0,Math.min(track.length,value)),p=W.at(track,end);return {x:p.point.x+p.tangent.x*(value-end),y:p.point.y+p.tangent.y*(value-end),tangent:p.tangent};}
  function joinedSeam(){
   const length=state.sourceTrack.length,steps=Math.max(30,Math.min(600,Math.ceil(length/3))),points=[];
   for(let i=0;i<=steps;i++)points.push(targetPosition(length*i/steps+state.offset));
   // Include exact target junctions, rather than bridging across a sharp corner.
   for(const lap of state.routeLoop?[-1,0,1]:[0])for(const span of state.routeTrack.spans){const s=span.s1-state.routeOrigin+lap*state.routeTrack.length;if(s>state.offset&&s<length+state.offset)points.push({...targetPosition(s),station:s-state.offset});}
   points.forEach((p,i)=>{if(p.station===undefined)p.station=length*i/steps;});points.sort((a,b)=>a.station-b.station);
   return points.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(4)} ${p.y.toFixed(4)}`).join(' ');
  }
  function marker(path){
   if(!state.sourceTrack||path.closed||path.id===state.source.id||path.nodes.length<2||path.nodes.length>6||G.pathLength(path)>state.sourceTrack.length*.25)return null;
   const ends=[0,path.nodes.length-1].map(index=>({index,...W.nearest(state.sourceTrack,path.nodes[index])})).sort((a,b)=>a.distance-b.distance);
   return ends[0].distance<=Math.max(state.sourceTrack.length*.02,.05)?ends[0]:null;
  }
  function previewPaths(){
   return getDoc().paths.filter(p=>{
    if(!state.ids.has(p.id)||!L.visible(getDoc(),p.id))return false;
    if(!state.partial||p.id===state.source.id)return true;
    const mark=marker(p);if(!mark)return false;
    const hit=G.nearest(state.source,p.nodes[mark.index]);return inside(G,state.source,state.sourcePoints,hit.index,hit.t);
   });
  }
  function nodeBoundary(path,index){
   if(!state.partial||path.id!==state.source.id)return false;
   if(state.clipPoints.some(p=>p.t<1e-8&&p.index===index||p.t>1-1e-8&&(p.index+1)%path.nodes.length===index))return true;
   const spans=spansInRange(G,path,state.clipPoints),full=new Set(spans.filter(s=>s.lo<1e-8&&s.hi>1-1e-8).map(s=>s.index));
   return (path.closed||index>0)&&!full.has((index+path.nodes.length-1)%path.nodes.length)||(path.closed||index<path.nodes.length-1)&&!full.has(index);
  }
  function splitClip(path,index,t){
   if(path.id!==state.source.id)return;
   state.clipPoints=state.clipPoints.map(p=>p.index>index?{...p,index:p.index+1}:p.index<index?p:p.t<=t?{index,t:p.t/t}:{index:index+1,t:(p.t-t)/(1-t)});
   state.topologyChanged=true;state.cache=null;
  }
  function drawSeam(path,points,color,kind){
   if(!path||points.length<2)return;
   const base=baseline(path),seam=cut(G,base,...points),z=getCamera().z;
   element('path',{d:G.pathD(seam),fill:'none',stroke:color,'stroke-width':5/z,opacity:.8,'pointer-events':'none','data-fit-seam-highlight':kind});
   points.forEach((p,i)=>{const q=seamPoint(base,p);element('circle',{cx:q.x,cy:q.y,r:(state.adjusting?6:3)/z,fill:'white',stroke:color,'stroke-width':1.5/z,...(state.adjusting?{'data-fit-range':kind,'data-fit-end':i,cursor:'grab'}:{'pointer-events':'none'})});if(state.adjusting)element('text',{x:q.x+9/z,y:q.y-8/z,fill:color,'font-size':12/z,'paint-order':'stroke',stroke:'white','stroke-width':3/z,'pointer-events':'none','data-fit-direction-label':`${kind}-range-${i}`}).textContent=`${kind==='source'?'原曲线':'轨道'}${i===(state[kind+'Reverse']?1:0)?'起点':'终点'}`;});
  }
  function changeDirection(key,reversed,atEndpoint=false){
   if(!state?.source||state[key+'Reverse']===reversed&&(!atEndpoint||state.offset===0))return;
   if(state.topologyChanged||state.syncInvalid){feedback('已增删节点或范围暂时不可用，请先展开，再重新选择起点。');return;}
   cancel();const before={...state};
   try{
    state[key+'Reverse']=reversed;state.hover=null;if(atEndpoint)state.offset=0;
    if(state.map)build();render();
    if(state.failed)throw Error();
    const hadSteps=state.undoSteps.length||state.redoSteps.length;
    state.undoSteps=[];state.redoSteps=[];updateUI();onHistoryChange();
    status((key==='source'?'已切换拟合起点，沿画布箭头方向对合':atEndpoint?'已从所点轨道端点开始对合':'已切换贴合轨道方向')+(hadSteps?'；连续对合的回退记录重新开始，曲线修改保留':''));
   }catch(_err){Object.assign(state,before);feedback('这个方向暂时不能对合，已保留上一次起点与已有修改。');}
  }
  function chooseTargetNode(pathId,index,end='start'){
   if(!state?.target||pathId!==state.target.id||state.adjusting)return;
   if(state.topologyChanged||state.syncInvalid){feedback('已增删节点或范围暂时不可用，请先展开，再重新选择起点。');return;}
   cancel();const before={...state};
   try{
    state.targetNotchId=N.groups(state.target).find(g=>g.indices.slice(1,-1).includes(index))?.id;
    const reversed=rangeFrame(state.target,state.targetPoints,state.targetReverse).direction<0;
    const next=end==='end'||state.targetEndPinned?sourceRangeFromNode(G,targetBaseline(),state.targetPoints,index,end,state.targetReverse):targetRangeFromNode(G,W,targetBaseline(),index,state.sourceTrack.length,reversed);
    if(end==='end')state.targetEndPinned=true;state.pickKind='target';
    const count=G.segmentCount(state.target);state.targetPoints=state.target.closed?next.points.map(p=>{const value=(p.index+p.t)%count;return {index:Math.floor(value),t:value-Math.floor(value)};}):next.points;state.targetReverse=next.reversed;state.offset=0;state.hover=null;
    if(state.source)build();render();if(state.failed)throw Error();
    const hadSteps=state.undoSteps.length||state.redoSteps.length;
    state.undoSteps=[];state.redoSteps=[];updateUI();onHistoryChange();
    status((end==='end'?'已设置目标曲线终点，保持原长并显示长度差':'已从所点轨道节点开始对合，方向见画布箭头')+(state.targetNotchId?'；剪口尖点按口部缝边位置对合，不计凹口绕行长度':'')+(hadSteps?'；连续对合的回退记录重新开始，曲线修改保留':''));
    advanceEndpoint('target',end);render();
   }catch(err){Object.assign(state,before);feedback((/不同节点/.test(err.message)?err.message+'。':'')+'这个节点暂时不能对合，已保留上一次起点与已有修改。');}
  }
  function switchTargetSide(){
   if(!state?.map||!state.target.closed||state.adjusting||state.topologyChanged||state.syncInvalid)return;
   cancel();const before={...state};
   try{
    state.targetPoints=copy(state.targetPoints).reverse();state.targetReverse=!state.targetReverse;
    // Choosing the other arc explicitly fixes both endpoints, including an
    // automatically chosen fractional end, through later source-range changes.
    state.targetEndPinned=true;state.offset=0;state.hover=null;
    build();render();if(state.failed)throw Error();
    state.undoSteps=[];state.redoSteps=[];updateUI();onHistoryChange();
    status('目标曲线已换另一侧绕行，起终点保持不变，方向见画布箭头');
   }catch(_err){Object.assign(state,before);render();feedback('另一侧暂时不能对合，已保留原路径与已有修改。');}
  }
  function setSourceRange(next){
   if(!state?.source||state.adjusting)return;
   if(state.topologyChanged||state.syncInvalid){feedback('已增删节点或范围暂时不可用，请先展开，再重新选择起终点。');return;}
   cancel();const before={...state};
   try{
    const count=G.segmentCount(state.source);
    state.sourcePoints=state.source.closed?next.points.map(p=>{const value=(p.index+p.t)%count;return {index:Math.floor(value),t:value-Math.floor(value)};}):next.points;state.sourceReverse=next.reversed;
    state.sourceBoundaryNotches=boundaryNotches(state.source,state.sourcePoints);
    choosePiece(state.source);state.clipPoints=copy(state.sourcePoints);state.hover=null;state.node=null;
    if(state.map){
     const target=targetBaseline(),frame=rangeFrame(target,state.targetPoints,state.targetReverse),length=W.track(sourceSeam()).length;
     state.targetPoints=copy(state.targetPoints);if(!state.targetEndPinned)state.targetPoints[state.targetReverse?0:1]=walkEnd(G,W,target,frame.start,length+Math.max(state.offset,0),frame.direction).position;
     build();
    }
    render();if(state.failed)throw Error('这个范围暂时无法对合');
    const hadSteps=state.undoSteps.length||state.redoSteps.length;
    state.undoSteps=[];state.redoSteps=[];state.feedback='';updateUI();onHistoryChange();
    status('已更新原曲线拟合范围，从起点沿箭头到终点'+(state.sourceBoundaryNotches.length?'；剪口尖点按口部缝边位置计长，整个剪口保持原形':'')+(hadSteps?'；连续对合的回退记录重新开始，曲线修改保留':''));
    return true;
   }catch(_err){Object.assign(state,before);feedback('这个范围暂时不能对合，已保留上一次起终点与已有修改。');}
  }
  function chooseSourceNode(pathId,index,end){
   if(!state?.source||pathId!==state.source.id)return;
   try{state.pickKind='source';if(setSourceRange(sourceRangeFromNode(G,state.source,state.sourcePoints,index,end,state.sourceReverse))){advanceEndpoint('source',end);render();}}
   catch(err){feedback(err.message+'，已保留当前拟合范围。');}
  }
  // Endpoint rings coexist with native node centers: click to anchor, drag to edit.
  const directionLabelWidths=new Map();
  function drawDirections(){
   if(!state?.source||state.syncInvalid)return;
   const z=getCamera().z,color=appearance.source,path=getDoc().paths.find(p=>p.id===state.source.id)||state.source;
   const points=state.clipPoints.length===2?state.clipPoints:state.sourcePoints;
   if(points.length!==2)return;
   try{
    const nativeNodes=originalEditing()&&getTool()==='node'?new Set([...$('handles').querySelectorAll('.anchor')].map(n=>`${n.getAttribute('data-path')}:${n.getAttribute('data-node')}`)):new Set();
    const base=sourceBaseline(path);let seam=cut(G,base,...points);if(state.sourceReverse)seam=reverse(seam);
    const track=W.track(seam),ends=points.map(p=>seamPoint(base,p));
    const label=(p,text,key,c,dy=-18)=>{
     const node=element('text',{x:p.x+15/z,y:p.y+dy/z,fill:c,'font-size':12/z,'font-weight':600,'paint-order':'stroke',stroke:'white','stroke-width':4/z,'pointer-events':'none','data-fit-direction-label':key});node.textContent=text;
     let width=directionLabelWidths.get(text);if(width===undefined){width=node.getComputedTextLength()*z;directionLabelWidths.set(text,width);}
     const camera=getCamera(),screenX=p.x*z+camera.x;
     let x=screenX+15;if(x+width>svg.clientWidth-8)x=screenX-15-width;
     node.setAttribute('x',(Math.max(8,Math.min(svg.clientWidth-width-8,x))-camera.x)/z);
    };
    const arrows=(length,at,kind,c)=>{
     if(length*z<12)return;
     for(const fraction of length*z>100?[.25,.65]:[.5]){
      const {point:p,tangent:t}=at(length*fraction),size=Math.min(9,length*z/5)/z;
      element('path',{d:`M ${p.x-t.x*size-t.y*size*.6} ${p.y-t.y*size+t.x*size*.6} L ${p.x} ${p.y} L ${p.x-t.x*size+t.y*size*.6} ${p.y-t.y*size-t.x*size*.6}`,fill:'none',stroke:c,'stroke-width':3/z,'stroke-linecap':'round','stroke-linejoin':'round','pointer-events':'none','data-fit-direction':kind});
     }
    };
    const endRings=(positions,kind)=>{
     const isTarget=kind==='target',c=appearance[kind],overlap=G.dist(...positions)*z<28,name=isTarget?'轨道':'拟合';
     positions.forEach((q,i)=>{
      const atNode=(isTarget?state.target:path).nodes.some(n=>G.dist(n,q)*z<1),selected=i===(state[kind+'Reverse']?1:0),enabled=!state.adjusting&&!state.topologyChanged&&controlsEnabled();
      const ring=element('circle',{cx:q.x,cy:q.y,r:(overlap&&i===1?17:10)/z,fill:'none',stroke:'transparent','stroke-width':6/z,[isTarget?'data-fit-target-start-end':'data-fit-start-end']:i,role:'button','aria-label':selected?`当前${name}起点`:`从这一端开始${isTarget?'对合':'拟合'}`,'aria-pressed':selected,'aria-disabled':!enabled,cursor:enabled?'pointer':'default','pointer-events':enabled?(atNode?'stroke':'all'):'none'});
      const symbolX=q.x+(overlap&&i===1?8/z:0),attrs={fill:selected?c:'white',stroke:c,'stroke-width':1.5/z,'pointer-events':'none','data-fit-end-symbol':kind};
      if(selected)element('circle',{cx:symbolX,cy:q.y,r:4/z,...attrs});else element('rect',{x:symbolX-3/z,y:q.y-3/z,width:6/z,height:6/z,...attrs});
      element('title',{},ring).textContent=state.topologyChanged?'已增删节点，请展开后重选起点':isTarget?'点击标记：从这个轨道端点开始对合':selected?'当前拟合起点；箭头指向拟合方向':'点击标记：从这一端开始拟合';
      const sharedStart=isTarget&&selected&&G.dist(q,targetPosition(state.offset))*z<1;
      if(!state.adjusting&&!sharedStart)label(q,selected?`${name}起点`:isTarget?'轨道终点':'拟合终点',selected?(isTarget?'target-origin':'source-start'):`${kind}-end`,c,overlap&&i===1?40:isTarget?24:-18);
     });
    };
    arrows(track.length,s=>W.at(track,s),'source',color);
    if(!state.adjusting&&!state.topologyChanged&&controlsEnabled()&&state.sourcePick!=='none')path.nodes.forEach((q,i)=>{
     const node=element('circle',{cx:q.x,cy:q.y,r:6/z,fill:'transparent',stroke:'transparent','stroke-width':4/z,'data-fit-source-node':i,'data-path':path.id,'data-node':i,role:'button','aria-label':`将原曲线第 ${i+1} 个节点设为拟合${state.sourcePick==='end'?'终点':'起点'}`,cursor:'pointer','pointer-events':nativeNodes.has(`${path.id}:${i}`)?'none':'all'});
     if(!nativeNodes.has(`${path.id}:${i}`))element('circle',{cx:q.x,cy:q.y,r:3/z,fill:q.color||'white',stroke:color,'stroke-width':1.2/z,'pointer-events':'none','data-fit-source-node-symbol':true});
     element('title',{},node).textContent=`单击：设为拟合${state.sourcePick==='end'?'终点':'起点'}`+(originalEditing()&&getTool()==='node'?'；拖动：修改原节点':'');
    });
    endRings(ends,'source');
    for(const node of group.querySelectorAll('[data-fit-source-node]'))group.append(node);
    if(state.map&&!state.failed&&!state.adjusting){
     const start=targetPosition(state.offset),length=state.sourceTrack.length;
     element('circle',{cx:start.x,cy:start.y,r:3/z,fill:appearance.target,stroke:'white','stroke-width':1/z,'pointer-events':'none','data-fit-alignment-start':'true'});
     label(start,state.offset===0?'轨道 / 对合起点':'对合起点','target-start',appearance.target);
     arrows(length,s=>{const p=targetPosition(s+state.offset);return {point:p,tangent:p.tangent};},'target',appearance.target);
     const target=getDoc().paths.find(p=>p.id===state.target.id)||state.target;
     if(controlsEnabled())target.nodes.forEach((q,i)=>{
      const enabled=!state.topologyChanged,selected=G.dist(q,start)*z<1;
      const node=element('circle',{cx:q.x,cy:q.y,r:6/z,fill:'transparent',stroke:'transparent','stroke-width':4/z,'data-fit-target-node':i,'data-path':target.id,'data-node':i,role:'button','aria-label':`将目标曲线第 ${i+1} 个节点设为${state.targetPick==='end'?'终点':'起点'}`,'aria-pressed':selected,'aria-disabled':!enabled,cursor:enabled?'pointer':'default','pointer-events':enabled?'all':'none'});
      element('circle',{cx:q.x,cy:q.y,r:3/z,fill:selected?appearance.target:'white',stroke:appearance.target,'stroke-width':1.2/z,'pointer-events':'none'});
      element('title',{},node).textContent=state.targetPick==='end'?'单击：设为目标终点':'单击：从这个节点开始对合'+(originalEditing()&&getTool()==='node'&&L.editable(getDoc(),target.id)?'；拖动：修改原节点':'');
     });
     endRings(state.targetPoints.map(p=>seamPoint(targetBaseline(),p)),'target');
     // A mouth station can be close to a different original notch node. Keep
     // node picking above the endpoint ring so its stroke cannot reverse the
     // route instead of selecting the node the user clicked.
     for(const node of group.querySelectorAll('[data-fit-target-node]'))group.append(node);
    }
   }catch(_err){/* A temporarily invalid original range retains the last fitting. */}
  }
  function instructions(){
   if(gesture?.kind==='offset')return '先放好金色点，松手后曲线沿轨道走';
   if(motion)return '正在沿贴合轨道移动';
   if(state.syncInvalid)return '原曲线已修改，当前范围暂时无法预览';
   if(state.failed)return '这段边暂时无法对合，原线仍在';
   if(state.adjusting)return '拖原曲线和轨道端点，调整对合范围';
   if(state.phase==='source')return '点起点或终点按钮，再直接点节点';
   if(state.phase==='target')return '点目标曲线起终点按钮，再直接点节点';
   return state.editing?'已打开曲线编辑':`已对合 ${G.segmentCount(state.sourceTrack.path)} 段${state.partial?'，只移动所选部分':''}`;
  }
  function updateUI(){
   if(!state)closeColorPicker();
   $('fitting-guide-actions').hidden=!state;
   $('fitting-target-range').hidden=!state;
   const blocked=!state||state.adjusting||state.topologyChanged||!!state.syncInvalid;
   for(const kind of ['source','target'])for(const end of ['start','end'])for(const prefix of ['fitting-','fitting-guide-']){
    const button=$(prefix+kind+'-'+end);button.disabled=blocked;
    button.setAttribute('aria-pressed',state?.pickKind===kind&&state?.[kind+'Pick']===end);
   }
   for(const id of ['fitting-original','fitting-guide-original']){const button=$(id);button.hidden=!state?.map;button.disabled=!!state?.adjusting||!!state?.failed||!!state?.syncInvalid;button.setAttribute('aria-pressed',!!state?.showFitted);button.textContent=state?.showFitted?'隐藏拟合曲线':'显示拟合曲线';}
   $('fitting-guide-caption').textContent=state?'拟合快捷操作':'操作提示';
   $('fitting-guide-pick-hint').textContent=state?.sourcePick==='none'&&state?.pickKind==='source'?'拖动节点编辑曲线':`点画布${state?.pickKind==='target'?'目标':'原'}曲线节点，设置${state?.[state?.pickKind+'Pick']==='end'?'终点':'起点'}`;
   $('fitting-source-range').hidden=!state;
   for(const key of ['start','end','none']){
    $('fitting-source-'+key).setAttribute('aria-pressed',state?.pickKind==='source'&&state?.sourcePick===key);
    $('fitting-source-'+key).disabled=blocked||key==='none'&&!state?.source;
   }
   for(const kind of ['source','target'])for(const prefix of ['fitting-','fitting-guide-']){const button=$(prefix+kind+'-other-side');button.hidden=!state?.[kind]?.closed;button.disabled=blocked||kind==='target'&&!state?.map;}
   $('fitting-source-pick-hint').textContent=(state?.sourcePick==='none'?'原曲线节点用于选择和编辑；可随时切回点选起终点。':`正在点选${state?.sourcePick==='end'?'终点':'起点'}：单击原曲线节点，方向见箭头。`)+(state?.sourceBoundaryNotches.length?' 起终点位于剪口内，按口部缝边位置对合；完整剪口保持原形，不拉伸。':'');
   $('fitting-panel').dataset.phase=state?.phase||'idle';$('fitting-panel').dataset.preview=state?.failed?'error':'ok';
   $('fitting-panel').dataset.positionState=gesture?.kind==='offset'?'placing':motion?'moving':'idle';
   $('fitting-guide').hidden=!state;$('fitting-guide').dataset.mode=guideMode;
   $('fitting-guide-content').hidden=guideMode!=='expanded';$('fitting-guide-caption').hidden=guideMode!=='expanded';$('fitting-guide-expand').hidden=guideMode==='expanded';$('fitting-guide-minimize').hidden=guideMode!=='expanded';$('fitting-guide-show').hidden=!state||guideMode==='expanded';
   $('fitting-controls').hidden=!state?.map||!!state?.syncInvalid;$('fitting-start').hidden=!!state;
   $('fitting-unbend').disabled=!state;$('fitting-exit').disabled=!state;$('fitting-restart').disabled=!state;
   $('fitting-feedback').hidden=!state?.feedback;$('fitting-feedback').textContent=state?.feedback||'';placeGuide();
   if(!state){$('fitting-whole').disabled=false;$('fitting-summary').textContent='进入拟合后，在快捷操作中依次点选原曲线和目标曲线的起点、终点。';return;}
   $('fitting-summary').textContent=instructions();
   $('fitting-guide-unbend').hidden=!state.map;$('fitting-edit').setAttribute('aria-pressed',state.editing);$('fitting-edit').textContent=state.editing?'完成拟合编辑':'编辑拟合曲线';
   $('fitting-continue').disabled=!state.map||state.failed||state.adjusting||state.topologyChanged;
   $('fitting-back').disabled=!state.undoSteps.length||state.topologyChanged||state.adjusting;
   $('fitting-adjust').disabled=state.topologyChanged;
   $('fitting-whole').disabled=state.topologyChanged;
   $('fitting-span-count').textContent=state.map?`已连续对合 ${G.segmentCount(state.sourceTrack.path)} 段曲线 · ${state.partial?'仅选段随动':'整片随动'} · 长度保持`:'';
   $('fitting-adjust').setAttribute('aria-pressed',state.adjusting);$('fitting-adjust').textContent=state.adjusting?'完成范围调整':'调整对合范围';
   $('fitting-action-help').textContent=state.adjusting?'原曲线终点可跨过多个节点，一次选中连续多段；拖好后点“完成范围调整”。':state.editing?'浮窗可设原曲线和目标曲线的起终点。点轨道任意节点设对应端点。拖拟合方点或圆柄改形；双击加点。灰色点请展开后修改。':'浮窗可设原曲线与目标曲线的起终点；轨道任意节点均可选，箭头标明方向。拖动仍修改原节点，需精细微调时切到“编辑节点”。金色点调整对合位置。';
   $('fitting-piece').textContent=state.source?`原曲线：${state.source.name||'所选轮廓'}${state.target?` · 轨道：${state.target.name||'所选轨道'}`:''}${state.partial?' · 未选部分保留原位':` · 随动 ${state.ids.size} 条线`}`:'';
  }
  function colorDot(path,n,index,p,parent){element('circle',{cx:p.x,cy:p.y,r:4/getCamera().z,fill:n.color,stroke:'white','stroke-width':1.5/getCamera().z,'pointer-events':'none','data-fit-node-color-path':path.id,'data-fit-node-color-index':index},parent);}
  function highlightOriginals(){
   originals.replaceChildren();if(!state)return;const z=getCamera().z,doc=getDoc(),colors=()=>{for(const path of doc.paths.filter(p=>L.visible(doc,p.id)))path.nodes.forEach((n,i)=>{if(n.color)colorDot(path,n,i,n,originals);});};
   if(!state.source){colors();return;}const path=doc.paths.find(p=>p.id===state.source.id)||state.source;
   const label=(p,text,color,attrs,parent=originals)=>{const top=p.nodes.reduce((a,b)=>b.y<a.y?b:a);element('text',{x:top.x+9/z,y:top.y-13/z,fill:color,'font-size':13/z,'font-weight':600,'paint-order':'stroke',stroke:'white','stroke-width':4/z,...attrs},parent).textContent=text;};
   const sourceGroup=element('g',{'data-fit-source-original':'true'},originals);
   element('path',{d:G.pathD(path),fill:'none',stroke:appearance.source,'stroke-width':10/z,opacity:.13},sourceGroup);
   element('path',{d:G.pathD(path),fill:'none',stroke:appearance.source,'stroke-width':2.5/z,'data-fit-original':path.id},sourceGroup);
   const points=state.clipPoints.length===2?state.clipPoints:state.sourcePoints;
   if(points.length===2)try{element('path',{d:G.pathD(cut(G,baseline(path),...points)),fill:'none',stroke:appearance.source,'stroke-width':5/z,'data-fit-source-range':'true'},sourceGroup);}catch(_err){}
   label(path,`原曲线 · ${path.name||'所选轮廓'}`,appearance.source,{'data-fit-original-label':path.id},sourceGroup);
   if(state.target){element('path',{d:G.pathD(targetBaseline()),fill:'none',stroke:appearance.target,'stroke-width':3/z,opacity:.8,'data-fit-target-route':'true'},originals);label(state.target,'贴合轨道 · 松手后沿轨道走',appearance.target,{});}
   colors();
  }
  function applyFittedVisibility(){
   if(!state?.map||state.showFitted)return;
   for(const e of group.querySelectorAll('[data-fit-fitted]'))e.style.display='none';
  }
  function drawPositionControl(){
   group.querySelector('[data-fit-position-control]')?.remove();const z=getCamera().z,pending=gesture?.kind==='offset'?gesture:null,placing=pending||motion,q=targetPosition(placing?placing.to:state.offset),h=placing?placing.point:{x:q.x-q.tangent.y*26/z,y:q.y+q.tangent.x*26/z},control=element('g',{'data-fit-position-control':'true'});
   element('line',{x1:q.x,y1:q.y,x2:h.x,y2:h.y,stroke:'#c47713','stroke-width':1.5/z,'pointer-events':'none',...(placing?{'stroke-dasharray':`${4/z} ${3/z}`}:{})},control);
   if(placing)element('circle',{cx:q.x,cy:q.y,r:6/z,fill:'white',stroke:appearance.target,'stroke-width':2/z,'data-fit-offset-landing':'true','pointer-events':'none'},control);
   if(motion){const head=targetPosition(state.offset);element('circle',{cx:head.x,cy:head.y,r:4/z,fill:appearance.source,stroke:'white','stroke-width':1.5/z,'data-fit-position-head':'true','pointer-events':'none'},control);}
   element('circle',{cx:h.x,cy:h.y,r:9/z,fill:'transparent',stroke:'transparent','stroke-width':2/z,'data-fit-offset':'true','aria-label':'对合位置',cursor:'grab','pointer-events':controlsEnabled()?'all':'none'},control);
   element('circle',{cx:h.x,cy:h.y,r:5/z,fill:'#fff5dd',stroke:'#b86b00','stroke-width':1.5/z,'pointer-events':'none'},control);
   element('title',{},control).textContent='拖动定位点，松手后曲线沿轨道移动';
   element('text',{x:h.x+13/z,y:h.y+4/z,fill:'#9c6415','font-size':12/z,'paint-order':'stroke',stroke:'white','stroke-width':3/z,'pointer-events':'none'},control).textContent=pending?'松手后沿轨道走':motion?'曲线沿轨道移来':'对合位置';
  }
  function offsetBounds(){return state.routeLoop?{min:0,max:state.routeTrack.length}:{min:-state.routeOrigin,max:Math.max(0,state.routeTrack.length-state.routeOrigin-state.sourceTrack.length)};}
  function render(){
   group.replaceChildren();restoreLines();highlightOriginals();$('handles').style.display=capturesCanvas()?'none':'';$('selection-overlay').style.display=capturesCanvas()?'none':'';
   if(!state){updateUI();return;}
   if(state.syncInvalid){state.failed=true;locks(false);$('fitting-lengths').textContent='当前范围暂时无法预览，请修改原图、撤销或展开';updateUI();return;}
   locks(capturesCanvas());svg.style.cursor=state.map?'default':'crosshair';const z=getCamera().z,doc=getDoc();
   if(!state.map||state.adjusting){
    drawSeam(state.source,state.sourcePoints,appearance.source,'source');drawSeam(state.target,state.targetPoints,appearance.target,'target');
    if(state.hover){const {path,hit:h}=state.hover;drawSeam(path,[{index:h.index,t:0},{index:h.index,t:1}],state.phase==='source'?appearance.source:appearance.target,'hover');}
    drawDirections();drawEndpointSelection();updateUI();return;
   }
   try{
    const paths=previewPaths(),key=JSON.stringify([state.offset,state.partial,state.clipPoints,paths]);
    if(state.cache?.key!==key)state.cache={key,paths:paths.map(path=>{const local=state.partial&&path.id===state.source.id?cut(G,path,...displayRange(path)):path,notches=inlineNotches(path).map(g=>notchProjection(path,g));return {path,d:notches.length?protectedPathData(path,notches):pathData(local),mark:marker(path),local,notches};}),seam:joinedSeam()};
    const nodeData=[];
    const selected=paths.find(p=>p.id===state.selected);
    const shown=p=>{try{return {q:mapPoint(p),disabled:false};}catch(_err){return {q:displayPoint(p),disabled:true};}};
    if(state.editing&&selected)selected.nodes.forEach((n,i)=>{if(n.notchId||state.partial&&selected.id===state.source.id&&!inside(G,selected,state.clipPoints,i,0))return;const boundary=nodeBoundary(selected,i);nodeData.push({i,...shown(n),boundary,handles:i===state.node&&!boundary?['in','out'].filter(side=>G.dist(n,n[side])*z>.5).map(side=>({side,...shown(n[side])})):[]});});
    // Only hide originals after every preview path and editable handle succeeded.
    if(state.editing&&state.showFitted)for(const item of state.cache.paths){const line=$('paths').querySelector(`.hit-line[data-path="${CSS.escape(item.path.id)}"]`);if(line){line.style.pointerEvents='none';if(state.partial&&item.path.id===state.source.id){const d=remainder(G,item.path,displayRange(item.path)).map(G.pathD).join(' ');for(const e of [line,line.previousElementSibling]){changedVisuals.set(e,e.getAttribute('d'));e.setAttribute('d',d);}element('path',{d:G.pathD(item.local),fill:'none',stroke:appearance.source,opacity:.2,'stroke-width':2/z,'pointer-events':'none','data-fit-original-part':'true'});}else{line.style.opacity='.22';line.previousElementSibling.style.opacity='.22';}}}
    for(const {path,d,mark}of state.cache.paths){
     const color=mark&&!state.editing?'#c47713':appearance.source;
     element('path',{d,fill:'none',stroke:color,'stroke-width':(mark?3:2)/z,'pointer-events':'none',...(path.dashed?{'stroke-dasharray':`${7/z} ${5/z}`}:{})});
     element('path',{d,fill:'none',stroke:'transparent','stroke-width':18/z,'data-fit-path':path.id,'pointer-events':state.editing||mark&&controlsEnabled()?'stroke':'none',...(mark&&!state.editing?{'data-fit-marker':'true',cursor:'grab'}:{})});
     if(mark&&!state.editing){const q=displayPoint(path.nodes[mark.index]);element('circle',{cx:q.x,cy:q.y,r:6/z,fill:'#fff5dd',stroke:'#c47713','stroke-width':2/z,'data-fit-mark-root':path.id,'data-fit-marker':'true',cursor:'grab','pointer-events':controlsEnabled()?'all':'none'});element('text',{x:q.x+10/z,y:q.y-8/z,fill:'#a86508','font-size':12/z,'paint-order':'stroke',stroke:'white','stroke-width':3/z,'pointer-events':'none'}).textContent='剪口';}
    }
    element('path',{d:G.pathD(state.targetTrack.path),fill:'none',stroke:appearance.target,'stroke-width':4/z,'pointer-events':'none','data-fit-fixed-seam':'true'});
    element('path',{d:state.cache.seam,fill:'none',stroke:appearance.source,'stroke-width':2.5/z,'stroke-dasharray':`${7/z} ${5/z}`,'pointer-events':'none','data-fit-joined-seam':'true'});
    for(const {path,notches}of state.cache.paths)for(const notch of notches){
     const attrs={'data-fit-path':path.id,'data-fit-notch-id':notch.g.id,cursor:'grab','pointer-events':controlsEnabled()?'stroke':'none'},q=notch.point(notch.g.anchor);
     element('path',{d:notch.d,fill:'none',stroke:'transparent','stroke-width':18/z,...attrs,'data-fit-inline-hit':'true'});
     element('path',{d:notch.d,fill:'none',stroke:'#c47713','stroke-width':3/z,...attrs,'data-fit-inline-notch':notch.g.id});
     const outside=notch.station<-.001||notch.station>state.sourceTrack.length+.001;
     const control=element('circle',{cx:q.x,cy:q.y,r:6/z,fill:'transparent',stroke:'#c47713','stroke-width':1.5/z,...attrs,'data-fit-inline-root':notch.g.id});element('title',{},control).textContent=outside?'剪口在本次缝边范围外，扩大对合范围后可拖动':'剪口：拖动整个剪口，形状保持';
    }
    const seamEnd=targetPosition(state.sourceTrack.length+state.offset);element('circle',{cx:seamEnd.x,cy:seamEnd.y,r:4/z,fill:'white',stroke:appearance.source,'stroke-width':2/z,'pointer-events':'none'});element('text',{x:seamEnd.x+9/z,y:seamEnd.y-8/z,fill:appearance.source,'font-size':12/z,'paint-order':'stroke',stroke:'white','stroke-width':3/z,'pointer-events':'none'}).textContent='对合到这里';
    for(const {i,q,handles,disabled,boundary}of nodeData){for(const {side,q:h,disabled:blocked}of handles){element('line',{x1:q.x,y1:q.y,x2:h.x,y2:h.y,stroke:appearance.source,'stroke-width':1/z,'pointer-events':'none'});element('circle',{cx:h.x,cy:h.y,r:6/z,fill:'white',stroke:blocked?'#9ba7b4':appearance.source,'stroke-width':1.5/z,...(blocked?{'data-fit-node-disabled':'true'}:{'data-fit-owner':selected.id,'data-fit-node':i,'data-fit-side':side})});}element('rect',{x:q.x-5/z,y:q.y-5/z,width:10/z,height:10/z,fill:disabled||boundary?'#e8edf2':i===state.node?appearance.source:'white',stroke:disabled||boundary?'#9ba7b4':appearance.source,'stroke-width':1.5/z,...(boundary?{'data-fit-node-boundary':'true'}:disabled?{'data-fit-node-disabled':'true'}:{'data-fit-owner':selected.id,'data-fit-node':i})});}
    for(const {path,notches}of state.cache.paths)path.nodes.forEach((n,i)=>{if(!n.color||state.partial&&path.id===state.source.id&&!inside(G,path,displayRange(path),i,0))return;const notch=notches.find(item=>item.indices.has(i));colorDot(path,n,i,notch?notch.point(n):displayPoint(n),group);});
    drawPositionControl();
    // The moving copy and its editing targets share visibility. Originals and
    // the fixed target remain available for comparison and endpoint picking.
    for(const e of group.children)if(!e.hasAttribute('data-fit-fixed-seam'))e.setAttribute('data-fit-fitted','true');
    state.failed=false;
    drawDirections();drawEndpointSelection();applyFittedVisibility();
    // A start ring may cross a notch or handle after sliding along the track.
    // Keep those editing controls on top so dragging cannot change the start.
    for(const control of group.querySelectorAll('[data-fit-mark-root],[data-fit-inline-hit],[data-fit-inline-notch],[data-fit-inline-root],[data-fit-owner],[data-fit-node-boundary],[data-fit-position-control]'))group.append(control);
   }catch(_err){group.replaceChildren();restoreLines();state.failed=true;state.feedback='这段边弯曲后有重叠，暂时无法预览。原线和已有修改都保留，请换一段边或返回原形。';}
   const diff=state.map.sourceLength-state.map.targetLength;
   const bounds=offsetBounds();$('fitting-offset').min=bounds.min;$('fitting-offset').max=bounds.max;
   $('fitting-lengths').textContent=`原曲线 ${lengthText(state.map.sourceLength)} · 固定轨道 ${lengthText(state.map.targetLength)} · ${Math.abs(diff)<.005?'等长':`原曲线${diff>0?'长出':'不足'} ${lengthText(Math.abs(diff))}，不拉长`}`;
   $('fitting-offset-value').textContent=lengthText(state.offset);$('fitting-offset').value=state.offset;
   updateUI();
  }
  function pointerDown(e,p){
   if(!state)return;
   if(motion){stopMotion();render();}
   const picked=pickNode(e.target,p);
   if(picked){gesture={kind:'range-node-pick',pick:picked,start:{x:e.clientX,y:e.clientY},moved:false};return;}
   const startEnd=e.target.getAttribute('data-fit-start-end');
   if(startEnd!==null&&!state.adjusting){changeDirection('source',Number(startEnd)===1);return;}
   const targetStartEnd=e.target.getAttribute('data-fit-target-start-end');
   if(targetStartEnd!==null&&!state.adjusting){changeDirection('target',Number(targetStartEnd)===1,true);return;}
   if(state.adjusting){const kind=e.target.getAttribute('data-fit-range'),index=e.target.getAttribute('data-fit-end');if(kind&&index!==null)gesture={kind:'range',key:kind,index:Number(index),before:copy(state[kind+'Points']),targetBefore:copy(state.targetPoints),notchesBefore:copy(state.sourceBoundaryNotches)};return;}
   if(directPicking()){let nearest=null;for(const path of endpointCandidates(state.pickKind))for(const [index,q]of path.nodes.entries()){const distance=G.dist(p,q)*getCamera().z;if(distance<=10&&(!nearest||distance<nearest.distance))nearest={pathId:path.id,index,distance};}if(nearest)chooseEndpoint({kind:state.pickKind,end:state[state.pickKind+'Pick'],...nearest});else feedback('请直接点曲线节点，设置'+(state[state.pickKind+'Pick']==='end'?'终点':'起点'));return;}
   if(!state.map){if(state.endpointPicking&&state.pickKind==='target'){feedback('请点对应的起点或终点按钮，再点曲线节点');return;}selectSeam(p);return;}
   if(state.failed)return;
   if(e.target.hasAttribute('data-fit-node-boundary')){state.node=null;feedback('局部两端固定，避免牵动未选轮廓。可双击中间加点，再调整内部形状。');return;}
   if(e.target.hasAttribute('data-fit-node-disabled')){feedback('此处弯曲后有重叠，请展开后修改这个点；已有修改保留。');return;}
   if(e.target.hasAttribute('data-fit-offset')){const q=targetPosition(state.offset);gesture={kind:'offset',before:state.offset,to:state.offset,point:p,shift:{x:p.x-q.x,y:p.y-q.y}};drawPositionControl();updateUI();return;}
   const id=e.target.getAttribute('data-fit-path')||e.target.getAttribute('data-fit-mark-root');
   const notchId=e.target.getAttribute('data-fit-notch-id');
   if(notchId){
    const path=previewPaths().find(p=>p.id===id),feature=path&&inlineNotches(path).find(g=>g.id===notchId);if(!feature)return;
    // Re-rendering on pointerup replaces the hit path, so browsers can deliver
    // native dblclick to the canvas. Track the stable notch identity instead.
    if(state.editing&&taps?.push({x:e.clientX,y:e.clientY,time:e.timeStamp,key:'notch:'+id+':'+notchId})){suppressDoubleUntil=e.timeStamp+600;feedback('剪口整体保持形状；需要改剪口形状时，请先展开。');return;}
    const station=sourceStation(feature.anchor);if(station<-.001||station>state.sourceTrack.length+.001){feedback('这个剪口在本次缝边范围外，请先扩大对合范围，再整体拖动。');return;}
    try{const q=mapPoint(feature.anchor);if(G.dist(state.map.inverse(q,feature.anchor),feature.anchor)>.03)throw Error();gesture={kind:'inline',id,feature,base:copy(path),from:station,shift:{x:p.x-q.x,y:p.y-q.y},start:p,moved:false,last:p,lastStation:station};}catch(_err){feedback('此处剪口位置有重叠，请调整对合位置后再拖动。');}return;
   }
   if(!state.editing){
    const path=getDoc().paths.find(p=>p.id===id),mark=path&&marker(path);
    if(mark){try{const original=path.nodes[mark.index],q=mapPoint(original);if(G.dist(state.map.inverse(q,original),original)>.03)throw Error();gesture={kind:'mark',id,base:copy(path),from:mark.s,root:mark.index,shift:{x:p.x-q.x,y:p.y-q.y},start:p,moved:false,last:p,lastStation:mark.s};}catch(_err){feedback('此处剪口弯曲后有重叠，请调整对合位置或展开后修改。');}}
    else if(id)feedback('这条是轮廓线。要改形状，请点右侧“编辑拟合曲线”；橙色剪口可以直接拖。');
    return;
   }
   const owner=e.target.getAttribute('data-fit-owner'),index=e.target.getAttribute('data-fit-node');
   if(owner&&index!==null){
    const path=previewPaths().find(p=>p.id===owner);if(!path||nodeBoundary(path,Number(index)))return;
    const side=e.target.getAttribute('data-fit-side'),base=path.nodes[Number(index)],original=side?base[side]:base;
    try{if(G.dist(state.map.inverse(mapPoint(original),original),original)>.03)throw Error();}catch(_err){feedback('此处弯曲重叠，请换一个位置，或展开后修改。');return;}
    state.selected=owner;state.node=Number(index);onBegin();gesture={kind:'node',id:owner,index:state.node,side,base:copy(base)};render();return;
   }
   if(id){if(taps?.push({x:e.clientX,y:e.clientY,time:e.timeStamp,key:id})){suppressDoubleUntil=e.timeStamp+600;doubleClick({target:e.target,type:'fit-tap'},p);return;}state.selected=id;state.node=null;render();}else taps?.reset();
  }
  function targetStation(p,near){
   const track=state.routeTrack;let best=W.nearest(track,p);
   if(state.routeLoop){const s=best.s-state.routeOrigin;return Number.isFinite(near)?s+Math.round((near-s)/track.length)*track.length:s;}
   for(const s of [0,track.length]){
    const edge=W.at(track,s),projection=(p.x-edge.point.x)*edge.tangent.x+(p.y-edge.point.y)*edge.tangent.y;
    if(s===0?projection>=0:projection<=0)continue;
    const q={x:edge.point.x+projection*edge.tangent.x,y:edge.point.y+projection*edge.tangent.y},distance=G.dist(p,q);
    if(distance<best.distance-1e-7)best={s:s+projection,distance};
   }
   return best.s-state.routeOrigin;
  }
  function pointerMove(e,p){
   if(!gesture){if(state&&!state.map&&!state.endpointPicking){const h=hit(p,candidates()),old=state.hover;state.hover=h;if(h?.path.id!==old?.path.id||h?.hit.index!==old?.hit.index)render();}return;}
   if(gesture.kind==='range-node-pick'){gesture.moved ||= G.dist(gesture.start,{x:e.clientX,y:e.clientY})>4;return;}
   try{
    if(gesture.kind==='range'){
     const g=gesture,path=state[g.key],h=G.nearest(path,p),before=copy(state[g.key+'Points']),targetBefore=copy(state.targetPoints),notchesBefore=state.sourceBoundaryNotches;state[g.key+'Points'][g.index]={index:h.index,t:h.t};
     try{
      cut(G,path,...state[g.key+'Points']);
      if(g.key==='source'&&!state.targetEndPinned){
       const target=targetBaseline(),frame=rangeFrame(target,state.targetPoints,state.targetReverse);
       state.targetPoints[state.targetReverse?0:1]=walkEnd(G,W,target,frame.start,W.track(sourceSeam()).length,frame.direction).position;
      }
      build();
     }catch(_err){state[g.key+'Points']=before;state.targetPoints=targetBefore;state.sourceBoundaryNotches=notchesBefore;}
     render();return;
    }
    if(gesture.kind==='offset'){const bounds=offsetBounds(),to=targetStation({x:p.x-gesture.shift.x,y:p.y-gesture.shift.y},gesture.to);gesture.to=state.routeLoop?to:Math.max(bounds.min,Math.min(bounds.max,to));gesture.point=p;drawPositionControl();updateUI();return;}
    const path=getDoc().paths.find(p=>p.id===gesture.id),base=gesture.base;
    if(gesture.kind==='mark'||gesture.kind==='inline'){
     if(!gesture.moved&&G.dist(p,gesture.start)*getCamera().z<2)return;
     const desired={x:p.x-gesture.shift.x,y:p.y-gesture.shift.y},to=Math.max(0,Math.min(state.sourceTrack.length,targetStation(desired,state.offset+gesture.lastStation)-state.offset));
     const maximumJump=Math.max(G.dist(p,gesture.last)*3,state.sourceTrack.length*.04);
     if(Math.abs(to-gesture.lastStation)>maximumJump)throw Error();
     let nodes;
     if(gesture.kind==='inline'){
      const low=Math.min(...gesture.feature.indices.map(i=>W.nearest(state.sourceTrack,base.nodes[i]).s)),high=Math.max(...gesture.feature.indices.map(i=>W.nearest(state.sourceTrack,base.nodes[i]).s));
      if(to-gesture.from+low<-.001||to-gesture.from+high>state.sourceTrack.length+.001)throw Error();
      nodes=N.rigid(G,base,gesture.feature,W.at(state.sourceTrack,gesture.from),W.at(state.sourceTrack,to)).nodes;
     }else{nodes=moveMark(G,W,base,state.sourceTrack,gesture.from,to);pathData({...path,nodes},mapPoint);}
     gesture.last=p;gesture.lastStation=to;
     if(!gesture.moved){onBegin();gesture.moved=true;}path.nodes=nodes;state.feedback='';onDraft();return;
    }
    const q=state.map.inverse(p,gesture.side?base[gesture.side]:base);
    if(!Number.isFinite(q.x)||!Number.isFinite(q.y)||Math.abs(q.x)>1e7||Math.abs(q.y)>1e7)throw Error();
    path.nodes[gesture.index]=copy(base);if(gesture.side)G.handle(path.nodes[gesture.index],gesture.side,q,e.altKey);else G.move(path.nodes[gesture.index],q.x-base.x,q.y-base.y);state.feedback='';onDraft();
   }catch(_err){feedback('这个位置无法可靠展开，已保留上一个有效位置。可稍微移近缝边再试。');}
  }
  function pointerUp(){if(!gesture)return;const g=gesture,edit=g.kind==='node'||['mark','inline'].includes(g.kind)&&g.moved;gesture=null;if(g.kind==='range-node-pick'){if(!g.moved)chooseNode(g.pick);return;}if(g.kind==='offset'){animateOffset(g.to,g.point);return;}if(edit)onCommit('拟合修改已保留，展开后带回原纸样');else render();}
  function cancel(){
   const moving=!!motion;stopMotion();
   if(!gesture){if(moving)render();return;}const g=gesture;gesture=null;
   if(g.kind==='node'||['mark','inline'].includes(g.kind)&&g.moved){const path=getDoc().paths.find(p=>p.id===g.id);if(path){if(g.kind==='node')path.nodes[g.index]=g.base;else path.nodes=copy(g.base.nodes);}onDraft();}
   else if(g.kind==='range'){state[g.key+'Points']=g.before;state.targetPoints=g.targetBefore;state.sourceBoundaryNotches=g.notchesBefore;try{build();}catch(_err){}}
   else if(g.kind==='offset'&&state?.map){state.offset=g.before;state.map.setOffset(g.before);}render();
  }
  function doubleClick(e,p){
   if(pickNode(e.target))return;
   if(!state?.map||!state.editing||state.failed||e.type==='dblclick'&&e.timeStamp<suppressDoubleUntil)return;
   if(e.target.hasAttribute('data-fit-notch-id')){feedback('剪口整体保持形状；需要改剪口形状时，请先展开。');return;}
   try{
    const id=e.target.getAttribute('data-fit-path');let best=null;
    for(const path of previewPaths().filter(path=>!id||path.id===id))for(let i=0;i<G.segmentCount(path);i++)for(let j=0;j<=60;j++){if(state.partial&&path.id===state.source.id&&!inside(G,path,state.clipPoints,i,j/60))continue;const hint=G.at(path.nodes[i],path.nodes[(i+1)%path.nodes.length],j/60);let distance;try{distance=G.dist(mapPoint(hint),p);}catch(_err){continue;}if(distance<(best?.distance??Infinity))best={path,hint,distance};}
    if(!best||best.distance>14/getCamera().z)return;
    const {path,hint}=best;if(path.nodes.length>=10000)throw Error();const q=state.map.inverse(p,hint),h=G.nearest(path,q);if(h.t<1e-6||h.t>1-1e-6||state.partial&&path.id===state.source.id&&!inside(G,path,state.clipPoints,h.index,h.t))return;
    if(N.groups(path).some(g=>g.indices.slice(0,-1).includes(h.index))){feedback('剪口整体保持形状；需要改剪口形状时，请先展开。');return;}
    onBegin();state.node=G.split(path,h.index,h.t);splitClip(path,h.index,h.t);state.selected=path.id;onCommit('已在弯曲视图加点，展开后保留');
   }catch(_err){feedback('这里无法安全加点，请换一个位置，或展开后修改。');}
  }
  function keydown(e){
   if(e.isComposing||e.keyCode===229)return false;
   if(!state)return false;const key=e.key.toLowerCase(),mod=e.metaKey||e.ctrlKey;
   if(key==='escape'){if(originalEditing()&&getNativeGesture())return false;e.preventDefault();if(state.endpointReplacement){state=state.endpointReplacement;render();onHistoryChange();status('已取消重选，恢复之前的拟合范围');}else unbend();return true;}
   if(e.target.closest('input,textarea,select')||e.target.isContentEditable)return false;
   if(mod&&['z','y'].includes(key)){if(history(key==='z'&&!e.shiftKey)){e.preventDefault();return true;}if(originalEditing()&&state.lastMutation==='original')return false;stop();return false;}
   if(originalEditing())return false;
   if(e.target.closest('button,summary')&&(key==='enter'||e.code==='Space'))return false;
   if(e.target.closest('input,textarea,select'))return false;
   if(motion){stopMotion();render();}
   if(['delete','backspace'].includes(key)){e.preventDefault();const path=previewPaths().find(p=>p.id===state.selected);if(state.editing&&path&&state.node!==null&&path.nodes.length>(path.closed?3:2)){if(nodeBoundary(path,state.node)){feedback('局部两端固定，不能删除边界点。');return true;}onBegin();if(path.id===state.source.id){const count=G.segmentCount(path)-1;state.clipPoints=state.clipPoints.map(p=>{const index=p.index-(p.index>=state.node?1:0);return {...p,index:path.closed?(index+count)%count:Math.max(0,Math.min(count-1,index))};});state.topologyChanged=true;state.cache=null;}path.nodes.splice(state.node,1);state.node=null;onCommit('已删除拟合节点，展开后保留');}return true;}
   if(['arrowleft','arrowright','arrowup','arrowdown'].includes(key)){
    e.preventDefault();const path=previewPaths().find(p=>p.id===state.selected),n=path?.nodes[state.node];if(!state.editing||!n)return true;
    if(nodeBoundary(path,state.node)){feedback('局部两端固定，避免影响未选轮廓。');return true;}try{const p=mapPoint(n);if(G.dist(state.map.inverse(p,n),n)>.03)throw Error();const d=e.shiftKey?10:1,q=state.map.inverse({x:p.x+(key==='arrowleft'?-d:key==='arrowright'?d:0),y:p.y+(key==='arrowup'?-d:key==='arrowdown'?d:0)},n);onBegin();G.move(n,q.x-n.x,q.y-n.y);onCommit('已微调拟合节点，展开后保留');}catch(_err){feedback('这个位置无法展开，节点保持原位。');}return true;
   }
   if(!mod&&['j','enter'].includes(key)){e.preventDefault();return true;}return false;
  }
  function stopMotion(){if(animationFrame!==null)root.cancelAnimationFrame(animationFrame);animationFrame=null;motion=null;}
  function applyOffset(value){if(!state?.map)return;const bounds=offsetBounds();state.offset=state.routeLoop?((value%bounds.max)+bounds.max)%bounds.max:Math.max(bounds.min,Math.min(bounds.max,value));state.map.setOffset(state.offset);state.feedback='';render();}
  function setOffset(value){stopMotion();applyOffset(value);}
  function animateOffset(to,point){
   stopMotion();const from=state.offset;if(Math.abs(to-from)<1e-6){render();return;}
   const run={from,to,point,start:performance.now(),duration:Math.max(450,Math.min(1000,Math.abs(to-from)*getCamera().z*5)),last:from};motion=run;render();
   const tick=now=>{if(!state?.map||motion!==run)return;const t=Math.min(1,(now-run.start)/run.duration);applyOffset(from+(to-from)*t);
    if(state.failed){stopMotion();applyOffset(run.last);feedback('移动到这里无法可靠预览，已停在上一个有效位置。');return;}
    run.last=state.offset;if(t<1)animationFrame=root.requestAnimationFrame(tick);else{stopMotion();render();}
   };animationFrame=root.requestAnimationFrame(tick);
  }
  function unbend(){stop();onRender();status('已展开：未修改部分恢复原形，剪口及曲线修改已保留');}
  $('fitting-start').onclick=()=>$('fit-curves').click();
  const selectEndpoint=(kind,end)=>{if(!state||state.adjusting||state.topologyChanged||state.syncInvalid)return;cancel();state.endpointPicking=end!=='none';state.pickKind=kind;state[kind+'Pick']=end;if(kind==='target')state.sourcePick='none';state.feedback='';render();};
  for(const key of ['start','end','none'])$('fitting-source-'+key).onclick=()=>selectEndpoint('source',key);
  for(const kind of ['source','target'])for(const end of ['start','end']){
   $('fitting-guide-'+kind+'-'+end).onclick=()=>selectEndpoint(kind,end);
   if(kind==='target')$('fitting-target-'+end).onclick=()=>selectEndpoint(kind,end);
  }
  for(const id of ['fitting-original','fitting-guide-original'])$(id).onclick=()=>{if(!state?.map)return;cancel();state.showFitted=!state.showFitted;if(!state.showFitted)state.editing=false;state.feedback='';render();};
  $('fitting-guide-target-other-side').onclick=$('fitting-target-other-side').onclick=switchTargetSide;
  $('fitting-guide-source-other-side').onclick=$('fitting-source-other-side').onclick=()=>{if(!state?.source?.closed)return;setSourceRange({points:copy(state.sourcePoints).reverse(),reversed:!state.sourceReverse});};
  for(const key of ['source','target'])$('fitting-'+key+'-color').oninput=e=>{appearance[key]=e.target.value;if(colorKind===key){readColor(appearance[key]);syncColorPicker();}saveAppearance();};
  $('fitting-show-labels').onchange=e=>{appearance.labels=e.target.checked;saveAppearance();};
  $('fitting-guide-minimize').onclick=()=>setGuideMode('minimized');
  for(const id of ['fitting-guide-expand','fitting-guide-show'])$(id).onclick=()=>setGuideMode('expanded');
  $('fitting-pick').onclick=()=>{stop();onRender();onPickRange?.();};
   $('fitting-whole').onchange=e=>{if(!state)return;if(state.topologyChanged){e.target.checked=!state.partial;feedback('已增删节点，请先展开，再重新选择范围。');return;}cancel();state.partial=!e.target.checked;state.selected=state.source?.id;state.node=null;state.cache=null;if(state.source)choosePiece(state.source);render();};
  $('fitting-continue').onclick=continueFitting;
  $('fitting-back').onclick=()=>history(true,true);
  $('fitting-offset').oninput=e=>setOffset(Number(e.target.value));
  for(const id of ['fitting-unbend','fitting-guide-unbend','fitting-exit'])$(id).onclick=unbend;
  $('fitting-restart').onclick=()=>{stop();start();onRender();};
  $('fitting-edit').onclick=()=>{if(!state?.map)return;cancel();state.editing=!state.editing;if(state.editing)state.showFitted=true;state.adjusting=false;state.node=null;state.feedback='';taps?.reset();render();};
  $('fitting-adjust').onclick=()=>{if(!state?.map||state.topologyChanged)return;cancel();state.adjusting=!state.adjusting;state.editing=false;state.feedback='';render();};
  for(const key of ['source','target'])$('fitting-reverse-'+key).onclick=()=>{if(state?.map)changeDirection(key,!state[key+'Reverse']);};
  return {get active(){return !!state;},get ready(){return !!state?.map;},get capturesCanvas(){return capturesCanvas();},get preserveOnHistory(){return originalEditing()&&state.lastMutation==='original';},handlesEvent,targetNode,chooseTargetNode,pickNode,chooseNode,originalMode,syncOriginals,get dragging(){return !!gesture;},get canUndo(){return canHistory(true);},get canRedo(){return canHistory(false);},history,start,stop,render,pointerDown,pointerMove,pointerUp,cancel,doubleClick,keydown};
 }
 root.CurveFitting={create,cut,moveMark,extend,selection,remainder,route,targetRangeFromNode,sourceRangeFromNode};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.CurveFitting;
})(typeof window==='undefined'?globalThis:window);
