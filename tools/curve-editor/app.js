(() => {
 'use strict';
 const G=window.CurveGeometry,$=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
 const clone=o=>JSON.parse(JSON.stringify(o)), uid=()=>crypto.randomUUID();
 const svg=$('canvas'),view=$('viewport');
 let doc,selected=null,ni=null,tool='node',drawing=false,drag=null,space=false;
 let camera={x:0,y:0,z:1},undo=[],redo=[],dirty=false,lastSaved='',saveBusy=false;
 const taps=window.CurveInteractions.createTapTracker(),menu=$('context-menu');
 let tapStart=null;
 let axisStart=null,hoverPoint=null,measurement=null,measureMode='points';
 const tools=[...document.querySelectorAll('[data-tool]')], modes=[...document.querySelectorAll('[data-mode]')];
 const selectedPath=()=>doc.paths.find(p=>p.id===selected), selectedNode=()=>selectedPath()?.nodes[ni];
 const snapshot=()=>({doc:{...doc,paths:clone(doc.paths),originals:clone(doc.originals),mirrorAxis:clone(doc.mirrorAxis)},selected,ni});
 function checkpoint(){undo.push(snapshot());if(undo.length>70)undo.shift();redo=[];}
 function changed(message){dirty=true;render();if(message)status(message);}
 function status(s){$('status').textContent=s;}
 function el(tag,attrs,parent){const e=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));parent.appendChild(e);return e;}
 function empty(){return {format:'daban-curve-editor',version:1,title:'未命名修改',width:1000,height:700,units:'image-px',newNodeMode:doc?.newNodeMode||'cusp',image:null,opacity:.65,paths:[],originals:[],mirrorAxis:null,note:'坐标为原始图像像素，未标定毫米；仅作修改沟通。'};}
 function makePath(){return {id:uid(),name:`曲线 ${doc.paths.length+1}`,role:'outline',color:'#e04544',closed:false,note:'',nodes:[]};}
 function demo(){doc=empty();doc.title='练习曲线';let p=makePath();p.name='练习曲线';p.nodes=[G.node(200,460),G.node(480,230),G.node(780,430)];p.nodes[0].out={x:300,y:450};p.nodes[1].in={x:345,y:230};p.nodes[1].out={x:615,y:230};p.nodes[1].mode='symmetric';p.nodes[2].in={x:650,y:430};doc.paths=[p];doc.originals=clone(doc.paths);selected=p.id;ni=1;render();fit();}
 function point(e){const r=svg.getBoundingClientRect();return {x:(e.clientX-r.left-camera.x)/camera.z,y:(e.clientY-r.top-camera.y)/camera.z};}
 function screenPoint(e){const r=svg.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
 function fit(){const r=svg.getBoundingClientRect();camera.z=Math.min((r.width-70)/doc.width,(r.height-80)/doc.height);camera.z=Math.max(.02,camera.z);camera.x=(r.width-doc.width*camera.z)/2;camera.y=(r.height-doc.height*camera.z)/2;renderCanvas();}
 function zoom(factor,p){const r=svg.getBoundingClientRect();p=p||{x:r.width/2,y:r.height/2};const z=Math.min(16,Math.max(.01,camera.z*factor));camera.x=p.x-(p.x-camera.x)*z/camera.z;camera.y=p.y-(p.y-camera.y)*z/camera.z;camera.z=z;renderCanvas();}
 function renderCanvas(){
  view.setAttribute('transform',`translate(${camera.x} ${camera.y}) scale(${camera.z})`);
  for(const id of ['paper','grid-paper','reference']){const e=$(id);e.setAttribute('width',doc.width);e.setAttribute('height',doc.height);}
  $('grid-paper').style.display=$('show-grid').checked?'':'none';
  const ref=$('reference');if(doc.image){if(ref.getAttribute('href')!==doc.image.dataUrl)ref.setAttribute('href',doc.image.dataUrl);ref.style.display='';}else{ref.removeAttribute('href');ref.style.display='none';}ref.setAttribute('opacity',doc.opacity);
  const pg=$('paths'),hg=$('handles'),gg=$('ghosts');pg.replaceChildren();hg.replaceChildren();gg.replaceChildren();
  if($('show-original').checked)doc.originals.forEach(p=>el('path',{d:G.pathD(p),fill:'none',stroke:'#8898a9','stroke-width':1.5/camera.z,'stroke-dasharray':`${5/camera.z} ${4/camera.z}`,'pointer-events':'none'},gg));
  for(const p of doc.paths){
   el('path',{d:G.pathD(p),stroke:p.color,'stroke-width':(p.id===selected?2.6:2)/camera.z,class:'svg-curve','pointer-events':'none'},pg);
   el('path',{d:G.pathD(p),'stroke-width':18/camera.z,class:'hit-line','data-path':p.id},pg);
  }
  const p=selectedPath();
  if(p&&(tool==='node'||tool==='pen'))p.nodes.forEach((n,i)=>{
   if(i===ni){for(const side of ['in','out']){
    if(G.dist(n,n[side])<.5/camera.z)continue;
    el('line',{x1:n.x,y1:n.y,x2:n[side].x,y2:n[side].y,stroke:'#3d89dc','stroke-width':1/camera.z,class:'handle-line'},hg);
    el('circle',{cx:n[side].x,cy:n[side].y,r:9/camera.z,fill:'transparent','data-side':side,'data-node':i,class:'control'},hg);
    el('circle',{cx:n[side].x,cy:n[side].y,r:4.5/camera.z,fill:'#fff',stroke:'#176bce','stroke-width':1.5/camera.z,'pointer-events':'none'},hg);
   }}
   el('rect',{x:n.x-7/camera.z,y:n.y-7/camera.z,width:14/camera.z,height:14/camera.z,fill:'transparent','data-node':i,class:'anchor'},hg);
   el('rect',{x:n.x-4/camera.z,y:n.y-4/camera.z,width:8/camera.z,height:8/camera.z,fill:i===ni?'#176bce':'white',stroke:'#176bce','stroke-width':1.5/camera.z,'pointer-events':'none'},hg);
   if(i===ni)el('text',{x:n.x+10/camera.z,y:n.y-10/camera.z,fill:'#176bce','font-size':12/camera.z,'pointer-events':'none'},hg).textContent=`${i+1}`;
  });
  $('zoom').textContent=`${Math.round(camera.z*100)}%`;
  $('canvas-label').textContent=doc.image?`${doc.image.name} · 底图已锁定`:'练习 / 空白画板';
  svg.style.cursor=space||tool==='pan'?'grab':['pen','axis','measure'].includes(tool)?'crosshair':'default';
  renderGuides();renderMeasurement();
 }
 function render(){
  renderCanvas();tools.forEach(b=>b.setAttribute('aria-pressed',b.dataset.tool===tool));
  $('undo').disabled=!undo.length;$('redo').disabled=!redo.length;
  const p=selectedPath(),n=selectedNode();
  const list=$('curve-list');list.replaceChildren();
  if(!doc.paths.length){const e=document.createElement('span');e.textContent='还没有曲线';e.style.color='#7c8998';list.appendChild(e);}
  doc.paths.forEach(path=>{const b=document.createElement('button');b.className='curve-item';b.setAttribute('aria-pressed',path.id===selected);const sw=document.createElement('i');sw.style.background=path.color;const label=document.createElement('span');label.textContent=path.name;const count=document.createElement('small');count.textContent=`${path.nodes.length} 点`;b.append(sw,label,count);b.onclick=()=>{drawing=false;selected=path.id;ni=null;setTool('node');};list.appendChild(b);});
  for(const id of ['path-name','path-role','path-color','path-note','delete-path'])$(id).disabled=!p;
  if(document.activeElement!==$('path-name'))$('path-name').value=p?.name||'';
  $('path-role').value=p?.role||'outline';$('path-color').value=p?.color||'#e04544';
  if(document.activeElement!==$('path-note'))$('path-note').value=p?.note||'';
  modes.forEach(b=>{b.disabled=false;b.setAttribute('aria-pressed',(n?.mode||doc.newNodeMode)===b.dataset.mode);});
  const modeNames={cusp:'尖角',smooth:'平滑',symmetric:'对称'};
  $('node-mode-hint').textContent=`新节点沿用：${modeNames[doc.newNodeMode]}${n?' · 上方为当前节点类型':''}`;
  for(const axis of ['x','y']){const e=$('node-'+axis);e.disabled=!n;if(document.activeElement!==e)e.value=n?Number(n[axis].toFixed(2)):'';}
  $('node-id').textContent=n?`第 ${ni+1} 点`:'未选择';$('delete-node').disabled=!n;$('straight').disabled=!n;
  $('close-path').disabled=!p||p.nodes.length<3;$('close-path').textContent=p?.closed?'打开曲线':'闭合曲线';$('finish').disabled=!drawing;
  $('opacity').value=doc.opacity*100;$('opacity-value').textContent=`${Math.round(doc.opacity*100)}%`;
  $('axis-info').textContent=axisStart?'已定第一点，请点击第二点':doc.mirrorAxis?'已设置对称轴 · 可重新画轴':'点击画板两点定义任意方向的对称轴';
  $('mirror-copy').disabled=!p||!p.nodes.length||!doc.mirrorAxis;$('clear-axis').disabled=!doc.mirrorAxis&&!axisStart;
  const hints={node:'双击曲线加点；右键可镜像或测量曲线',select:'拖动整条曲线；右键可镜像或测量曲线',pen:'点击加点，拖出弧线；右键也可加点或结束',pan:'按住拖动画板；滚轮缩放；右键打开操作菜单',axis:axisStart?'点击第二点完成对称轴；Shift 约束角度；Esc 取消':'点击两点画对称轴；靠近节点自动吸附',measure:measureMode==='points'?'连续点击测量直线距离；靠近节点自动吸附；Enter 结束，Backspace 回退':'点选首段，再 Shift 点末段，测量连续线段；闭合曲线可切换另一侧'};
  $('canvas-hint').textContent=hints[tool];
 }
 function setTool(t){hideMenu();taps.reset();drawing=false;axisStart=null;hoverPoint=null;if(measurement?.kind==='points')measurement.finished=true;tool=t;render();}
 function finish(){drawing=false;tool='node';render();}
 const lengthText=n=>`${n.toFixed(2)} px`;
 function resetAuxiliary(){axisStart=null;hoverPoint=null;measurement=null;}
 function snapToNode(pos){
  let closest=null,distance=9/camera.z;
  for(const path of doc.paths)for(const n of path.nodes){const d=G.dist(pos,n);if(d<distance){closest=n;distance=d;}}
  return G.point(closest||pos);
 }
 function renderGuides(){
  const group=$('guides');group.replaceChildren();const axis=axisStart?{a:axisStart,b:hoverPoint||axisStart}:doc.mirrorAxis;
  if(!axis)return;
  const {a,b}=axis,d=G.dist(a,b),span=Math.max(doc.width,doc.height,svg.clientWidth/camera.z,svg.clientHeight/camera.z)*3;
  if(d>1e-6){const dx=(b.x-a.x)/d*span,dy=(b.y-a.y)/d*span;el('line',{x1:a.x-dx,y1:a.y-dy,x2:b.x+dx,y2:b.y+dy,stroke:'#9858b1','stroke-width':1.5/camera.z,'stroke-dasharray':`${7/camera.z} ${5/camera.z}`},group);}
  for(const p of [a,b])el('circle',{cx:p.x,cy:p.y,r:4/camera.z,fill:'white',stroke:'#9858b1','stroke-width':1.5/camera.z},group);
  el('text',{x:a.x+9/camera.z,y:a.y-9/camera.z,fill:'#87459f','font-size':12/camera.z},group).textContent='对称轴';
 }
 function mirrorCopy(){
  const path=selectedPath();if(!path||!doc.mirrorAxis)return;
  if(doc.paths.length>=500){status('最多支持 500 条曲线，请先整理曲线');return;}
  const copy=G.reflectPath(path,doc.mirrorAxis.a,doc.mirrorAxis.b);
  if(copy.nodes.some(n=>[n,n.in,n.out].some(p=>Math.abs(p.x)>1e7||Math.abs(p.y)>1e7))){status('镜像后坐标超出范围，请调整对称轴');return;}
  checkpoint();copy.id=uid();copy.name=`${path.name.slice(0,75)} · 镜像`;doc.paths.push(copy);selected=copy.id;ni=null;setTool('node');changed('已生成独立的镜像副本，原曲线保留；可撤销');
 }
 function measurementData(){
  if(!measurement)return null;
  if(measurement.kind==='points'){
   const pts=measurement.points;return {total:G.polylineLength(pts),items:pts.slice(1).map((p,i)=>({label:`点 ${i+1} → ${i+2}`,length:G.dist(pts[i],p),position:G.mix(pts[i],p,.5)})),summary:`${pts.length} 个测点 · ${measurement.finished?'已结束':'连续点距'}`,points:pts};
  }
  const path=doc.paths.find(p=>p.id===measurement.pathId);if(!path)return null;
  const indices=measurement.kind==='curve'?Array.from({length:G.segmentCount(path)},(_,i)=>i):G.segmentRange(path,measurement.start,measurement.end,measurement.alternate);
  const items=indices.map(i=>({index:i,label:`第 ${i+1} 段`,length:G.segmentLength(path,i),position:G.at(path.nodes[i],path.nodes[(i+1)%path.nodes.length],.5)}));
  return {path,items,total:items.reduce((sum,item)=>sum+item.length,0),summary:`${path.name} · ${measurement.kind==='curve'?'整条曲线':`连续 ${indices.length} 段`} · 弧长`};
 }
 function renderMeasurement(){
  const group=$('measure-overlay');group.replaceChildren();const data=measurementData();
  const label=(p,text)=>{el('text',{x:p.x+7/camera.z,y:p.y-9/camera.z,'font-size':12/camera.z,'stroke-width':4/camera.z,class:'measurement-label'},group).textContent=text;};
  if(data?.points){
   el('polyline',{points:data.points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#13816c','stroke-width':1.7/camera.z},group);
   data.points.forEach((p,i)=>{el('circle',{cx:p.x,cy:p.y,r:4/camera.z,fill:'white',stroke:'#13816c','stroke-width':1.5/camera.z},group);label(p,String(i+1));});
   if(tool==='measure'&&!measurement.finished&&hoverPoint&&data.points.length){const last=data.points.at(-1);el('line',{x1:last.x,y1:last.y,x2:hoverPoint.x,y2:hoverPoint.y,stroke:'#13816c','stroke-width':1/camera.z,'stroke-dasharray':`${4/camera.z} ${4/camera.z}`},group);}
  }
  if(data?.path)for(const item of data.items)el('path',{d:G.segmentD(data.path,item.index),fill:'none',stroke:'#13816c',opacity:.7,'stroke-width':5/camera.z},group);
  if(data)for(const item of data.items)label(item.position,lengthText(item.length));
  $('measure-summary').textContent=data?.summary||'连续点击测点，或右键曲线测量弧长';
  $('measure-total').textContent=`${data?.path?'≈ ':''}${lengthText(data?.total||0)}`;
  const list=$('measure-details');list.replaceChildren();for(const item of data?.items||[]){const li=document.createElement('li');li.textContent=`${item.label}：${lengthText(item.length)}`;list.appendChild(li);}
  $('measure-finish').disabled=measurement?.kind!=='points'||measurement.finished;$('measure-clear').disabled=!measurement;
  $('measure-alternate').hidden=!(measurement?.kind==='segments'&&data?.path.closed&&measurement.start!==measurement.end);
  document.querySelectorAll('[data-measure]').forEach(b=>b.setAttribute('aria-pressed',tool==='measure'&&measureMode===b.dataset.measure));
 }
 function selectSegment(path,index,extend=false){
  const previous=measurement;selected=path.id;ni=null;setTool('measure');measureMode='segments';
  measurement=extend&&previous?.kind==='segments'&&previous.pathId===path.id?{...previous,end:index}:{kind:'segments',pathId:path.id,start:index,end:index,alternate:false};render();
 }
 function measureCurve(path){
  if(!path)return;selected=path.id;ni=null;setTool('measure');measureMode='segments';measurement={kind:'curve',pathId:path.id};render();status(`曲线弧长约 ${lengthText(measurementData().total)}`);
 }
 function snap(origin,p){const a=Math.round(Math.atan2(p.y-origin.y,p.x-origin.x)/(Math.PI/4))*Math.PI/4,d=G.dist(origin,p);return {x:origin.x+Math.cos(a)*d,y:origin.y+Math.sin(a)*d};}
 function closestCurve(pos){
  let result=null;
  for(const path of doc.paths){const hit=G.nearest(path,pos);if(hit.distance<=12/camera.z&&(!result||hit.distance<result.hit.distance))result={path,hit};}
  return result;
 }
 function insertAt(pos){
  const result=closestCurve(pos);if(!result)return false;
  const {path,hit}=result,projected=G.at(path.nodes[hit.index],path.nodes[(hit.index+1)%path.nodes.length],hit.t);
  const existing=path.nodes.findIndex(n=>G.dist(n,projected)<=8/camera.z);
  if(existing!==-1){selected=path.id;ni=existing;drawing=false;tool='node';render();status('这里已有节点，可直接拖动调整');return false;}
  checkpoint();measurement=null;selected=path.id;ni=G.split(path,hit.index,hit.t);drawing=false;tool='node';
  changed('已增加节点，原曲线形状保持不变');return true;
 }
 function hideMenu(){menu.hidden=true;}
 function appendAt(pos,newCurve=false){
  checkpoint();measurement=null;let path=selectedPath();
  if(newCurve||!path||path.closed){path=makePath();doc.paths.push(path);selected=path.id;}
  ni=G.append(path,pos,doc.newNodeMode);drawing=true;tool='pen';
  changed('已在此加点，继续点击或拖动可接着画线');
 }
 svg.addEventListener('contextmenu',e=>{
  e.preventDefault();endDrag();tapStart=null;taps.reset();
  const pos=point(e),result=closestCurve(pos);let index=-1;
  if(result){selected=result.path.id;index=result.path.nodes.findIndex(n=>G.dist(n,pos)<=10/camera.z);ni=index<0?null:index;render();}
  // One-node paths have no segment to hit, but still expose their node actions.
  if(!result){for(const path of doc.paths){const i=path.nodes.findIndex(n=>G.dist(n,pos)<=10/camera.z);if(i!==-1){selected=path.id;ni=i;index=i;render();break;}}}
  menu.replaceChildren();
  const title=document.createElement('div');title.className='menu-title';title.textContent=index>=0?'节点操作':result?'曲线操作':'画布操作';menu.append(title);
  const action=(label,fn,disabled=false)=>{const b=document.createElement('button');b.type='button';b.role='menuitem';b.textContent=label;b.disabled=disabled;b.onclick=()=>{hideMenu();fn();};menu.append(b);};
  if(index>=0){
   action('删除这个节点',removeNode);
   for(const [mode,label] of [['cusp','转为尖角节点'],['smooth','转为平滑节点'],['symmetric','转为对称节点']])action(label,()=>modes.find(b=>b.dataset.mode===mode).click());
  }else if(result){action('在曲线此处加点',()=>insertAt(pos));}
  else {
   const canContinue=selectedPath()&&!selectedPath().closed;
   action(canContinue?'在此加点 · 续接当前曲线':'在此加点 · 新建曲线',()=>appendAt(pos));
   if(canContinue)action('从这里新画一条曲线',()=>appendAt(pos,true));
  }
  const path=selectedPath();
  if(path){
   action('测量整条曲线',()=>measureCurve(path),!G.segmentCount(path));
   action('按对称轴生成镜像副本',mirrorCopy,!doc.mirrorAxis||!path.nodes.length);
  }
  if(result){
   action('从这段开始测量',()=>selectSegment(result.path,result.hit.index));
   if(measurement?.kind==='segments'&&measurement.pathId===result.path.id){
    action('测到这一段（连续选段）',()=>selectSegment(result.path,result.hit.index,true));
    action('测量已选线段',()=>{setTool('measure');measureMode='segments';render();status(`已选线段弧长约 ${lengthText(measurementData().total)}`);});
   }
  }
  if(path&&path.nodes.length>=3)action(path.closed?'打开当前曲线':'闭合当前曲线',()=>$('close-path').click());
  if(drawing)action('结束当前画线',finish);
  action('撤销',()=>history(true),!undo.length);
  menu.hidden=false;menu.style.left='0px';menu.style.top='0px';
  const bounds=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(e.clientX,innerWidth-bounds.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(e.clientY,innerHeight-bounds.height-8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
 });
 document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))hideMenu();});
 window.addEventListener('resize',hideMenu);window.addEventListener('scroll',hideMenu,true);
 menu.addEventListener('keydown',e=>{
  if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();
  const items=[...menu.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();
 });
 svg.addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.button!==1)return;e.preventDefault();const p=point(e),target=e.target;
  const editable=tool==='node'||tool==='select';
  tapStart=e.button===0&&editable&&!space&&!target.hasAttribute('data-side')?{...screenPoint(e),time:e.timeStamp}:null;
  svg.setPointerCapture(e.pointerId);
  if(space||tool==='pan'||e.button===1){drag={kind:'pan',screen:screenPoint(e),camera:{...camera}};return;}
  if(tool==='axis'){
   const pos=e.shiftKey&&axisStart?snap(axisStart,p):snapToNode(p);
   if(!axisStart){axisStart=pos;hoverPoint=pos;render();return;}
   if(G.dist(axisStart,pos)<1e-6){status('请点击另一个位置，两点不能重合');return;}
   checkpoint();doc.mirrorAxis={a:G.point(axisStart),b:pos};axisStart=null;setTool('node');changed('对称轴已设置；选中曲线后生成镜像副本');return;
  }
  if(tool==='measure'){
   if(measureMode==='segments'){const hit=closestCurve(p);if(hit)selectSegment(hit.path,hit.hit.index,e.shiftKey);else status('请点击要测量的曲线线段');return;}
   if(measurement?.kind!=='points'||measurement.finished)measurement={kind:'points',points:[],finished:false};
   const pos=snapToNode(p);if(!measurement.points.length||G.dist(measurement.points.at(-1),pos)>1e-6)measurement.points.push(pos);
   hoverPoint=pos;render();return;
  }
  const idx=target.getAttribute('data-node'),side=target.getAttribute('data-side'),pathId=target.getAttribute('data-path');
  const current=selectedPath();
  if(tool==='pen'&&drawing&&current&&!side&&idx==='0'&&current.nodes.length>=3){checkpoint();current.closed=true;changed('曲线已闭合');finish();return;}
  if(idx!==null&&(tool==='node'||tool==='pen')){
   ni=Number(idx);checkpoint();drag={kind:side?'handle':'node',side,start:p,node:clone(selectedNode())};render();return;
  }
  if(tool==='pen'){
   let path=selectedPath();
   checkpoint();measurement=null;
   if(!drawing||!path||path.closed){path=makePath();doc.paths.push(path);selected=path.id;drawing=true;}
   const last=path.nodes.at(-1),pos=e.shiftKey&&last?snap(last,p):p;
   ni=G.append(path,pos,doc.newNodeMode);drag={kind:'new',start:pos};changed();return;
  }
  if(pathId){selected=pathId;ni=null;
   if(tool==='select'){checkpoint();drag={kind:'path',start:p,nodes:clone(selectedPath().nodes)};}
   render();return;
  }
  ni=null;render();
 });
 svg.addEventListener('pointermove',e=>{
  const p=point(e);$('coordinates').textContent=`X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)} px · 未标定毫米`;
  if(!drag&&(tool==='axis'||(tool==='measure'&&measureMode==='points'))){hoverPoint=e.shiftKey&&axisStart?snap(axisStart,p):snapToNode(p);renderCanvas();}
  if(!drag)return;
  if(tapStart&&G.dist(tapStart,screenPoint(e))>4){tapStart=null;taps.reset();}
  if(drag.kind==='pan'){const s=screenPoint(e);camera.x=drag.camera.x+s.x-drag.screen.x;camera.y=drag.camera.y+s.y-drag.screen.y;renderCanvas();return;}
  const n=selectedNode(),path=selectedPath();if(!path)return;
  if(drag.kind==='new'&&G.dist(drag.start,p)>2/camera.z){const h=e.shiftKey?snap(n,p):p;n.out=G.point(h);n.in={x:2*n.x-h.x,y:2*n.y-h.y};}
  if(drag.kind==='node'){const pos=e.shiftKey?snap(drag.start,p):p;path.nodes[ni]=clone(drag.node);G.move(path.nodes[ni],pos.x-drag.start.x,pos.y-drag.start.y);}
  if(drag.kind==='handle'){path.nodes[ni]=clone(drag.node);G.handle(path.nodes[ni],drag.side,e.shiftKey?snap(n,p):p,e.altKey);}
  if(drag.kind==='path'){path.nodes=clone(drag.nodes);path.nodes.forEach(n=>G.move(n,p.x-drag.start.x,p.y-drag.start.y));}
  dirty=true;renderCanvas();
  const node=selectedNode();if(node){$('node-x').value=Number(node.x.toFixed(2));$('node-y').value=Number(node.y.toFixed(2));}
 });
 function endDrag(){if(!drag)return;drag=null;render();}
 svg.addEventListener('pointerup',e=>{
  const started=tapStart;tapStart=null;endDrag();
  if(!started||G.dist(started,screenPoint(e))>4){taps.reset();return;}
  const hit=closestCurve(point(e));if(!hit){taps.reset();return;}
  if(taps.push({...screenPoint(e),time:e.timeStamp,key:hit.path.id}))insertAt(point(e));
 });
 svg.addEventListener('pointercancel',()=>{tapStart=null;taps.reset();endDrag();});svg.addEventListener('lostpointercapture',endDrag);
 svg.addEventListener('dblclick',e=>{
  if((tool!=='node'&&tool!=='select')||space)return;e.preventDefault();insertAt(point(e));taps.reset();
 });
 svg.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.0015),screenPoint(e));},{passive:false});
 tools.forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
 $('draw-axis').onclick=()=>setTool('axis');$('mirror-copy').onclick=mirrorCopy;
 $('clear-axis').onclick=()=>{if(doc.mirrorAxis){checkpoint();doc.mirrorAxis=null;dirty=true;}axisStart=null;hoverPoint=null;render();};
 document.querySelectorAll('[data-measure]').forEach(b=>b.onclick=()=>{setTool('measure');measureMode=b.dataset.measure;measurement=null;render();});
 $('measure-clear').onclick=()=>{measurement=null;hoverPoint=null;render();};
 $('measure-finish').onclick=()=>{if(measurement?.kind==='points')measurement.finished=true;hoverPoint=null;render();};
 $('measure-alternate').onclick=()=>{if(measurement?.kind==='segments'){measurement.alternate=!measurement.alternate;render();}};
 $('add-path').onclick=()=>{setTool('pen');selected=null;ni=null;render();status('在画板上点击开始新曲线，按住拖动可画弧线');};
 $('finish').onclick=finish;
 $('close-path').onclick=()=>{const p=selectedPath();if(!p||p.nodes.length<3)return;checkpoint();measurement=null;p.closed=!p.closed;drawing=false;changed();};
 function removeNode(){const p=selectedPath();if(!p||ni===null)return;checkpoint();measurement=null;p.nodes.splice(ni,1);if(p.nodes.length<3)p.closed=false;if(!p.nodes.length){doc.paths=doc.paths.filter(q=>q.id!==p.id);selected=null;}ni=null;changed();}
 $('delete-node').onclick=removeNode;
 $('delete-path').onclick=()=>{if(!selectedPath())return;checkpoint();measurement=null;doc.paths=doc.paths.filter(p=>p.id!==selected);selected=null;ni=null;drawing=false;changed('曲线已删除，可撤销');};
 $('straight').onclick=()=>{const n=selectedNode();if(!n)return;checkpoint();n.in=G.point(n);n.out=G.point(n);n.mode='cusp';changed();};
 modes.forEach(b=>b.onclick=()=>{
  const n=selectedNode(),p=selectedPath();checkpoint();doc.newNodeMode=b.dataset.mode;
  if(n)G.setMode(p,ni,b.dataset.mode);
  changed(`已记住${b.textContent}类型，接下来新建的节点会沿用`);
 });
 for(const axis of ['x','y'])$('node-'+axis).onchange=()=>{const n=selectedNode(),v=Number($('node-'+axis).value);if(!n||!Number.isFinite(v))return;checkpoint();G.move(n,axis==='x'?v-n.x:0,axis==='y'?v-n.y:0);changed();};
 for(const [id,key] of [['path-name','name'],['path-role','role'],['path-color','color'],['path-note','note']])$(id)[key==='role'?'onchange':'oninput']=()=>{const p=selectedPath();if(!p)return;checkpoint();p[key]=$(id).value||(key==='name'?'未命名曲线':'');changed();};
 $('opacity').oninput=()=>{doc.opacity=Number($('opacity').value)/100;$('opacity-value').textContent=`${$('opacity').value}%`;dirty=true;renderCanvas();};
 $('show-grid').onchange=renderCanvas;$('show-original').onchange=renderCanvas;
 $('zoom-in').onclick=()=>zoom(1.25);$('zoom-out').onclick=()=>zoom(.8);$('fit').onclick=fit;
 function history(back){const from=back?undo:redo,to=back?redo:undo;if(!from.length)return;to.push(snapshot());const s=from.pop();doc=s.doc;selected=s.selected;ni=s.ni;drawing=false;drag=null;resetAuxiliary();changed(back?'已撤销':'已重做');}
 $('undo').onclick=()=>history(true);$('redo').onclick=()=>history(false);
 window.addEventListener('keydown',e=>{
  if(!menu.hidden){if(e.key==='Escape'){e.preventDefault();hideMenu();}return;}
  const mod=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
  if(mod&&key==='s'){e.preventDefault();save();return;}
  if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  if(mod&&key==='z'){e.preventDefault();history(!e.shiftKey);return;}
  if(mod&&key==='y'){e.preventDefault();history(false);return;}
  if(e.code==='Space'){e.preventDefault();space=true;renderCanvas();return;}
  if(key==='escape'||key==='enter'){
   e.preventDefault();if(tool==='axis'){axisStart=null;setTool('node');return;}
   if(tool==='measure'){if(measurement?.kind==='points')measurement.finished=true;hoverPoint=null;render();return;}
   finish();return;
  }
  if(tool==='measure'&&(key==='delete'||key==='backspace')){e.preventDefault();if(measurement?.kind==='points'){measurement.points.pop();measurement.finished=false;}else measurement=null;render();return;}
  if(tool==='axis'&&(key==='delete'||key==='backspace')){e.preventDefault();$('clear-axis').click();return;}
  if(key==='delete'||key==='backspace'){e.preventDefault();if(tool==='select')$('delete-path').click();else removeNode();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&selectedNode()&&tool!=='measure'&&tool!=='axis'){
   e.preventDefault();checkpoint();const d=e.shiftKey?10:1;G.move(selectedNode(),e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0,e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0);changed();return;
  }
  const shortcuts={v:'select',f10:'node',b:'pen',h:'pan',a:'axis',m:'measure'};if(shortcuts[key]&&!mod){e.preventDefault();setTool(shortcuts[key]);}
 });
 window.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;renderCanvas();}});
 window.addEventListener('blur',()=>{space=false;endDrag();});
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 $('new').onclick=()=>{if(dirty&&!confirm('当前修改还未保存，仍要新建空白画板吗？'))return;checkpoint();doc=empty();resetAuxiliary();selected=null;ni=null;drawing=false;tool='pen';dirty=false;render();fit();status('空白画板已就绪；也可以先导入底图');};
 $('import').onclick=()=>$('image-file').click();$('open').onclick=()=>$('project-file').click();
 const readData=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('图片读取失败'));r.readAsDataURL(f);});
 async function importImage(f){
  if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type))throw new Error('请使用 PNG、JPG 或 WebP 图片');
  if(f.size>18*1024*1024)throw new Error('图片超过18MB，请缩小后导入');
  if(dirty&&!confirm('导入新底图将新建画板。当前修改还未保存，继续吗？'))return;
  const dataUrl=await readData(f),image=new Image();image.src=dataUrl;await image.decode();
  if(!image.naturalWidth||image.naturalWidth>30000||image.naturalHeight>30000)throw new Error('图片尺寸过大或无效');
  checkpoint();doc=empty();resetAuxiliary();doc.width=image.naturalWidth;doc.height=image.naturalHeight;doc.title=f.name.replace(/\.[^.]+$/,'')+'-改线';doc.image={name:f.name,dataUrl,width:doc.width,height:doc.height};selected=null;ni=null;drawing=false;tool='pen';dirty=true;render();fit();status('底图已导入并锁定。用贝塞尔工具描出你想要的曲线');
 }
 $('image-file').onchange=async e=>{try{await importImage(e.target.files[0]);}catch(err){status(err.message);}e.target.value='';};
 svg.addEventListener('dragover',e=>{e.preventDefault();});svg.addEventListener('drop',async e=>{e.preventDefault();try{await importImage(e.dataTransfer.files[0]);}catch(err){status(err.message);}});
 document.addEventListener('paste',async e=>{if(/INPUT|TEXTAREA/.test(e.target.tagName))return;const file=[...e.clipboardData.items].find(i=>i.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();try{await importImage(file);}catch(err){status(err.message);}}});
 function validate(raw){
  if(raw?.format!=='daban-curve-editor'||raw.version!==1||raw.units!=='image-px')throw new Error('这不是通用矢量图编辑器保存的修改文件');
  for(const k of ['width','height'])if(!Number.isFinite(raw[k])||raw[k]<1||raw[k]>30000)throw new Error('画板尺寸无效');
  if(!Array.isArray(raw.paths)||raw.paths.length>500)throw new Error('曲线数量无效');
  if(raw.image&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(raw.image.dataUrl)||typeof raw.image.name!=='string'))throw new Error('底图格式无效');
  const ids=new Set();
  const cleanPaths=(paths,unique)=>paths.map(p=>{
   if(typeof p.id!=='string'||(unique&&ids.has(p.id))||!Array.isArray(p.nodes)||p.nodes.length>10000)throw new Error('节点数据无效');ids.add(p.id);
   const nodes=p.nodes.map(n=>{for(const v of [n,n.in,n.out])if(!v||!Number.isFinite(v.x)||!Number.isFinite(v.y)||Math.abs(v.x)>1e7||Math.abs(v.y)>1e7)throw new Error('节点坐标无效');return {...G.node(n.x,n.y),in:G.point(n.in),out:G.point(n.out),mode:['cusp','smooth','symmetric'].includes(n.mode)?n.mode:'cusp'};});
   return {id:p.id,name:String(p.name||'曲线').slice(0,80),note:String(p.note||''),role:['outline','seam','cut','note'].includes(p.role)?p.role:'outline',color:/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#e04544',closed:!!p.closed&&nodes.length>=3,nodes};
  });
  const d=empty();Object.assign(d,{title:String(raw.title||'修改文件').slice(0,200),width:raw.width,height:raw.height,newNodeMode:['cusp','smooth','symmetric'].includes(raw.newNodeMode)?raw.newNodeMode:'cusp',opacity:Number.isFinite(raw.opacity)?Math.max(0,Math.min(1,raw.opacity)):.65,image:raw.image?{name:raw.image.name,dataUrl:raw.image.dataUrl,width:raw.width,height:raw.height}:null,paths:cleanPaths(raw.paths,true)});
  if(raw.mirrorAxis!=null){
   const axis=raw.mirrorAxis;for(const p of [axis.a,axis.b])if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e7||Math.abs(p.y)>1e7)throw new Error('对称轴坐标无效');
   if(G.dist(axis.a,axis.b)<1e-6)throw new Error('对称轴两点不能重合');d.mirrorAxis={a:G.point(axis.a),b:G.point(axis.b)};
  }
  d.originals=cleanPaths(Array.isArray(raw.originals)?raw.originals.slice(0,500):raw.paths,false);return d;
 }
 function openProject(raw){const d=validate(raw);checkpoint();doc=d;resetAuxiliary();selected=d.paths[0]?.id||null;ni=null;tool='node';drawing=false;dirty=false;render();fit();}
 $('project-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>32*1024*1024)throw new Error('修改文件过大');const raw=JSON.parse(await f.text());validate(raw);if(dirty&&!confirm('当前修改未保存，仍要打开另一份修改吗？'))return;openProject(raw);status(`已打开 ${f.name}`);}catch(err){status('打开失败：'+err.message);}finally{e.target.value='';}};
 function download(data,type,name){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function svgExport(){const paths=doc.paths.map(p=>`<path d="${G.pathD(p)}" fill="none" stroke="${p.color}" stroke-width="2" data-role="${p.role}"><title>${esc(p.name)}</title><desc>${esc(p.note)}</desc></path>`).join('\n');return `<svg xmlns="${NS}" width="${doc.width}px" height="${doc.height}px" viewBox="0 0 ${doc.width} ${doc.height}"><title>${esc(doc.title)}</title><desc>图像像素坐标，未标定毫米；修改建议，非直接生产切割稿。</desc>${paths}</svg>`;}
 $('export').onclick=()=>{download(svgExport(),'image/svg+xml',`${doc.title}.svg`);status('已导出可编辑曲线 SVG（像素坐标，不含底图与手柄）');};
 async function save(){
  if(saveBusy)return;if(document.activeElement?.matches('input,textarea,select'))document.activeElement.blur();
  saveBusy=true;$('save').disabled=true;
  const payload=clone(doc);payload.savedAt=new Date().toISOString();payload.paths=payload.paths.filter(p=>p.nodes.length);const stamp=JSON.stringify(doc);
  try{
   const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   if(!response.ok)throw new Error(await response.text());const result=await response.json();
   lastSaved=result.filename;if(JSON.stringify(doc)===stamp)dirty=false;status(`已保存 ${result.filename}。回聊天说“按最新保存的曲线改”即可`);
  }catch(err){download(JSON.stringify(payload,null,2),'application/json',`${doc.title}.json`);status('本机保存服务不可用，已改为下载修改文件；请保留并发给 AI');}
  finally{saveBusy=false;$('save').disabled=false;}
 }
 $('save').onclick=save;
 new ResizeObserver(()=>{if(!doc)return;fit();}).observe(svg.parentElement);
 demo();
 fetch('/api/latest').then(r=>r.ok?r.json():null).then(raw=>{if(raw&&!dirty){openProject(raw);status('已恢复上次保存的修改。所有文件都留在本机');}}).catch(()=>{});
})();
