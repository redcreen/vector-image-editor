(function(root){
 'use strict';
 const G=typeof module!=='undefined'?require('./geometry.js'):root.CurveGeometry;
 const L=typeof module!=='undefined'?require('./layers.js'):root.CurveLayers;
 function physicalSize(bounds,calibration){
  if(!bounds)return '';
  if(!calibration)return '实际尺寸未标定';
  try{const scale=G.millimetersPerPixel(calibration);return `实际尺寸：${(bounds.width*scale).toFixed(2)} × ${(bounds.height*scale).toFixed(2)} mm`;}catch{return '实际尺寸比例无效';}
 }
 function needsImportCalibration(doc){
  return !doc.calibration&&!!(doc.paths?.some(p=>p.nodes?.length)||doc.images?.length||doc.texts?.length||doc.image);
 }
 function preparePaste(current,clipboard,pageId,position=null){
  const sourceScale=clipboard.calibration?G.millimetersPerPixel(clipboard.calibration):null;
  if(sourceScale===null&&clipboard.sourcePageId!==pageId)throw new Error('来源画布未标定，无法确定实际尺寸；请在来源完成标定后重新复制');
  if(sourceScale!==null&&needsImportCalibration(current))throw new Error('目标画布尚未标定，请先设置两点的实际距离');
  const copy=value=>JSON.parse(JSON.stringify(value));
  const calibration=current.calibration?copy(current.calibration):copy(clipboard.calibration);
  const scale=sourceScale===null?1:sourceScale/G.millimetersPerPixel(calibration);
  const result={paths:copy(clipboard.paths),images:copy(clipboard.images||[]),texts:copy(clipboard.texts||[]),calibration,scale,sourceCalibrated:sourceScale!==null};
  const paths=result.paths.map(p=>p.id),images=result.images.map(i=>i.id),texts=result.texts.map(t=>t.id);
  L.transform(result,paths,images,{x:0,y:0,width:1,height:1},{x:0,y:0,width:scale,height:scale},texts);
  if(position){
   const bounds=L.bounds(result,paths,images,texts);
   if(bounds)L.transform(result,paths,images,bounds,{...bounds,x:position.x,y:position.y},texts);
  }
  return result;
 }
 function prepareAppend(current,source,position={x:0,y:0}){
  if(needsImportCalibration(current))throw new Error('现有画布尚未标定，请先设置两点的实际距离');
  if(!source.calibration)throw new Error('导入文件缺少实际尺寸比例');
  const sourceScale=G.millimetersPerPixel(source.calibration),targetScale=current.calibration?G.millimetersPerPixel(current.calibration):sourceScale;
  if(current.paths.length+source.paths.length>500)throw new Error('导入后超过 500 条曲线，请先整理画布');
  if((current.originals?.length||0)+source.paths.length>500)throw new Error('导入后超过 500 条对照原稿，请先整理作品');
  if((current.layers?.length||0)+(source.layers?.length||1)>200)throw new Error('导入后超过 200 个图层，请先整理画布');
  if(source.image||source.images?.length||source.texts?.length)throw new Error('导入线稿仅支持可编辑曲线');
  const copy=value=>JSON.parse(JSON.stringify(value)),incoming=L.normalize(copy(source)),result=copy(current);
  const bounds=L.bounds(incoming,incoming.paths.map(p=>p.id),[]);
  if(!bounds)throw new Error('文件没有可导入的曲线');
  const scale=sourceScale/targetScale,cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
  const point=p=>{const x=(p.x-cx)*scale+position.x,y=(p.y-cy)*scale+position.y;if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>1e7||Math.abs(y)>1e7)throw new Error('换算后坐标超出范围，请检查画布标定');return {x,y};};
  const ids=new Map(incoming.paths.map(p=>[p.id,crypto.randomUUID()])),layerIds=new Map(incoming.layers.map(l=>[l.id,crypto.randomUUID()]));
  for(const path of incoming.paths){
   path.id=ids.get(path.id);
   for(const node of path.nodes){const anchor=point(node),input=point(node.in),output=point(node.out);Object.assign(node,anchor,{in:input,out:output});}
  }
  for(const layer of incoming.layers){
   layer.id=layerIds.get(layer.id);if(layer.parentId)layer.parentId=layerIds.get(layer.parentId);
   layer.name=((source.title||'导入线稿')+' · '+layer.name).slice(0,80);
   layer.pathIds=layer.pathIds.map(id=>ids.get(id));
   if(layer.items)layer.items=layer.items.map(item=>({...item,id:ids.get(item.id)}));
  }
  result.paths.push(...incoming.paths);result.layers.push(...incoming.layers);
  result.originals=[...(result.originals||[]),...copy(incoming.paths)];
  if(!current.calibration){result.calibration={a:{x:0,y:0},b:{x:1,y:0},length:sourceScale,unit:'mm'};result.measureUnit='mm';}
  return {document:result,pathIds:[...ids.values()],layerIds:[...layerIds.values()],widthMm:bounds.width*sourceScale,heightMm:bounds.height*sourceScale};
 }
 function scopeInfo(doc,layerIds=null){
  const result={pathIds:[],textIds:[],imageIds:[],nodeCount:0,widthMm:0,heightMm:0,error:''};
  const allowed=layerIds===null?null:new Set(layerIds.flatMap(id=>L.family(doc,id).map(l=>l.id)));
  for(const layer of L.ordered(doc)){
   if(allowed&&!allowed.has(layer.id))continue;
   for(const item of L.items(doc,layer))if(L.visible(doc,item.id,item.type)){
    if(item.type==='path'){
     const path=doc.paths.find(p=>p.id===item.id);if(!path?.nodes.length)continue;
     result.nodeCount+=path.nodes.length;
    }
    result[item.type+'Ids'].push(item.id);
   }
  }
  if(!result.pathIds.length&&!result.textIds.length&&!result.imageIds.length){result.error='所选范围没有可见内容';return result;}
  if(!doc.calibration){result.error='尚未设置实际尺寸比例，请先完成两点标定';return result;}
  try{
   const scale=G.millimetersPerPixel(doc.calibration),bounds=L.bounds(doc,result.pathIds,[],result.textIds);
   if(bounds){result.widthMm=bounds.width*scale;result.heightMm=bounds.height*scale;}
  }catch(err){result.error=err.message;return result;}
  if(result.imageIds.length)result.error='所选范围包含图片，请选择仅含矢量内容的图层';
  return result;
 }
 function init(bridge){
  const $=id=>document.getElementById(id),dialog=$('vector-export-dialog'),unitDialog=$('vector-unit-dialog');
  let exportSource=null,exportLayers=[],exportToken=0,importToken=0,unitResolve=null,exportPreviewCache=new Map(),exportManualMode=false,pendingImport=null;
  const filename=(value,extension)=>((String(value||'矢量作品').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').replace(/\.(ai|dxf|svg)$/i,'').trim()||'矢量作品').slice(0,180)+'.'+extension);
  function chooseUnits(name){
   if(unitResolve)unitResolve(null);
   $('vector-unit-filename').textContent=name;$('vector-unit-select').value='mm';unitDialog.showModal();
   return new Promise(resolve=>{unitResolve=resolve;});
  }
  function closeUnits(value){const resolve=unitResolve;unitResolve=null;if(unitDialog.open)unitDialog.close();resolve?.(value);}
  $('vector-unit-form').onsubmit=e=>{e.preventDefault();closeUnits($('vector-unit-select').value);};
  $('vector-unit-cancel').onclick=()=>closeUnits(null);unitDialog.addEventListener('cancel',e=>{e.preventDefault();closeUnits(null);});
  function cancelPendingImport(){const label=pendingImport?.label||'导入线稿',hadPending=!!pendingImport;pendingImport=null;$('vector-import-pending').hidden=true;if(hadPending)bridge.status(`已取消待${label}，当前作品保留`);}
  function deferUntilCalibrated(apply,label='粘贴曲线'){
   cancelPendingImport();if(unitResolve)closeUnits(null);
   pendingImport={startDocument:bridge.getDocument(),token:++importToken,apply,label};
   bridge.startImportCalibration();
   $('vector-import-pending').textContent=`待${label}：请在目标画布选取两点，填写已知实际距离。应用比例后继续；取消则保留原画布。`;
   $('vector-import-pending').hidden=false;bridge.status(`目标画布没有实际比例，请先完成两点标定；标定后自动${label}`);
  }
  function appendResult(entry){
   if(entry.token!==importToken||entry.startDocument!==bridge.getDocument()||bridge.isReplaying()){cancelPendingImport();bridge.status('画布已切换，已取消待导入线稿');return false;}
   const {result,file,position}=entry;
   if(needsImportCalibration(bridge.getDocument())){
    pendingImport=entry;bridge.startImportCalibration();
    $('vector-import-pending').textContent=`待导入 ${file.name}：请在原画布选取两点，填写已知实际距离。应用比例后继续导入；取消则保留原画布。`;
    $('vector-import-pending').hidden=false;bridge.status('现有画布没有实际比例，请先完成两点标定；文件已保留，标定后自动导入');return false;
   }
   cancelPendingImport();
   const imported=bridge.appendProject(result.document,position),warning=(result.warnings||[]).join('；');
   bridge.status(`已导入 ${file.name} · ${result.document.paths.length} 条曲线 · ${imported.widthMm.toFixed(3)} × ${imported.heightMm.toFixed(3)} mm · 已按画布比例换算，可撤销${warning?'；'+warning:''}`);return true;
  }
  function resumeImport(){
   if(!pendingImport)return;
   const entry=pendingImport;
   try{
    if(entry.apply){
     cancelPendingImport();
     if(entry.token!==importToken||entry.startDocument!==bridge.getDocument()||bridge.isReplaying()){bridge.status('画布已切换，已取消待粘贴曲线');return;}
     entry.apply();
    }else appendResult(entry);
   }catch(err){cancelPendingImport();bridge.status((entry.apply?'粘贴':'导入')+'失败：'+err.message);}
  }
  async function openFile(file,{append=false,position=null,isCurrent=()=>true}={}){
   if(!file)return;const token=++importToken,startDocument=bridge.getDocument(),current=()=>token===importToken&&isCurrent()&&startDocument===bridge.getDocument();
   cancelPendingImport();if(bridge.isReplaying()){bridge.status('请先结束重放，再导入线稿');return;}
   if(unitResolve)closeUnits(null);
   try{
    if(file.size>16*1024*1024)throw new Error('AI / DXF / PLT 文件超过 16MB');
    bridge.status(`正在读取 ${file.name}…`);
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件读取失败'));reader.readAsDataURL(file);});
    let unit=null,result;
    while(current()){
     const response=await fetch('/api/vector/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:file.name,data,unit})});
     const payload=await response.json();if(!current())return;
     if(payload.needsUnit){unit=await chooseUnits(file.name);if(!current())return;if(!unit){bridge.status('已取消导入，当前作品保留');return;}continue;}
     if(!response.ok)throw new Error(payload.error||'读取失败');result=payload;break;
    }
    if(!current()||!result)return;
    bridge.validate(result.document);
    bridge.blurEditor();
    if(append){appendResult({result,file,position,token,startDocument});return;}
    if(bridge.isDirty()&&!confirm('当前修改未保存，仍要打开另一份矢量文件吗？')){bridge.status('已取消导入，当前作品保留');return;}
    bridge.openProject(result.document);
    const warning=(result.warnings||[]).join('；');
    bridge.status(`已打开 ${file.name} · ${result.document.paths.length} 条曲线 · 已恢复实际尺寸${warning?'；'+warning:''}`);
   }catch(err){if(current())bridge.status('打开失败：'+err.message);}
  }
  const previewScopeKey=()=>$('vector-export-scope').value==='layers'?'layers:'+exportLayers.join('\u0000'):'all';
  const previewKey=format=>format+':'+previewScopeKey();
  const previewIds=()=>$('vector-export-scope').value==='layers'?exportLayers:null;
  function setPreviewPending(format){
   $('vector-export-counts').textContent='正在计算实际导出曲线节点…';$('vector-export-file-points').textContent=`${format.toUpperCase()} 正在计算文件坐标点…`;
   $('vector-export-count-note').textContent='曲线节点不含控制柄，按实际生成文件统计；对方软件再次转换后数量可能变化。';
   $('vector-export-dxf-mode').disabled=true;$('vector-export-confirm').disabled=true;
   $('vector-export-error').textContent='';
  }
  function setDxfHint(mode){$('vector-export-hint').textContent=mode==='spline'?'毫米 DXF；保留贝塞尔曲线和控制柄。目标软件需要支持 DXF 样条。':'毫米 DXF；曲线转为连续折线，最大偏差 0.01 mm。';}
  function statsHeadline(stats){return `共 ${stats.curveCount} 条曲线 · 曲线节点：原 ${stats.sourceNodeCount} 个 → 导出 ${stats.curveNodeCount} 个${stats.textCount?' · '+stats.textCount+' 段文字'+(stats.textOutlineCount?`已转曲线（${stats.textOutlineCount} 条轮廓）`:''):''}`;}
  function setStats(format,stats){
   $('vector-export-counts').textContent=statsHeadline(stats);
   $('vector-export-file-points').textContent=format==='dxf'?`DXF 文件控制点（样条）${stats.splineControlPointCount} 个 · 折线顶点 ${stats.polylineVertexCount} 个`:`${format.toUpperCase()} 文件坐标点 ${stats.filePointCount} 个（其中控制柄 ${stats.fileHandlePointCount} 个；含闭合重复点）`;
   $('vector-export-count-note').textContent='曲线节点不含控制柄，按实际生成文件统计；对方软件再次转换后数量可能变化。'+(stats.textOutlineCount?' 导出数量含文字轮廓和点位标记；文字以轮廓线输出，原文字仍可编辑。':'');
   if(Number.isFinite(stats.widthMm)&&Number.isFinite(stats.heightMm))$('vector-export-size').textContent=`宽 ${stats.widthMm.toFixed(3)} × 高 ${stats.heightMm.toFixed(3)} mm`;
  }
  function applyDxfPreview(entry,baseError){
   const mode=$('vector-export-dxf-mode'),modes=entry.payload.modes||{},spline=modes.spline||{error:'保留曲线不可用'},polyline=modes.polyline||{error:'折线兼容不可用'};
   mode.options[0].toggleAttribute('disabled',!!spline.error);mode.options[1].toggleAttribute('disabled',!!polyline.error);
   const available=['spline','polyline'].filter(name=>modes[name]&&!modes[name].error);
   if(!available.length){mode.disabled=true;$('vector-export-confirm').disabled=true;$('vector-export-counts').textContent='无法计算实际导出曲线节点';$('vector-export-file-points').textContent='DXF 文件坐标点计算失败';$('vector-export-error').textContent=[spline.error,polyline.error].filter(Boolean).join('；');return;}
   if(!exportManualMode||!available.includes(mode.value))mode.value=available.includes(entry.payload.recommendedMode)?entry.payload.recommendedMode:available[0];
   mode.disabled=false;const stats=modes[mode.value];setStats('dxf',stats);setDxfHint(mode.value);$('vector-export-count-note').textContent+=' DXF 默认比较导出曲线节点数，较少者优先，相同则保留曲线。';
   const failed=[];if(spline.error)failed.push(`保留曲线：${spline.error}`);if(polyline.error)failed.push(`折线兼容：${polyline.error}`);$('vector-export-error').textContent=failed.join('；');
   $('vector-export-confirm').disabled=!!baseError;
  }
  function applyPreview(entry,format,baseError){
   if(format==='dxf'){applyDxfPreview(entry,baseError);return;}
   setStats(format,entry.payload.stats);$('vector-export-dxf-mode').disabled=true;$('vector-export-confirm').disabled=!!baseError;
  }
  function requestPreview(format,key,ids,token,baseError){
   const entry={status:'pending',payload:null,error:''};exportPreviewCache.set(key,entry);setPreviewPending(format);
   fetch('/api/vector/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({document:exportSource,format,layerIds:ids})}).then(async response=>{
    const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||`${format.toUpperCase()} 文件节点计算失败`);entry.status='ready';entry.payload=payload;
    if(token===exportToken&&exportSource&&$('vector-export-format').value===format&&previewKey(format)===key)applyPreview(entry,format,baseError);
   }).catch(err=>{
    entry.status='error';entry.error=err.message||'文件节点计算失败';
    if(token===exportToken&&exportSource&&$('vector-export-format').value===format&&previewKey(format)===key){$('vector-export-counts').textContent='无法计算实际导出曲线节点';$('vector-export-file-points').textContent=`${format.toUpperCase()} 文件坐标点计算失败`;$('vector-export-error').textContent=entry.error;$('vector-export-dxf-mode').disabled=true;$('vector-export-confirm').disabled=true;}
   });
  }
  function updateExport(){
   if(!exportSource)return;
   const selected=$('vector-export-scope').value==='layers',ids=selected?exportLayers:null;
   const info=scopeInfo(exportSource,ids),format=$('vector-export-format').value,dxfMode=$('vector-export-dxf-mode').value;
   const error=info.error;
   $('vector-export-counts').textContent=`正在计算实际导出曲线节点…`;$('vector-export-file-points').textContent='';
   $('vector-export-size').textContent=error||`宽 ${info.widthMm.toFixed(3)} × 高 ${info.heightMm.toFixed(3)} mm`;
   $('vector-export-size').dataset.error=error?'true':'false';
   $('vector-export-confirm').disabled=!!error;$('vector-export-calibrate').hidden=!!exportSource.calibration;
   $('vector-export-dxf-mode-field').hidden=format!=='dxf';
   $('vector-export-hint').textContent=format==='ai'?'保留贝塞尔曲线和实际尺寸；适合交给使用 CorelDRAW / Illustrator 的对方继续编辑。':format==='dxf'?(dxfMode==='spline'?'毫米 DXF；保留贝塞尔曲线和控制柄。目标软件需要支持 DXF 样条。':'毫米 DXF；曲线转为连续折线，最大偏差 0.01 mm。'):'SVG 写入毫米宽高，保持当前实际比例。';
   $('vector-export-count-note').textContent='曲线节点不含控制柄，按实际生成文件统计；对方软件再次转换后数量可能变化。';
   $('vector-export-name').value=filename($('vector-export-name').value,format);
   $('vector-export-error').textContent='';
   const mode=$('vector-export-dxf-mode');mode.options[0].disabled=false;mode.options[1].disabled=false;mode.disabled=format!=='dxf';
   if(error){$('vector-export-counts').textContent=`共 ${info.pathIds.length} 条曲线 · 原曲线节点 ${info.nodeCount} 个 · 导出后数量暂不可计算`;$('vector-export-file-points').textContent='';mode.disabled=true;return;}
   const key=previewKey(format),entry=exportPreviewCache.get(key);
   if(!entry){requestPreview(format,key,previewIds(),exportToken,error);return;}
   if(entry.status==='pending'){setPreviewPending(format);return;}
   if(entry.status==='error'){$('vector-export-counts').textContent='无法计算实际导出曲线节点';$('vector-export-file-points').textContent=`${format.toUpperCase()} 文件坐标点计算失败`;$('vector-export-error').textContent=entry.error;mode.disabled=true;$('vector-export-confirm').disabled=true;return;}
   applyPreview(entry,format,error);
  }
  function openExport(selected=false){
   if(bridge.isReplaying?.())return;bridge.blurEditor();bridge.prepareExport?.();
   exportSource=JSON.parse(JSON.stringify(bridge.getDocument()));exportLayers=bridge.getLayerIds().slice();exportToken++;exportPreviewCache=new Map();exportManualMode=false;
   $('vector-export-format').value='ai';$('vector-export-dxf-mode').value='spline';$('vector-export-scope').value=selected?'layers':'all';
   const labels=exportSource.layers.filter(l=>exportLayers.includes(l.id)).map(l=>l.name);
   $('vector-export-layers').textContent=labels.length?labels.join('、'):'未选择图层';
   const today=new Date(),date=`${today.getMonth()+1}.${today.getDate()}`;
   const drawingName=filename(root.EditorSession?.name||exportSource.title,'ai').slice(0,-3);
   $('vector-export-name').value=filename(drawingName.slice(0,180-date.length)+date,'ai');
   updateExport();dialog.showModal();
  }
  function closeExport(){exportToken++;exportSource=null;exportPreviewCache=new Map();if(dialog.open)dialog.close();}
  $('vector-export-format').onchange=()=>{exportManualMode=false;updateExport();};$('vector-export-dxf-mode').onchange=()=>{exportManualMode=true;updateExport();};$('vector-export-scope').onchange=()=>{exportManualMode=false;updateExport();};
  $('vector-export-cancel').onclick=closeExport;dialog.addEventListener('cancel',e=>{e.preventDefault();closeExport();});
  $('vector-export-calibrate').onclick=()=>{closeExport();$('calibrate').click();};
  $('vector-export-form').onsubmit=async e=>{
   e.preventDefault();if(!exportSource||$('vector-export-confirm').disabled)return;
   const token=exportToken,format=$('vector-export-format').value,ids=$('vector-export-scope').value==='layers'?exportLayers:null;
   const name=filename($('vector-export-name').value,format);$('vector-export-confirm').disabled=true;$('vector-export-error').textContent='';
   try{
    const payload={document:exportSource,format,layerIds:ids};if(format==='dxf')payload.dxfMode=$('vector-export-dxf-mode').value;
    const response=await fetch('/api/vector/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!response.ok){const error=await response.json();throw new Error(error.error||'导出失败');}
    const blob=await response.blob();if(token!==exportToken)return;
    bridge.download(blob,response.headers.get('Content-Type'),name);closeExport();bridge.status(`已导出 ${name} · 已按实际比例写入尺寸`);
   }catch(err){if(token===exportToken){$('vector-export-error').textContent=err.message;$('vector-export-confirm').disabled=false;}}
  };
  $('export').onclick=()=>openExport(false);$('export-layers').onclick=()=>openExport(true);
  return {openFile,openExport,resumeImport,cancelPendingImport,deferUntilCalibrated};
 }
 const api={physicalSize,needsImportCalibration,prepareAppend,preparePaste,scopeInfo,init};if(typeof module!=='undefined')module.exports=api;else root.CurveVectorFiles=api;
})(typeof window!=='undefined'?window:globalThis);
