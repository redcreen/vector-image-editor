(() => {
 'use strict';
 const G=window.CurveGeometry,L=window.CurveLayers,O=window.CurveOffset,$=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
 const clone=o=>JSON.parse(JSON.stringify(o)), uid=()=>crypto.randomUUID();
 // Portable copies carry up to 100 snapshots; the AI save service keeps its own smaller limit.
 const MAX_PROJECT_FILE=256*1024*1024;
 const svg=$('canvas'),view=$('viewport');
 let doc,selected=null,ni=null,selection=[],nodeSelection=[],tool='node',drawing=false,drag=null,space=false;
 let imageSelection=[],activeLayer=null;
 let draggedLayer=null;
 let camera={x:0,y:0,z:1},dirty=false,lastSaved='',saveBusy=false,editingField=null,cleanDoc=null;
 const taps=window.CurveInteractions.createTapTracker(),menu=$('context-menu');
 let tapStart=null,capturedPointer=null;
 let axisStart=null,hoverPoint=null,measurement=null,measureMode='points',calibrationDraft=null;
 let replay=null,sessionDB=null,sessionKey=null,sessionTimer=null,sessionBooting=true,sessionGeneration=0,historyRevision=-1,historyListKey='';
 const sessionAssets=new Map(),committedAssets=new Set();
 let journalToken=null;
 let tracePreview=null,tracePointer=null,traceTimer=null,traceRequest=0,traceWorker=null,traceWorkerAsset=null;
 let offsetDraft=null,offsetTimer=null;
 const offsetDialog=$('offset-dialog'),saveAsDialog=$('save-as-dialog');
 const offsetPreview=el('g',{id:'offset-preview','pointer-events':'none'},view);
 const traceRasters=new Map(),traceJobs=new Map();
 const journalKey=()=>`curve-editor-refresh:${sessionKey}`;
 const tools=[...document.querySelectorAll('[data-tool]')], modes=[...document.querySelectorAll('[data-mode]')];
 const layout=$('editor-layout'),panels=[...document.querySelectorAll('[data-panel]')],layoutKey='curve-editor-layout-v1';
 function persistLayout(){
  try{localStorage.setItem(layoutKey,JSON.stringify({toolsCollapsed:layout.classList.contains('tools-collapsed'),panelsCollapsed:layout.classList.contains('panels-collapsed'),groups:Object.fromEntries(panels.map(p=>[p.dataset.panel,p.open]))}));}catch{}
 }
 function syncLayout(){
  const toolsCollapsed=layout.classList.contains('tools-collapsed'),panelsCollapsed=layout.classList.contains('panels-collapsed');
  for(const [id,collapsed,label] of [['toggle-tools',toolsCollapsed,'工具栏'],['toggle-panels',panelsCollapsed,'功能面板']]){
   const button=$(id),title=`${collapsed?'展开':'收起'}${label}`;button.setAttribute('aria-expanded',String(!collapsed));button.setAttribute('aria-label',title);button.title=title;
  }
  $('panel-content').hidden=panelsCollapsed;$('panel-rail').hidden=!panelsCollapsed;
 }
 function showPanel(key,revealDock=false){
  const panel=panels.find(p=>p.dataset.panel===key);if(!panel)return;
  const wasClosed=!panel.open;
  panel.open=true;
  if(revealDock){layout.classList.remove('panels-collapsed');syncLayout();panel.querySelector('summary').focus({preventScroll:true});}
  if(!layout.classList.contains('panels-collapsed')&&(wasClosed||revealDock))panel.scrollIntoView({block:'nearest'});
  persistLayout();
 }
 try{
  const saved=JSON.parse(localStorage.getItem(layoutKey));
  if(saved&&typeof saved==='object'){
   layout.classList.toggle('tools-collapsed',saved.toolsCollapsed===true);layout.classList.toggle('panels-collapsed',saved.panelsCollapsed===true);
   for(const panel of panels)if(typeof saved.groups?.[panel.dataset.panel]==='boolean')panel.open=saved.groups[panel.dataset.panel];
  }
 }catch{}
 syncLayout();
 for(const panel of panels)panel.addEventListener('toggle',persistLayout);
 $('toggle-tools').onclick=()=>{layout.classList.toggle('tools-collapsed');syncLayout();persistLayout();};
 $('toggle-panels').onclick=()=>{layout.classList.toggle('panels-collapsed');syncLayout();persistLayout();};
 document.querySelectorAll('[data-panel-target]').forEach(button=>button.onclick=()=>showPanel(button.dataset.panelTarget,true));
 const selectedPath=()=>doc.paths.find(p=>p.id===selected), selectedNode=()=>selectedPath()?.nodes[ni];
 const selectedCurves=()=>doc.paths.filter(p=>selection.includes(p.id)&&L.editable(doc,p.id));
 const selectedImages=()=>doc.images.filter(i=>imageSelection.includes(i.id)&&L.editable(doc,i.id,'image'));
 const currentLayer=()=>doc.layers.find(l=>l.id===activeLayer)||doc.layers.at(-1);
 const editablePaths=()=>doc.paths.filter(p=>L.editable(doc,p.id));
 const nodeKey=item=>`${item.pathId}\0${item.index}`;
 function selectPaths(ids,active=null){imageSelection=[];selection=[...new Set(ids)].filter(id=>L.editable(doc,id));selected=selection.includes(active)?active:selection.at(-1)||null;ni=null;nodeSelection=[];if(selected)activeLayer=L.layerFor(doc,selected).id;}
 function selectElements(paths,images){selectPaths(paths);imageSelection=[...new Set(images)].filter(id=>L.editable(doc,id,'image'));if(imageSelection.length)activeLayer=L.layerFor(doc,imageSelection.at(-1),'image').id;}
 function selectNodes(items,active=items.at(-1)){
  imageSelection=[];nodeSelection=[...new Map(items.map(item=>[nodeKey(item),item])).values()].filter(item=>L.editable(doc,item.pathId)&&doc.paths.find(p=>p.id===item.pathId)?.nodes[item.index]);
  selection=[...new Set(nodeSelection.map(item=>item.pathId))];const focus=nodeSelection.find(item=>nodeKey(item)===nodeKey(active||{}))||nodeSelection.at(-1);
  selected=focus?.pathId||null;ni=focus?.index??null;
  if(selected)activeLayer=L.layerFor(doc,selected).id;
 }
 function selectedNodes(){return nodeSelection.map(item=>({path:doc.paths.find(p=>p.id===item.pathId),index:item.index})).filter(item=>item.path?.nodes[item.index]);}
 function selectionBounds(){
  if(tool==='select')return L.bounds(doc,selection,imageSelection);
  if(tool!=='node'||nodeSelection.length<2)return null;
  const nodes=selectedNodes();if(!nodes.length)return null;
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const {path,index} of nodes){const n=path.nodes[index];x=Math.min(x,n.x);y=Math.min(y,n.y);right=Math.max(right,n.x);bottom=Math.max(bottom,n.y);}
  return {x,y,width:right-x,height:bottom-y};
 }
 function selectionDragHit(p,target,shift=false){
  if(shift||target.closest('[data-node],[data-side],[data-corner]'))return false;
  const pathId=target.getAttribute('data-path'),imageId=target.getAttribute('data-image');
  if((pathId&&!selection.includes(pathId))||(imageId&&!imageSelection.includes(imageId)))return false;
  const b=selectionBounds(),pad=10/camera.z;
  return !!b&&p.x>=b.x-pad&&p.x<=b.x+b.width+pad&&p.y>=b.y-pad&&p.y<=b.y+b.height+pad;
 }
 const snapshot=()=>({doc:{...doc,paths:clone(doc.paths),layers:clone(doc.layers),images:doc.images.map(i=>({...i})),originals:clone(doc.originals),mirrorAxis:clone(doc.mirrorAxis),calibration:clone(doc.calibration)},selected,ni,selection:selection.slice(),imageSelection:imageSelection.slice(),activeLayer,nodeSelection:clone(nodeSelection),drawing,tool});
 // Images are immutable and shared by snapshots, so avoid comparing their large data URLs.
 const sameDoc=(a,b)=>a.image===b.image&&a.images.length===b.images.length&&a.images.every((i,n)=>i.dataUrl===b.images[n].dataUrl)&&JSON.stringify({...a,image:null,images:a.images.map(i=>({...i,dataUrl:null}))})===JSON.stringify({...b,image:null,images:b.images.map(i=>({...i,dataUrl:null}))});
 function describeEdit(before,after){
  const a=before.doc,b=after.doc,eq=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
  if(a.title!==b.title||a.width!==b.width||a.height!==b.height)return b.paths.length||b.images.length?'打开作品':'新建画板';
  if(a.images.length!==b.images.length)return b.images.length>a.images.length?'导入图片':'删除图片';
  if(a.paths.length!==b.paths.length){
   if(b.paths.length>a.paths.length&&b.paths.some(p=>!a.paths.some(q=>q.id===p.id)&&p.note?.startsWith('等距偏移：')))return '偏移曲线';
   if(b.paths.length<a.paths.length&&b.paths.some(p=>p.nodes.length>(a.paths.find(q=>q.id===p.id)?.nodes.length??Infinity)))return '合并曲线';
   return b.paths.length>a.paths.length?'新建曲线 / 镜像副本':'删除曲线';
  }
  if(a.layers.length!==b.layers.length)return b.layers.length>a.layers.length?'新建图层':'删除图层';
  if(!eq(a.layers,b.layers)){
   if(a.layers.some((l,i)=>l.id!==b.layers[i]?.id))return '调整图层顺序';
   if(a.layers.some((l,i)=>l.name!==b.layers[i]?.name))return '图层重命名';
   if(a.layers.some((l,i)=>l.visible!==b.layers[i]?.visible))return '显示 / 隐藏图层';
   if(a.layers.some((l,i)=>l.locked!==b.layers[i]?.locked))return '锁定 / 解锁图层';
  }
  if(!eq(a.mirrorAxis,b.mirrorAxis))return b.mirrorAxis?'设置对称轴':'清除对称轴';
  if(!eq(a.calibration,b.calibration))return b.calibration?'设置测量比例':'清除测量比例';
  if(a.measureUnit!==b.measureUnit)return '切换测量单位';
  if(a.opacity!==b.opacity||a.images.some((image,i)=>image.opacity!==b.images[i]?.opacity))return '调整图片透明度';
  if(!eq(a.images,b.images))return '移动 / 缩放图片';
  for(let i=0;i<b.paths.length;i++){
   const p=a.paths[i],q=b.paths[i];if(!p||p.id!==q.id)return '打开作品';
   for(const [key,label] of [['dashed','调整虚线样式'],['name','修改曲线名称'],['note','修改曲线说明'],['color','修改线色'],['role','修改曲线用途'],['closed','闭合 / 打开曲线']])if(p[key]!==q[key])return label;
   if(p.nodes.length!==q.nodes.length)return q.nodes.length>p.nodes.length?'添加节点':'删除节点';
   if(p.nodes.some((n,i)=>n.mode!==q.nodes[i].mode))return '调整节点类型';
   if(p.nodes.some((n,i)=>n.x!==q.nodes[i].x||n.y!==q.nodes[i].y))return before.tool==='select'?'移动 / 缩放曲线':'移动节点';
   if(!eq(p.nodes,q.nodes))return '调整控制柄';
  }
  return a.newNodeMode!==b.newNodeMode?'设置新节点类型':'修改作品';
 }
 const edits=window.CurveInteractions.createHistory({same:(a,b)=>sameDoc(a.doc,b.doc),describe:describeEdit});
 function commitEdit(){editingField=null;edits.commit(snapshot());}
 function blurEditor(){if(document.activeElement?.matches('input,textarea,select'))document.activeElement.blur();}
 function checkpoint(){commitEdit();edits.begin(snapshot());}
 function updateDirty(){dirty=!cleanDoc||!sameDoc(cleanDoc,doc);scheduleSession();}
 function markClean(){cleanDoc=snapshot().doc;dirty=false;scheduleSession();}
 function renderHistory(){
  const pending=edits.hasChanges({doc}),u=Math.min(100,edits.undoCount+Number(pending)),r=pending?0:edits.redoCount;
  $('undo').disabled=!u;$('redo').disabled=!r;
  $('undo').title=`撤销 · 可撤销 ${u} 步 · ⌘ / Ctrl + Z`;
  $('redo').title=`重做 · 可重做 ${r} 步 · ⌘ / Ctrl + Shift + Z；Ctrl + Y`;
  const total=replay?replay.timeline.frames.length-1:u+r,index=replay?replay.index:u;
  $('history-count').textContent=`${total} 步`;
  $('replay-play').disabled=!total;$('replay-play').textContent=replay?.playing?'暂停':replay?'继续':'重放';
  $('replay-stop').disabled=!replay;$('replay-prev').disabled=!total||index===0;$('replay-next').disabled=!total||index===total;
  $('replay-progress').textContent=`${replay?'预览':'当前作品'} · ${index} / ${total}`;
  const key=`${edits.revision}:${pending}:${index}:${!!replay}`;
  if(key!==historyListKey){
   historyListKey=key;const timeline=replay?.timeline||edits.timeline(snapshot()),list=$('history-list');list.replaceChildren();
   timeline.labels.forEach((label,i)=>{
    const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.dataset.step=i;
    button.textContent=`${i}. ${label}${i===timeline.cursor?' · 当前':''}${i>timeline.cursor?' · 已撤销':''}`;
    button.setAttribute('aria-current',String(i===index));button.classList.toggle('undone',i>timeline.cursor);button.title='预览这一步';button.onclick=()=>previewStep(i);item.append(button);list.append(item);
   });
  }
  if(!replay&&historyRevision!==edits.revision){historyRevision=edits.revision;scheduleSession();}
 }
 function storageStatus(state,text){$('history-storage').dataset.state=state;$('history-storage').textContent=text;}
 function scheduleSession(){
  if(sessionBooting||replay||!sessionDB||!sessionKey)return;
  clearTimeout(sessionTimer);sessionGeneration++;storageStatus('saving','正在保存本机记录…');sessionTimer=setTimeout(writeSession,120);
 }
 function sessionPayload(){const current=replay?.original||snapshot();return {current,history:edits.serialize(current),cleanDoc,camera:replay?.camera||camera};}
 // Refresh can cancel an IndexedDB transaction. A synchronous journal covers the
 // last gesture; immutable images already on disk are referenced by their keys.
 function writeRefreshJournal(){
  if(sessionBooting||!sessionDB||!sessionKey)return;
  try{
   const packed=window.CurveInteractions.packSession(sessionPayload());
   packed.assets=packed.assets.map(dataUrl=>committedAssets.has(sessionAssets.get(dataUrl))?{key:sessionAssets.get(dataUrl)}:dataUrl);
   packed.journalId=uid();journalToken=packed.journalId;
   localStorage.setItem(journalKey(),JSON.stringify(packed));
  }catch{storageStatus('unavailable','刷新备份不可用，请等待本机保存完成或手动保存作品');}
 }
 function writeSession(){
  clearTimeout(sessionTimer);sessionTimer=null;if(sessionBooting||!sessionDB||!sessionKey)return;
  const generation=sessionGeneration,journalId=journalToken;
  try{
   const data=window.CurveInteractions.packSession(sessionPayload()),transaction=sessionDB.transaction(['projects','assets'],'readwrite'),assets=transaction.objectStore('assets'),keys=[];
   data.assets=data.assets.map(dataUrl=>{
    if(!sessionAssets.has(dataUrl))sessionAssets.set(dataUrl,uid());const key=sessionAssets.get(dataUrl);keys.push(key);
    if(!committedAssets.has(key))assets.put({project:sessionKey,dataUrl},key);return {key};
   });
   transaction.objectStore('projects').put(data,sessionKey);
   transaction.oncomplete=()=>{
    keys.forEach(key=>committedAssets.add(key));
    if(generation===sessionGeneration){try{if(journalId&&JSON.parse(localStorage.getItem(journalKey()))?.journalId===journalId)localStorage.removeItem(journalKey());}catch{}storageStatus('saved','已保存在本机 · 刷新可恢复');}
   };
   transaction.onabort=()=>{if(generation===sessionGeneration)storageStatus('unavailable','本机记录保存失败，无法保证刷新恢复；请保存作品');};
  }catch{storageStatus('unavailable','本机记录保存失败，无法保证刷新恢复；请保存作品');}
 }
 async function readSessionAssets(packed){
  if(!Array.isArray(packed?.assets))throw new Error('记录图片无效');
  const transaction=sessionDB.transaction('assets'),assets=transaction.objectStore('assets');
  const urls=await Promise.all(packed.assets.map(asset=>{
   if(typeof asset==='string')return asset;
   if(typeof asset?.key!=='string')throw new Error('记录图片无效');
   return new Promise((resolve,reject)=>{
    const request=assets.get(asset.key);request.onerror=()=>reject(request.error);request.onsuccess=()=>{
     const record=request.result;if(record?.project!==sessionKey||typeof record.dataUrl!=='string'){reject(new Error('记录图片缺失'));return;}
     sessionAssets.set(record.dataUrl,asset.key);committedAssets.add(asset.key);resolve(record.dataUrl);
    };
   });
  }));
  return {...packed,assets:urls};
 }
 function applySnapshot(s){
  doc=s.doc;selected=s.selected;ni=s.ni;selection=s.selection;imageSelection=s.imageSelection;activeLayer=s.activeLayer;nodeSelection=s.nodeSelection;drawing=s.drawing;tool=s.tool;
  drag=null;tapStart=null;taps.reset();hideMenu();resetAuxiliary();
 }
 function lockReplay(locked){
  document.body.classList.toggle('replaying',locked);
  document.querySelectorAll('.files,.actionbar,.tools,.panel-group:not([data-panel="history"]),#panel-rail').forEach(e=>e.inert=locked);
 }
 function beginReplay(){
  if(replay)return;blurEditor();endDrag();commitEdit();writeSession();
  const original=snapshot(),timeline=edits.timeline(original);if(timeline.frames.length<2)return;
  replay={original,timeline,index:timeline.cursor,playing:false,timer:null,camera:{...camera}};hideMenu();showPanel('history',true);lockReplay(true);
 }
 function showReplayFrame(index){
  if(!replay)return;replay.index=Math.max(0,Math.min(replay.timeline.frames.length-1,index));
  applySnapshot(clone(replay.timeline.frames[replay.index]));render();
  $('canvas-hint').textContent='正在预览操作记录 · 回到当前作品后继续编辑';status(`重放预览：${replay.index}. ${replay.timeline.labels[replay.index]}`);
 }
 function previewStep(index){beginReplay();if(!replay)return;clearTimeout(replay.timer);replay.playing=false;showReplayFrame(index);}
 function stopReplay(){
  if(!replay)return;const original=replay.original;clearTimeout(replay.timer);camera=replay.camera;replay=null;lockReplay(false);applySnapshot(original);updateDirty();render();status('已回到当前作品');
 }
 function queueReplay(){
  clearTimeout(replay.timer);replay.timer=setTimeout(()=>{
   if(!replay?.playing)return;
   if(replay.index>=replay.timeline.frames.length-1){stopReplay();return;}
   showReplayFrame(replay.index+1);queueReplay();
  },Number($('replay-speed').value));
 }
 $('show-history').onclick=()=>{blurEditor();commitEdit();renderHistory();showPanel('history',true);};
 $('replay-stop').onclick=stopReplay;
 $('replay-play').onclick=()=>{
  if(replay?.playing){clearTimeout(replay.timer);replay.playing=false;renderHistory();return;}
  const fresh=!replay;beginReplay();if(!replay)return;replay.playing=true;
  showReplayFrame(fresh||replay.index===replay.timeline.frames.length-1?0:replay.index);queueReplay();
 };
 $('replay-prev').onclick=()=>{beginReplay();if(replay)previewStep(replay.index-1);};
 $('replay-next').onclick=()=>{beginReplay();if(replay)previewStep(replay.index+1);};
 $('replay-speed').onchange=()=>{if(replay?.playing)queueReplay();};
 for(const type of ['pointerdown','dblclick','contextmenu','drop','paste'])document.addEventListener(type,e=>{
  if(replay&&(e.target.closest?.('#canvas')||type==='paste')){e.preventDefault();e.stopImmediatePropagation();}
 },true);
 function changed(message){clearTrace();L.prune(doc);updateDirty();render();if(message)status(message);}
 function status(s){$('status').textContent=s;}
 function el(tag,attrs,parent){const e=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));parent.appendChild(e);return e;}
 function empty(){return L.normalize({format:'daban-curve-editor',version:1,title:'未命名修改',width:1000,height:700,units:'image-px',newNodeMode:doc?.newNodeMode||'cusp',image:null,opacity:.65,paths:[],originals:[],mirrorAxis:null,calibration:null,measureUnit:'mm',note:'坐标为原始图像像素；实际测量长度依据两点标定，仅作修改沟通。'});}
 function attachPath(path,layer=currentLayer()){doc.paths.push(path);layer.pathIds.push(path.id);}
 function makePath(){return {id:uid(),name:`曲线 ${doc.paths.length+1}`,role:'outline',color:'#e04544',closed:false,note:'',nodes:[]};}
 function demo(){doc=empty();doc.title='练习曲线';let p=makePath();p.name='练习曲线';p.nodes=[G.node(200,460),G.node(480,230),G.node(780,430)];p.nodes[0].out={x:300,y:450};p.nodes[1].in={x:345,y:230};p.nodes[1].out={x:615,y:230};p.nodes[1].mode='symmetric';p.nodes[2].in={x:650,y:430};attachPath(p);doc.originals=clone(doc.paths);selectNodes([{pathId:p.id,index:1}]);markClean();render();fit();}
 function point(e){const r=svg.getBoundingClientRect();return {x:(e.clientX-r.left-camera.x)/camera.z,y:(e.clientY-r.top-camera.y)/camera.z};}
 function screenPoint(e){const r=svg.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
 function fit(){const r=svg.getBoundingClientRect(),b=L.contentBounds(doc);camera.z=Math.max(.000001,Math.min((r.width-70)/b.width,(r.height-80)/b.height));camera.x=(r.width-b.width*camera.z)/2-b.x*camera.z;camera.y=(r.height-b.height*camera.z)/2-b.y*camera.z;renderCanvas();}
 function zoom(factor,p){const r=svg.getBoundingClientRect();p=p||{x:r.width/2,y:r.height/2};const z=Math.min(16,Math.max(.000001,camera.z*factor));camera.x=p.x-(p.x-camera.x)*z/camera.z;camera.y=p.y-(p.y-camera.y)*z/camera.z;camera.z=z;renderCanvas();}
 function clearTrace(){clearTimeout(traceTimer);traceRequest++;tracePreview=null;$('trace-preview').replaceChildren();$('trace-summary').textContent='等待指向图片中的线条';}
 const traceSettings=()=>({tolerance:Number($('trace-tolerance').value),gap:Number($('trace-gap').value),smoothing:Number($('trace-smoothing').value)});
 const imageSignature=i=>[i.id,i.x,i.y,i.width,i.height,i.opacity,L.visible(doc,i.id,'image')].join(':');
 function traceImagesAt(p){
  const images=[];
  for(const layer of doc.layers.slice().reverse())if(layer.visible)for(const i of doc.images.slice().reverse())if(layer.imageIds.includes(i.id)&&i.opacity>0&&p.x>=i.x&&p.x<i.x+i.width&&p.y>=i.y&&p.y<i.y+i.height)images.push(i);
  return images;
 }
 async function traceRaster(i){
  let promise=traceRasters.get(i.dataUrl);if(promise)return promise;
  promise=(async()=>{const im=new Image();im.src=i.dataUrl;await im.decode();const scale=Math.min(1,1800/Math.max(im.naturalWidth,im.naturalHeight),Math.sqrt(1800000/(im.naturalWidth*im.naturalHeight)));
   const canvas=document.createElement('canvas');canvas.width=Math.max(3,Math.round(im.naturalWidth*scale));canvas.height=Math.max(3,Math.round(im.naturalHeight*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(im,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);return {pixels,width:canvas.width,height:canvas.height,scale};})();
  if(traceRasters.size>=3)traceRasters.delete(traceRasters.keys().next().value);traceRasters.set(i.dataUrl,promise);
  try{return await promise;}catch(err){traceRasters.delete(i.dataUrl);throw err;}
 }
 async function calculateTrace(asset,raster,seed,options,id){
  // A running scan finishes once; only the latest waiting pointer can start
  // another scan. Superseded hovers never build a queue in the Worker.
  const active=traceJobs.values().next().value;if(active)await active.completion;
  if(id!==traceRequest)return null;
  if(typeof Worker==='undefined')return Promise.resolve(window.CurveTracing.trace(raster,seed,options));
  if(!traceWorker){traceWorker=new Worker('tracing.js');traceWorker.onmessage=e=>{const job=traceJobs.get(e.data.id);if(!job)return;traceJobs.delete(e.data.id);e.data.error?job.reject(new Error(e.data.error)):job.resolve(e.data.result);};traceWorker.onerror=()=>{for(const job of traceJobs.values())job.reject(new Error('线条计算失败，请重新选择工具'));traceJobs.clear();traceWorker.terminate();traceWorker=null;traceWorkerAsset=null;};}
  let resolve,reject;const completion=new Promise((yes,no)=>{resolve=yes;reject=no;});traceJobs.set(id,{resolve,reject,completion});
  try{const image=traceWorkerAsset===asset?undefined:raster;traceWorkerAsset=asset;traceWorker.postMessage({id,image,seed,options});}catch(err){traceJobs.delete(id);reject(err);}
  return completion;
 }
 async function previewTrace(p){
  const id=++traceRequest;tracePreview=null;$('trace-preview').replaceChildren();
  const images=traceImagesAt(p);if(!images.length){$('trace-summary').textContent='请指向可见图片中的线条';return null;}
  $('trace-summary').textContent='正在识别线条…';
  try{
   for(const image of images){
   const signature=imageSignature(image);
   const raster=await traceRaster(image);if(id!==traceRequest||tool!=='trace'||space)return null;
   const seed={x:(p.x-image.x)*raster.width/image.width,y:(p.y-image.y)*raster.height/image.height},settings=traceSettings();
   const result=await calculateTrace(image.dataUrl,raster.pixels,seed,{...settings,gap:settings.gap*raster.scale,smoothing:settings.smoothing*raster.scale,radiusX:10/camera.z*raster.width/image.width,radiusY:10/camera.z*raster.height/image.height},id);
   if(id!==traceRequest||tool!=='trace'||imageSignature(image)!==signature||!doc.images.includes(image)||replay)return null;
   if(!result){
    const x=Math.min(raster.width-1,Math.max(0,Math.floor(seed.x))),y=Math.min(raster.height-1,Math.max(0,Math.floor(seed.y)));
    if(raster.pixels.data[(y*raster.width+x)*4+3]<240||image.opacity<.98)continue;
    break;
   }
   const map=p=>({x:image.x+p.x*image.width/raster.width,y:image.y+p.y*image.height/raster.height});
   const path={...result,nodes:result.nodes.map(n=>({...map(n),in:map(n.in),out:map(n.out),mode:n.mode}))};delete path.points;
   tracePreview={path,imageId:image.id,signature,p: {...p}};renderTrace();
   $('trace-summary').textContent=`${result.dashed?'虚线':'实线'} · ${result.segments} 段 · ${path.nodes.length} 个节点 · ${path.closed?'闭合':'开放'}；点击生成`;
   return tracePreview;
   }
   $('trace-summary').textContent='未找到线条；靠近线条，或调整颜色容差与连接距离';return null;
  }catch(err){if(id===traceRequest){$('trace-summary').textContent='提取失败：'+err.message;status('提取失败：'+err.message);}return null;}
 }
 function renderTrace(){
  const group=$('trace-preview');group.replaceChildren();if(!tracePreview||tool!=='trace'||replay)return;
  const image=doc.images.find(i=>i.id===tracePreview.imageId);if(!image||imageSignature(image)!==tracePreview.signature){clearTrace();return;}
  const d=G.pathD(tracePreview.path);el('path',{d,fill:'none',stroke:'white','stroke-width':5/camera.z,'stroke-linecap':'round'},group);
  el('path',{d,fill:'none',stroke:'#176bce','stroke-width':2.5/camera.z,'stroke-linecap':'round'},group);
 }
 function scheduleTrace(p){tracePointer={...p};clearTimeout(traceTimer);traceRequest++;tracePreview=null;renderTrace();traceTimer=setTimeout(()=>previewTrace(p),100);}
 async function createTrace(p){
  clearTimeout(traceTimer);
  const candidate=tracePreview&&G.dist(p,tracePreview.p)<12/camera.z?tracePreview:await previewTrace(p);if(!candidate||candidate!==tracePreview||tool!=='trace'||replay)return;
  if(doc.paths.length>=500){status('曲线已达到500条，请删除一些曲线后再提取');return;}
  const source=doc.layers.findIndex(l=>l.imageIds.includes(candidate.imageId));
  let layer=doc.layers.slice(source+1).reverse().find(l=>l.name==='提取曲线'&&l.visible&&!l.locked);
  if(!layer&&doc.layers.length>=200){status('图层已达到200层，请减少图层后再提取');return;}
  checkpoint();if(!layer){layer=L.addLayer(doc,'提取曲线');}activeLayer=layer.id;
  const path={...makePath(),name:`提取${candidate.path.dashed?'虚线':'线条'} ${doc.paths.length+1}`,color:candidate.path.color,closed:candidate.path.closed,nodes:clone(candidate.path.nodes),dashed:candidate.path.dashed,note:'从参考图片提取；断线连接与曲线拟合请人工核对。'};
  attachPath(path,layer);clearTrace();tracePointer=null;setTool('node');selectNodes([{pathId:path.id,index:0}]);changed(`已提取 ${path.nodes.length} 个可编辑节点，可拖动调整或撤销`);
 }
 for(const key of ['tolerance','gap','smoothing'])$('trace-'+key).oninput=()=>{const value=$('trace-'+key).value;$('trace-'+key+'-value').textContent=value+(key==='tolerance'?'':' px');clearTrace();if(tool==='trace'&&tracePointer)scheduleTrace(tracePointer);};
 function renderCanvas(){
  view.setAttribute('transform',`translate(${camera.x} ${camera.y}) scale(${camera.z})`);
  // Paint the visible world area; the image extent never limits the workspace.
  const r=svg.getBoundingClientRect(),pad=50/camera.z;
  for(const id of ['paper','grid-paper']){const e=$(id);e.setAttribute('x',-camera.x/camera.z-pad);e.setAttribute('y',-camera.y/camera.z-pad);e.setAttribute('width',r.width/camera.z+2*pad);e.setAttribute('height',r.height/camera.z+2*pad);}
  $('reference').setAttribute('width',doc.width);$('reference').setAttribute('height',doc.height);
  $('grid-paper').style.display=$('show-grid').checked?'':'none';
  const ref=$('reference');if(doc.image){if(ref.getAttribute('href')!==doc.image.dataUrl)ref.setAttribute('href',doc.image.dataUrl);ref.style.display='';}else{ref.removeAttribute('href');ref.style.display='none';}ref.setAttribute('opacity',doc.opacity);
  const pg=$('paths'),hg=$('handles'),gg=$('ghosts');pg.replaceChildren();hg.replaceChildren();gg.replaceChildren();
  if($('show-original').checked)doc.originals.filter(p=>L.visible(doc,p.id)).forEach(p=>el('path',{d:G.pathD(p),fill:'none',stroke:'#8898a9','stroke-width':1.5/camera.z,'stroke-dasharray':`${5/camera.z} ${4/camera.z}`,'pointer-events':'none'},gg));
  for(const layer of doc.layers){
   if(!layer.visible)continue;const group=el('g',{'data-layer':layer.id},pg);
   for(const i of doc.images.filter(i=>layer.imageIds.includes(i.id)))el('image',{x:i.x,y:i.y,width:i.width,height:i.height,href:i.dataUrl,opacity:i.opacity,preserveAspectRatio:'none','data-image':i.id,'pointer-events':!layer.locked&&tool==='select'?'all':'none',class:'selected-image'},group);
   for(const p of doc.paths.filter(p=>layer.pathIds.includes(p.id))){
    el('path',{d:G.pathD(p),stroke:p.color,'stroke-width':(selection.includes(p.id)?2.6:2)/camera.z,...(p.dashed?{'stroke-dasharray':`${8/camera.z} ${6/camera.z}`}:{ }),class:'svg-curve','pointer-events':'none'},group);
    if(!layer.locked)el('path',{d:G.pathD(p),'stroke-width':(tool==='select'?12:18)/camera.z,class:'hit-line','data-path':p.id},group);
   }
  }
  const chosen=new Set(nodeSelection.map(nodeKey));
  if(tool==='node'||tool==='pen')for(const p of selectedCurves())p.nodes.forEach((n,i)=>{
   if(p.id===selected&&i===ni){for(const side of ['in','out']){
    if(G.dist(n,n[side])<.5/camera.z)continue;
    el('line',{x1:n.x,y1:n.y,x2:n[side].x,y2:n[side].y,stroke:'#3d89dc','stroke-width':1/camera.z,class:'handle-line'},hg);
    el('circle',{cx:n[side].x,cy:n[side].y,r:9/camera.z,fill:'transparent','data-side':side,'data-node':i,'data-path':p.id,class:'control'},hg);
    el('circle',{cx:n[side].x,cy:n[side].y,r:4.5/camera.z,fill:'#fff',stroke:'#176bce','stroke-width':1.5/camera.z,'pointer-events':'none'},hg);
   }}
   const checked=chosen.has(nodeKey({pathId:p.id,index:i}));
   el('rect',{x:n.x-7/camera.z,y:n.y-7/camera.z,width:14/camera.z,height:14/camera.z,fill:'transparent','data-node':i,'data-path':p.id,'data-selected':checked,class:'anchor'},hg);
   el('rect',{x:n.x-4/camera.z,y:n.y-4/camera.z,width:8/camera.z,height:8/camera.z,fill:checked?'#176bce':'white',stroke:'#176bce','stroke-width':1.5/camera.z,'pointer-events':'none'},hg);
   if(p.id===selected&&i===ni)el('text',{x:n.x+10/camera.z,y:n.y-10/camera.z,fill:'#176bce','font-size':12/camera.z,'pointer-events':'none'},hg).textContent=`${i+1}`;
  });
  renderSelection();renderTrace();renderOffsetPreview();
  $('zoom').textContent=`${camera.z<.01?Number((camera.z*100).toPrecision(2)):Math.round(camera.z*100)}%`;
  $('canvas-label').textContent=`无限画布 · ${doc.layers.length} 个图层 · ${doc.images.length} 张图片`;
  svg.style.cursor=space||tool==='pan'?(drag?.kind==='pan'?'grabbing':'grab'):['elements','nodes'].includes(drag?.kind)?'move':['pen','axis','measure','calibrate','trace'].includes(tool)?'crosshair':'default';
  renderGuides();renderCalibrationGuide();renderMeasurement();
 }
 function renderSelection(){
  const group=$('selection-overlay');group.replaceChildren();
  const b=selectionBounds();
  if(b){const pad=10/camera.z;el('rect',{x:b.x-pad,y:b.y-pad,width:b.width+2*pad,height:b.height+2*pad,class:'selection-bounds','stroke-width':1/camera.z},group);
   if(tool==='select'&&b.width>1e-6&&b.height>1e-6)for(const [corner,x,y] of [['nw',b.x-pad,b.y-pad],['ne',b.x+b.width+pad,b.y-pad],['se',b.x+b.width+pad,b.y+b.height+pad],['sw',b.x-pad,b.y+b.height+pad]])el('rect',{x:x-5/camera.z,y:y-5/camera.z,width:10/camera.z,height:10/camera.z,'stroke-width':1.5/camera.z,'data-corner':corner,class:'resize-handle'},group);
  }
  if(drag?.kind==='marquee'&&drag.moved){const b=G.normalizeRect(drag.start,drag.current);el('rect',{...b,class:'selection-marquee','stroke-width':1/camera.z},group);}
 }
 function renderLayers(){
  const layer=currentLayer();activeLayer=layer.id;const list=$('layer-list');list.replaceChildren();
  $('layer-count').textContent=`${doc.layers.length} 层`;
  for(const item of doc.layers.slice().reverse()){
   const row=document.createElement('div');row.className='layer-row'+(item.id===activeLayer?' active':'');row.dataset.layer=item.id;
   const select=document.createElement('button');select.className='layer-select';select.setAttribute('aria-pressed',item.id===activeLayer);select.title=`选择图层 ${item.name} · 拖动调整顺序 · 右键操作`;select.draggable=true;
   const count=document.createElement('small');count.textContent=item.pathIds.length+item.imageIds.length;select.append(count,document.createTextNode(item.name));
   select.onclick=()=>{blurEditor();selectPaths([]);activeLayer=item.id;drawing=false;render();};row.append(select);
   select.ondragstart=e=>{hideMenu();draggedLayer=item.id;e.dataTransfer.setData('application/x-curve-editor-layer',item.id);e.dataTransfer.effectAllowed='move';row.classList.add('layer-dragging');};
   select.ondragend=()=>{draggedLayer=null;clearLayerDropMarks();};
   row.ondragover=e=>{if(!draggedLayer)return;e.preventDefault();e.dataTransfer.dropEffect='move';clearLayerDropMarks();if(draggedLayer!==item.id)row.classList.add(e.clientY<row.getBoundingClientRect().top+row.offsetHeight/2?'drop-before':'drop-after');};
   row.ondragleave=e=>{if(!row.contains(e.relatedTarget)){row.classList.remove('drop-before','drop-after');}};
   row.ondrop=e=>{if(!draggedLayer)return;e.preventDefault();e.stopPropagation();const source=draggedLayer,before=e.clientY<row.getBoundingClientRect().top+row.offsetHeight/2;draggedLayer=null;clearLayerDropMarks();moveLayer(source,item.id,before);};
   row.oncontextmenu=e=>layerMenu(e,item.id);
   select.onkeydown=e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();const r=row.getBoundingClientRect();layerMenu({preventDefault(){},clientX:r.left+20,clientY:r.bottom},item.id);}};
   for(const key of ['visible','locked']){
    const visible=key==='visible',b=document.createElement('button');b.dataset.action=key;b.type='button';b.title=visible?(item.visible?'隐藏图层':'显示图层'):(item.locked?'解锁图层':'锁定图层');b.setAttribute('aria-label',b.title+' '+item.name);b.setAttribute('aria-pressed',item[key]);
    const icon=el('svg',{viewBox:'0 0 24 24','aria-hidden':'true',focusable:'false'},b);
    if(visible){
     el('path',{d:'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z'},icon);
     el('circle',{cx:12,cy:12,r:3},icon);
     if(!item.visible)el('path',{d:'m3 3 18 18'},icon);
    }
    else{
     el('rect',{x:5,y:10,width:14,height:11,rx:2},icon);
     el('path',{d:item.locked?'M8 10V7a4 4 0 0 1 8 0v3':'M8 10V7a4 4 0 0 1 7.5-2'},icon);
     el('path',{d:'M12 15v2'},icon);
    }
    row.append(b);
    b.onclick=()=>{blurEditor();checkpoint();item[key]=!item[key];const paths=selection.slice(),images=imageSelection.slice();selectElements(paths,images);activeLayer=item.id;drawing=false;changed();};
   }
   const remove=document.createElement('button');remove.type='button';remove.dataset.action='delete';remove.title='删除图层 '+item.name;remove.setAttribute('aria-label',remove.title);
   const trash=el('svg',{viewBox:'0 0 24 24','aria-hidden':'true',focusable:'false'},remove);el('path',{d:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7'},trash);
   remove.onclick=()=>deleteLayer(item.id);row.append(remove);
   list.append(row);
  }
  $('add-layer').disabled=doc.layers.length>=200;
  const elements=$('layer-elements');elements.replaceChildren();
  for(const [type,items] of [['image',doc.images.filter(i=>layer.imageIds.includes(i.id))],['path',doc.paths.filter(p=>layer.pathIds.includes(p.id))]])for(const item of items){
   const b=document.createElement('button');b.dataset[type]=item.id;b.textContent=(type==='image'?'图片：':'曲线：')+item.name;b.disabled=!layer.visible||layer.locked;
   b.setAttribute('aria-pressed',(type==='image'?imageSelection:selection).includes(item.id));b.title=layer.locked?'图层已锁定，请先解锁':!layer.visible?'图层已隐藏，请点击眼睛显示':'选择'+(type==='image'?'图片 ':'曲线 ')+item.name;b.onclick=e=>{blurEditor();setTool('select');if(type==='image')selectElements(e.shiftKey?selection:[],e.shiftKey?(imageSelection.includes(item.id)?imageSelection.filter(id=>id!==item.id):[...imageSelection,item.id]):[item.id]);else if(e.shiftKey)togglePath(item.id);else selectPaths([item.id]);render();};elements.append(b);
  }
  if(!elements.childElementCount){const p=document.createElement('p');p.textContent='空图层：导入图片或开始画线';elements.append(p);}
 }
 function renderTransform(){
  const b=L.bounds(doc,selection,imageSelection),count=selection.length+imageSelection.length;
  $('element-count').textContent=count?`${count} 个元素`:'未选择';$('delete-element').disabled=!count;
  for(const key of ['x','y','width','height']){const input=$('element-'+key);input.disabled=!b||((key==='width'||key==='height')&&b[key]<1e-9);if(document.activeElement!==input)input.value=b?Number(b[key].toFixed(4)):'';}
 }
 function addLayer(){blurEditor();checkpoint();try{activeLayer=L.addLayer(doc,`图层 ${doc.layers.length+1}`).id;selectPaths([]);drawing=false;changed('新图层已创建，可在此画线');}catch(err){status(err.message);}}
 $('add-layer').onclick=addLayer;
 function clearLayerDropMarks(){$('layer-list').querySelectorAll('.drop-before,.drop-after,.layer-dragging').forEach(row=>row.classList.remove('drop-before','drop-after','layer-dragging'));}
 function moveLayer(sourceId,targetId,before){
  if(sourceId===targetId)return;
  const ordered=doc.layers.slice().reverse(),source=ordered.find(l=>l.id===sourceId);if(!source||!ordered.some(l=>l.id===targetId))return;
  ordered.splice(ordered.indexOf(source),1);ordered.splice(ordered.findIndex(l=>l.id===targetId)+(before?0:1),0,source);ordered.reverse();
  if(ordered.every((l,i)=>l===doc.layers[i]))return;
  blurEditor();checkpoint();doc.layers=ordered;drawing=false;changed('图层顺序已调整，可撤销');
 }
 function renameLayer(id){
  const layer=doc.layers.find(l=>l.id===id),row=[...$('layer-list').children].find(r=>r.dataset.layer===id);if(!layer||!row)return;
  const select=row.querySelector('.layer-select');
  const input=document.createElement('input');input.className='layer-rename';input.value=layer.name;input.maxLength=80;input.setAttribute('aria-label','图层名称');input.title='Enter 确认，Esc 取消';
  let done=false;
  const finishName=(cancel,restoreFocus=false)=>{
   if(done)return;done=true;const name=input.value.trim().slice(0,80);
   // Keep sibling controls mounted so the click that ends renaming can complete.
   input.replaceWith(select);
   if(!cancel&&name&&name!==layer.name){checkpoint();layer.name=name;edits.commit(snapshot());updateDirty();renderHistory();status('图层已重命名，可撤销');}
   select.lastChild.textContent=layer.name;select.title=`选择图层 ${layer.name} · 拖动调整顺序 · 右键操作`;
   for(const control of row.querySelectorAll('[data-action]')){
    const remove=control.dataset.action==='delete';if(remove)control.title='删除图层 '+layer.name;
    control.setAttribute('aria-label',control.title+(remove?'':' '+layer.name));
   }
   if(restoreFocus)select.focus({preventScroll:true});
  };
  input.onblur=()=>finishName(false);input.onkeydown=e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopPropagation();finishName(e.key==='Escape',true);}};
  select.replaceWith(input);input.focus();input.select();
 }
 function deleteLayer(id){
  blurEditor();const layer=doc.layers.find(l=>l.id===id);if(!layer)return;checkpoint();
  doc.paths=doc.paths.filter(p=>!layer.pathIds.includes(p.id));doc.images=doc.images.filter(i=>!layer.imageIds.includes(i.id));doc.layers=doc.layers.filter(l=>l.id!==id);
  if(!doc.layers.length)L.addLayer(doc,'曲线图层');if(!doc.layers.some(l=>l.id===activeLayer))activeLayer=doc.layers.at(-1).id;
  selectPaths([]);drawing=false;measurement=null;changed('图层及其中的元素已删除，可撤销');
 }
 function layerMenu(e,id=null){
  e.preventDefault();blurEditor();hideMenu();
  const layer=doc.layers.find(l=>l.id===id);
  if(layer){selectPaths([]);activeLayer=id;drawing=false;render();}
  startMenu(layer?layer.name+' · 图层操作':'图层操作');
  if(layer){menuAction('重命名图层',()=>renameLayer(id));menuAction('删除图层',()=>deleteLayer(id));}
  menuAction('新建图层',addLayer,doc.layers.length>=200);menuAction('导入图片',()=>$('image-file').click());showMenuAt(e);
 }
 $('layer-list').addEventListener('contextmenu',e=>{if(!e.target.closest('.layer-row'))layerMenu(e);});
 function deleteElements(){if(!selection.length&&!imageSelection.length)return;blurEditor();checkpoint();doc.paths=doc.paths.filter(p=>!selection.includes(p.id));doc.images=doc.images.filter(i=>!imageSelection.includes(i.id));selectPaths([]);drawing=false;measurement=null;changed('所选元素已删除，可撤销');}
 $('delete-element').onclick=deleteElements;
 for(const key of ['x','y','width','height']){
  const input=$('element-'+key);input.onchange=()=>{
   const b=L.bounds(doc,selection,imageSelection),value=Number(input.value);if(!b)return;
   if(!input.value.trim()||!Number.isFinite(value)||((key==='width'||key==='height')&&value<=0)){status('请输入有效的位置或大于零的尺寸');renderTransform();return;}
   if(value===b[key])return;const target={...b,[key]:value};
   if($('keep-ratio').checked&&b.width>1e-9&&b.height>1e-9){if(key==='width')target.height=b.height*value/b.width;if(key==='height')target.width=b.width*value/b.height;}
   checkpoint();try{L.transform(doc,selection,imageSelection,b,target);measurement=null;changed('元素位置与尺寸已更新，可撤销');}catch(err){status(err.message);render();}
  };
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}});
 }
 function render(){
  if(!replay&&!drag&&!editingField)edits.commit(snapshot());
  renderCanvas();tools.forEach(b=>b.setAttribute('aria-pressed',b.dataset.tool===tool));
  renderHistory();
  renderLayers();renderTransform();
  const p=selectedPath(),n=selectedNode(),curves=selectedCurves(),nodes=selectedNodes(),multiple=curves.length>1;
  $('selection-count').textContent=tool==='node'&&nodes.length?`已选 ${nodes.length} 个节点`:curves.length+imageSelection.length?`已选 ${curves.length+imageSelection.length} 个元素`:'未选择';
  $('select-all').disabled=!editablePaths().length&&!doc.images.some(i=>L.editable(doc,i.id,'image'));$('deselect').disabled=!curves.length&&!imageSelection.length;
  $('properties-title').textContent=multiple?`已选 ${curves.length} 条曲线`:'当前曲线';
  const list=$('curve-list');list.replaceChildren();
  if(!doc.paths.length){const e=document.createElement('span');e.textContent='还没有曲线';e.style.color='#7c8998';list.appendChild(e);}
  doc.paths.forEach(path=>{const b=document.createElement('button');b.className='curve-item';b.disabled=!L.editable(doc,path.id);b.setAttribute('aria-pressed',selection.includes(path.id));const sw=document.createElement('i');sw.style.background=path.color;const label=document.createElement('span');label.textContent=path.name;const count=document.createElement('small');count.textContent=`${path.nodes.length} 点`;b.append(sw,label,count);b.onclick=e=>{blurEditor();drawing=false;if(e.shiftKey){togglePath(path.id);render();}else{selectPaths([path.id]);setTool('node');}};b.oncontextmenu=e=>curveListMenu(e,path);list.appendChild(b);});
  for(const id of ['path-name','path-role','path-color','path-note','path-dashed','delete-path'])$(id).disabled=!p;
  $('path-dashed').checked=curves.length>0&&curves.every(p=>p.dashed);$('path-dashed').indeterminate=curves.some(p=>p.dashed)&&!curves.every(p=>p.dashed);
  $('path-name').disabled=!p||multiple;$('path-note').disabled=!p||multiple;
  $('delete-path').textContent=multiple?`删除选中的 ${curves.length} 条曲线`:'删除这条曲线';
  if(document.activeElement!==$('path-name'))$('path-name').value=multiple?'':p?.name||'';
  $('path-role').value=p?.role||'outline';$('path-color').value=p?.color||'#e04544';
  if(document.activeElement!==$('path-note'))$('path-note').value=multiple?'':p?.note||'';
  const nodeMode=nodes.length?nodes.every(item=>item.path.nodes[item.index].mode===nodes[0].path.nodes[nodes[0].index].mode)?nodes[0].path.nodes[nodes[0].index].mode:null:doc.newNodeMode;
  modes.forEach(b=>{b.disabled=false;b.setAttribute('aria-pressed',nodeMode===b.dataset.mode);});
  const modeNames={cusp:'尖角',smooth:'平滑',symmetric:'对称'};
  $('node-mode-hint').textContent=`新节点沿用：${modeNames[doc.newNodeMode]}${n?' · 上方为当前节点类型':''}`;
  for(const axis of ['x','y']){const e=$('node-'+axis);e.disabled=!n;if(document.activeElement!==e)e.value=n?Number(n[axis].toFixed(2)):'';}
  $('node-id').textContent=nodes.length>1?`已选 ${nodes.length} 点`:n?`第 ${ni+1} 点`:'未选择';$('delete-node').disabled=!nodes.length;$('straight').disabled=!nodes.length;
  $('delete-node').textContent=nodes.length>1?`删除 ${nodes.length} 个节点`:'删除节点';
  const closable=curves.filter(path=>path.nodes.length>=3);
  $('close-path').disabled=!closable.length;$('close-path').textContent=closable.length&&closable.every(path=>path.closed)?'打开曲线':'闭合曲线';$('finish').disabled=!drawing;
  const images=selectedImages(),opacity=images[0]?.opacity??doc.opacity;
  $('opacity').value=opacity*100;$('opacity-value').textContent=`${Math.round(opacity*100)}%`;
  $('image-opacity-hint').textContent=images.length?`已选 ${images.length} 张图片`:'选中图片调透明度';
  $('axis-info').textContent=axisStart?'已定第一点 · 接近水平或竖直自动吸附':doc.mirrorAxis?'已设置对称轴 · 可重新画轴':'点击两点画轴 · 接近水平或竖直自动吸附';
  $('mirror-copy').disabled=!p||!p.nodes.length||!doc.mirrorAxis;$('clear-axis').disabled=!doc.mirrorAxis&&!axisStart;
  const hints={node:'空白处框选节点；选区内拖动整组；Shift 点选增减或追加框选',select:'选区内拖动整组；拖角等比缩放；空白处框选；Shift 追加选择',pen:'点击加点，拖出弧线；右键也可加点或结束',pan:'按住拖动画板；滚轮缩放；右键打开操作菜单',axis:axisStart?'点击第二点完成；接近水平或竖直自动吸附；Shift 约束角度；Esc 取消':'点击两点画对称轴；靠近节点自动吸附',measure:measureMode==='points'?'连续点击测量直线距离；靠近节点自动吸附；Enter 结束，Backspace 回退':'点选首段，再 Shift 点末段，测量连续线段；闭合曲线可切换另一侧'};
  hints.calibrate=calibrationDraft?.length===2?'输入两点之间的实际长度，选择 mm/cm，再点“应用比例”':`点击第 ${(calibrationDraft?.length||0)+1} 个标定点；靠近节点自动吸附；Esc 取消`;
  hints.trace='指向图片实线或虚线看蓝色预览；点击生成可编辑曲线；Esc 取消';$('canvas-hint').textContent=hints[tool];renderCalibration();
 }
 function setTool(t){clearTrace();tracePointer=null;hideMenu();taps.reset();drawing=false;axisStart=null;hoverPoint=null;if(t==='select'){ni=null;nodeSelection=[];}if(t!=='calibrate')calibrationDraft=null;if(measurement?.kind==='points')measurement.finished=true;tool=t;const panel={select:'properties',node:'curves',pen:'curves',axis:'mirror',measure:'measurement',calibrate:'measurement',trace:'view'}[t];if(panel)showPanel(panel);render();}
 function togglePath(id){const images=imageSelection.slice();selectPaths(selection.includes(id)?selection.filter(value=>value!==id):[...selection,id],id);imageSelection=images;}
 function selectAll(){blurEditor();if(tool==='node')selectNodes(editablePaths().flatMap(path=>path.nodes.map((_,index)=>({pathId:path.id,index}))));else{setTool('select');selectElements(editablePaths().map(path=>path.id),doc.images.filter(i=>L.editable(doc,i.id,'image')).map(i=>i.id));}render();}
 $('select-all').onclick=selectAll;
 $('deselect').onclick=()=>{blurEditor();selectPaths([]);render();};
 function finish(){drawing=false;tool='node';render();}
 const lengthText=n=>{const result=G.measureLength(n,doc.calibration,doc.measureUnit);return `${result.value.toFixed(2)} ${result.unit}`;};
 function resetAuxiliary(){closeOffset();clearTrace();tracePointer=null;axisStart=null;hoverPoint=null;measurement=null;calibrationDraft=null;}
 function renderCalibration(){
  const c=doc.calibration,active=calibrationDraft!==null;
  $('calibration-info').textContent=c?`已标定：两点距离 ${c.length} ${c.unit} · 1 px = ${Number(G.millimetersPerPixel(c).toPrecision(6))} mm`:'未标定 · 设置两点的已知距离后显示 mm/cm';
  $('calibrate').setAttribute('aria-pressed',tool==='calibrate');$('calibration-clear').disabled=!c;
  $('calibration-editor').hidden=!active;$('calibration-apply').disabled=calibrationDraft?.length!==2;
  $('calibration-points').textContent=calibrationDraft?.length===2?`两点图上距离 ${G.dist(...calibrationDraft).toFixed(2)} px；填写实际长度`:`请在画板点击第 ${(calibrationDraft?.length||0)+1} 个位置`;
  if(!active){$('calibration-length').value=c?.length??'';$('calibration-unit').value=c?.unit||'mm';}
  $('measure-unit').disabled=!c;$('measure-unit').value=doc.measureUnit;
  $('measurement-unit-hint').textContent=c?`${doc.measureUnit} · 已标定`:'px · 未标定';
  $('coordinates').textContent=`图像坐标 px · ${c?'已设置实际比例':'未设置实际比例'}`;
 }
 function renderCalibrationGuide(){
  const group=$('calibration-overlay');group.replaceChildren();const pts=calibrationDraft||(doc.calibration?[doc.calibration.a,doc.calibration.b]:[]);if(!pts.length)return;
  const a=pts[0],b=pts[1]||(tool==='calibrate'?hoverPoint:null);
  if(b)el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#bd790c','stroke-width':1.5/camera.z,'stroke-dasharray':`${5/camera.z} ${4/camera.z}`},group);
  for(const p of pts)el('circle',{cx:p.x,cy:p.y,r:4/camera.z,fill:'white',stroke:'#bd790c','stroke-width':1.5/camera.z},group);
  if(pts.length===2)el('text',{x:(a.x+b.x)/2,y:(a.y+b.y)/2-10/camera.z,'font-size':12/camera.z,'stroke-width':4/camera.z,class:'calibration-label'},group).textContent=calibrationDraft?'标定参考距离':`标定：${doc.calibration.length} ${doc.calibration.unit}`;
 }
 function applyCalibration(){
  if(calibrationDraft?.length!==2)return;
  const calibration={a:G.point(calibrationDraft[0]),b:G.point(calibrationDraft[1]),length:Number($('calibration-length').value),unit:$('calibration-unit').value};
  try{G.millimetersPerPixel(calibration);}catch(err){status(err.message);return;}
  checkpoint();doc.calibration=calibration;doc.measureUnit=calibration.unit;setTool('measure');changed('实际比例已设置，所有测量按此比例换算；保存作品可保留标定');
 }
 function snapToNode(pos){
  let closest=null,distance=9/camera.z;
  for(const path of doc.paths.filter(p=>L.visible(doc,p.id)))for(const n of path.nodes){const d=G.dist(pos,n);if(d<distance){closest=n;distance=d;}}
  return G.point(closest||pos);
 }
 function axisPoint(p,constrain){
  if(!axisStart)return snapToNode(p);
  const pos=constrain?snap(axisStart,p):snapToNode(p),dx=Math.abs(pos.x-axisStart.x),dy=Math.abs(pos.y-axisStart.y);
  const slope=Math.tan(5*Math.PI/180);
  if(dy<=dx*slope)return {x:pos.x,y:axisStart.y};
  if(dx<=dy*slope)return {x:axisStart.x,y:pos.y};
  return pos;
 }
 function renderGuides(){
  const group=$('guides');group.replaceChildren();const axis=axisStart?{a:axisStart,b:hoverPoint||axisStart}:doc.mirrorAxis;
  if(!axis)return;
  const {a,b}=axis,d=G.dist(a,b),span=Math.max(doc.width,doc.height,svg.clientWidth/camera.z,svg.clientHeight/camera.z)*3;
  if(d>1e-6){const dx=(b.x-a.x)/d*span,dy=(b.y-a.y)/d*span;el('line',{x1:a.x-dx,y1:a.y-dy,x2:b.x+dx,y2:b.y+dy,stroke:'#9858b1','stroke-width':1.5/camera.z,'stroke-dasharray':`${7/camera.z} ${5/camera.z}`},group);}
  for(const p of [a,b])el('circle',{cx:p.x,cy:p.y,r:4/camera.z,fill:'white',stroke:'#9858b1','stroke-width':1.5/camera.z},group);
  const direction=d>1e-6?(a.y===b.y?' · 水平':a.x===b.x?' · 竖直':''):'';
  el('text',{x:a.x+9/camera.z,y:a.y-9/camera.z,fill:'#87459f','font-size':12/camera.z},group).textContent='对称轴'+direction;
 }
 function mirrorCopy(){
  const paths=selectedCurves().filter(p=>p.nodes.length);if(!paths.length||!doc.mirrorAxis)return;
  if(doc.paths.length+paths.length>500){status('最多支持 500 条曲线，请先整理曲线');return;}
  const copies=paths.map(path=>{const copy=G.reflectPath(path,doc.mirrorAxis.a,doc.mirrorAxis.b);copy.id=uid();copy.name=`${path.name.slice(0,75)} · 镜像`;return copy;});
  if(copies.some(copy=>copy.nodes.some(n=>[n,n.in,n.out].some(p=>Math.abs(p.x)>1e7||Math.abs(p.y)>1e7)))){status('镜像后坐标超出范围，请调整对称轴');return;}
  checkpoint();copies.forEach((copy,i)=>attachPath(copy,L.layerFor(doc,paths[i].id)));selectPaths(copies.map(p=>p.id));setTool('node');changed('已生成独立的镜像副本，原曲线保留；可撤销');
 }
 function measurementData(){
  if(!measurement)return null;
  if(measurement.kind==='points'){
   const pts=measurement.points;return {total:G.polylineLength(pts),items:pts.slice(1).map((p,i)=>({label:`点 ${i+1} → ${i+2}`,length:G.dist(pts[i],p),position:G.mix(pts[i],p,.5)})),summary:`${pts.length} 个测点 · ${measurement.finished?'已结束':'连续点距'}`,points:pts};
  }
  const path=doc.paths.find(p=>p.id===measurement.pathId);if(!path||!L.visible(doc,path.id))return null;
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
  const previous=measurement;selectPaths([path.id]);setTool('measure');measureMode='segments';
  measurement=extend&&previous?.kind==='segments'&&previous.pathId===path.id?{...previous,end:index}:{kind:'segments',pathId:path.id,start:index,end:index,alternate:false};render();
 }
 function measureCurve(path){
  if(!path)return;selectPaths([path.id]);setTool('measure');measureMode='segments';measurement={kind:'curve',pathId:path.id};render();status(`曲线弧长约 ${lengthText(measurementData().total)}`);
 }
 function snap(origin,p){const a=Math.round(Math.atan2(p.y-origin.y,p.x-origin.x)/(Math.PI/4))*Math.PI/4,d=G.dist(origin,p);return {x:origin.x+Math.cos(a)*d,y:origin.y+Math.sin(a)*d};}
 function closestCurve(pos){
  let result=null;
  for(const layer of doc.layers.slice().reverse())for(const path of editablePaths().filter(p=>layer.pathIds.includes(p.id))){const hit=G.nearest(path,pos);if(hit.distance<=12/camera.z&&(!result||hit.distance<result.hit.distance))result={path,hit};}
  return result;
 }
 function insertAt(pos){
  const result=closestCurve(pos);if(!result)return false;
  const {path,hit}=result,projected=G.at(path.nodes[hit.index],path.nodes[(hit.index+1)%path.nodes.length],hit.t);
  const existing=path.nodes.findIndex(n=>G.dist(n,projected)<=8/camera.z);
  if(existing!==-1){selectNodes([{pathId:path.id,index:existing}]);drawing=false;tool='node';render();status('这里已有节点，可直接拖动调整');return false;}
  checkpoint();measurement=null;selectNodes([{pathId:path.id,index:G.split(path,hit.index,hit.t)}]);drawing=false;tool='node';
  changed('已增加节点，原曲线形状保持不变');return true;
 }
 function hideMenu(){menu.hidden=true;}
 function closeOffset(){
  clearTimeout(offsetTimer);offsetTimer=null;offsetDraft=null;offsetPreview.replaceChildren();
  if(offsetDialog.open)offsetDialog.close();
 }
 function offsetMenuAction(){
  const paths=selectedCurves(),usable=paths.length&&paths.every(p=>p.nodes.length>=2);
  menuAction('偏移曲线…',openOffset,!usable,usable?'':'请选择至少含两个节点的曲线');
 }
 function openOffset(){
  if(replay)return;blurEditor();endDrag();hideMenu();closeOffset();clearTrace();
  const sources=selectedCurves();let contours;
  try{contours=O.prepareContours(sources);}catch(err){status(err.message);return;}
  offsetDraft={sources:clone(sources),contours,calibration:clone(doc.calibration),active:selected,results:null};
  const closed=contours.filter(c=>c.path.closed).length,open=contours.length-closed;
  $('offset-closed-settings').hidden=!closed;$('offset-open-settings').hidden=!open;
  $('offset-summary').textContent=`已选 ${sources.length} 条曲线 · ${closed?`${closed} 个闭合轮廓`:''}${closed&&open?'、':''}${open?`${open} 条开放轮廓`:''}`;
  $('offset-calibrate').hidden=!!doc.calibration;
  offsetDialog.showModal();updateOffset();$('offset-distance').focus();$('offset-distance').select();
 }
 function requestOffset(){
  if(!offsetDraft)return;clearTimeout(offsetTimer);offsetDraft.results=null;offsetPreview.replaceChildren();
  $('offset-apply').disabled=true;$('offset-info').textContent='正在更新预览…';$('offset-info').dataset.state='pending';
  offsetTimer=setTimeout(updateOffset,100);
 }
 function updateOffset(){
  clearTimeout(offsetTimer);offsetTimer=null;if(!offsetDraft)return;
  offsetDraft.results=null;$('offset-apply').disabled=true;
  try{
   const value=Number($('offset-distance').value),unit=$('offset-unit').value;
   const pixels=O.physicalDistancePixels(value,unit,offsetDraft.calibration);
   const results=O.offsetContours(offsetDraft.contours,pixels,{closedDirection:$('offset-closed-direction').value,openSide:$('offset-open-side').value,tolerancePx:Math.max(.00001,Math.min(.05,pixels*.005))});
   if(!results.length)throw new Error('没有有效的偏移结果，请调整距离');
   if(doc.paths.length+results.length>500)throw new Error('生成后曲线总数不能超过 500 条，请减少选择');
   offsetDraft.results=results;offsetDraft.value=value;offsetDraft.unit=unit;offsetDraft.closedDirection=$('offset-closed-direction').value;offsetDraft.openSide=$('offset-open-side').value;
   $('offset-info').textContent=`将生成 ${results.length} 条新曲线 · ${value} ${unit}`;$('offset-info').dataset.state='ready';$('offset-apply').disabled=false;
  }catch(err){$('offset-info').textContent=err.message;$('offset-info').dataset.state='error';}
  renderOffsetPreview();
 }
 function renderOffsetPreview(){
  offsetPreview.replaceChildren();if(!offsetDraft)return;
  for(const result of offsetDraft.results||[])el('path',{d:G.pathD(result.path),fill:'none',stroke:'#13816c','stroke-width':2.5/camera.z,'stroke-linecap':'round','stroke-linejoin':'round','data-offset-preview':''},offsetPreview);
  for(const {path} of offsetDraft.contours.filter(c=>!c.path.closed)){
   const i=Math.floor(G.segmentCount(path)/2),a=path.nodes[i],b=path.nodes[i+1];
   const start=G.at(a,b,.45),end=G.at(a,b,.55),p=G.at(a,b,.5),length=G.dist(start,end);if(length<1e-9)continue;
   const dx=(end.x-start.x)/length,dy=(end.y-start.y)/length,s=1/camera.z;
   const x=p.x+dx*14*s,y=p.y+dy*14*s;
   el('path',{d:`M ${p.x-dx*14*s} ${p.y-dy*14*s} L ${x} ${y} M ${x-dx*7*s+dy*5*s} ${y-dy*7*s-dx*5*s} L ${x} ${y} L ${x-dx*7*s-dy*5*s} ${y-dy*7*s+dx*5*s}`,fill:'none',stroke:'#176bce','stroke-width':2/camera.z,'stroke-linecap':'round','stroke-linejoin':'round','data-offset-direction':''},offsetPreview);
  }
 }
 function applyOffset(){
  if(!offsetDraft)return;updateOffset();if(!offsetDraft?.results)return;
  const draft=offsetDraft;
  if(JSON.stringify(doc.calibration)!==JSON.stringify(draft.calibration)||draft.sources.some(p=>!L.editable(doc,p.id)||JSON.stringify(doc.paths.find(q=>q.id===p.id))!==JSON.stringify(p))){
   $('offset-info').textContent='来源曲线或标定已变化，请取消后重新打开偏移';$('offset-info').dataset.state='error';$('offset-apply').disabled=true;draft.results=null;renderOffsetPreview();return;
  }
  const copies=draft.results.map(result=>{
   const source=draft.sources.find(p=>p.id===draft.active&&result.sourceIds.includes(p.id))||draft.sources.find(p=>result.sourceIds.includes(p.id));
   const direction=result.path.closed?(draft.closedDirection==='outward'?'外扩':'内收'):(draft.openSide==='left'?'左偏':'右偏');
   const suffix=` · ${direction} ${draft.value} ${draft.unit}`;
   return {path:{...clone(source),id:uid(),name:source.name.slice(0,Math.max(0,80-suffix.length))+suffix,note:`等距偏移：${direction} ${draft.value} ${draft.unit}。\n${source.note||''}`,closed:result.path.closed,nodes:clone(result.path.nodes)},layer:L.layerFor(doc,source.id)};
  });
  checkpoint();copies.forEach(({path,layer})=>attachPath(path,layer));closeOffset();measurement=null;drawing=false;
  selectPaths(copies.map(c=>c.path.id));tool='node';changed(`已生成 ${copies.length} 条可编辑偏移曲线；原曲线保留，可撤销`);
 }
 $('offset-form').onsubmit=e=>{e.preventDefault();applyOffset();};
 $('offset-cancel').onclick=closeOffset;
 offsetDialog.addEventListener('cancel',e=>{e.preventDefault();closeOffset();});
 offsetDialog.addEventListener('close',closeOffset);
 $('offset-calibrate').onclick=()=>{closeOffset();$('calibrate').click();};
 for(const id of ['offset-distance','offset-unit','offset-closed-direction','offset-open-side'])$(id).addEventListener('input',requestOffset);
 function mergeSelectedCurves(){
  const paths=selectedCurves();let merged;
  try{merged=G.mergePaths(paths,selected);}catch(err){status(err.message);return;}
  checkpoint();const ids=new Set(paths.map(p=>p.id));
  doc.paths=doc.paths.flatMap(p=>p.id===merged.id?[merged]:ids.has(p.id)?[]:[p]);
  measurement=null;drawing=false;selectPaths([merged.id]);tool='node';
  changed(`已合并 ${paths.length} 条曲线，按最近端点连接；可继续编辑节点或撤销`);
 }
 function curveListMenu(e,path){
  e.preventDefault();if(replay||!L.editable(doc,path.id))return;
  blurEditor();endDrag();drawing=false;
  const included=selection.includes(path.id);selectPaths(included?selection:[path.id],included?selected:path.id);render();
  const paths=selectedCurves(),canMerge=paths.length>=2&&paths.every(p=>!p.closed&&p.nodes.length>=2);
  startMenu(paths.length>1?`已选 ${paths.length} 条曲线`:'曲线操作');
  menuAction('合并曲线',mergeSelectedCurves,!canMerge,canMerge?'':paths.length<2?'Shift 多选开放曲线后可合并':'合并需选择至少有两个节点的开放曲线');
  offsetMenuAction();
  curveDeleteAction();showMenuAt(e);
 }
 function curveDeleteAction(){const count=selectedCurves().length;menuAction(count>1?'删除所选曲线':'删除曲线',removePaths,!count);}
 function startMenu(label){menu.replaceChildren();menu.setAttribute('aria-label',label+'右键菜单');const title=document.createElement('div');title.className='menu-title';title.textContent=label;menu.append(title);}
 function menuAction(label,fn,disabled=false,title=''){const b=document.createElement('button');b.type='button';b.role='menuitem';b.textContent=label;b.disabled=disabled;b.title=title;b.onclick=()=>{hideMenu();fn();};menu.append(b);}
 function showMenuAt(e){
  menu.hidden=false;menu.style.left='0px';menu.style.top='0px';
  const bounds=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(e.clientX,innerWidth-bounds.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(e.clientY,innerHeight-bounds.height-8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
 }
 function appendAt(pos,newCurve=false){
  if(!currentLayer().visible||currentLayer().locked){status('当前图层已隐藏或锁定，请切换图层或解锁后画线');return;}
  checkpoint();measurement=null;let path=selectedPath();
  if(newCurve||!path||path.closed){path=makePath();attachPath(path);}
  selectNodes([{pathId:path.id,index:G.append(path,pos,doc.newNodeMode)}]);drawing=true;tool='pen';
  changed('已在此加点，继续点击或拖动可接着画线');
 }
 svg.addEventListener('contextmenu',e=>{
  blurEditor();e.preventDefault();endDrag();tapStart=null;taps.reset();
  const pos=point(e),pointed=editablePaths().find(p=>p.id===e.target.closest('[data-path]')?.getAttribute('data-path'));
  // Prefer the actual clicked line/anchor when multiple curves share a position.
  const result=pointed?(G.segmentCount(pointed)?{path:pointed,hit:G.nearest(pointed,pos)}:null):closestCurve(pos);let index=-1;
  // Right-clicking an anchor must not collapse a curve multiselection to one node.
  const focus=(path,i)=>{if(i>=0&&selection.length>1&&!nodeSelection.length&&selection.includes(path.id))index=i=-1;if(i>=0){const item={pathId:path.id,index:i};if(nodeSelection.some(n=>nodeKey(n)===nodeKey(item))){selected=path.id;ni=i;}else selectNodes([item]);}else if(!selection.includes(path.id))selectPaths([path.id]);else{selected=path.id;ni=null;}render();};
  if(result){index=['node','pen'].includes(tool)?result.path.nodes.findIndex(n=>G.dist(n,pos)<=10/camera.z):-1;focus(result.path,index);}
  // One-node paths have no segment to hit, but still expose their node actions.
  if(!result){for(const path of pointed?[pointed]:editablePaths()){const i=path.nodes.findIndex(n=>G.dist(n,pos)<=10/camera.z);if(i!==-1){index=['node','pen'].includes(tool)?i:-1;focus(path,index);break;}}}
  startMenu(index>=0?'节点操作':result?'曲线操作':'画布操作');const action=menuAction;
  action('导入图片',()=>$('image-file').click());
  if(nodeSelection.length)action('顺滑所选节点',smoothSelectedNodes);
  if(index>=0){
   action(nodeSelection.length>1?'删除所选节点':'删除这个节点',removeNode);
   for(const [mode,label] of [['cusp','转为尖角节点'],['smooth','转为平滑节点'],['symmetric','转为对称节点']])action(label,()=>modes.find(b=>b.dataset.mode===mode).click());
  }else if(result){action('在曲线此处加点',()=>insertAt(pos));}
  else {
   const canContinue=selectedPath()&&!selectedPath().closed;
   action(canContinue?'在此加点 · 续接当前曲线':'在此加点 · 新建曲线',()=>appendAt(pos));
   if(canContinue)action('从这里新画一条曲线',()=>appendAt(pos,true));
  }
  const path=selectedPath();
  if(path){
   offsetMenuAction();
   curveDeleteAction();
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
  action(tool==='node'?'全选节点':'全选曲线',selectAll,!doc.paths.length);
  action('取消选择',()=>$('deselect').click(),!selection.length);
  action('撤销',()=>history(true),$('undo').disabled);
  action('重做',()=>history(false),$('redo').disabled);
  showMenuAt(e);
 });
 document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))hideMenu();});
 window.addEventListener('resize',hideMenu);window.addEventListener('scroll',e=>{if(!e.target.closest?.('#panel-dock,.tools'))hideMenu();},true);
 menu.addEventListener('keydown',e=>{
  if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();
  const items=[...menu.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();
 });
 svg.addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.button!==1)return;blurEditor();svg.focus({preventScroll:true});e.preventDefault();const p=point(e),target=e.target;
  const editable=tool==='node'||tool==='select';
  tapStart=e.button===0&&editable&&!space&&!e.shiftKey&&!target.hasAttribute('data-side')?{...screenPoint(e),time:e.timeStamp}:null;
  svg.setPointerCapture(e.pointerId);capturedPointer=e.pointerId;
  if(space||tool==='pan'||e.button===1){drag={kind:'pan',screen:screenPoint(e),camera:{...camera}};return;}
  if(tool==='trace'){tapStart=null;createTrace(p);return;}
  const corner=target.getAttribute('data-corner');
  if(corner&&tool==='select'){tapStart=null;checkpoint();drag={kind:'resize',corner,start:p,bounds:L.bounds(doc,selection,imageSelection),base:snapshot().doc};return;}
  if(tool==='calibrate'){
   if(!calibrationDraft||calibrationDraft.length===2)calibrationDraft=[];
   const pos=snapToNode(p);
   if(calibrationDraft.length&&G.dist(calibrationDraft[0],pos)<1e-6){status('两个标定点不能重合，请选择另一点');return;}
   calibrationDraft.push(pos);hoverPoint=pos;render();
   if(calibrationDraft.length===2){$('calibration-length').focus();$('calibration-length').select();status('请填写两点之间已知的实际长度，并应用比例');}return;
  }
  if(tool==='axis'){
   const pos=axisPoint(p,e.shiftKey);
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
   const item={pathId:pathId||selected,index:Number(idx)},chosen=nodeSelection.some(n=>nodeKey(n)===nodeKey(item));
   if(e.shiftKey&&!side&&tool==='node'){selectNodes(chosen?nodeSelection.filter(n=>nodeKey(n)!==nodeKey(item)):[...nodeSelection,item],item);tapStart=null;render();return;}
   if(!chosen)selectNodes([item]);else{selected=item.pathId;ni=item.index;}
   checkpoint();drag=side?{kind:'handle',side,start:p,node:clone(selectedNode())}:{kind:'nodes',start:p,nodes:selectedNodes().map(({path,index})=>({pathId:path.id,index,node:clone(path.nodes[index])}))};render();return;
  }
  if(tool==='pen'){
   if(!currentLayer().visible||currentLayer().locked){status('当前图层已隐藏或锁定，请切换图层或解锁后画线');return;}
   let path=selectedPath();
   checkpoint();measurement=null;
   if(!drawing||!path||path.closed){path=makePath();attachPath(path);drawing=true;}
   const last=path.nodes.at(-1),pos=e.shiftKey&&last?snap(last,p):p;
   selectNodes([{pathId:path.id,index:G.append(path,pos,doc.newNodeMode)}]);drag={kind:'new',start:pos};changed();return;
  }
  const imageId=target.getAttribute('data-image');
  if(imageId&&tool==='select'){
   tapStart=null;if(e.shiftKey){selectElements(selection,imageSelection.includes(imageId)?imageSelection.filter(id=>id!==imageId):[...imageSelection,imageId]);render();return;}
   if(!imageSelection.includes(imageId))selectElements([],[imageId]);
   activeLayer=L.layerFor(doc,imageId,'image').id;checkpoint();drag={kind:'elements',start:p,bounds:L.bounds(doc,selection,imageSelection),base:snapshot().doc};render();return;
  }
  if((!pathId||tool==='node')&&selectionDragHit(p,target,e.shiftKey)){
   tapStart=null;checkpoint();
   drag=tool==='node'?{kind:'nodes',start:p,nodes:selectedNodes().map(({path,index})=>({pathId:path.id,index,node:clone(path.nodes[index])}))}:{kind:'elements',start:p,bounds:selectionBounds(),base:snapshot().doc};
   render();return;
  }
  if(pathId){
   if(e.shiftKey){togglePath(pathId);tapStart=null;render();return;}
   if(tool!=='select'||!selection.includes(pathId))selectPaths([pathId]);else{selected=pathId;ni=null;}
   if(tool==='select'){checkpoint();drag={kind:'elements',start:p,bounds:L.bounds(doc,selection,imageSelection),base:snapshot().doc};}
   render();return;
  }
  drag={kind:'marquee',start:p,current:p,screen:screenPoint(e),moved:false,add:e.shiftKey,paths:selection.slice(),images:imageSelection.slice(),nodes:clone(nodeSelection)};tapStart=null;render();
 });
 svg.addEventListener('pointermove',e=>{
  const p=point(e);$('coordinates').textContent=`X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)} px · ${doc.calibration?'已设置实际比例':'未设置实际比例'}`;
  if(!drag&&tool==='trace'&&!space){scheduleTrace(p);return;}
  if(!drag&&(tool==='axis'||tool==='calibrate'||(tool==='measure'&&measureMode==='points'))){hoverPoint=tool==='axis'?axisPoint(p,e.shiftKey):snapToNode(p);renderCanvas();}
  if(!drag){if(tool==='node'||tool==='select')svg.style.cursor=space?'grab':selectionDragHit(p,e.target,e.shiftKey)?'move':'default';return;}
  if(tapStart&&G.dist(tapStart,screenPoint(e))>4){tapStart=null;taps.reset();}
  if(drag.kind==='pan'){const s=screenPoint(e);camera.x=drag.camera.x+s.x-drag.screen.x;camera.y=drag.camera.y+s.y-drag.screen.y;renderCanvas();return;}
  if(drag.kind==='marquee'){
   drag.current=p;drag.moved ||= G.dist(drag.screen,screenPoint(e))>4;
   if(drag.moved){const rect=G.normalizeRect(drag.start,p);if(tool==='node')selectNodes([...(drag.add?drag.nodes:[]),...G.nodesInRect(editablePaths(),rect)]);else selectElements([...(drag.add?drag.paths:[]),...G.pathsInRect(editablePaths(),rect)],[...(drag.add?drag.images:[]),...doc.images.filter(i=>L.editable(doc,i.id,'image')&&i.x<=rect.x+rect.width&&i.x+i.width>=rect.x&&i.y<=rect.y+rect.height&&i.y+i.height>=rect.y).map(i=>i.id)]);}
   render();return;
  }
  if(drag.kind==='elements'||drag.kind==='resize'){
   const b=drag.bounds,target={...b},dx=p.x-drag.start.x,dy=p.y-drag.start.y;
   if(drag.kind==='elements'){const pos=e.shiftKey?snap(drag.start,p):p;target.x+=pos.x-drag.start.x;target.y+=pos.y-drag.start.y;}
   else{
    const east=drag.corner.includes('e'),south=drag.corner.includes('s'),vx=(east?1:-1)*b.width,vy=(south?1:-1)*b.height;
    const scale=Math.max(.001,1+(dx*vx+dy*vy)/(vx*vx+vy*vy));target.width=b.width*scale;target.height=b.height*scale;target.x=east?b.x:b.x+b.width-target.width;target.y=south?b.y:b.y+b.height-target.height;
   }
   const draft={...doc,paths:clone(drag.base.paths),images:drag.base.images.map(i=>({...i}))};
   try{L.transform(draft,selection,imageSelection,b,target);doc.paths=draft.paths;doc.images=draft.images;updateDirty();renderCanvas();renderTransform();renderHistory();}catch(err){status(err.message);}return;
  }
  const n=selectedNode(),path=selectedPath();if(!path)return;
  if(drag.kind==='new'&&G.dist(drag.start,p)>2/camera.z){const h=e.shiftKey?snap(n,p):p;n.out=G.point(h);n.in={x:2*n.x-h.x,y:2*n.y-h.y};}
  if(drag.kind==='nodes'){const pos=e.shiftKey?snap(drag.start,p):p;for(const item of drag.nodes){const target=doc.paths.find(path=>path.id===item.pathId);target.nodes[item.index]=clone(item.node);G.move(target.nodes[item.index],pos.x-drag.start.x,pos.y-drag.start.y);}}
  if(drag.kind==='handle'){path.nodes[ni]=clone(drag.node);G.handle(path.nodes[ni],drag.side,e.shiftKey?snap(n,p):p,e.altKey);}
  updateDirty();renderCanvas();renderHistory();
  const node=selectedNode();if(node){$('node-x').value=Number(node.x.toFixed(2));$('node-y').value=Number(node.y.toFixed(2));}
 });
 function endDrag(){if(!drag)return;if(drag.kind==='marquee'&&!drag.moved&&!drag.add)selectPaths([]);drag=null;edits.commit(snapshot());updateDirty();render();}
 svg.addEventListener('pointerup',e=>{
  capturedPointer=null;
  const started=tapStart;tapStart=null;endDrag();
  if(!started||G.dist(started,screenPoint(e))>4){taps.reset();return;}
  const hit=closestCurve(point(e));if(!hit){taps.reset();return;}
  if(taps.push({...screenPoint(e),time:e.timeStamp,key:hit.path.id}))insertAt(point(e));
 });
 svg.addEventListener('pointercancel',()=>{tapStart=null;taps.reset();endDrag();});svg.addEventListener('lostpointercapture',endDrag);
 svg.addEventListener('pointerleave',()=>{if(tool==='trace'&&!capturedPointer){clearTrace();tracePointer=null;}});
 svg.addEventListener('dblclick',e=>{
  if((tool!=='node'&&tool!=='select')||space||e.shiftKey||imageSelection.length||e.target.closest('[data-image],[data-corner]')||(!e.target.hasAttribute('data-path')&&selectionDragHit(point(e),e.target)))return;e.preventDefault();insertAt(point(e));taps.reset();
 });
 svg.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.0015),screenPoint(e));},{passive:false});
 tools.forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
 $('calibrate').onclick=()=>{setTool('calibrate');calibrationDraft=[];render();status('在图中点击两点，再填写已知实际距离');};
 $('calibration-cancel').onclick=()=>setTool('measure');$('calibration-apply').onclick=applyCalibration;
 $('calibration-clear').onclick=()=>{if(!doc.calibration)return;checkpoint();doc.calibration=null;calibrationDraft=null;setTool('measure');changed('比例已清除，测量恢复像素 px');};
 $('measure-unit').onchange=()=>{const unit=$('measure-unit').value;if(!doc.calibration||unit===doc.measureUnit)return;checkpoint();doc.measureUnit=unit;changed('测量单位已切换为 '+unit);};
 for(const id of ['calibration-length','calibration-unit'])$(id).addEventListener('keydown',e=>{
  if(tool!=='calibrate')return;if(e.key==='Enter'){e.preventDefault();e.stopPropagation();applyCalibration();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setTool('measure');}
 });
 $('draw-axis').onclick=()=>setTool('axis');$('mirror-copy').onclick=mirrorCopy;
 $('clear-axis').onclick=()=>{if(doc.mirrorAxis){checkpoint();doc.mirrorAxis=null;updateDirty();}axisStart=null;hoverPoint=null;render();};
 document.querySelectorAll('[data-measure]').forEach(b=>b.onclick=()=>{setTool('measure');measureMode=b.dataset.measure;measurement=null;render();});
 $('measure-clear').onclick=()=>{measurement=null;hoverPoint=null;render();};
 $('measure-finish').onclick=()=>{if(measurement?.kind==='points')measurement.finished=true;hoverPoint=null;render();};
 $('measure-alternate').onclick=()=>{if(measurement?.kind==='segments'){measurement.alternate=!measurement.alternate;render();}};
 $('add-path').onclick=()=>{setTool('pen');selectPaths([]);render();status('在画板上点击开始新曲线，按住拖动可画弧线');};
 $('finish').onclick=finish;
 $('close-path').onclick=()=>{const paths=selectedCurves().filter(p=>p.nodes.length>=3);if(!paths.length)return;checkpoint();measurement=null;const close=!paths.every(p=>p.closed);paths.forEach(p=>p.closed=close);drawing=false;changed();};
 function removeNode(){
  const nodes=selectedNodes();if(!nodes.length)return;checkpoint();measurement=null;
  for(const path of selectedCurves()){nodes.filter(item=>item.path===path).map(item=>item.index).sort((a,b)=>b-a).forEach(index=>path.nodes.splice(index,1));if(path.nodes.length<3)path.closed=false;}
  doc.paths=doc.paths.filter(p=>p.nodes.length);selectPaths(selection);drawing=false;changed('所选节点已删除，可撤销');
 }
 function smoothSelectedNodes(){
  const nodes=selectedNodes();if(!nodes.length)return;checkpoint();measurement=null;
  for(const path of selectedCurves())G.smoothNodes(path,nodes.filter(item=>item.path===path).map(item=>item.index));
  drawing=false;changed(`已顺滑 ${nodes.length} 个节点，节点位置保持不变，可撤销`);
 }
 $('delete-node').onclick=removeNode;
 function removePaths(){
  const paths=selectedCurves();if(!paths.length)return;blurEditor();checkpoint();measurement=null;
  const ids=new Set(paths.map(p=>p.id));doc.paths=doc.paths.filter(p=>!ids.has(p.id));
  selectPaths([]);drawing=false;changed(`已删除 ${paths.length} 条曲线，可撤销`);
 }
 $('delete-path').onclick=removePaths;
 $('straight').onclick=()=>{const nodes=selectedNodes();if(!nodes.length)return;checkpoint();for(const {path,index} of nodes){const n=path.nodes[index];n.in=G.point(n);n.out=G.point(n);n.mode='cusp';}changed();};
 modes.forEach(b=>b.onclick=()=>{
  checkpoint();doc.newNodeMode=b.dataset.mode;
  for(const {path,index} of selectedNodes())G.setMode(path,index,b.dataset.mode);
  changed(`已记住${b.textContent}类型，接下来新建的节点会沿用`);
 });
 for(const axis of ['x','y'])$('node-'+axis).onchange=()=>{const n=selectedNode(),v=Number($('node-'+axis).value);if(!n||!Number.isFinite(v))return;checkpoint();const delta=v-n[axis];for(const {path,index} of selectedNodes())G.move(path.nodes[index],axis==='x'?delta:0,axis==='y'?delta:0);changed();};
 function beginField(id){if(editingField!==id){checkpoint();editingField=id;}}
 for(const [id,key] of [['path-name','name'],['path-role','role'],['path-color','color'],['path-note','note']])$(id)[key==='role'?'onchange':'oninput']=()=>{
  const paths=selectedCurves();if(!paths.length||((key==='name'||key==='note')&&paths.length>1))return;
  if(key==='role')checkpoint();else beginField(id);
  for(const p of paths)p[key]=$(id).value||(key==='name'?'未命名曲线':'');changed();
 };
 $('path-dashed').onchange=()=>{const paths=selectedCurves();if(!paths.length)return;checkpoint();paths.forEach(p=>p.dashed=$('path-dashed').checked);changed('曲线显示样式已更新，可撤销');};
 $('opacity').oninput=()=>{beginField('opacity');const images=selectedImages(),value=Number($('opacity').value)/100;if(images.length)images.forEach(i=>i.opacity=value);else doc.opacity=value;updateDirty();$('opacity-value').textContent=`${$('opacity').value}%`;renderCanvas();renderHistory();};
 for(const id of ['path-name','path-color','path-note','opacity']){
  const end=()=>{if(editingField===id){commitEdit();render();}};
  $(id).addEventListener('change',end);$(id).addEventListener('blur',end);
 }
 $('show-grid').onchange=renderCanvas;$('show-original').onchange=renderCanvas;
 $('zoom-in').onclick=()=>zoom(1.25);$('zoom-out').onclick=()=>zoom(.8);$('fit').onclick=fit;
 function history(back){
  if(replay)return;
  endDrag();commitEdit();const s=back?edits.undo(snapshot()):edits.redo(snapshot());if(!s){renderHistory();return;}
  applySnapshot(s);
  changed(`${back?'已撤销':'已重做'} · 可撤销 ${edits.undoCount} 步 · 可重做 ${edits.redoCount} 步`);
 }
 $('undo').onclick=()=>history(true);$('redo').onclick=()=>history(false);
 window.addEventListener('keydown',e=>{
  if(saveAsDialog.open){if((e.metaKey||e.ctrlKey)&&['s','z','y','a'].includes(e.key.toLowerCase())&&!/INPUT|TEXTAREA/.test(e.target.tagName))e.preventDefault();else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s')e.preventDefault();return;}
  if(offsetDialog.open){if((e.metaKey||e.ctrlKey)&&['s','z','y','a'].includes(e.key.toLowerCase())&&!/INPUT|TEXTAREA/.test(e.target.tagName))e.preventDefault();return;}
  if(replay){if(e.key==='Escape'){e.preventDefault();stopReplay();}else if(!e.target.closest?.('#panel-history'))e.preventDefault();return;}
  if(!menu.hidden){if(e.key==='Escape'){e.preventDefault();hideMenu();}return;}
  const mod=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
  if(mod&&key==='s'){e.preventDefault();if(e.shiftKey)openSaveAs();else save();return;}
  if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  if(e.target.closest('button,summary')&&(e.code==='Space'||key==='enter'))return;
  if(mod&&key==='a'){e.preventDefault();selectAll();return;}
  if(mod&&key==='z'){e.preventDefault();history(!e.shiftKey);return;}
  if(mod&&key==='y'){e.preventDefault();history(false);return;}
  if(e.code==='Space'){e.preventDefault();space=true;renderCanvas();return;}
  if(key==='escape'||key==='enter'){
   if(tool==='trace'){e.preventDefault();if(key==='enter'&&tracePreview)createTrace(tracePreview.p);else setTool('node');return;}
   if(tool==='calibrate'){e.preventDefault();if(key==='enter')applyCalibration();else setTool('measure');return;}
   e.preventDefault();if(tool==='axis'){axisStart=null;setTool('node');return;}
   if(tool==='measure'){if(measurement?.kind==='points')measurement.finished=true;hoverPoint=null;render();return;}
   if(key==='escape'&&['node','select'].includes(tool)){
    if(drag?.kind==='marquee')drag=null;else endDrag();tapStart=null;taps.reset();
    if(capturedPointer!==null&&svg.hasPointerCapture(capturedPointer))svg.releasePointerCapture(capturedPointer);capturedPointer=null;
    selectPaths([]);render();return;
   }
   finish();return;
  }
  if(tool==='measure'&&(key==='delete'||key==='backspace')){e.preventDefault();if(measurement?.kind==='points'){measurement.points.pop();measurement.finished=false;}else measurement=null;render();return;}
  if(tool==='axis'&&(key==='delete'||key==='backspace')){e.preventDefault();$('clear-axis').click();return;}
  if(tool==='calibrate'&&(key==='delete'||key==='backspace')){e.preventDefault();calibrationDraft?.pop();render();return;}
  if(key==='delete'||key==='backspace'){e.preventDefault();if(tool==='select')deleteElements();else removeNode();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&(tool==='select'?selection.length+imageSelection.length:selectedNodes().length)&&!['measure','axis','calibrate'].includes(tool)){
   e.preventDefault();checkpoint();const d=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0,dy=e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0;
   if(tool==='select'){const b=L.bounds(doc,selection,imageSelection);try{L.transform(doc,selection,imageSelection,b,{...b,x:b.x+dx,y:b.y+dy});}catch(err){status(err.message);return;}}else for(const {path,index} of selectedNodes())G.move(path.nodes[index],dx,dy);changed();return;
  }
  const shortcuts={v:'select',f10:'node',b:'pen',h:'pan',a:'axis',m:'measure',t:'trace'};if(shortcuts[key]&&!mod){e.preventDefault();setTool(shortcuts[key]);}
 });
 window.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;renderCanvas();}});
 window.addEventListener('blur',()=>{space=false;endDrag();});
 window.addEventListener('beforeunload',e=>{writeRefreshJournal();writeSession();if(dirty){e.preventDefault();e.returnValue='';}});
 $('new').onclick=()=>{if(dirty&&!confirm('当前修改还未保存，仍要新建空白画板吗？'))return;checkpoint();doc=empty();resetAuxiliary();selectPaths([]);drawing=false;tool='pen';markClean();render();fit();status('无限画布已就绪；也可以先导入底图');};
 $('import').onclick=()=>$('image-file').click();$('open').onclick=()=>$('project-file').click();
 const readData=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('图片读取失败'));r.readAsDataURL(f);});
 async function importImage(f,position=null,pasted=false){
  if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type))throw new Error('请使用 PNG、JPG 或 WebP 图片');
  if(f.size>18*1024*1024)throw new Error('图片超过18MB，请缩小后导入');
  const dataUrl=await readData(f),image=new Image();image.src=dataUrl;await image.decode();
  if(!image.naturalWidth||image.naturalWidth>30000||image.naturalHeight>30000)throw new Error('图片尺寸过大或无效');
  if(replay)stopReplay();
  if(new Blob([JSON.stringify(doc)]).size+dataUrl.length>32*1024*1024-4096)throw new Error('作品中的图片总量过大，请缩小图片后导入');
  const r=svg.getBoundingClientRect(),center=position||{x:(r.width/2-camera.x)/camera.z,y:(r.height/2-camera.y)/camera.z};
  const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[f.type],name=f.name?.trim()||`${pasted?'粘贴图片':'导入图片'}.${extension}`;
  checkpoint();const layer=L.addImage(doc,{name,dataUrl,x:center.x-image.naturalWidth/2,y:center.y-image.naturalHeight/2,width:image.naturalWidth,height:image.naturalHeight,opacity:1});
  activeLayer=layer.id;selectElements([],layer.imageIds);setTool('select');changed(`图片已${pasted?'粘贴到':'导入'}新图层；拖动可移动，拖角可缩放，原有画板保留`);fit();
 }
 $('image-file').onchange=async e=>{try{await importImage(e.target.files[0]);}catch(err){status(err.message);}e.target.value='';};
 svg.addEventListener('dragover',e=>{e.preventDefault();});svg.addEventListener('drop',async e=>{e.preventDefault();try{await importImage(e.dataTransfer.files[0],point(e));}catch(err){status(err.message);}});
 document.addEventListener('paste',async e=>{
  if(e.defaultPrevented||saveAsDialog.open||offsetDialog.open||e.target.closest?.('input,textarea,select')||e.target.isContentEditable)return;
  const data=e.clipboardData;
  const file=[...(data?.files||[])].find(f=>f.type.startsWith('image/'))||[...(data?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).find(Boolean);
  if(!file)return;
  e.preventDefault();try{await importImage(file,null,true);}catch(err){status(`粘贴失败：${err.message}`);}
 });
 function validate(raw){
  if(raw?.format!=='daban-curve-editor'||raw.version!==1||raw.units!=='image-px')throw new Error('这不是通用矢量图编辑器保存的修改文件');
  for(const k of ['width','height'])if(!Number.isFinite(raw[k])||raw[k]<1||raw[k]>30000)throw new Error('画板尺寸无效');
  if(!Array.isArray(raw.paths)||raw.paths.length>500)throw new Error('曲线数量无效');
  if(raw.image&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(raw.image.dataUrl)||typeof raw.image.name!=='string'))throw new Error('底图格式无效');
  const ids=new Set();
  const cleanPaths=(paths,unique)=>paths.map(p=>{
   if(typeof p.id!=='string'||(unique&&ids.has(p.id))||!Array.isArray(p.nodes)||p.nodes.length>10000)throw new Error('节点数据无效');ids.add(p.id);
   const nodes=p.nodes.map(n=>{for(const v of [n,n.in,n.out])if(!v||!Number.isFinite(v.x)||!Number.isFinite(v.y)||Math.abs(v.x)>1e7||Math.abs(v.y)>1e7)throw new Error('节点坐标无效');return {...G.node(n.x,n.y),in:G.point(n.in),out:G.point(n.out),mode:['cusp','smooth','symmetric'].includes(n.mode)?n.mode:'cusp'};});
   if(p.dashed!==undefined&&typeof p.dashed!=='boolean')throw new Error('虚线样式无效');
   return {id:p.id,name:String(p.name||'曲线').slice(0,80),note:String(p.note||''),role:['outline','seam','cut','note'].includes(p.role)?p.role:'outline',color:/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#e04544',closed:!!p.closed&&nodes.length>=3,nodes,...(p.dashed!==undefined?{dashed:p.dashed}:{})};
  });
  const d=empty();Object.assign(d,{title:String(raw.title||'修改文件').slice(0,200),width:raw.width,height:raw.height,newNodeMode:['cusp','smooth','symmetric'].includes(raw.newNodeMode)?raw.newNodeMode:'cusp',opacity:Number.isFinite(raw.opacity)?Math.max(0,Math.min(1,raw.opacity)):.65,image:raw.image?{name:raw.image.name,dataUrl:raw.image.dataUrl,width:raw.width,height:raw.height}:null,paths:cleanPaths(raw.paths,true)});
  if(raw.mirrorAxis!=null){
   const axis=raw.mirrorAxis;for(const p of [axis.a,axis.b])if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e7||Math.abs(p.y)>1e7)throw new Error('对称轴坐标无效');
   if(G.dist(axis.a,axis.b)<1e-6)throw new Error('对称轴两点不能重合');d.mirrorAxis={a:G.point(axis.a),b:G.point(axis.b)};
  }
  if(raw.calibration!=null){G.millimetersPerPixel(raw.calibration);d.calibration={a:G.point(raw.calibration.a),b:G.point(raw.calibration.b),length:raw.calibration.length,unit:raw.calibration.unit};}
  if(raw.measureUnit!==undefined&&!['mm','cm'].includes(raw.measureUnit))throw new Error('测量单位无效');
  d.measureUnit=raw.measureUnit||'mm';
  d.originals=cleanPaths(Array.isArray(raw.originals)?raw.originals.slice(0,500):raw.paths,false);
  delete d.layers;delete d.images;if(raw.layers!==undefined)d.layers=clone(raw.layers);if(raw.images!==undefined)d.images=clone(raw.images);return L.normalize(d);
 }
 function readProjectState(state,document){
  if(!state||!['node','select','pen','pan','axis','measure','calibrate','trace'].includes(state.tool)||typeof state.drawing!=='boolean'||![state.selection,state.imageSelection,state.nodeSelection].every(Array.isArray))throw new Error('操作记录中的编辑状态无效');
  if(!document&&state.doc?.operationHistory!==undefined)throw new Error('操作记录不能嵌套');
  const d=document||validate(state.doc),paths=state.selection.filter(id=>typeof id==='string'&&L.editable(d,id)),images=state.imageSelection.filter(id=>typeof id==='string'&&L.editable(d,id,'image'));
  const selected=paths.includes(state.selected)?state.selected:paths.at(-1)||null,path=d.paths.find(p=>p.id===selected);
  return {doc:d,selection:[...new Set(paths)],imageSelection:[...new Set(images)],selected,ni:Number.isInteger(state.ni)&&state.ni>=0&&path?.nodes[state.ni]?state.ni:null,
   activeLayer:d.layers.some(l=>l.id===state.activeLayer)?state.activeLayer:d.layers.at(-1).id,
   nodeSelection:state.nodeSelection.filter(n=>n&&L.editable(d,n.pathId)&&Number.isInteger(n.index)&&n.index>=0&&d.paths.find(p=>p.id===n.pathId)?.nodes[n.index]).map(n=>({pathId:n.pathId,index:n.index})),tool:state.tool,drawing:state.drawing&&state.tool==='pen'&&!!path&&!path.closed};
 }
 function readProject(raw){
  const d=validate(raw);if(raw.operationHistory===undefined)return {doc:d};
  const data=window.CurveInteractions.unpackSession(raw.operationHistory);
  // Validate everything before replacing either the canvas or its undo stack.
  const check=window.CurveInteractions.createHistory();check.restore(data.history);
  const history={...data.history,past:data.history.past.map(s=>readProjectState(s)),future:data.history.future.map(s=>readProjectState(s))};
  return {doc:d,current:readProjectState(data.current,d),history};
 }
 function openProject(raw,record=true){
  const data=readProject(raw);if(replay)stopReplay();
  if(data.history){editingField=null;edits.restore(data.history);applySnapshot(data.current);}
  else{if(record)checkpoint();else edits.clear();doc=data.doc;activeLayer=doc.layers.at(-1).id;resetAuxiliary();selectPaths(editablePaths().length?[editablePaths()[0].id]:[]);tool='node';drawing=false;}
  markClean();render();fit();
 }
 $('project-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>MAX_PROJECT_FILE)throw new Error('修改文件超过 256MB');const raw=JSON.parse(await f.text());validate(raw);if(dirty&&!confirm('当前修改未保存，仍要打开另一份修改吗？'))return;openProject(raw);status(`已打开 ${f.name}`);}catch(err){status('打开失败：'+err.message);}finally{e.target.value='';}};
 function download(data,type,name){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function svgExport(){const bounds=L.contentBounds(doc,false),paths=doc.layers.filter(l=>l.visible).flatMap(l=>doc.paths.filter(p=>l.pathIds.includes(p.id))).map(p=>`<path d="${G.pathD(p)}" fill="none" stroke="${p.color}" stroke-width="2"${p.dashed?' stroke-dasharray="8 6"':''} data-role="${p.role}"><title>${esc(p.name)}</title><desc>${esc(p.note)}</desc></path>`).join('\n');const scale=doc.calibration?`按用户两点标定，1 px = ${G.millimetersPerPixel(doc.calibration)} mm`:'未标定毫米';return `<svg xmlns="${NS}" width="${bounds.width}px" height="${bounds.height}px" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><title>${esc(doc.title)}</title><desc>图像像素坐标；${scale}；修改建议，非直接生产切割稿。</desc>${paths}</svg>`;}
 $('export').onclick=()=>{download(svgExport(),'image/svg+xml',`${doc.title}.svg`);status('已导出可编辑曲线 SVG（像素坐标，不含底图与手柄）');};
 async function save(){
  if(saveBusy||replay)return;blurEditor();
  saveBusy=true;$('save').disabled=true;
  const payload=clone(doc);payload.savedAt=new Date().toISOString();payload.paths=payload.paths.filter(p=>p.nodes.length);L.prune(payload);const stamp=JSON.stringify(doc);
  try{
   const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   if(!response.ok)throw new Error(await response.text());const result=await response.json();
   lastSaved=result.filename;if(JSON.stringify(doc)===stamp)markClean();status(`已保存 ${result.filename}。回聊天说“按最新保存的曲线改”即可`);
  }catch(err){download(JSON.stringify(payload,null,2),'application/json',`${doc.title}.json`);status('本机保存服务不可用，已改为下载修改文件；请保留并发给 AI');}
  finally{saveBusy=false;$('save').disabled=false;}
 }
 $('save').onclick=save;
 function openSaveAs(){
  if(saveBusy||replay||offsetDialog.open)return;blurEditor();endDrag();commitEdit();
  $('save-as-name').value=`${doc.title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')||'未命名修改'}.json`;
  $('save-as-error').textContent='';saveAsDialog.showModal();$('save-as-name').focus();$('save-as-name').select();
 }
 function saveAs(e){
  e.preventDefault();if(saveBusy||replay)return;
  saveBusy=true;$('save').disabled=true;$('save-as').disabled=true;
  try{
   let name=$('save-as-name').value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');if(!name)throw new Error('请输入文件名');if(!/\.json$/i.test(name))name+='.json';
   const current=snapshot(),{doc:currentDoc,...editorState}=current;
   const payload={...currentDoc,savedAt:new Date().toISOString(),operationHistory:window.CurveInteractions.packSession({current:editorState,history:edits.serialize(current)})};
   const text=JSON.stringify(payload);
   if(new Blob([text]).size>MAX_PROJECT_FILE)throw new Error('作品与记录超过 256MB，暂时无法另存；可用“保存给 AI”保存当前作品');
   download(text,'application/json',name);markClean();saveAsDialog.close();status(`已开始下载 ${name}（含操作记录），请在浏览器下载列表查看`);
  }catch(err){$('save-as-error').textContent='另存为失败：'+err.message;status('另存为失败：'+err.message);}
  finally{saveBusy=false;$('save').disabled=false;$('save-as').disabled=false;renderHistory();}
 }
 $('save-as').onclick=openSaveAs;$('save-as-form').onsubmit=saveAs;
 $('save-as-cancel').onclick=()=>{saveAsDialog.close();status('已取消另存为');};
 saveAsDialog.addEventListener('cancel',()=>status('已取消另存为'));
 let canvasSize=null;
 new ResizeObserver(()=>{
  const {width,height}=svg.getBoundingClientRect();
  if(doc&&canvasSize){camera.x+=(width-canvasSize.width)/2;camera.y+=(height-canvasSize.height)/2;renderCanvas();}
  canvasSize={width,height};
 }).observe(svg.parentElement);
 demo();
 async function restoreSession(){
  const startingRevision=edits.revision;
  const get=async url=>{try{const r=await fetch(url);return r.ok?await r.json():null;}catch{return null;}};
  const [health,latest]=await Promise.all([get('/api/health'),get('/api/latest')]);let stored=null;
  try{
   if(typeof health?.project!=='string'||typeof health?.saves!=='string')throw new Error('项目身份不可用');
   sessionKey=JSON.stringify([health.project,health.saves]);
   sessionDB=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('curve-editor-sessions',2);
    request.onupgradeneeded=()=>{
     if(!request.result.objectStoreNames.contains('projects'))request.result.createObjectStore('projects');
     if(!request.result.objectStoreNames.contains('assets'))request.result.createObjectStore('assets').createIndex('project','project');
    };
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('记录存储被占用'));
   });
   stored=await new Promise((resolve,reject)=>{const request=sessionDB.transaction('projects').objectStore('projects').get(sessionKey);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   try{const journal=JSON.parse(localStorage.getItem(journalKey()));if(journal){stored=await readSessionAssets(journal);journalToken=journal.journalId;}else if(stored)stored=await readSessionAssets(stored);}catch{if(stored)stored=await readSessionAssets(stored);}
  }catch{storageStatus('unavailable','本机记录不可用，无法保证刷新恢复；请保存作品');}
  if(!dirty&&edits.revision===startingRevision&&!edits.hasChanges(snapshot())){
   let restored=false;
   if(stored)try{
    const data=window.CurveInteractions.unpackSession(stored),states=[data.current,...data.history.past,...data.history.future];
    for(const s of states){
     validate(s.doc);
     if(!['node','select','pen','pan','axis','measure','calibrate','trace'].includes(s.tool)||![s.selection,s.imageSelection,s.nodeSelection].every(Array.isArray))throw new Error('编辑状态无效');
    }
    if(data.cleanDoc)validate(data.cleanDoc);
    if(!data.camera||!Number.isFinite(data.camera.x)||!Number.isFinite(data.camera.y)||!Number.isFinite(data.camera.z)||data.camera.z<.000001||data.camera.z>16)throw new Error('视图无效');
    edits.restore(data.history);applySnapshot(data.current);cleanDoc=data.cleanDoc;camera=data.camera;updateDirty();render();restored=true;status('已恢复当前作品和操作记录，可继续编辑或重放');
   }catch{status('本机操作记录无法读取，已尝试恢复最新保存的作品');}
   if(!restored&&latest)try{openProject(latest,false);status('已恢复上次保存的修改。所有文件都留在本机');}catch{}
  }
  // Other open pages may still use older image keys; retain them in local cache.
  sessionBooting=false;if(sessionDB)scheduleSession();
 }
 restoreSession();
})();
