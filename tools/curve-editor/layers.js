(function(root){
 'use strict';
 const G=typeof module!=='undefined'?require('./geometry.js'):root.CurveGeometry;
 const uid=()=>crypto.randomUUID();
 const number=v=>Number.isFinite(v)&&Math.abs(v)<=1e7;
 const validId=v=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
 function checkImage(i){
  if(!i||!validId(i.id)||typeof i.name!=='string'||typeof i.dataUrl!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(i.dataUrl))throw new Error('图片数据无效');
  if(!number(i.x)||!number(i.y)||!number(i.width)||!number(i.height)||i.width<=0||i.height<=0||!Number.isFinite(i.opacity)||i.opacity<0||i.opacity>1)throw new Error('图片位置、尺寸或透明度无效');
 }
 function normalize(d){
  if(d.layers===undefined&&d.images===undefined){
   d.layers=[];d.images=[];
   if(d.image){const i={...d.image,id:uid(),x:0,y:0,width:d.width,height:d.height,opacity:d.opacity??.65};checkImage(i);d.images.push(i);d.layers.push({id:uid(),name:'底图',visible:true,locked:true,pathIds:[],imageIds:[i.id]});d.image=null;}
   d.layers.push({id:uid(),name:'曲线图层',visible:true,locked:false,pathIds:d.paths.map(p=>p.id),imageIds:[]});
  }
  if(!Array.isArray(d.layers)||!d.layers.length||d.layers.length>200||!Array.isArray(d.images)||d.images.length>200)throw new Error('图层或图片数量无效');
  const ids=new Set(),imageIds=new Set(),paths=new Set(d.paths.map(p=>p.id));
  for(const i of d.images){checkImage(i);if(imageIds.has(i.id))throw new Error('图片标识重复');imageIds.add(i.id);}
  const seenPaths=new Set(),seenImages=new Set();
  for(const layer of d.layers){
   if(!layer||!validId(layer.id)||ids.has(layer.id)||typeof layer.name!=='string'||typeof layer.visible!=='boolean'||typeof layer.locked!=='boolean'||!Array.isArray(layer.pathIds)||!Array.isArray(layer.imageIds))throw new Error('图层数据无效');ids.add(layer.id);
   for(const [refs,known,seen] of [[layer.pathIds,paths,seenPaths],[layer.imageIds,imageIds,seenImages]])for(const id of refs){if(!known.has(id)||seen.has(id))throw new Error('图层元素归属无效');seen.add(id);}
  }
  if(seenPaths.size!==paths.size||seenImages.size!==imageIds.size)throw new Error('存在未归属图层的元素');return d;
 }
 function addLayer(d,name='新图层'){
  if(d.layers.length>=200)throw new Error('最多支持 200 个图层');
  const layer={id:uid(),name,visible:true,locked:false,pathIds:[],imageIds:[]};d.layers.push(layer);return layer;
 }
 function addImage(d,image){
  const i={...image,id:uid()};checkImage(i);if(d.images.length>=200)throw new Error('最多支持 200 张图片');
  const layer=addLayer(d,image.name.slice(0,80));d.images.push(i);layer.imageIds.push(i.id);return layer;
 }
 const layerFor=(d,id,type='path')=>d.layers.find(l=>(type==='image'?l.imageIds:l.pathIds).includes(id));
 const visible=(d,id,type='path')=>!!layerFor(d,id,type)?.visible;
 const editable=(d,id,type='path')=>{const l=layerFor(d,id,type);return !!l?.visible&&!l.locked;};
 function bounds(d,pathIds,imageIds){
  const boxes=[...d.paths.filter(p=>pathIds.includes(p.id)).map(G.pathBounds),...d.images.filter(i=>imageIds.includes(i.id))].filter(Boolean);if(!boxes.length)return null;
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
 }
 function transform(d,pathIds,imageIds,from,to){
  if(!from||!to||!Object.values(to).every(number)||to.width<0||to.height<0)throw new Error('位置或尺寸超出范围');
  const sx=from.width>1e-9?to.width/from.width:1,sy=from.height>1e-9?to.height/from.height:1;
  const point=p=>({x:to.x+(p.x-from.x)*sx,y:to.y+(p.y-from.y)*sy});
  const paths=d.paths.filter(p=>pathIds.includes(p.id)).map(p=>({...p,nodes:p.nodes.map(n=>({...n,...point(n),in:point(n.in),out:point(n.out)}))}));
  for(const p of paths)for(const n of p.nodes)for(const v of [n,n.in,n.out])if(!number(v.x)||!number(v.y))throw new Error('变换后节点坐标超出范围');
  const images=d.images.filter(i=>imageIds.includes(i.id)).map(i=>({...i,...point(i),width:i.width*sx,height:i.height*sy}));images.forEach(checkImage);
  for(const p of paths)d.paths.find(q=>q.id===p.id).nodes=p.nodes;
  for(const i of images)Object.assign(d.images.find(q=>q.id===i.id),i);
 }
 function contentBounds(d,includeImages=true){
  const filtered={...d,paths:d.paths.filter(p=>visible(d,p.id))};
  let b=G.contentBounds(filtered);
  if(includeImages)for(const i of d.images.filter(i=>visible(d,i.id,'image'))){const x=Math.min(b.x,i.x),y=Math.min(b.y,i.y),right=Math.max(b.x+b.width,i.x+i.width),bottom=Math.max(b.y+b.height,i.y+i.height);b={x,y,width:right-x,height:bottom-y};}return b;
 }
 function prune(d){const p=new Set(d.paths.map(p=>p.id)),i=new Set(d.images.map(i=>i.id));for(const l of d.layers){l.pathIds=l.pathIds.filter(id=>p.has(id));l.imageIds=l.imageIds.filter(id=>i.has(id));}}
 const api={normalize,addLayer,addImage,layerFor,visible,editable,bounds,transform,contentBounds,prune};
 if(typeof module!=='undefined')module.exports=api;else root.CurveLayers=api;
})(typeof window!=='undefined'?window:globalThis);
