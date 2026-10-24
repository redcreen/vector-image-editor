(function(root){
 'use strict';
 const G=typeof module==='object'&&module.exports?require('./geometry.js'):root.CurveGeometry;
 const clone=v=>JSON.parse(JSON.stringify(v));
 const direction=t=>t?.dir===undefined?1:t.dir;
 const validTag=t=>t&&typeof t.id==='string'&&(t.side===0||t.side===1)&&(direction(t)===1||direction(t)===-1);
 const equal=(a,b)=>validTag(a)&&validTag(b)&&a.id===b.id&&a.side===b.side&&direction(a)===direction(b);
 const fail=()=>{throw new RangeError('对称关联不完整或已分散，请解除关联后重新镜像');};
 const tag=(p,i)=>{const a=p.nodes[i]?.symmetry?.out,b=p.nodes[(i+1)%p.nodes.length]?.symmetry?.in;return equal(a,b)?a:null;};
 function validPoint(p){if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e7||Math.abs(p.y)>1e7)throw new RangeError('对称坐标超出有效范围');}
 function validAxis(axis){validPoint(axis?.a);validPoint(axis?.b);if(G.dist(axis.a,axis.b)<1e-9)throw new RangeError('对称轴需要两个不同的点');}
 function groupsForPath(doc,pathId){const p=doc.paths.find(p=>p.id===pathId);return [...new Set((p?.nodes||[]).flatMap(n=>Object.values(n.symmetry||{}).map(t=>t.id)))];}
 function members(doc,id){return doc.paths.filter(p=>p.nodes.some(n=>n.symmetry?.in?.id===id||n.symmetry?.out?.id===id)).map(p=>p.id);}
 // Count even incomplete incident tags: a broken existing side must not be
 // mistaken for a deleted side and silently duplicated.
 function hasSide(doc,id,side){return doc.paths.some(p=>p.nodes.some(n=>Object.values(n.symmetry||{}).some(t=>t.id===id&&t.side===side)));}
 function context(doc,pathId,segmentIndex=null){const p=doc.paths.find(p=>p.id===pathId);if(!p)return null;const tags=segmentIndex===null?Array.from({length:G.segmentCount(p)},(_,i)=>tag(p,i)).filter(Boolean):[tag(p,segmentIndex)].filter(Boolean);if(!tags.length||tags.some(t=>!equal(t,tags[0])))return null;const t=tags[0],link=doc.symmetryLinks?.find(l=>l.id===t.id);return link?{id:t.id,side:t.side,axis:clone(link.axis),pathIds:members(doc,t.id),targetMissing:!hasSide(doc,t.id,1-t.side)}:null;}
 function mark(p,indices,id,side){for(const i of indices){const a=p.nodes[i],b=p.nodes[(i+1)%p.nodes.length];a.symmetry={...a.symmetry,out:{id,side,dir:1}};b.symmetry={...b.symmetry,in:{id,side,dir:1}};}}
 function link(doc,source,copy,axis,id,segmentIndex=null){
  validAxis(axis);if(!id||doc.symmetryLinks?.some(l=>l.id===id)||source===copy)fail();
  const indices=segmentIndex===null?Array.from({length:G.segmentCount(source)},(_,i)=>i):[segmentIndex],other=Array.from({length:G.segmentCount(copy)},(_,i)=>i);
  if(!indices.length||!other.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=G.segmentCount(source)))fail();
  const orphaned=new Set();
  for(const [p,list] of [[source,indices],[copy,other]])for(const i of list)for(const t of [p.nodes[i].symmetry?.out,p.nodes[(i+1)%p.nodes.length].symmetry?.in])if(t){
   if(p!==source||!validTag(t)||hasSide(doc,t.id,1-t.side))throw new RangeError('所选曲线已有对称关联，请先解除关联');
   orphaned.add(t.id);
  }
  orphaned.forEach(id=>unlink(doc,id));
  mark(source,indices,id,0);mark(copy,other,id,1);doc.symmetryLinks=[...(doc.symmetryLinks||[]),{id,axis:clone(axis)}];return id;
 }
 function span(doc,id,side){
  const found=[];
  for(const p of doc.paths){const count=G.segmentCount(p),indices=[];for(let i=0;i<count;i++){const t=tag(p,i);if(t?.id===id&&t.side===side)indices.push(i);}
   for(let i=0;i<p.nodes.length;i++)for(const incident of ['in','out']){const t=p.nodes[i].symmetry?.[incident];if(t?.id!==id||t.side!==side)continue;const index=incident==='out'?i:(i-1+p.nodes.length)%p.nodes.length;if(index>=count||!equal(t,tag(p,index)))fail();}
   if(!indices.length)continue;
   const indexSet=new Set(indices),all=!!p.closed&&indices.length===count,starts=indices.filter(i=>!indexSet.has((i-1+count)%count)||(i===0&&!p.closed));if(!all&&starts.length!==1)fail();const start=all?0:starts[0];
   const ordered=Array.from({length:indices.length},(_,j)=>(start+j)%count);if(ordered.some(i=>!indexSet.has(i)||direction(tag(p,i))!==direction(tag(p,start))))fail();
   found.push({p,start,length:indices.length,all,nodes:Array.from({length:indices.length+(all?0:1)},(_,j)=>p.nodes[(start+j)%p.nodes.length]),dir:tag(p,start).dir||1});
  }
  if(found.length!==1)fail();return found[0];
 }
 function reverse(nodes){return nodes.reverse().map(n=>({...n,in:n.out,out:n.in}));}
 function planSync(doc,id,side,newPathId=null){
  if(side!==0&&side!==1)fail();const l=doc.symmetryLinks?.find(l=>l.id===id);if(!l)fail();validAxis(l.axis);
  const src=span(doc,id,side);
  if(!hasSide(doc,id,1-side)){
   if(typeof newPathId!=='string'||!newPathId.trim()||newPathId.length>200||doc.paths.some(p=>p.id===newPathId))throw new RangeError('另一侧已删除，请重新生成另一侧');
   if(doc.paths.length>=500)throw new RangeError('最多支持 500 条曲线，请先整理曲线');
   // Build a detached destination, then use the normal sync path to retain
   // its coordinate checks, notch isolation and direction handling.
   const copy={...clone(src.p),id:newPathId,name:`${(src.p.name||'曲线').slice(0,75)} · 镜像`,closed:src.all,visible:true,nodes:clone(src.nodes)};
   for(const n of copy.nodes)delete n.symmetry;
   mark(copy,Array.from({length:G.segmentCount(copy)},(_,i)=>i),id,1-side);
   for(const n of copy.nodes)for(const t of Object.values(n.symmetry||{}))t.dir=src.dir;
   const plan=planSync({...doc,paths:[...doc.paths,copy]},id,side);
   return {...plan,createdPath:{id:newPathId,sourcePathId:src.p.id}};
  }
  const dst=span(doc,id,1-side);if(src.all!==dst.all)fail();
  const destinationNodes=new Set(dst.nodes);if(src.p===dst.p&&src.nodes.some(n=>destinationNodes.has(n)&&n.notchId))throw new RangeError('对称两侧共用的端点含剪口，请先移除该剪口或断开端点后同步');
  let ns=G.reflectPath({nodes:src.nodes},l.axis.a,l.axis.b).nodes;if(src.dir!==dst.dir)ns=reverse(ns);
  const reservedNotches=new Set(src.nodes.map(n=>n.notchId).filter(Boolean));for(const p of doc.paths)for(const n of p.nodes)if(!destinationNodes.has(n)&&n.notchId)reservedNotches.add(n.notchId);
  const notchMap=new Map();for(const n of ns){delete n.symmetry;if(n.notchId){if(!notchMap.has(n.notchId)){const base=`${id}:${1-side}:${notchMap.size}`;let candidate=base,suffix=0;while(reservedNotches.has(candidate))candidate=`${base}:${++suffix}`;notchMap.set(n.notchId,candidate);reservedNotches.add(candidate);}n.notchId=notchMap.get(n.notchId);}}
  mark({nodes:ns},Array.from({length:ns.length-(src.all?0:1)},(_,i)=>i),id,1-side);for(const n of ns)for(const t of Object.values(n.symmetry||{}))t.dir=dst.dir;
  const replacement=clone(dst.p),ordered=Array.from({length:dst.p.nodes.length},(_,j)=>clone(dst.p.nodes[(dst.start+j)%dst.p.nodes.length]));
  if(src.all)replacement.nodes=ns;
  else {
   const first=ns[0],last=ns.at(-1),oldFirst=ordered[0],oldLast=ordered[dst.length];
   // Shared boundary nodes keep the incident geometry outside the replaced span.
   if(dst.p.closed||dst.start>0){first.in=clone(oldFirst.in);if(oldFirst.symmetry?.in)first.symmetry.in=clone(oldFirst.symmetry.in);first.mode='cusp';}
   if(dst.p.closed||dst.start+dst.length<dst.p.nodes.length-1){last.out=clone(oldLast.out);if(oldLast.symmetry?.out)last.symmetry.out=clone(oldLast.symmetry.out);last.mode='cusp';}
   for(const [fresh,old,incident] of [[first,oldFirst,'in'],[last,oldLast,'out']])if(src.p===dst.p&&old.symmetry?.[incident]?.id===id&&old.symmetry[incident].side===side){const reflected=G.reflectPoint(old,l.axis.a,l.axis.b);fresh.x=(old.x+reflected.x)/2;fresh.y=(old.y+reflected.y)/2;}
   if(dst.p.closed){replacement.nodes=ns.concat(ordered.slice(dst.length+1));if(dst.start){const oldZero=dst.p.nodes.length-dst.start,offset=oldZero>=dst.length?oldZero+ns.length-dst.length-1:Math.round(oldZero*(ns.length-1)/dst.length);replacement.nodes=replacement.nodes.slice(offset).concat(replacement.nodes.slice(0,offset));}}
   else replacement.nodes=clone(dst.p.nodes.slice(0,dst.start)).concat(ns,clone(dst.p.nodes.slice(dst.start+dst.length+1)));
  }
  if(replacement.nodes.length>10000)throw new RangeError('同步后节点不能超过 10000 个');for(const n of replacement.nodes){validPoint(n);validPoint(n.in);validPoint(n.out);}
  const paths=doc.paths.map(p=>p===dst.p?replacement:p);return {paths,targetPathIds:[dst.p.id],previewPaths:[replacement]};
 }
 function unlink(doc,id){for(const p of doc.paths)for(const n of p.nodes){if(!n.symmetry)continue;for(const key of ['in','out'])if(n.symmetry[key]?.id===id)delete n.symmetry[key];if(!Object.keys(n.symmetry).length)delete n.symmetry;}doc.symmetryLinks=(doc.symmetryLinks||[]).filter(l=>l.id!==id);}
 function transformLinks(doc,pathIds,mapPoint){const selected=new Set(pathIds);const links=(doc.symmetryLinks||[]).map(l=>{
  const ids=members(doc,l.id);if(!ids.length||!ids.every(id=>selected.has(id)))return l;
  validAxis(l.axis);const a=mapPoint(clone(l.axis.a)),b=mapPoint(clone(l.axis.b)),dx=l.axis.b.x-l.axis.a.x,dy=l.axis.b.y-l.axis.a.y,n=mapPoint({x:l.axis.a.x-dy,y:l.axis.a.y+dx});validAxis({a,b});validPoint(n);
  const u={x:b.x-a.x,y:b.y-a.y},v={x:n.x-a.x,y:n.y-a.y},scale=Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);if(scale<1e-18||Math.abs(u.x*v.x+u.y*v.y)>1e-7*scale)throw new RangeError('此缩放会破坏对称关系，请先解除关联');return {...l,axis:{a,b}};
 });doc.symmetryLinks=links;return links;}
 const api={link,context,groupsForPath,planSync,unlink,transformLinks};if(typeof module==='object'&&module.exports)module.exports=api;else root.CurveSymmetry=api;
})(typeof window!=='undefined'?window:globalThis);
