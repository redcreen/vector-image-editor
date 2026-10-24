(function(root){
 'use strict';
 const point=n=>({x:n.x,y:n.y});
 const node=(x,y,mode='cusp')=>({x,y,in:{x,y},out:{x,y},mode:['cusp','smooth','symmetric'].includes(mode)?mode:'cusp'});
 const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const formatPoint=n=>`${Number(n.x.toFixed(4))} ${Number(n.y.toFixed(4))}`;
 function at(a,b,t){const p=mix(a,a.out,t),q=mix(a.out,b.in,t),r=mix(b.in,b,t);return mix(mix(p,q,t),mix(q,r,t),t);}
 function reflectionAxis(a,b){
  const dx=b.x-a.x,dy=b.y-a.y,lengthSquared=dx*dx+dy*dy;
  if(lengthSquared<=1e-18)throw new RangeError('Mirror axis points must be distinct');
  return {dx,dy,lengthSquared};
 }
 function reflectedPoint(p,a,axis){
  const t=((p.x-a.x)*axis.dx+(p.y-a.y)*axis.dy)/axis.lengthSquared;
  const x=a.x+t*axis.dx,y=a.y+t*axis.dy;
  return {x:2*x-p.x,y:2*y-p.y};
 }
 function reflectPoint(p,a,b){return reflectedPoint(p,a,reflectionAxis(a,b));}
 function clone(value){
  if(Array.isArray(value))return value.map(clone);
  if(value&&typeof value==='object'){
   const copy={};for(const key of Object.keys(value))copy[key]=clone(value[key]);return copy;
  }
  return value;
 }
 function reflectPath(path,a,b){
  const axis=reflectionAxis(a,b),copy=clone(path);
  for(const n of copy.nodes||[]){
   const anchor=reflectedPoint(n,a,axis),incoming=reflectedPoint(n.in,a,axis),outgoing=reflectedPoint(n.out,a,axis);
   n.x=anchor.x;n.y=anchor.y;n.in.x=incoming.x;n.in.y=incoming.y;n.out.x=outgoing.x;n.out.y=outgoing.y;
  }
  return copy;
 }
 function swapSymmetry(n){if(n.symmetry){const s=n.symmetry;n.symmetry={};if(s.out)n.symmetry.in={...s.out,dir:-(s.out.dir||1)};if(s.in)n.symmetry.out={...s.in,dir:-(s.in.dir||1)};}return n;}
 function incident(n,side,value){if(value)n.symmetry={...n.symmetry,[side]:clone(value)};else if(n.symmetry){delete n.symmetry[side];if(!Object.keys(n.symmetry).length)delete n.symmetry;}}
 function mergeNotch(target,source){
  if(target.notchId&&source.notchId&&target.notchId!==source.notchId)throw new RangeError('连接端点属于不同剪口，请先解除剪口保护');
  if(!target.notchId&&source.notchId)target.notchId=source.notchId;
 }
 function split(path,i,t){
  const a=path.nodes[i],b=path.nodes[(i+1)%path.nodes.length];
  const p=mix(a,a.out,t),q=mix(a.out,b.in,t),r=mix(b.in,b,t),s=mix(p,q,t),v=mix(q,r,t),m=mix(s,v,t);
  const n=node(m.x,m.y);n.in=s;n.out=v;n.mode='smooth';a.out=p;b.in=r;
  if(a.notchId&&a.notchId===b.notchId)n.notchId=a.notchId;
  if(a.symmetry?.out&&b.symmetry?.in&&a.symmetry.out.id===b.symmetry.in.id&&a.symmetry.out.side===b.symmetry.in.side)n.symmetry={in:clone(a.symmetry.out),out:clone(a.symmetry.out)};
  if(a.mode==='symmetric')a.mode='smooth';if(b.mode==='symmetric')b.mode='smooth';
  path.nodes.splice(i+1,0,n);return i+1;
 }
 function move(n,dx,dy){n.x+=dx;n.y+=dy;n.in.x+=dx;n.in.y+=dy;n.out.x+=dx;n.out.y+=dy;}
 function handle(n,side,p,independent=false){
  const other=side==='in'?'out':'in',len=dist(n,n[other]),d=dist(n,p);n[side]=point(p);
  if(independent){n.mode='cusp';return;}
  if(n.mode==='symmetric')n[other]={x:2*n.x-p.x,y:2*n.y-p.y};
  else if(n.mode==='smooth'&&d>1e-9)n[other]={x:n.x-(p.x-n.x)*len/d,y:n.y-(p.y-n.y)*len/d};
 }
 function setMode(path,index,mode){
  const ns=path.nodes,n=ns[index];n.mode=mode;
  if(mode==='cusp')return;
  if(dist(n,n.in)<.01&&dist(n,n.out)<.01){
   const prev=index>0?ns[index-1]:path.closed?ns.at(-1):null;
   const next=index<ns.length-1?ns[index+1]:path.closed?ns[0]:null;
   const a=prev||n,b=next||n,d=dist(a,b)||1;
   const len=(prev&&next?Math.min(dist(n,prev),dist(n,next)):dist(n,prev||next||n))/3;
   n.out={x:n.x+(b.x-a.x)*len/d,y:n.y+(b.y-a.y)*len/d};
   n.in={x:2*n.x-n.out.x,y:2*n.y-n.out.y};
  }
  const side=dist(n,n.out)>.01?'out':'in';handle(n,side,n[side]);
 }
 function smoothNodes(path,indices){
  const ns=path.nodes;
  for(const index of new Set(indices)){
   if(!Number.isInteger(index)||index<0||index>=ns.length)continue;
   const n=ns[index],prev=index>0?ns[index-1]:path.closed&&ns.length>1?ns.at(-1):null;
   const next=index<ns.length-1?ns[index+1]:path.closed&&ns.length>1?ns[0]:null;
   const incoming=prev?dist(prev,n):0,outgoing=next?dist(n,next):0;
   // Bisect the adjacent directions so uneven point spacing cannot dominate the tangent.
   const dx=(incoming>1e-9?(n.x-prev.x)/incoming:0)+(outgoing>1e-9?(next.x-n.x)/outgoing:0);
   const dy=(incoming>1e-9?(n.y-prev.y)/incoming:0)+(outgoing>1e-9?(next.y-n.y)/outgoing:0);
   const length=Math.hypot(dx,dy);n.mode='smooth';n.in=point(n);n.out=point(n);
   // A reversal or coincident neighborhood has no unique tangent; avoid creating loops.
   if(length<=1e-9)continue;
   if(incoming>1e-9)n.in={x:n.x-dx/length*incoming/3,y:n.y-dy/length*incoming/3};
   if(outgoing>1e-9)n.out={x:n.x+dx/length*outgoing/3,y:n.y+dy/length*outgoing/3};
  }
 }
 function append(path,pos,mode){
  const previous=path.nodes.at(-1);path.nodes.push(node(pos.x,pos.y,mode));
  const index=path.nodes.length-1;setMode(path,index,path.nodes[index].mode);
  if(previous&&previous.mode!=='cusp'&&dist(previous,previous.in)<.01&&dist(previous,previous.out)<.01)setMode(path,index-1,previous.mode);
  return index;
 }
 function extend(path,pos,mode,fromStart=false){
  // Only initialize the new node; the existing curve and endpoint handles stay intact.
  if(fromStart)path.nodes.unshift(node(pos.x,pos.y,mode));else path.nodes.push(node(pos.x,pos.y,mode));
  const index=fromStart?0:path.nodes.length-1;setMode(path,index,path.nodes[index].mode);return index;
 }
 function mergePaths(paths,activeId=paths?.[0]?.id){
  if(!Array.isArray(paths)||paths.length<2)throw new RangeError('请至少选择两条开放曲线');
  if(paths.some(p=>!p||p.closed||!Array.isArray(p.nodes)||p.nodes.length<2))throw new RangeError('只能合并至少含两个节点的开放曲线，请先打开闭合曲线');
  if(new Set(paths.map(p=>p.id)).size!==paths.length)throw new RangeError('请选择不同的曲线');
  const primary=paths.find(p=>p.id===activeId);if(!primary)throw new RangeError('当前曲线不在所选曲线中');
  // At most one coincident node disappears at each join.
  if(paths.reduce((sum,p)=>sum+p.nodes.length,0)>10000+paths.length-1)throw new RangeError('合并后节点不能超过 10000 个');
  const merged=clone(primary),remaining=paths.filter(p=>p!==primary).map(p=>clone(p.nodes));
  const reverse=nodes=>nodes.reverse().map(n=>swapSymmetry({...n,in:n.out,out:n.in}));
  function join(a,b){
   const end=a.at(-1),start=b[0];
   if(end.x===start.x&&end.y===start.y){
    mergeNotch(end,start);
    end.out=point(start.out);incident(end,'out',start.symmetry?.out);
    const ix=end.in.x-end.x,iy=end.in.y-end.y,ox=end.out.x-end.x,oy=end.out.y-end.y;
    const incoming=Math.hypot(ix,iy),outgoing=Math.hypot(ox,oy);
    const aligned=incoming>1e-9&&outgoing>1e-9&&ix*ox+iy*oy<0&&Math.abs(ix*oy-iy*ox)<=1e-6*incoming*outgoing;
    end.mode=aligned?(Math.abs(incoming-outgoing)<=1e-6*Math.max(1,incoming,outgoing)?'symmetric':'smooth'):'cusp';
    return a.concat(b.slice(1));
   }
   // Only the unused endpoint handles change; existing segments retain their shape.
   incident(end,'out',null);incident(start,'in',null);end.out=point(end);end.mode='cusp';start.in=point(start);start.mode='cusp';
   return a.concat(b);
  }
  while(remaining.length){
   let best=null;
   remaining.forEach((nodes,index)=>{
    for(const prepend of [false,true])for(const reversed of [false,true]){
     const endpoint=prepend?merged.nodes[0]:merged.nodes.at(-1);
     const candidate=prepend?(reversed?nodes[0]:nodes.at(-1)):(reversed?nodes.at(-1):nodes[0]);
     const distance=dist(endpoint,candidate);
     if(!best||distance<best.distance)best={index,prepend,reversed,distance};
    }
   });
   let nodes=remaining.splice(best.index,1)[0];if(best.reversed)nodes=reverse(nodes);
   merged.nodes=best.prepend?join(nodes,merged.nodes):join(merged.nodes,nodes);
  }
  if(merged.nodes.length>10000)throw new RangeError('合并后节点不能超过 10000 个');
  merged.closed=false;return merged;
 }
 function breakPath(path,index){
  const nodes=path&&Array.isArray(path.nodes)?path.nodes:null;
  if(!nodes||!Number.isInteger(index)||index<0||index>=nodes.length)throw new RangeError('请选择有效的曲线节点');
  if(path.closed){
   if(nodes.length<3)throw new RangeError('闭合曲线至少需要三个节点');
   if(nodes.length+1>10000)throw new RangeError('断开后每条曲线不能超过 10000 个节点');
   const opened=clone(path),ordered=[];
   for(let offset=0;offset<nodes.length;offset++)ordered.push(clone(nodes[(index+offset)%nodes.length]));
   ordered.push(clone(nodes[index]));
   incident(ordered[0],'in',null);incident(ordered.at(-1),'out',null);ordered[0].in=point(ordered[0]);ordered[0].mode='cusp';
   ordered.at(-1).out=point(ordered.at(-1));ordered.at(-1).mode='cusp';
   opened.closed=false;opened.nodes=ordered;return [opened];
  }
  if(nodes.length<3||index===0||index===nodes.length-1)throw new RangeError('只能在开放曲线的内部节点断开');
  const left=clone(path),right=clone(path);
  left.closed=false;right.closed=false;left.nodes=clone(nodes.slice(0,index+1));right.nodes=clone(nodes.slice(index));
  if(left.nodes.length>10000||right.nodes.length>10000)throw new RangeError('断开后每条曲线不能超过 10000 个节点');
  incident(left.nodes.at(-1),'out',null);incident(right.nodes[0],'in',null);left.nodes.at(-1).out=point(left.nodes.at(-1));left.nodes.at(-1).mode='cusp';
  right.nodes[0].in=point(right.nodes[0]);right.nodes[0].mode='cusp';
  return [left,right];
 }
 function joinEndpoints(source,sourceIndex,target,targetIndex){
  const valid=path=>path&&!path.closed&&Array.isArray(path.nodes)&&path.nodes.length>=2;
  if(!valid(source)||!valid(target))throw new RangeError('只能连接至少含两个节点的开放曲线');
  const endpoint=(path,index)=>Number.isInteger(index)&&(index===0||index===path.nodes.length-1);
  if(!endpoint(source,sourceIndex)||!endpoint(target,targetIndex))throw new RangeError('只能连接指定曲线的端点');
  const sourceNode=source.nodes[sourceIndex],targetNode=target.nodes[targetIndex];
  if(sourceNode.x!==targetNode.x||sourceNode.y!==targetNode.y)throw new RangeError('连接端点必须重合');
  if(source===target){
   if(sourceIndex===targetIndex||source.nodes.length-1<3)throw new RangeError('闭合后曲线至少需要三个节点');
   const closed=clone(source),last=closed.nodes.at(-1);
   mergeNotch(closed.nodes[0],last);
   incident(closed.nodes[0],'in',last.symmetry?.in);closed.nodes[0].in=point(last.in);closed.nodes[0].mode='cusp';closed.nodes.pop();closed.closed=true;
   return {path:closed,nodeIndex:0};
  }
  if(source.nodes.length+target.nodes.length-1>10000)throw new RangeError('连接后节点不能超过 10000 个');
  const reverse=nodes=>nodes.reverse().map(n=>swapSymmetry({...n,in:n.out,out:n.in}));
  let sourceNodes=clone(source.nodes),targetNodes=clone(target.nodes);
  if(sourceIndex===0)sourceNodes=reverse(sourceNodes);
  if(targetIndex===target.nodes.length-1)targetNodes=reverse(targetNodes);
  const joint=sourceNodes.at(-1),targetStart=targetNodes[0];
  mergeNotch(joint,targetStart);
  incident(joint,'out',targetStart.symmetry?.out);joint.out=point(targetStart.out);joint.mode='cusp';
  const joined=clone(source);joined.closed=false;joined.nodes=sourceNodes.concat(targetNodes.slice(1));
  return {path:joined,nodeIndex:sourceNodes.length-1};
 }
 function connectCoincidentEndpoints(paths,activeId){
  if(!Array.isArray(paths)||new Set(paths.map(p=>p.id)).size!==paths.length)throw new RangeError('请选择不同的曲线');
  const open=paths.filter(p=>!p.closed&&p.nodes.length>=2),buckets=new Map(),neighbors=new Map(open.map(p=>[p.id,[null,null]]));
  for(const p of open)for(const side of [0,1]){
   const n=side?p.nodes.at(-1):p.nodes[0],key=JSON.stringify([n.x,n.y]);
   if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({path:p,side});
  }
  let ambiguous=0,joins=0,skippedClosures=0;
  // Freeze the original graph so connecting elsewhere cannot remove ambiguity.
  for(const ends of buckets.values()){
   if(ends.length>2){ambiguous++;continue;}
   if(ends.length!==2)continue;
   const [a,b]=ends;neighbors.get(a.path.id)[a.side]=b;neighbors.get(b.path.id)[b.side]=a;
  }
  const visited=new Set(),replacements=new Map(),removed=new Set(),mapping=[];
  for(const seed of open){
   if(visited.has(seed.id))continue;
   const component=[],pending=[seed],found=new Set();
   while(pending.length){const p=pending.pop();if(found.has(p.id))continue;found.add(p.id);component.push(p);for(const next of neighbors.get(p.id))if(next)pending.push(next.path);}
   const primary=component.find(p=>p.id===activeId)||seed;
   const start=[primary,...component].find(p=>neighbors.get(p.id).some(n=>!n))||primary;
   let entry={path:start,side:neighbors.get(start.id)[0]&&!neighbors.get(start.id)[1]?1:0},nodes=[],maps=[],loop=false;
   while(entry&&!visited.has(entry.path.id)){
    const p=entry.path,reversed=entry.side===1,part=clone(p.nodes);
    if(reversed)part.reverse().forEach(n=>{const incoming=n.in;n.in=n.out;n.out=incoming;swapSymmetry(n);});
    const offset=nodes.length?nodes.length-1:0;
    if(nodes.length){
     const joint=nodes.at(-1),first=part[0];joint.out=point(first.out);incident(joint,'out',first.symmetry?.out);joint.mode='cusp';
     mergeNotch(joint,first);
     nodes.push(...part.slice(1));
    }else nodes=part;
    maps.push({sourceId:p.id,pathId:primary.id,nodes:p.nodes.map((_,i)=>offset+(reversed?p.nodes.length-1-i:i)),segments:p.nodes.slice(1).map((_,i)=>({index:offset+(reversed?p.nodes.length-2-i:i),reversed}))});
    visited.add(p.id);entry=neighbors.get(p.id)[1-entry.side];loop=!!entry&&visited.has(entry.path.id);
   }
   const closed=loop&&nodes.length>=4;
   if(loop&&!closed)skippedClosures++;
   const count=component.length-1+Number(closed);if(!count)continue;
   if(nodes.length-Number(closed)>10000)throw new RangeError('连接后每条曲线不能超过 10000 个节点');
   if(closed){
    const last=nodes.pop();nodes[0].in=point(last.in);incident(nodes[0],'in',last.symmetry?.in);nodes[0].mode='cusp';
    mergeNotch(nodes[0],last);
    for(const map of maps)map.nodes=map.nodes.map(i=>i===nodes.length?0:i);
   }
   replacements.set(primary.id,{...clone(primary),nodes,closed});
   component.forEach(p=>{if(p.id!==primary.id)removed.add(p.id);});mapping.push(...maps);joins+=count;
  }
  return {paths:paths.filter(p=>!removed.has(p.id)).map(p=>replacements.get(p.id)||p),mapping,joins,ambiguous,skippedClosures};
 }
 function segmentCount(path){
  const count=path&&Array.isArray(path.nodes)?path.nodes.length:0;
  return count<2?0:count-(path.closed?0:1);
 }
 function toggleSegment(path,index){
  const count=segmentCount(path);
  if(!Number.isInteger(index)||index<0||index>=count)return null;
  const ns=path.nodes,a=ns[index],endIndex=(index+1)%ns.length,b=ns[endIndex];
  const collapsed=(anchor,handle)=>dist(anchor,handle)<=.01+1e-9;
  const straight=collapsed(a,a.out)&&collapsed(b,b.in);
  a.mode='cusp';b.mode='cusp';
  if(!straight){a.out=point(a);b.in=point(b);return 'straight';}

  const chordLength=dist(a,b);
  if(chordLength<=1e-9)return 'curve';
  const unit=(dx,dy)=>{const length=Math.hypot(dx,dy);return length>1e-9?{x:dx/length,y:dy/length}:null;};
  const combined=(first,second,fallback)=>{
   if(first&&second){const direction=unit(first.x+second.x,first.y+second.y);if(direction)return direction;}
   return first||second||fallback;
  };
  const chord=unit(b.x-a.x,b.y-a.y);
  const previous=index>0?ns[index-1]:path.closed?ns.at(-1):null;
  const next=endIndex<ns.length-1?ns[endIndex+1]:path.closed?ns[(endIndex+1)%ns.length]:null;
  const incoming=unit(a.x-a.in.x,a.y-a.in.y)||previous&&unit(a.x-previous.x,a.y-previous.y);
  const outgoing=unit(b.out.x-b.x,b.out.y-b.y)||next&&unit(next.x-b.x,next.y-b.y);
  const startDirection=unit(a.x-a.in.x,a.y-a.in.y)||combined(incoming,chord,chord);
  const endDirection=unit(b.out.x-b.x,b.out.y-b.y)||combined(chord,outgoing,chord);
  const handleLength=chordLength/3;
  a.out={x:a.x+startDirection.x*handleLength,y:a.y+startDirection.y*handleLength};
  b.in={x:b.x-endDirection.x*handleLength,y:b.y-endDirection.y*handleLength};
  return 'curve';
 }
 function cubicLength(a,b,c,d,tolerance,depth=0){
  const chord=dist(a,d),polygon=dist(a,b)+dist(b,c)+dist(c,d);
  if(depth>=24||polygon-chord<=tolerance)return (polygon+chord)/2;
  const ab=mix(a,b,.5),bc=mix(b,c,.5),cd=mix(c,d,.5);
  const abc=mix(ab,bc,.5),bcd=mix(bc,cd,.5),middle=mix(abc,bcd,.5);
  return cubicLength(a,ab,abc,middle,tolerance/2,depth+1)+cubicLength(middle,bcd,cd,d,tolerance/2,depth+1);
 }
 function segmentLength(path,index,tolerance=.001){
  const count=segmentCount(path);
  if(!Number.isInteger(index)||index<0||index>=count)return 0;
  const a=path.nodes[index],b=path.nodes[(index+1)%path.nodes.length];
  const accuracy=Number.isFinite(tolerance)&&tolerance>0?tolerance:.001;
  return cubicLength(a,a.out,b.in,b,accuracy);
 }
 function pathLength(path,indices=null){
  const count=segmentCount(path);
  const selected=indices==null?Array.from({length:count},(_,i)=>i):
   [...new Set(Array.isArray(indices)?indices:[])].filter(i=>Number.isInteger(i)&&i>=0&&i<count);
  return selected.reduce((sum,index)=>sum+segmentLength(path,index),0);
 }
 function polylineLength(points){
  let total=0;for(let i=1;i<(points||[]).length;i++)total+=dist(points[i-1],points[i]);return total;
 }
 function millimetersPerPixel(calibration){
  if(calibration==null)return null;
  const validPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=1e7&&Math.abs(p.y)<=1e7;
  if(!validPoint(calibration.a)||!validPoint(calibration.b))throw new RangeError('标定点坐标无效');
  if(!Number.isFinite(calibration.length)||calibration.length<=0||calibration.length>1e7)throw new RangeError('请输入大于 0 且不超过 10000000 的实际长度');
  if(!['mm','cm'].includes(calibration.unit))throw new RangeError('标定单位仅支持 mm 或 cm');
  const pixels=dist(calibration.a,calibration.b);
  if(pixels<1e-6)throw new RangeError('两个标定点不能重合或距离过近');
  const scale=calibration.length*(calibration.unit==='cm'?10:1)/pixels;
  if(!Number.isFinite(scale)||scale<=0)throw new RangeError('标定比例无效');return scale;
 }
 function measureLength(pixels,calibration,unit='mm'){
  if(!['mm','cm'].includes(unit))throw new RangeError('测量单位仅支持 mm 或 cm');
  const scale=millimetersPerPixel(calibration);
  return scale===null?{value:pixels,unit:'px'}:{value:pixels*scale/(unit==='cm'?10:1),unit};
 }
 function shapeBounds(start,end,constrain=false){
  if(!start||!end||![start.x,start.y,end.x,end.y].every(Number.isFinite))throw new RangeError('形状坐标必须是有限数字');
  let dx=end.x-start.x,dy=end.y-start.y;
  if(constrain){
   const size=Math.max(Math.abs(dx),Math.abs(dy));
   dx=(dx<0?-1:1)*size;dy=(dy<0?-1:1)*size;
  }
  return {x:Math.min(start.x,start.x+dx),y:Math.min(start.y,start.y+dy),width:Math.abs(dx),height:Math.abs(dy)};
 }
 function createShape(kind,start,end,constrain=false){
  if(!['rectangle','ellipse'].includes(kind))throw new RangeError('不支持的形状类型');
  const bounds=shapeBounds(start,end,constrain);
  if(bounds.width===0||bounds.height===0)return null;
  const x=bounds.x,y=bounds.y,x2=x+bounds.width,y2=y+bounds.height;
  if(kind==='rectangle')return {closed:true,nodes:[node(x,y),node(x2,y),node(x2,y2),node(x,y2)]};
  const cx=x+bounds.width/2,cy=y+bounds.height/2,kappa=4*(Math.sqrt(2)-1)/3;
  const hx=bounds.width/2*kappa,hy=bounds.height/2*kappa;
  const top=node(cx,y,'symmetric'),right=node(x2,cy,'symmetric'),bottom=node(cx,y2,'symmetric'),left=node(x,cy,'symmetric');
  top.in={x:cx-hx,y};top.out={x:cx+hx,y};
  right.in={x:x2,y:cy-hy};right.out={x:x2,y:cy+hy};
  bottom.in={x:cx+hx,y:y2};bottom.out={x:cx-hx,y:y2};
  left.in={x,y:cy+hy};left.out={x,y:cy-hy};
  return {closed:true,nodes:[top,right,bottom,left]};
 }
 function normalizeRect(a,b){
  return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)};
 }
 function rectEdges(rect){
  const x2=rect.x+rect.width,y2=rect.y+rect.height;
  return {left:Math.min(rect.x,x2),right:Math.max(rect.x,x2),top:Math.min(rect.y,y2),bottom:Math.max(rect.y,y2)};
 }
 function includePoint(bounds,p){
  bounds.minX=Math.min(bounds.minX,p.x);bounds.maxX=Math.max(bounds.maxX,p.x);
  bounds.minY=Math.min(bounds.minY,p.y);bounds.maxY=Math.max(bounds.maxY,p.y);
 }
 function cubicValue(p0,p1,p2,p3,t){
  const u=1-t;return u*u*u*p0+3*u*u*t*p1+3*u*t*t*p2+t*t*t*p3;
 }
 function extremaParameters(p0,p1,p2,p3){
  const a=-p0+3*p1-3*p2+p3,b=3*p0-6*p1+3*p2,c=-3*p0+3*p1;
  const qa=3*a,qb=2*b,roots=[];
  if(Math.abs(qa)<1e-12){if(Math.abs(qb)>=1e-12)roots.push(-c/qb);}
  else{
   const discriminant=qb*qb-4*qa*c;
   if(discriminant>=0){const root=Math.sqrt(discriminant);roots.push((-qb-root)/(2*qa),(-qb+root)/(2*qa));}
  }
  return roots.filter(t=>t>0&&t<1);
 }
 function includeCubicBounds(bounds,a,b){
  includePoint(bounds,a);includePoint(bounds,b);
  for(const t of extremaParameters(a.x,a.out.x,b.in.x,b.x))includePoint(bounds,{x:cubicValue(a.x,a.out.x,b.in.x,b.x,t),y:cubicValue(a.y,a.out.y,b.in.y,b.y,t)});
  for(const t of extremaParameters(a.y,a.out.y,b.in.y,b.y))includePoint(bounds,{x:cubicValue(a.x,a.out.x,b.in.x,b.x,t),y:cubicValue(a.y,a.out.y,b.in.y,b.y,t)});
 }
 function pathBounds(path){
  const ns=path&&Array.isArray(path.nodes)?path.nodes:[];
  if(!ns.length)return null;
  const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  if(ns.length===1)includePoint(bounds,ns[0]);
  else for(let i=0;i<segmentCount(path);i++)includeCubicBounds(bounds,ns[i],ns[(i+1)%ns.length]);
  return {x:bounds.minX,y:bounds.minY,width:bounds.maxX-bounds.minX,height:bounds.maxY-bounds.minY};
 }
 function contentBounds(doc){
  const width=Number.isFinite(doc&&doc.width)&&doc.width>0?doc.width:1000;
  const height=Number.isFinite(doc&&doc.height)&&doc.height>0?doc.height:700;
  let minX=0,minY=0,maxX=width,maxY=height;
  for(const path of doc&&Array.isArray(doc.paths)?doc.paths:[]){
   const b=pathBounds(path);if(!b)continue;
   minX=Math.min(minX,b.x);minY=Math.min(minY,b.y);maxX=Math.max(maxX,b.x+b.width);maxY=Math.max(maxY,b.y+b.height);
  }
  const padding=4;
  if(minX<0)minX-=padding;if(minY<0)minY-=padding;
  if(maxX>width)maxX+=padding;if(maxY>height)maxY+=padding;
  return {x:minX,y:minY,width:maxX-minX,height:maxY-minY};
 }
 function pointInEdges(p,r){return p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom;}
 function orientation(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
 function pointOnSegment(p,a,b){
  return Math.abs(orientation(a,b,p))<=1e-9&&p.x>=Math.min(a.x,b.x)-1e-9&&p.x<=Math.max(a.x,b.x)+1e-9&&p.y>=Math.min(a.y,b.y)-1e-9&&p.y<=Math.max(a.y,b.y)+1e-9;
 }
 function segmentsIntersect(a,b,c,d){
  const abC=orientation(a,b,c),abD=orientation(a,b,d),cdA=orientation(c,d,a),cdB=orientation(c,d,b);
  if(((abC>0&&abD<0)||(abC<0&&abD>0))&&((cdA>0&&cdB<0)||(cdA<0&&cdB>0)))return true;
  return (Math.abs(abC)<=1e-9&&pointOnSegment(c,a,b))||(Math.abs(abD)<=1e-9&&pointOnSegment(d,a,b))||(Math.abs(cdA)<=1e-9&&pointOnSegment(a,c,d))||(Math.abs(cdB)<=1e-9&&pointOnSegment(b,c,d));
 }
 function lineIntersectsRect(a,b,r){
  if(pointInEdges(a,r)||pointInEdges(b,r))return true;
  const tl={x:r.left,y:r.top},tr={x:r.right,y:r.top},br={x:r.right,y:r.bottom},bl={x:r.left,y:r.bottom};
  return segmentsIntersect(a,b,tl,tr)||segmentsIntersect(a,b,tr,br)||segmentsIntersect(a,b,br,bl)||segmentsIntersect(a,b,bl,tl);
 }
 function controlBoundsOverlap(points,r){
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return Math.max(...xs)>=r.left&&Math.min(...xs)<=r.right&&Math.max(...ys)>=r.top&&Math.min(...ys)<=r.bottom;
 }
 function pointLineDistance(p,a,b){
  const length=dist(a,b);return length<1e-12?dist(p,a):Math.abs(orientation(a,b,p))/length;
 }
 function cubicIntersectsRect(p0,p1,p2,p3,r,depth=0){
  if(!controlBoundsOverlap([p0,p1,p2,p3],r))return false;
  const chord=dist(p0,p3),polygon=dist(p0,p1)+dist(p1,p2)+dist(p2,p3);
  const flat=Math.max(pointLineDistance(p1,p0,p3),pointLineDistance(p2,p0,p3))<=.25&&polygon-chord<=.25;
  if(depth>=18||flat)return lineIntersectsRect(p0,p3,r);
  const p01=mix(p0,p1,.5),p12=mix(p1,p2,.5),p23=mix(p2,p3,.5);
  const p012=mix(p01,p12,.5),p123=mix(p12,p23,.5),middle=mix(p012,p123,.5);
  return cubicIntersectsRect(p0,p01,p012,middle,r,depth+1)||cubicIntersectsRect(middle,p123,p23,p3,r,depth+1);
 }
 function pathIntersectsRect(path,r){
  const ns=path&&Array.isArray(path.nodes)?path.nodes:[];
  if(ns.length===1)return pointInEdges(ns[0],r);
  for(let i=0;i<segmentCount(path);i++){
   const a=ns[i],b=ns[(i+1)%ns.length];
   if(cubicIntersectsRect(a,a.out,b.in,b,r))return true;
  }
  return false;
 }
 function pathsInRect(paths,rect){
  const r=rectEdges(rect);return (paths||[]).filter(path=>pathIntersectsRect(path,r)).map(path=>path.id);
 }
 function nodesInRect(paths,rect){
  const r=rectEdges(rect),found=[];
  for(const path of paths||[])(path.nodes||[]).forEach((n,index)=>{if(pointInEdges(n,r))found.push({pathId:path.id,index});});
  return found;
 }
 function segmentRange(path,start,end,alternate=false){
  const count=segmentCount(path);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<0||start>=count||end>=count)return [];
  const low=Math.min(start,end),high=Math.max(start,end),range=[];
  if(path.closed&&alternate&&start!==end){
   for(let i=high;i<count;i++)range.push(i);
   for(let i=0;i<=low;i++)range.push(i);
  }else for(let i=low;i<=high;i++)range.push(i);
  return range;
 }
 function segmentD(path,index){
  if(!Number.isInteger(index)||index<0||index>=segmentCount(path))return '';
  const a=path.nodes[index],b=path.nodes[(index+1)%path.nodes.length];
  return `M ${formatPoint(a)} C ${formatPoint(a.out)} ${formatPoint(b.in)} ${formatPoint(b)}`;
 }
 function pathD(path){
  if(!path.nodes.length)return '';
  const ns=path.nodes;
  let s=`M ${formatPoint(ns[0])}`;
  for(let i=0;i<ns.length-1+(path.closed?1:0);i++){const a=ns[i],b=ns[(i+1)%ns.length];s+=` C ${formatPoint(a.out)} ${formatPoint(b.in)} ${formatPoint(b)}`;}
  return s+(path.closed?' Z':'');
 }
 function nearest(path,p){
  let best={distance:Infinity,index:0,t:0};
  for(let i=0;i<path.nodes.length-1+(path.closed?1:0);i++){
   const a=path.nodes[i],b=path.nodes[(i+1)%path.nodes.length];let tBest=0,dBest=Infinity;
   for(let j=0;j<=80;j++){const t=j/80,d=dist(at(a,b,t),p);if(d<dBest){tBest=t;dBest=d;}}
   let lo=Math.max(0,tBest-1/80),hi=Math.min(1,tBest+1/80);
   for(let j=0;j<25;j++){const u=lo+(hi-lo)/3,v=hi-(hi-lo)/3;if(dist(at(a,b,u),p)<dist(at(a,b,v),p))hi=v;else lo=u;}
   const t=(lo+hi)/2,d=dist(at(a,b,t),p);if(d<best.distance)best={distance:d,index:i,t};
  }return best;
 }
 function nearestNodeAlignment(sources,targets,radius,direction=null){
  if(!(radius>0)||!Number.isFinite(radius)||!sources.length||!targets.length)return null;
  // Local buckets avoid comparing every moving anchor with every stationary anchor.
  const cells=new Map(),cell=v=>Math.floor(v/radius),key=(x,y)=>`${x},${y}`;
  for(const target of targets){const k=key(cell(target.x),cell(target.y));if(!cells.has(k))cells.set(k,[]);cells.get(k).push(target);}
  let best=null;
  for(const source of sources){
   const x=cell(source.x),y=cell(source.y);
   for(let i=x-1;i<=x+1;i++)for(let j=y-1;j<=y+1;j++)for(const target of cells.get(key(i,j))||[]){
    const dx=target.x-source.x,dy=target.y-source.y,distance=Math.hypot(dx,dy);
    if(distance>radius||best&&distance>=best.distance)continue;
    // Do not pull a Shift-constrained move off its original direction.
    if(direction&&Math.abs(dx*direction.y-dy*direction.x)>1e-7)continue;
    best={source,target,dx,dy,distance};
   }
  }
  return best;
 }
 function nearestAxisAlignment(sources,axis,radius,direction=null){
  if(!(radius>0)||!Number.isFinite(radius)||!sources.length||![axis?.a,axis?.b].every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)))return null;
  const vx=axis.b.x-axis.a.x,vy=axis.b.y-axis.a.y,length=Math.hypot(vx,vy);if(length<=1e-9)return null;
  const nx=-vy/length,ny=vx/length,dl=direction?Math.hypot(direction.x,direction.y):1;
  if(!Number.isFinite(dl)||dl<=1e-9)return null;
  const ux=direction?direction.x/dl:0,uy=direction?direction.y/dl:0,denominator=ux*nx+uy*ny;
  let best=null;
  for(const source of sources){
   const offset=(source.x-axis.a.x)*nx+(source.y-axis.a.y)*ny;let dx=-offset*nx,dy=-offset*ny;
   if(direction){
    // A constrained drag can only reach the axis along its original direction.
    if(Math.abs(denominator)<1e-9){if(Math.abs(offset)>1e-7)continue;dx=0;dy=0;}
    else{const step=-offset/denominator;dx=ux*step;dy=uy*step;}
   }
   const distance=Math.hypot(dx,dy);if(!Number.isFinite(distance)||distance>radius||best&&distance>=best.distance)continue;
   best={source,target:{x:source.x+dx,y:source.y+dy},dx,dy,distance,kind:'axis'};
  }
  return best;
 }
 function linearSegment(a,b){
  const length=dist(a,b);if(!Number.isFinite(length)||length<=1e-9)return null;
  const ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
  for(const p of [a.out,b.in]){const x=p.x-a.x,y=p.y-a.y,t=x*ux+y*uy;if(Math.abs(x*uy-y*ux)>1e-7||t< -1e-7||t>length+1e-7)return null;}
  return {a,b,length,ux,uy};
 }
 function alignmentSegments(paths){
  const segments=[];
  for(const path of paths)for(let index=0;index<segmentCount(path);index++){
   const a=path.nodes[index],b=path.nodes[(index+1)%path.nodes.length],xs=[a.x,a.out.x,b.in.x,b.x],ys=[a.y,a.out.y,b.in.y,b.y];
   segments.push({pathId:path.id,index,a,b,bounds:{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)},straight:linearSegment(a,b)});
  }
  return segments;
 }
 function polynomialAt(c,t){let value=0;for(let i=c.length-1;i>=0;i--)value=value*t+c[i];return value;}
 // Derivative roots split a polynomial into monotone intervals, including tangent roots.
 function unitPolynomialRoots(values){
  const scale=Math.max(...values.map(Math.abs));if(!Number.isFinite(scale)||!scale)return [];
  const c=values.map(v=>v/scale);while(c.length>1&&Math.abs(c.at(-1))<1e-14)c.pop();
  if(c.length===1)return [];
  if(c.length===2){const t=-c[0]/c[1];return t>=0&&t<=1?[t]:[];}
  const cuts=[0,...unitPolynomialRoots(c.slice(1).map((v,i)=>v*(i+1))),1],roots=[];
  for(const t of cuts)if(Math.abs(polynomialAt(c,t))<=1e-12)roots.push(t);
  for(let i=1;i<cuts.length;i++){
   let lo=cuts[i-1],hi=cuts[i],left=polynomialAt(c,lo),right=polynomialAt(c,hi);if(left*right>=0)continue;
   for(let j=0;j<60;j++){const mid=(lo+hi)/2,value=polynomialAt(c,mid);if(!value){lo=hi=mid;break;}if(left*value<=0){hi=mid;right=value;}else{lo=mid;left=value;}}
   roots.push((lo+hi)/2);
  }
  return roots.sort((a,b)=>a-b).filter((t,i,all)=>!i||t-all[i-1]>1e-12);
 }
 function cubicCoefficients(p0,p1,p2,p3,origin){const a=p1-p0,b=p2-p0;return [p0-origin,3*a,3*(b-2*a),p3-p0+3*(a-b)];}
 const alignmentIndexes=new WeakMap();
 // Reference segments stay fixed for a drag; index their full control bounds once.
 function* nearbyAlignmentSegments(segments,box,radius){
  if(segments.length<64){yield* segments;return;}
  let root=alignmentIndexes.get(segments);
  if(!root){
   const build=items=>{
    const bounds={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
    for(const {bounds:b} of items){bounds.minX=Math.min(bounds.minX,b.minX);bounds.minY=Math.min(bounds.minY,b.minY);bounds.maxX=Math.max(bounds.maxX,b.maxX);bounds.maxY=Math.max(bounds.maxY,b.maxY);}
    if(items.length<=8)return {bounds,items};
    const axis=bounds.maxX-bounds.minX>=bounds.maxY-bounds.minY?'X':'Y';items.sort((a,b)=>(a.bounds['min'+axis]+a.bounds['max'+axis])-(b.bounds['min'+axis]+b.bounds['max'+axis]));const mid=Math.floor(items.length/2);
    return {bounds,left:build(items.slice(0,mid)),right:build(items.slice(mid))};
   };
   root=build(segments.slice());alignmentIndexes.set(segments,root);
  }
  const stack=[root];while(stack.length){const branch=stack.pop(),b=branch.bounds;if(box.maxX+radius<b.minX||b.maxX+radius<box.minX||box.maxY+radius<b.minY||b.maxY+radius<box.minY)continue;if(branch.items)yield* branch.items;else stack.push(branch.right,branch.left);}
 }
 function nearestCurveAlignment(sources,segments,radius,direction=null){
  if(!(radius>0)||!Number.isFinite(radius)||!sources.length||!segments.length)return null;
  const length=direction?Math.hypot(direction.x,direction.y):1;if(!Number.isFinite(length)||length<=1e-9)return null;
  const ux=direction?direction.x/length:0,uy=direction?direction.y/length:0;let best=null;
  for(const source of sources)for(const segment of nearbyAlignmentSegments(segments,{minX:source.x,maxX:source.x,minY:source.y,maxY:source.y},radius)){
   const {a,b,bounds}=segment,r=best?Math.min(radius,best.distance):radius;
   if(source.x<bounds.minX-r||source.x>bounds.maxX+r||source.y<bounds.minY-r||source.y>bounds.maxY+r)continue;
   const x=cubicCoefficients(a.x,a.out.x,b.in.x,b.x,source.x),y=cubicCoefficients(a.y,a.out.y,b.in.y,b.y,source.y),stationary=Array(6).fill(0);
   for(let i=0;i<4;i++)for(let j=1;j<4;j++)stationary[i+j-1]+=j*(x[i]*x[j]+y[i]*y[j]);
   const crossing=direction?x.map((v,i)=>v*uy-y[i]*ux):null;
   const roots=crossing&&Math.max(...crossing.map(Math.abs))>1e-7?unitPolynomialRoots(crossing):unitPolynomialRoots(stationary);
   for(const t of [0,...roots,1]){
    const target=t===0?point(a):t===1?point(b):at(a,b,t),dx=target.x-source.x,dy=target.y-source.y,distance=Math.hypot(dx,dy);
    if(!Number.isFinite(distance)||distance>radius||best&&distance>=best.distance||direction&&Math.abs(dx*uy-dy*ux)>1e-7)continue;
    best={source,target,dx,dy,distance,kind:'curve',pathId:segment.pathId,index:segment.index,t};
   }
  }
  return best;
 }
 function nearestSegmentRelation(sources,targets,zoom,accept=null){
  if(!(zoom>0)||!Number.isFinite(zoom))return null;
  const reach=24/zoom,nearOverlap=.5/zoom;let best=null;
  const choose=hit=>{if(accept&&!accept(hit))return;if(!best||hit.kind==='overlap'&&best.kind!=='overlap'||hit.kind===best.kind&&hit.distance<best.distance)best=hit;};
  for(const source of sources)for(const target of nearbyAlignmentSegments(targets,source.bounds,reach)){
   if(source.pathId===target.pathId)continue;
   const s=source.bounds,t=target.bounds;if(s.maxX+reach<t.minX||t.maxX+reach<s.minX||s.maxY+reach<t.minY||t.maxY+reach<s.minY)continue;
   const a=source.straight,b=target.straight;
   if(a&&b){
    const cross=a.ux*b.uy-a.uy*b.ux,dot=a.ux*b.ux+a.uy*b.uy;if(Math.abs(cross)>Math.sin(Math.PI/360)||Math.min(a.length,b.length)*zoom<2)continue;
    const rx=b.a.x-a.a.x,ry=b.a.y-a.a.y,start=rx*a.ux+ry*a.uy,end=start+b.length*dot,lo=Math.max(0,Math.min(start,end)),hi=Math.min(a.length,Math.max(start,end));
    if(hi-lo<=1e-7||hi-lo<Math.min(6/zoom,Math.min(a.length,b.length)*.25))continue;
    const gap=rx*(-a.uy)+ry*a.ux,atGap=value=>gap+(value-start)*cross/dot,distance=Math.max(Math.abs(atGap(lo)),Math.abs(atGap(hi)));if(distance>reach)continue;
    const overlap=Math.abs(cross)<=1e-9&&distance<=nearOverlap,position=value=>({x:a.a.x+a.ux*value,y:a.a.y+a.uy*value}),sourceRange=[position(lo),position(hi)],targetRange=sourceRange.map((p,i)=>({x:p.x-a.uy*atGap(i?hi:lo),y:p.y+a.ux*atGap(i?hi:lo)}));
    choose({kind:overlap?'overlap':'parallel',exact:Math.abs(cross)<=1e-9&&(!overlap||distance<=1e-7),source,target,sourceRange,targetRange,distance,position:position((lo+hi)/2)});
   }else{
    const p=[source.a,source.a.out,source.b.in,source.b],q=[target.a,target.a.out,target.b.in,target.b],forward=Math.max(...p.map((n,i)=>dist(n,q[i]))),reverse=Math.max(...p.map((n,i)=>dist(n,q[3-i]))),distance=Math.min(forward,reverse);
    // Equal/reversed control polygons bound the entire cubic's coincidence, not just samples.
    if(distance<=nearOverlap&&Math.max(s.maxX-s.minX,s.maxY-s.minY)*zoom>=2)choose({kind:'overlap',exact:distance<=1e-7,curved:true,source,target,distance,position:at(source.a,source.b,.5)});
   }
  }
  return best;
 }
 const api={node,point,mix,dist,at,reflectPoint,reflectPath,split,move,handle,setMode,smoothNodes,append,extend,mergePaths,breakPath,joinEndpoints,connectCoincidentEndpoints,segmentCount,toggleSegment,segmentLength,pathLength,polylineLength,millimetersPerPixel,measureLength,shapeBounds,createShape,normalizeRect,pathBounds,contentBounds,pathsInRect,nodesInRect,segmentRange,segmentD,pathD,nearest,nearestNodeAlignment,nearestAxisAlignment,alignmentSegments,nearestCurveAlignment,nearestSegmentRelation};
 if(typeof module!=='undefined')module.exports=api;else root.CurveGeometry=api;
})(typeof window!=='undefined'?window:globalThis);
