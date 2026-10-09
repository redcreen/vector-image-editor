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
 function split(path,i,t){
  const a=path.nodes[i],b=path.nodes[(i+1)%path.nodes.length];
  const p=mix(a,a.out,t),q=mix(a.out,b.in,t),r=mix(b.in,b,t),s=mix(p,q,t),v=mix(q,r,t),m=mix(s,v,t);
  const n=node(m.x,m.y);n.in=s;n.out=v;n.mode='smooth';a.out=p;b.in=r;
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
 function mergePaths(paths,activeId=paths?.[0]?.id){
  if(!Array.isArray(paths)||paths.length<2)throw new RangeError('请至少选择两条开放曲线');
  if(paths.some(p=>!p||p.closed||!Array.isArray(p.nodes)||p.nodes.length<2))throw new RangeError('只能合并至少含两个节点的开放曲线，请先打开闭合曲线');
  if(new Set(paths.map(p=>p.id)).size!==paths.length)throw new RangeError('请选择不同的曲线');
  const primary=paths.find(p=>p.id===activeId);if(!primary)throw new RangeError('当前曲线不在所选曲线中');
  // At most one coincident node disappears at each join.
  if(paths.reduce((sum,p)=>sum+p.nodes.length,0)>10000+paths.length-1)throw new RangeError('合并后节点不能超过 10000 个');
  const merged=clone(primary),remaining=paths.filter(p=>p!==primary).map(p=>clone(p.nodes));
  const reverse=nodes=>nodes.reverse().map(n=>({...n,in:n.out,out:n.in}));
  function join(a,b){
   const end=a.at(-1),start=b[0];
   if(end.x===start.x&&end.y===start.y){
    end.out=point(start.out);
    const ix=end.in.x-end.x,iy=end.in.y-end.y,ox=end.out.x-end.x,oy=end.out.y-end.y;
    const incoming=Math.hypot(ix,iy),outgoing=Math.hypot(ox,oy);
    const aligned=incoming>1e-9&&outgoing>1e-9&&ix*ox+iy*oy<0&&Math.abs(ix*oy-iy*ox)<=1e-6*incoming*outgoing;
    end.mode=aligned?(Math.abs(incoming-outgoing)<=1e-6*Math.max(1,incoming,outgoing)?'symmetric':'smooth'):'cusp';
    return a.concat(b.slice(1));
   }
   // Only the unused endpoint handles change; existing segments retain their shape.
   end.out=point(end);end.mode='cusp';start.in=point(start);start.mode='cusp';
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
 function segmentCount(path){
  const count=path&&Array.isArray(path.nodes)?path.nodes.length:0;
  return count<2?0:count-(path.closed?0:1);
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
 const api={node,point,mix,dist,at,reflectPoint,reflectPath,split,move,handle,setMode,smoothNodes,append,mergePaths,segmentCount,segmentLength,pathLength,polylineLength,millimetersPerPixel,measureLength,normalizeRect,pathBounds,contentBounds,pathsInRect,nodesInRect,segmentRange,segmentD,pathD,nearest};
 if(typeof module!=='undefined')module.exports=api;else root.CurveGeometry=api;
})(typeof window!=='undefined'?window:globalThis);
