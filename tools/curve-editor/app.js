(() => {
 'use strict';
 const D=window.CurveDimension,G=window.CurveGeometry,L=window.CurveLayers,S=window.CurveSymmetry,T=window.CurveText,O=window.CurveOffset,F=window.CurveFairing,N=window.CurveNotches,$=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
 const clone=o=>JSON.parse(JSON.stringify(o)), uid=()=>crypto.randomUUID();
 const composing=e=>e.isComposing||e.keyCode===229;
 // Portable copies carry up to 100 snapshots; the AI save service keeps its own smaller limit.
 const MAX_PROJECT_FILE=256*1024*1024;
 const MAX_ZOOM=256; // 25600%; use the same limit for navigation and session recovery.
 const svg=$('canvas'),view=$('viewport');
 let doc,selected=null,ni=null,selection=[],nodeSelection=[],segmentSelection=null,tool='node',drawing=false,drawingEnd=null,drag=null,space=false,ctrlPan=false,suspendedDrag=null,pointerScreen=null;
 let imageSelection=[],textSelection=[],layerSelection=[],activeLayer=null;
 let rotationPivot=null; // Editor state only: never part of exported artwork.
 const expandedElementLayers=new Set();
 let vectorFiles,printing,imageRegion;
 let positionLabelDocument=null,positionLabelBaseline=null;
 let textDraft=null;const textDialog=$('text-dialog');
 let curveClipboard=null;
 let draggedLayer=null,draggedCurve=null,draggedElements=null;
 let camera={x:0,y:0,z:1},dirty=false,lastSaved='',saveBusy=false,editingField=null,cleanDoc=null;
 const taps=window.CurveInteractions.createTapTracker(),menu=$('context-menu');
 let tapStart=null,capturedPointer=null,pendingConnection=null,lastFittingNodeTap=null;
 let dimensionStart=null,dimensionStartBinding=null,dimensionDocument=null,dimensionBaseline=null,axisStart=null,hoverPoint=null,axisSelected=false,mirrorPreviewActive=false,measurement=null,measureMode='points',calibrationDraft=null;
 let symmetryDraft=null;
 let replay=null,sessionDB=null,sessionKey=null,sessionTimer=null,sessionBooting=true,sessionGeneration=0,historyRevision=-1,historyListKey='';
 const sessionAssets=new Map(),committedAssets=new Set();
 let journalToken=null;
 const sessionWriter=uid();
 let sessionRevision=null,sessionRecoveryBase=null,sessionBaseDoc=null,sessionBaseHistoryRevision=0,sessionBaseSaved='';
 let journalStorageKey=null;
 let workspace=null,workspaceClean=false,lastArtworkEditAt=0;
 let tracePreview=null,tracePointer=null,traceTimer=null,traceRequest=0,traceWorker=null,traceWorkerAsset=null;
 let offsetDraft=null,offsetTimer=null,offsetComparisonGeneration=0;
 const offsetDialog=$('offset-dialog'),saveAsDialog=$('save-as-dialog');
 const offsetPreview=el('g',{id:'offset-preview','pointer-events':'none'},view);
 let simplifyDraft=null,simplifyTimer=null,simplifyBlockedRegions=[];
 const simplifyDialog=$('simplify-dialog'),simplifyPreview=el('g',{id:'simplify-preview','pointer-events':'none'},view);
 let fairingDraft=null,fairingTimer=null,fairingBlockedRegions=[];
 const fairingDialog=$('fairing-dialog'),fairingPreview=el('g',{id:'fairing-preview','pointer-events':'none'},view);
 const shapePreview=el('g',{id:'shape-preview','pointer-events':'none'},view);
 const nodeAlignment=el('g',{id:'node-alignment','pointer-events':'none'},view);
 const curveRelation=el('g',{id:'curve-relation','pointer-events':'none'},view);
 const mirrorPreview=el('g',{id:'mirror-preview','pointer-events':'none'},view);
 const axisControls=el('g',{id:'axis-controls'},view);
 view.insertBefore(axisControls,$('handles'));
 const rotationCenterOverlay=el('g',{id:'rotation-center-overlay'},view);
 // Node editing takes priority at coincident points; V exposes the pivot there.
 view.insertBefore(rotationCenterOverlay,$('handles'));
 let fittingMutationDepth=0;
 function fittingMutation(fn){fittingMutationDepth++;try{return fn();}finally{fittingMutationDepth--;}}
 const fitting=window.CurveFitting.create({G,L,svg,view,getDoc:()=>doc,getCamera:()=>camera,getSelection:()=>selection.slice(),getNodeSelection:()=>clone(nodeSelection),getHistoryRevision:()=>edits.revision,getTool:()=>tool,getNativeGesture:()=>!!drag||drawing,onHistoryChange:()=>renderHistory(),onPickRange:()=>{setTool('node');status('先点要弯的曲线显示方点，再框选连续几个点，或按 Shift 加选；选好后点左侧“局部拟合”。');},onBegin:()=>checkpoint(),onDraft:()=>fittingMutation(()=>{updateDirty();renderCanvas();renderHistory();}),onCommit:message=>fittingMutation(()=>changed(message)),onRender:()=>render(),status:s=>status(s),lengthText:n=>lengthText(n)});
 $('fit-curves').onclick=()=>{if(fitting.active){fitting.stop();render();return;}blurEditor();endDrag();setTool('node');fitting.start();showPanel('fitting',true);render();$('panel-fitting').scrollIntoView({block:'start'});};
 const NODE_SNAP_RADIUS=3; // Screen pixels: zooming in makes the physical tolerance smaller.
 const traceRasters=new Map(),traceJobs=new Map();
 // Keep the old recovery slot intact: pages loaded before this upgrade may
 // still write it on unload, but cannot replace a new synchronized session.
 const sessionRecordKey=()=>`${sessionKey}:sync-v1`;
 const journalKey=()=>`curve-editor-refresh:${sessionRecordKey()}`;
 const sessionHeadKey=()=>`curve-editor-head:${sessionRecordKey()}`;
 const tools=[...document.querySelectorAll('[data-tool]')], modes=[...document.querySelectorAll('[data-mode]')];
 const layout=$('editor-layout'),panels=[...document.querySelectorAll('[data-panel]')],layoutKey='curve-editor-layout-v1';
 let panelWidth=null,toolsWidth=null,panelHeights={},layoutResize=null;
 let panelScroll={dock:0,groups:{}},layoutScrollReady=false,draggedPanel=null;
 const panelContent=$('panel-content'),panelRail=$('panel-rail');
 const panelOrder=()=>[...panelContent.children].filter(p=>p.matches('.panel-group')).map(p=>p.dataset.panel);
 function capturePanelScroll(){
  if(!layoutScrollReady||layout.classList.contains('panels-collapsed'))return;
  panelScroll.dock=panelContent.scrollTop;
  for(const panel of panels)if(panel.open)panelScroll.groups[panel.dataset.panel]=panel.querySelector('.panel-body').scrollTop;
 }
 function applyPanelScroll(){
  if(layout.classList.contains('panels-collapsed'))return;
  for(const panel of panels)if(panel.open)panel.querySelector('.panel-body').scrollTop=panelScroll.groups[panel.dataset.panel]||0;
  panelContent.scrollTop=panelScroll.dock;
 }
 function applyPanelOrder(keys){
  capturePanelScroll();
  const byKey=new Map(panels.map(p=>[p.dataset.panel,p]));
  for(const key of new Set([...keys,...byKey.keys()]))if(byKey.has(key))panelContent.append(byKey.get(key));
  for(const key of panelOrder()){const button=panelRail.querySelector(`[data-panel-target="${key}"]`);if(button)panelRail.append(button);}
  if(layoutScrollReady)applyPanelScroll();
 }
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 const widthHandle=$('resize-panels'),toolsHandle=$('resize-tools'),toolDock=$('tool-dock');
 function toolsWidthLimit(){return Math.max(68,Math.min(200,innerWidth-(innerWidth>680?480:240)));}
 function toolsWidthMinimum(){
  const rows=Math.max(1,Math.floor((innerHeight-40)/48));
  return Math.min(toolsWidthLimit(),(tools.length+1)>rows?132:68);
 }
 function applyToolsWidth(){
  const collapsed=layout.classList.contains('tools-collapsed'),width=collapsed?40:clamp(toolsWidth??76,toolsWidthMinimum(),toolsWidthLimit());
  const columns=!collapsed&&width>=132?2:1,rows=Math.ceil((tools.length+1)/columns),height=Math.min(collapsed?28:44,(innerHeight-44-(rows-1)*4)/rows);
  layout.style.setProperty('--tools-width',`${width}px`);toolDock.style.setProperty('--tool-columns',columns);toolDock.style.setProperty('--tool-height',`${Math.max(20,height)}px`);
  toolsHandle.setAttribute('aria-valuemin',String(toolsWidthMinimum()));toolsHandle.setAttribute('aria-valuemax',String(toolsWidthLimit()));toolsHandle.setAttribute('aria-valuenow',String(Math.round(width)));
 }
 function panelWidthLimit(){return Math.max(240,Math.min(560,layout.getBoundingClientRect().width-parseFloat(getComputedStyle(layout).getPropertyValue('--tools-width'))-240));}
 function applyPanelWidth(){
  if(panelWidth===null)layout.style.removeProperty('--panels-preferred-width');
  else layout.style.setProperty('--panels-preferred-width',`${clamp(panelWidth,240,panelWidthLimit())}px`);
  widthHandle.setAttribute('aria-valuemin','240');widthHandle.setAttribute('aria-valuemax',String(panelWidthLimit()));
  if(widthHandle.getClientRects().length)widthHandle.setAttribute('aria-valuenow',String(Math.round($('panel-dock').getBoundingClientRect().width)));
 }
 function persistLayout(){
  try{localStorage.setItem(layoutKey,JSON.stringify({toolsCollapsed:layout.classList.contains('tools-collapsed'),panelsCollapsed:layout.classList.contains('panels-collapsed'),groups:Object.fromEntries(panels.map(p=>[p.dataset.panel,p.open])),toolsWidth,panelWidth,panelHeights,panelOrder:panelOrder(),panelScroll}));}catch{}
 }
 function syncLayout(){
  const toolsCollapsed=layout.classList.contains('tools-collapsed'),panelsCollapsed=layout.classList.contains('panels-collapsed');
  for(const [id,collapsed,label] of [['toggle-tools',toolsCollapsed,'工具栏'],['toggle-panels',panelsCollapsed,'功能面板']]){
   const button=$(id),title=`${collapsed?'展开':'收起'}${label}`;button.setAttribute('aria-expanded',String(!collapsed));button.setAttribute('aria-label',title);button.title=title;
  }
  $('panel-content').hidden=panelsCollapsed;$('panel-rail').hidden=!panelsCollapsed;
  if(!panelsCollapsed&&layoutScrollReady)applyPanelScroll();
  applyToolsWidth();applyPanelWidth();
 }
 function showPanel(key,revealDock=false,scroll=true){
  const panel=panels.find(p=>p.dataset.panel===key);if(!panel)return;
  const wasClosed=!panel.open;
  panel.open=true;
  if(revealDock){layout.classList.remove('panels-collapsed');syncLayout();panel.querySelector('summary').focus({preventScroll:true});}
  if(scroll&&!layout.classList.contains('panels-collapsed')&&(wasClosed||revealDock))panel.scrollIntoView({block:'nearest'});
  persistLayout();
 }
 try{
  const saved=JSON.parse(localStorage.getItem(layoutKey));
  if(saved&&typeof saved==='object'){
   layout.classList.toggle('tools-collapsed',saved.toolsCollapsed===true);layout.classList.toggle('panels-collapsed',saved.panelsCollapsed===true);
   for(const panel of panels)if(typeof saved.groups?.[panel.dataset.panel]==='boolean')panel.open=saved.groups[panel.dataset.panel];
   if(Number.isFinite(saved.panelWidth)&&saved.panelWidth>0)panelWidth=clamp(saved.panelWidth,240,560);
   if(Number.isFinite(saved.toolsWidth)&&saved.toolsWidth>0)toolsWidth=clamp(saved.toolsWidth,68,200);
   for(const panel of panels){const height=saved.panelHeights?.[panel.dataset.panel];if(Number.isFinite(height)&&height>=96)panelHeights[panel.dataset.panel]=clamp(height,96,1200);}
   if(Array.isArray(saved.panelOrder))applyPanelOrder(saved.panelOrder);
   if(Number.isFinite(saved.panelScroll?.dock)&&saved.panelScroll.dock>=0)panelScroll.dock=Math.min(saved.panelScroll.dock,10000000);
   for(const panel of panels){const top=saved.panelScroll?.groups?.[panel.dataset.panel];if(Number.isFinite(top)&&top>=0)panelScroll.groups[panel.dataset.panel]=Math.min(top,10000000);}
  }
 }catch{}
 syncLayout();
 for(const panel of panels)panel.addEventListener('toggle',persistLayout);
 $('toggle-tools').onclick=()=>{layout.classList.toggle('tools-collapsed');syncLayout();persistLayout();};
 $('toggle-panels').onclick=()=>{layout.classList.toggle('panels-collapsed');syncLayout();persistLayout();};
 document.querySelectorAll('[data-panel-target]').forEach(button=>button.onclick=()=>showPanel(button.dataset.panelTarget,true));
 panelContent.addEventListener('scroll',()=>{if(!layoutScrollReady||layout.classList.contains('panels-collapsed'))return;panelScroll.dock=panelContent.scrollTop;persistLayout();});
 function clearPanelDropMarks(){for(const panel of panels)panel.classList.remove('panel-dragging','panel-drop-before','panel-drop-after');}
 function movePanel(source,target,before){
  if(source===target)return;const order=panelOrder().filter(key=>key!==source),index=order.indexOf(target);
  if(index<0)return;order.splice(index+(before?0:1),0,source);applyPanelOrder(order);persistLayout();
 }
 // Panel dimensions are browser preferences and never enter document/history snapshots.
 function endLayoutResize(cancel=false){
  const gesture=layoutResize;if(!gesture)return;layoutResize=null;
  if(cancel)gesture.restore();
  gesture.handle.classList.remove('layout-resize-active');document.body.classList.remove('layout-resizing');
  document.body.style.removeProperty('--layout-resize-cursor');
  if(gesture.handle.hasPointerCapture(gesture.pointerId))gesture.handle.releasePointerCapture(gesture.pointerId);
  persistLayout();
 }
 function bindLayoutResize(handle,{axis,sign=1,read,write,setting,restore,reset,min,max,enabled=()=>true}){
  const coordinate=e=>axis==='x'?e.clientX:e.clientY;
  const minimum=()=>typeof min==='function'?min():min;
  const reflect=()=>{if(!handle.getClientRects().length)return;const value=Math.round(read());handle.setAttribute('aria-valuemin',String(Math.min(minimum(),value)));handle.setAttribute('aria-valuemax',String(Math.max(max(),value)));handle.setAttribute('aria-valuenow',String(value));};
  handle.addEventListener('pointerdown',e=>{
   if(e.button!==0||!enabled())return;e.preventDefault();e.stopPropagation();endLayoutResize(true);hideMenu();
   const previous=setting();handle.focus({preventScroll:true});
   layoutResize={handle,pointerId:e.pointerId,start:coordinate(e),initial:read(),restore:()=>{restore(previous);reflect();}};
   document.body.classList.add('layout-resizing');document.body.style.setProperty('--layout-resize-cursor',axis==='x'?'col-resize':'row-resize');handle.classList.add('layout-resize-active');
   handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove',e=>{const g=layoutResize;if(g?.handle!==handle||g.pointerId!==e.pointerId)return;write(clamp(g.initial+(coordinate(e)-g.start)*sign,minimum(),max()));reflect();});
  handle.addEventListener('pointerup',e=>{if(layoutResize?.handle===handle&&layoutResize.pointerId===e.pointerId)endLayoutResize();});
  for(const event of ['pointercancel','lostpointercapture'])handle.addEventListener(event,e=>{if(layoutResize?.handle===handle&&layoutResize.pointerId===e.pointerId)endLayoutResize(true);});
  handle.addEventListener('dblclick',e=>{if(!enabled())return;e.preventDefault();endLayoutResize(true);reset();reflect();persistLayout();});
  handle.addEventListener('keydown',e=>{if(composing(e))return;
   const increase=axis==='x'?(sign>0?'ArrowRight':'ArrowLeft'):'ArrowDown',decrease=axis==='x'?(sign>0?'ArrowLeft':'ArrowRight'):'ArrowUp';
   if(![increase,decrease,'Home','End'].includes(e.key)||e.metaKey||e.ctrlKey||e.altKey||!enabled())return;
   e.preventDefault();e.stopPropagation();endLayoutResize(true);
   if(e.key==='Home')reset();else write(e.key==='End'?max():clamp(read()+(e.key===increase?1:-1)*(e.shiftKey?50:10),minimum(),max()));
   reflect();persistLayout();
  });
  reflect();return reflect;
 }
 const reflectWidth=bindLayoutResize(widthHandle,{axis:'x',sign:-1,min:240,max:panelWidthLimit,read:()=>$('panel-dock').getBoundingClientRect().width,write:n=>{panelWidth=n;applyPanelWidth();},setting:()=>panelWidth,restore:n=>{panelWidth=n;applyPanelWidth();},reset:()=>{panelWidth=null;applyPanelWidth();},enabled:()=>innerWidth>680&&!layout.classList.contains('panels-collapsed')});
 new ResizeObserver(reflectWidth).observe($('panel-dock'));
 const updateToolsWidth=()=>{applyToolsWidth();applyPanelWidth();};
 const reflectToolsWidth=bindLayoutResize(toolsHandle,{axis:'x',min:toolsWidthMinimum,max:toolsWidthLimit,read:()=>toolDock.getBoundingClientRect().width,write:n=>{toolsWidth=n;updateToolsWidth();},setting:()=>toolsWidth,restore:n=>{toolsWidth=n;updateToolsWidth();},reset:()=>{toolsWidth=null;updateToolsWidth();},enabled:()=>!layout.classList.contains('tools-collapsed')});
 new ResizeObserver(reflectToolsWidth).observe(toolDock);
 for(const panel of panels){
  const key=panel.dataset.panel,body=panel.querySelector('.panel-body');body.id=`${panel.id}-body`;
  const summary=panel.querySelector('summary');summary.draggable=true;summary.title='点击折叠/展开；拖动调整顺序；Alt + ↑ / ↓ 换序';
  summary.addEventListener('dragstart',e=>{endLayoutResize(true);hideMenu();draggedPanel=key;e.dataTransfer.setData('application/x-curve-editor-panel',key);e.dataTransfer.effectAllowed='move';panel.classList.add('panel-dragging');e.stopPropagation();});
  summary.addEventListener('dragend',()=>{draggedPanel=null;clearPanelDropMarks();});
  panel.addEventListener('dragover',e=>{if(!draggedPanel)return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';clearPanelDropMarks();if(draggedPanel!==key)panel.classList.add(e.clientY<panel.getBoundingClientRect().top+panel.offsetHeight/2?'panel-drop-before':'panel-drop-after');});
  panel.addEventListener('dragleave',e=>{if(!panel.contains(e.relatedTarget))panel.classList.remove('panel-drop-before','panel-drop-after');});
  panel.addEventListener('drop',e=>{if(!draggedPanel)return;e.preventDefault();e.stopPropagation();const source=draggedPanel,before=e.clientY<panel.getBoundingClientRect().top+panel.offsetHeight/2;draggedPanel=null;clearPanelDropMarks();movePanel(source,key,before);});
  summary.addEventListener('keydown',e=>{if(composing(e))return;if(!e.altKey||e.ctrlKey||e.metaKey||!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const order=panelOrder(),index=order.indexOf(key),target=order[index+(e.key==='ArrowUp'?-1:1)];if(target)movePanel(key,target,e.key==='ArrowUp');summary.focus({preventScroll:true});});
  const handle=document.createElement('div');handle.className='panel-resize-handle';handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','horizontal');handle.setAttribute('aria-controls',body.id);
  handle.setAttribute('aria-label',`调整${panel.querySelector('summary span').textContent}区域高度`);handle.title='拖动调整区域高度；双击恢复默认';panel.append(handle);
  const applyHeight=()=>{body.style.height=panelHeights[key]?`${panelHeights[key]}px`:'';body.classList.toggle('panel-sized',!!panelHeights[key]);};applyHeight();
  const reflect=bindLayoutResize(handle,{axis:'y',min:96,max:()=>1200,read:()=>body.getBoundingClientRect().height,write:n=>{panelHeights[key]=n;applyHeight();},setting:()=>panelHeights[key],restore:n=>{if(n===undefined)delete panelHeights[key];else panelHeights[key]=n;applyHeight();},reset:()=>{delete panelHeights[key];applyHeight();},enabled:()=>panel.open});
  panel.addEventListener('toggle',()=>{if(panel.open){reflect();if(layoutScrollReady)body.scrollTop=panelScroll.groups[key]||0;}else if(layoutResize?.handle===handle)endLayoutResize(true);});
  body.addEventListener('scroll',()=>{if(!layoutScrollReady||!panel.open||layout.classList.contains('panels-collapsed'))return;panelScroll.groups[key]=body.scrollTop;persistLayout();});
  new ResizeObserver(reflect).observe(body);
 }
 window.addEventListener('keydown',e=>{if(composing(e))return;if(e.key==='Escape'&&layoutResize){e.preventDefault();e.stopImmediatePropagation();endLayoutResize(true);}},true);
 window.addEventListener('blur',()=>endLayoutResize(true));
 window.addEventListener('resize',()=>{endLayoutResize(true);applyToolsWidth();applyPanelWidth();});
 function restorePanelScroll(){requestAnimationFrame(()=>{
  applyPanelScroll();
  requestAnimationFrame(()=>{layoutScrollReady=true;});
 });}
 const selectedPath=()=>doc.paths.find(p=>p.id===selected), selectedNode=()=>selectedPath()?.nodes[ni];
 const selectedCurves=()=>doc.paths.filter(p=>selection.includes(p.id)&&L.editable(doc,p.id));
 const selectedImages=()=>doc.images.filter(i=>imageSelection.includes(i.id)&&L.editable(doc,i.id,'image'));
 const selectedTexts=()=>doc.texts.filter(t=>textSelection.includes(t.id)&&L.editable(doc,t.id,'text'));
 const currentLayer=()=>doc.layers.find(l=>l.id===activeLayer)||doc.layers.at(-1);
 const temporaryPan=()=>space||ctrlPan;
 function activateCanvasLayer(target,p){
  if(target.closest('[data-corner],[data-rotate],[data-rotation-center]'))return;
  const element=target.closest('[data-path],[data-image],[data-text]');let owner;
  if(element){const type=element.hasAttribute('data-path')?'path':element.hasAttribute('data-image')?'image':'text';owner=L.layerFor(doc,element.getAttribute('data-'+type),type);}
  else if(tool==='node'||tool==='select'){
   // Noneditable visible content still locates its layer without becoming editable.
   outer:for(const layer of L.ordered(doc).reverse())for(const item of L.items(doc,layer).reverse()){
    if(!L.visible(doc,item.id,item.type))continue;
    const object=(item.type==='path'?doc.paths:item.type==='image'?doc.images:doc.texts).find(o=>o.id===item.id);
    const hit=item.type==='path'?object.nodes.some(n=>G.dist(n,p)<=10/camera.z)||G.segmentCount(object)&&G.nearest(object,p).distance<=8/camera.z:item.type==='image'?L.imageContains(object,p):T.contains(object,p);
    if(hit){owner=layer;break outer;}
   }
  }
  if(owner){activeLayer=owner.id;layerSelection=[];}
 }
 const editablePaths=()=>doc.paths.filter(p=>L.editable(doc,p.id));
 const nodeKey=item=>`${item.pathId}\0${item.index}`;
 function selectPaths(ids,active=null){imageRegion?.cancel();axisSelected=false;layerSelection=[];segmentSelection=null;imageSelection=[];textSelection=[];selection=[...new Set(ids)].filter(id=>L.editable(doc,id));selected=selection.includes(active)?active:selection.at(-1)||null;ni=null;nodeSelection=[];if(selected)activeLayer=L.layerFor(doc,selected).id;}
 function selectElements(paths,images,texts=[]){selectPaths(paths);imageSelection=[...new Set(images)].filter(id=>L.editable(doc,id,'image'));textSelection=[...new Set(texts)].filter(id=>L.editable(doc,id,'text'));if(imageSelection.length)activeLayer=L.layerFor(doc,imageSelection.at(-1),'image').id;if(textSelection.length)activeLayer=L.layerFor(doc,textSelection.at(-1),'text').id;}
 function selectNodes(items,active=items.at(-1)){
  axisSelected=false;
  layerSelection=[];
  segmentSelection=null;
  imageSelection=[];textSelection=[];nodeSelection=[...new Map(items.map(item=>[nodeKey(item),item])).values()].filter(item=>L.editable(doc,item.pathId)&&doc.paths.find(p=>p.id===item.pathId)?.nodes[item.index]);
  selection=[...new Set(nodeSelection.map(item=>item.pathId))];const focus=nodeSelection.find(item=>nodeKey(item)===nodeKey(active||{}))||nodeSelection.at(-1);
  selected=focus?.pathId||null;ni=focus?.index??null;
  if(selected)activeLayer=L.layerFor(doc,selected).id;
 }
 function selectedNodes(){return nodeSelection.map(item=>({path:doc.paths.find(p=>p.id===item.pathId),index:item.index})).filter(item=>item.path?.nodes[item.index]);}
 function breakableNode(){
  const nodes=selectedNodes();if(nodes.length!==1)return null;
  const {path,index}=nodes[0];return path.nodes.length>=3&&(path.closed||index>0&&index<path.nodes.length-1)?nodes[0]:null;
 }
 function breakSelectedNode(){
  const item=breakableNode();if(!item)return;let pieces;
  try{pieces=G.breakPath(item.path,item.index);if(doc.paths.length+pieces.length-1>500)throw new Error('最多支持 500 条曲线，请先整理曲线');}catch(err){status(err.message);return;}
  blurEditor();checkpoint();const {path}=item,layer=L.layerFor(doc,path.id);
  if(pieces.length===2){
   pieces[1].id=uid();pieces[1].name=path.name.slice(0,74)+' · 断开';
   layer.pathIds.splice(layer.pathIds.indexOf(path.id)+1,0,pieces[1].id);
   if(layer.items){const at=layer.items.findIndex(i=>i.type==='path'&&i.id===path.id);if(at>=0)layer.items.splice(at+1,0,{...layer.items[at],id:pieces[1].id});}
  }
  for(const text of doc.texts){
   if(L.positionLabelPath(doc,text)!==path)continue;
   const marker=text.positionMarker,attachment=marker.attachment||L.positionAttachment(path,marker);if(!attachment)continue;
   const second=!path.closed&&attachment.index>=item.index,piece=pieces[second?1:0];
   const index=path.closed?(attachment.index-item.index+path.nodes.length)%path.nodes.length:attachment.index-(second?item.index:0);
   text.positionMarker={...marker,pathId:piece.id,attachment:{...attachment,index}};
  }
  doc.paths.splice(doc.paths.indexOf(path),1,...pieces);measurement=null;drawing=false;tool='node';
  const focus=pieces.at(-1);selectNodes([{pathId:focus.id,index:pieces.length===1?focus.nodes.length-1:0}]);
  changed('连接已断开，原弧线保留；拖动当前端点可分开，靠近另一端点后松开选择连接或仅保持重合');
 }
 function editingSegment(){
  if(tool!=='node'||!segmentSelection)return null;
  const {pathId,index}=segmentSelection,path=doc.paths.find(p=>p.id===pathId);
  if(!path||!L.editable(doc,pathId)||!selection.includes(pathId)||!Number.isInteger(index)||index<0||index>=G.segmentCount(path))return null;
  const endpoints=[index,(index+1)%path.nodes.length];
  if(nodeSelection.length!==2||!endpoints.every(index=>nodeSelection.some(n=>n.pathId===pathId&&n.index===index)))return null;
  return {path,index};
 }
 function selectEditingSegment(path,index){
  selectNodes([{pathId:path.id,index},{pathId:path.id,index:(index+1)%path.nodes.length}]);
  segmentSelection={pathId:path.id,index};drawing=false;render();status(`已选第 ${index+1} 段 · 可复制本段；J 切换直线 / 曲线，可拖动两端手柄调整`);
 }
 function copySegmentPath({path:source,index}){
  const path=clone(source),suffix=` · 第 ${index+1} 段`;
  path.nodes=[path.nodes[index],path.nodes[(index+1)%path.nodes.length]];
  // Keep this cubic exactly; discard handles belonging to adjacent segments.
  path.nodes[0].in=G.point(path.nodes[0]);path.nodes[1].out=G.point(path.nodes[1]);
  path.nodes.forEach(n=>{n.mode='cusp';});path.closed=false;
  path.name=path.name.slice(0,75-suffix.length)+suffix;
  return path;
 }
 function selectionBounds(){
  if(axisSelected)return null;
  if(tool==='select')return L.bounds(doc,selection,imageSelection,textSelection);
  if(tool==='node'&&!nodeSelection.length)return L.bounds(doc,selection,imageSelection,textSelection);
  if(tool!=='node'||nodeSelection.length<2)return null;
  const nodes=selectedNodes();if(!nodes.length)return null;
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const {path,index} of nodes){const n=path.nodes[index];x=Math.min(x,n.x);y=Math.min(y,n.y);right=Math.max(right,n.x);bottom=Math.max(bottom,n.y);}
  return {x,y,width:right-x,height:bottom-y};
 }
 function selectionDragHit(p,target,shift=false){
  if(shift||target.closest('[data-node],[data-side],[data-corner],[data-rotate],[data-rotation-center]'))return false;
  const pathId=target.getAttribute('data-path'),imageId=target.getAttribute('data-image'),textId=target.closest('[data-text]')?.getAttribute('data-text');
  if((textId&&!textSelection.includes(textId))||(pathId&&!selection.includes(pathId))||(imageId&&!imageSelection.includes(imageId)))return false;
  const b=selectionBounds(),pad=10/camera.z;
  return !!b&&p.x>=b.x-pad&&p.x<=b.x+b.width+pad&&p.y>=b.y-pad&&p.y<=b.y+b.height+pad;
 }
 // Compare each edit with its preceding geometry so legacy labels can attach before
 // a node moves. Reset this baseline on document/history replacement.
 function syncDimensions(){
  if(!doc?.texts?.some(t=>t.dimension)){dimensionDocument=doc;dimensionBaseline=null;return;}
  const gestureBase=drag?.annotationBase||drag?.base,before=dimensionDocument===doc?(gestureBase?.paths&&gestureBase?.texts?gestureBase:dimensionBaseline):null;
  D.sync(doc,before);dimensionDocument=doc;dimensionBaseline=D.captureBaseline(doc);
 }
 function syncPositionLabels(){
  syncDimensions();
  if(!doc?.texts?.some(t=>t.positionMarker)){positionLabelDocument=doc;positionLabelBaseline=null;return;}
  if(positionLabelDocument===doc&&positionLabelBaseline)L.syncPositionLabels(doc,positionLabelBaseline);
  positionLabelDocument=doc;positionLabelBaseline={paths:clone(doc.paths),texts:clone(doc.texts)};
 }
 const snapshot=()=>{syncPositionLabels();D.refresh(doc);return {doc:{...doc,paths:clone(doc.paths),layers:clone(doc.layers),images:doc.images.map(i=>({...i})),texts:clone(doc.texts),originals:clone(doc.originals),mirrorAxis:clone(doc.mirrorAxis),...(doc.symmetryLinks?{symmetryLinks:clone(doc.symmetryLinks)}:{}),calibration:clone(doc.calibration)},selected,ni,selection:selection.slice(),imageSelection:imageSelection.slice(),textSelection:textSelection.slice(),layerSelection:layerSelection.slice(),activeLayer,nodeSelection:clone(nodeSelection),segmentSelection:clone(segmentSelection),rotationPivot:clone(currentRotationPivot()),axisSelected,drawing,drawingEnd,tool};};
 // Images are immutable and shared by snapshots, so avoid comparing their large data URLs.
 const sameDoc=(a,b)=>a.image===b.image&&a.images.length===b.images.length&&a.images.every((i,n)=>i.dataUrl===b.images[n].dataUrl)&&JSON.stringify({...a,image:null,images:a.images.map(i=>({...i,dataUrl:null}))})===JSON.stringify({...b,image:null,images:b.images.map(i=>({...i,dataUrl:null}))});
 function describeEdit(before,after){
  const a=before.doc,b=after.doc,eq=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
  if(a.title!==b.title||a.width!==b.width||a.height!==b.height)return b.paths.length||b.images.length?'打开作品':'新建画板';
  if(a.texts.length!==b.texts.length)return b.texts.length>a.texts.length?'创建文字':'删除文字';
  if(!eq(a.texts,b.texts)){if(a.texts.some((t,i)=>t.content!==b.texts[i]?.content))return '修改文字内容';if(a.texts.some((t,i)=>t.fontSize!==b.texts[i]?.fontSize))return '调整文字字号';if(a.texts.some((t,i)=>(t.rotation||0)!==(b.texts[i]?.rotation||0)))return '旋转文字 / 所选元素';return '移动文字';}
  if(a.images.length!==b.images.length)return b.images.length>a.images.length?'导入图片':'删除图片';
  if(a.paths.length!==b.paths.length){
   if(b.paths.length===a.paths.length+1&&['rectangle','ellipse'].includes(before.tool))return before.tool==='rectangle'?'绘制矩形':'绘制椭圆';
   if(b.paths.length>a.paths.length&&b.paths.some(p=>!a.paths.some(q=>q.id===p.id)&&p.note?.startsWith('等距偏移：')))return '偏移曲线';
   if(b.paths.length<a.paths.length&&b.paths.some(p=>p.nodes.length>(a.paths.find(q=>q.id===p.id)?.nodes.length??Infinity)))return '合并曲线';
   return b.paths.length>a.paths.length?'新建曲线 / 镜像副本':'删除曲线';
  }
  if(a.layers.length!==b.layers.length){
   if(b.layers.length>a.layers.length&&b.layers.some(l=>l.kind==='group'&&!a.layers.some(p=>p.id===l.id)))return '图层成组';
   if(b.layers.length<a.layers.length&&a.layers.some(l=>l.kind==='group'&&!b.layers.some(p=>p.id===l.id))&&b.layers.some(l=>a.layers.find(p=>p.id===l.id)?.parentId!==l.parentId))return '图层解组';
   if(b.layers.length<a.layers.length&&b.layers.some(l=>l.items&&!eq(l.items,a.layers.find(p=>p.id===l.id)?.items)))return '合并图层';
   return b.layers.length>a.layers.length?'新建图层':'删除图层';
  }
  if(!eq(a.layers,b.layers)){
   if(a.layers.some((l,i)=>l.id!==b.layers[i]?.id))return '调整图层顺序';
   if(a.layers.some((l,i)=>l.name!==b.layers[i]?.name))return '图层重命名';
   if(a.layers.some((l,i)=>l.visible!==b.layers[i]?.visible))return '显示 / 隐藏图层';
   if(a.layers.some((l,i)=>l.locked!==b.layers[i]?.locked))return '锁定 / 解锁图层';
   if(a.paths.some(p=>Boolean(L.layerFor(a,p.id)?.items?.find(i=>i.type==='path'&&i.id===p.id)?.locked)!==Boolean(L.layerFor(b,p.id)?.items?.find(i=>i.type==='path'&&i.id===p.id)?.locked)))return '锁定 / 解锁曲线';
   if(a.layers.some((l,i)=>['pathIds','imageIds','textIds'].some(key=>!eq(l[key],b.layers[i]?.[key]))))return '更换所属图层';
  }
  if(a.mirrorAxisVisible!==b.mirrorAxisVisible)return '显示 / 隐藏对称轴';
  if(!eq(a.symmetryLinks,b.symmetryLinks)&&eq(a.paths,b.paths))return '调整对称关联';
  if(!eq(a.mirrorAxis,b.mirrorAxis))return b.mirrorAxis?(a.mirrorAxis?'调整对称轴':'设置对称轴'):'清除对称轴';
  if(!eq(a.calibration,b.calibration))return b.calibration?'设置测量比例':'清除测量比例';
  if(a.measureUnit!==b.measureUnit)return '切换测量单位';
  if(a.opacity!==b.opacity||a.images.some((image,i)=>image.opacity!==b.images[i]?.opacity))return '调整图片透明度';
  if(a.images.some((image,i)=>(image.rotation||0)!==(b.images[i]?.rotation||0)))return '旋转图片 / 所选元素';
  if(a.images.some((image,i)=>image.dataUrl!==b.images[i]?.dataUrl))return '清理图片区域';
  if(!eq(a.images,b.images))return '移动 / 缩放图片';
  if(a.paths.some((p,i)=>p.id!==b.paths[i]?.id)&&b.paths.every(p=>a.paths.some(q=>q.id===p.id)))return '调整曲线顺序';
  for(let i=0;i<b.paths.length;i++){
   const p=a.paths[i],q=b.paths[i];if(!p||p.id!==q.id)return '打开作品';
   for(const [key,label] of [['visible','显示 / 隐藏曲线'],['dashed','调整虚线样式'],['name','修改曲线名称'],['note','修改曲线说明'],['color','修改线色'],['role','修改曲线用途'],['closed','闭合 / 打开曲线']])if(p[key]!==q[key])return label;
   if(p.nodes.length!==q.nodes.length)return q.nodes.length>p.nodes.length?'添加节点':'删除节点';
   if(p.nodes.some((n,i)=>n.mode!==q.nodes[i].mode))return '调整节点类型';
   if(p.nodes.some((n,i)=>n.x!==q.nodes[i].x||n.y!==q.nodes[i].y))return before.tool==='select'||!before.nodeSelection.length?'移动 / 旋转 / 缩放曲线':'移动节点';
   if(!eq(p.nodes,q.nodes))return '调整控制柄';
  }
  return a.newNodeMode!==b.newNodeMode?'设置新节点类型':'修改作品';
 }
 const edits=window.CurveInteractions.createHistory({same:(a,b)=>sameDoc(a.doc,b.doc),describe:describeEdit});
 function commitEdit(){editingField=null;edits.commit(snapshot());}
 function blurEditor(){if(document.activeElement?.matches('input,textarea,select'))document.activeElement.blur();}
 function checkpoint(){hideMenu();commitEdit();edits.begin(snapshot());}
 function updateDirty(){syncPositionLabels();dirty=!cleanDoc||!sameDoc(cleanDoc,doc);window.EditorSession?.setDirty(dirty);scheduleSession();}
 function markClean(inWorkspace=false){cleanDoc=snapshot().doc;dirty=false;window.EditorSession?.setDirty(false);workspaceClean=inWorkspace;scheduleSession();}
 function renderHistory(){
  const pending=edits.hasChanges({doc}),u=Math.min(100,edits.undoCount+Number(pending)),r=pending?0:edits.redoCount;
  const fitUndo=fitting.canUndo,fitRedo=fitting.canRedo;
  $('undo').disabled=!u&&!fitUndo;$('redo').disabled=!r&&!fitRedo;
  $('undo').title=fitUndo?'撤销继续对合 · ⌘ / Ctrl + Z':`撤销 · 可撤销 ${u} 步 · ⌘ / Ctrl + Z`;
  $('redo').title=fitRedo?'重做继续对合 · ⌘ / Ctrl + Shift + Z；Ctrl + Y':`重做 · 可重做 ${r} 步 · ⌘ / Ctrl + Shift + Z；Ctrl + Y`;
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
 function artworkEditTime(currentDoc=replay?.original?.doc||doc){if(!sessionBooting&&sessionBaseDoc&&!sameDoc(sessionBaseDoc,currentDoc))lastArtworkEditAt=(performance.timeOrigin+performance.now())/1000;return lastArtworkEditAt;}
 function sessionPayload(){const current=replay?.original||snapshot();return {current,history:edits.serialize(current),cleanDoc,camera:replay?.camera||camera,savedRevision:lastSaved,workspaceClean,lastArtworkEditAt:artworkEditTime(current.doc)};}
 function sessionHead(){try{return JSON.parse(localStorage.getItem(sessionHeadKey()));}catch{return null;}}
 function stampSession(data,currentDoc){
  const contentChanged=!!sessionBaseDoc&&(!sameDoc(sessionBaseDoc,currentDoc)||edits.revision!==sessionBaseHistoryRevision||lastSaved!==sessionBaseSaved);
  return Object.assign(data,{writeId:uid(),writer:sessionWriter,baseRevision:sessionRevision,contentChanged,updatedAt:performance.timeOrigin+performance.now()});
 }
 function rememberSessionHead(data,journal=null){
  try{const head=sessionHead();if(!head||head.updatedAt<=data.updatedAt)localStorage.setItem(sessionHeadKey(),JSON.stringify({writeId:data.writeId,writer:data.writer,updatedAt:data.updatedAt,journal}));}catch{}
 }
 // Refresh can cancel an IndexedDB transaction. A synchronous journal covers the
 // last gesture; immutable images already on disk are referenced by their keys.
 function writeRefreshJournal(){
  if(sessionBooting||!sessionDB||!sessionKey)return;
  try{
   const payload=sessionPayload(),packed=stampSession(window.CurveInteractions.packSession(payload),payload.current.doc),head=sessionHead();
   // Keep a recovered journal until it is consolidated. An unchanged child
   // journal would otherwise lose the canonical revision it recovers from.
   if(sessionRecoveryBase!==null&&!packed.contentChanged)return;
   // A stale page may retain its own view, but refreshing it must not publish
   // that old artwork over a different page's newer edit.
   if(!packed.contentChanged&&head&&head.writeId!==sessionRevision&&head.writer!==sessionWriter)return;
   packed.assets=packed.assets.map(dataUrl=>committedAssets.has(sessionAssets.get(dataUrl))?{key:sessionAssets.get(dataUrl)}:dataUrl);
   packed.journalId=uid();journalToken=packed.journalId;
   journalStorageKey=`${journalKey()}:page:${sessionWriter}`;
   localStorage.setItem(journalStorageKey,JSON.stringify(packed));
   rememberSessionHead(packed,journalStorageKey);
  }catch{storageStatus('unavailable','刷新备份不可用，请等待本机保存完成或手动保存作品');}
 }
 function writeSession(){
  clearTimeout(sessionTimer);sessionTimer=null;if(sessionBooting||!sessionDB||!sessionKey)return;
  const generation=sessionGeneration,journalId=journalToken,refreshKey=journalStorageKey;
  try{
   const payload=sessionPayload(),data=stampSession(window.CurveInteractions.packSession(payload),payload.current.doc),transaction=sessionDB.transaction(['projects','assets'],'readwrite'),assets=transaction.objectStore('assets'),projects=transaction.objectStore('projects'),keys=[];
   const historyRevision=edits.revision;
   let published=false;
   data.assets=data.assets.map(dataUrl=>{
    if(!sessionAssets.has(dataUrl))sessionAssets.set(dataUrl,uid());const key=sessionAssets.get(dataUrl);keys.push(key);
    if(!committedAssets.has(key))assets.put({project:sessionKey,dataUrl},key);return {key};
   });
   // Read and compare inside the same write transaction so another tab cannot
   // commit between the check and the write. Archive genuinely divergent
   // branches, without duplicating the full history on every plain refresh.
   const current=projects.get(sessionRecordKey());
   current.onsuccess=()=>{
    const saved=current.result,head=sessionHead();
    const newerJournal=!data.contentChanged&&head&&head.writer!==sessionWriter&&head.writeId!==data.baseRevision;
    const recovering=sessionRecoveryBase!==null&&saved?.writeId===sessionRecoveryBase&&head?.writeId===data.baseRevision;
    published=!newerJournal&&(!saved||saved.writeId===data.baseRevision||saved.writer===sessionWriter||data.contentChanged||recovering);
    if(published&&saved&&(data.contentChanged||recovering)&&saved.writeId!==data.baseRevision&&saved.writer!==sessionWriter)projects.put(saved,`${sessionRecordKey()}:branch:${saved.writeId}`);
    if(published)projects.put(data,sessionRecordKey());
   };
   transaction.oncomplete=()=>{
    keys.forEach(key=>committedAssets.add(key));
    sessionBaseDoc=payload.current.doc;sessionBaseHistoryRevision=historyRevision;sessionBaseSaved=payload.savedRevision;
    if(published){sessionRevision=data.writeId;sessionRecoveryBase=null;rememberSessionHead(data);if(payload.lastArtworkEditAt)window.EditorSession?.edited(payload.lastArtworkEditAt);}
    if(generation===sessionGeneration){try{if(published&&journalId&&refreshKey&&JSON.parse(localStorage.getItem(refreshKey))?.journalId===journalId)localStorage.removeItem(refreshKey);}catch{}storageStatus('saved','已保存在本机 · 刷新可恢复');}
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
 function validateRecoveredSession(data){
  const states=[data.current,...data.history.past,...data.history.future];
  for(const s of states){
   s.doc=validate(s.doc);s.textSelection=s.textSelection||[];
   if(!['node','select','pen','rectangle','ellipse','pan','axis','measure','calibrate','trace','outline','text','position','dimension'].includes(s.tool)||![s.selection,s.imageSelection,s.nodeSelection].every(Array.isArray))throw new Error('编辑状态无效');
  }
  if(data.cleanDoc)data.cleanDoc=validate(data.cleanDoc);
  if(!data.camera||!Number.isFinite(data.camera.x)||!Number.isFinite(data.camera.y)||!Number.isFinite(data.camera.z)||data.camera.z<.000001||data.camera.z>MAX_ZOOM)throw new Error('视图无效');
  window.CurveInteractions.createHistory().restore(data.history);
  return data;
 }
 function applySnapshot(s,keepFitting=false){
  imageRegion?.cancel();
  vectorFiles?.cancelPendingImport();
  positionLabelDocument=null;positionLabelBaseline=null;
  doc=s.doc;selected=s.selected;ni=s.ni;selection=s.selection;imageSelection=s.imageSelection;textSelection=s.textSelection||[];layerSelection=s.layerSelection||[];activeLayer=s.activeLayer;nodeSelection=s.nodeSelection;drawing=s.drawing;drawingEnd=s.drawingEnd||null;tool=s.tool;
  segmentSelection=s.segmentSelection||null;if(!editingSegment())segmentSelection=null;
  drag=null;tapStart=null;taps.reset();hideMenu();resetAuxiliary(keepFitting);axisSelected=s.axisSelected===true&&!!doc.mirrorAxis;rotationPivot=clone(s.rotationPivot||null);currentRotationPivot();
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
  if(fitting.capturesCanvas&&['contextmenu','drop','paste'].includes(type)&&!e.target.closest?.('input,textarea')){e.preventDefault();e.stopImmediatePropagation();return;}
  if(replay&&(e.target.closest?.('#canvas')||type==='paste')){e.preventDefault();e.stopImmediatePropagation();}
 },true);
 function changed(message){
  clearTrace();L.prune(doc);
  selection=selection.filter(id=>L.editable(doc,id));imageSelection=imageSelection.filter(id=>L.editable(doc,id,'image'));textSelection=textSelection.filter(id=>L.editable(doc,id,'text'));
  nodeSelection=nodeSelection.filter(n=>L.editable(doc,n.pathId));layerSelection=layerSelection.filter(id=>doc.layers.some(l=>l.id===id));
  if(!selection.includes(selected)){selected=selection.at(-1)||null;ni=null;}if(!editingSegment())segmentSelection=null;
  updateDirty();render();if(message)status(message);
 }
 function status(s){$('status').textContent=s;}
 function el(tag,attrs,parent){const e=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));parent.appendChild(e);return e;}
 function empty(){return L.normalize({format:'daban-curve-editor',version:1,title:'未命名修改',width:1000,height:700,units:'image-px',newNodeMode:doc?.newNodeMode||'cusp',image:null,opacity:.65,paths:[],originals:[],mirrorAxis:null,calibration:null,measureUnit:'mm',note:'坐标为原始图像像素；实际测量长度依据两点标定，仅作修改沟通。'});}
 function attachPath(path,layer=currentLayer()){doc.paths.push(path);layer.pathIds.push(path.id);}
 function annotationPoint(pos,target){
  const preferred=target?.closest('[data-path]')?.getAttribute('data-path'),paths=doc.paths.filter(p=>L.visible(doc,p.id)),candidates=preferred?paths.filter(p=>p.id===preferred):paths;
  const anchor=target?.closest('.anchor[data-node]'),pointed=candidates.find(p=>p.id===preferred),index=Number(anchor?.getAttribute('data-node'));
  if(anchor&&pointed?.nodes[index])return {...G.point(pointed.nodes[index]),pathId:pointed.id,attachment:{kind:'node',index}};
  let node=null,distance=9/camera.z;
  for(const path of candidates)for(const [index,n] of path.nodes.entries()){const d=G.dist(pos,n);if(d<=distance){node={...G.point(n),pathId:path.id,attachment:{kind:'node',index}};distance=d;}}
  if(node)return node;
  let hit=null;
  for(const path of candidates){if(!G.segmentCount(path))continue;const next=G.nearest(path,pos);if(next.distance<=12/camera.z&&(!hit||next.distance<hit.distance))hit={...next,path};}
  return hit?{...G.at(hit.path.nodes[hit.index],hit.path.nodes[(hit.index+1)%hit.path.nodes.length],hit.t),pathId:hit.path.id,attachment:{kind:'segment',index:hit.index,t:hit.t}}:null;
 }
 function openPositionLabel(pos,target){
  const anchor=annotationPoint(pos,target);if(!anchor){status('请点击曲线或节点附近添加点位标注');return;}
  openText(anchor,null,true);
 }
 function openText(position,id=null,positionLabel=false){
  if(replay)return;blurEditor();endDrag();hideMenu();
  const dimensionItem=id?doc.texts.find(t=>t.id===id&&t.dimension):null;
  if(dimensionItem){setTool('select');selectElements([],[],[id]);showPanel('properties');render();return;}
  const item=id?doc.texts.find(t=>t.id===id):null,marked=!!item?.positionMarker||positionLabel,layer=item?L.layerFor(doc,id,'text'):L.textLayer(doc,marked?'位置标注':'文字图层');
  if(layer&&!L.writable(doc,layer)){status(`${marked?'位置标注':'文字'}所在图层已隐藏或锁定，请先显示并解锁`);return;}
  if(!layer&&doc.layers.length>=200){status('最多支持 200 个图层，请先整理图层后创建文字图层');return;}
  if(!item&&doc.texts.length>=500){status('最多支持 500 段文字，请先整理文字');return;}
  textDraft={id,position,layerId:layer?.id,positionLabel:marked};
  $('text-dialog-title').textContent=(item?'编辑':'创建')+(marked?'点位标注':'文字');$('text-confirm').textContent=item?'应用修改':marked?'创建标注':'创建文字';
  const input=$('new-text-content');input.value=item?.content||'';input.rows=marked?1:4;input.maxLength=marked?32:10000;input.placeholder=marked?'例如 01、A1、B02':'输入文字，支持中文与多行';
  $('position-label-hint').hidden=!marked;$('new-text-size').value=item?.fontSize||(marked?Math.max(1,Math.min(4096,12/camera.z)):32);$('text-error').textContent='';
  textDialog.showModal();$('new-text-content').focus();
 }
 $('text-cancel').onclick=()=>textDialog.close();textDialog.addEventListener('close',()=>{if(textDialog.open)return;textDraft=null;svg.focus({preventScroll:true});});
 $('text-form').onsubmit=e=>{
  e.preventDefault();if(!textDraft)return;
  const item=doc.texts.find(t=>t.id===textDraft.id),content=$('new-text-content').value,fontSize=Number($('new-text-size').value),layer=doc.layers.find(l=>l.id===textDraft.layerId);
  const marked=textDraft.positionLabel,anchor=textDraft.position;
  const candidate=item?{...item,content,fontSize}:{id:uid(),name:content.split('\n')[0].slice(0,80),content,fontSize,x:anchor.x+(marked?fontSize*.7:0),y:anchor.y-(marked?fontSize*1.8:0),color:marked?'#1685a6':'#243347',...(marked?{positionMarker:{...anchor}}:{})};
  try{T.check(candidate);if(layer&&!L.writable(doc,layer))throw new Error('图层已隐藏或锁定');if(!item&&doc.texts.length>=500)throw new Error('最多支持 500 段文字');if(!layer&&doc.layers.length>=200)throw new Error('最多支持 200 个图层');}catch(err){$('text-error').textContent=err.message;return;}
  if(!item||item.content!==content||item.fontSize!==fontSize){checkpoint();if(item)Object.assign(item,candidate);else L.addText(doc,candidate,layer);}
  const id=item?.id||doc.texts.at(-1).id;textDialog.close();
  if(marked&&!item)setTool('position');else{setTool('select');selectElements([],[],[id]);}
  changed(marked?(item?'点位标注已更新，可撤销':'已添加点位标注，可继续点击节点或曲线；按 V 选取标注后可编辑'):(item?'文字已更新，可撤销':'文字已创建，可在对象属性调整字号'));
 };
 function renderTextProperties(){
  const texts=selectedTexts(),single=texts.length===1,content=$('text-content'),size=$('text-size');
  $('text-properties').hidden=!texts.length;$('properties').hidden=!!texts.length&&!selection.length;
  const dimension=single&&!!texts[0].dimension;
  $('dimension-properties').hidden=!dimension;if(dimension){$('dimension-unit').value=texts[0].dimension.unit;$('dimension-binding-info').textContent=Object.keys(texts[0].dimension.bindings||{}).length?'已关联节点 · 移动原节点会更新距离':'自由端点 · 拖圆点吸附到节点后自动关联';}
  const marked=single&&!!texts[0].positionMarker;
  $('text-properties-title').textContent=single?(dimension?'当前尺寸标注':marked?'当前点位标注':'当前文字'):`已选 ${texts.length} 段文字`;
  content.maxLength=marked?32:10000;content.placeholder=marked?'英文字母或数字，如 01、A1':'支持中文与多行文字';
  content.disabled=!single||dimension;size.disabled=!texts.length;
  if(document.activeElement!==content)content.value=single?texts[0].content:'';
  if(document.activeElement!==size)size.value=texts.length&&texts.every(t=>t.fontSize===texts[0].fontSize)?Number(texts[0].fontSize.toFixed(4)):'';
  size.placeholder=texts.length>1?'多种字号':'';
 }
 for(const [id,key] of [['text-content','content'],['text-size','fontSize']]){
  const input=$(id);input.oninput=()=>{
   const texts=selectedTexts();if(!texts.length||(key==='content'&&(texts.length>1||texts[0].dimension)))return;
   const value=key==='fontSize'?Number(input.value):input.value;
   try{for(const t of texts)T.check({...t,[key]:value});}catch(err){status(err.message);return;}
   beginField(id);for(const t of texts)t[key]=value;changed();
  };
  const end=()=>{if(editingField===id)commitEdit();render();};input.addEventListener('change',end);input.addEventListener('blur',end);
  input.addEventListener('keydown',e=>{if(composing(e))return;if(id==='text-size'&&e.key==='Enter'){e.preventDefault();input.blur();}});
 }
 $('dimension-unit').onchange=()=>{const texts=selectedTexts();if(texts.length!==1||!texts[0].dimension)return;checkpoint();texts[0].dimension.unit=$('dimension-unit').value;changed('尺寸标注单位已更新，可撤销');};
 function makePath(){return {id:uid(),name:`曲线 ${doc.paths.length+1}`,role:'outline',color:'#e04544',closed:false,note:'',nodes:[]};}
 function demo(){doc=empty();doc.title='练习曲线';let p=makePath();p.name='练习曲线';p.nodes=[G.node(200,460),G.node(480,230),G.node(780,430)];p.nodes[0].out={x:300,y:450};p.nodes[1].in={x:345,y:230};p.nodes[1].out={x:615,y:230};p.nodes[1].mode='symmetric';p.nodes[2].in={x:650,y:430};attachPath(p);doc.originals=clone(doc.paths);selectNodes([{pathId:p.id,index:1}]);markClean(true);render();fit();}
 function point(e){const r=svg.getBoundingClientRect();return {x:(e.clientX-r.left-camera.x)/camera.z,y:(e.clientY-r.top-camera.y)/camera.z};}
 function screenPoint(e){const r=svg.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
 function fit(){const r=svg.getBoundingClientRect(),b=L.contentBounds(doc);camera.z=Math.max(.000001,Math.min(MAX_ZOOM,(r.width-70)/b.width,(r.height-80)/b.height));camera.x=(r.width-b.width*camera.z)/2-b.x*camera.z;camera.y=(r.height-b.height*camera.z)/2-b.y*camera.z;renderCanvas();}
 function zoom(factor,p){const r=svg.getBoundingClientRect();p=p||{x:r.width/2,y:r.height/2};const z=Math.min(MAX_ZOOM,Math.max(.000001,camera.z*factor));camera.x=p.x-(p.x-camera.x)*z/camera.z;camera.y=p.y-(p.y-camera.y)*z/camera.z;camera.z=z;renderCanvas(true);}
 const isTracing=()=>tool==='trace'||tool==='outline';
 function renderTraceSettings(){
  const outline=tool==='outline';
  $('trace-title').textContent=outline?'提取外轮廓':'提取线条';$('trace-shortcut').textContent=outline?'闭合外框 · Shift + T':'实线 / 虚线 · T';
  $('line-trace-controls').hidden=outline;$('outline-trace-controls').hidden=!outline;
  $('trace-instructions').textContent=outline?'指向物体内部或外边缘看蓝色外框；点击生成闭合曲线，Esc 取消。':'指向图片线条看蓝色预览；点击生成可编辑曲线，Esc 取消。';
 }
 function clearTrace(){clearTimeout(traceTimer);traceRequest++;tracePreview=null;$('trace-preview').replaceChildren();$('trace-summary').textContent=tool==='outline'?'等待指向图片中的物体':'等待指向图片中的线条';}
 const traceSettings=()=>tool==='outline'?{mode:'outline',tolerance:Number($('outline-tolerance').value),denoise:Number($('outline-denoise').value),smoothing:Number($('outline-smoothing').value),gap:0}:{mode:'line',tolerance:Number($('trace-tolerance').value),gap:Number($('trace-gap').value),smoothing:Number($('trace-smoothing').value)};
 const imageSignature=i=>[i.id,i.x,i.y,i.width,i.height,i.rotation||0,i.opacity,L.visible(doc,i.id,'image')].join(':');
 function traceImagesAt(p){
  const images=[];
  for(const layer of L.ordered(doc).reverse())for(const i of L.items(doc,layer).slice().reverse().filter(item=>item.type==='image').map(item=>doc.images.find(i=>i.id===item.id)))if(L.visible(doc,i.id,'image')&&i.opacity>0&&L.imageContains(i,p))images.push(i);
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
  if(!traceWorker){traceWorker=new Worker('tracing.js');traceWorker.onmessage=e=>{const job=traceJobs.get(e.data.id);if(!job)return;traceJobs.delete(e.data.id);e.data.error?job.reject(new Error(e.data.error)):job.resolve(e.data.result);};traceWorker.onerror=()=>{for(const job of traceJobs.values())job.reject(new Error('提取计算失败，请重新选择工具'));traceJobs.clear();traceWorker.terminate();traceWorker=null;traceWorkerAsset=null;};}
  let resolve,reject;const completion=new Promise((yes,no)=>{resolve=yes;reject=no;});traceJobs.set(id,{resolve,reject,completion});
  try{const image=traceWorkerAsset===asset?undefined:raster;traceWorkerAsset=asset;traceWorker.postMessage({id,image,seed,options});}catch(err){traceJobs.delete(id);reject(err);}
  return completion;
 }
 async function previewTrace(p){
  const id=++traceRequest;tracePreview=null;$('trace-preview').replaceChildren();
  const images=traceImagesAt(p);if(!images.length){$('trace-summary').textContent=tool==='outline'?'请指向可见图片中的物体':'请指向可见图片中的线条';return null;}
  $('trace-summary').textContent=tool==='outline'?'正在识别外轮廓…':'正在识别线条…';
  try{
   for(const image of images){
   const signature=imageSignature(image);
   const raster=await traceRaster(image);if(id!==traceRequest||!isTracing()||temporaryPan())return null;
   const local=L.worldToImage(image,p),seed={x:local.x*raster.width/image.width,y:local.y*raster.height/image.height},settings=traceSettings();
   const result=await calculateTrace(image.dataUrl,raster.pixels,seed,{...settings,gap:settings.gap*raster.scale,denoise:(settings.denoise??0)*raster.scale,smoothing:settings.smoothing*raster.scale,radiusX:10/camera.z*raster.width/image.width,radiusY:10/camera.z*raster.height/image.height},id);
   if(id!==traceRequest||!isTracing()||imageSignature(image)!==signature||!doc.images.includes(image)||replay)return null;
   if(!result){
    const x=Math.min(raster.width-1,Math.max(0,Math.floor(seed.x))),y=Math.min(raster.height-1,Math.max(0,Math.floor(seed.y)));
    if(raster.pixels.data[(y*raster.width+x)*4+3]<240||image.opacity<.98)continue;
    break;
   }
   const map=p=>L.imageToWorld(image,{x:p.x*image.width/raster.width,y:p.y*image.height/raster.height});
   const path={...result,nodes:result.nodes.map(n=>({...map(n),in:map(n.in),out:map(n.out),mode:n.mode}))};delete path.points;
   tracePreview={path,mode:tool,imageId:image.id,signature,p: {...p}};renderTrace();
   $('trace-summary').textContent=tool==='outline'?`外轮廓 · ${path.nodes.length} 个节点 · 闭合；点击生成`:`${result.dashed?'虚线':'实线'} · ${result.segments} 段 · ${path.nodes.length} 个节点 · ${path.closed?'闭合':'开放'}；点击生成`;
   return tracePreview;
   }
   $('trace-summary').textContent=tool==='outline'?'未找到外轮廓；指向物体内部，或调整背景容差；物体需与背景有明显区别':'未找到线条；靠近线条，或调整颜色容差与连接距离';return null;
  }catch(err){if(id===traceRequest){$('trace-summary').textContent='提取失败：'+err.message;status('提取失败：'+err.message);}return null;}
 }
 function renderTrace(){
  const group=$('trace-preview');group.replaceChildren();if(!tracePreview||!isTracing()||replay)return;
  const image=doc.images.find(i=>i.id===tracePreview.imageId);if(!image||imageSignature(image)!==tracePreview.signature){clearTrace();return;}
  const d=G.pathD(tracePreview.path);el('path',{d,fill:'none',stroke:'white','stroke-width':5/camera.z,'stroke-linecap':'round'},group);
  el('path',{d,fill:'none',stroke:'#176bce','stroke-width':2.5/camera.z,'stroke-linecap':'round'},group);
 }
 function scheduleTrace(p){tracePointer={...p};clearTimeout(traceTimer);traceRequest++;tracePreview=null;renderTrace();traceTimer=setTimeout(()=>previewTrace(p),100);}
 async function createTrace(p){
  clearTimeout(traceTimer);
  const candidate=tracePreview&&G.dist(p,tracePreview.p)<12/camera.z?tracePreview:await previewTrace(p);if(!candidate||candidate!==tracePreview||!isTracing()||replay)return;
  if(doc.paths.length>=500){status('曲线已达到500条，请删除一些曲线后再提取');return;}
  const source=doc.layers.findIndex(l=>l.imageIds.includes(candidate.imageId));
  let layer=doc.layers.slice(source+1).reverse().find(l=>l.name==='提取曲线'&&L.writable(doc,l));
  if(!layer&&doc.layers.length>=200){status('图层已达到200层，请减少图层后再提取');return;}
  checkpoint();if(!layer){layer=L.addLayer(doc,'提取曲线');}activeLayer=layer.id;
  const path={...makePath(),name:`提取${candidate.mode==='outline'?'外轮廓':candidate.path.dashed?'虚线':'线条'} ${doc.paths.length+1}`,sourceImageId:candidate.imageId,color:candidate.path.color,closed:candidate.path.closed,nodes:clone(candidate.path.nodes),dashed:candidate.path.dashed,note:candidate.mode==='outline'?'从参考图片提取外轮廓；忽略内部纹理与孔洞，边缘与曲线拟合请人工核对。':'从参考图片提取；断线连接与曲线拟合请人工核对。'};
  attachPath(path,layer);clearTrace();tracePointer=null;setTool('node');selectNodes([{pathId:path.id,index:0}]);changed(`已提取 ${path.nodes.length} 个可编辑节点，可拖动调整或撤销`);
 }
 for(const key of ['tolerance','gap','smoothing'])$('trace-'+key).oninput=()=>{const value=$('trace-'+key).value;$('trace-'+key+'-value').textContent=value+(key==='tolerance'?'':' px');clearTrace();if(isTracing()&&tracePointer)scheduleTrace(tracePointer);};
 for(const key of ['tolerance','denoise','smoothing'])$('outline-'+key).oninput=()=>{const value=$('outline-'+key).value;$('outline-'+key+'-value').textContent=value+(key==='tolerance'?'':' px');clearTrace();if(isTracing()&&tracePointer)scheduleTrace(tracePointer);};
 function renderViewport(){
  view.setAttribute('transform',`translate(${camera.x} ${camera.y}) scale(${camera.z})`);
  // Paint the visible world area; the image extent never limits the workspace.
  const r=svg.getBoundingClientRect(),pad=50/camera.z;
  for(const id of ['paper','grid-paper']){const e=$(id);e.setAttribute('x',-camera.x/camera.z-pad);e.setAttribute('y',-camera.y/camera.z-pad);e.setAttribute('width',r.width/camera.z+2*pad);e.setAttribute('height',r.height/camera.z+2*pad);}
 }
 function renderPan(){
  // Translation keeps artwork geometry and screen-sized controls unchanged.
  // Only viewport-clamped overlays need rebuilding while the pointer moves.
  renderViewport();renderSelection();renderShapePreview();renderNodeAlignment();renderCurveRelation();fitting.render();renderDimensions();
 }
 function renderCanvas(cameraOnly=false){
  if(cameraOnly!==true){syncDimensions();fitting.syncOriginals(fittingMutationDepth>0);}
  renderViewport();
  $('reference').setAttribute('width',doc.width);$('reference').setAttribute('height',doc.height);
  $('grid-paper').style.display=$('show-grid').checked?'':'none';
  const ref=$('reference');if(doc.image){if(ref.getAttribute('href')!==doc.image.dataUrl)ref.setAttribute('href',doc.image.dataUrl);ref.style.display='';}else{ref.removeAttribute('href');ref.style.display='none';}ref.setAttribute('opacity',doc.opacity);
  const pg=$('paths'),hg=$('handles'),gg=$('ghosts'),cg=$('node-colors'),segment=editingSegment();pg.replaceChildren();hg.replaceChildren();gg.replaceChildren();cg.replaceChildren();cg.style.display=fitting.active?'none':'';
  if($('show-original').checked)doc.originals.filter(p=>L.visible(doc,p.id)).forEach(p=>el('path',{d:G.pathD(p),fill:'none',stroke:'#8898a9','stroke-width':1.5/camera.z,'stroke-dasharray':`${5/camera.z} ${4/camera.z}`,'pointer-events':'none'},gg));
  for(const layer of L.ordered(doc)){
   if(!L.state(doc,layer).visible)continue;const group=el('g',{'data-layer':layer.id},pg);
   for(const item of L.items(doc,layer)){
    if(!L.visible(doc,item.id,item.type))continue;
    const editable=L.editable(doc,item.id,item.type);
    if(item.type==='image'){
     const i=doc.images.find(i=>i.id===item.id);el('image',{x:i.x,y:i.y,width:i.width,height:i.height,transform:`rotate(${i.rotation||0} ${i.x+i.width/2} ${i.y+i.height/2})`,href:i.dataUrl,opacity:i.opacity,preserveAspectRatio:'none','data-image':i.id,'pointer-events':editable&&tool==='select'?'all':'none',class:'selected-image'},group);
    }else if(item.type==='path'){
     const p=doc.paths.find(p=>p.id===item.id),d=G.pathD(p);
     // Keep fine editing strokes in screen pixels; the separate hit-line stays easy to grab.
     el('path',{d,stroke:p.color,'stroke-width':(selection.includes(p.id)?1.25:1)/camera.z,...(p.dashed?{'stroke-dasharray':`${8/camera.z} ${6/camera.z}`}:{ }),class:'svg-curve','pointer-events':'none'},group);
     if(editable)el('path',{d,'stroke-width':(tool==='select'?12:18)/camera.z,class:'hit-line','data-path':p.id},group);
     p.nodes.forEach((n,i)=>{if(n.color)el('circle',{cx:n.x,cy:n.y,r:4/camera.z,fill:n.color,stroke:'white','stroke-width':1.5/camera.z,'pointer-events':'none','data-node-color-path':p.id,'data-node-color-index':i},cg);});
     for(const notch of N.groups(p))el('path',{d:G.pathD({closed:false,nodes:notch.indices.map(i=>p.nodes[i])}),fill:'none',stroke:'#c47713','stroke-width':1.5/camera.z,'pointer-events':'none','data-defined-notch':notch.id},group);
     if(segment?.path===p)el('path',{d:G.segmentD(p,segment.index),fill:'none',stroke:'#176bce','stroke-width':1.5/camera.z,class:'selected-segment','data-segment':segment.index,'pointer-events':'none'},group);
    }else{
     const t=doc.texts.find(t=>t.id===item.id),outer=el('g',{'data-text':t.id},group),selectable=editable&&['select','node'].includes(tool);
     if(t.positionMarker){
      const p=t.positionMarker,end=T.markerEnd(t);
      el('line',{x1:p.x,y1:p.y,x2:end.x,y2:end.y,stroke:t.color,'stroke-width':t.fontSize*.06,'pointer-events':'none'},outer);
      el('circle',{cx:p.x,cy:p.y,r:t.fontSize*.16,fill:t.color,class:'position-marker','pointer-events':selectable?'all':'none'},outer);
     }
     if(t.dimension)for(const [a,b] of D.segments(t))el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:t.color,'stroke-width':t.fontSize*.06,'pointer-events':selectable?'stroke':'none',class:'dimension-line'},outer);
     const tg=t.positionMarker||t.dimension?el('g',{},outer):outer;tg.setAttribute('transform',`rotate(${t.rotation||0} ${t.x} ${t.y})`);
     el('rect',{...T.localBounds(t),fill:'transparent','pointer-events':selectable?'all':'none'},tg);
     const text=el('text',{x:t.x,y:t.y+t.fontSize,fill:t.color,'font-size':t.fontSize,'font-family':'sans-serif','xml:space':'preserve',class:'svg-text','pointer-events':'none'},tg);
     T.lines(t).forEach((line,index)=>el('tspan',{x:t.x,y:t.y+t.fontSize+index*t.fontSize*1.2},text).textContent=line);
    }
   }
  }
  const chosen=new Set(nodeSelection.map(nodeKey));
  const nodePaths=['position','dimension'].includes(tool)?doc.paths.filter(p=>L.visible(doc,p.id)):selectedCurves();
  if(!axisSelected&&['node','pen','position','dimension'].includes(tool))for(const p of nodePaths)p.nodes.forEach((n,i)=>{
   const sides=['position','dimension'].includes(tool)?[]:segment?.path===p?(i===segment.index?['out']:i===(segment.index+1)%p.nodes.length?['in']:[]):p.id===selected&&i===ni?['in','out']:[];
   for(const side of sides){
    if(G.dist(n,n[side])<.5/camera.z)continue;
    el('line',{x1:n.x,y1:n.y,x2:n[side].x,y2:n[side].y,stroke:'#3d89dc','stroke-width':1/camera.z,class:'handle-line'},hg);
    el('circle',{cx:n[side].x,cy:n[side].y,r:9/camera.z,fill:'transparent','data-side':side,'data-node':i,'data-path':p.id,class:'control'},hg);
    el('circle',{cx:n[side].x,cy:n[side].y,r:4.5/camera.z,fill:'#fff',stroke:'#176bce','stroke-width':1.5/camera.z,'pointer-events':'none'},hg);
   }
   const checked=chosen.has(nodeKey({pathId:p.id,index:i}));
   el('rect',{x:n.x-7/camera.z,y:n.y-7/camera.z,width:14/camera.z,height:14/camera.z,fill:'transparent','data-node':i,'data-path':p.id,'data-selected':checked,class:'anchor'},hg);
   el('rect',{x:n.x-4/camera.z,y:n.y-4/camera.z,width:8/camera.z,height:8/camera.z,fill:n.color||(checked?'#176bce':'white'),stroke:n.color?(checked?'#243347':n.color):'#176bce','stroke-width':(n.color&&checked?2.5:1.5)/camera.z,'pointer-events':'none'},hg);
   if(!['position','dimension'].includes(tool)&&p.id===selected&&i===ni)el('text',{x:n.x+10/camera.z,y:n.y-10/camera.z,fill:'#176bce','font-size':12/camera.z,'pointer-events':'none'},hg).textContent=`${i+1}`;
  });
  renderSelection();renderTrace();renderOffsetPreview();renderFairingPreview();renderSimplifyPreview();renderShapePreview();
  $('zoom').textContent=`${camera.z<.01?Number((camera.z*100).toPrecision(2)):Math.round(camera.z*100)}%`;
  $('canvas-label').textContent=`无限画布 · ${doc.layers.length} 个图层 · ${doc.images.length} 张图片 · ${doc.texts.length} 段文字`;
  svg.style.cursor=fairingDraft||simplifyDraft||temporaryPan()||tool==='pan'?(drag?.kind==='pan'?'grabbing':'grab'):['elements','nodes','axis'].includes(drag?.kind)?'move':tool==='text'?'text':['dimension','position','pen','rectangle','ellipse','axis','measure','calibrate','trace','outline'].includes(tool)?'crosshair':'default';
  tools.forEach(b=>b.setAttribute('aria-pressed',!fitting.capturesCanvas&&b.dataset.tool===(temporaryPan()?'pan':tool)));
  renderGuides();renderCalibrationGuide();renderMeasurement();renderNodeAlignment();renderCurveRelation();fitting.render();renderDimensions();
 }
 function dragTranslation(p,e){
  const pos=e.shiftKey?snap(drag.start,p):p,delta={x:pos.x-drag.start.x,y:pos.y-drag.start.y};
  drag.alignment=null;drag.connection=null;drag.alignmentDisabled=!!e.altKey;drag.alignmentDirection=null;
  if(e.altKey||Math.hypot(delta.x,delta.y)<1e-9&&!drag.moved)return delta;
  if(!drag.alignmentNodes){
   const moving=drag.kind==='nodes'?drag.nodes.map(n=>({...G.point(n.node),pathId:n.pathId,index:n.index})):drag.base.paths.filter(path=>selection.includes(path.id)).flatMap(path=>path.nodes.map((n,index)=>({...G.point(n),pathId:path.id,index})));
   const keys=new Set(moving.map(nodeKey));
   const targets=doc.paths.filter(path=>L.visible(doc,path.id)).flatMap(path=>path.nodes.map((n,index)=>({...G.point(n),pathId:path.id,index}))).filter(n=>!keys.has(nodeKey(n)));
   const paths=new Map(doc.paths.map(path=>[path.id,path])),source=selection.length===1?paths.get(selection[0]):null;
   const allNodes=drag.kind==='nodes'&&source&&drag.nodes.length===source.nodes.length&&drag.nodes.every(n=>n.pathId===source.id);
   drag.wholeCurve=!!source&&!imageSelection.length&&!textSelection.length&&(drag.kind==='elements'||allNodes);
   const endpoint=n=>{const path=paths.get(n.pathId);return path&&!path.closed&&path.nodes.length>=2&&(n.index===0||n.index===path.nodes.length-1);};
   const canConnect=drag.wholeCurve||tool==='node'&&drag.kind==='nodes'&&drag.nodes.length===1;
   const connectionMoving=canConnect?moving.filter(endpoint):[];
   const connectionTargets=connectionMoving.length?targets.filter(n=>{
    const target=paths.get(n.pathId);return endpoint(n)&&L.editable(doc,n.pathId)&&(source===target?source.nodes.length>=4:source.nodes.length+target.nodes.length-1<=10000);
   }):[];
   const movingIds=new Set(moving.map(n=>n.pathId)),curveTargets=moving.length?G.alignmentSegments(doc.paths.filter(path=>L.visible(doc,path.id)&&!movingIds.has(path.id))):[];
   drag.alignmentNodes={moving,targets,connectionMoving,connectionTargets,curveTargets,movingIds};
  }
  const {moving,targets,connectionMoving,connectionTargets,curveTargets}=drag.alignmentNodes,length=Math.hypot(delta.x,delta.y);
  const translated=nodes=>nodes.map(n=>({...n,x:n.x+delta.x,y:n.y+delta.y})),radius=NODE_SNAP_RADIUS/camera.z,direction=e.shiftKey&&length>1e-9?{x:delta.x/length,y:delta.y/length}:null;
  drag.alignmentDirection=direction;
  // Compare connectable endpoints before snapping, so other anchors cannot hide a valid join.
  const connection=drag.moved?G.nearestNodeAlignment(translated(connectionMoving),connectionTargets,radius,direction):null;
  const nodes=translated(moving),nodeHit=G.nearestNodeAlignment(nodes,targets,radius,direction),axisHit=drag.kind==='nodes'?G.nearestAxisAlignment(nodes,selectedSymmetryAxis()||doc.mirrorAxis,radius,direction):null;
  let hit=connection||(axisHit&&(!nodeHit||axisHit.distance<nodeHit.distance)?axisHit:nodeHit);
  if(!connection&&drag.kind==='nodes'){const curveHit=G.nearestCurveAlignment(nodes,curveTargets,radius,direction);if(curveHit&&(!hit||curveHit.distance<hit.distance-1e-9))hit=curveHit;}
  if(hit){
   drag.alignment=hit;drag.connection=connection;delta.x+=hit.dx;delta.y+=hit.dy;
  }
  return delta;
 }
 function snapDraggedEndpoint(gesture){
  const hit=gesture.connection;
  const source=doc.paths.find(p=>p.id===hit.source.pathId),target=doc.paths.find(p=>p.id===hit.target.pathId);
  if(!source||!target||!L.editable(doc,source.id)||!L.editable(doc,target.id))return false;
  // Both choices keep exact coincidence, without floating point translation residue.
  const a=source.nodes[hit.source.index],b=target.nodes[hit.target.index];if(!a||!b)return false;
  const dx=b.x-a.x,dy=b.y-a.y;
  for(const node of gesture.wholeCurve?source.nodes:[a])G.move(node,dx,dy);a.x=b.x;a.y=b.y;
  return true;
 }
 function connectDraggedEndpoint(gesture){
  const hit=gesture.connection;
  const source=doc.paths.find(p=>p.id===hit.source.pathId),target=doc.paths.find(p=>p.id===hit.target.pathId);
  if(!snapDraggedEndpoint(gesture))return;
  try{
   const result=G.joinEndpoints(source,hit.source.index,target,hit.target.index);
   doc.paths=doc.paths.flatMap(p=>p===source?[result.path]:p===target?[]:[p]);L.prune(doc);
   measurement=null;drawing=false;if(gesture.wholeCurve)selectPaths([source.id]);else selectNodes([{pathId:source.id,index:result.nodeIndex}]);
   status(result.path.closed?'端点已连接，曲线已闭合；可撤销':'端点已连接为一条曲线，沿用拖动曲线的样式和图层；可撤销');
  }catch(err){status(err.message);}
 }
 function finishConnectionChoice(connect=false,focus=false){
  const gesture=pendingConnection;if(!gesture)return;
  pendingConnection=null;menu.hidden=true;
  if(connect)connectDraggedEndpoint(gesture);
  else status('仅保持重合，节点仍独立，可分别拖动；可撤销');
  // Keep the drag and optional join in the same undo step. Pending history is
  // already serialized by local recovery while the choice is still open.
  commitEdit();updateDirty();if(connect)render();else renderHistory();
  if(focus)svg.focus({preventScroll:true});
 }
 function showConnectionChoice(e){
  startMenu('端点重合');
  const closing=pendingConnection.connection.source.pathId===pendingConnection.connection.target.pathId;
  for(const [label,connect,title] of [['连接节点',true,closing?'合并端点并闭合当前曲线':'合并端点，连接为同一条曲线'],['仅保持重合',false,'位置相同，节点保持独立；Esc 或点击别处也保持重合']]){
   const button=document.createElement('button');button.type='button';button.role='menuitem';button.textContent=label;button.title=title;
   button.onclick=()=>finishConnectionChoice(connect,true);menu.append(button);
  }
  showMenuAt(e);menu.lastElementChild.focus();
  status('端点已重合：选择连接节点，或仅保持重合；Esc 保持重合');
 }
 function renderNodeAlignment(){
  nodeAlignment.replaceChildren();const hit=drag?.alignment;if(!hit)return;
  const connection=drag.connection,closing=connection&&hit.source.pathId===hit.target.pathId;
  const {x,y}=hit.target,z=camera.z,color='#18804a',group=el('g',{'data-alignment':['axis','curve'].includes(hit.kind)?hit.kind:'coincident',...(connection?{'data-connection':closing?'close':'join'}:{})},nodeAlignment);
  el('circle',{cx:x,cy:y,r:9/z,fill:'none',stroke:'white','stroke-width':5/z},group);
  el('circle',{cx:x,cy:y,r:9/z,fill:'none',stroke:color,'stroke-width':2/z},group);
  el('path',{d:`M ${x-5/z} ${y} H ${x+5/z} M ${x} ${y-5/z} V ${y+5/z}`,stroke:color,'stroke-width':1.5/z},group);
  const r=svg.getBoundingClientRect(),tx=clamp(x+15/z,(-camera.x+8)/z,(-camera.x+Math.max(8,r.width-215))/z),ty=clamp(y-15/z,(-camera.y+20)/z,(-camera.y+r.height-20)/z);
  el('text',{x:tx,y:ty,fill:color,stroke:'white','stroke-width':4/z,'paint-order':'stroke','stroke-linejoin':'round','font-size':12/z},group).textContent=connection?`${closing?'松开选择闭合或仅重合':'松开选择连接或仅重合'} · Alt 自由移动`:hit.kind==='axis'?'已吸附对称轴 · Alt 自由移动':hit.kind==='curve'?'已吸附曲线 · Alt 自由移动':'节点重合 · Alt 自由移动';
 }
 function parallelAdjustment(relation){
  const a=relation.source.straight,b=relation.target.straight;if(!a||!b)return null;
  let angle=Math.atan2(a.ux*b.uy-a.uy*b.ux,a.ux*b.ux+a.uy*b.uy);if(angle>Math.PI/2)angle-=Math.PI;if(angle< -Math.PI/2)angle+=Math.PI;
  if(Math.abs(angle)<1e-12)return {kind:'none'};
  // Preserve explicit direction constraints and higher-priority point/endpoint snaps.
  if(drag.connection||drag.alignment||imageSelection.length||textSelection.length)return null;
  const source=relation.source,path=doc.paths.find(p=>p.id===source.pathId),next=(source.index+1)%path.nodes.length,moving=drag.alignmentNodes.moving,keys=new Set(moving.map(nodeKey)),first=keys.has(nodeKey({pathId:path.id,index:source.index})),last=keys.has(nodeKey({pathId:path.id,index:next}));
  let plan;
  if(first!==last){
   const fixed=first?source.b:source.a,end=first?source.a:source.b,nx=-b.uy,ny=b.ux,error=-((end.x-fixed.x)*nx+(end.y-fixed.y)*ny),direction=drag.alignmentDirection,denominator=direction?direction.x*nx+direction.y*ny:1;if(Math.abs(denominator)<1e-9)return null;
   const dx=direction?direction.x*error/denominator:nx*error,dy=direction?direction.y*error/denominator:ny*error;
   const fraction=p=>((p.x-a.a.x)*a.ux+(p.y-a.a.y)*a.uy)/a.length;
   plan={kind:'translate',dx,dy,pathId:path.id,index:source.index,next,controls:[fraction(source.a.out),fraction(source.b.in)]};
  }else if(first&&last){
   if(drag.alignmentDirection)return null;
   plan={kind:'rotate',center:{x:(a.a.x+a.b.x)/2,y:(a.a.y+a.b.y)/2},angle};
  }else return null;
  const transform=p=>plan.kind==='translate'?{x:p.x+plan.dx,y:p.y+plan.dy}:{x:plan.center.x+(p.x-plan.center.x)*Math.cos(angle)-(p.y-plan.center.y)*Math.sin(angle),y:plan.center.y+(p.x-plan.center.x)*Math.sin(angle)+(p.y-plan.center.y)*Math.cos(angle)};
  const paths=new Map(doc.paths.map(path=>[path.id,path])),patches=new Map();
  const patch=(pathId,index)=>{const key=nodeKey({pathId,index});if(!patches.has(key))patches.set(key,{pathId,index,node:clone(paths.get(pathId).nodes[index])});return patches.get(key).node;};
  for(const item of moving){const node=patch(item.pathId,item.index),p=transform(node),inside=transform(node.in),outside=transform(node.out);node.x=p.x;node.y=p.y;node.in=inside;node.out=outside;}
  if(plan.kind==='translate'){const a=patch(plan.pathId,plan.index),b=patch(plan.pathId,plan.next);G.handle(a,'out',G.mix(a,b,plan.controls[0]));G.handle(b,'in',G.mix(a,b,plan.controls[1]));}
  for(const item of patches.values()){const before=paths.get(item.pathId).nodes[item.index];for(const side of ['', 'in','out']){const p=side?before[side]:before,q=side?item.node[side]:item.node;if(!Number.isFinite(q.x)||!Number.isFinite(q.y)||Math.abs(q.x)>1e7||Math.abs(q.y)>1e7||G.dist(p,q)*camera.z>6)return null;}}
  return {kind:plan.kind,nodes:[...patches.values()],transform};
 }
 function alignDraggedParallel(){
  const plan=drag.parallel;if(!plan||plan.kind==='none'||drag.alignmentDisabled)return;
  const ids=doc.paths.filter(p=>p.nodes.length&&p.nodes.every((_,index)=>plan.nodes.some(n=>n.pathId===p.id&&n.index===index))).map(p=>p.id);
  try{L.transformPositionLabels(doc,ids,plan.transform,plan.kind==='rotate');}catch(error){status(error.message);return;}
  if(doc.symmetryLinks?.length)S.transformLinks(doc,ids,plan.transform);
  for(const item of plan.nodes)doc.paths.find(p=>p.id===item.pathId).nodes[item.index]=item.node;
  status('已自动对齐为平行；可撤销');
 }
 function renderCurveRelation(){
  curveRelation.replaceChildren();if(drag)drag.parallel=null;if(!['nodes','elements'].includes(drag?.kind)||drag.alignmentDisabled||!drag.alignmentNodes?.curveTargets.length)return;
  const {movingIds,curveTargets}=drag.alignmentNodes,chosen=new Set((drag.nodes||[]).map(nodeKey)),paths=doc.paths.filter(path=>movingIds.has(path.id)),lengths=new Map(paths.map(path=>[path.id,path.nodes.length]));
  const sources=G.alignmentSegments(paths).filter(s=>drag.kind==='elements'||chosen.has(nodeKey({pathId:s.pathId,index:s.index}))||chosen.has(nodeKey({pathId:s.pathId,index:(s.index+1)%lengths.get(s.pathId)})));
  const relation=G.nearestSegmentRelation(sources,curveTargets,camera.z,hit=>hit.kind==='overlap'||!!parallelAdjustment(hit));if(!relation)return;
  if(relation.kind==='parallel')drag.parallel=parallelAdjustment(relation);
  const {kind,source,target,position,sourceRange,targetRange}=relation,z=camera.z,color=kind==='overlap'?'#18804a':'#b07113',group=el('g',{'data-relation':kind,'data-source':source.pathId,'data-target':target.pathId,'data-segment':source.index},curveRelation);
  for(const [segment,range] of [[source,sourceRange],[target,targetRange]]){
   if(range)el('line',{x1:range[0].x,y1:range[0].y,x2:range[1].x,y2:range[1].y,stroke:color,'stroke-width':3/z},group);
   else el('path',{d:G.pathD({nodes:[segment.a,segment.b],closed:false}),fill:'none',stroke:color,'stroke-width':3/z},group);
  }
  const r=svg.getBoundingClientRect(),x=clamp(position.x+12/z,(-camera.x+8)/z,(-camera.x+Math.max(8,r.width-130))/z),y=clamp(position.y+22/z,(-camera.y+20)/z,(-camera.y+r.height-20)/z);
  el('text',{x,y,fill:color,stroke:'white','stroke-width':4/z,'paint-order':'stroke','font-size':12/z},group).textContent=kind==='overlap'?(relation.exact?(relation.curved?'曲线重合':'线段重合'):'接近重合'):(relation.exact?'线段平行':'接近平行 · 松手对齐');
 }
 const shapeGesture=()=>drag?.kind==='shape'?drag:suspendedDrag?.kind==='shape'?suspendedDrag:null;
 function cancelShape(){
  if(!shapeGesture())return false;
  drag=null;suspendedDrag=null;tapStart=null;taps.reset();
  if(capturedPointer!==null&&svg.hasPointerCapture(capturedPointer))svg.releasePointerCapture(capturedPointer);
  capturedPointer=null;shapePreview.replaceChildren();return true;
 }
 function shapeInfo(gesture){
  const bounds=G.shapeBounds(gesture.start,gesture.current,gesture.constrain),size=Math.max(bounds.width,bounds.height);
  const equal=size>0&&Math.abs(bounds.width-bounds.height)<=size*1e-9;
  const near=!equal&&Math.min(bounds.width,bounds.height)*camera.z>=8&&Math.abs(bounds.width-bounds.height)<=size*.05;
  const round=gesture.shape==='rectangle'?'正方形':'圆形',name=equal?round:gesture.shape==='rectangle'?'矩形':'椭圆';
  return {bounds,name,highlight:equal||near,label:`${lengthText(bounds.width)} × ${lengthText(bounds.height)}${equal?` · ${round}${gesture.constrain?'（Shift）':''}`:near?` · 接近${round}，按住 Shift 约束`:''}`};
 }
 function renderShapePreview(){
  shapePreview.replaceChildren();const gesture=shapeGesture();if(!gesture)return;
  const shape=G.createShape(gesture.shape,gesture.start,gesture.current,gesture.constrain);if(!shape)return;
  const {bounds,label,highlight}=shapeInfo(gesture),color=highlight?'#18804a':'#176bce';
  if(gesture.shape==='ellipse')el('rect',{...bounds,fill:'none',stroke:color,'stroke-width':1/camera.z,'stroke-dasharray':`${4/camera.z} ${4/camera.z}`},shapePreview);
  el('path',{d:G.pathD(shape),fill:'none',stroke:color,'stroke-width':2/camera.z},shapePreview);
  const r=svg.getBoundingClientRect(),font=12/camera.z;
  // Keep the dimension prompt inside the viewport even when dragging off the artboard.
  const x=clamp(bounds.x,(-camera.x+8)/camera.z,(-camera.x+Math.max(8,r.width-420))/camera.z),y=clamp(bounds.y-12/camera.z,(-camera.y+20)/camera.z,(-camera.y+r.height-20)/camera.z);
  el('text',{x,y,fill:color,stroke:'white','stroke-width':4/camera.z,'paint-order':'stroke','stroke-linejoin':'round','font-size':font},shapePreview).textContent=label;
 }
 function finishShape(gesture){
  const layer=doc.layers.find(l=>l.id===gesture.layerId),{bounds,name}=shapeInfo(gesture);
  if(Math.min(bounds.width,bounds.height)*camera.z<2){render();return;}
  if(!L.writable(doc,layer)){render();status('目标图层已隐藏、锁定或移除，未创建形状');return;}
  if(doc.paths.length>=500){render();status('最多支持 500 条曲线，请先整理曲线');return;}
  const shape=G.createShape(gesture.shape,gesture.start,gesture.current,gesture.constrain);if(!shape){render();return;}
  checkpoint();const path={...makePath(),...shape,name:`${name} ${doc.paths.length+1}`};attachPath(path,layer);selectPaths([path.id]);measurement=null;
  commitEdit();changed(`已创建${name} · 可继续拖动画图，或按 F10 编辑节点`);
 }
 function visibleRotationHandle(desired,center){
  const r=svg.getBoundingClientRect(),z=camera.z,left=(24-camera.x)/z,right=(Math.max(24,r.width-24)-camera.x)/z,top=(56-camera.y)/z,bottom=(Math.max(56,r.height-$('canvas-hint').offsetHeight-33)-camera.y)/z;
  const inside=p=>({x:clamp(p.x,left,right),y:clamp(p.y,top,bottom)});
  const handle=inside(desired);
  // A clipped handle too close to the pivot makes tiny pointer moves spin the artwork.
  if(G.dist(handle,center)<24/z||G.dist(handle,desired)>1e-9&&G.dist(handle,center)<64/z){
   const step=96/z,candidates=[{x:handle.x-step,y:handle.y},{x:handle.x+step,y:handle.y},{x:handle.x,y:handle.y-step},{x:handle.x,y:handle.y+step},{x:left,y:top},{x:right,y:top},{x:left,y:bottom},{x:right,y:bottom}].map(inside).filter(p=>G.dist(p,center)>=64/z);
   candidates.sort((a,b)=>G.dist(a,desired)-G.dist(b,desired));return candidates[0]||handle;
  }
  return handle;
 }
 function rotationTargets(){return L.rotationTargets(doc,selection,imageSelection,textSelection,layerSelection);}
 function rotationBounds(){const ids=rotationTargets();return L.bounds(doc,ids.paths,ids.images,ids.texts);}
 function rotationSelectionKey(){const ids=rotationTargets();return JSON.stringify([ids.paths.slice().sort(),ids.images.slice().sort(),ids.texts.slice().sort()]);}
 function currentRotationPivot(){
  if(rotationPivot?.key!==rotationSelectionKey())rotationPivot=null;
  return rotationPivot;
 }
 function rotationCenter(bounds){return G.point(currentRotationPivot()||{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2});}
 function rotationCenterGesture(){return drag?.kind==='rotation-center'?drag:suspendedDrag?.kind==='rotation-center'?suspendedDrag:null;}
 function cancelRotationCenterDrag(){
  const gesture=rotationCenterGesture();if(!gesture)return false;
  rotationPivot=gesture.before;drag=null;suspendedDrag=null;tapStart=null;taps.reset();
  if(capturedPointer!==null&&svg.hasPointerCapture(capturedPointer))svg.releasePointerCapture(capturedPointer);capturedPointer=null;
  scheduleSession();render();status('已取消移动旋转中心');return true;
 }
 function renderRotationCenter(group,center){
  const gesture=rotationCenterGesture(),z=camera.z;
  if(gesture)for(const path of doc.paths.filter(p=>L.visible(doc,p.id)))for(const n of path.nodes){
   el('circle',{cx:n.x,cy:n.y,r:3/z,fill:'white',stroke:'#18804a','stroke-width':1/z,'pointer-events':'none'},group);
  }
  const snapped=!!gesture?.snapped,color=snapped?'#18804a':'#b15e14';
  const marker=el('circle',{cx:center.x,cy:center.y,r:7/z,fill:'white',stroke:color,'stroke-width':1.5/z,'data-rotation-center':'true','data-snapped':String(snapped),'data-custom':String(!!currentRotationPivot()),class:'rotation-center','aria-label':'拖动旋转中心'},group);
  el('title',{},marker).textContent='拖动设置旋转中心，靠近曲线节点吸附；Alt 自由放置，Esc 取消';
  el('path',{d:`M ${center.x-4/z} ${center.y} h ${8/z} M ${center.x} ${center.y-4/z} v ${8/z}`,stroke:color,'stroke-width':1.5/z,'pointer-events':'none'},group);
  if(gesture)el('text',{x:center.x+12/z,y:center.y-12/z,fill:color,stroke:'white','stroke-width':3/z,'paint-order':'stroke','font-size':12/z,'pointer-events':'none'},group).textContent=snapped?'旋转中心 · 已吸附节点':'旋转中心';
 }
 function renderSelection(){
  const group=$('selection-overlay');group.replaceChildren();rotationCenterOverlay.replaceChildren();
  const b=selectionBounds();
  if(b){const pad=10/camera.z;el('rect',{x:b.x-pad,y:b.y-pad,width:b.width+2*pad,height:b.height+2*pad,class:'selection-bounds','stroke-width':1/camera.z},group);
   if((tool==='select'||tool==='node'&&!nodeSelection.length)&&b.width>1e-6&&b.height>1e-6)for(const [corner,x,y] of [['nw',b.x-pad,b.y-pad],['ne',b.x+b.width+pad,b.y-pad],['se',b.x+b.width+pad,b.y+b.height+pad],['sw',b.x-pad,b.y+b.height+pad]])el('rect',{x:x-5/camera.z,y:y-5/camera.z,width:10/camera.z,height:10/camera.z,'stroke-width':1.5/camera.z,'data-corner':corner,class:'resize-handle'},group);
  }
  const rotationBoundsValue=rotationBounds();
  if(!axisSelected&&rotationBoundsValue&&(tool==='select'||tool==='node'&&!nodeSelection.length)){
    const b=rotationBoundsValue;
    if(JSON.stringify(b)!==JSON.stringify(selectionBounds())){const pad=10/camera.z;el('rect',{x:b.x-pad,y:b.y-pad,width:b.width+2*pad,height:b.height+2*pad,class:'selection-bounds','stroke-width':1/camera.z,'stroke-dasharray':`${4/camera.z} ${3/camera.z}`,'data-rotation-bounds':'true'},group);}
    const rotation=drag?.kind==='rotate'?drag:suspendedDrag?.kind==='rotate'?suspendedDrag:null,rotating=!!rotation,center=rotation?rotation.center:rotationCenter(b),angle=(rotation?.degrees||0)*Math.PI/180;
    const offset=rotation?{x:rotation.handle.x-center.x,y:rotation.handle.y-center.y}:{x:b.x+b.width/2-center.x,y:b.y-34/camera.z-center.y};
    const desired={x:center.x+offset.x*Math.cos(angle)-offset.y*Math.sin(angle),y:center.y+offset.x*Math.sin(angle)+offset.y*Math.cos(angle)},handle=visibleRotationHandle(desired,center),distance=G.dist(handle,center),stem=Math.min(distance,24/camera.z);
    el('line',{x1:handle.x+(center.x-handle.x)*stem/(distance||1),y1:handle.y+(center.y-handle.y)*stem/(distance||1),x2:handle.x,y2:handle.y,class:'rotation-stem','stroke-width':1/camera.z},group);
    const circle=el('circle',{cx:handle.x,cy:handle.y,r:8/camera.z,'stroke-width':1.5/camera.z,'data-rotate':'curves',class:'rotation-handle','aria-label':'旋转所选元素'},group);
    el('title',{},circle).textContent='拖动旋转所选元素；Shift 按 15° 吸附';
    el('circle',{cx:handle.x,cy:handle.y,r:2/camera.z,fill:'#176bce','pointer-events':'none'},group);
    if(rotating)el('text',{x:handle.x,y:handle.y-13/camera.z,fill:'#176bce','font-size':12/camera.z,'text-anchor':'middle','pointer-events':'none'},group).textContent=`${Number(rotation.degrees.toFixed(2))}°`;
    renderRotationCenter(rotationCenterOverlay,center);
  }
  if(drag?.kind==='marquee'&&drag.moved){const b=G.normalizeRect(drag.start,drag.current);el('rect',{...b,class:'selection-marquee','stroke-width':1/camera.z},group);}
 }
 function renderLayers(keepLists=false){
  const layer=currentLayer();activeLayer=layer.id;const list=$('layer-list');
  layerSelection=layerSelection.filter(id=>doc.layers.some(l=>l.id===id));const chosen=selectedLayerIds();
  $('layer-count').textContent=`${doc.layers.length} 层`;
  const allSelected=$('all-layers-selected'),selectedCount=new Set(chosen.flatMap(id=>L.family(doc,id).map(item=>item.id))).size;
  allSelected.checked=!!doc.layers.length&&selectedCount===doc.layers.length;allSelected.indeterminate=selectedCount>0&&selectedCount<doc.layers.length;
  allSelected.title=allSelected.checked?'取消选择全部图层':allSelected.indeterminate?'部分图层已选中；点击全选图层':'全选图层';
  const allVisible=$('all-layers-visible'),visibleCount=doc.layers.filter(item=>item.visible).length;
  const visibleState=visibleCount===doc.layers.length?'all':visibleCount?'mixed':'none';
  allVisible.dataset.state=visibleState;allVisible.setAttribute('aria-pressed',visibleState==='all'?'true':visibleState==='mixed'?'mixed':'false');
  allVisible.setAttribute('aria-label',visibleState==='all'?'隐藏全部图层':'显示全部图层');
  allVisible.title=visibleState==='mixed'?'部分图层可见；点击显示全部图层':visibleState==='all'?'全部图层可见；点击隐藏全部图层':'全部图层已隐藏；点击显示全部图层';
  if(!keepLists){list.replaceChildren();
  for(const {layer:item,depth} of L.rows(doc)){
   const row=document.createElement('div');row.className='layer-row'+(item.id===activeLayer?' active':'')+(chosen.includes(item.id)?' selected':'');row.dataset.layer=item.id;row.dataset.kind=item.kind||'layer';row.dataset.depth=depth;row.style.paddingLeft=`${4+depth*14}px`;
   const isGroup=item.kind==='group',expanded=isGroup?!item.collapsed:expandedElementLayers.has(item.id);
   const collapse=document.createElement('button');collapse.type='button';collapse.dataset.action='collapse';collapse.className='layer-collapse';collapse.textContent=expanded?'▾':'▸';collapse.title=(expanded?'折叠':'展开')+(isGroup?'图层组':'图层内容');collapse.setAttribute('aria-label',collapse.title+' '+item.name);collapse.setAttribute('aria-expanded',expanded);
   collapse.onclick=()=>{blurEditor();if(isGroup){checkpoint();item.collapsed=!item.collapsed;changed();}else{if(expanded)expandedElementLayers.delete(item.id);else expandedElementLayers.add(item.id);renderLayers();}};row.append(collapse);
   const select=document.createElement('button');select.className='layer-select';select.setAttribute('aria-pressed',chosen.includes(item.id));select.title=`选择图层 ${item.name} · 双击重命名 · 拖动调整顺序 · 右键操作`;select.draggable=true;
   const count=document.createElement('small');count.textContent=item.kind==='group'?'组':item.pathIds.length+item.imageIds.length+item.textIds.length;select.append(count,document.createTextNode(item.name));
   select.onclick=e=>{if(e.detail>1)return;chooseLayer(item.id,e.shiftKey||e.metaKey||e.ctrlKey);};
   select.ondblclick=e=>{e.preventDefault();renameLayer(item.id);};row.append(select);
   select.ondragstart=e=>{hideMenu();draggedLayer=item.id;e.dataTransfer.setData('application/x-curve-editor-layer',item.id);e.dataTransfer.effectAllowed='move';row.classList.add('layer-dragging');};
   select.ondragend=()=>{draggedLayer=null;clearLayerDropMarks();};
   row.ondragover=e=>{if(!draggedLayer)return;e.preventDefault();e.dataTransfer.dropEffect='move';clearLayerDropMarks();if(draggedLayer!==item.id)row.classList.add(e.clientY<row.getBoundingClientRect().top+row.offsetHeight/2?'drop-before':'drop-after');};
   row.ondragleave=e=>{if(!row.contains(e.relatedTarget)){row.classList.remove('drop-before','drop-after');}};
   row.ondrop=e=>{if(!draggedLayer)return;e.preventDefault();e.stopPropagation();const source=draggedLayer,before=e.clientY<row.getBoundingClientRect().top+row.offsetHeight/2;draggedLayer=null;clearLayerDropMarks();moveLayer(source,item.id,before);};
   bindElementDrop(row,item,row);
   row.oncontextmenu=e=>layerMenu(e,item.id);
   select.onkeydown=e=>{if(composing(e))return;if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();const r=row.getBoundingClientRect();layerMenu({preventDefault(){},clientX:r.left+20,clientY:r.bottom},item.id);}};
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
    b.onclick=()=>{blurEditor();checkpoint();item[key]=!item[key];const layers=layerSelection.slice(),paths=selection.slice(),images=imageSelection.slice(),texts=textSelection.slice();selectElements(paths,images,texts);layerSelection=layers;activeLayer=item.id;drawing=false;changed();};
   }
   const remove=document.createElement('button');remove.type='button';remove.dataset.action='delete';remove.title='删除图层 '+item.name;remove.setAttribute('aria-label',remove.title);
   const trash=el('svg',{viewBox:'0 0 24 24','aria-hidden':'true',focusable:'false'},remove);el('path',{d:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7'},trash);
   remove.onclick=()=>deleteLayer(item.id);row.append(remove);
   list.append(row);
   if(!isGroup)list.append(layerContents(item,depth,expanded));
  }
  }else for(const row of list.children){const active=row.dataset.layer===activeLayer;row.classList.toggle('active',active);row.classList.toggle('selected',chosen.includes(row.dataset.layer));row.querySelector('.layer-select')?.setAttribute('aria-pressed',chosen.includes(row.dataset.layer));}
  $('add-layer').disabled=doc.layers.length>=200;
  $('group-layers').disabled=chosen.length<2||doc.layers.length>=200;$('merge-layers').disabled=chosen.length<2;
  $('ungroup-layers').disabled=chosen.length!==1||doc.layers.find(l=>l.id===chosen[0])?.kind!=='group';
 }
 function layerContents(layer,depth,expanded){
  const contents=document.createElement('div');contents.className='layer-contents';contents.dataset.owner=layer.id;contents.hidden=!expanded;contents.style.marginLeft=`${18+depth*14}px`;
  const header=[...$('layer-list').children].find(row=>row.dataset.layer===layer.id);bindElementDrop(contents,layer,header);
  for(const ref of L.items(doc,layer)){
   if(ref.type==='path'){contents.append(curveRow(doc.paths.find(p=>p.id===ref.id)));continue;}
   const isImage=ref.type==='image',item=(isImage?doc.images:doc.texts).find(i=>i.id===ref.id),b=document.createElement('button');b.type='button';b.dataset[ref.type]=item.id;
   b.textContent=(isImage?'图片：':'文字：')+(isImage?item.name:item.content.split('\n')[0].slice(0,40));b.title=isImage?item.name:item.content;b.disabled=!L.editable(doc,item.id,ref.type);b.setAttribute('aria-pressed',(isImage?imageSelection:textSelection).includes(item.id));
   b.draggable=!b.disabled;b.ondragstart=e=>startElementDrag(e,ref.type,item.id,b);b.ondragend=finishElementDrag;
   b.onclick=e=>{blurEditor();setTool('select',true);const toggle=ids=>ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id];selectElements(e.shiftKey?selection:[],isImage?(e.shiftKey?toggle(imageSelection):[item.id]):e.shiftKey?imageSelection:[],!isImage?(e.shiftKey?toggle(textSelection):[item.id]):e.shiftKey?textSelection:[]);render();};contents.append(b);
  }
  if(!contents.children.length){const empty=document.createElement('p');empty.textContent='空图层';contents.append(empty);}return contents;
 }

 function selectedLayerIds(){return L.roots(doc,layerSelection.length?layerSelection:selection.length||imageSelection.length||textSelection.length?[activeLayer]:[]);}
 function chooseLayer(id,multiple=false){
  blurEditor();const ids=multiple?selectedLayerIds().slice():[];
  if(multiple&&ids.includes(id))ids.splice(ids.indexOf(id),1);else ids.push(id);
  const roots=L.roots(doc,ids),layer=doc.layers.find(l=>l.id===id),members=roots.flatMap(id=>L.family(doc,id));
  selectElements(members.flatMap(l=>l.pathIds),members.flatMap(l=>l.imageIds),members.flatMap(l=>l.textIds||[]));
  if(roots.length>1||layer?.kind==='group'||['node','select'].includes(tool))tool='select';
  if(members.length)showPanel('properties',false,false);
  layerSelection=roots;activeLayer=id;drawing=false;render(true);
 }
 function organizeLayers(action){
  blurEditor();hideMenu();const ids=selectedLayerIds();
  try{
   // Validate on a copy before starting a history step or changing the artwork.
   const copy=clone(doc);if(action==='group')L.group(copy,ids);else if(action==='merge')L.merge(copy,ids);else L.ungroup(copy,ids[0]);
   checkpoint();let next;
   if(action==='ungroup')next=L.ungroup(doc,ids[0]);else next=[(action==='group'?L.group(doc,ids):L.merge(doc,ids)).id];
   selectPaths([]);layerSelection=next;activeLayer=next.at(-1)||doc.layers.at(-1).id;drawing=false;changed(action==='group'?'所选图层已成组，可整体移动或解组':action==='merge'?'所选图层已合并，内容仍可编辑，可撤销':'图层组已解组，可撤销');
  }catch(err){status(err.message);}
 }
 $('group-layers').onclick=()=>organizeLayers('group');$('ungroup-layers').onclick=()=>organizeLayers('ungroup');$('merge-layers').onclick=()=>organizeLayers('merge');
 function renderTransform(){
  const b=L.bounds(doc,selection,imageSelection,textSelection),count=selection.length+imageSelection.length+textSelection.length;
  const select=$('element-layer'),owners=new Set([...selection.map(id=>L.layerFor(doc,id)),...imageSelection.map(id=>L.layerFor(doc,id,'image')),...textSelection.map(id=>L.layerFor(doc,id,'text'))].filter(Boolean).map(l=>l.id));
  select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=count?'跨图层':'未选择元素';placeholder.disabled=true;select.append(placeholder);
  for(const layer of L.ordered(doc).slice().reverse()){
   const names=[layer.name];let parent=doc.layers.find(l=>l.id===layer.parentId);while(parent){names.unshift(parent.name);parent=doc.layers.find(l=>l.id===parent.parentId);}
   const option=document.createElement('option'),state=L.state(doc,layer);option.value=layer.id;option.textContent=names.join(' / ')+(state.locked?'（锁定）':!state.visible?'（隐藏）':'');option.disabled=!L.writable(doc,layer);select.append(option);
  }
  select.disabled=!count;select.value=owners.size===1?[...owners][0]:'';
  $('element-physical-size').textContent=window.CurveVectorFiles.physicalSize(b,doc.calibration);
  const rotatedImage=selectedImages().some(i=>i.rotation%360);
  $('keep-ratio').disabled=!!textSelection.length||rotatedImage;if(textSelection.length||rotatedImage)$('keep-ratio').checked=true;
  $('keep-ratio').title=rotatedImage?'已旋转图片缩放需保持宽高比例':textSelection.length?'文字缩放需保持宽高比例':'';
  $('element-count').textContent=count?`${count} 个元素`:'未选择';$('delete-element').disabled=!count;
  for(const key of ['x','y','width','height']){const input=$('element-'+key);input.disabled=!b||((key==='width'||key==='height')&&b[key]<1e-9);if(document.activeElement!==input)input.value=b?Number(b[key].toFixed(4)):'';}
  const canTransform=!!b&&!!count;
  const canRotate=!!rotationBounds(),includesLocked=rotationTargets().paths.some(id=>!L.editable(doc,id));
  $('element-rotation').disabled=!canRotate;$('rotate-curves').disabled=!canRotate;
  $('reset-rotation-center').disabled=!canRotate||!currentRotationPivot();
  $('rotation-center-info').textContent=!canRotate?'选中曲线后可拖动中心标记':(currentRotationPivot()?'旋转中心：自定义位置':'旋转中心：选框中心')+(includesLocked?' · 包含锁定曲线':'');
  $('element-scale-factor').disabled=!canTransform;$('scale-elements').disabled=!canTransform;$('scale-keep-original').disabled=!canTransform;
 }
 function changeElementLayer(targetId,ids={paths:selection,images:imageSelection,texts:textSelection},reveal=false){
  blurEditor();
  try{
   const draft={...doc,layers:clone(doc.layers)},count=L.moveElements(draft,ids.paths,ids.images,ids.texts,targetId);if(!count){renderTransform();return;}
   checkpoint();doc.layers=draft.layers;selectElements(ids.paths,ids.images,ids.texts);activeLayer=targetId;drawing=false;if(reveal)expandedElementLayers.add(targetId);changed(`已将 ${count} 个元素移到“${currentLayer().name}”，可撤销`);
  }catch(err){status(err.message);renderTransform();}
 }
 $('element-layer').onchange=e=>changeElementLayer(e.currentTarget.value);
 function clearElementDropMarks(){$('layer-list').querySelectorAll('.element-drop-target,.element-drop-blocked').forEach(row=>row.classList.remove('element-drop-target','element-drop-blocked'));}
 function finishElementDrag(){draggedElements=null;draggedCurve=null;clearElementDropMarks();clearCurveDropMarks();$('layer-list').querySelectorAll('.element-dragging').forEach(row=>row.classList.remove('element-dragging'));}
 function startElementDrag(e,type,id,row){
  if(e.target.closest('.curve-visibility,input')||!L.editable(doc,id,type)){e.preventDefault();return;}
  blurEditor();hideMenu();const ids=type==='path'?selection:type==='image'?imageSelection:textSelection;
  if(!ids.includes(id))selectElements(type==='path'?[id]:[],type==='image'?[id]:[],type==='text'?[id]:[]);
  draggedElements={paths:selection.slice(),images:imageSelection.slice(),texts:textSelection.slice()};draggedCurve=type==='path'?id:null;
  e.dataTransfer.setData('application/x-curve-editor-elements',JSON.stringify(draggedElements));e.dataTransfer.effectAllowed='move';row.classList.add('element-dragging');if(draggedCurve){e.dataTransfer.setData('application/x-curve-editor-curve',id);row.classList.add('curve-dragging');}render(true);
 }
 function bindElementDrop(target,layer,header){
  target.addEventListener('dragover',e=>{if(!draggedElements)return;e.preventDefault();e.stopPropagation();clearElementDropMarks();clearCurveDropMarks();const allowed=L.writable(doc,layer);e.dataTransfer.dropEffect=allowed?'move':'none';header.classList.add(allowed?'element-drop-target':'element-drop-blocked');});
  target.addEventListener('dragleave',e=>{if(!target.contains(e.relatedTarget))header.classList.remove('element-drop-target','element-drop-blocked');});
  target.addEventListener('drop',e=>{if(!draggedElements)return;e.preventDefault();e.stopPropagation();const ids=draggedElements;finishElementDrag();if(!L.writable(doc,layer)){status('请选择已显示且未锁定的普通图层');return;}changeElementLayer(layer.id,ids,true);});
 }
 function curveSortTarget(path){const layer=L.layerFor(doc,path.id);return draggedCurve&&draggedElements&&!draggedElements.images.length&&!draggedElements.texts.length&&draggedElements.paths.every(id=>L.layerFor(doc,id)===layer);}
 function addLayer(){blurEditor();checkpoint();try{activeLayer=L.addLayer(doc,`图层 ${doc.layers.length+1}`).id;selectPaths([]);drawing=false;changed('新图层已创建，可在此画线');}catch(err){status(err.message);}}
 $('all-layers-selected').onchange=e=>{
  const checked=e.currentTarget.checked;blurEditor();endDrag();
  const active=activeLayer;setTool('select',true);
  if(checked){selectElements(doc.paths.map(item=>item.id),doc.images.map(item=>item.id),doc.texts.map(item=>item.id));layerSelection=L.roots(doc,doc.layers.map(layer=>layer.id));}
  else selectPaths([]);
  activeLayer=active;drawing=false;render(true);
 };
 $('all-layers-visible').onclick=()=>{
  blurEditor();checkpoint();const visible=!doc.layers.every(layer=>layer.visible),layers=layerSelection.slice(),paths=selection.slice(),images=imageSelection.slice(),texts=textSelection.slice();
  doc.layers.forEach(layer=>{layer.visible=visible;});selectElements(paths,images,texts);layerSelection=layers;drawing=false;changed(visible?'已显示全部图层，可撤销':'已隐藏全部图层，可撤销');
 };
 $('add-layer').onclick=addLayer;
 function clearLayerDropMarks(){$('layer-list').querySelectorAll('.drop-before,.drop-after,.layer-dragging').forEach(row=>row.classList.remove('drop-before','drop-after','layer-dragging'));}
 function moveLayer(sourceId,targetId,before){
  if(sourceId===targetId)return;
  const sourceLayer=doc.layers.find(l=>l.id===sourceId),targetLayer=doc.layers.find(l=>l.id===targetId);
  if(!sourceLayer||!targetLayer||L.family(doc,sourceId).includes(targetLayer))return;
  const ordered=doc.layers.slice().reverse(),source=ordered.find(l=>l.id===sourceId);if(!source||!ordered.some(l=>l.id===targetId))return;
  ordered.splice(ordered.indexOf(source),1);ordered.splice(ordered.findIndex(l=>l.id===targetId)+(before?0:1),0,source);ordered.reverse();
  if(ordered.every((l,i)=>l===doc.layers[i])&&(source.parentId??null)===(targetLayer.parentId??null))return;
  blurEditor();checkpoint();if(targetLayer.parentId!=null)source.parentId=targetLayer.parentId;else delete source.parentId;doc.layers=ordered;drawing=false;changed('图层顺序已调整，可撤销');
 }
 function renameLayer(id){
  blurEditor();hideMenu();
  const layer=doc.layers.find(l=>l.id===id),row=[...$('layer-list').children].find(r=>r.dataset.layer===id);if(!layer||!row)return;
  const select=row.querySelector('.layer-select');
  const input=document.createElement('input');input.className='layer-rename';input.value=layer.name;input.maxLength=80;input.setAttribute('aria-label','图层名称');input.title='失焦或 Enter 确认，Esc 取消';
  let done=false;
  const finishName=(cancel,restoreFocus=false)=>{
   if(done)return;done=true;const name=input.value.trim().slice(0,80);
   // Keep sibling controls mounted so the click that ends renaming can complete.
   input.replaceWith(select);
   if(!cancel&&name&&name!==layer.name){checkpoint();layer.name=name;edits.commit(snapshot());updateDirty();renderHistory();status('图层已重命名，可撤销');}
   select.lastChild.textContent=layer.name;select.title=`选择图层 ${layer.name} · 双击重命名 · 拖动调整顺序 · 右键操作`;
   for(const control of row.querySelectorAll('[data-action]')){
    const remove=control.dataset.action==='delete';if(remove)control.title='删除图层 '+layer.name;
    control.setAttribute('aria-label',control.title+(remove?'':' '+layer.name));
   }
   if(restoreFocus)select.focus({preventScroll:true});
  };
  input.onblur=()=>finishName(false);input.onkeydown=e=>{if(composing(e))return;if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopPropagation();finishName(e.key==='Escape',true);}};
  select.replaceWith(input);input.focus();input.select();
 }
 function deleteLayer(id){
  blurEditor();const layer=doc.layers.find(l=>l.id===id);if(!layer)return;checkpoint();
  const members=L.family(doc,id),paths=members.flatMap(l=>l.pathIds),images=members.flatMap(l=>l.imageIds),texts=members.flatMap(l=>l.textIds||[]);
  doc.paths=doc.paths.filter(p=>!paths.includes(p.id));doc.images=doc.images.filter(i=>!images.includes(i.id));doc.texts=doc.texts.filter(t=>!texts.includes(t.id));doc.layers=doc.layers.filter(l=>!members.includes(l));
  if(!doc.layers.length)L.addLayer(doc,'曲线图层');if(!doc.layers.some(l=>l.id===activeLayer))activeLayer=doc.layers.at(-1).id;
  selectPaths([]);drawing=false;measurement=null;changed('图层及其中的元素已删除，可撤销');
 }
 function layerMenu(e,id=null){
  e.preventDefault();blurEditor();hideMenu();
  const layer=doc.layers.find(l=>l.id===id);
  if(layer){if(!selectedLayerIds().includes(id))chooseLayer(id);else{activeLayer=id;drawing=false;render();}}
  startMenu(layer?layer.name+' · 图层操作':'图层操作');
  menuAction('粘贴元素',pasteCurveClipboard,!L.writable(doc,currentLayer()),'以鼠标最后停留的画布位置作为整体左上角，保留实际尺寸');
  if(layer){
   const ids=selectedLayerIds(),top=L.children(doc,layer.parentId??null).at(-1);
   menuAction('成组',()=>organizeLayers('group'),ids.length<2||doc.layers.length>=200,'将所选图层放入可解组的图层组');
   menuAction('解组',()=>organizeLayers('ungroup'),ids.length!==1||layer.kind!=='group');
   menuAction('合并图层',()=>organizeLayers('merge'),ids.length<2,'合并归属，保留曲线节点、图片、文字及叠放顺序');
   menuAction('置顶',()=>moveLayer(id,top.id,true),id===top.id,'一次移到所在组的最上层，之后仍可调整顺序');
   menuAction('导出所选图层…',()=>vectorFiles.openExport(true));
   menuAction('重命名图层',()=>renameLayer(id));menuAction('删除图层',()=>deleteLayer(id));
  }
  menuAction('新建图层',addLayer,doc.layers.length>=200);menuAction('导入图片',()=>$('image-file').click());showMenuAt(e);
 }
 $('layer-list').addEventListener('contextmenu',e=>{if(!e.target.closest('.layer-row,.layer-contents'))layerMenu(e);});
 function clearCurveDropMarks(){$('layer-list').querySelectorAll('.drop-before,.drop-after,.curve-dragging').forEach(row=>row.classList.remove('drop-before','drop-after','curve-dragging'));}
 function moveCurve(sourceId,targetId,before){
  if(sourceId===targetId||!L.editable(doc,sourceId))return;
  const ordered=doc.paths.slice(),source=ordered.find(p=>p.id===sourceId);if(!source||!ordered.some(p=>p.id===targetId))return;
  ordered.splice(ordered.indexOf(source),1);ordered.splice(ordered.findIndex(p=>p.id===targetId)+(before?0:1),0,source);
  if(ordered.every((p,i)=>p===doc.paths[i]))return;
  blurEditor();checkpoint();doc.paths=ordered;L.syncPathOrder(doc);drawing=false;changed('曲线顺序已调整，可撤销');
 }
 function renameCurve(id){
  blurEditor();hideMenu();
  const path=doc.paths.find(p=>p.id===id),row=[...$('layer-list').querySelectorAll('.curve-item')].find(b=>b.dataset.path===id);if(!path||!row||!L.editable(doc,id))return;
  const button=row.querySelector('.curve-select'),editor=document.createElement('div');editor.className='curve-select';row.classList.add('curve-renaming');row.draggable=false;
  const input=document.createElement('input');input.className='curve-rename';input.value=path.name;input.maxLength=80;input.setAttribute('aria-label','曲线名称');input.title='失焦或 Enter 确认，Esc 取消';
  editor.append(button.querySelector('i').cloneNode(true),input,button.querySelector('small').cloneNode(true));
  let done=false;
  const finishName=(cancel,restoreFocus=false)=>{
   if(done)return;done=true;const name=input.value.trim().slice(0,80);
   // Preserve the other rows so the click that blurs this input still selects them.
   editor.replaceWith(button);row.classList.remove('curve-renaming');row.draggable=L.editable(doc,id);
   if(!cancel&&name&&name!==path.name){checkpoint();path.name=name;edits.commit(snapshot());updateDirty();renderHistory();status('曲线已重命名，可撤销');}
   button.querySelector('span').textContent=path.name;row.title=`${path.name} · 双击重命名 · 拖动调整顺序 · 右键操作`;
   const eye=row.querySelector('.curve-visibility');eye.title=`${path.visible===false?'显示':'隐藏'}曲线 ${path.name}`;eye.setAttribute('aria-label',eye.title);
   const lock=row.querySelector('.curve-lock');lock.title=`${curveLocked(id)?'解锁':'锁定'}曲线 ${path.name}`;lock.setAttribute('aria-label',lock.title);
   if(selected===id&&selection.length===1)$('path-name').value=path.name;
   if(restoreFocus)button.focus({preventScroll:true});
  };
  input.onblur=()=>finishName(false);input.onkeydown=e=>{if(composing(e))return;if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopPropagation();finishName(e.key==='Escape',true);}};
  button.replaceWith(editor);input.focus();input.select();
 }
 function toggleCurveVisibility(id){
  blurEditor();hideMenu();const path=doc.paths.find(p=>p.id===id),layer=L.layerFor(doc,id);
  if(!path||!L.state(doc,layer).visible||L.state(doc,layer).locked)return;
  checkpoint();path.visible=path.visible===false;
  selection=selection.filter(id=>L.editable(doc,id));nodeSelection=nodeSelection.filter(n=>L.editable(doc,n.pathId));
  if(!selection.includes(selected)){selected=selection.at(-1)||null;ni=null;}
  drawing=false;changed(`曲线已${path.visible?'显示':'隐藏'}，可撤销`);
 }
 function curveLocked(id){return L.layerFor(doc,id)?.items?.some(item=>item.type==='path'&&item.id===id&&item.locked)===true;}
 function toggleCurveLock(id){
  blurEditor();hideMenu();endDrag();const path=doc.paths.find(p=>p.id===id),layer=L.layerFor(doc,id);
  if(!path||!L.writable(doc,layer)||replay)return;
  fitting.stop();checkpoint();const locked=!curveLocked(id);layer.items=L.items(doc,layer).map(item=>item.type==='path'&&item.id===id?{...item,locked}:item);
  drawing=false;drawingEnd=null;measurement=null;
  changed(locked?'曲线已锁定，不能单独编辑；选中所属图层仍可旋转，可撤销':'曲线已解锁，可继续编辑，可撤销');
 }
 function renderCurves(){
  for(const row of $('layer-list').querySelectorAll('.curve-item')){const pressed=selection.includes(row.dataset.path);row.setAttribute('aria-pressed',pressed);row.querySelector('.curve-select')?.setAttribute('aria-pressed',pressed);}
  for(const button of $('layer-list').querySelectorAll('[data-image],[data-text]'))button.setAttribute('aria-pressed',button.dataset.image?imageSelection.includes(button.dataset.image):textSelection.includes(button.dataset.text));
 }
 function curveRow(path){
   const b=document.createElement('div');b.className='curve-item';b.dataset.path=path.id;b.draggable=L.editable(doc,path.id);b.setAttribute('aria-pressed',selection.includes(path.id));b.title=`${path.name} · 双击重命名 · 拖动调整顺序 · 右键操作`;
   const select=document.createElement('button');select.type='button';select.className='curve-select';select.disabled=!L.editable(doc,path.id);select.setAttribute('aria-pressed',selection.includes(path.id));
   const sw=document.createElement('i');sw.style.background=path.color;const label=document.createElement('span');label.textContent=path.name;const count=document.createElement('small');count.textContent=`${path.nodes.length} 点`;select.append(sw,label,count);b.append(select);
   const eye=document.createElement('button');eye.type='button';eye.className='curve-visibility';eye.dataset.action='visible';eye.disabled=!L.state(doc,L.layerFor(doc,path.id)).visible||L.state(doc,L.layerFor(doc,path.id)).locked;eye.title=`${path.visible===false?'显示':'隐藏'}曲线 ${path.name}`;eye.setAttribute('aria-label',eye.title);eye.setAttribute('aria-pressed',path.visible!==false);
   const icon=el('svg',{viewBox:'0 0 24 24','aria-hidden':'true',focusable:'false'},eye);el('path',{d:'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z'},icon);el('circle',{cx:12,cy:12,r:3},icon);if(path.visible===false)el('path',{d:'m3 3 18 18'},icon);
   eye.onclick=e=>{e.stopPropagation();toggleCurveVisibility(path.id);};eye.ondblclick=e=>e.stopPropagation();eye.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();};b.append(eye);
   const locked=curveLocked(path.id),lock=document.createElement('button');lock.type='button';lock.className='curve-lock';lock.dataset.action='locked';lock.disabled=!L.writable(doc,L.layerFor(doc,path.id));lock.title=`${locked?'解锁':'锁定'}曲线 ${path.name}`;lock.setAttribute('aria-label',lock.title);lock.setAttribute('aria-pressed',locked);b.dataset.locked=String(locked);
   const lockIcon=el('svg',{viewBox:'0 0 24 24','aria-hidden':'true',focusable:'false'},lock);el('rect',{x:5,y:10,width:14,height:11,rx:2},lockIcon);el('path',{d:locked?'M8 10V7a4 4 0 0 1 8 0v3':'M8 10V7a4 4 0 0 1 7.5-2'},lockIcon);el('path',{d:'M12 15v2'},lockIcon);
   lock.onclick=e=>{e.stopPropagation();toggleCurveLock(path.id);};lock.ondblclick=e=>e.stopPropagation();lock.oncontextmenu=e=>{e.preventDefault();e.stopPropagation();};b.append(lock);
   b.onclick=e=>{if(e.detail>1||e.target.closest('input')||!L.editable(doc,path.id))return;blurEditor();drawing=false;if(e.shiftKey){togglePath(path.id);render(true);}else{selectPaths([path.id]);setTool('node',true);}};
   label.ondblclick=e=>{e.preventDefault();renameCurve(path.id);};
   b.oncontextmenu=e=>curveListMenu(e,path);
   b.ondragstart=e=>startElementDrag(e,'path',path.id,b);
   b.ondragend=finishElementDrag;
   b.ondragover=e=>{if(!curveSortTarget(path))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';clearCurveDropMarks();if(draggedCurve!==path.id)b.classList.add(e.clientY<b.getBoundingClientRect().top+b.offsetHeight/2?'drop-before':'drop-after');};
   b.ondragleave=e=>{if(!b.contains(e.relatedTarget))b.classList.remove('drop-before','drop-after');};
   b.ondrop=e=>{if(!curveSortTarget(path))return;e.preventDefault();e.stopPropagation();const source=draggedCurve,before=e.clientY<b.getBoundingClientRect().top+b.offsetHeight/2;finishElementDrag();moveCurve(source,path.id,before);};
  return b;
 }
 function deleteElements(){if(!selection.length&&!imageSelection.length&&!textSelection.length)return;blurEditor();checkpoint();doc.paths=doc.paths.filter(p=>!selection.includes(p.id));doc.images=doc.images.filter(i=>!imageSelection.includes(i.id));doc.texts=doc.texts.filter(t=>!textSelection.includes(t.id));selectPaths([]);drawing=false;measurement=null;changed('所选元素已删除，可撤销');}
 $('delete-element').onclick=deleteElements;
 function recolorCurves(paths){
  const palette=['#e04544','#176bce','#13816c','#9858b1','#c47713','#c43283','#087f8c','#78513e'],used=new Set(doc.paths.map(p=>p.color.toLowerCase()));
  for(const path of paths){
   const previous=path.color.toLowerCase();
   path.color=palette.find(color=>color!==previous&&!used.has(color))||palette[(palette.indexOf(previous)+1)%palette.length];used.add(path.color);
  }
 }
 function copyScaleSelection(draft){
  const ids={paths:[],images:[],texts:[]},itemCopies=new Map(),suffix=' · 缩放副本';
  for(const [key,selectedIds,type,refs,limit,label] of [['paths',selection,'path','pathIds',500,'条曲线'],['images',imageSelection,'image','imageIds',200,'张图片'],['texts',textSelection,'text','textIds',500,'段文字']]){
   const sources=draft[key].filter(item=>selectedIds.includes(item.id));
   if(draft[key].length+sources.length>limit)throw new Error(`最多支持 ${limit} ${label}，请先整理后再生成副本`);
   for(const source of sources){
    const copy={...clone(source),id:uid(),name:source.name.slice(0,80-suffix.length)+suffix},layer=L.layerFor(draft,source.id,type);
    if(key==='paths')stripSymmetry(copy);draft[key].push(copy);layer[refs].push(copy.id);ids[key].push(copy.id);itemCopies.set(`${type}\0${source.id}`,copy.id);
   }
  }
  for(const path of draft.paths.filter(p=>ids.paths.includes(p.id)))if(path.sourceImageId){const mapped=itemCopies.get(`image\0${path.sourceImageId}`);if(mapped)path.sourceImageId=mapped;else delete path.sourceImageId;}
  for(const source of doc.texts){
   const copyId=itemCopies.get(`text\0${source.id}`),path=L.positionLabelPath(doc,source),pathId=path&&itemCopies.get(`path\0${path.id}`);
   if(copyId&&pathId)draft.texts.find(t=>t.id===copyId).positionMarker.pathId=pathId;
  }
  // Keep the copied curves, images and text in the same relative draw order.
  for(const layer of draft.layers){
   const original=L.items(doc,doc.layers.find(l=>l.id===layer.id)),copies=original.filter(item=>itemCopies.has(`${item.type}\0${item.id}`)).map(item=>({...item,id:itemCopies.get(`${item.type}\0${item.id}`)}));
   if(copies.length)layer.items=[...original.map(item=>({...item})),...copies];
  }
  return ids;
 }
 function scaleElements(){
  const input=$('element-scale-factor'),factor=Number(input.value),b=L.bounds(doc,selection,imageSelection,textSelection);
  if(!b)return;
  if(!input.value.trim()||!Number.isFinite(factor)||factor<=0){status('请输入大于零的有效缩放倍数');return;}
  if(factor===1){input.value='1';return;}
  blurEditor();const keepOriginal=$('scale-keep-original').checked,draft={...doc,paths:clone(doc.paths),layers:clone(doc.layers),images:doc.images.map(i=>({...i})),texts:clone(doc.texts)};
  let ids={paths:selection,images:imageSelection,texts:textSelection};
  const target={x:b.x+b.width*(1-factor)/2,y:b.y+b.height*(1-factor)/2,width:b.width*factor,height:b.height*factor};
  try{if(keepOriginal)ids=copyScaleSelection(draft);L.transform(draft,ids.paths,ids.images,b,target,ids.texts);recolorCurves(draft.paths.filter(path=>ids.paths.includes(path.id)));}catch(err){status(err.message);return;}
  checkpoint();doc.paths=draft.paths;doc.images=draft.images;doc.texts=draft.texts;if(draft.symmetryLinks)doc.symmetryLinks=draft.symmetryLinks;
  if(keepOriginal){doc.layers=draft.layers;selectElements(ids.paths,ids.images,ids.texts);tool='select';drawing=false;drawingEnd=null;}
  measurement=null;input.value='1';const colorHint=ids.paths.length?'，曲线已换色':'';
  changed(keepOriginal?`已保留原件并生成 ${factor} 倍缩放副本${colorHint}，可撤销`:`所选元素已等比缩放到原来的 ${factor} 倍${colorHint}，保持选中，可撤销`);
 }
 $('scale-elements').onclick=scaleElements;
 $('element-scale-factor').addEventListener('keydown',e=>{if(composing(e))return;if(e.key==='Enter'){e.preventDefault();scaleElements();}});
 function rotateElements(){
  const input=$('element-rotation'),degrees=Number(input.value),b=rotationBounds();
  if(!b)return;
  if(!input.value.trim()||!Number.isFinite(degrees)){status('请输入有效的旋转角度');return;}
  if(degrees%360===0){input.value='0';return;}
  blurEditor();const draft={...doc,paths:clone(doc.paths),images:doc.images.map(i=>({...i})),texts:clone(doc.texts)};
  try{L.rotateElements(draft,selection,imageSelection,rotationCenter(b),degrees,textSelection,layerSelection);}catch(err){status(err.message);return;}
  checkpoint();doc.paths=draft.paths;doc.images=draft.images;doc.texts=draft.texts;if(draft.symmetryLinks)doc.symmetryLinks=draft.symmetryLinks;measurement=null;input.value='0';changed(`所选元素已旋转 ${degrees}°，保持选中，可撤销`);
 }
 $('rotate-curves').onclick=rotateElements;
 $('reset-rotation-center').onclick=()=>{blurEditor();cancelRotationCenterDrag();rotationPivot=null;scheduleSession();render();status('旋转中心已恢复为选框中心');};
 $('element-rotation').addEventListener('keydown',e=>{if(composing(e))return;if(e.key==='Enter'){e.preventDefault();rotateElements();}});
 for(const key of ['x','y','width','height']){
  const input=$('element-'+key);input.onchange=()=>{
   const b=L.bounds(doc,selection,imageSelection,textSelection),value=Number(input.value);if(!b)return;
   if(!input.value.trim()||!Number.isFinite(value)||((key==='width'||key==='height')&&value<=0)){status('请输入有效的位置或大于零的尺寸');renderTransform();return;}
   if(value===b[key])return;const target={...b,[key]:value};
   if(($('keep-ratio').checked||textSelection.length)&&b.width>1e-9&&b.height>1e-9){if(key==='width')target.height=b.height*value/b.width;if(key==='height')target.width=b.width*value/b.height;}
   checkpoint();try{L.transform(doc,selection,imageSelection,b,target,textSelection);measurement=null;changed('元素位置与尺寸已更新，可撤销');}catch(err){status(err.message);render();}
  };
  input.addEventListener('keydown',e=>{if(composing(e))return;if(e.key==='Enter'){e.preventDefault();input.blur();}});
 }
 // Selection refreshes keep rows mounted so native double clicks reach the same name.
 function render(keepLists=false){
  if(!replay&&!drag&&!editingField&&!pendingConnection)edits.commit(snapshot());
  renderCanvas();renderTraceSettings();imageRegion?.update();
  renderHistory();
  renderLayers(keepLists);renderTransform();renderTextProperties();
  const p=selectedPath(),n=selectedNode(),curves=selectedCurves(),nodes=selectedNodes(),segment=editingSegment(),multiple=curves.length>1;
  $('selection-count').textContent=axisSelected?'已选对称轴':segment?`已选第 ${segment.index+1} 段`:tool==='node'&&nodes.length?`已选 ${nodes.length} 个节点`:curves.length+imageSelection.length+textSelection.length?`已选 ${curves.length+imageSelection.length+textSelection.length} 个元素`:'未选择';
  $('select-all').disabled=!editablePaths().length&&!doc.images.some(i=>L.editable(doc,i.id,'image'))&&!selectedTexts().length&&!doc.texts.some(t=>L.editable(doc,t.id,'text'));$('deselect').disabled=!axisSelected&&!curves.length&&!imageSelection.length&&!textSelection.length;
  $('copy-curves').disabled=!hasCopyElements();
  $('copy-curves').title=`复制所选${segment?'线段':'元素'} · ⌘ / Ctrl + C`;
  $('paste-curves').disabled=!L.writable(doc,currentLayer());
  $('properties-title').textContent=multiple?`已选 ${curves.length} 条曲线`:'当前曲线';
  renderCurves(keepLists);
  for(const id of ['path-name','path-role','path-color','path-note','path-dashed','delete-path'])$(id).disabled=!p;
  $('path-dashed').checked=curves.length>0&&curves.every(p=>p.dashed);$('path-dashed').indeterminate=curves.some(p=>p.dashed)&&!curves.every(p=>p.dashed);
  $('path-name').disabled=!p||multiple;$('path-note').disabled=!p||multiple;
  $('delete-path').textContent=multiple?`删除选中的 ${curves.length} 条曲线`:'删除这条曲线';
  if(document.activeElement!==$('path-name'))$('path-name').value=multiple?'':p?.name||'';
  $('path-role').value=p?.role||'outline';$('path-color').value=p?.color||'#e04544';
  const pathColors=new Set(curves.map(path=>path.color.toLowerCase()));
  for(const button of $('path-color-presets').children){button.disabled=!curves.length;button.setAttribute('aria-pressed',pathColors.size===1&&pathColors.has(button.dataset.pathColor));}
  $('path-color-info').textContent=curves.length?`已选 ${curves.length} 条曲线${pathColors.size>1?' · 多种颜色':''} · 点色块立即改色`:'选中曲线后点色块即可改色，可多选一起改色。';
  if(document.activeElement!==$('path-note'))$('path-note').value=multiple?'':p?.note||'';
  const nodeMode=nodes.length?nodes.every(item=>item.path.nodes[item.index].mode===nodes[0].path.nodes[nodes[0].index].mode)?nodes[0].path.nodes[nodes[0].index].mode:null:doc.newNodeMode;
  modes.forEach(b=>{b.disabled=false;b.setAttribute('aria-pressed',nodeMode===b.dataset.mode);});
  const modeNames={cusp:'尖角',smooth:'平滑',symmetric:'对称'};
  $('node-mode-hint').textContent=`新节点沿用：${modeNames[doc.newNodeMode]}${n?' · 上方为当前节点类型':''}`;
  for(const axis of ['x','y']){const e=$('node-'+axis);e.disabled=!n;if(document.activeElement!==e)e.value=n?Number(n[axis].toFixed(2)):'';}
  $('node-id').textContent=segment?`第 ${segment.index+1} 段 · J 切换`:nodes.length>1?`已选 ${nodes.length} 点`:n?`第 ${ni+1} 点`:'未选择';$('delete-node').disabled=!nodes.length;$('straight').disabled=!nodes.length;
  const nodeColors=new Set(nodes.map(({path,index})=>path.nodes[index].color));
  $('node-color').disabled=!nodes.length;$('node-color-clear').disabled=!nodes.some(({path,index})=>path.nodes[index].color);
  for(const button of document.querySelectorAll('[data-node-color]')){button.disabled=!nodes.length;button.setAttribute('aria-pressed',nodeColors.size===1&&nodeColors.has(button.dataset.nodeColor));}
  if(document.activeElement!==$('node-color')&&nodeColors.size===1&&nodes[0]?.path.nodes[nodes[0].index].color)$('node-color').value=nodes[0].path.nodes[nodes[0].index].color;
  $('node-color-info').textContent=nodes.length?`已选 ${nodes.length} 点${nodeColors.size>1?' · 多种颜色':''} · 点色块立即改色，拟合时同色随动`:'选中节点后点色块；框选或 Shift 多选可一起改色';
  $('straight').querySelector('span').textContent=segment?'收起手柄 · 直线段':'收起手柄 · 直线节点';
  $('straight').title=segment?'直线段与曲线段切换 · J；点击按钮收起本段手柄':'直线节点与平滑节点切换 · J；点击按钮收起手柄';
  $('delete-node').textContent=nodes.length>1?`删除 ${nodes.length} 个节点`:'删除节点';
  $('break-node').disabled=!breakableNode();
  const notch=notchSelection();$('notch-define').disabled=!!notch.error;$('notch-define').title=notch.error||'将这几个连续节点设为剪口，拟合时保持形状';
  $('notch-clear').disabled=!nodes.some(({path,index})=>path.nodes[index].notchId);
  const simplifyError=simplifySelectionError();$('simplify-curves').disabled=!!simplifyError;$('simplify-curves').title=simplifyError||'简化整条所选曲线，保留轮廓并可一步撤销';
  const span=fairingSelection();$('fair-span').disabled=!!span.error;$('fair-span').title=span.error||'固定首尾点，按允许偏差整理整段曲线，可设置中间必经点';
  const closable=curves.filter(path=>path.nodes.length>=3);
  $('close-path').disabled=!closable.length;$('close-path').textContent=closable.length&&closable.every(path=>path.closed)?'打开曲线':'闭合曲线';$('finish').disabled=!drawing;
  const images=selectedImages(),opacity=images[0]?.opacity??doc.opacity;
  $('opacity').value=opacity*100;$('opacity-value').textContent=`${Math.round(opacity*100)}%`;
  $('image-opacity-hint').textContent=images.length?`已选 ${images.length} 张图片`:'选中图片调透明度';
  $('axis-info').textContent=axisStart?'已定第一点 · 接近水平或竖直自动吸附':doc.mirrorAxis?'已设置对称轴 · 拖端点自由微调，Shift 约束角度；拖轴线平移 · 实时预览':'先选曲线，再点击两点画轴 · 实时预览镜像';
  $('mirror-copy').disabled=!p||!p.nodes.length||!doc.mirrorAxis;$('clear-axis').disabled=!doc.mirrorAxis&&!axisStart;
  $('mirror-copy').textContent=segment?'镜像所选片段':'生成镜像副本';
  renderSymmetryControls();
  $('mirror-copy').title=!doc.mirrorAxis?'请先用“对称轴”（A）点击两点设置轴':segment?'按绘制轴生成所选片段的镜像，按勾选项记住对称关系':'按绘制轴生成镜像，按勾选项记住对称关系';
  const hints={dimension:dimensionStart?'点击第二点完成尺寸标注；靠近节点自动吸附；Esc 取消':'点击两个位置标注直线距离；需要先标定实际比例；标注可保存与导出',position:'节点持续显示；点击节点或曲线连续标注，标注随节点和曲线形状变化，文字保持水平；按 V 选取标注',text:'点击画布选择文字位置；输入内容与字号后创建；F8 切换文字工具',node:'空白处框选节点；选区内拖动整组；Shift 点选增减或追加框选',select:'选区内拖动整组；拖角等比缩放；空白处框选；Shift 追加选择',pen:'点击加点，拖出弧线；右键也可加点或结束',pan:'按住拖动画板；滚轮缩放；右键打开操作菜单',axis:axisStart?'点击第二点完成；接近水平或竖直自动吸附；Shift 约束角度；Esc 取消':doc.mirrorAxis?'拖端点自由微调，Shift 约束角度，Alt 暂停节点吸附；拖轴线平移；绿色为镜像预览':'先选曲线，点击两点画轴；绿色实时预览；靠近节点自动吸附',measure:measureMode==='points'?'连续点击测量直线距离；靠近节点自动吸附；Enter 结束，Backspace 回退':'点选首段，再 Shift 点末段，测量连续线段；闭合曲线可切换另一侧'};
  hints.rectangle='在当前图层拖动画矩形；接近正方形时提示；按住 Shift 绘制正方形；Esc 取消';
  hints.ellipse='在当前图层拖动画椭圆；接近圆形时提示；按住 Shift 绘制圆形；Esc 取消';
  hints.select='拖动整条曲线，端点靠近时松开选择连接或仅保持重合；Alt 自由移动；上方圆柄旋转，拖角缩放';
  hints.node=segment?'已选线段 · J 切换直线 / 曲线；拖动两端手柄调弧度':selection.length&&!nodeSelection.length?'已选曲线 · 拖动整条曲线，端点靠近时松开选择连接或仅保持重合；Alt 自由移动':'点选线段后 J 切换直线 / 曲线；空白处框选节点；Shift 追加选择';
  if(tool==='node'&&nodes.length===1)hints.node='右键端点可继续画线，内部节点可断开连接；靠近对称轴或其他曲线自动吸附；开放端点重合后松开，选择连接或仅保持重合；Alt 自由移动';
  if(tool==='node'&&selection.length===1)hints.node+='；框选只选本曲线节点';
  hints.calibrate=calibrationDraft?.length===2?'输入两点之间的实际长度，选择 mm/cm，再点“应用比例”':`点击第 ${(calibrationDraft?.length||0)+1} 个标定点；靠近节点自动吸附；Esc 取消`;
  hints.trace='指向图片实线或虚线看蓝色预览；点击生成可编辑曲线；Esc 取消';hints.outline='指向物体内部看完整外框；点击生成可编辑闭合曲线；Esc 取消';$('canvas-hint').textContent=fairingDraft?'圆顺预览 · 滚轮缩放，直接拖动画布平移；Esc 取消':temporaryPan()?'临时平移画布 · 松开 Ctrl / 空格恢复原编辑状态':axisSelected?'已选对称轴 · 拖轴线平移，拖端点自动吸附水平/竖直；方向键微调，Shift 加大步长；右键删除':hints[tool];if(simplifyDraft)$('canvas-hint').textContent='简化预览 · 绿色为简化轮廓；滚轮缩放、拖动画布平移；Esc 取消';renderCalibration();if(fitting.active)fitting.render();
 }
 function setTool(t,keepLists=false,keepPendingImport=false){imageRegion?.cancel();if(t!=='calibrate'&&!keepPendingImport)vectorFiles?.cancelPendingImport();if(t==='dimension'&&!doc.calibration){showPanel('measurement');status('请先标定两点的实际距离，再添加尺寸标注');return;}cancelDimensionDrag();dimensionStart=null;if(fitting.ready)fitting.originalMode();else fitting.stop();cancelRotationCenterDrag();cancelAxisDrag();cancelShape();axisSelected=false;mirrorPreviewActive=t==='axis';tracePointer=null;hideMenu();taps.reset();drawing=false;drawingEnd=null;axisStart=null;hoverPoint=null;if(t!=='node')segmentSelection=null;if(t==='select'){ni=null;nodeSelection=[];}if(t==='position'||t==='dimension'){imageSelection=[];textSelection=[];}if(t!=='calibrate')calibrationDraft=null;if(measurement?.kind==='points')measurement.finished=true;tool=t;clearTrace();const panel={dimension:'measurement',position:'properties',text:'properties',select:'properties',node:'curves',pen:'curves',rectangle:'layers',ellipse:'layers',axis:'mirror',measure:'measurement',calibrate:'measurement',trace:'view',outline:'view'}[t];if(panel)showPanel(panel,false,!keepLists);render(keepLists);}
 function togglePath(id){const images=imageSelection.slice(),texts=textSelection.slice();selectPaths(selection.includes(id)?selection.filter(value=>value!==id):[...selection,id],id);imageSelection=images;textSelection=texts;}
 function selectAll(){blurEditor();endDrag();if(tool==='node')selectNodes(editablePaths().flatMap(path=>path.nodes.map((_,index)=>({pathId:path.id,index}))));else{setTool('select');selectElements(editablePaths().map(path=>path.id),doc.images.filter(i=>L.editable(doc,i.id,'image')).map(i=>i.id),doc.texts.filter(t=>L.editable(doc,t.id,'text')).map(t=>t.id));}render();}
 $('select-all').onclick=selectAll;
 $('deselect').onclick=()=>{blurEditor();selectPaths([]);render();};
 function finish(){drawing=false;drawingEnd=null;tool='node';render();scheduleSession();}
 const lengthText=n=>{const result=G.measureLength(n,doc.calibration,doc.measureUnit);return `${result.value.toFixed(2)} ${result.unit}`;};
 function resetAuxiliary(keepFitting=false){vectorFiles?.cancelPendingImport();dimensionStart=null;rotationPivot=null;closeSymmetry();if(!keepFitting)fitting.stop();cancelShape();closeOffset();closeFairing();closeSimplify();clearTrace();tracePointer=null;axisStart=null;hoverPoint=null;axisSelected=false;mirrorPreviewActive=false;measurement=null;calibrationDraft=null;}
 function dimensionSnap(pos,target=null,free=false){
  if(free)return {point:G.point(pos),binding:null};
  const anchor=target?.closest('[data-node][data-path]'),path=doc.paths.find(p=>p.id===anchor?.getAttribute('data-path')),index=Number(anchor?.getAttribute('data-node'));
  if(anchor&&path?.nodes[index]&&L.visible(doc,path.id))return {point:G.point(path.nodes[index]),binding:{pathId:path.id,index}};
  let hit={point:G.point(pos),binding:null},distance=9/camera.z;
  for(const p of doc.paths.filter(p=>L.visible(doc,p.id)))p.nodes.forEach((n,index)=>{const d=G.dist(pos,n);if(d<distance){distance=d;hit={point:G.point(n),binding:{pathId:p.id,index}};}});
  return hit;
 }
 function placeDimension(raw,target){
  const {point:pos,binding}=dimensionSnap(raw,target);

  if(!doc.calibration){status('请先标定实际比例');return;}
  if(!dimensionStart){dimensionStart={x:pos.x,y:pos.y};dimensionStartBinding=binding;hoverPoint=pos;render();status('已选第一点，请点击第二点');return;}
  if(G.dist(dimensionStart,pos)<=1e-6){status('尺寸标注两点不能重合');return;}
  const fontSize=Math.max(1,Math.min(4096,14/camera.z));
  try{
   const candidate=D.resolve({id:uid(),name:'尺寸标注',content:'尺寸',x:0,y:0,fontSize,color:'#1685a6',dimension:{a:dimensionStart,b:{x:pos.x,y:pos.y},offset:fontSize*2,unit:doc.measureUnit==='cm'?'cm':'mm',bindings:{...(dimensionStartBinding?{a:dimensionStartBinding}:{}),...(binding?{b:binding}:{})}}},doc.calibration);T.check(candidate);
   const layer=L.textLayer(doc,'尺寸标注');if(layer&&!L.writable(doc,layer))throw new Error('尺寸标注图层已隐藏或锁定，请先显示并解锁');if(!layer&&doc.layers.length>=200)throw new Error('最多支持 200 个图层');if(doc.texts.length>=500)throw new Error('最多支持 500 段文字和标注');
   checkpoint();const item=L.addText(doc,candidate);setTool('select');selectElements([],[],[item.id]);changed('尺寸标注已创建；可拖动圆点调整端点，拖动方块调整间距');
  }catch(err){status(err.message);}
 }
 function cancelDimensionDrag(){
  const gesture=drag?.kind==='dimension'?drag:suspendedDrag?.kind==='dimension'?suspendedDrag:null;if(!gesture)return false;
  Object.assign(doc.texts.find(t=>t.id===gesture.id),gesture.base);drag=null;suspendedDrag=null;tapStart=null;taps.reset();
  if(capturedPointer!==null&&svg.hasPointerCapture(capturedPointer))svg.releasePointerCapture(capturedPointer);capturedPointer=null;
  edits.commit(snapshot());updateDirty();render();return true;
 }
 function renderDimensions(){
  const group=$('selection-overlay');
  if(tool==='dimension'&&dimensionStart&&hoverPoint&&G.dist(dimensionStart,hoverPoint)>1e-6){
   const t=D.resolve({fontSize:14/camera.z,dimension:{a:dimensionStart,b:hoverPoint,offset:28/camera.z,unit:doc.measureUnit==='cm'?'cm':'mm'}},doc.calibration);
   const g=el('g',{'pointer-events':'none','data-dimension-preview':'true'},group);
   for(const [a,b] of D.segments(t))el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#1685a6','stroke-width':1.5/camera.z},g);
   el('text',{x:t.x,y:t.y+t.fontSize,'font-size':t.fontSize,fill:'#1685a6',transform:`rotate(${t.rotation} ${t.x} ${t.y})`},g).textContent=t.content;
  }
  const selected=selectedTexts();if(!['select','node'].includes(tool)||selected.length!==1||!selected[0].dimension||!L.editable(doc,selected[0].id,'text'))return;
  const t=selected[0],{a,b,qa,qb}=D.basis(t),r=6/camera.z;
  for(const [part,p] of [['a',a],['b',b],['offset',{x:(qa.x+qb.x)/2,y:(qa.y+qb.y)/2}]]){
   const attrs={fill:'white',stroke:'#1685a6','stroke-width':2/camera.z,'data-dimension-handle':part,'data-dimension-id':t.id,cursor:'move'};
   const shape=part==='offset'?el('rect',{...attrs,x:p.x-r,y:p.y-r,width:r*2,height:r*2},group):el('circle',{...attrs,cx:p.x,cy:p.y,r},group);el('title',{},shape).textContent=part==='offset'?'拖动调整尺寸线间距':'拖动调整测量端点';
  }
 }
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
  checkpoint();doc.calibration=calibration;doc.measureUnit=calibration.unit;setTool('measure',false,true);changed('实际比例已设置，所有测量按此比例换算；保存作品可保留标定');vectorFiles?.resumeImport();
 }
 function snapToNode(pos){
  let closest=null,distance=9/camera.z;
  for(const path of doc.paths.filter(p=>L.visible(doc,p.id)))for(const n of path.nodes){const d=G.dist(pos,n);if(d<distance){closest=n;distance=d;}}
  return G.point(closest||pos);
 }
 function axisPoint(p,constrain,origin=axisStart,free=false,autoAngle=true){
  if(free&&!constrain)return G.point(p);
  if(!origin)return snapToNode(p);
  const pos=constrain?snap(origin,p):snapToNode(p),dx=Math.abs(pos.x-origin.x),dy=Math.abs(pos.y-origin.y);
  if(!autoAngle&&!constrain)return pos;
  const slope=Math.tan(5*Math.PI/180);
  if(dy<=dx*slope)return {x:pos.x,y:origin.y};
  if(dx<=dy*slope)return {x:origin.x,y:pos.y};
  return pos;
 }
 function renderGuides(){
  const group=$('guides');group.replaceChildren();axisControls.replaceChildren();axisControls.setAttribute('data-selected',String(axisSelected&&!!doc.mirrorAxis));mirrorPreview.replaceChildren();
  if(doc.mirrorAxisVisible===false&&!axisStart)return;
  const linked=selectedSymmetryGroups();
  if(tool!=='axis'&&!axisStart&&!axisSelected&&linked.length){
   for(const id of linked){const axis=doc.symmetryLinks?.find(l=>l.id===id)?.axis;if(!axis)continue;const d=G.dist(axis.a,axis.b),span=Math.max(doc.width,doc.height,svg.clientWidth/camera.z,svg.clientHeight/camera.z)*3;if(d<1e-6)continue;
    const dx=(axis.b.x-axis.a.x)/d*span,dy=(axis.b.y-axis.a.y)/d*span;
    el('line',{x1:axis.a.x-dx,y1:axis.a.y-dy,x2:axis.a.x+dx,y2:axis.a.y+dy,stroke:'#9858b1','stroke-width':1.5/camera.z,'stroke-dasharray':`${7/camera.z} ${5/camera.z}`,'data-symmetry-axis':id,'pointer-events':'none'},group);
    el('text',{x:axis.a.x+9/camera.z,y:axis.a.y-9/camera.z,fill:'#87459f','font-size':12/camera.z,'pointer-events':'none'},group).textContent='关联对称轴';
   }return;
  }
  const axis=axisStart?{a:axisStart,b:hoverPoint||axisStart}:doc.mirrorAxis;
  if(!axis)return;
  const {a,b}=axis,d=G.dist(a,b),span=Math.max(doc.width,doc.height,svg.clientWidth/camera.z,svg.clientHeight/camera.z)*3,color=axisSelected?'#176bce':'#9858b1';
  const dx=d>1e-6?(b.x-a.x)/d*span:0,dy=d>1e-6?(b.y-a.y)/d*span:0,line={x1:a.x-dx,y1:a.y-dy,x2:b.x+dx,y2:b.y+dy};
  if(d>1e-6)el('line',{...line,stroke:color,'stroke-width':(axisSelected?2.5:1.5)/camera.z,'stroke-dasharray':`${7/camera.z} ${5/camera.z}`},group);
  for(const p of [a,b])el('circle',{cx:p.x,cy:p.y,r:4/camera.z,fill:axisSelected?'#e5effc':'white',stroke:color,'stroke-width':1.5/camera.z},group);
  const direction=d>1e-6?(a.y===b.y?' · 水平':a.x===b.x?' · 竖直':''):'';
  el('text',{x:a.x+9/camera.z,y:a.y-9/camera.z,fill:'#87459f','font-size':12/camera.z},group).textContent='对称轴'+direction;
  if(!replay&&!fairingDraft&&!simplifyDraft&&!offsetDraft&&d>1e-6&&(mirrorPreviewActive||tool==='axis'||axisGesture())){
   const paths=mirrorSources().map(path=>G.reflectPath(path,a,b));
   if(paths.every(validMirror))for(const path of paths)el('path',{d:G.pathD(path),fill:'none',stroke:'#24956a','stroke-width':2/camera.z,'stroke-dasharray':`${6/camera.z} ${4/camera.z}`,'data-source':path.id},mirrorPreview);
  }
  if(axisStart||replay||fairingDraft||simplifyDraft||offsetDraft||!['node','select','axis'].includes(tool))return;
  const attrs={'pointer-events':'all',class:'axis-handle'};
  el('line',{...line,stroke:'transparent','stroke-width':12/camera.z,'data-axis':'move',...attrs},axisControls);
  for(const key of ['a','b'])el('circle',{cx:axis[key].x,cy:axis[key].y,r:9/camera.z,fill:'transparent','data-axis':key,...attrs},axisControls);
 }
 function mirrorSources(){const segment=editingSegment();return segment?[copySegmentPath(segment)]:selectedCurves().filter(path=>path.nodes.length);}
 function validMirror(path){return path.nodes.every(n=>[n,n.in,n.out].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=1e7&&Math.abs(p.y)<=1e7));}
 function axisGesture(){return drag?.kind==='axis'?drag:suspendedDrag?.kind==='axis'?suspendedDrag:null;}
 function cancelAxisDrag(){
  const gesture=axisGesture();if(!gesture)return false;
  doc.mirrorAxis=gesture.axis;mirrorPreviewActive=gesture.previewActive;drag=null;suspendedDrag=null;tapStart=null;taps.reset();
  if(capturedPointer!==null&&svg.hasPointerCapture(capturedPointer))svg.releasePointerCapture(capturedPointer);capturedPointer=null;
  edits.commit(snapshot());updateDirty();render();return true;
 }
 function clearMirrorAxis(){
  if(doc.mirrorAxis){checkpoint();doc.mirrorAxis=null;}
  axisStart=null;hoverPoint=null;axisSelected=false;mirrorPreviewActive=false;changed('已删除对称轴，原曲线与镜像副本保留；可撤销');
 }
 function mirrorCopy(){
  const segment=editingSegment(),paths=mirrorSources();if(!paths.length||!doc.mirrorAxis)return;
  if(doc.paths.length+paths.length>500){status('最多支持 500 条曲线，请先整理曲线');return;}
  const copies=paths.map(path=>{const copy=G.reflectPath(path,doc.mirrorAxis.a,doc.mirrorAxis.b);stripSymmetry(copy);copy.id=uid();copy.name=`${path.name.slice(0,75)} · 镜像`;return copy;});
  if(!copies.every(validMirror)){status('镜像后坐标超出范围，请调整对称轴');return;}
  const linked=$('mirror-link').checked,draft={...doc,paths:clone(doc.paths),symmetryLinks:clone(doc.symmetryLinks||[])};
  if(linked){try{if(draft.symmetryLinks.length+copies.length>500)throw new Error('对称关联最多 500 组，请先解除无用的关联');copies.forEach((copy,i)=>S.link(draft,draft.paths.find(p=>p.id===paths[i].id),copy,doc.mirrorAxis,uid(),segment?.index??null));}catch(error){status(error.message);return;}}
  checkpoint();if(linked){doc.paths=draft.paths;doc.symmetryLinks=draft.symmetryLinks;}copies.forEach((copy,i)=>attachPath(copy,L.layerFor(doc,paths[i].id)));
  if(tool!=='axis'){selectPaths(copies.map(p=>p.id));setTool('node');}
  changed(linked?'已生成镜像并记住对称关系；改好一侧后可同步另一侧，整体旋转时轴跟随':tool==='axis'?'已生成独立镜像副本；可继续调整轴，再次生成；可撤销':segment?'已生成所选片段的独立镜像副本，原曲线保留；可撤销':'已生成独立的镜像副本，原曲线保留；可撤销');
 }
 function stripSymmetry(path){for(const n of path.nodes)delete n.symmetry;return path;}
 function selectedSymmetryGroups(){return [...new Set(selectedCurves().flatMap(p=>S.groupsForPath(doc,p.id)))];}
 function selectedSymmetryAxis(){const groups=selectedSymmetryGroups();return groups.length===1?doc.symmetryLinks?.find(l=>l.id===groups[0])?.axis:null;}
 function symmetryContext(){
  const segment=editingSegment();if(segment)return S.context(doc,segment.path.id,segment.index);
  const p=selectedPath();if(!p||selection.length!==1)return null;
  if(nodeSelection.length===1&&ni!==null){const n=p.nodes[ni],tags=Object.values(n?.symmetry||{});if(tags.length&&tags.every(t=>t.id===tags[0].id&&t.side===tags[0].side)){const index=n.symmetry.out?ni:(ni-1+p.nodes.length)%p.nodes.length;return S.context(doc,p.id,index);}}
  return S.context(doc,p.id);
 }
 function symmetryActionLabel(context){return context?.targetMissing?'以这一侧重新生成另一侧…':'以这一侧同步另一侧…';}
 function renderSymmetryControls(){
  const groups=selectedSymmetryGroups(),context=symmetryContext();$('show-mirror-axis').checked=doc.mirrorAxisVisible!==false;
  $('symmetry-sync').textContent=symmetryActionLabel(context);
  $('symmetry-sync').disabled=!context;$('symmetry-select-pair').disabled=!groups.length;$('symmetry-unlink').disabled=!groups.length;
  $('symmetry-info').textContent=context?.targetMissing?'另一侧已删除。可按记住的对称轴重新生成，保留当前这一侧。':context?'已记住对称关系。以当前选中的这一侧为准，同步另一侧。':groups.length?'已记住对称关系。F10 点选要保留的一侧线段，再同步；整体移动或旋转前可选中对称两侧。':'此曲线尚无对称关联；新镜像可自动记住，旧作品不会自动猜测。';
 }
 function translateNodeAxes(refs,dx,dy){
  if(!doc.symmetryLinks?.length)return;const ids=[...new Set(refs.map(r=>r.pathId))].filter(id=>{const p=doc.paths.find(p=>p.id===id);return p&&p.nodes.every((_,index)=>refs.some(r=>r.pathId===id&&r.index===index));});
  S.transformLinks(doc,ids,p=>({x:p.x+dx,y:p.y+dy}));
 }
 function translateNodeLabels(refs,dx,dy,base=null){
  const ids=[...new Set(refs.map(r=>r.pathId))].filter(id=>{const p=doc.paths.find(p=>p.id===id);return p&&p.nodes.every((_,index)=>refs.some(r=>r.pathId===id&&r.index===index));});
  if(!ids.length)return;
  const draft=base?{...doc,paths:base.paths,texts:clone(base.texts)}:doc;
  L.translatePositionLabels(draft,ids,dx,dy);if(base)doc.texts=draft.texts;
 }
 function nodeDragState(start){
  return {kind:'nodes',start,symmetryLinks:doc.symmetryLinks?clone(doc.symmetryLinks):null,nodes:selectedNodes().map(({path,index})=>({pathId:path.id,index,node:clone(path.nodes[index])})),annotationBase:{paths:clone(doc.paths),texts:clone(doc.texts)}};
 }
 function selectSymmetryPair(){const groups=selectedSymmetryGroups(),ids=doc.paths.filter(p=>S.groupsForPath(doc,p.id).some(id=>groups.includes(id))).map(p=>p.id);if(ids.some(id=>!L.editable(doc,id))){status('请先显示并解锁对称两侧');return;}selectPaths(ids);setTool('select');showPanel('mirror');}
 function unlinkSymmetry(){const groups=selectedSymmetryGroups();if(!groups.length)return;const members=doc.paths.filter(p=>S.groupsForPath(doc,p.id).some(id=>groups.includes(id)));if(members.some(p=>!L.editable(doc,p.id))){status('请先显示并解锁对称两侧');return;}checkpoint();groups.forEach(id=>S.unlink(doc,id));changed('已解除对称关联，保留两侧原有曲线，可撤销');}
 function closeSymmetry(){symmetryDraft=null;const dialog=$('symmetry-dialog');if(dialog.open)dialog.close();}
 function openSymmetry(context=symmetryContext()){
  if(!context){status('请用 F10 点选要保留的一侧线段');return;}
  if(context.pathIds.some(id=>!L.editable(doc,id))){status('请先显示并解锁对称两侧');return;}
  let plan;try{plan=S.planSync(doc,context.id,context.side,uid());}catch(error){status(error.message);return;}
  endDrag();const baseline=JSON.stringify({paths:doc.paths,links:doc.symmetryLinks});symmetryDraft={context,plan,baseline};
  $('symmetry-title').textContent=plan.createdPath?'重新生成另一侧':'同步另一侧';$('symmetry-apply').textContent=plan.createdPath?'生成另一侧':'应用同步';
  $('symmetry-hint').textContent=plan.createdPath?'另一侧已删除。按记住的对称轴生成新镜像，保留当前这一侧。绿色为生成后的轮廓；可一步撤销。':'绿色为同步后的轮廓，灰色虚线为当前轮廓。应用后可一步撤销。';
  const preview=$('symmetry-preview');preview.replaceChildren();const before=doc.paths.filter(p=>context.pathIds.includes(p.id)),after=plan.paths.filter(p=>context.pathIds.includes(p.id)||plan.targetPathIds.includes(p.id)),boxes=[...before,...after].map(G.pathBounds).filter(Boolean);
  if(!boxes.length){closeSymmetry();return;}const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),w=Math.max(...boxes.map(b=>b.x+b.width))-x,h=Math.max(...boxes.map(b=>b.y+b.height))-y,pad=Math.max(w,h,1)*.08;
  preview.setAttribute('viewBox',`${x-pad} ${y-pad} ${w+2*pad} ${h+2*pad}`);
  for(const p of before)el('path',{d:G.pathD(p),fill:'none',stroke:'#9ba7b5','stroke-width':1.5,'stroke-dasharray':'5 4','vector-effect':'non-scaling-stroke'},preview);
  for(const p of after)el('path',{d:G.pathD(p),fill:'none',stroke:'#13816c','stroke-width':2,'vector-effect':'non-scaling-stroke'},preview);
  $('symmetry-dialog').showModal();
 }
 $('show-mirror-axis').onchange=()=>{checkpoint();doc.mirrorAxisVisible=$('show-mirror-axis').checked;axisSelected=false;changed(doc.mirrorAxisVisible?'已显示对称轴':'已隐藏对称轴，对称关联保留');};
 $('symmetry-sync').onclick=()=>openSymmetry();$('symmetry-select-pair').onclick=selectSymmetryPair;$('symmetry-unlink').onclick=unlinkSymmetry;
 $('symmetry-cancel').onclick=closeSymmetry;$('symmetry-dialog').addEventListener('cancel',e=>{e.preventDefault();closeSymmetry();});
 $('symmetry-apply').onclick=()=>{const draft=symmetryDraft;if(!draft)return;if(draft.baseline!==JSON.stringify({paths:doc.paths,links:doc.symmetryLinks})||draft.context.pathIds.some(id=>!L.editable(doc,id))){closeSymmetry();status('曲线已变化，请重新预览同步');return;}checkpoint();doc.paths=draft.plan.paths;if(draft.plan.createdPath){const added=draft.plan.createdPath;L.layerFor(doc,added.sourcePathId).pathIds.push(added.id);}closeSymmetry();selectPaths(selection);measurement=null;changed(draft.plan.createdPath?'已按保留的一侧重新生成另一侧，原曲线不变；可一步撤销':'已按所选一侧同步另一侧，可一步撤销');};
 function readSymmetryTags(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['in','out'].includes(k)))throw new Error('对称关联标记无效');const result={};
  for(const [key,t] of Object.entries(value)){if(!t||typeof t.id!=='string'||!t.id.length||t.id.length>80||![0,1].includes(t.side)||t.dir!==undefined&&![1,-1].includes(t.dir))throw new Error('对称关联标记无效');result[key]={id:t.id,side:t.side,dir:t.dir??1};}return result;
 }
 function readSymmetryLinks(value){
  if(!Array.isArray(value)||value.length>500)throw new Error('对称关联数量无效');const seen=new Set();return value.map(l=>{if(!l||typeof l.id!=='string'||!l.id.length||l.id.length>80||seen.has(l.id))throw new Error('对称关联标识无效');seen.add(l.id);const axis=l.axis;if(!axis||[axis.a,axis.b].some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e7||Math.abs(p.y)>1e7)||G.dist(axis.a,axis.b)<1e-6)throw new Error('关联对称轴无效');return {id:l.id,axis:{a:G.point(axis.a),b:G.point(axis.b)}};});
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
  const wholeCurve=measurement?.kind==='curve',boxes=[],obstacles=[];let omitted=0;
  // All placement and halo distances are screen-sized, regardless of canvas zoom.
  const label=(p,text)=>{
   const node=el('text',{x:0,y:0,'font-size':12/camera.z,'stroke-width':2/camera.z,class:'measurement-label'},group);node.textContent=text;
   const size=node.getBBox(),w=size.width,h=size.height,gap=10/camera.z,pad=3/camera.z;
   const positions=[[p.x-w/2,p.y-gap-h],[p.x+gap,p.y-h/2],[p.x-w/2,p.y+gap],[p.x-gap-w,p.y-h/2],
    [p.x+gap,p.y-gap-h],[p.x-gap-w,p.y-gap-h],[p.x+gap,p.y+gap],[p.x-gap-w,p.y+gap]];
   for(const [x,y] of positions){
    const box={x:x-pad,y:y-pad,w:w+2*pad,h:h+2*pad};
    if(boxes.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y))continue;
    if(obstacles.some(q=>q.x>=box.x&&q.x<=box.x+box.w&&q.y>=box.y&&q.y<=box.y+box.h))continue;
    node.setAttribute('x',x-size.x);node.setAttribute('y',y-size.y);boxes.push(box);return true;
   }
   node.remove();return false;
  };
  if(data?.points){
   el('polyline',{points:data.points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#13816c','stroke-width':1.7/camera.z},group);
   data.points.forEach(p=>el('circle',{cx:p.x,cy:p.y,r:4/camera.z,fill:'white',stroke:'#13816c','stroke-width':1.5/camera.z},group));
   if(tool==='measure'&&!measurement.finished&&hoverPoint&&data.points.length){const last=data.points.at(-1);el('line',{x1:last.x,y1:last.y,x2:hoverPoint.x,y2:hoverPoint.y,stroke:'#13816c','stroke-width':1/camera.z,'stroke-dasharray':`${4/camera.z} ${4/camera.z}`},group);}
  }
  if(data?.path)for(const item of data.items){
   const path=el('path',{d:G.segmentD(data.path,item.index),fill:'none',stroke:'#13816c',opacity:.7,'stroke-width':2/camera.z},group);
   if(!wholeCurve)el('title',{},path).textContent=`${item.label}：${lengthText(item.length)}`;
  }
  // Sample the measured contour closely enough to keep text clear of its stroke.
  for(const shape of wholeCurve?[]:group.querySelectorAll('path,polyline')){
   const length=shape.getTotalLength(),steps=Math.max(1,Math.ceil(length*camera.z/4));
   // Extremely long geometry must not make measurement or zoom unresponsive.
   if(steps>4096){const b=shape.getBBox();boxes.push({x:b.x-3/camera.z,y:b.y-3/camera.z,w:b.width+6/camera.z,h:b.height+6/camera.z});continue;}
   for(let i=0;i<=steps;i++)obstacles.push(shape.getPointAtLength(length*i/steps));
  }
  data?.points?.forEach((p,i)=>label(p,String(i+1)));
  if(wholeCurve&&data?.path){
   const bounds=G.pathBounds(data.path);
   if(bounds)label({x:bounds.x+bounds.width/2,y:bounds.y},`总长 ${lengthText(data.total)}`);
  }else if(data)for(const item of [...data.items].sort((a,b)=>b.length-a.length)){
   if(data.items.length>1&&item.length*camera.z<28||!label(item.position,lengthText(item.length)))omitted++;
  }
  $('measure-summary').textContent=(data?.summary||'连续点击测点，或右键曲线测量弧长')+(omitted?` · ${omitted} 段短线或密集标注见明细`:'');
  $('measure-total').textContent=`${data?.path?'≈ ':''}${lengthText(data?.total||0)}`;
  const list=$('measure-details');list.replaceChildren();for(const item of wholeCurve?[]:data?.items||[]){const li=document.createElement('li');li.textContent=`${item.label}：${lengthText(item.length)}`;list.appendChild(li);}
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
  for(const layer of L.ordered(doc).reverse())for(const path of editablePaths().filter(p=>layer.pathIds.includes(p.id))){const hit=G.nearest(path,pos);if(hit.distance<=12/camera.z&&(!result||hit.distance<result.hit.distance))result={path,hit};}
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
 function addNotchAt(path,hit){
  if(!L.editable(doc,path.id))return;
  try{
   const scale=G.millimetersPerPixel(doc.calibration),result=N.insert(G,path,hit,{id:uid(),mmPerUnit:scale});
   // Topology can change without changing node count; retain identity explicitly
   // rather than letting the generic node-drag remapper assume equal indices.
   const labels=doc.texts.filter(t=>t.positionMarker&&L.positionLabelPath(doc,t)?.id===path.id).map(t=>({text:t,attachment:t.positionMarker.attachment||L.positionAttachment(path,t.positionMarker)}));
   const dimensions=doc.texts.filter(t=>t.dimension).map(text=>({text,bindings:text.dimension.bindings??Object.fromEntries(['a','b'].map(key=>[key,D.nodeBinding(doc.paths,text.dimension[key])]).filter(([,binding])=>binding))}));
   checkpoint();path.nodes=result.path.nodes;measurement=null;drawing=false;drawingEnd=null;tool='node';
   for(const {text,attachment} of labels){
    const index=attachment?.kind==='node'?result.nodeMap[attachment.index]:-1,marker=text.positionMarker;
    let target,next;
    if(index>=0){target=path.nodes[index];next={kind:'node',index};}
    else {const hit=G.nearest(path,marker);target=G.at(path.nodes[hit.index],path.nodes[(hit.index+1)%path.nodes.length],hit.t);next=L.positionAttachment(path,target)||{kind:'segment',index:hit.index,t:hit.t};}
    text.x+=target.x-marker.x;text.y+=target.y-marker.y;text.rotation=0;text.positionMarker={...marker,...G.point(target),pathId:path.id,attachment:next};
   }
   for(const {text,bindings} of dimensions){
    const next=clone(bindings);for(const key of ['a','b'])if(next[key]?.pathId===path.id){const index=result.nodeMap[next[key].index];if(index>=0)next[key]={...next[key],index};else delete next[key];}
    text.dimension.bindings=next;
   }
   positionLabelDocument=null;dimensionDocument=null;
   selectNodes(result.indices.map(index=>({pathId:path.id,index})));
   const size=scale?`${(result.width*scale).toFixed(2)} mm`:`${result.width.toFixed(2)} 坐标单位`;
   changed(`已增加 V 形剪口：口宽、深度 ${size}；已标记为剪口，可撤销`);
  }catch(err){status(err.message);}
 }
 function hideMenu(){menu.hidden=true;finishConnectionChoice();}
 function notchSelection(){
  const items=selectedNodes(),error='先框选剪口两端和尖点，至少 3 个连续节点';
  if(tool!=='node'||items.length<3||items.some(n=>n.path!==items[0].path))return {error};
  const path=items[0].path,indices=items.map(n=>n.index);
  try{N.define(G,clone(path),indices,'selection-check');return {path,indices};}catch(err){return {error:err.message};}
 }
 function defineNotch(){
  const selection=notchSelection();if(selection.error){status(selection.error);return;}
  checkpoint();N.define(G,selection.path,selection.indices,uid());drawing=false;measurement=null;
  changed('已设为剪口（橙色），形状保持。再框选包含剪口的缝边，点“局部拟合”。');
 }
 function clearNotches(){
  const items=selectedNodes();if(!items.some(({path,index})=>path.nodes[index].notchId))return;
  checkpoint();for(const path of selectedCurves())N.clear(path,items.filter(n=>n.path===path).map(n=>n.index));changed('已取消剪口标记，原曲线形状保持，可撤销');
 }
 function simplifySelectionError(){
  const paths=selectedCurves();
  if(!paths.length||imageSelection.length||textSelection.length)return '请只选择需要简化的曲线';
  if(paths.some(p=>p.nodes.length<2))return '曲线至少需要两个节点';
  if(paths.some(p=>p.nodes.some(n=>n.symmetry)))return '关联对称曲线请先解除对称关联，再简化节点';
  return '';
 }
 function simplifyMenuAction(){const error=simplifySelectionError();menuAction('简化曲线点…',openSimplify,!!error,error||'简化整条所选曲线，预览前后节点数及允许偏差');}
 function closeSimplify(){
  clearTimeout(simplifyTimer);simplifyTimer=null;const hint=simplifyDraft?.hint;simplifyDraft=null;simplifyPreview.replaceChildren();
  if(drag?.preview){drag=null;suspendedDrag=null;tapStart=null;taps.reset();if(capturedPointer!==null&&svg.hasPointerCapture(capturedPointer))svg.releasePointerCapture(capturedPointer);capturedPointer=null;}
  for(const [region,inert] of simplifyBlockedRegions)region.inert=inert;simplifyBlockedRegions=[];
  document.body.classList.remove('simplify-previewing');if(simplifyDialog.open)simplifyDialog.close();
  if(hint!==undefined){$('canvas-hint').textContent=hint;renderCanvas();}
 }
 function openSimplify(){
  if(replay||fitting.active)return;blurEditor();endDrag();hideMenu();closeSimplify();clearTrace();
  const error=simplifySelectionError();if(error){status(error);return;}
  const sources=clone(selectedCurves()),scale=G.millimetersPerPixel(doc.calibration);
  const protectedIndices=sources.map(p=>{
   const indices=new Set();for(const text of doc.texts){const marker=text.positionMarker;if(!marker||L.positionLabelPath(doc,text)?.id!==p.id)continue;const a=marker.attachment||L.positionAttachment(p,marker);if(a){indices.add(a.index);if(a.kind==='segment')indices.add((a.index+1)%p.nodes.length);}}
   return [...indices];
  });
  simplifyDraft={hint:$('canvas-hint').textContent,sources,protectedIndices,calibration:clone(doc.calibration),texts:clone(doc.texts),scale,unit:scale?'mm':'px',results:null,generation:0};
  $('simplify-summary').textContent=`已选 ${sources.length} 条曲线 · 简化整条曲线 · 原曲线保留至点击应用`;
  $('simplify-unit').replaceChildren();for(const unit of scale?['mm','cm','px']:['px']){const option=document.createElement('option');option.value=unit;option.textContent=unit;$('simplify-unit').append(option);}
  $('simplify-unit').value=simplifyDraft.unit;$('simplify-tolerance').value=scale?'0.01':'0.1';
  simplifyBlockedRegions=[...document.querySelectorAll('main>header,.actionbar>.group,#tool-dock,#panel-dock')].map(region=>[region,region.inert]);for(const [region] of simplifyBlockedRegions)region.inert=true;
  document.body.classList.add('simplify-previewing');simplifyDialog.show();render(true);requestSimplify();$('simplify-tolerance').focus();$('simplify-tolerance').select();
 }
 function simplifyUnitScale(unit){return unit==='px'?1:(unit==='cm'?10:1)/simplifyDraft.scale;}
 function requestSimplify(){
  if(!simplifyDraft)return;clearTimeout(simplifyTimer);simplifyDraft.generation++;simplifyDraft.results=null;renderSimplifyPreview();
  $('simplify-apply').disabled=true;$('simplify-info').dataset.state='pending';$('simplify-info').textContent='正在简化并核对轮廓偏差…';$('simplify-results').replaceChildren();
  simplifyTimer=setTimeout(updateSimplify,100);
 }
 async function updateSimplify(){
  const draft=simplifyDraft;if(!draft)return;const generation=draft.generation;
  const current=()=>simplifyDraft===draft&&generation===draft.generation;
  try{
   const raw=$('simplify-tolerance').value,value=Number(raw),unit=$('simplify-unit').value;
   if(raw.trim()===''||!Number.isFinite(value)||value<=0||value>1000000)throw Error('允许偏差请输入大于 0 且不超过 1000000 的数值');
   const tolerancePx=value*simplifyUnitScale(unit),results=[];
   for(let i=0;i<draft.sources.length;i++){
    await new Promise(resolve=>setTimeout(resolve,0));if(!current())return;
    results.push(window.CurveSimplify.simplifyPath(draft.sources[i],{tolerancePx,protectedIndices:draft.protectedIndices[i]}));
   }
   if(!current())return;draft.results=results;
   const before=results.reduce((n,r)=>n+r.before,0),after=results.reduce((n,r)=>n+r.after,0),changed=results.some(r=>r.changed);
   $('simplify-info').textContent=changed?`节点 ${before} → ${after}，减少 ${before-after} 点 · 轮廓双向偏差不超过 ${value} ${unit}`:`节点 ${before} → ${after} · 当前偏差限制下无法安全减少节点，原曲线保持不变`;
   $('simplify-info').dataset.state='ready';$('simplify-apply').disabled=!changed;
   $('simplify-results').replaceChildren();results.forEach((r,i)=>{const row=document.createElement('li');row.textContent=`${draft.sources[i].name||'曲线'}：${r.before} → ${r.after} 点${r.changed?'':'（保持原样）'}`;$('simplify-results').append(row);});
   renderSimplifyPreview();
  }catch(error){if(current()){$('simplify-info').textContent=error.message;$('simplify-info').dataset.state='error';$('simplify-apply').disabled=true;}}
 }
 function renderSimplifyPreview(){
  simplifyPreview.replaceChildren();if(!simplifyDraft?.results)return;
  for(const result of simplifyDraft.results){
   el('path',{d:G.pathD(result.path),fill:'none',stroke:'#13816c','stroke-width':2.5/camera.z,'data-simplify-preview':result.path.id},simplifyPreview);
   for(const n of result.path.nodes)el('circle',{cx:n.x,cy:n.y,r:3/camera.z,fill:'white',stroke:'#13816c','stroke-width':1.2/camera.z},simplifyPreview);
  }
 }
 function applySimplify(){
  const draft=simplifyDraft;if(!draft?.results?.some(r=>r.changed))return;
  if(draft.sources.some(p=>!L.editable(doc,p.id)||JSON.stringify(doc.paths.find(x=>x.id===p.id))!==JSON.stringify(p))||JSON.stringify(doc.calibration)!==JSON.stringify(draft.calibration)||JSON.stringify(doc.texts)!==JSON.stringify(draft.texts)){
   draft.results=null;$('simplify-info').textContent='曲线、标注或标定已变化，请取消后重新选择';$('simplify-info').dataset.state='error';$('simplify-apply').disabled=true;renderSimplifyPreview();return;
  }
  const before=draft.results.reduce((n,r)=>n+r.before,0),after=draft.results.reduce((n,r)=>n+r.after,0);
  checkpoint();for(const result of draft.results)if(result.changed)doc.paths.find(p=>p.id===result.path.id).nodes=clone(result.path.nodes);
  closeSimplify();measurement=null;drawing=false;tool='node';selectPaths(draft.sources.map(p=>p.id));
  changed(`已简化曲线点：${before} → ${after}，可一步撤销`);
 }
 $('simplify-curves').onclick=openSimplify;$('simplify-form').onsubmit=e=>{e.preventDefault();applySimplify();};$('simplify-cancel').onclick=closeSimplify;
 simplifyDialog.addEventListener('cancel',e=>{e.preventDefault();closeSimplify();});simplifyDialog.addEventListener('close',()=>{if(!simplifyDialog.open)closeSimplify();});
 $('simplify-tolerance').addEventListener('input',requestSimplify);
 $('simplify-unit').addEventListener('change',()=>{if(!simplifyDraft)return;const value=Number($('simplify-tolerance').value),unit=$('simplify-unit').value;if($('simplify-tolerance').value!==''&&Number.isFinite(value))$('simplify-tolerance').value=Number((value*simplifyUnitScale(simplifyDraft.unit)/simplifyUnitScale(unit)).toPrecision(12));simplifyDraft.unit=unit;requestSimplify();});
 function fairingSelection(){
  const items=selectedNodes(),error='请在同一条曲线上选择至少 3 个连续节点';
  if(tool!=='node'||items.length<3)return {error};
  const path=items[0].path;if(items.some(i=>i.path!==path)||!L.editable(doc,path.id))return {error};
  if(items.length>F.MAX_NODES)return {error:`每次最多圆顺 ${F.MAX_NODES} 个节点，请分段选择`};
  const chosen=new Set(items.map(i=>i.index)),count=path.nodes.length;
  if(path.closed&&chosen.size===count)return {error:'闭合曲线请只选择需要圆顺的一段，保留首尾边界'};
  const starts=[...chosen].filter(i=>!chosen.has(i===0?(path.closed?count-1:-1):i-1));
  if(starts.length!==1)return {error};
  const indices=[];let i=starts[0];while(chosen.has(i)&&indices.length<count){indices.push(i);i=(i+1)%count;if(!path.closed&&i===0)break;}
  return indices.length===chosen.size?{path,indices}:{error};
 }
 function closeFairing(){
  const hint=fairingDraft?.hint;
  clearTimeout(fairingTimer);fairingTimer=null;fairingDraft=null;fairingPreview.replaceChildren();
  if(drag?.preview){drag=null;suspendedDrag=null;tapStart=null;taps.reset();if(capturedPointer!==null&&svg.hasPointerCapture(capturedPointer))svg.releasePointerCapture(capturedPointer);capturedPointer=null;}
  for(const [region,inert] of fairingBlockedRegions)region.inert=inert;fairingBlockedRegions=[];
  document.body.classList.remove('fairing-previewing');
  if(fairingDialog.open)fairingDialog.close();
  if(hint!==undefined){$('canvas-hint').textContent=hint;renderCanvas();}
 }
 function openFairing(){
  if(replay)return;blurEditor();endDrag();hideMenu();closeFairing();clearTrace();
  const span=fairingSelection();if(span.error){status(span.error);return;}
  const source=clone(span.path),nodes=span.indices.map(i=>source.nodes[i]),scale=G.millimetersPerPixel(doc.calibration);
  fairingDraft={hint:$('canvas-hint').textContent,source,indices:span.indices,nodes,calibration:clone(doc.calibration),scale,result:null,unit:scale?'mm':'px'};
  $('fairing-summary').textContent=`${source.name} · 节点 ${span.indices[0]+1} → ${span.indices.at(-1)+1} · 共 ${nodes.length} 点`;
  $('fairing-unit').replaceChildren();for(const unit of scale?['mm','cm','px']:['px']){const option=document.createElement('option');option.value=unit;option.textContent=unit;$('fairing-unit').append(option);}
  $('fairing-unit').value=fairingDraft.unit;$('fairing-tolerance').value=scale?'0.5':'2';
  $('fairing-points').replaceChildren();nodes.forEach((n,i)=>{
   const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
   input.type='checkbox';input.dataset.relative=i;input.checked=input.disabled=i===0||i===nodes.length-1;
   text.textContent=`第 ${span.indices[i]+1} 点${i===0?' · 起点固定':i===nodes.length-1?' · 终点固定':' · 必须经过'}`;
   label.append(input,text);$('fairing-points').append(label);input.onchange=requestFairing;
  });
  // Leave navigation available, while isolating the draft from background editing.
  fairingBlockedRegions=[...document.querySelectorAll('main>header,.actionbar>.group,#tool-dock,#panel-dock')].map(region=>[region,region.inert]);
  for(const [region] of fairingBlockedRegions)region.inert=true;
  document.body.classList.add('fairing-previewing');fairingDialog.show();render(true);updateFairing();$('fairing-tolerance').focus();$('fairing-tolerance').select();
 }
 function fairingUnitScale(unit){return unit==='px'?1:(unit==='cm'?10:1)/fairingDraft.scale;}
 function requestFairing(){
  if(!fairingDraft)return;clearTimeout(fairingTimer);fairingDraft.result=null;renderFairingPreview();
  $('fairing-apply').disabled=true;$('fairing-info').dataset.state='pending';$('fairing-info').textContent='正在更新预览…';
  fairingTimer=setTimeout(updateFairing,100);
 }
 function updateFairing(){
  clearTimeout(fairingTimer);fairingTimer=null;if(!fairingDraft)return;
  fairingDraft.result=null;$('fairing-apply').disabled=true;
  try{
   const raw=$('fairing-tolerance').value,value=Number(raw),unit=$('fairing-unit').value;
   if(raw.trim()===''||!Number.isFinite(value)||value<0||value>1000000)throw new RangeError('允许偏离请输入 0 至 1000000 的数值');
   const fixedIndices=[...$('fairing-points').querySelectorAll('input:checked')].map(el=>Number(el.dataset.relative));
   const result=F.fairSpan(fairingDraft.nodes,{tolerance:value*fairingUnitScale(unit),fixedIndices});
   fairingDraft.result=result;
   // Round upward: this is a certified bound, not a measured exact maximum.
   const upper=Math.min(value,Math.ceil(result.maxDeviation/fairingUnitScale(unit)*1000)/1000);
   $('fairing-info').textContent=result.changed?`绿色为预览 · 整段偏离不超过 ${upper} ${unit} · ${fixedIndices.length} 个固定点`:'当前曲线已满足圆顺条件，无需修改';
   $('fairing-info').dataset.state='ready';$('fairing-apply').disabled=!result.changed;
  }catch(err){$('fairing-info').textContent=err.message;$('fairing-info').dataset.state='error';}
  renderFairingPreview();
 }
 function renderFairingPreview(){
  fairingPreview.replaceChildren();if(!fairingDraft)return;
  const ns=fairingDraft.result?.nodes||fairingDraft.nodes;
  if(fairingDraft.result)el('path',{d:G.pathD({nodes:ns,closed:false}),fill:'none',stroke:'#13816c','stroke-width':3/camera.z,'stroke-linecap':'round','data-fairing-preview':''},fairingPreview);
  const fixed=new Set([...$('fairing-points').querySelectorAll('input:checked')].map(el=>Number(el.dataset.relative)));
  ns.forEach((n,i)=>{
   const color=fixed.has(i)?'#b07113':'#13816c';
   el('circle',{cx:n.x,cy:n.y,r:4/camera.z,fill:fixed.has(i)?color:'white',stroke:color,'stroke-width':1.5/camera.z},fairingPreview);
   el('text',{x:n.x+8/camera.z,y:n.y-8/camera.z,fill:color,'font-size':12/camera.z,stroke:'white','stroke-width':3/camera.z,'paint-order':'stroke'},fairingPreview).textContent=fairingDraft.indices[i]+1;
  });
 }
 function applyFairing(){
  if(!fairingDraft)return;updateFairing();if(!fairingDraft.result?.changed)return;
  const draft=fairingDraft,path=doc.paths.find(p=>p.id===draft.source.id);
  if(!path||!L.editable(doc,path.id)||JSON.stringify(path)!==JSON.stringify(draft.source)||JSON.stringify(doc.calibration)!==JSON.stringify(draft.calibration)){
   draft.result=null;$('fairing-info').textContent='曲线或标定已变化，请取消后重新选择';$('fairing-info').dataset.state='error';$('fairing-apply').disabled=true;renderFairingPreview();return;
  }
  checkpoint();draft.indices.forEach((index,i)=>path.nodes[index]=clone(draft.result.nodes[i]));
  closeFairing();measurement=null;drawing=false;tool='node';selectNodes(draft.indices.map(index=>({pathId:path.id,index})));
  changed('已完成整段圆顺，首尾和必经点位置保持不变，可一步撤销');
 }
 $('fair-span').onclick=openFairing;$('fairing-form').onsubmit=e=>{e.preventDefault();applyFairing();};$('fairing-cancel').onclick=closeFairing;
 fairingDialog.addEventListener('cancel',e=>{e.preventDefault();closeFairing();});fairingDialog.addEventListener('close',()=>{if(!fairingDialog.open)closeFairing();});
 $('fairing-tolerance').addEventListener('input',requestFairing);
 $('fairing-unit').addEventListener('change',()=>{
  if(!fairingDraft)return;const value=Number($('fairing-tolerance').value),unit=$('fairing-unit').value;
  if($('fairing-tolerance').value!==''&&Number.isFinite(value))$('fairing-tolerance').value=Number((value*fairingUnitScale(fairingDraft.unit)/fairingUnitScale(unit)).toPrecision(12));
  fairingDraft.unit=unit;requestFairing();
 });
 function closeOffset(){
  clearTimeout(offsetTimer);offsetTimer=null;offsetComparisonGeneration++;offsetDraft=null;offsetPreview.replaceChildren();
  offsetDialog.classList.remove('offset-comparing');$('offset-comparison').hidden=true;$('offset-overlay-label').hidden=true;$('offset-compare').textContent='比较不同精度';$('offset-compare').setAttribute('aria-expanded','false');
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
  offsetDraft={sources:clone(sources),contours,calibration:clone(doc.calibration),active:selected,results:null,cache:new Map(),overlayPrecisions:new Set(OFFSET_PRECISIONS)};
  const closed=contours.filter(c=>c.path.closed).length,open=contours.length-closed;
  $('offset-closed-settings').hidden=!closed;$('offset-open-settings').hidden=!open;
  $('offset-summary').textContent=`已选 ${sources.length} 条曲线 · ${closed?`${closed} 个闭合轮廓`:''}${closed&&open?'、':''}${open?`${open} 条开放轮廓`:''}`;
  $('offset-calibrate').hidden=!!doc.calibration;
  offsetDialog.showModal();updateOffset();$('offset-distance').focus();$('offset-distance').select();
 }
 const OFFSET_PRECISIONS=['auto','0.01','0.02','0.05','0.1'];
 const OFFSET_COMPARISON_COLORS=['#8293a5','#9a83ad','#b08a63','#6e96a0','#a27979'];
 const offsetYield=()=>new Promise(resolve=>setTimeout(resolve,0));
 const formatOffsetMm=value=>Number(value.toPrecision(5)).toString();
 function offsetConfig(precision=$('offset-precision').value){
  if(!offsetDraft)throw new Error('偏移预览已关闭');
  const value=Number($('offset-distance').value),unit=$('offset-unit').value;
  if(!Number.isFinite(value)||value===0||Math.abs(value)>10000000)throw new RangeError('偏移距离必须为非零数字，绝对值不超过 10000000');
  const pixels=O.physicalDistancePixels(Math.abs(value),unit,offsetDraft.calibration),scale=G.millimetersPerPixel(offsetDraft.calibration);
  const requestedPx=precision==='auto'?Math.max(.00001,Math.min(.05,pixels*.005)):Number(precision)/scale;
  if(!Number.isFinite(requestedPx)||requestedPx<1e-6)throw new RangeError('所选精度小于当前比例可支持的最小值，请选择更大的允许偏差');
  const tolerancePx=Math.min(1,requestedPx);
  return {value,unit,pixels,precision,tolerancePx,actualMm:tolerancePx*scale,capped:requestedPx>1,closedDirection:value>0?'outward':'inward',openSide:value>0?'left':'right'};
 }
 function offsetCacheKey(config){return `${config.value}|${config.unit}|${config.precision}`;}
 function calculateOffset(config){
  const key=offsetCacheKey(config),cached=offsetDraft.cache.get(key);if(cached)return cached;
  let entry;
  try{
   const results=O.offsetContours(offsetDraft.contours,config.pixels,{closedDirection:config.closedDirection,openSide:config.openSide,tolerancePx:config.tolerancePx});
   if(!results.length)throw new Error('没有有效的偏移结果，请调整距离');
   if(doc.paths.length+results.length>500)throw new Error('生成后曲线总数不能超过 500 条，请减少选择');
   entry={state:'ready',config,results,nodeCount:results.reduce((sum,c)=>sum+c.path.nodes.length,0)};
  }catch(error){entry={state:'error',config,error};}
  offsetDraft.cache.set(key,entry);return entry;
 }
 function showOffsetPrecision(config,error){
  const info=$('offset-precision-info');
  if(error){info.textContent=error.message;info.dataset.state='error';return;}
  info.textContent=`${config.precision==='auto'?'自动 · ':''}允许偏差上限：${formatOffsetMm(config.actualMm)} mm${config.capped?'（受 1 px 上限限制，实际更严格）':''}`;
  info.dataset.state='ready';
 }
 function invalidateOffsetComparison(){
  offsetComparisonGeneration++;
  if(offsetDraft)offsetDraft.cache.clear();
 }
 function requestOffset(invalidate=true){
  if(!offsetDraft)return;clearTimeout(offsetTimer);if(invalidate){invalidateOffsetComparison();offsetDraft.refreshComparison=!$('offset-comparison').hidden;}offsetDraft.results=null;offsetPreview.replaceChildren();
  $('offset-apply').disabled=true;$('offset-info').textContent='正在更新预览…';$('offset-info').dataset.state='pending';
  offsetTimer=setTimeout(updateOffset,100);
 }
 function updateOffset(){
  clearTimeout(offsetTimer);offsetTimer=null;if(!offsetDraft)return;
  offsetDraft.results=null;$('offset-apply').disabled=true;
  try{
   const config=offsetConfig(),entry=calculateOffset(config);showOffsetPrecision(config);
   if(entry.state==='error')throw entry.error;
   offsetDraft.results=entry.results;offsetDraft.value=Math.abs(config.value);offsetDraft.unit=config.unit;offsetDraft.closedDirection=config.closedDirection;offsetDraft.openSide=config.openSide;offsetDraft.precision=config.precision;offsetDraft.toleranceMm=config.actualMm;
   const directions=[];if(offsetDraft.contours.some(c=>c.path.closed))directions.push(config.value>0?'外扩':'内收');if(offsetDraft.contours.some(c=>!c.path.closed))directions.push(config.value>0?'左偏':'右偏');
   const sourceNodes=offsetDraft.contours.reduce((sum,c)=>sum+c.path.nodes.length,0);
   $('offset-info').textContent=`将生成 ${entry.results.length} 条新曲线 · 节点 ${sourceNodes} → ${entry.nodeCount} · ${config.value>0?'+':''}${config.value} ${config.unit}（${directions.join('、')}）`;$('offset-info').dataset.state='ready';$('offset-apply').disabled=false;
  }catch(err){showOffsetPrecision(null,err);$('offset-info').textContent=err.message;$('offset-info').dataset.state='error';}
  renderOffsetPreview();
  markOffsetComparisonSelection();
  if(offsetDraft?.refreshComparison){offsetDraft.refreshComparison=false;compareOffsetPrecisions();}
 }
 function renderOffsetPreview(){
  offsetPreview.replaceChildren();if(!offsetDraft)return;
  if(!$('offset-comparison').hidden){
   for(const precision of OFFSET_PRECISIONS){
    if(precision===$('offset-precision').value||!offsetDraft.overlayPrecisions.has(precision))continue;
    let config;try{config=offsetConfig(precision);}catch{continue;}
    const entry=offsetDraft.cache.get(offsetCacheKey(config));if(entry?.state!=='ready')continue;
    const color=OFFSET_COMPARISON_COLORS[OFFSET_PRECISIONS.indexOf(precision)];
    for(const result of entry.results)el('path',{d:G.pathD(result.path),fill:'none',stroke:color,'stroke-width':1.5/camera.z,'stroke-dasharray':`${5/camera.z} ${4/camera.z}`,'stroke-linecap':'round','stroke-linejoin':'round','data-offset-comparison':precision},offsetPreview);
   }
  }
  for(const result of offsetDraft.results||[])el('path',{d:G.pathD(result.path),fill:'none',stroke:'#13816c','stroke-width':2.5/camera.z,'stroke-linecap':'round','stroke-linejoin':'round','data-offset-preview':''},offsetPreview);
  for(const {path} of offsetDraft.contours.filter(c=>!c.path.closed)){
   const i=Math.floor(G.segmentCount(path)/2),a=path.nodes[i],b=path.nodes[i+1];
   const start=G.at(a,b,.45),end=G.at(a,b,.55),p=G.at(a,b,.5),length=G.dist(start,end);if(length<1e-9)continue;
   const dx=(end.x-start.x)/length,dy=(end.y-start.y)/length,s=1/camera.z;
   const x=p.x+dx*14*s,y=p.y+dy*14*s;
   el('path',{d:`M ${p.x-dx*14*s} ${p.y-dy*14*s} L ${x} ${y} M ${x-dx*7*s+dy*5*s} ${y-dy*7*s-dx*5*s} L ${x} ${y} L ${x-dx*7*s-dy*5*s} ${y-dy*7*s+dx*5*s}`,fill:'none',stroke:'#176bce','stroke-width':2/camera.z,'stroke-linecap':'round','stroke-linejoin':'round','data-offset-direction':''},offsetPreview);
  }
 }
 function offsetComparisonRow(precision){
  const tr=document.createElement('tr');tr.dataset.precision=precision;tr.dataset.state='pending';
  const allowed=document.createElement('td'),nodes=document.createElement('td'),overlay=document.createElement('td'),check=document.createElement('input'),action=document.createElement('td'),button=document.createElement('button');
  check.type='checkbox';check.dataset.overlayPrecision=precision;check.disabled=true;check.setAttribute('aria-label',`一起预览 ${precision==='auto'?'自动精度':precision+' mm'}`);
  check.addEventListener('change',()=>{
   if(!offsetDraft)return;if(check.checked)offsetDraft.overlayPrecisions.add(precision);else offsetDraft.overlayPrecisions.delete(precision);
   markOffsetComparisonSelection();renderOffsetPreview();
  });
  overlay.append(check);
  button.type='button';button.textContent='设为主方案';button.disabled=true;button.addEventListener('click',()=>{
   if(!offsetDraft)return;offsetDraft.overlayPrecisions.add(precision);$('offset-precision').value=precision;updateOffset();
  });
  const swatch=document.createElement('span');swatch.className='offset-precision-swatch';swatch.style.background=OFFSET_COMPARISON_COLORS[OFFSET_PRECISIONS.indexOf(precision)];allowed.append(swatch);
  try{const config=offsetConfig(precision);allowed.append(`${precision==='auto'?'自动 · ':''}≤ ${formatOffsetMm(config.actualMm)} mm`);if(config.capped)allowed.title='受 1 px 上限限制，允许偏差上限比所选值更小';}catch(err){allowed.append(precision==='auto'?'自动':`${precision} mm`);allowed.title=err.message;}
  nodes.textContent='等待…';action.append(button);tr.append(allowed,nodes,overlay,action);return tr;
 }
 function paintOffsetComparisonRow(row,entry){
  if(!row)return;row.dataset.state=entry.state;const nodes=row.children[1],button=row.querySelector('button');
  if(entry.state==='ready'){nodes.textContent=String(entry.nodeCount);button.disabled=false;button.title='使用此精度作为绿色主方案，生成时只创建此方案';}
  else{nodes.textContent='无法生成';button.disabled=true;row.title=entry.error.message;}
 }
 function markOffsetComparisonSelection(){
  if(!offsetDraft)return;
  const selected=$('offset-precision').value;
  for(const row of $('offset-comparison').querySelectorAll('tbody tr')){
   const precision=row.dataset.precision,current=precision===selected,ready=row.dataset.state==='ready',check=row.querySelector('input'),button=row.querySelector('button');
   row.dataset.selected=String(current);check.checked=current||offsetDraft.overlayPrecisions.has(precision);check.disabled=current||!ready;
   check.title=current?'绿色主方案始终预览':'勾选后与主方案一起预览';button.disabled=current||!ready;button.textContent=current?'主方案':'设为主方案';
   row.querySelector('.offset-precision-swatch').style.background=current?'#13816c':OFFSET_COMPARISON_COLORS[OFFSET_PRECISIONS.indexOf(precision)];
  }
  const alternatives=OFFSET_PRECISIONS.filter(p=>p!==selected),count=alternatives.filter(p=>offsetDraft.overlayPrecisions.has(p)).length;
  $('offset-overlay').checked=count===alternatives.length;$('offset-overlay').indeterminate=count>0&&count<alternatives.length;
 }
 async function compareOffsetPrecisions(){
  if(!offsetDraft||$('offset-comparison').hidden)return;
  const generation=++offsetComparisonGeneration,body=$('offset-comparison').querySelector('tbody');body.replaceChildren();
  const rows=new Map(OFFSET_PRECISIONS.map(precision=>{const row=offsetComparisonRow(precision);body.append(row);return [precision,row];}));markOffsetComparisonSelection();
  for(const precision of OFFSET_PRECISIONS){
   await offsetYield();if(!offsetDraft||generation!==offsetComparisonGeneration||$('offset-comparison').hidden)return;
   let entry;
   try{entry=calculateOffset(offsetConfig(precision));}catch(error){entry={state:'error',error};}
   if(!offsetDraft||generation!==offsetComparisonGeneration)return;paintOffsetComparisonRow(rows.get(precision),entry);markOffsetComparisonSelection();renderOffsetPreview();
  }
 }
 function toggleOffsetComparison(){
  const comparison=$('offset-comparison'),opening=comparison.hidden;comparison.hidden=!opening;offsetDialog.classList.toggle('offset-comparing',opening);$('offset-compare').setAttribute('aria-expanded',String(opening));
  $('offset-overlay-label').hidden=!opening;$('offset-compare').textContent=opening?'收起精度对比':'比较不同精度';
  if(opening)compareOffsetPrecisions();else{offsetComparisonGeneration++;renderOffsetPreview();}
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
   return {path:{...clone(source),id:uid(),name:source.name.slice(0,Math.max(0,80-suffix.length))+suffix,note:`等距偏移：${direction} ${draft.value} ${draft.unit}。允许偏差上限：${formatOffsetMm(draft.toleranceMm)} mm。\n${source.note||''}`,closed:result.path.closed,nodes:clone(result.path.nodes)},layer:L.layerFor(doc,source.id)};
  });
  checkpoint();copies.forEach(({path,layer})=>attachPath(path,layer));closeOffset();measurement=null;drawing=false;
  selectPaths(copies.map(c=>c.path.id));tool='node';changed(`已生成 ${copies.length} 条可编辑偏移曲线；原曲线保留，可撤销`);
 }
 $('offset-form').onsubmit=e=>{e.preventDefault();applyOffset();};
 $('offset-cancel').onclick=closeOffset;
 offsetDialog.addEventListener('cancel',e=>{e.preventDefault();closeOffset();});
 offsetDialog.addEventListener('close',closeOffset);
 $('offset-calibrate').onclick=()=>{closeOffset();$('calibrate').click();};
 for(const id of ['offset-distance','offset-unit'])$(id).addEventListener('input',()=>requestOffset(true));
 $('offset-precision').addEventListener('change',()=>requestOffset(false));
 $('offset-compare').onclick=toggleOffsetComparison;
 $('offset-overlay').addEventListener('change',()=>{
  if(!offsetDraft)return;offsetDraft.overlayPrecisions=$('offset-overlay').checked?new Set(OFFSET_PRECISIONS):new Set();markOffsetComparisonSelection();renderOffsetPreview();
 });
 function mergeSelectedCurves(){
  const paths=selectedCurves();let merged;
  try{merged=G.mergePaths(paths,selected);}catch(err){status(err.message);return;}
  checkpoint();const ids=new Set(paths.map(p=>p.id));
  doc.paths=doc.paths.flatMap(p=>p.id===merged.id?[merged]:ids.has(p.id)?[]:[p]);
  measurement=null;drawing=false;selectPaths([merged.id]);tool='node';
  changed(`已合并 ${paths.length} 条曲线，按最近端点连接；可继续编辑节点或撤销`);
 }
 function connectCoincidentCurves(){
  const paths=selectedCurves();let result;
  try{result=G.connectCoincidentEndpoints(paths,selected);}catch(err){status(err.message);return;}
  const warnings=[result.ambiguous?`${result.ambiguous} 处有多个端点重合，未猜测连接`:null,result.skippedClosures?'部分曲线闭合后不足三个节点，保留开放':null].filter(Boolean).join('；');
  if(!result.joins){status(warnings||'所选曲线没有可连接的重合端点；仅连接坐标完全相同的端点');return;}
  checkpoint();
  const maps=new Map(result.mapping.map(m=>[m.sourceId,m])),ids=new Set(paths.map(p=>p.id)),outputs=new Map(result.paths.map(p=>[p.id,p]));
  // Transfer annotations before removing source paths, including old files
  // whose associations can only be inferred from the original geometry.
  for(const text of doc.texts){
   if(text.positionMarker){
    const path=L.positionLabelPath(doc,text),map=path&&maps.get(path.id),a=map&&(text.positionMarker.attachment||L.positionAttachment(path,text.positionMarker));
    if(a){const segment=a.kind==='segment'?map.segments[a.index]:null,index=a.kind==='node'?map.nodes[a.index]:segment?.index;
     if(index!==undefined)text.positionMarker={...text.positionMarker,pathId:map.pathId,attachment:{...a,index,...(segment?{t:segment.reversed?1-a.t:a.t}:{})}};
    }
   }
   if(text.dimension){
    const d=text.dimension;
    if(d.bindings===undefined){const inferred=Object.fromEntries(['a','b'].map(key=>[key,D.nodeBinding(doc.paths,d[key])]).filter(([,b])=>b));if(!Object.values(inferred).some(b=>maps.has(b.pathId)))continue;d.bindings=inferred;}
    for(const [key,b] of Object.entries(d.bindings)){const map=maps.get(b.pathId);if(map&&map.nodes[b.index]!==undefined)d.bindings[key]={pathId:map.pathId,index:map.nodes[b.index]};}
   }
  }
  doc.paths=doc.paths.flatMap(p=>!ids.has(p.id)?[p]:outputs.has(p.id)?[outputs.get(p.id)]:[]);L.prune(doc);
  positionLabelDocument=null;positionLabelBaseline=null;dimensionDocument=null;dimensionBaseline=null;
  measurement=null;drawing=false;selectPaths(result.paths.map(p=>p.id),maps.get(selected)?.pathId||selected);tool='node';
  changed(`已连接 ${result.joins} 对重合端点，保留原弧线；可一步撤销${warnings?'；'+warnings:''}`);
 }
 function connectCoincidentMenuAction(){
  if(selectedCurves().length>=2)menuAction('重合的端点改为连接',connectCoincidentCurves,false,'连接所选曲线中坐标完全重合的端点；独立轮廓分别连接，首尾重合则闭合');
 }
 function curveListMenu(e,path){
  e.preventDefault();if(replay||!L.editable(doc,path.id))return;
  if(imageRegion?.hasSelection()&&selection.includes(path.id)){imageRegionMenu(e);return;}
  blurEditor();endDrag();drawing=false;
  const included=selection.includes(path.id),images=included?imageSelection.slice():[],texts=included?textSelection.slice():[];selectPaths(included?selection:[path.id],included?selected:path.id);imageSelection=images;textSelection=texts;render();
  const paths=selectedCurves(),canMerge=paths.length>=2&&paths.every(p=>!p.closed&&p.nodes.length>=2);
  startMenu(paths.length>1?`已选 ${paths.length} 条曲线`:'曲线操作');
  curveClipboardActions();
  menuAction('合并曲线',mergeSelectedCurves,!canMerge,canMerge?'':paths.length<2?'Shift 多选开放曲线后可合并':'合并需选择至少有两个节点的开放曲线');
  connectCoincidentMenuAction();
  if(S.groupsForPath(doc,path.id).length){const context=S.context(doc,path.id);menuAction(symmetryActionLabel(context),()=>openSymmetry(context),!context,'闭合轮廓请在画布上右键要保留的一侧');menuAction('选中对称两侧',selectSymmetryPair);menuAction('解除对称关联',unlinkSymmetry);}
  simplifyMenuAction();offsetMenuAction();
  curveDeleteAction();showMenuAt(e);
 }
 function curveDeleteAction(){const count=selectedCurves().length;menuAction(count>1?'删除所选曲线':'删除曲线',removePaths,!count);}
 function imageRegionMenu(e){
  startMenu('图片区域操作');menuAction('删除所选图片区域',()=>imageRegion.apply(),imageRegion.busy,'只删除红色范围内的图片像素，保留曲线；Delete 同样可用');menuAction('反选图片区域',()=>imageRegion.invert(),imageRegion.busy);menuAction('取消图片区域选择',()=>imageRegion.cancel());showMenuAt(e);
 }
 function imageRegionSelectAction(){if(selectedCurves().length===1&&selectedCurves()[0].closed)menuAction('反选图片外区域',()=>imageRegion.selectOutside(),$('image-region').disabled,$('image-region').title);}
 function curveClipboardActions(){
  imageRegionSelectAction();
  if(selectedCurves().length===1&&selectedCurves()[0].closed)menuAction('图片区域清理…',()=>imageRegion.open(),$('image-region').disabled,$('image-region').title);
  menuAction(editingSegment()?'复制线段':selectedImages().length||selectedTexts().length?'复制元素':'复制曲线',()=>copyCurves(),!hasCopyElements(),'⌘ / Ctrl + C');
  menuAction('粘贴元素',pasteCurveClipboard,!L.writable(doc,currentLayer()),'以鼠标最后停留的画布位置作为整体左上角，保留实际尺寸');
  menuAction('打印选中曲线…',()=>printing.open(),!selectedCurves().some(p=>G.segmentCount(p)>0),'按两点标定的实际尺寸 1:1 打印整条曲线');
 }
 function startMenu(label){menu.replaceChildren();menu.setAttribute('aria-label',label+'右键菜单');const title=document.createElement('div');title.className='menu-title';title.textContent=label;menu.append(title);}
 function menuAction(label,fn,disabled=false,title=''){const b=document.createElement('button');b.type='button';b.role='menuitem';b.textContent=label;b.disabled=disabled;b.title=title;b.onclick=()=>{hideMenu();fn();};menu.append(b);}
 function showMenuAt(e){
  menu.hidden=false;menu.style.left='0px';menu.style.top='0px';
  const bounds=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(e.clientX,innerWidth-bounds.width-8))}px`;menu.style.top=`${Math.max(8,Math.min(e.clientY,innerHeight-bounds.height-8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
 }
 function continueFromEndpoint(){
  const path=selectedPath();
  if(!path||path.closed||!L.editable(doc,path.id)||nodeSelection.length!==1||![0,path.nodes.length-1].includes(ni))return;
  const index=ni;setTool('pen');measurement=null;drawing=true;drawingEnd=index===0&&path.nodes.length>1?'start':'end';
  selectNodes([{pathId:path.id,index}]);render();scheduleSession();status('已从所选端点继续画线；点击加点，拖动拉出手柄，Enter / Esc 结束');
 }
 function appendDrawingNode(path,pos){return drawingEnd?G.extend(path,pos,doc.newNodeMode,drawingEnd==='start'):G.append(path,pos,doc.newNodeMode);}
 function appendAt(pos,newCurve=false){
  if(!L.writable(doc,currentLayer())){status('当前图层为组、已隐藏或锁定，请选择可编辑的普通图层后画线');return;}
  checkpoint();measurement=null;let path=selectedPath();
  if(newCurve||!path||path.closed){path=makePath();attachPath(path);drawingEnd=null;}else if(!drawing)drawingEnd=null;
  selectNodes([{pathId:path.id,index:appendDrawingNode(path,pos)}]);drawing=true;tool='pen';
  changed('已在此加点，继续点击或拖动可接着画线');
 }
 svg.addEventListener('contextmenu',e=>{
  if(imageRegion?.hasSelection()){e.preventDefault();imageRegionMenu(e);return;}
  if(fairingDraft||simplifyDraft||temporaryPan()||e.ctrlKey){e.preventDefault();return;}
  pointerScreen=screenPoint(e);blurEditor();e.preventDefault();endDrag();tapStart=null;taps.reset();
  if(doc.mirrorAxis&&(e.target.closest('[data-axis]')||axisSelected&&!e.target.closest('[data-path],[data-image],[data-text]'))){
   axisSelected=true;mirrorPreviewActive=true;render();startMenu('对称轴操作');menuAction('删除对称轴',clearMirrorAxis);menuAction('撤销',()=>history(true),$('undo').disabled);menuAction('重做',()=>history(false),$('redo').disabled);showMenuAt(e);return;
  }
  axisSelected=false;
  const textId=e.target.closest('[data-text]')?.getAttribute('data-text');
  if(textId&&L.editable(doc,textId,'text')){
   const marked=!!doc.texts.find(t=>t.id===textId)?.positionMarker;
   if(!textSelection.includes(textId))selectElements([],[],[textId]);setTool('select');startMenu(marked?'点位标注操作':'文字操作');curveClipboardActions();
   menuAction(marked?'编辑点位标注…':'编辑文字…',()=>openText(null,textId),textSelection.length!==1);menuAction('删除所选元素',deleteElements);menuAction('创建文字…',()=>openText(point(e)));showMenuAt(e);return;
  }
  const imageId=e.target.closest('[data-image]')?.getAttribute('data-image');
  if(imageId&&L.editable(doc,imageId,'image')){
   if(!imageSelection.includes(imageId))selectElements([],[imageId],[]);setTool('select');startMenu('图片操作');curveClipboardActions();menuAction('删除所选元素',deleteElements);showMenuAt(e);return;
  }
  const pos=point(e),pointed=editablePaths().find(p=>p.id===e.target.closest('[data-path]')?.getAttribute('data-path'));
  // Prefer the actual clicked line/anchor when multiple curves share a position.
  const result=pointed?(G.segmentCount(pointed)?{path:pointed,hit:G.nearest(pointed,pos)}:null):closestCurve(pos);let index=-1;
  // Right-clicking an anchor must not collapse a curve multiselection to one node.
  const focus=(path,i)=>{if(i>=0&&selection.length>1&&selection.includes(path.id)&&!nodeSelection.some(n=>n.pathId===path.id&&n.index===i))index=i=-1;if(i>=0){const item={pathId:path.id,index:i};if(nodeSelection.some(n=>nodeKey(n)===nodeKey(item))){selected=path.id;ni=i;}else selectNodes([item]);}else if(!selection.includes(path.id))selectPaths([path.id]);else{selected=path.id;ni=null;}render();};
  if(result){const anchor=e.target.closest('.anchor[data-node]');index=['node','pen'].includes(tool)?anchor&&anchor.getAttribute('data-path')===result.path.id?Number(anchor.getAttribute('data-node')):result.path.nodes.findIndex(n=>G.dist(n,pos)<=10/camera.z):-1;focus(result.path,index);}
  // One-node paths have no segment to hit, but still expose their node actions.
  if(!result){for(const path of pointed?[pointed]:editablePaths()){const i=path.nodes.findIndex(n=>G.dist(n,pos)<=10/camera.z);if(i!==-1){index=['node','pen'].includes(tool)?i:-1;focus(path,index);break;}}}
  const nodeContext=index>=0||(!result&&tool==='node'&&nodeSelection.length&&!editingSegment());
  startMenu(nodeContext?'节点操作':editingSegment()?'线段操作':result?'曲线操作':'画布操作');const action=menuAction;
  const marker=annotationPoint(pos,e.target);if(marker)action('添加点位标注…',()=>openText(marker,null,true));
  if(result)action('增加剪口',()=>addNotchAt(result.path,result.hit),false,'固定 V 形，按曲线大小自动定尺寸；闭合轮廓朝内，开放曲线朝前进方向左侧');
  if(nodeSelection.length){action('顺滑所选节点',smoothSelectedNodes);const span=fairingSelection();if(!span.error)action('整段圆顺…',openFairing,false,'固定首尾点，允许参考点微调');}
  if(nodeSelection.length){const notch=notchSelection();if(!notch.error)action('设为剪口',defineNotch);if(selectedNodes().some(({path,index})=>path.nodes[index].notchId))action('取消剪口',clearNotches);}
  if(nodeSelection.length)action('设置节点颜色…',()=>{showPanel('curves');$('node-color').focus();try{$('node-color').showPicker?.();}catch(_err){}});
  connectCoincidentMenuAction();
  if(nodeContext){
   imageRegionSelectAction();simplifyMenuAction();
   const nodes=selectedNodes(),only=nodes.length===1?nodes[0]:null;
   if(only&&!only.path.closed&&[0,only.path.nodes.length-1].includes(only.index))action('继续画线',()=>{ni=only.index;continueFromEndpoint();},false,'从所选端点继续添加节点');
   if(breakableNode())action('断开连接',breakSelectedNode,false,'断开连接，保留原弧线');
   action(nodeSelection.length>1?'删除所选节点':'删除这个节点',removeNode);
   for(const [mode,label] of [['cusp','转为尖角节点'],['smooth','转为平滑节点'],['symmetric','转为对称节点']])if(!nodes.every(({path,index})=>path.nodes[index].mode===mode))action(label,()=>modes.find(b=>b.dataset.mode===mode).click());
   if(drawing)action('结束当前画线',finish);
   action(tool==='node'?'全选节点':'全选曲线',selectAll);action('取消选择',()=>$('deselect').click());
   if(!$('undo').disabled)action('撤销',()=>history(true));
   if(!$('redo').disabled)action('重做',()=>history(false));
   showMenuAt(e);return;
  }
  curveClipboardActions();
  action('导入图片',()=>$('image-file').click());
  action('创建文字…',()=>openText(pos));
  if(result){action('在曲线此处加点',()=>insertAt(pos));}
  else {
   const canContinue=selectedPath()&&!selectedPath().closed;
   action(canContinue?'在此加点 · 续接当前曲线':'在此加点 · 新建曲线',()=>appendAt(pos));
   if(canContinue)action('从这里新画一条曲线',()=>appendAt(pos,true));
  }
  const path=selectedPath();
  if(path){
   simplifyMenuAction();offsetMenuAction();
   curveDeleteAction();
   action('测量整条曲线',()=>measureCurve(path),!G.segmentCount(path));
   action(editingSegment()?'镜像所选片段':'按对称轴生成镜像副本',mirrorCopy,!doc.mirrorAxis||!path.nodes.length,!doc.mirrorAxis?'请先用“对称轴”（A）点击两点设置轴':'生成独立镜像副本，保留原曲线');
   if(S.groupsForPath(doc,path.id).length){const context=result?S.context(doc,result.path.id,result.hit.index):symmetryContext();action(symmetryActionLabel(context),()=>openSymmetry(context),!context);action('选中对称两侧',selectSymmetryPair);action('解除对称关联',unlinkSymmetry);}
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
 document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))hideMenu();},true);
 window.addEventListener('resize',hideMenu);window.addEventListener('scroll',e=>{if(!e.target.closest?.('#panel-dock,.tools,#context-menu'))hideMenu();},true);
 menu.addEventListener('keydown',e=>{if(composing(e))return;
  if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();
  const items=[...menu.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();
 });
 svg.addEventListener('pointerdown',e=>{
  if(e.button!==0&&e.button!==1&&!(e.ctrlKey&&e.button===2))return;blurEditor();svg.focus({preventScroll:true});e.preventDefault();const p=point(e),target=e.target;
  pointerScreen=screenPoint(e);if(e.ctrlKey&&!fairingDraft&&!simplifyDraft)ctrlPan=true;
  const editable=tool==='node'||tool==='select';
  tapStart=e.button===0&&editable&&!temporaryPan()&&!e.shiftKey&&!target.hasAttribute('data-side')?{...screenPoint(e),time:e.timeStamp,segment:tool==='node'&&target.hasAttribute('data-path')&&!target.hasAttribute('data-node')}:null;
  if(tapStart)tapStart.fitNode=e.altKey?null:fitting.pickNode(target,p);
  svg.setPointerCapture(e.pointerId);capturedPointer=e.pointerId;
  if(fairingDraft||simplifyDraft){tapStart=null;taps.reset();drag={kind:'pan',preview:true,screen:pointerScreen,camera:{...camera}};renderCanvas();return;}
  if(temporaryPan()||tool==='pan'||e.button===1){drag={kind:'pan',screen:pointerScreen,camera:{...camera},temporary:temporaryPan()&&tool!=='pan'&&e.button!==1};renderCanvas();return;}
  imageRegion?.cancel();
  if(fitting.handlesEvent(e)){tapStart=null;taps.reset();fitting.pointerDown(e,p);return;}
  const axisPart=target.getAttribute('data-axis');
  if(axisPart&&doc.mirrorAxis&&!axisStart&&['node','select','axis'].includes(tool)){
   tapStart=null;taps.reset();axisSelected=true;checkpoint();drag={kind:'axis',part:axisPart,start:p,axis:clone(doc.mirrorAxis),previewActive:mirrorPreviewActive};mirrorPreviewActive=true;render();return;
  }
  axisSelected=false;
  const dimensionHandle=target.getAttribute('data-dimension-handle'),dimensionId=target.getAttribute('data-dimension-id');
  if(dimensionHandle&&editable&&L.editable(doc,dimensionId,'text')){const item=doc.texts.find(t=>t.id===dimensionId);if(item?.dimension){tapStart=null;taps.reset();checkpoint();drag={kind:'dimension',id:dimensionId,part:dimensionHandle,base:clone(item)};return;}}
  if(editable||tool==='pen'&&target.hasAttribute('data-node'))activateCanvasLayer(target,p);
  if(isTracing()){tapStart=null;createTrace(p);return;}
  if(tool==='text'){tapStart=null;openText(p);return;}
  if(tool==='position'){tapStart=null;openPositionLabel(p,target);return;}
  if(tool==='dimension'){tapStart=null;placeDimension(p,target);return;}
  if(tool==='rectangle'||tool==='ellipse'){
   tapStart=null;const layer=currentLayer();
   if(!L.writable(doc,layer)){status('当前图层为组、已隐藏或锁定，请选择可编辑的普通图层后绘制形状');return;}
   if(doc.paths.length>=500){status('最多支持 500 条曲线，请先整理曲线');return;}
   drag={kind:'shape',shape:tool,layerId:layer.id,start:p,current:p,constrain:e.shiftKey};renderCanvas();return;
  }
  if(target.closest('[data-rotation-center]')&&editable){
   const bounds=rotationBounds();if(!bounds)return;
   tapStart=null;taps.reset();commitEdit();const center=rotationCenter(bounds);
   drag={kind:'rotation-center',start:p,center,before:clone(rotationPivot),snapped:false};renderCanvas();return;
  }
  if(target.closest('[data-rotate]')&&['node','select'].includes(tool)){
   const bounds=rotationBounds();if(!bounds)return;
   tapStart=null;checkpoint();measurement=null;const center=rotationCenter(bounds);
   const control=target.closest('[data-rotate]'),handle={x:Number(control.getAttribute('cx')),y:Number(control.getAttribute('cy'))};
   drag={kind:'rotate',bounds,center,handle,angle:Math.atan2(p.y-center.y,p.x-center.x),totalAngle:0,degrees:0,base:snapshot().doc};return;
  }
  const corner=target.getAttribute('data-corner');
  if(corner&&(tool==='select'||tool==='node'&&!nodeSelection.length)){tapStart=null;checkpoint();drag={kind:'resize',corner,start:p,bounds:L.bounds(doc,selection,imageSelection,textSelection),base:snapshot().doc};return;}
  if(tool==='calibrate'){
   if(!calibrationDraft||calibrationDraft.length===2)calibrationDraft=[];
   const pos=snapToNode(p);
   if(calibrationDraft.length&&G.dist(calibrationDraft[0],pos)<1e-6){status('两个标定点不能重合，请选择另一点');return;}
   calibrationDraft.push(pos);hoverPoint=pos;render();
   if(calibrationDraft.length===2){$('calibration-length').focus();$('calibration-length').select();status('请填写两点之间已知的实际长度，并应用比例');}return;
  }
  if(tool==='axis'){
   const pos=axisPoint(p,e.shiftKey,axisStart,e.altKey);
   if(!axisStart){axisStart=pos;hoverPoint=pos;render();return;}
   if(G.dist(axisStart,pos)<1e-6){status('请点击另一个位置，两点不能重合');return;}
   checkpoint();doc.mirrorAxis={a:G.point(axisStart),b:pos};axisStart=null;setTool('node');mirrorPreviewActive=true;showPanel('mirror');changed('对称轴已设置；可拖动端点调整，所选曲线实时预览镜像');return;
  }
  if(tool==='measure'){
   if(measureMode==='segments'){const hit=closestCurve(p);if(hit)selectSegment(hit.path,hit.hit.index,e.shiftKey);else status('请点击要测量的曲线线段');return;}
   if(measurement?.kind!=='points'||measurement.finished)measurement={kind:'points',points:[],finished:false};
   const pos=snapToNode(p);if(!measurement.points.length||G.dist(measurement.points.at(-1),pos)>1e-6)measurement.points.push(pos);
   hoverPoint=pos;render();return;
  }
  const idx=target.getAttribute('data-node'),side=target.getAttribute('data-side'),pathId=target.getAttribute('data-path');
  const current=selectedPath();
  if(tool==='pen'&&drawing&&current&&pathId===current.id&&!side&&idx===String(drawingEnd==='start'?current.nodes.length-1:0)&&current.nodes.length>=3){checkpoint();current.closed=true;changed('曲线已闭合');finish();return;}
  if(idx!==null&&(tool==='node'||tool==='pen')){
   const segment=editingSegment();if(!side)segmentSelection=null;
   const item={pathId:pathId||selected,index:Number(idx)},chosen=nodeSelection.some(n=>nodeKey(n)===nodeKey(item));
   if(e.shiftKey&&!side&&tool==='node'){selectNodes(chosen?nodeSelection.filter(n=>nodeKey(n)!==nodeKey(item)):[...nodeSelection,item],item);tapStart=null;render();return;}
   if(!chosen)selectNodes([item]);else{selected=item.pathId;ni=item.index;}
   checkpoint();drag=side?{kind:'handle',side,independent:!!segment,start:p,node:clone(selectedNode())}:nodeDragState(p);render();return;
  }
  if(tool==='pen'){
   if(!L.writable(doc,currentLayer())){status('当前图层为组、已隐藏或锁定，请选择可编辑的普通图层后画线');return;}
   let path=selectedPath();
   checkpoint();measurement=null;
   if(!drawing||!path||path.closed){path=makePath();attachPath(path);drawing=true;drawingEnd=null;}
   const last=drawingEnd==='start'?path.nodes[0]:path.nodes.at(-1),pos=e.shiftKey&&last?snap(last,p):p;
   selectNodes([{pathId:path.id,index:appendDrawingNode(path,pos)}]);drag={kind:'new',start:pos,fromStart:drawingEnd==='start'};changed();return;
  }
  const textId=target.closest('[data-text]')?.getAttribute('data-text');
  if(textId&&['select','node'].includes(tool)){
   tapStart=null;if(tool!=='select')setTool('select');
   if(e.shiftKey){selectElements(selection,imageSelection,textSelection.includes(textId)?textSelection.filter(id=>id!==textId):[...textSelection,textId]);render();return;}
   tapStart={...screenPoint(e),time:e.timeStamp,textId};
   if(!textSelection.includes(textId))selectElements([],[],[textId]);
   checkpoint();drag={kind:'elements',start:p,bounds:selectionBounds(),base:snapshot().doc};render();return;
  }
  const imageId=target.getAttribute('data-image');
  if(imageId&&tool==='select'){
   tapStart=null;if(e.shiftKey){selectElements(selection,imageSelection.includes(imageId)?imageSelection.filter(id=>id!==imageId):[...imageSelection,imageId],textSelection);render();return;}
   if(!imageSelection.includes(imageId))selectElements([],[imageId]);
   activeLayer=L.layerFor(doc,imageId,'image').id;checkpoint();drag={kind:'elements',start:p,bounds:L.bounds(doc,selection,imageSelection,textSelection),base:snapshot().doc};render();return;
  }
  if((!pathId||tool==='node')&&selectionDragHit(p,target,e.shiftKey)){
   if(!tapStart?.segment)tapStart=null;checkpoint();
   drag=tool==='node'&&nodeSelection.length?nodeDragState(p):{kind:'elements',start:p,bounds:selectionBounds(),base:snapshot().doc};
   render();return;
  }
  if(pathId){
   if(e.shiftKey){togglePath(pathId);tapStart=null;render();return;}
   if(!selection.includes(pathId)||tool==='node'&&nodeSelection.length)selectPaths([pathId]);else{selected=pathId;ni=null;}
   if(tool==='select'||tool==='node'){checkpoint();drag={kind:'elements',start:p,bounds:L.bounds(doc,selection,imageSelection,textSelection),base:snapshot().doc};}
   render();return;
  }
  // Capture scope before movement changes the live selection, including empty rectangles.
  drag={kind:'marquee',nodeScope:tool==='node'&&selection.length===1?selection[0]:null,start:p,current:p,screen:screenPoint(e),moved:false,add:e.shiftKey,paths:selection.slice(),images:imageSelection.slice(),texts:textSelection.slice(),nodes:clone(nodeSelection)};tapStart=null;render();
 });
 function movePointer(e){
  pointerScreen=screenPoint(e);
  const p=point(e);$('coordinates').textContent=`X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)} px · ${doc.calibration?'已设置实际比例':'未设置实际比例'}`;
  if((fitting.capturesCanvas||fitting.dragging)&&!drag){fitting.pointerMove(e,p);return;}
  if(!drag&&isTracing()&&!temporaryPan()){scheduleTrace(p);return;}
  if(!drag&&!temporaryPan()&&(tool==='dimension'||tool==='axis'||tool==='calibrate'||(tool==='measure'&&measureMode==='points'))){hoverPoint=tool==='axis'?axisPoint(p,e.shiftKey,axisStart,e.altKey):snapToNode(p);renderCanvas();}
  if(!drag){if(tool==='node'||tool==='select')svg.style.cursor=fairingDraft||simplifyDraft||temporaryPan()?'grab':e.target.hasAttribute('data-axis')||selectionDragHit(p,e.target,e.shiftKey)?'move':'default';return;}
  if(tapStart?.fitNode&&drag.kind==='nodes'&&!drag.moved&&G.dist(tapStart,screenPoint(e))<=4)return;
  if(tapStart&&G.dist(tapStart,screenPoint(e))>4){tapStart=null;taps.reset();}
  if(drag.kind==='pan'){const s=screenPoint(e);camera.x=drag.camera.x+s.x-drag.screen.x;camera.y=drag.camera.y+s.y-drag.screen.y;renderPan();return;}
  if(drag.kind==='dimension'){
   const next=clone(drag.base);if(drag.part==='offset'){const {a,b,n}=D.basis(next);next.dimension.offset=(p.x-(a.x+b.x)/2)*n.x+(p.y-(a.y+b.y)/2)*n.y;}else{const hit=dimensionSnap(p,null,e.altKey);next.dimension[drag.part]=hit.point;next.dimension.bindings={...next.dimension.bindings};if(hit.binding)next.dimension.bindings[drag.part]=hit.binding;else delete next.dimension.bindings[drag.part];}
   try{Object.assign(next,D.resolve(next,doc.calibration));T.check(next);}catch(_err){return;}
   Object.assign(doc.texts.find(t=>t.id===drag.id),next);updateDirty();renderCanvas();renderTextProperties();renderHistory();return;
  }
  if(drag.kind==='shape'){drag.current=p;drag.constrain=e.shiftKey;renderShapePreview();return;}
  if(drag.kind==='rotation-center'){
   const pos={x:drag.center.x+p.x-drag.start.x,y:drag.center.y+p.y-drag.start.y};
   if(!drag.moved&&G.dist(pos,drag.center)<1e-9)return;
   drag.moved=true;const center=e.altKey?pos:snapToNode(pos);
   if(![center.x,center.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7))return;
   drag.snapped=!e.altKey&&doc.paths.some(path=>L.visible(doc,path.id)&&path.nodes.some(n=>G.dist(n,center)<1e-9));
   rotationPivot={...center,key:rotationSelectionKey()};renderCanvas();renderTransform();return;
  }
  if(drag.kind==='axis'){
   const axis=clone(drag.axis);
   if(drag.part==='move'){const pos=e.shiftKey?snap(drag.start,p):p,dx=pos.x-drag.start.x,dy=pos.y-drag.start.y;for(const key of ['a','b']){axis[key].x+=dx;axis[key].y+=dy;}}
   else{const fixed=axis[drag.part==='a'?'b':'a'],start=drag.axis[drag.part],pos={x:start.x+p.x-drag.start.x,y:start.y+p.y-drag.start.y};axis[drag.part]=axisPoint(pos,e.shiftKey,fixed,e.altKey,false);}
   if(G.dist(axis.a,axis.b)<1e-6||[axis.a,axis.b].some(p=>Math.abs(p.x)>1e7||Math.abs(p.y)>1e7))return;
   doc.mirrorAxis=axis;updateDirty();renderCanvas();renderHistory();return;
  }
  if(drag.kind==='rotate'){
   const angle=Math.atan2(p.y-drag.center.y,p.x-drag.center.x),delta=angle-drag.angle;
   drag.totalAngle+=Math.atan2(Math.sin(delta),Math.cos(delta));drag.angle=angle;
   const degrees=drag.totalAngle*180/Math.PI;drag.degrees=e.shiftKey?Math.round(degrees/15)*15:degrees;
   const draft={...doc,...(drag.base.symmetryLinks?{symmetryLinks:clone(drag.base.symmetryLinks)}:{}),paths:clone(drag.base.paths),images:drag.base.images.map(i=>({...i})),texts:clone(drag.base.texts)};
   try{L.rotateElements(draft,selection,imageSelection,drag.center,drag.degrees,textSelection,layerSelection);doc.paths=draft.paths;doc.images=draft.images;doc.texts=draft.texts;if(draft.symmetryLinks)doc.symmetryLinks=draft.symmetryLinks;updateDirty();renderCanvas();renderTransform();renderHistory();}catch(err){status(err.message);}return;
  }
  if(drag.kind==='marquee'){
   drag.current=p;drag.moved ||= G.dist(drag.screen,screenPoint(e))>4;
   if(drag.moved){const rect=G.normalizeRect(drag.start,p);if(tool==='node')selectNodes([...(drag.add?drag.nodes:[]),...G.nodesInRect(editablePaths().filter(path=>!drag.nodeScope||path.id===drag.nodeScope),rect)]);else selectElements([...(drag.add?drag.paths:[]),...G.pathsInRect(editablePaths(),rect)],[...(drag.add?drag.images:[]),...doc.images.filter(i=>L.editable(doc,i.id,'image')&&L.imageIntersectsRect(i,rect)).map(i=>i.id)],[...(drag.add?drag.texts:[]),...doc.texts.filter(t=>{const b=T.bounds(t);return L.editable(doc,t.id,'text')&&b.x<=rect.x+rect.width&&b.x+b.width>=rect.x&&b.y<=rect.y+rect.height&&b.y+b.height>=rect.y;}).map(t=>t.id)]);}
   render();return;
  }
  if(drag.kind==='elements'||drag.kind==='resize'){
   const b=drag.bounds,target={...b},dx=p.x-drag.start.x,dy=p.y-drag.start.y;
   if(drag.kind==='elements'){drag.moved ||= G.dist(drag.start,p)*camera.z>4;const delta=dragTranslation(p,e);target.x+=delta.x;target.y+=delta.y;}
   else{
    const east=drag.corner.includes('e'),south=drag.corner.includes('s'),vx=(east?1:-1)*b.width,vy=(south?1:-1)*b.height;
    const scale=Math.max(.001,1+(dx*vx+dy*vy)/(vx*vx+vy*vy));target.width=b.width*scale;target.height=b.height*scale;target.x=east?b.x:b.x+b.width-target.width;target.y=south?b.y:b.y+b.height-target.height;
   }
   const draft={...doc,...(drag.base.symmetryLinks?{symmetryLinks:clone(drag.base.symmetryLinks)}:{}),paths:clone(drag.base.paths),images:drag.base.images.map(i=>({...i})),texts:clone(drag.base.texts)};
   try{L.transform(draft,selection,imageSelection,b,target,textSelection);doc.paths=draft.paths;doc.images=draft.images;doc.texts=draft.texts;if(draft.symmetryLinks)doc.symmetryLinks=draft.symmetryLinks;updateDirty();renderCanvas();renderTransform();renderTextProperties();renderHistory();}catch(err){status(err.message);}return;
  }
  const n=selectedNode(),path=selectedPath();if(!path)return;
  if(drag.kind==='new'&&G.dist(drag.start,p)>2/camera.z){const h=e.shiftKey?snap(n,p):p;n[drag.fromStart?'in':'out']=G.point(h);n[drag.fromStart?'out':'in']={x:2*n.x-h.x,y:2*n.y-h.y};}
  if(drag.kind==='nodes'){if(drag.symmetryLinks)doc.symmetryLinks=clone(drag.symmetryLinks);else delete doc.symmetryLinks;drag.moved ||= G.dist(drag.start,p)*camera.z>4;const delta=dragTranslation(p,e);try{translateNodeLabels(drag.nodes,delta.x,delta.y,drag.annotationBase);}catch(error){status(error.message);return;}for(const item of drag.nodes){const target=doc.paths.find(path=>path.id===item.pathId);target.nodes[item.index]=clone(item.node);G.move(target.nodes[item.index],delta.x,delta.y);}translateNodeAxes(drag.nodes,delta.x,delta.y);}
  if(drag.kind==='handle'){path.nodes[ni]=clone(drag.node);G.handle(path.nodes[ni],drag.side,e.shiftKey?snap(n,p):p,e.altKey||drag.independent);}
  updateDirty();renderCanvas();renderHistory();
  const node=selectedNode();if(node){$('node-x').value=Number(node.x.toFixed(2));$('node-y').value=Number(node.y.toFixed(2));}
 }
 svg.addEventListener('pointermove',movePointer);
 function refreshDragModifiers(e){
  if(!pointerScreen||!['nodes','elements','axis','rotation-center'].includes(drag?.kind))return;
  const r=svg.getBoundingClientRect();
  movePointer({clientX:r.left+pointerScreen.x,clientY:r.top+pointerScreen.y,shiftKey:e.shiftKey,altKey:e.altKey});
 }
 function endDrag(){if(cancelShape()){render();return;}if(!drag)return;if(drag.kind==='marquee'&&!drag.moved&&!drag.add)selectPaths([]);drag=null;suspendedDrag=null;if(!pendingConnection)edits.commit(snapshot());updateDirty();render();}
 function setTemporaryPan(modifier,pressed){
  const before=temporaryPan();if(modifier==='ctrl')ctrlPan=pressed;else space=pressed;
  if(before===temporaryPan())return;
  tapStart=null;taps.reset();
  if(temporaryPan()){
   clearTrace();
   if(drag&&drag.kind!=='pan'&&pointerScreen){suspendedDrag=drag;drag={kind:'pan',screen:{...pointerScreen},camera:{...camera},temporary:true};}
  }else if(drag?.kind==='pan'&&drag.temporary){drag=suspendedDrag;suspendedDrag=null;}
  render(true);
 }
 svg.addEventListener('pointerup',e=>{
  capturedPointer=null;
  if((fitting.capturesCanvas||fitting.dragging)&&!drag){fitting.pointerUp();tapStart=null;taps.reset();return;}
  const gesture=shapeGesture();
  if(gesture){if(drag===gesture){gesture.current=point(e);gesture.constrain=e.shiftKey;}drag=null;suspendedDrag=null;tapStart=null;taps.reset();finishShape(gesture);return;}
  if(['nodes','elements'].includes(drag?.kind)&&drag.moved){
   movePointer(e);
   if(drag.connection){const gesture={connection:clone(drag.connection),wholeCurve:drag.wholeCurve};if(snapDraggedEndpoint(gesture))pendingConnection=gesture;}
   else alignDraggedParallel();
  }
  if(['axis','rotation-center','dimension'].includes(drag?.kind))movePointer(e);
  const started=tapStart;tapStart=null;endDrag();
  if(pendingConnection){taps.reset();showConnectionChoice(e);return;}
  if(!started||G.dist(started,screenPoint(e))>4){taps.reset();return;}
  if(started.fitNode){fitting.chooseNode(started.fitNode);lastFittingNodeTap={...screenPoint(e),time:e.timeStamp};taps.reset();return;}
  // Repainting a selection replaces SVG elements, so native dblclick may target
  // the canvas instead of the text. Track the stable text ID across both taps.
  if(started.textId){if(taps.push({...screenPoint(e),time:e.timeStamp,key:'text:'+started.textId}))openText(null,started.textId);return;}
  const hit=closestCurve(point(e));if(!hit){taps.reset();return;}
  if(taps.push({...screenPoint(e),time:e.timeStamp,key:hit.path.id}))insertAt(point(e));
  else if(started.segment&&tool==='node')selectEditingSegment(hit.path,hit.hit.index);
 });
 svg.addEventListener('pointercancel',()=>{fitting.cancel();tapStart=null;taps.reset();if(!cancelDimensionDrag()&&!cancelRotationCenterDrag()&&!cancelAxisDrag())endDrag();});svg.addEventListener('lostpointercapture',()=>{if(fitting.dragging)fitting.cancel();if(!cancelDimensionDrag()&&!cancelRotationCenterDrag()&&!cancelAxisDrag())endDrag();});
 svg.addEventListener('pointerleave',()=>{if(isTracing()&&!capturedPointer){clearTrace();tracePointer=null;}});
 svg.addEventListener('dblclick',e=>{
  if(textDialog.open){e.preventDefault();return;}
  if(fitting.pickNode(e.target)||fitting.active&&lastFittingNodeTap&&e.timeStamp-lastFittingNodeTap.time<600&&G.dist(lastFittingNodeTap,screenPoint(e))<4){e.preventDefault();taps.reset();return;}
  if(fitting.capturesCanvas){e.preventDefault();fitting.doubleClick(e,point(e));return;}
  if(fairingDraft||simplifyDraft||temporaryPan()||e.ctrlKey){e.preventDefault();return;}
  const id=e.target.closest('[data-text]')?.getAttribute('data-text');if(id&&L.editable(doc,id,'text')&&['node','select'].includes(tool)){e.preventDefault();openText(null,id);taps.reset();return;}
  if((tool!=='node'&&tool!=='select')||temporaryPan()||e.ctrlKey||e.shiftKey||imageSelection.length||e.target.closest('[data-image],[data-text],[data-corner],[data-rotate],[data-rotation-center]')||(!e.target.hasAttribute('data-path')&&selectionDragHit(point(e),e.target)))return;e.preventDefault();insertAt(point(e));taps.reset();
 });
 svg.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.0015),screenPoint(e));},{passive:false});
 tools.forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
 $('calibrate').onclick=()=>{setTool('calibrate');calibrationDraft=[];render();status('在图中点击两点，再填写已知实际距离');};
 $('calibration-cancel').onclick=()=>setTool('measure');$('calibration-apply').onclick=applyCalibration;
 $('calibration-clear').onclick=()=>{if(!doc.calibration)return;checkpoint();doc.calibration=null;calibrationDraft=null;setTool('measure');changed('比例已清除，测量恢复像素 px');};
 $('measure-unit').onchange=()=>{const unit=$('measure-unit').value;if(!doc.calibration||unit===doc.measureUnit)return;checkpoint();doc.measureUnit=unit;changed('测量单位已切换为 '+unit);};
 for(const id of ['calibration-length','calibration-unit'])$(id).addEventListener('keydown',e=>{if(composing(e))return;
  if(tool!=='calibrate')return;if(e.key==='Enter'){e.preventDefault();e.stopPropagation();applyCalibration();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setTool('measure');}
 });
 $('draw-axis').onclick=()=>{if(doc.mirrorAxisVisible===false){checkpoint();doc.mirrorAxisVisible=true;updateDirty();}setTool('axis');};$('mirror-copy').onclick=mirrorCopy;
 $('clear-axis').onclick=clearMirrorAxis;
 $('add-dimension').onclick=()=>setTool('dimension');
 document.querySelectorAll('[data-measure]').forEach(b=>b.onclick=()=>{setTool('measure');measureMode=b.dataset.measure;measurement=null;render();});
 $('measure-clear').onclick=()=>{measurement=null;hoverPoint=null;render();};
 $('measure-finish').onclick=()=>{if(measurement?.kind==='points')measurement.finished=true;hoverPoint=null;render();};
 $('measure-alternate').onclick=()=>{if(measurement?.kind==='segments'){measurement.alternate=!measurement.alternate;render();}};
 $('add-path').onclick=()=>{setTool('pen');selectPaths([]);render();status('在画板上点击开始新曲线，按住拖动可画弧线');};
 $('finish').onclick=finish;
 $('break-node').onclick=breakSelectedNode;
 $('notch-define').onclick=defineNotch;$('notch-clear').onclick=clearNotches;
 $('close-path').onclick=()=>{const paths=selectedCurves().filter(p=>p.nodes.length>=3);if(!paths.length)return;checkpoint();measurement=null;const close=!paths.every(p=>p.closed);paths.forEach(p=>p.closed=close);drawing=false;changed();};
 function removeNode(){
  const nodes=selectedNodes();if(!nodes.length)return;checkpoint();measurement=null;
  for(const path of selectedCurves()){
   nodes.filter(item=>item.path===path).map(item=>item.index).sort((a,b)=>b-a).forEach(index=>path.nodes.splice(index,1));if(path.nodes.length<3)path.closed=false;
   if(!path.closed&&path.nodes.length)for(const [n,side] of [[path.nodes[0],'in'],[path.nodes.at(-1),'out']])if(n.symmetry){delete n.symmetry[side];if(!Object.keys(n.symmetry).length)delete n.symmetry;}
  }
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
 $('straight').onclick=()=>{
  const nodes=selectedNodes(),segment=editingSegment();if(!nodes.length)return;checkpoint();
  if(segment){const a=segment.path.nodes[segment.index],b=segment.path.nodes[(segment.index+1)%segment.path.nodes.length];a.out=G.point(a);b.in=G.point(b);a.mode=b.mode='cusp';}
  else for(const {path,index} of nodes){const n=path.nodes[index];n.in=G.point(n);n.out=G.point(n);n.mode='cusp';}
  changed();
 };
 function toggleSelectedNodeShape(){
  const segment=editingSegment();
  if(segment){checkpoint();const type=G.toggleSegment(segment.path,segment.index);changed(type==='curve'?'已转为曲线段，可拖动两端手柄调弧度；相邻线段保持不变':'已转为直线段，相邻线段保持不变，可撤销');return;}
  const nodes=selectedNodes();if(!nodes.length)return;
  const straight=nodes.every(({path,index})=>{const n=path.nodes[index];return n.mode==='cusp'&&G.dist(n,n.in)<.01&&G.dist(n,n.out)<.01;});
  if(!straight){$('straight').click();return;}
  checkpoint();for(const {path,index} of nodes)G.setMode(path,index,'smooth');
  changed(`已将 ${nodes.length} 个节点转为平滑节点，可撤销`);
 }
 modes.forEach(b=>b.onclick=()=>{
  checkpoint();segmentSelection=null;doc.newNodeMode=b.dataset.mode;
  for(const {path,index} of selectedNodes())G.setMode(path,index,b.dataset.mode);
  changed(`已记住${b.textContent}类型，接下来新建的节点会沿用`);
 });
 for(const axis of ['x','y'])$('node-'+axis).onchange=()=>{const n=selectedNode(),v=Number($('node-'+axis).value);if(!n||!Number.isFinite(v))return;checkpoint();const delta=v-n[axis];try{translateNodeLabels(nodeSelection,axis==='x'?delta:0,axis==='y'?delta:0);}catch(error){status(error.message);return;}translateNodeAxes(nodeSelection,axis==='x'?delta:0,axis==='y'?delta:0);for(const {path,index} of selectedNodes())G.move(path.nodes[index],axis==='x'?delta:0,axis==='y'?delta:0);changed();};
 function beginField(id){if(editingField!==id){checkpoint();editingField=id;}}
 function setNodeColor(value,live=false){
  const nodes=selectedNodes();if(!/^#[0-9a-f]{6}$/i.test(value)||!nodes.length||nodes.every(({path,index})=>path.nodes[index].color===value))return;
  if(live)beginField('node-color');else{blurEditor();checkpoint();}
  for(const {path,index}of nodes)path.nodes[index].color=value;
  changed(`已设置 ${nodes.length} 个节点的颜色，拟合与展开保持同色，可撤销`);
 }
 function setPathColor(value,live=false){
  const paths=selectedCurves();if(!/^#[0-9a-f]{6}$/i.test(value)||!paths.length||paths.every(path=>path.color.toLowerCase()===value.toLowerCase()))return;
  if(live)beginField('path-color');else{blurEditor();checkpoint();}
  for(const path of paths)path.color=value;
  changed(`已设置 ${paths.length} 条曲线的颜色，可撤销`);
 }
 // Keep the common colors aligned with the fitting palette.
 for(const color of ['#176bce','#13816c','#e04544','#c47713','#9858b1','#c43283','#087f8c','#78513e','#ef8c23','#f2c94c','#6dbb45','#29b6a8','#50a8ed','#9a7ee8','#ef86ae','#d4a573','#172b4d','#586b80','#97a6b5','#ffffff']){
  const button=document.createElement('button');button.type='button';button.dataset.pathColor=color;button.style.background=color;button.title=color;button.setAttribute('aria-label','曲线颜色 '+color);
  button.onclick=()=>setPathColor(color);$('path-color-presets').append(button);
 }
 $('path-color').oninput=e=>setPathColor(e.target.value,true);
 $('node-color').oninput=e=>setNodeColor(e.target.value,true);
 for(const b of document.querySelectorAll('[data-node-color]'))b.onclick=()=>setNodeColor(b.dataset.nodeColor);
 $('node-color-clear').onclick=()=>{const nodes=selectedNodes();if(!nodes.some(({path,index})=>path.nodes[index].color))return;blurEditor();checkpoint();for(const {path,index}of nodes)delete path.nodes[index].color;changed('节点颜色已清除，曲线形状保持，可撤销');};
 for(const [id,key] of [['path-name','name'],['path-role','role'],['path-note','note']])$(id)[key==='role'?'onchange':'oninput']=()=>{
  const paths=selectedCurves();if(!paths.length||((key==='name'||key==='note')&&paths.length>1))return;
  if(key==='role')checkpoint();else beginField(id);
  for(const p of paths)p[key]=$(id).value||(key==='name'?'未命名曲线':'');changed();
 };
 $('path-dashed').onchange=()=>{const paths=selectedCurves();if(!paths.length)return;checkpoint();paths.forEach(p=>p.dashed=$('path-dashed').checked);changed('曲线显示样式已更新，可撤销');};
 $('opacity').oninput=()=>{beginField('opacity');const images=selectedImages(),value=Number($('opacity').value)/100;if(images.length)images.forEach(i=>i.opacity=value);else doc.opacity=value;updateDirty();$('opacity-value').textContent=`${$('opacity').value}%`;renderCanvas();renderHistory();};
 for(const id of ['path-name','path-color','path-note','node-color','opacity']){
  const end=()=>{if(editingField===id){commitEdit();render();}};
  $(id).addEventListener('change',end);$(id).addEventListener('blur',end);
 }
 $('show-grid').onchange=renderCanvas;$('show-original').onchange=renderCanvas;
 $('zoom-in').onclick=()=>zoom(1.25);$('zoom-out').onclick=()=>zoom(.8);$('fit').onclick=fit;
 function history(back){
  imageRegion?.cancel();
  if(replay)return;
  if(fitting.history(back))return;
  endDrag();commitEdit();const s=back?edits.undo(snapshot()):edits.redo(snapshot());if(!s){renderHistory();return;}
  applySnapshot(s,fitting.preserveOnHistory);
  changed(`${back?'已撤销':'已重做'} · 可撤销 ${edits.undoCount} 步 · 可重做 ${edits.redoCount} 步`);
 }
 $('undo').onclick=()=>history(true);$('redo').onclick=()=>history(false);
 window.addEventListener('keydown',e=>{if(composing(e))return;
  if(!document.querySelector('dialog[open]')&&imageRegion?.hasSelection()&&!e.target.closest('input,textarea,select')&&!e.target.isContentEditable){if(['Delete','Backspace'].includes(e.key)){e.preventDefault();imageRegion.apply();return;}if(e.key==='Escape'){e.preventDefault();hideMenu();imageRegion.cancel();return;}}
  if(simplifyDialog.open){if(e.key==='Escape'){e.preventDefault();closeSimplify();return;}if((e.metaKey||e.ctrlKey)&&(['s','p'].includes(e.key.toLowerCase())||(!e.target.closest('input,textarea')&&['z','y','a'].includes(e.key.toLowerCase()))))e.preventDefault();return;}
  if(fairingDialog.open){if(e.key==='Escape'){e.preventDefault();closeFairing();return;}if(e.code==='Space'&&!e.target.closest('input,textarea,select,button'))e.preventDefault();if((e.metaKey||e.ctrlKey)&&(e.key.toLowerCase()==='s'||(!/INPUT|TEXTAREA/.test(e.target.tagName)&&['z','y','a'].includes(e.key.toLowerCase()))))e.preventDefault();return;}
  if($('editor-name-dialog').open||$('image-region-dialog').open||$('print-dialog').open||$('vector-export-dialog').open||$('vector-unit-dialog').open){if((e.metaKey||e.ctrlKey)&&(['s','p'].includes(e.key.toLowerCase())||(!/INPUT|TEXTAREA/.test(e.target.tagName)&&['z','y'].includes(e.key.toLowerCase()))))e.preventDefault();return;}
  if(symmetryDraft){if(e.key==='Escape'){e.preventDefault();closeSymmetry();}else if((e.metaKey||e.ctrlKey)&&['s','z','y','p'].includes(e.key.toLowerCase()))e.preventDefault();return;}
  if(textDialog.open)return;
  if(saveAsDialog.open){if((e.metaKey||e.ctrlKey)&&['s','z','y','a'].includes(e.key.toLowerCase())&&!/INPUT|TEXTAREA/.test(e.target.tagName))e.preventDefault();else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s')e.preventDefault();return;}
  if(offsetDialog.open){if((e.metaKey||e.ctrlKey)&&['s','z','y','a'].includes(e.key.toLowerCase())&&!/INPUT|TEXTAREA/.test(e.target.tagName))e.preventDefault();return;}
  if(replay){if(e.key==='Escape'){e.preventDefault();stopReplay();}else if(!e.target.closest?.('#panel-history'))e.preventDefault();return;}
  if(!menu.hidden){
   if(e.key==='Escape'){e.preventDefault();const choice=!!pendingConnection;hideMenu();if(choice)svg.focus({preventScroll:true});}
   else if(pendingConnection&&(e.metaKey||e.ctrlKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();hideMenu();history(e.key.toLowerCase()==='z'&&!e.shiftKey);}
   return;
  }
  const mod=e.metaKey||e.ctrlKey,key=e.key.toLowerCase();
  if(mod&&key==='p'){e.preventDefault();printing.open();return;}
  if(mod&&key==='s'){e.preventDefault();if(e.shiftKey)openSaveAs();else save();return;}
  if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable)return;
  if(fitting.keydown(e))return;
  if(!mod&&!e.altKey&&key==='n'&&!e.repeat){e.preventDefault();$('fit-curves').click();return;}
  if(e.target.closest('.dock-resize-handle,.panel-resize-handle'))return;
  if(e.target.closest('button,summary')&&(e.code==='Space'||key==='enter'))return;
  if(key==='control'){setTemporaryPan('ctrl',true);return;}
  if(key==='shift'&&shapeGesture()){shapeGesture().constrain=true;renderShapePreview();return;}
  if((key==='alt'||key==='shift')&&['nodes','elements','axis','rotation-center'].includes(drag?.kind)){e.preventDefault();refreshDragModifiers(e);return;}
  if(mod&&key==='a'){e.preventDefault();selectAll();return;}
  if(mod&&key==='z'){e.preventDefault();history(!e.shiftKey);return;}
  if(mod&&key==='y'){e.preventDefault();history(false);return;}
  if(e.code==='Space'){e.preventDefault();setTemporaryPan('space',true);return;}
  if(shapeGesture()&&['delete','backspace','arrowleft','arrowright','arrowup','arrowdown'].includes(key)){e.preventDefault();return;}
  if(axisSelected&&doc.mirrorAxis){
   if(['delete','backspace','arrowleft','arrowright','arrowup','arrowdown','j'].includes(key)){
    e.preventDefault();if(axisGesture()||key==='j')return;
    if(key==='delete'||key==='backspace'){clearMirrorAxis();return;}
    const step=e.shiftKey?10:1,dx=key==='arrowleft'?-step:key==='arrowright'?step:0,dy=key==='arrowup'?-step:key==='arrowdown'?step:0,axis=clone(doc.mirrorAxis);
    for(const p of [axis.a,axis.b]){p.x+=dx;p.y+=dy;}if([axis.a,axis.b].some(p=>Math.abs(p.x)>1e7||Math.abs(p.y)>1e7))return;
    checkpoint();doc.mirrorAxis=axis;mirrorPreviewActive=true;changed('对称轴已平移，可撤销');return;
   }
   if(key==='escape'&&!axisGesture()){e.preventDefault();axisSelected=false;render();return;}
  }
  if(key==='j'&&!mod&&!e.altKey&&['node','pen'].includes(tool)){
   if(e.repeat||!selectedNodes().length)return;
   e.preventDefault();toggleSelectedNodeShape();return;
  }
  if(key==='escape'||key==='enter'){
   if(key==='escape'&&(cancelDimensionDrag()||cancelRotationCenterDrag()||cancelAxisDrag())){e.preventDefault();return;}
   if(tool==='rectangle'||tool==='ellipse'){e.preventDefault();if(cancelShape()){render();status('已取消绘制形状');}else setTool('node');return;}
   if(isTracing()){e.preventDefault();if(key==='enter'&&tracePreview)createTrace(tracePreview.p);else setTool('node');return;}
   if(tool==='calibrate'){e.preventDefault();if(key==='enter')applyCalibration();else setTool('measure');return;}
   e.preventDefault();if(tool==='dimension'||tool==='position'){setTool('node');return;}if(tool==='axis'){axisStart=null;setTool('node');return;}
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
  if(key==='delete'||key==='backspace'){e.preventDefault();if(tool==='position'||tool==='dimension')return;if(tool==='select'||textSelection.length)deleteElements();else removeNode();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&(tool==='select'||tool==='node'&&!nodeSelection.length?selection.length+imageSelection.length+textSelection.length:selectedNodes().length)&&!['measure','axis','calibrate','position','dimension'].includes(tool)){
   e.preventDefault();checkpoint();const d=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0,dy=e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0;
   if(tool==='select'||!nodeSelection.length){const b=L.bounds(doc,selection,imageSelection,textSelection);try{L.transform(doc,selection,imageSelection,b,{...b,x:b.x+dx,y:b.y+dy},textSelection);}catch(err){status(err.message);return;}}else {try{translateNodeLabels(nodeSelection,dx,dy);}catch(error){status(error.message);return;}translateNodeAxes(nodeSelection,dx,dy);for(const {path,index} of selectedNodes())G.move(path.nodes[index],dx,dy);}changed();return;
  }
  const shortcuts={v:'select',f8:'text',f10:'node',b:'pen',r:'rectangle',e:'ellipse',h:'pan',a:'axis',m:'measure',t:'trace'};if(shortcuts[key]&&!mod){e.preventDefault();setTool(key==='t'&&e.shiftKey?'outline':shortcuts[key]);}
 });
 window.addEventListener('keyup',e=>{if(e.key==='Control')setTemporaryPan('ctrl',e.ctrlKey);if(e.code==='Space')setTemporaryPan('space',false);if(e.key==='Shift'&&shapeGesture()){shapeGesture().constrain=false;renderShapePreview();}if(e.key==='Alt'||e.key==='Shift')refreshDragModifiers(e);});
 window.addEventListener('blur',()=>{hideMenu();fitting.cancel();const wasPanning=temporaryPan();space=false;ctrlPan=false;tapStart=null;taps.reset();if(!cancelDimensionDrag()&&!cancelRotationCenterDrag()&&!cancelAxisDrag())endDrag();if(wasPanning)render(true);});
 window.addEventListener('beforeunload',e=>{
  // A completed local record already restores the canvas and history. Capture
  // that state before the redundant refresh journal can report a quota error.
  const needsWarning=dirty&&$('history-storage').dataset.state!=='saved';
  writeRefreshJournal();writeSession();if(needsWarning){e.preventDefault();e.returnValue='';}
 });
 $('new').onclick=()=>{if(dirty&&!confirm('当前修改还未保存，仍要新建空白画板吗？'))return;checkpoint();doc=empty();clipboardPageId=uid();resetAuxiliary();selectPaths([]);drawing=false;tool='pen';markClean();render();fit();status('无限画布已就绪；也可以先导入底图');};
 $('import').onclick=()=>$('image-file').click();$('open').onclick=()=>$('project-file').click();
 const readData=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error('图片读取失败'));r.readAsDataURL(f);});
 async function importImage(f,position=null,pasted=false,nativeClipboard=false){
  if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type))throw new Error('请使用 PNG、JPG 或 WebP 图片');
  if(f.size>18*1024*1024)throw new Error('图片超过18MB，请缩小后导入');
  const startDocument=doc,startPageId=clipboardPageId;
  const [dataUrl,bytes]=await Promise.all([readData(f),f.arrayBuffer()]),image=new Image();let metadata=window.CurveImageMetadata.read(bytes);image.src=dataUrl;await image.decode();
  if(!image.naturalWidth||image.naturalWidth>30000||image.naturalHeight>30000)throw new Error('图片尺寸过大或无效');
  if(nativeClipboard&&!metadata&&f.type==='image/png'){
   // Chrome delivers the normalized paste image as PNG. Preserve explicit file
   // metadata and avoid canonical orientation mismatches in other formats.
   // Only a real paste gesture may consult the local pasteboard. The helper
   // returns density only after comparing the complete decoded image pixels.
   try{
    const response=await fetch('/api/image-clipboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:dataUrl.slice(dataUrl.indexOf(',')+1)}),signal:AbortSignal.timeout(5000)});
    if(response.ok){const candidate=(await response.json()).metadata;if(candidate?.source==='macos-clipboard'&&candidate.orientation===1&&[candidate.dpiX,candidate.dpiY].every(n=>Number.isFinite(n)&&n>0))metadata=candidate;}
   }catch{/* Missing helper, changed clipboard, or no match keeps ordinary paste. */}
  }
  metadata=metadata||window.CurveImageMetadata.scannerDefault(bytes);
  if(startPageId!==clipboardPageId||(!replay&&startDocument!==doc)){status('画布已切换，已取消图片导入；请重新粘贴或导入');return;}
  if(replay)stopReplay();
  // Follow the decoder: Chrome applies JPEG EXIF orientation but not WebP EXIF.
  const encoded=window.CurveImageMetadata.pixelSize(bytes),hasOrientation=metadata&&metadata.orientation>=5&&metadata.orientation<=8;
  const swapped=hasOrientation&&(encoded&&encoded.width!==encoded.height?image.naturalWidth===encoded.height&&image.naturalHeight===encoded.width:metadata.source.startsWith('jpeg-'));
  if(metadata&&!doc.calibration){try{G.millimetersPerPixel({a:{x:0,y:0},b:{x:1,y:0},length:25.4/(swapped?metadata.dpiY:metadata.dpiX),unit:'mm'});}catch{metadata=null;}}
  const dpiX=metadata&&(swapped?metadata.dpiY:metadata.dpiX),dpiY=metadata&&(swapped?metadata.dpiX:metadata.dpiY);
  const apply=()=>{
   if(new Blob([JSON.stringify(doc)]).size+dataUrl.length>32*1024*1024-4096)throw new Error('作品中的图片总量过大，请缩小图片后导入');
   if(doc.images.length>=200||doc.layers.length>=200)throw new Error('最多支持 200 张图片或 200 个图层');
   const scale=metadata?(doc.calibration?G.millimetersPerPixel(doc.calibration):25.4/dpiX):null;
   const widthMm=metadata?image.naturalWidth*25.4/dpiX:null,heightMm=metadata?image.naturalHeight*25.4/dpiY:null;
   const width=metadata?widthMm/scale:image.naturalWidth,height=metadata?heightMm/scale:image.naturalHeight;
   const r=svg.getBoundingClientRect(),center=position||{x:(r.width/2-camera.x)/camera.z,y:(r.height/2-camera.y)/camera.z};
   const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[f.type],name=f.name?.trim()||`${pasted?'粘贴图片':'导入图片'}.${extension}`;
   const incoming={name,dataUrl,x:pasted?center.x:center.x-width/2,y:pasted?center.y:center.y-height/2,width,height,opacity:1};
   if(![incoming.x,incoming.y,width,height].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7)||width<=0||height<=0)throw new Error('图片尺寸换算超出范围，请检查图片 DPI 和画布比例');
   checkpoint();const layer=L.addImage(doc,incoming);
   if(metadata&&!doc.calibration){doc.calibration={a:{x:0,y:0},b:{x:1,y:0},length:scale,unit:'mm'};doc.measureUnit='mm';}
   activeLayer=layer.id;selectElements([],layer.imageIds);setTool('select');changed(`图片已${pasted?'粘贴到':'导入'}新图层${metadata?` · ${metadata.defaultDpi?'扫描默认 DPI':'DPI'} ${dpiX.toFixed(2)} × ${dpiY.toFixed(2)} · 实际尺寸 ${widthMm.toFixed(2)} × ${heightMm.toFixed(2)} mm`:''}；拖动可移动，拖角可缩放，原有画板保留`);if(!pasted)fit();
  };
  if(metadata&&window.CurveVectorFiles.needsImportCalibration(doc)){vectorFiles.deferUntilCalibrated(apply,pasted?'粘贴图片':'导入图片');return;}
  apply();
 }
 $('image-file').onchange=async e=>{try{await importImage(e.target.files[0]);}catch(err){status(err.message);}e.target.value='';};
 svg.addEventListener('dragover',e=>{e.preventDefault();});svg.addEventListener('drop',async e=>{e.preventDefault();if(fairingDraft||simplifyDraft||['application/x-curve-editor-panel','application/x-curve-editor-elements','application/x-curve-editor-layer'].some(type=>e.dataTransfer.types.includes(type)))return;try{const f=e.dataTransfer.files[0];if(f&&/\.(ai|dxf|plt)$/i.test(f.name))await vectorFiles.openFile(f,{append:true,position:point(e)});else await importImage(f,point(e));}catch(err){status(err.message);}});
 const CURVE_CLIPBOARD_TYPE='application/x-curve-editor-curves';
 let clipboardPageId=uid();
 let curveClipboardWrite=Promise.resolve(true),curveClipboardCopiedAt=0;
 async function sharedCurveClipboard(data){
  const response=await fetch('/api/curve-clipboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error('曲线共享暂不可用');return response.json();
 }
 function clipboardBlocked(e){return document.querySelector('dialog[open]')||symmetryDraft||replay||e?.target.closest?.('input,textarea,select')||e?.target.isContentEditable;}
 function hasCopyElements(){return selectedCurves().some(p=>p.nodes.length)||selectedImages().length>0||selectedTexts().length>0;}
 function pastePosition(){
  const r=svg.getBoundingClientRect(),p=pointerScreen||{x:r.width/2,y:r.height/2};
  return {x:(p.x-camera.x)/camera.z,y:(p.y-camera.y)/camera.z};
 }
 async function copyCurves(data=null){
  if(clipboardBlocked())return;blurEditor();endDrag();
  const segment=editingSegment(),paths=segment?[copySegmentPath(segment)]:clone(selectedCurves().filter(p=>p.nodes.length));
  const images=segment?[]:clone(selectedImages()),texts=segment?[]:clone(selectedTexts());
  if(!paths.length&&!images.length&&!texts.length)return;
  for(const text of texts){const source=L.positionLabelPath(doc,text);if(source)text.positionMarker.pathId=source.id;}
  const chosen=new Set([...paths.map(p=>'path:'+p.id),...images.map(i=>'image:'+i.id),...texts.map(t=>'text:'+t.id)]);
  const items=L.ordered(doc).flatMap(layer=>L.items(doc,layer)).filter(i=>chosen.has(i.type+':'+i.id)).map(({type,id})=>({type,id}));
  const copiedAt=performance.timeOrigin+performance.now();
  const clipboard={format:'curve-editor-clipboard',version:3,copiedAt,paths,images,texts,items,calibration:doc.calibration?clone(doc.calibration):null,sourcePageId:clipboardPageId};
  const text=JSON.stringify(clipboard);
  if(new Blob([text]).size>32*1024*1024){status('所选元素超过 32MB，请减少图片或分批复制');return;}
  curveClipboardCopiedAt=copiedAt;curveClipboard=clipboard;
  // Serialize local copies; publication is atomic across different editor ports.
  const published=curveClipboardWrite=curveClipboardWrite.then(()=>sharedCurveClipboard({action:'write',clipboard:JSON.parse(text)})).then(()=>true,()=>false);
  let local=false;
  try{if(data){data.setData(CURVE_CLIPBOARD_TYPE,text);data.setData('text/plain',text);}else{if(!navigator.clipboard?.writeText)throw new Error('unavailable');await navigator.clipboard.writeText(text);}}catch{local=true;}
  const shared=await published;
  status(`已复制 ${segment?'1 条线段':`${chosen.size} 个元素`}${shared?'（可跨页面粘贴）':local?'（当前页面）':'（跨页面请按 ⌘ / Ctrl + V）'}；${clipboard.calibration?'已携带实际尺寸，粘贴时整体左上角对齐鼠标位置':'来源尚未标定，本页可按像素粘贴；跨页面请先标定来源后重新复制'}`);
 }
 function readCurveClipboard(text){
  if(!text)return null;if(text.length>32*1024*1024)throw new Error('剪贴板内容超过 32MB');
  let data;try{data=JSON.parse(text);}catch{return null;}
  if(data?.format!=='curve-editor-clipboard')return null;
  if(data.version===1)throw new Error('旧版曲线剪贴板没有尺寸信息，请刷新来源页面并重新复制');
  if(![2,3].includes(data.version)||!Array.isArray(data.paths)||!Object.hasOwn(data,'calibration')||typeof data.sourcePageId!=='string'||!data.sourcePageId.trim()||data.sourcePageId.length>200)throw new Error('剪贴板格式或尺寸信息无效');
  const images=data.version===3?data.images:[],texts=data.version===3?data.texts:[];
  if(!Array.isArray(images)||!Array.isArray(texts)||!data.paths.length&&!images.length&&!texts.length)throw new Error('剪贴板没有可粘贴的元素');
  const layer={id:'clipboard',name:'剪贴板',visible:true,locked:false,pathIds:data.paths.map(p=>p.id),imageIds:images.map(i=>i.id),textIds:texts.map(t=>t.id)};
  if(data.version===3&&data.items!==undefined){
   if(!Array.isArray(data.items)||data.items.some(item=>!item||Object.keys(item).sort().join(',')!=='id,type'||!['path','image','text'].includes(item.type)||typeof item.id!=='string'))throw new Error('剪贴板元素顺序无效');
   layer.items=data.items;
  }
  const validated=validate({format:'daban-curve-editor',version:1,units:'image-px',width:1,height:1,paths:data.paths,images,texts,layers:[layer],originals:[],calibration:data.calibration});
  if(validated.paths.some(p=>!p.nodes.length))throw new Error('剪贴板中的曲线没有节点');
  return {...data,paths:validated.paths,images:validated.images,texts:validated.texts,items:L.items(validated,validated.layers[0]),calibration:validated.calibration||null};
 }
 function pasteCurves(clipboard,layerId=activeLayer,position=pastePosition()){
  if(clipboardBlocked())return;
  const layer=doc.layers.find(l=>l.id===layerId);
  if(!L.writable(doc,layer)){status('当前图层为组、已隐藏或锁定，请选择可编辑的普通图层后粘贴');return;}
  for(const [key,limit,label] of [['paths',500,'条曲线'],['images',200,'张图片'],['texts',500,'段文字']])if(doc[key].length+(clipboard[key]?.length||0)>limit){status(`最多支持 ${limit} ${label}，请先整理画布`);return;}
  if(clipboard.calibration&&window.CurveVectorFiles.needsImportCalibration(doc)){
   const snapshot=clone(clipboard);vectorFiles.deferUntilCalibrated(()=>pasteCurves(snapshot,layerId,position),'粘贴元素');return;
  }
  const prepared=window.CurveVectorFiles.preparePaste(doc,clipboard,clipboardPageId,position),ids=new Map();
  for(const [key,type] of [['paths','path'],['images','image'],['texts','text']])for(const item of prepared[key]){const old=item.id;item.id=uid();ids.set(type+':'+old,item.id);item.name=item.name.slice(0,75)+' · 副本';}
  for(const path of prepared.paths)if(path.sourceImageId){const mapped=ids.get('image:'+path.sourceImageId);if(mapped)path.sourceImageId=mapped;else delete path.sourceImageId;}
  prepared.paths.forEach(stripSymmetry);recolorCurves(prepared.paths);
  for(const text of prepared.texts){
   if(text.positionMarker){const pathId=ids.get('path:'+text.positionMarker.pathId);text.positionMarker.pathId=pathId||uid();if(!pathId)delete text.positionMarker.attachment;}
   if(text.dimension)text.dimension.bindings=Object.fromEntries(Object.entries(text.dimension.bindings||{}).filter(([,binding])=>ids.has('path:'+binding.pathId)).map(([key,binding])=>[key,{...binding,pathId:ids.get('path:'+binding.pathId)}]));
  }
  const paths=prepared.paths.map(p=>p.id),images=prepared.images.map(i=>i.id),texts=prepared.texts.map(t=>t.id);
  const order=clipboard.items||[...clipboard.paths.map(p=>({type:'path',id:p.id})),...(clipboard.images||[]).map(i=>({type:'image',id:i.id})),...(clipboard.texts||[]).map(t=>({type:'text',id:t.id}))];
  const target={...layer,pathIds:[...layer.pathIds,...paths],imageIds:[...layer.imageIds,...images],textIds:[...layer.textIds,...texts],items:[...L.items(doc,layer),...order.map(({type,id})=>({type,id:ids.get(type+':'+id)}))]};
  const draft={...doc,paths:[...doc.paths,...prepared.paths],images:[...doc.images,...prepared.images],texts:[...doc.texts,...prepared.texts],layers:doc.layers.map(l=>l===layer?target:l),calibration:prepared.calibration};
  if(!doc.calibration&&prepared.calibration)draft.measureUnit='mm';
  if(new Blob([JSON.stringify(draft)]).size>32*1024*1024-4096)throw new Error('粘贴后作品超过 32MB，请减少图片或分批处理');
  validate(draft); // Check every element and reference before committing a single undo step.
  blurEditor();endDrag();checkpoint();doc=draft;selectElements(paths,images,texts);
  tool='select';drawing=false;resetAuxiliary(fitting.ready);changed(`已粘贴 ${ids.size} 个元素到“${layer.name}”，整体左上角已对齐鼠标位置；${prepared.sourceCalibrated?'实际尺寸保持不变':'本页按像素粘贴'}；可撤销`);return true;
 }
 async function pasteCurveClipboard(){
  if(clipboardBlocked())return;const layerId=currentLayer()?.id,targetDoc=doc,localCopiedAt=curveClipboardCopiedAt,position=pastePosition();
  try{
   // Editor-only sharing avoids system clipboard permission prompts, including across ports.
   let clipboard=curveClipboard,shared=false,payload;
   const published=await curveClipboardWrite;
   try{payload=await sharedCurveClipboard({action:'read'});shared=true;}catch{}
   if(shared){
    // Prefer a newer local snapshot even if a delayed shared read returns an older copy.
    if(clipboard&&((Number.isFinite(payload?.copiedAt)&&payload.copiedAt<localCopiedAt)||(!published&&!Number.isFinite(payload?.copiedAt)))){if(!published)shared=false;}
    else clipboard=readCurveClipboard(JSON.stringify(payload))||clipboard;
   }
   if(doc!==targetDoc||clipboardBlocked())return;
   if(!clipboard){status(shared?'请先在任一编辑器页面复制元素；从其他应用粘贴请按 ⌘ / Ctrl + V':'曲线共享暂不可用；请重新复制，或按 ⌘ / Ctrl + V 粘贴');return;}
   if(pasteCurves(clipboard,layerId,position)&&!shared)status($('status').textContent+'；跨页面共享暂不可用，已使用本页副本');
  }catch(err){status(`粘贴失败：${err.message}`);}
 }
 $('copy-curves').onclick=()=>copyCurves();$('paste-curves').onclick=pasteCurveClipboard;
 document.addEventListener('copy',e=>{
  // Native text selection (including the page name and drawing ID) takes priority.
  if(window.getSelection()?.toString())return;
  if(e.defaultPrevented||clipboardBlocked(e)||!e.clipboardData||!hasCopyElements())return;
  e.preventDefault();copyCurves(e.clipboardData);
 });
 document.addEventListener('paste',async e=>{
  if(e.defaultPrevented||clipboardBlocked(e))return;
  const data=e.clipboardData;
  try{const paths=readCurveClipboard(data?.getData?.(CURVE_CLIPBOARD_TYPE)||data?.getData?.('text/plain'));if(paths){e.preventDefault();pasteCurves(paths);return;}}
  catch(err){e.preventDefault();status(`粘贴失败：${err.message}`);return;}
  const file=[...(data?.files||[])].find(f=>f.type.startsWith('image/'))||[...(data?.items||[])].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).find(Boolean);
  if(!file)return;
  e.preventDefault();try{await importImage(file,pastePosition(),true,e.isTrusted);}catch(err){status(`粘贴失败：${err.message}`);}
 });
 function validate(raw){
  if(raw?.format!=='daban-curve-editor'||raw.version!==1||raw.units!=='image-px')throw new Error('这不是通用矢量图编辑器保存的修改文件');
  for(const k of ['width','height'])if(!Number.isFinite(raw[k])||raw[k]<1||raw[k]>30000)throw new Error('画板尺寸无效');
  if(!Array.isArray(raw.paths)||raw.paths.length>500)throw new Error('曲线数量无效');
  if(raw.image&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(raw.image.dataUrl)||typeof raw.image.name!=='string'))throw new Error('底图格式无效');
  const ids=new Set();
  const cleanPaths=(paths,unique)=>paths.map(p=>{
   if(typeof p.id!=='string'||(unique&&ids.has(p.id))||!Array.isArray(p.nodes)||p.nodes.length>10000)throw new Error('节点数据无效');ids.add(p.id);
   const nodes=p.nodes.map(n=>{for(const v of [n,n.in,n.out])if(!v||!Number.isFinite(v.x)||!Number.isFinite(v.y)||Math.abs(v.x)>1e7||Math.abs(v.y)>1e7)throw new Error('节点坐标无效');if(n.notchId!==undefined&&(typeof n.notchId!=='string'||!n.notchId.length||n.notchId.length>80))throw new Error('剪口标记无效');if(n.color!==undefined&&(typeof n.color!=='string'||!/^#[0-9a-f]{6}$/i.test(n.color)))throw new Error('节点颜色无效');return {...G.node(n.x,n.y),in:G.point(n.in),out:G.point(n.out),mode:['cusp','smooth','symmetric'].includes(n.mode)?n.mode:'cusp',...(n.notchId!==undefined?{notchId:n.notchId}:{}),...(n.color!==undefined?{color:n.color}:{}),...(n.symmetry!==undefined?{symmetry:readSymmetryTags(n.symmetry)}:{})};});
   if(p.dashed!==undefined&&typeof p.dashed!=='boolean')throw new Error('虚线样式无效');
   if(p.visible!==undefined&&typeof p.visible!=='boolean')throw new Error('曲线可见性无效');
   if(p.sourceImageId!==undefined&&(typeof p.sourceImageId!=='string'||!p.sourceImageId.length||p.sourceImageId.length>80))throw new Error('轮廓来源图片无效');
   return {id:p.id,name:String(p.name||'曲线').slice(0,80),note:String(p.note||''),role:['outline','seam','cut','note'].includes(p.role)?p.role:'outline',color:/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#e04544',closed:!!p.closed&&nodes.length>=3,nodes,...(p.dashed!==undefined?{dashed:p.dashed}:{}),...(p.visible!==undefined?{visible:p.visible}:{}),...(p.sourceImageId!==undefined?{sourceImageId:p.sourceImageId}:{})};
  });
  const d=empty();Object.assign(d,{title:String(raw.title||'修改文件').slice(0,200),width:raw.width,height:raw.height,newNodeMode:['cusp','smooth','symmetric'].includes(raw.newNodeMode)?raw.newNodeMode:'cusp',opacity:Number.isFinite(raw.opacity)?Math.max(0,Math.min(1,raw.opacity)):.65,image:raw.image?{name:raw.image.name,dataUrl:raw.image.dataUrl,width:raw.width,height:raw.height}:null,paths:cleanPaths(raw.paths,true)});
  if(raw.mirrorAxisVisible!==undefined){if(typeof raw.mirrorAxisVisible!=='boolean')throw new Error('对称轴显示状态无效');d.mirrorAxisVisible=raw.mirrorAxisVisible;}
  if(raw.symmetryLinks!==undefined)d.symmetryLinks=readSymmetryLinks(raw.symmetryLinks);
  if(raw.mirrorAxis!=null){
   const axis=raw.mirrorAxis;for(const p of [axis.a,axis.b])if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e7||Math.abs(p.y)>1e7)throw new Error('对称轴坐标无效');
   if(G.dist(axis.a,axis.b)<1e-6)throw new Error('对称轴两点不能重合');d.mirrorAxis={a:G.point(axis.a),b:G.point(axis.b)};
  }
  if(raw.calibration!=null){G.millimetersPerPixel(raw.calibration);d.calibration={a:G.point(raw.calibration.a),b:G.point(raw.calibration.b),length:raw.calibration.length,unit:raw.calibration.unit};}
  if(raw.measureUnit!==undefined&&!['mm','cm'].includes(raw.measureUnit))throw new Error('测量单位无效');
  d.measureUnit=raw.measureUnit||'mm';
  d.originals=cleanPaths(Array.isArray(raw.originals)?raw.originals.slice(0,500):raw.paths,false);
  d.texts=raw.texts===undefined?[]:clone(raw.texts);delete d.layers;delete d.images;if(raw.layers!==undefined)d.layers=clone(raw.layers);if(raw.images!==undefined)d.images=clone(raw.images);return L.normalize(d);
 }
 function readProjectState(state,document){
  if(!state||!['node','select','pen','rectangle','ellipse','pan','axis','measure','calibrate','trace','outline','text','position','dimension'].includes(state.tool)||typeof state.drawing!=='boolean'||![state.selection,state.imageSelection,state.nodeSelection].every(Array.isArray))throw new Error('操作记录中的编辑状态无效');
  if(state.textSelection!==undefined&&!Array.isArray(state.textSelection))throw new Error('文字选择状态无效');
  if(state.layerSelection!==undefined&&!Array.isArray(state.layerSelection))throw new Error('图层选择状态无效');
  if(!document&&state.doc?.operationHistory!==undefined)throw new Error('操作记录不能嵌套');
  const d=document||validate(state.doc),paths=state.selection.filter(id=>typeof id==='string'&&L.editable(d,id)),images=state.imageSelection.filter(id=>typeof id==='string'&&L.editable(d,id,'image'));
  const selected=paths.includes(state.selected)?state.selected:paths.at(-1)||null,path=d.paths.find(p=>p.id===selected);
  const segment=state.segmentSelection,segmentPath=d.paths.find(p=>p.id===segment?.pathId);
  const validSegment=state.tool==='node'&&segmentPath&&paths.includes(segment.pathId)&&Number.isInteger(segment.index)&&segment.index>=0&&segment.index<G.segmentCount(segmentPath);
  return {doc:d,selection:[...new Set(paths)],imageSelection:[...new Set(images)],textSelection:[...new Set((state.textSelection||[]).filter(id=>typeof id==='string'&&L.editable(d,id,'text')))],selected,ni:Number.isInteger(state.ni)&&state.ni>=0&&path?.nodes[state.ni]?state.ni:null,
   activeLayer:d.layers.some(l=>l.id===state.activeLayer)?state.activeLayer:d.layers.at(-1).id,layerSelection:[...new Set((state.layerSelection||[]).filter(id=>d.layers.some(l=>l.id===id)))],
   rotationPivot:state.rotationPivot&&typeof state.rotationPivot.key==='string'&&state.rotationPivot.key.length<=100000&&[state.rotationPivot.x,state.rotationPivot.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7)?{x:state.rotationPivot.x,y:state.rotationPivot.y,key:state.rotationPivot.key}:null,
   segmentSelection:validSegment?{pathId:segment.pathId,index:segment.index}:null,axisSelected:state.axisSelected===true&&!!d.mirrorAxis,
   nodeSelection:state.nodeSelection.filter(n=>n&&L.editable(d,n.pathId)&&Number.isInteger(n.index)&&n.index>=0&&d.paths.find(p=>p.id===n.pathId)?.nodes[n.index]).map(n=>({pathId:n.pathId,index:n.index})),tool:state.tool,drawing:state.drawing&&state.tool==='pen'&&!!path&&!path.closed,drawingEnd:['start','end'].includes(state.drawingEnd)?state.drawingEnd:null};
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
  const data=readProject(raw);clipboardPageId=uid();vectorFiles?.cancelPendingImport();if(replay)stopReplay();
  if(data.history){editingField=null;edits.restore(data.history);applySnapshot(data.current);}
  else{if(record)checkpoint();else edits.clear();doc=data.doc;activeLayer=doc.layers.at(-1).id;resetAuxiliary();selectPaths(editablePaths().length?[editablePaths()[0].id]:[]);tool='node';drawing=false;}
  markClean();render();fit();
 }
 let projectOpenToken=0;
 $('project-file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  const token=++projectOpenToken,startDocument=doc,startPageId=clipboardPageId;
  try{
   if(/\.(ai|dxf|plt)$/i.test(f.name)){await vectorFiles.openFile(f,{isCurrent:()=>token===projectOpenToken&&startPageId===clipboardPageId&&startDocument===doc});return;}
   if(f.size>MAX_PROJECT_FILE)throw new Error('修改文件超过 256MB');
   const raw=JSON.parse(await f.text());
   if(token!==projectOpenToken)return;
   if(startPageId!==clipboardPageId){status('读取期间已切换作品，当前作品保留；请重新打开文件');return;}
   validate(raw);if(dirty&&!confirm('当前修改未保存，仍要打开另一份修改吗？'))return;
   openProject(raw);status(`已打开 ${f.name}`);
  }catch(err){if(token===projectOpenToken)status('打开失败：'+err.message);}
  finally{if(token===projectOpenToken)e.target.value='';}
 };
 function download(data,type,name){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
 $('import-vector').onclick=()=>$('vector-file').click();
 $('vector-file').onchange=async e=>{const file=e.target.files[0];try{if(file)await vectorFiles.openFile(file,{append:true});}finally{e.target.value='';}};
 function appendProject(source,position){
  if(replay)throw new Error('请先结束重放，再导入线稿');
  blurEditor();endDrag();hideMenu();
  const r=svg.getBoundingClientRect(),center=position||{x:(r.width/2-camera.x)/camera.z,y:(r.height/2-camera.y)/camera.z};
  const imported=window.CurveVectorFiles.prepareAppend(doc,source,center);validate(imported.document);
  checkpoint();doc=imported.document;resetAuxiliary();setTool('select');selectPaths(imported.pathIds);layerSelection=imported.layerIds;activeLayer=doc.layers.find(l=>imported.layerIds.includes(l.id)&&L.writable(doc,l))?.id||activeLayer;
  changed();return imported;
 }
 vectorFiles=window.CurveVectorFiles.init({appendProject,startImportCalibration:()=>{$('calibrate').click();showPanel('measurement',true);},getDocument:()=>doc,getLayerIds:selectedLayerIds,isDirty:()=>dirty,isReplaying:()=>!!replay,blurEditor,validate,openProject,status,download,prepareExport:()=>{endDrag();hideMenu();}});
 imageRegion=window.CurveImageRegion.init({getDocument:()=>doc,getPathIds:()=>selection.slice(),getImageIds:()=>imageSelection.slice(),getRevision:()=>edits.revision,isReplaying:()=>!!replay,prepare:()=>{blurEditor();endDrag();commitEdit();drawing=false;clearTrace();},status,commit:(results,side)=>{checkpoint();for(const result of results)doc.images.find(i=>i.id===result.id).dataUrl=result.dataUrl;traceRasters.clear();traceWorkerAsset=null;changed(`已清除 ${results.length} 张图片的${side==='outside'?'圈外':'圈内'}内容，可一步撤销`);}});
 printing=window.CurvePrinting.init({getDocument:()=>doc,getPathIds:()=>selection,isReplaying:()=>!!replay,status,prepare:()=>{blurEditor();endDrag();commitEdit();hideMenu();}});
 async function save(){
  if(saveBusy||replay)return;blurEditor();
  saveBusy=true;$('save').disabled=true;
  const startPageId=clipboardPageId,payload=clone(doc);payload.savedAt=new Date().toISOString();payload.paths=payload.paths.filter(p=>p.nodes.length);L.prune(payload);const stamp=JSON.stringify(doc);
  try{
   const response=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json','X-Editor-Edited-At':String(artworkEditTime())},body:JSON.stringify(payload)});
   if(!response.ok)throw new Error(await response.text());const result=await response.json();
   if(startPageId!==clipboardPageId)return;
   lastSaved=result.filename;if(JSON.stringify(doc)===stamp)markClean(true);else scheduleSession();status(`已保存 ${result.filename}。${workspace?.mode==='shared'?'共享工作区的其他会话可重新打开接续编辑':'回聊天说“按最新保存的曲线改”即可'}`);
  }catch(err){download(JSON.stringify(payload,null,2),'application/json',`${payload.title}.json`);if(startPageId===clipboardPageId)status('本机保存服务不可用，已改为下载修改文件；请保留并发给 AI');}
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
   const payload={...currentDoc,drawingId:window.EditorSession?.drawingId||undefined,savedAt:new Date().toISOString(),operationHistory:window.CurveInteractions.packSession({current:editorState,history:edits.serialize(current)})};
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
 const canvasLayoutObserver=new ResizeObserver(()=>{
  const {width,height,top}=svg.getBoundingClientRect();
  document.documentElement.style.setProperty('--preview-dialog-top',`${Math.max(8,top+8)}px`);
  if(doc&&canvasSize){camera.x+=(width-canvasSize.width)/2;camera.y+=(height-canvasSize.height)/2;renderCanvas();}
  canvasSize={width,height};
 });
 canvasLayoutObserver.observe(svg.parentElement);
 canvasLayoutObserver.observe(document.querySelector('.actionbar'));
 demo();
 async function restoreSession(){
  const startingRevision=edits.revision;
  let latestFilename='';
  const get=async url=>{try{const r=await fetch(url);if(!r.ok)return null;if(url==='/api/latest')latestFilename=decodeURIComponent(r.headers.get('X-Curve-Filename')||'');return await r.json();}catch{return null;}};
  const [health,latest]=await Promise.all([get('/api/health'),get('/api/latest')]);let stored=null,recoveredData=null,legacyBackupFailed=false;
  if(health?.editor?.blank&&!latest&&!dirty&&edits.revision===startingRevision&&!edits.hasChanges(snapshot())){
   doc=empty();resetAuxiliary();selectPaths([]);drawing=false;markClean(true);render();fit();status('空白画板已就绪；可以画线或导入图片');
  }
  try{
   if(typeof health?.project!=='string'||typeof health?.saves!=='string')throw new Error('项目身份不可用');
   sessionKey=JSON.stringify([health.project,health.saves]);
   workspace=health.workspace||{mode:'shared',id:'default'};
   const label=$('workspace-status');label.dataset.mode=workspace.mode;
   label.textContent=workspace.mode==='isolated'?'独立会话':`共享：${workspace.id==='default'?'旧版项目存档':workspace.id}`;
   label.title=workspace.mode==='isolated'?`会话 ${workspace.id} · 画布、记录和作品独立保存`:`共享工作区 ${workspace.id} · 保存后其他会话可接续；各自保留未保存草稿`;
   if(workspace.mode==='shared'){
    const url=new URL(location.href);let client=url.searchParams.get('client');
    // The old bare project URL keeps its original browser record. New shared
    // launches include a member identity, so their drafts never replace it.
    if(!client&&workspace.id!=='default'){client=uid();url.searchParams.set('client',client);history.replaceState(null,'',url);}
    if(client)sessionKey=JSON.stringify([health.project,health.saves,client]);
   }
   sessionDB=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('curve-editor-sessions',2);
    request.onupgradeneeded=()=>{
     if(!request.result.objectStoreNames.contains('projects'))request.result.createObjectStore('projects');
     if(!request.result.objectStoreNames.contains('assets'))request.result.createObjectStore('assets').createIndex('project','project');
    };
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('记录存储被占用'));
   });
   const readRecord=key=>new Promise((resolve,reject)=>{const request=sessionDB.transaction('projects').objectStore('projects').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const canonical=await readRecord(sessionRecordKey()),candidates=[];
   let journal=null;const head=sessionHead();
   const refreshKey=typeof head?.journal==='string'&&head.journal.startsWith(journalKey()+':page:')?head.journal:journalKey();
   try{journal=JSON.parse(localStorage.getItem(refreshKey));}catch{}
   if(journal&&(!canonical||journal.updatedAt>canonical.updatedAt&&(journal.contentChanged||journal.baseRevision===canonical.writeId||journal.writer===canonical.writer)))candidates.push(journal);
   if(canonical)candidates.push(canonical);
   const legacy=await readRecord(sessionKey);let legacyJournal=null;
   try{legacyJournal=JSON.parse(localStorage.getItem(`curve-editor-refresh:${sessionKey}`));}catch{}
   // An old tab may still be editing during an upgrade. Preserve each distinct
   // legacy snapshot before ignoring its unversioned unload writes.
   if(canonical)for(const old of [legacy,legacyJournal])if(old&&JSON.stringify(old.data)!==JSON.stringify(canonical.data))try{
    const bytes=new TextEncoder().encode(JSON.stringify(old)),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    await new Promise((resolve,reject)=>{const t=sessionDB.transaction('projects','readwrite');t.objectStore('projects').put(old,`${sessionRecordKey()}:legacy:${digest}`);t.oncomplete=resolve;t.onabort=()=>reject(t.error);});
   }catch{legacyBackupFailed=true;}
   if(legacyJournal)candidates.push(legacyJournal);if(legacy)candidates.push(legacy);
   for(const candidate of candidates)try{
    const loaded=await readSessionAssets(candidate);recoveredData=validateRecoveredSession(window.CurveInteractions.unpackSession(loaded));stored=loaded;
    if(candidate===journal){journalToken=journal.journalId;journalStorageKey=refreshKey;sessionRecoveryBase=canonical?.writeId||null;}
    // Navigation can interrupt the completion callback after the data commits.
    // Retire only journals proven superseded by this same writer's valid record.
    if(candidate===canonical)try{for(const key of Object.keys(localStorage))if(key.startsWith(journalKey()+':page:')){
     const old=JSON.parse(localStorage.getItem(key));
     if(old?.writer===canonical.writer&&old.updatedAt<=canonical.updatedAt)localStorage.removeItem(key);
    }}catch{}
    break;
   }catch{}
   sessionRevision=stored?.writeId||null;
  }catch{storageStatus('unavailable','本机记录不可用，无法保证刷新恢复；请保存作品');}
  if(!dirty&&edits.revision===startingRevision&&!edits.hasChanges(snapshot())){
   let restored=false;
   if(stored)try{
    const data=recoveredData;
    const revision=typeof data.savedRevision==='string'?data.savedRevision:'',sharedUpdate=workspace?.mode==='shared'&&latest&&latestFilename&&revision!==latestFilename;
    // Shared-saved work and an untouched initial demo can follow another member.
    // Imports and Save As copies are locally clean but remain member-owned work.
    if(!sharedUpdate||data.workspaceClean!==true||!data.cleanDoc||!sameDoc(data.cleanDoc,data.current.doc)){
     lastSaved=revision;workspaceClean=data.workspaceClean===true;lastArtworkEditAt=Number.isFinite(data.lastArtworkEditAt)&&data.lastArtworkEditAt>0?data.lastArtworkEditAt:0;edits.restore(data.history);applySnapshot(data.current);cleanDoc=data.cleanDoc;camera=data.camera;updateDirty();render();restored=true;
     status(sharedUpdate?`共享工作区已有新保存；已保留本会话${dirty?'未保存草稿':'本地作品'}和操作记录`:'已恢复当前作品和操作记录，可继续编辑或重放');
    }
   }catch{status('本机操作记录无法读取，已尝试恢复最新保存的作品');}
   if(!restored&&latest)try{lastSaved=latestFilename;openProject(latest,false);workspaceClean=true;status(workspace?.mode==='shared'?'已载入共享工作区最新保存，可继续编辑':'已恢复本会话上次保存的修改。所有文件都留在本机');}catch{}
  }
  // Other open pages may still use older image keys; retain them in local cache.
  sessionBaseDoc=(replay?.original||snapshot()).doc;sessionBaseHistoryRevision=edits.revision;sessionBaseSaved=lastSaved;
  sessionBooting=false;restorePanelScroll();if(sessionDB)scheduleSession();window.EditorSession?.ready(dirty);
  if(legacyBackupFailed)status('已恢复当前画布和操作记录；旧版页面的另一份记录未能备份，请保留旧版页面');
 }
 restoreSession();
})();
