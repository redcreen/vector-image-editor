(function(root){
 'use strict';
 const G=typeof module!=='undefined'?require('./geometry.js'):root.CurveGeometry;
 const D=typeof module!=='undefined'?require('./dimension.js'):root.CurveDimension;
 const T=typeof module!=='undefined'?require('./text.js'):root.CurveText;
 const S=typeof module!=='undefined'?require('./symmetry.js'):root.CurveSymmetry;
 const uid=()=>crypto.randomUUID();
 const number=v=>Number.isFinite(v)&&Math.abs(v)<=1e7;
 const validId=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
 function checkImage(i){
  if(!i||!validId(i.id)||typeof i.name!=='string'||typeof i.dataUrl!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(i.dataUrl))throw new Error('图片数据无效');
  if(!number(i.x)||!number(i.y)||!number(i.width)||!number(i.height)||i.width<=0||i.height<=0||!Number.isFinite(i.opacity)||i.opacity<0||i.opacity>1)throw new Error('图片位置、尺寸或透明度无效');
  if(i.rotation!==undefined&&!number(i.rotation))throw new Error('图片旋转角度无效');
 }
 function rotatePoint(p,center,degrees){
  const angle=(degrees%360)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),x=p.x-center.x,y=p.y-center.y;
  return {x:center.x+x*cos-y*sin,y:center.y+x*sin+y*cos};
 }
 const imageCenter=i=>({x:i.x+i.width/2,y:i.y+i.height/2});
 const imageToWorld=(i,p)=>rotatePoint({x:i.x+p.x,y:i.y+p.y},imageCenter(i),i.rotation||0);
 function worldToImage(i,p){const q=rotatePoint(p,imageCenter(i),-(i.rotation||0));return {x:q.x-i.x,y:q.y-i.y};}
 const imageCorners=i=>[{x:0,y:0},{x:i.width,y:0},{x:i.width,y:i.height},{x:0,y:i.height}].map(p=>imageToWorld(i,p));
 function imageBounds(i){
  const points=imageCorners(i),xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};
 }
 function imageContains(i,p){const q=worldToImage(i,p);return q.x>=0&&q.y>=0&&q.x<=i.width&&q.y<=i.height;}
 function imageIntersectsRect(i,r){
  const a=imageCorners(i),b=[{x:r.x,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height},{x:r.x,y:r.y+r.height}];
  // Separating axes of both rectangles exclude empty corners of the rotated bounding box.
  const axes=[{x:1,y:0},{x:0,y:1},...a.slice(0,2).map((p,n)=>({x:-(a[n+1].y-p.y),y:a[n+1].x-p.x}))];
  return axes.every(axis=>{const project=p=>p.x*axis.x+p.y*axis.y,aa=a.map(project),bb=b.map(project);return Math.max(...aa)>=Math.min(...bb)&&Math.max(...bb)>=Math.min(...aa);});
 }
 function normalize(d){
  if(d.texts===undefined)d.texts=[];
  if(!Array.isArray(d.texts)||d.texts.length>500)throw new Error('文字数量无效');
  if(d.layers===undefined&&d.images===undefined){
   d.layers=[];d.images=[];
   if(d.image){const i={...d.image,id:uid(),x:0,y:0,width:d.width,height:d.height,opacity:d.opacity??.65};checkImage(i);d.images.push(i);d.layers.push({id:uid(),name:'底图',visible:true,locked:true,pathIds:[],imageIds:[i.id]});d.image=null;}
   d.layers.push({id:uid(),name:'曲线图层',visible:true,locked:false,pathIds:d.paths.map(p=>p.id),imageIds:[]});
  }
  if(!Array.isArray(d.layers)||!d.layers.length||d.layers.length>200||!Array.isArray(d.images)||d.images.length>200)throw new Error('图层或图片数量无效');
  const ids=new Set(),imageIds=new Set(),textIds=new Set(),paths=new Set(d.paths.map(p=>p.id));
  for(const t of d.texts){T.check(t);if(textIds.has(t.id))throw new Error('文字标识重复');textIds.add(t.id);}
  for(const i of d.images){checkImage(i);if(imageIds.has(i.id))throw new Error('图片标识重复');imageIds.add(i.id);}
  const seenPaths=new Set(),seenImages=new Set(),seenTexts=new Set();
  for(const layer of d.layers){
   if(layer&&layer.textIds===undefined)layer.textIds=[];
   if(!layer||!validId(layer.id)||ids.has(layer.id)||typeof layer.name!=='string'||typeof layer.visible!=='boolean'||typeof layer.locked!=='boolean'||!Array.isArray(layer.pathIds)||!Array.isArray(layer.imageIds))throw new Error('图层数据无效');ids.add(layer.id);
   if(!Array.isArray(layer.textIds))throw new Error('图层文字归属无效');
   for(const [refs,known,seen] of [[layer.pathIds,paths,seenPaths],[layer.imageIds,imageIds,seenImages],[layer.textIds,textIds,seenTexts]])for(const id of refs){if(!known.has(id)||seen.has(id))throw new Error('图层元素归属无效');seen.add(id);}
  }
  if(seenPaths.size!==paths.size||seenImages.size!==imageIds.size||seenTexts.size!==textIds.size)throw new Error('存在未归属图层的元素');
  for(const layer of d.layers){
   if(layer.kind!==undefined&&!['layer','group'].includes(layer.kind)||layer.collapsed!==undefined&&typeof layer.collapsed!=='boolean')throw new Error('图层组数据无效');
   const chain=new Set([layer.id]);let parent=layer.parentId;
   while(parent!=null){const ancestor=d.layers.find(l=>l.id===parent);if(!validId(parent)||!ancestor||ancestor.kind!=='group'||chain.has(parent))throw new Error('图层组归属无效');chain.add(parent);parent=ancestor.parentId;}
   if(layer.kind==='group'&&(layer.pathIds.length||layer.imageIds.length||layer.textIds.length))throw new Error('图层组不能直接包含元素');
   if(layer.items!==undefined){
    const known=new Set(defaultItems(d,layer).map(item=>item.type+':'+item.id)),seen=new Set();
    if(!Array.isArray(layer.items))throw new Error('图层元素顺序无效');
    for(const item of layer.items){const key=item?.type+':'+item?.id;if(!item||!validId(item.id)||!known.has(key)||seen.has(key)||item.visible!==undefined&&typeof item.visible!=='boolean'||item.locked!==undefined&&typeof item.locked!=='boolean')throw new Error('图层元素顺序无效');seen.add(key);}
    if(seen.size!==known.size)throw new Error('图层元素顺序缺少引用');
   }
  }
  return d;
 }
 const children=(d,parent=null)=>d.layers.filter(l=>(l.parentId??null)===parent);
 function family(d,id){const layer=d.layers.find(l=>l.id===id);return layer?[layer,...children(d,id).flatMap(l=>family(d,l.id))]:[];}
 function roots(d,ids){const chosen=new Set(ids);return d.layers.filter(l=>chosen.has(l.id)&&!d.layers.some(p=>chosen.has(p.id)&&p.id!==l.id&&family(d,p.id).includes(l))).map(l=>l.id);}
 function ordered(d,parent=null){return children(d,parent).flatMap(l=>l.kind==='group'?ordered(d,l.id):[l]);}
 function rows(d,parent=null,depth=0){return children(d,parent).slice().reverse().flatMap(layer=>[{layer,depth},...(layer.kind==='group'&&!layer.collapsed?rows(d,layer.id,depth+1):[])]);}
 function state(d,layer,stopAt=null){let visible=true,locked=false;while(layer&&layer.id!==stopAt){visible=visible&&layer.visible;locked=locked||layer.locked;layer=d.layers.find(l=>l.id===layer.parentId);}return {visible,locked};}
 const writable=(d,layer)=>!!layer&&layer.kind!=='group'&&state(d,layer).visible&&!state(d,layer).locked;
 function defaultItems(d,layer){return [['image',d.images,layer.imageIds],['path',d.paths,layer.pathIds],['text',d.texts||[],layer.textIds||[]]].flatMap(([type,objects,refs])=>objects.filter(o=>refs.includes(o.id)).map(o=>({type,id:o.id})));}
 function items(d,layer){const defaults=defaultItems(d,layer),known=new Set(defaults.map(i=>i.type+':'+i.id)),explicit=(layer.items||[]).filter(i=>known.has(i.type+':'+i.id)),seen=new Set(explicit.map(i=>i.type+':'+i.id));return [...explicit,...defaults.filter(i=>!seen.has(i.type+':'+i.id))];}
 function syncPathOrder(d){for(const layer of d.layers)if(layer.items){const paths=d.paths.filter(p=>layer.pathIds.includes(p.id)),metadata=new Map(layer.items.filter(i=>i.type==='path').map(i=>[i.id,i]));let index=0;layer.items=items(d,layer).map(i=>i.type==='path'?{...metadata.get(paths[index].id),type:'path',id:paths[index++].id}:i);}}
 function siblingsSelection(d,ids){const selected=roots(d,ids).map(id=>d.layers.find(l=>l.id===id));if(selected.length<2)throw new Error('请先多选至少两个图层');if(selected.some(l=>(l.parentId??null)!==(selected[0].parentId??null)))throw new Error('请选择同一个组内的图层；可先解组再整理');const siblings=children(d,selected[0].parentId??null),indices=selected.map(l=>siblings.indexOf(l));if(Math.max(...indices)-Math.min(...indices)+1!==selected.length)throw new Error('请选择相邻图层，避免改变与其他图层的叠放顺序');return selected;}
 function group(d,ids,name='图层组'){
  const selected=siblingsSelection(d,ids);if(d.layers.length>=200)throw new Error('最多支持 200 个图层');
  const layer={id:uid(),name,kind:'group',visible:true,locked:false,collapsed:false,pathIds:[],imageIds:[],textIds:[]};
  if(selected[0].parentId!=null)layer.parentId=selected[0].parentId;
  const index=Math.max(...selected.map(l=>d.layers.indexOf(l)));d.layers.splice(index+1,0,layer);selected.forEach(l=>{l.parentId=layer.id;});return layer;
 }
 function ungroup(d,id){
  const group=d.layers.find(l=>l.id===id);if(group?.kind!=='group')throw new Error('请选择图层组');
  const members=children(d,id),index=d.layers.indexOf(group),before=d.layers.slice(0,index).filter(l=>!members.includes(l)),after=d.layers.slice(index+1).filter(l=>!members.includes(l));
  for(const layer of members){if(group.parentId!=null)layer.parentId=group.parentId;else delete layer.parentId;layer.visible=layer.visible&&group.visible;layer.locked=layer.locked||group.locked;}
  d.layers=[...before,...members,...after];if(!d.layers.length)members.push(addLayer(d,'曲线图层'));return members.map(l=>l.id);
 }
 function merge(d,ids){
  const selected=siblingsSelection(d,ids),selectedIds=new Set(selected.flatMap(l=>family(d,l.id).map(l=>l.id))),parent=selected[0].parentId??null;
  const leaves=ordered(d).filter(l=>selectedIds.has(l.id)),states=leaves.map(l=>state(d,l,parent));
  if(states.some(s=>s.visible!==states[0].visible||s.locked!==states[0].locked))throw new Error('合并前请统一所选图层及子图层的显示和锁定状态');
  const top=selected.at(-1),layer={id:top.id,name:top.name,visible:states[0]?.visible??top.visible,locked:states[0]?.locked??top.locked,pathIds:leaves.flatMap(l=>l.pathIds),imageIds:leaves.flatMap(l=>l.imageIds),textIds:leaves.flatMap(l=>l.textIds||[]),items:leaves.flatMap(l=>items(d,l).map(i=>({...i})))};
  if(parent!=null)layer.parentId=parent;const index=d.layers.indexOf(top),before=d.layers.slice(0,index).filter(l=>!selectedIds.has(l.id)),after=d.layers.slice(index+1).filter(l=>!selectedIds.has(l.id));d.layers=[...before,layer,...after];return layer;
 }
 function addLayer(d,name='新图层'){
  if(d.layers.length>=200)throw new Error('最多支持 200 个图层');
  const layer={id:uid(),name,visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]};d.layers.push(layer);return layer;
 }
 function addImage(d,image){
  const i={...image,id:uid()};checkImage(i);if(d.images.length>=200)throw new Error('最多支持 200 张图片');
  const layer=addLayer(d,image.name.slice(0,80));d.images.push(i);layer.imageIds.push(i.id);return layer;
 }
 const textLayer=(d,name='文字图层')=>ordered(d).slice().reverse().find(l=>l.name===name);
 function addText(d,text,layer){
  const t={...text,id:uid()};T.check(t);
  if(d.texts.length>=500)throw new Error('最多支持 500 段文字');
  if(layer===undefined){const name=t.dimension?'尺寸标注':t.positionMarker?'位置标注':'文字图层';layer=textLayer(d,name)||addLayer(d,name);}
  if(!d.layers.includes(layer)||!writable(d,layer))throw new Error('文字图层已隐藏、锁定或不是普通图层，请先显示并解锁');
  d.texts.push(t);layer.textIds.push(t.id);if(layer.items)layer.items.push({type:'text',id:t.id});return t;
 }
 const layerFor=(d,id,type='path')=>d.layers.find(l=>(type==='image'?l.imageIds:type==='text'?l.textIds||[]:l.pathIds).includes(id));
 const itemFor=(d,id,type)=>layerFor(d,id,type)?.items?.find(i=>i.id===id&&i.type===type);
 const visible=(d,id,type='path')=>!!layerFor(d,id,type)&&state(d,layerFor(d,id,type)).visible&&itemFor(d,id,type)?.visible!==false&&(type!=='path'||d.paths.find(p=>p.id===id)?.visible!==false);
 const editable=(d,id,type='path')=>visible(d,id,type)&&!state(d,layerFor(d,id,type)).locked&&!itemFor(d,id,type)?.locked;
 function moveElements(d,pathIds,imageIds,textIds,targetId){
  const target=d.layers.find(l=>l.id===targetId);
  if(!writable(d,target))throw new Error('请选择已显示且未锁定的普通图层');
  const chosen=new Set();
  for(const [type,ids] of [['path',pathIds],['image',imageIds],['text',textIds]])for(const id of ids){
   if(!editable(d,id,type))throw new Error('所选元素不存在、已隐藏或锁定');
   if(layerFor(d,id,type)!==target)chosen.add(type+':'+id);
  }
  if(!chosen.size)return 0;
  const moving=ordered(d).flatMap(layer=>items(d,layer).filter(item=>chosen.has(item.type+':'+item.id)).map(item=>({...item}))),existing=items(d,target);
  const keys={path:'pathIds',image:'imageIds',text:'textIds'};
  for(const layer of d.layers){
   for(const [type,key] of Object.entries(keys))layer[key]=layer[key].filter(id=>!chosen.has(type+':'+id));
   if(layer.items)layer.items=layer.items.filter(item=>!chosen.has(item.type+':'+item.id));
  }
  for(const item of moving)target[keys[item.type]].push(item.id);
  target.items=[...existing,...moving];return moving.length;
 }
 function bounds(d,pathIds,imageIds,textIds=[]){
  const boxes=[...d.paths.filter(p=>pathIds.includes(p.id)).map(G.pathBounds),...d.images.filter(i=>imageIds.includes(i.id)).map(imageBounds),...(d.texts||[]).filter(t=>textIds.includes(t.id)).map(T.bounds)].filter(Boolean);if(!boxes.length)return null;
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
 }
 function positionLabelPath(d,text){
  const marker=text?.positionMarker;if(!marker)return null;
  if(marker.pathId!==undefined)return validId(marker.pathId)?d.paths.find(path=>path.id===marker.pathId)||null:null;
  const matches=d.paths.filter(path=>{
   if(path.nodes.some(node=>Math.hypot(node.x-marker.x,node.y-marker.y)<=.01))return true;
   return path.nodes.length>1&&G.nearest(path,marker).distance<=.01;
  });
  return matches.length===1?matches[0]:null;
 }
 function positionAttachment(path,point){
  if(!path||!point||!number(point.x)||!number(point.y))return null;
  let nearestNode=null;
  for(let index=0;index<path.nodes.length;index++){
   const distance=Math.hypot(path.nodes[index].x-point.x,path.nodes[index].y-point.y);
   if(distance<=.01&&(!nearestNode||distance<nearestNode.distance))nearestNode={kind:'node',index,distance};
  }
  if(nearestNode)return {kind:'node',index:nearestNode.index};
  if(path.nodes.length<2)return null;
  const nearest=G.nearest(path,point);return nearest.distance<=.01?{kind:'segment',index:nearest.index,t:nearest.t}:null;
 }
 function attachmentPoint(path,attachment){
  if(attachment?.kind==='node')return attachment.index<path.nodes.length?{x:path.nodes[attachment.index].x,y:path.nodes[attachment.index].y}:null;
  if(attachment?.kind!=='segment'||attachment.index>=G.segmentCount(path))return null;
  return G.at(path.nodes[attachment.index],path.nodes[(attachment.index+1)%path.nodes.length],attachment.t);
 }
 const sameAnchor=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<=.01;
 function reversedNodeMap(before,after){
  const count=before.nodes.length;if(count<2||after.nodes.length!==count||!!before.closed!==!!after.closed)return null;
  if(!before.closed)return before.nodes.every((node,index)=>sameAnchor(node,after.nodes[count-1-index]))?before.nodes.map((_,index)=>count-1-index):null;
  const maps=[];
  for(let offset=0;offset<count;offset++)if(before.nodes.every((node,index)=>sameAnchor(node,after.nodes[(offset-index+count)%count])))maps.push(before.nodes.map((_,index)=>(offset-index+count)%count));
  return maps.length===1?maps[0]:null;
 }
 function projectedAttachment(path,point){
  if(!path.nodes.length)return null;if(path.nodes.length===1)return {kind:'node',index:0};
  const nearest=G.nearest(path,point);if(!Number.isFinite(nearest.distance))return null;
  const projected=G.at(path.nodes[nearest.index],path.nodes[(nearest.index+1)%path.nodes.length],nearest.t);
  return positionAttachment(path,projected)||{kind:'segment',index:nearest.index,t:nearest.t};
 }
 function remapAttachment(before,after,attachment,point,currentPoint){
  const unchangedIndex=before.nodes.length===after.nodes.length&&!!before.closed===!!after.closed?attachmentPoint(after,attachment):null;
  // Whole-path transforms already moved the marker. Prefer that evidence over
  // coordinate-only reversal detection, which is ambiguous for a 180° turn.
  if(unchangedIndex&&Math.hypot(unchangedIndex.x-currentPoint.x,unchangedIndex.y-currentPoint.y)<=.01)return {...attachment};
  const reverse=reversedNodeMap(before,after);
  if(reverse){
   if(attachment.kind==='node')return reverse[attachment.index]===undefined?null:{kind:'node',index:reverse[attachment.index]};
   const next=(attachment.index+1)%before.nodes.length,index=reverse[next];
   return index===undefined||index>=G.segmentCount(after)?null:{kind:'segment',index,t:1-attachment.t};
  }
  if(before.nodes.length===after.nodes.length&&!!before.closed===!!after.closed&&attachmentPoint(after,attachment))return {...attachment};
  if(attachment.kind==='node'&&attachment.index<before.nodes.length){
   const original=before.nodes[attachment.index],matches=after.nodes.map((node,index)=>({node,index})).filter(item=>sameAnchor(item.node,original));
   if(matches.length===1)return {kind:'node',index:matches[0].index};
  }
  return positionAttachment(after,point)||projectedAttachment(after,point);
 }
 function pathGeometryEqual(a,b){
  if(!a||!b||!!a.closed!==!!b.closed||a.nodes.length!==b.nodes.length)return false;
  return a.nodes.every((node,index)=>['x','y'].every(key=>node[key]===b.nodes[index][key]&&node.in[key]===b.nodes[index].in[key]&&node.out[key]===b.nodes[index].out[key]));
 }
 function syncPositionLabels(d,before){
  if(!before||!Array.isArray(before.paths)||!Array.isArray(before.texts)||!Array.isArray(d.paths)||!Array.isArray(d.texts))throw new Error('标注同步快照无效');
  const newPaths=new Map(d.paths.map(path=>[path.id,path])),oldTexts=new Map(before.texts.map(text=>[text.id,text])),updates=[];
  for(const text of d.texts){
   const oldText=oldTexts.get(text.id),oldMarker=oldText?.positionMarker,currentMarker=text.positionMarker;if(!oldMarker||!currentMarker)continue;
   const associationChanged=currentMarker.pathId!==oldMarker.pathId||JSON.stringify(currentMarker.attachment??null)!==JSON.stringify(oldMarker.attachment??null);
   if(associationChanged)continue;
   const oldPath=positionLabelPath(before,oldText);if(!oldPath)continue;
   const currentPath=newPaths.get(oldPath.id);if(!currentPath||pathGeometryEqual(oldPath,currentPath))continue;
   let attachment=oldMarker.attachment||positionAttachment(oldPath,oldMarker);if(!attachment)continue;
   const oldPoint=attachmentPoint(oldPath,attachment)||{x:oldMarker.x,y:oldMarker.y};
   attachment=remapAttachment(oldPath,currentPath,attachment,oldPoint,currentMarker);if(!attachment)continue;
   const target=attachmentPoint(currentPath,attachment);if(!target)continue;
   const dx=target.x-currentMarker.x,dy=target.y-currentMarker.y,marker={...currentMarker,x:target.x,y:target.y,pathId:oldPath.id,attachment:{...attachment}};
   const next={...text,x:text.x+dx,y:text.y+dy,rotation:0,positionMarker:marker};T.check(next);
   if(JSON.stringify(next)!==JSON.stringify(text))updates.push(next);
  }
  for(const text of updates)Object.assign(d.texts.find(item=>item.id===text.id),text);return updates.length;
 }
 function linkedPositionLabels(d,pathIds){
  const chosen=new Set(pathIds),linked=[];
  for(const text of d.texts||[]){const path=positionLabelPath(d,text);if(path&&chosen.has(path.id))linked.push({text,path,inferred:text.positionMarker.pathId===undefined});}
  return linked;
 }
 function translatedPositionText(text,point,pathId=null){
  const marker={...text.positionMarker,...point(text.positionMarker)};if(pathId!==null)marker.pathId=pathId;
  return {...text,...point(text),positionMarker:marker};
 }
 function translatePositionLabels(d,pathIds,dx,dy){
  if(!Array.isArray(pathIds)||!number(dx)||!number(dy))throw new Error('位置标注移动距离无效');
  if(dx===0&&dy===0)return 0;
  return transformPositionLabels(d,pathIds,p=>({x:p.x+dx,y:p.y+dy}));
 }
 function transformPositionLabels(d,pathIds,point,upright=false){
  const texts=linkedPositionLabels(d,pathIds).map(({text,path,inferred})=>{
   const next=translatedPositionText(text,point,inferred?path.id:null);if(upright)next.rotation=0;return next;
  });
  texts.forEach(T.check);for(const text of texts)Object.assign(d.texts.find(item=>item.id===text.id),text);return texts.length;
 }
 function followTransformedDimensions(d,paths,texts){
  const transformed=new Map(paths.map(p=>[p.id,p])),explicit=new Set(texts.map(t=>t.id));
  for(const text of d.texts||[]){
   if(!text.dimension||explicit.has(text.id))continue;
   const bindings=text.dimension.bindings??D.retainedBindings(text,d.paths.map(p=>p.id),d.paths);
   if(!Object.values(bindings).some(b=>transformed.has(b.pathId)))continue;
   const dimension={...text.dimension,bindings};
   // A half turn can look exactly like node reversal. Update anchors while
   // transform identity is known so later topology sync keeps their indices.
   for(const [key,binding] of Object.entries(bindings)){
    const node=transformed.get(binding.pathId)?.nodes[binding.index];
    if(node)dimension[key]=G.point(node);
   }
   texts.push(D.resolve({...text,dimension},d.calibration));
  }
 }
 function transform(d,pathIds,imageIds,from,to,textIds=[]){
  if(!from||!to||!Object.values(to).every(number)||to.width<0||to.height<0)throw new Error('位置或尺寸超出范围');
  const sx=from.width>1e-9?to.width/from.width:1,sy=from.height>1e-9?to.height/from.height:1;
  const changed=to.x!==from.x||to.y!==from.y||to.width!==from.width||to.height!==from.height;
  const point=p=>({x:to.x+(p.x-from.x)*sx,y:to.y+(p.y-from.y)*sy});
  const paths=d.paths.filter(p=>pathIds.includes(p.id)).map(p=>({...p,nodes:p.nodes.map(n=>({...n,...point(n),in:point(n.in),out:point(n.out)}))}));
  for(const p of paths)for(const n of p.nodes)for(const v of [n,n.in,n.out])if(!number(v.x)||!number(v.y))throw new Error('变换后节点坐标超出范围');
  const images=d.images.filter(i=>imageIds.includes(i.id)).map(i=>{
   if(i.rotation%360&&Math.abs(sx-sy)>1e-6)throw new Error('已旋转图片缩放需保持宽高比例');
   const center=point(imageCenter(i)),width=i.width*sx,height=i.height*sy;
   return {...i,x:center.x-width/2,y:center.y-height/2,width,height};
  });images.forEach(checkImage);
  const explicit=new Set(textIds),actualPathIds=paths.map(path=>path.id),linked=linkedPositionLabels(d,actualPathIds),linkedById=new Map(linked.map(item=>[item.text.id,item]));
  if((d.texts||[]).some(t=>explicit.has(t.id))&&Math.abs(sx-sy)>1e-6)throw new Error('文字缩放需保持宽高比例');
  const texts=(d.texts||[]).filter(t=>explicit.has(t.id)||linkedById.has(t.id)).map(t=>{
   if(t.dimension)return D.resolve({...t,fontSize:t.fontSize*sx,dimension:{...t.dimension,a:point(t.dimension.a),b:point(t.dimension.b),offset:t.dimension.offset*sx,bindings:D.retainedBindings(t,actualPathIds,d.paths)}},d.calibration);
   const link=linkedById.get(t.id),next=t.positionMarker?translatedPositionText(t,point,changed&&link?.inferred?link.path.id:null):{...t,...point(t)};
   return {...next,fontSize:Math.abs(sx-sy)<=1e-6?t.fontSize*sx:t.fontSize};
  });if(changed)followTransformedDimensions(d,paths,texts);texts.forEach(T.check);
  if(d.symmetryLinks?.length)S.transformLinks(d,paths.map(p=>p.id),point);
  for(const p of paths)d.paths.find(q=>q.id===p.id).nodes=p.nodes;
  for(const i of images)Object.assign(d.images.find(q=>q.id===i.id),i);
  for(const t of texts)Object.assign(d.texts.find(q=>q.id===t.id),t);
 }
 function rotatePaths(d,pathIds,center,degrees){return rotateElements(d,pathIds,[],center,degrees);}
 function rotationTargets(d,pathIds,imageIds,textIds=[],layerIds=[]){
  // Only explicit layer rotation may bypass an individual curve lock.
  // Layer/group locks and all visibility flags still apply.
  const members=new Set(layerIds.flatMap(id=>family(d,id)).filter(l=>writable(d,l)).map(l=>l.id));
  return {
   paths:d.paths.filter(p=>pathIds.includes(p.id)&&editable(d,p.id)||members.has(layerFor(d,p.id)?.id)&&visible(d,p.id)).map(p=>p.id),
   images:d.images.filter(i=>imageIds.includes(i.id)&&editable(d,i.id,'image')).map(i=>i.id),
   texts:(d.texts||[]).filter(t=>textIds.includes(t.id)&&editable(d,t.id,'text')).map(t=>t.id)
  };
 }
 function rotateElements(d,pathIds,imageIds,center,degrees,textIds=[],layerIds=[]){
  if(!Array.isArray(pathIds)||!center||!Number.isFinite(center.x)||!Number.isFinite(center.y)||!Number.isFinite(degrees))throw new Error('旋转中心或角度无效');
  const targets=rotationTargets(d,pathIds,imageIds,textIds,layerIds),selected=new Set(targets.paths),angle=((degrees%360)+360)%360,radians=angle*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
  const point=angle===0?p=>({x:p.x,y:p.y}):p=>{
   const x=p.x-center.x,y=p.y-center.y;return {x:center.x+x*cos-y*sin,y:center.y+x*sin+y*cos};
  };
  const paths=d.paths.filter(p=>selected.has(p.id)).map(p=>({path:p,nodes:p.nodes.map(n=>({...n,...point(n),in:point(n.in),out:point(n.out)}))}));
  for(const item of paths)for(const n of item.nodes)for(const p of [n,n.in,n.out])if(!number(p.x)||!number(p.y))throw new Error('旋转后节点坐标超出范围');
  const images=angle===0?[]:d.images.filter(i=>imageIds.includes(i.id)&&editable(d,i.id,'image')).map(i=>{
   const center=point(imageCenter(i));return {...i,x:center.x-i.width/2,y:center.y-i.height/2,rotation:(((i.rotation||0)+angle)%360+360)%360};
  });images.forEach(checkImage);
  const explicit=new Set(textIds),linked=angle===0?[]:linkedPositionLabels(d,paths.map(item=>item.path.id)),linkedById=new Map(linked.map(item=>[item.text.id,item]));
  const texts=angle===0?[]:(d.texts||[]).filter(t=>linkedById.has(t.id)||explicit.has(t.id)&&editable(d,t.id,'text')).map(t=>{
   if(t.dimension)return D.resolve({...t,dimension:{...t.dimension,a:point(t.dimension.a),b:point(t.dimension.b),bindings:D.retainedBindings(t,paths.map(item=>item.path.id),d.paths)}},d.calibration);
   const link=linkedById.get(t.id),next=t.positionMarker?translatedPositionText(t,point,link?.inferred?link.path.id:null):{...t,...point(t)};
   // Attached labels travel with the curve while staying upright for reading.
   return {...next,rotation:link?0:(((t.rotation||0)+angle)%360+360)%360};
  });if(angle!==0)followTransformedDimensions(d,paths.map(item=>({...item.path,nodes:item.nodes})),texts);texts.forEach(T.check);
  if(d.symmetryLinks?.length)S.transformLinks(d,paths.map(item=>item.path.id),point);
  for(const item of paths)item.path.nodes=item.nodes;
  for(const i of images)Object.assign(d.images.find(q=>q.id===i.id),i);
  for(const t of texts)Object.assign(d.texts.find(q=>q.id===t.id),t);
 }
 function contentBounds(d,includeImages=true){
  const filtered={...d,paths:d.paths.filter(p=>visible(d,p.id))};
  let b=G.contentBounds(filtered);
  const boxes=[...(d.texts||[]).filter(t=>visible(d,t.id,'text')).map(T.bounds),...(includeImages?d.images.filter(i=>visible(d,i.id,'image')).map(imageBounds):[])];
  for(const i of boxes){const x=Math.min(b.x,i.x),y=Math.min(b.y,i.y),right=Math.max(b.x+b.width,i.x+i.width),bottom=Math.max(b.y+b.height,i.y+i.height);b={x,y,width:right-x,height:bottom-y};}return b;
 }
 function prune(d){const p=new Set(d.paths.map(p=>p.id)),i=new Set(d.images.map(i=>i.id)),t=new Set((d.texts||[]).map(t=>t.id));for(const l of d.layers){l.pathIds=l.pathIds.filter(id=>p.has(id));l.imageIds=l.imageIds.filter(id=>i.has(id));l.textIds=(l.textIds||[]).filter(id=>t.has(id));if(l.items)l.items=items(d,l);}}
 const api={normalize,addLayer,addImage,addText,textLayer,moveElements,layerFor,visible,editable,bounds,positionLabelPath,positionAttachment,syncPositionLabels,translatePositionLabels,transformPositionLabels,transform,rotatePaths,rotationTargets,rotateElements,imageToWorld,worldToImage,imageBounds,imageContains,imageIntersectsRect,contentBounds,prune,children,family,roots,ordered,rows,state,writable,items,syncPathOrder,group,ungroup,merge};
 if(typeof module!=='undefined')module.exports=api;else root.CurveLayers=api;
})(typeof window!=='undefined'?window:globalThis);
