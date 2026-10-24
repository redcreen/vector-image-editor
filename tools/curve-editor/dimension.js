(function(root){
 'use strict';
 const G=typeof module!=='undefined'?require('./geometry.js'):root.CurveGeometry;
 const number=v=>Number.isFinite(v)&&Math.abs(v)<=1e7;
 function check(t){
  const d=t?.dimension,keys=(o,expected)=>o&&typeof o==='object'&&Object.keys(o).sort().join(',')===expected;
  if(t?.positionMarker!==undefined||!(keys(d,'a,b,offset,unit')||keys(d,'a,b,bindings,offset,unit'))||!number(d.offset)||!['mm','cm'].includes(d.unit)||![d.a,d.b].every(p=>keys(p,'x,y')&&number(p.x)&&number(p.y)))throw new Error('尺寸标注数据无效');
  if(d.bindings!==undefined){if(!d.bindings||Array.isArray(d.bindings)||typeof d.bindings!=='object'||Object.keys(d.bindings).some(k=>!['a','b'].includes(k)))throw new Error('尺寸节点关联无效');for(const b of Object.values(d.bindings))if(!keys(b,'index,pathId')||typeof b.pathId!=='string'||!b.pathId.trim()||b.pathId.length>200||!Number.isInteger(b.index)||b.index<0||b.index>=10000)throw new Error('尺寸节点关联无效');}
 }
 function basis(t){check(t);const {a,b,offset}=t.dimension,length=G.dist(a,b),u=length>0?{x:(b.x-a.x)/length,y:(b.y-a.y)/length}:{x:1,y:0},n={x:-u.y,y:u.x};return {a,b,length,u,n,qa:{x:a.x+n.x*offset,y:a.y+n.y*offset},qb:{x:b.x+n.x*offset,y:b.y+n.y*offset}};}
 function resolve(t,calibration,paths){
  if(paths){t={...t,dimension:{...t.dimension}};for(const key of ['a','b']){const b=t.dimension.bindings?.[key],node=b&&paths.find(p=>p.id===b.pathId)?.nodes[b.index];if(node)t.dimension[key]=G.point(node);}}
  const {length,u,qa,qb}=basis(t),scale=G.millimetersPerPixel(calibration),value=scale===null?null:length*scale/(t.dimension.unit==='cm'?10:1),content=value===null?'未标定':`${(Math.floor(value*100+.5)/100).toFixed(2)} ${t.dimension.unit}`;
  if(u.x<0||Math.abs(u.x)<=1e-12&&u.y<0){u.x=-u.x;u.y=-u.y;}
  const n={x:-u.y,y:u.x},width=content.length*t.fontSize*.6;
  return {...t,content,x:(qa.x+qb.x)/2-u.x*width/2-n.x*t.fontSize*1.35,y:(qa.y+qb.y)/2-u.y*width/2-n.y*t.fontSize*1.35,rotation:Math.atan2(u.y,u.x)*180/Math.PI};
 }
 function segments(t){
  const {a,b,length,u,n,qa,qb}=basis(t),extension=t.fontSize*.3*(t.dimension.offset<0?-1:1),arrow=Math.min(t.fontSize*.5,length*.25),point=(p,along,normal)=>({x:p.x+u.x*along+n.x*normal,y:p.y+u.y*along+n.y*normal});
  return [[a,point(qa,0,extension)],[b,point(qb,0,extension)],[qa,qb],[qa,point(qa,arrow,arrow*.4)],[qa,point(qa,arrow,-arrow*.4)],[qb,point(qb,-arrow,arrow*.4)],[qb,point(qb,-arrow,-arrow*.4)]];
 }
 function refresh(doc){for(const t of doc.texts||[])if(t.dimension)Object.assign(t,resolve(t,doc.calibration,doc.paths));}
 const same=(a,b)=>!!a&&!!b&&G.dist(a,b)<=1e-6;
 function nodeBinding(paths,point){const hits=[];for(const p of paths)for(let index=0;index<p.nodes.length;index++)if(p.nodes[index].x===point.x&&p.nodes[index].y===point.y)hits.push({pathId:p.id,index});return hits.length===1?hits[0]:null;}
 function retainedBindings(t,pathIds,paths=[]){const bindings=t.dimension.bindings??Object.fromEntries(['a','b'].map(key=>[key,nodeBinding(paths,t.dimension[key])]).filter(([,b])=>b));return Object.fromEntries(Object.entries(bindings).filter(([,b])=>pathIds.includes(b.pathId)));}
 function remap(before,after,index,current){
  if(!before?.nodes[index]||!after)return null;
  if(before.nodes.length===after.nodes.length){
   // Explicit transforms moved the dimension too; index identity takes priority.
   if(same(after.nodes[index],current))return index;
   const count=before.nodes.length,reverse=[];
   const offsets=before.closed?Array.from({length:count},(_,i)=>i):[count-1];
   for(const offset of offsets)if(before.nodes.every((n,i)=>same(n,after.nodes[(offset-i+count)%count])))reverse.push((offsets.length===1?count-1:offset)-index+count);
   if(reverse.length===1)return reverse[0]%count;
   return index;
  }
  const anchor=before.nodes[index],equal=n=>n.x===anchor.x&&n.y===anchor.y;
  if(before.nodes.filter(equal).length!==1)return null;
  const matches=after.nodes.map((n,i)=>equal(n)?i:-1).filter(i=>i>=0);
  return matches.length===1?matches[0]:null;
 }
 function captureBaseline(doc){
  // Free endpoints may snap to any path on the next edit; legacy inference also
  // needs every path to reject ambiguous anchors.
  const texts=(doc.texts||[]).filter(t=>t.dimension),needsAll=texts.some(t=>!t.dimension.bindings?.a||!t.dimension.bindings?.b);
  const referenced=new Set(texts.flatMap(t=>Object.values(t.dimension.bindings||{}).map(b=>b.pathId)));
  return JSON.parse(JSON.stringify({paths:needsAll?doc.paths:doc.paths.filter(p=>referenced.has(p.id)),texts}));
 }
 function sync(doc,before){
  if(!before){refresh(doc);return;}
  const oldTexts=new Map(before.texts.map(t=>[t.id,t])),oldPaths=new Map(before.paths.map(p=>[p.id,p])),paths=new Map(doc.paths.map(p=>[p.id,p]));
  let geometryChanged;
  for(const t of doc.texts||[]){
   if(!t.dimension)continue;const old=oldTexts.get(t.id)?.dimension,d=t.dimension;if(!old)continue;
   if(d.bindings===undefined&&(geometryChanged??=JSON.stringify(before.paths)!==JSON.stringify(doc.paths))){d.bindings={};for(const key of ['a','b'])if(same(d[key],old[key])){const binding=nodeBinding(before.paths,old[key]);if(binding)d.bindings[key]=binding;}}
   if(!d.bindings)continue;
   for(const key of ['a','b']){
    const binding=d.bindings[key];if(!binding)continue;
    const oldBinding=old.bindings?.[key];if(oldBinding&&JSON.stringify(oldBinding)!==JSON.stringify(binding))continue;
    const index=remap(oldPaths.get(binding.pathId),paths.get(binding.pathId),binding.index,d[key]);
    if(index===null){delete d.bindings[key];continue;}
    d.bindings[key]={...binding,index};d[key]=G.point(paths.get(binding.pathId).nodes[index]);
   }
  }
  refresh(doc);
 }
 const api={check,basis,resolve,segments,refresh,sync,captureBaseline,nodeBinding,retainedBindings};if(typeof module!=='undefined')module.exports=api;else root.CurveDimension=api;
})(typeof window!=='undefined'?window:globalThis);
