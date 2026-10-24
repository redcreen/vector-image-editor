(function(root){
 'use strict';
 const G=typeof module!=='undefined'?require('./geometry.js'):root.CurveGeometry;
 const L=typeof module!=='undefined'?require('./layers.js'):root.CurveLayers;
 function targets(doc,ids,selectedImageIds=[]){
  const path=ids?.length===1&&doc.paths.find(p=>p.id===ids[0]);
  if(!path?.closed||path.nodes.length<3||!L.editable(doc,path.id))throw new Error('请只选中一条可编辑的闭合曲线（至少 3 个节点）');
  const layer=L.layerFor(doc,path.id),editable=doc.images.filter(i=>L.editable(doc,i.id,'image'));
  let images;
  if(path.sourceImageId){
   images=editable.filter(i=>i.id===path.sourceImageId);
   if(!images.length)throw new Error('提取轮廓的原图已删除、隐藏或锁定，请先恢复原图并解锁');
  }else if(selectedImageIds.length){
   images=editable.filter(i=>selectedImageIds.includes(i.id));
   if(images.length!==new Set(selectedImageIds).size)throw new Error('所选图片已隐藏或锁定，请重新选择');
  }else{
   images=editable.filter(i=>layer.imageIds.includes(i.id));
   if(!images.length){
    const bounds=G.pathBounds(path);images=editable.filter(i=>bounds&&L.imageIntersectsRect(i,bounds));
    if(images.length>1)throw new Error('轮廓下有多张图片，请按 Shift 加选要清理的图片后再反选');
   }
  }
  if(!images.length)throw new Error('轮廓范围内没有可编辑图片，请先显示并解锁图片');
  return {path,layer,images};
 }
 function localPath(image,path,width=image.width,height=image.height){
  const point=p=>{const q=L.worldToImage(image,p);return {x:q.x*width/image.width,y:q.y*height/image.height};};
  return {...path,nodes:path.nodes.map(n=>({...n,...point(n),in:point(n.in),out:point(n.out)}))};
 }
 async function erase(image,path,side){
  if(!['inside','outside'].includes(side)||!path.closed||path.nodes.length<3)throw new Error('请选择闭合曲线的圈内或圈外区域');
  const bitmap=new Image();bitmap.src=image.dataUrl;await bitmap.decode();
  const width=bitmap.naturalWidth,height=bitmap.naturalHeight;
  if(!width||!height||width>32767||height>32767||width*height>64000000)throw new Error('图片过大，无法按原分辨率清理；请先分割扫描图片');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法创建图片处理画布');
  ctx.drawImage(bitmap,0,0);ctx.globalCompositeOperation=side==='outside'?'destination-in':'destination-out';
  const nodes=localPath(image,path,width,height).nodes;ctx.beginPath();ctx.moveTo(nodes[0].x,nodes[0].y);
  for(let i=0;i<nodes.length;i++){const a=nodes[i],b=nodes[(i+1)%nodes.length];ctx.bezierCurveTo(a.out.x,a.out.y,b.in.x,b.in.y,b.x,b.y);}
  ctx.closePath();ctx.fill('evenodd');
  const dataUrl=canvas.toDataURL('image/png');canvas.width=canvas.height=0;
  if(!dataUrl.startsWith('data:image/png;base64,'))throw new Error('图片处理失败，原图保持不变');
  return dataUrl;
 }
 function init(bridge){
  const $=id=>document.getElementById(id),dialog=$('image-region-dialog'),preview=$('image-region-preview'),NS='http://www.w3.org/2000/svg';
  let draft=null,generation=0,busy=false;
  const overlay=document.createElementNS(NS,'g');overlay.id='image-region-overlay';overlay.setAttribute('pointer-events','none');$('viewport').append(overlay);
  const el=(tag,attrs,parent)=>{const node=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);parent.append(node);return node;};
  function paintOverlay(){
   overlay.replaceChildren();if(!draft?.canvas)return;
   const defs=el('defs',{},overlay);
   draft.images.forEach((image,index)=>{
    const id=`image-region-world-${index}`,clip=el('clipPath',{id,clipPathUnits:'userSpaceOnUse'},defs);el('rect',{width:image.width,height:image.height},clip);
    const group=el('g',{transform:`translate(${image.x+image.width/2} ${image.y+image.height/2}) rotate(${image.rotation||0}) translate(${-image.width/2} ${-image.height/2})`},overlay),d=G.pathD(localPath(image,draft.path));
    el('path',{d:(draft.side==='outside'?`M 0 0 H ${image.width} V ${image.height} H 0 Z `:'')+d,'fill-rule':'evenodd',fill:'#e04544','fill-opacity':.32,'clip-path':`url(#${id})`},group);
    el('path',{d,fill:'none',stroke:'#1976d2','stroke-width':2,'stroke-dasharray':'6 4','vector-effect':'non-scaling-stroke','clip-path':`url(#${id})`},group);
   });
  }
  function refresh(){
   if(draft?.canvas){paintOverlay();return;}
   if(!draft)return;const {path,images,side}=draft,boxes=images.map(L.imageBounds),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),width=Math.max(...boxes.map(b=>b.x+b.width))-x,height=Math.max(...boxes.map(b=>b.y+b.height))-y;
   preview.replaceChildren();preview.setAttribute('viewBox',`${x} ${y} ${width||1} ${height||1}`);
   const defs=el('defs',{},preview);
   images.forEach((image,index)=>{
    const clipId=`image-region-clip-${index}`,clip=el('clipPath',{id:clipId,clipPathUnits:'userSpaceOnUse'},defs);
    el('rect',{width:image.width,height:image.height},clip);
    const group=el('g',{transform:`translate(${image.x+image.width/2} ${image.y+image.height/2}) rotate(${image.rotation||0}) translate(${-image.width/2} ${-image.height/2})`},preview);
    el('image',{width:image.width,height:image.height,href:image.dataUrl,preserveAspectRatio:'none'},group);
    const d=G.pathD(localPath(image,path));
    el('path',{d:(side==='outside'?`M 0 0 H ${image.width} V ${image.height} H 0 Z `:'')+d,'fill-rule':'evenodd',fill:'#e04544','fill-opacity':.4,'clip-path':`url(#${clipId})`},group);
    el('path',{d,fill:'none',stroke:'#1976d2','stroke-width':2,'vector-effect':'non-scaling-stroke','clip-path':`url(#${clipId})`},group);
   });
   $('image-region-summary').textContent=`图片图层“${[...new Set(images.map(i=>L.layerFor(draft.doc,i.id,'image').name))].join('、')}” · ${images.length} 张图片 · 已选择${side==='outside'?'圈外（保留圈内）':'圈内（保留圈外）'}`;
   $('image-region-invert').textContent=side==='outside'?'反选为圈内':'反选为圈外';
   $('image-region-delete').textContent=busy?'正在处理…':`删除${side==='outside'?'圈外':'圈内'}图片内容`;
   $('image-region-delete').disabled=busy;$('image-region-invert').disabled=busy;
  }
  function close(){generation++;draft=null;busy=false;if(dialog.open)dialog.close();preview.replaceChildren();overlay.replaceChildren();}
  function open(canvas=false){
   if(bridge.isReplaying())return;close();bridge.prepare();
   try{const doc=bridge.getDocument(),result=targets(doc,bridge.getPathIds(),bridge.getImageIds?.()||[]);draft={...result,path:JSON.parse(JSON.stringify(result.path)),images:result.images.map(i=>({...i})),side:'outside',canvas,doc,revision:bridge.getRevision()};}
   catch(err){bridge.status(err.message);return;}
   generation++;busy=false;$('image-region-error').textContent='';refresh();if(canvas){$('canvas').focus({preventScroll:true});bridge.status(`已反选 ${draft.images.length} 张图片的圈外区域（红色）；右键删除所选图片区域，Esc 取消；范围以图片边缘为限`);}else{dialog.showModal();$('image-region-invert').focus();}
  }
  async function apply(){
   if(!draft||busy)return;busy=true;refresh();const current=draft,token=generation,results=[];
   try{
    // Stage every image before creating a single undo step. A failure or cancel
    // must never leave only some images erased.
    for(const image of current.images){const dataUrl=await erase(image,current.path,current.side);if(token!==generation)return;results.push({id:image.id,dataUrl});}
    if(token!==generation)return;
    if(bridge.getDocument()!==current.doc||bridge.getRevision()!==current.revision)throw new Error('作品已有变化，请取消后重新选择区域');
    const latest=targets(current.doc,[current.path.id],current.images.map(i=>i.id));
    if(JSON.stringify(latest.path)!==JSON.stringify(current.path)||latest.images.length!==current.images.length||latest.images.some(i=>!current.images.some(old=>old.id===i.id&&['dataUrl','x','y','width','height','rotation','opacity'].every(key=>old[key]===i[key]))))throw new Error('曲线或目标图片已有变化，请重新反选');
    bridge.commit(results,current.side);close();
   }catch(err){if(token===generation){busy=false;if(current.canvas){bridge.status(err.message);close();}else{$('image-region-error').textContent=err.message;refresh();}}}
  }
  $('image-region').onclick=()=>open();$('image-region-invert').onclick=()=>{if(draft&&!busy){draft.side=draft.side==='outside'?'inside':'outside';refresh();}};
  $('image-region-delete').onclick=apply;$('image-region-cancel').onclick=close;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('keydown',e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();apply();}});
  return {open,selectOutside:()=>open(true),apply,cancel:close,hasSelection:()=>!!draft?.canvas, get busy(){return busy;},invert(){if(draft?.canvas&&!busy){draft.side=draft.side==='outside'?'inside':'outside';refresh();bridge.status(`已反选图片${draft.side==='outside'?'圈外':'圈内'}区域；右键删除，Esc 取消`);}},update(){if(draft?.canvas&&(bridge.getDocument()!==draft.doc||bridge.getRevision()!==draft.revision))close();try{targets(bridge.getDocument(),bridge.getPathIds(),bridge.getImageIds?.()||[]);$('image-region').disabled=bridge.isReplaying();$('image-region').title='用闭合曲线选择圈内或圈外，清除目标图片内容，范围以图片边缘为限';}catch(err){$('image-region').disabled=true;$('image-region').title=err.message;}}};
 }
 const api={targets,localPath,erase,init};if(typeof module!=='undefined')module.exports=api;else root.CurveImageRegion=api;
})(typeof window!=='undefined'?window:globalThis);
