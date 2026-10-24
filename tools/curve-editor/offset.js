(function(root){
 'use strict';
 const common=typeof module!=='undefined'&&module.exports;
 const G=common?require('./geometry.js'):root.CurveGeometry;
 const F=common?require('./offset-fit.js'):root.CurveOffsetFit;
 // Locally vendored Clipper 6.4.2.2: https://github.com/junmer/clipper-lib
 // Its Boost license and embedded JSBN license are in vendor/.
 const C=common?require('./vendor/clipper.js'):root.ClipperLib;
 const JOIN=.01,MAX=10000,LIMIT=1e7,SCALE=1e6;
 const clone=v=>Array.isArray(v)?v.map(clone):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;
 const pt=p=>({x:p.x,y:p.y}),sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
 const add=(a,b,s=1)=>({x:a.x+b.x*s,y:a.y+b.y*s}),dot=(a,b)=>a.x*b.x+a.y*b.y;
 const cross=(a,b)=>a.x*b.y-a.y*b.x,unit=v=>{const d=Math.hypot(v.x,v.y);return d>1e-12?{x:v.x/d,y:v.y/d}:null;};
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const validPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=LIMIT&&Math.abs(p.y)<=LIMIT;
 function validatePath(p){
  if(!p||!Array.isArray(p.nodes)||p.nodes.length<2)throw new RangeError('曲线至少需要两个节点');
  if(p.nodes.length>MAX)throw new RangeError('曲线节点不能超过 10000 个');
  if(p.nodes.some(n=>!validPoint(n)||!validPoint(n.in)||!validPoint(n.out)))throw new RangeError('曲线坐标无效或超出范围');
 }
 function reverse(ns){return ns.reverse().map(n=>({...n,in:n.out,out:n.in}));}
 function mergeNodes(a,b){
  const end=a.at(-1),start=b[0],dx=end.x-start.x,dy=end.y-start.y;
  end.out={x:start.out.x+dx,y:start.out.y+dy};end.mode='cusp';return a.concat(b.slice(1));
 }
 // Only endpoints strictly less than 0.01 px apart are joined. Intermediate
 // crossings are deliberately not junctions; the user's original objects survive.
 function prepareContours(paths){
  if(!Array.isArray(paths)||!paths.length)throw new RangeError('请先选择曲线');
  paths.forEach(validatePath);
  const copies=paths.map(path=>({path:clone(path),sourceIds:[path.id]})),open=copies.filter(c=>!c.path.closed);
  const endpoints=open.flatMap((c,i)=>[0,1].map(side=>({i,side,p:side?c.path.nodes.at(-1):c.path.nodes[0]})));
  const links=new Map();
  for(let i=0;i<endpoints.length;i++)for(let j=i+1;j<endpoints.length;j++)if(distance(endpoints[i].p,endpoints[j].p)<JOIN-1e-9){
   if(links.has(i)||links.has(j))throw new RangeError('所选曲线端点存在分叉，无法确定连接顺序');links.set(i,j);links.set(j,i);
  }
  const result=[],used=new Set();
  for(const c of copies){
   if(c.path.closed){result.push(c);continue;}
   const seed=open.indexOf(c);if(used.has(seed))continue;
   // Find an unconnected end, if present, so reversed pieces form one full chain.
   let first=seed,side=0,walk=new Set();
   while(!walk.has(first)){walk.add(first);const link=links.get(first*2+side);if(link===undefined)break;first=Math.floor(link/2);side=1-link%2;}
   if(walk.has(first)&&links.has(first*2+side)){first=seed;side=0;}
   const base=clone(c.path);let ns=[],ids=[],index=first,entry=side,closed=false;
   while(!used.has(index)){
    used.add(index);const item=open[index],nodes=entry?reverse(clone(item.path.nodes)):clone(item.path.nodes);
    ns=ns.length?mergeNodes(ns,nodes):nodes;ids.push(...item.sourceIds);
    const link=links.get(index*2+(1-entry));if(link===undefined)break;
    index=Math.floor(link/2);entry=link%2;if(used.has(index)){closed=true;break;}
   }
   if(closed){const last=ns.pop(),head=ns[0];if(!head)throw new RangeError('曲线退化，无法偏移');head.in={x:last.in.x+head.x-last.x,y:last.in.y+head.y-last.y};head.mode='cusp';}
   if(ns.length<2)throw new RangeError('曲线退化，端点重合');
   if(ns.length>MAX)throw new RangeError('连接后的曲线节点不能超过 10000 个');
   base.nodes=ns;base.closed=closed;result.push({path:base,sourceIds:ids});
  }
  return result;
 }
 function physicalDistancePixels(value,unitName,calibration){
  if(!Number.isFinite(value)||value<=0||value>LIMIT)throw new RangeError('偏移距离必须大于 0 且不超过 10000000');
  if(!['px','mm','cm'].includes(unitName))throw new RangeError('偏移单位仅支持 px、mm 或 cm');
  let result=value;
  if(unitName!=='px'){const scale=G.millimetersPerPixel(calibration);if(scale===null)throw new RangeError('请先标定实际尺寸，再使用 mm 或 cm');result=value*(unitName==='cm'?10:1)/scale;}
  if(!Number.isFinite(result)||result<=0||result>LIMIT)throw new RangeError('换算后的偏移距离过大');return result;
 }
 function lineDistance(p,a,b){const d=sub(b,a),l=dot(d,d);if(l<1e-24)return distance(p,a);const t=Math.max(0,Math.min(1,dot(sub(p,a),d)/l));return distance(p,add(a,d,t));}
 function flatten(path,tolerance,amount){
  const points=[pt(path.nodes[0])],angleLimit=Math.min(.04,Math.sqrt(tolerance/Math.max(amount,1)));
  function segment(a,b,c,d,depth){
   const chord=sub(d,a),u=unit(sub(b,a))||unit(sub(c,a))||unit(chord),v=unit(sub(d,c))||unit(sub(d,b))||unit(chord);
   const flat=Math.max(lineDistance(b,a,d),lineDistance(c,a,d));
   const angle=u&&v?Math.acos(Math.max(-1,Math.min(1,dot(u,v)))):0;
   if(flat<=tolerance/8&&angle<=angleLimit){if(distance(points.at(-1),d)>1e-9)points.push(pt(d));}
   else{
    if(depth>=24)throw new RangeError('曲线过于复杂，请简化节点或增大偏移距离');
    const ab=G.mix(a,b,.5),bc=G.mix(b,c,.5),cd=G.mix(c,d,.5),abc=G.mix(ab,bc,.5),bcd=G.mix(bc,cd,.5),m=G.mix(abc,bcd,.5);
    segment(a,ab,abc,m,depth+1);segment(m,bcd,cd,d,depth+1);
   }
   if(points.length>50000)throw new RangeError('曲线过于复杂，请减少节点或分批偏移');
  }
  for(let i=0;i<G.segmentCount(path);i++){const a=path.nodes[i],b=path.nodes[(i+1)%path.nodes.length];segment(a,a.out,b.in,b,0);}
  if(path.closed&&distance(points[0],points.at(-1))<1e-7)points.pop();
  if(points.length<(path.closed?3:2))throw new RangeError('曲线退化或节点重合，无法偏移');return points;
 }
 // Local coordinates keep small contours stable far from the world origin.
 function area(points){let a=0;for(let i=1;i<points.length-1;i++)a+=cross(sub(points[i],points[0]),sub(points[i+1],points[0]));return a/2;}
 function exactConvexMiters(loop,source,amount,tolerance,winding){
  const adjusted=loop.map(pt),count=source.nodes.length;
  for(let i=0;i<count;i++){
   const p=source.nodes[i],previous=source.nodes[(i+count-1)%count],next=source.nodes[(i+1)%count];
   const before=unit(sub(p,p.in))||unit(sub(p,previous.out))||unit(sub(p,previous));
   const after=unit(sub(p.out,p))||unit(sub(next.in,p))||unit(sub(next,p));
   if(!before||!after)continue;const den=cross(before,after);
   if(amount*den<=1e-8)continue;
   const a=add(p,{x:before.y,y:-before.x},amount),b=add(p,{x:after.y,y:-after.x},amount);
   const miter=add(a,before,cross(sub(b,a),after)/den);
   if(!validPoint(miter)||distance(miter,p)>4*Math.abs(amount))continue;
   let nearest=-1,best=Math.max(64/SCALE,tolerance*8);
   for(let j=0;j<adjusted.length;j++){const d=distance(adjusted[j],miter);if(d<best){best=d;nearest=j;}}
   if(nearest>=0){
    // An offset may hide a source corner. Only correct the corresponding live
    // corner, whose two boundary directions still match its source tangents.
    const incoming=unit(sub(loop[nearest],loop[(nearest+loop.length-1)%loop.length])),outgoing=unit(sub(loop[(nearest+1)%loop.length],loop[nearest]));
    const expectedIn=winding>0?before:{x:-after.x,y:-after.y},expectedOut=winding>0?after:{x:-before.x,y:-before.y};
    if(incoming&&outgoing&&dot(incoming,outgoing)<Math.cos(.02)&&dot(incoming,expectedIn)>Math.cos(.04)&&dot(outgoing,expectedOut)>Math.cos(.04))adjusted[nearest]=miter;
   }
  }
  return selfIntersects(adjusted,true)?loop:adjusted;
 }
 function selfIntersects(points,closed){
  const count=points.length-(closed?0:1),edges=Array.from({length:count},(_,i)=>{const a=points[i],b=points[(i+1)%points.length];return {i,a,b,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};}).sort((a,b)=>a.minX-b.minX);
  let checks=0;
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length&&edges[j].minX<=edges[i].maxX+1e-9;j++){
   const a=edges[i],b=edges[j];if(Math.abs(a.i-b.i)===1||(closed&&Math.abs(a.i-b.i)===count-1)||a.maxY<b.minY-1e-9||b.maxY<a.minY-1e-9)continue;
   if(++checks>3000000)throw new RangeError('曲线交叉过于复杂，请分批处理');
   const d=sub(a.b,a.a),e=sub(b.b,b.a),q=sub(b.a,a.a),den=cross(d,e);
   if(Math.abs(den)>1e-12){const t=cross(q,e)/den,u=cross(q,d)/den;if(t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9)return true;}
   else if(lineDistance(b.a,a.a,a.b)<1e-8||lineDistance(b.b,a.a,a.b)<1e-8||lineDistance(a.a,b.a,b.b)<1e-8)return true;
  }return false;
 }
 function openOffset(points,amount,tolerance,source){
  const dirs=points.slice(1).map((p,i)=>unit(sub(p,points[i]))),normal=d=>({x:d.y,y:-d.x});
  const output=[add(points[0],normal(dirs[0]),amount)];
  for(let i=1;i<points.length-1;i++){
   const before=dirs[i-1],after=dirs[i],a=add(points[i],normal(before),amount),b=add(points[i],normal(after),amount),den=cross(before,after);
   if(dot(before,after)<-.999999)throw new RangeError('开放曲线存在折返，无法确定偏移方向');
   if(Math.abs(den)<1e-10){output.push(a);continue;}
   const p=add(a,before,cross(sub(b,a),after)/den);
   // A finite miter protects nearly reversing corners from unbounded spikes.
   if(distance(p,points[i])>Math.abs(amount)*4){output.push(a,b);}else output.push(p);
  }
  output.push(add(points.at(-1),normal(dirs.at(-1)),amount));
  // Polygon sampling must not tilt the end normals of a curved open path.
  const first=source.nodes[0],second=source.nodes[1],last=source.nodes.at(-1),previous=source.nodes.at(-2);
  const firstDir=unit(sub(first.out,first))||unit(sub(second.in,first))||dirs[0];
  const lastDir=unit(sub(last,last.in))||unit(sub(last,previous.out))||dirs.at(-1);
  output[0]=add(first,normal(firstDir),amount);output[output.length-1]=add(last,normal(lastDir),amount);
  for(let i=0;i<output.length;i++)if(!validPoint(output[i]))throw new RangeError('偏移结果坐标超出范围');
  if(selfIntersects(output,false))throw new RangeError('开放曲线偏移后发生自交，请减小距离或拆分曲线');
  // An offset passing a curvature center may reverse a sampled segment.
  if(output.length===points.length)for(let i=0;i<dirs.length;i++)if(dot(sub(output[i+1],output[i]),dirs[i])<-tolerance)throw new RangeError('偏移距离过大，开放曲线局部折返');
  return output;
 }
 // Least-squares cubic fitting with fixed endpoint tangents, recursively split
 // where sampled deviation exceeds tolerance. Corners remain cusp nodes.
 function fitPolyline(points,closed,tolerance){
  const n=points.length,corner=[];
  for(let i=0;i<n;i++){
   if(!closed&&(i===0||i===n-1)){corner.push(i);continue;}
   const a=unit(sub(points[i],points[(i+n-1)%n])),b=unit(sub(points[(i+1)%n],points[i]));
   if(!a||!b||dot(a,b)<Math.cos(.22))corner.push(i);
  }
  if(closed&&!corner.length){for(let i=0;i<4;i++)corner.push(Math.floor(i*n/4));}
  if(closed&&corner.length===1)corner.push((corner[0]+Math.floor(n/2))%n);
  corner.sort((a,b)=>a-b);
  const curves=[];
  function tangent(index,forward,hard){
   const p=points[(index+n)%n];
   if(hard)return unit(forward?sub(points[(index+1)%n],p):sub(p,points[(index+n-1)%n]));
   return unit(sub(points[(index+1)%n],points[(index+n-1)%n]));
  }
  function fit(ps,t0,t1,depth=0,tryOnly=false){
   const start=ps[0],end=ps.at(-1),chord=distance(start,end);
   const accept=curve=>{curve.samples=ps;curve.t0=t0;curve.t1=t1;curves.push(curve);return true;};
   if(ps.length===2)return accept([start,start,end,end]);
   const ts=[0];for(let i=1;i<ps.length;i++)ts.push(ts.at(-1)+distance(ps[i-1],ps[i]));
   const total=ts.at(-1);for(let i=1;i<ts.length;i++)ts[i]/=total;
   let best=null;
   // Chord length is only an initial guess for cubic parameters. Refine each
   // sample's closest parameter before splitting: a parameter mismatch alone
   // must not turn an otherwise accurate smooth span into many short cubics.
   for(let iteration=0;iteration<20;iteration++){
    let aa=0,ab=0,bb=0,ax=0,bx=0;
    for(let i=1;i<ps.length-1;i++){
     const t=ts[i],u=1-t,b0=u*u*u,b1=3*u*u*t,b2=3*u*t*t,b3=t*t*t;
     const a={x:t0.x*b1,y:t0.y*b1},b={x:-t1.x*b2,y:-t1.y*b2};
     const residual={x:ps[i].x-start.x*(b0+b1)-end.x*(b2+b3),y:ps[i].y-start.y*(b0+b1)-end.y*(b2+b3)};
     aa+=dot(a,a);ab+=dot(a,b);bb+=dot(b,b);ax+=dot(a,residual);bx+=dot(b,residual);
    }
    const det=aa*bb-ab*ab;let l0=det>1e-18?(ax*bb-bx*ab)/det:chord/3,l1=det>1e-18?(aa*bx-ab*ax)/det:chord/3;
    if(l0<0||l1<0||l0>total*2||l1>total*2){l0=chord/3;l1=chord/3;}
    const c1=add(start,t0,l0),c2=add(end,t1,-l1),a={...start,out:c1},b={...end,in:c2};
    let error=0,split=Math.floor(ps.length/2);
    for(let i=1;i<ps.length-1;i++){const d=distance(G.at(a,b,ts[i]),ps[i]);if(d>error){error=d;split=i;}}
    // Also check between source vertices, protecting sparsely sampled corners.
    for(let i=0;i<ps.length-1;i++){const q=G.at(a,b,(ts[i]+ts[i+1])/2),d=lineDistance(q,ps[i],ps[i+1]);if(d>error){error=d;split=Math.max(1,Math.min(ps.length-2,i+1));}}
    if(!best||error<best.error)best={c1,c2,error,split};
    if(error<=tolerance*.7)return accept([start,c1,c2,end]);
    const next=ts.slice();let change=0;
    for(let i=1;i<ps.length-1;i++){
     const t=ts[i],u=1-t,q=G.at(a,b,t),residual=sub(q,ps[i]);
     const velocity={x:3*u*u*(c1.x-start.x)+6*u*t*(c2.x-c1.x)+3*t*t*(end.x-c2.x),y:3*u*u*(c1.y-start.y)+6*u*t*(c2.y-c1.y)+3*t*t*(end.y-c2.y)};
     const acceleration={x:6*u*(c2.x-2*c1.x+start.x)+6*t*(end.x-2*c2.x+c1.x),y:6*u*(c2.y-2*c1.y+start.y)+6*t*(end.y-2*c2.y+c1.y)};
     const denominator=dot(velocity,velocity)+dot(residual,acceleration);
     if(Math.abs(denominator)>1e-18)next[i]=t-dot(residual,velocity)/denominator;
     change=Math.max(change,Math.abs(next[i]-t));
    }
    if(next.some((t,i)=>!Number.isFinite(t)||i>0&&t<=next[i-1])||change<1e-10)break;
    for(let i=1;i<ts.length-1;i++)ts[i]=next[i];
   }
   if(tryOnly)return false;
   const split=best.split;
   if(depth>24||curves.length>MAX)throw new RangeError('拟合后节点过多，请简化曲线');
   const mid=unit(sub(ps[split+1],ps[split-1]))||unit(sub(end,start));
   fit(ps.slice(0,split+1),t0,mid,depth+1);fit(ps.slice(split),mid,t1,depth+1);
  }
  for(let k=0;k<corner.length-(closed?0:1);k++){
   const start=corner[k],end=corner[(k+1)%corner.length],indices=[];let i=start;indices.push(i);
   do{i=(i+1)%n;indices.push(i);}while(i!==end);
   const ps=indices.map(i=>points[i]);
   const hardStart=(!closed&&start===0)||(()=>{const a=unit(sub(points[start],points[(start+n-1)%n])),b=unit(sub(points[(start+1)%n],points[start]));return a&&b&&dot(a,b)<Math.cos(.22);})();
   const hardEnd=(!closed&&end===n-1)||(()=>{const a=unit(sub(points[end],points[(end+n-1)%n])),b=unit(sub(points[(end+1)%n],points[end]));return a&&b&&dot(a,b)<Math.cos(.22);})();
   const firstCurve=curves.length;
   fit(ps,tangent(start,true,hardStart),tangent(end,false,hardEnd));
   // Recursive splits are provisional. Refit neighboring spans against their
   // original samples, never against an earlier approximation, and never cross
   // a corner boundary. This removes redundant anchors without relaxing error.
   for(let j=firstCurve;j<curves.length-1;j++){
    const a=curves[j],b=curves[j+1];
    if(fit(a.samples.concat(b.samples.slice(1)),a.t0,b.t1,0,true)){
     const merged=curves.pop();curves.splice(j,2,merged);j=Math.max(firstCurve-1,j-2);
    }
   }
  }
  const nodes=[];
  for(const curve of curves){if(!nodes.length)nodes.push(G.node(curve[0].x,curve[0].y));nodes.at(-1).out=pt(curve[1]);const end=G.node(curve[3].x,curve[3].y);end.in=pt(curve[2]);nodes.push(end);}
  if(closed){nodes[0].in=nodes.pop().in;}
  for(const node of nodes){const a=unit(sub(node,node.in)),b=unit(sub(node.out,node));if(a&&b&&dot(a,b)>.99999)node.mode='smooth';}
  if(nodes.length>MAX)throw new RangeError('偏移后的节点不能超过 10000 个');return nodes;
 }
 function closedOffsetLoops(points,amount,tolerance){
  const polygon=points.map(p=>({X:Math.round(p.x*SCALE),Y:Math.round(p.y*SCALE)}));
  if(!C.Clipper.Orientation(polygon))polygon.reverse();
  const engine=new C.ClipperOffset(4,tolerance*SCALE/8);engine.AddPath(polygon,C.JoinType.jtMiter,C.EndType.etClosedPolygon);
  const solution=[];engine.Execute(solution,amount*SCALE);
  return solution.map(poly=>poly.map(p=>({x:p.X/SCALE,y:p.Y/SCALE}))).filter(p=>p.length>=3&&Math.abs(area(p))>1e-10);
 }
 function offsetContours(contours,distancePx,options={}){
  physicalDistancePixels(distancePx,'px',null);
  const {closedDirection='outward',openSide='left',tolerancePx=.05}=options;
  if(!['outward','inward'].includes(closedDirection)||!['left','right'].includes(openSide))throw new RangeError('偏移方向无效');
  if(!Number.isFinite(tolerancePx)||tolerancePx<1e-6||tolerancePx>1)throw new RangeError('偏移精度必须在 0.000001 至 1 像素之间');
  if(!Array.isArray(contours)||!contours.length)throw new RangeError('请先选择曲线');
  const result=[];
  for(const contour of contours){
   validatePath(contour.path);const source=contour.path,points=flatten(source,tolerancePx,distancePx);
   if(selfIntersects(points,source.closed))throw new RangeError('原曲线存在自交，请先拆分或整理曲线');
   let loops;
   if(source.closed){
    if(Math.abs(area(points))<1e-10)throw new RangeError('闭合曲线退化，无法确定内外方向');
    loops=closedOffsetLoops(points,distancePx*(closedDirection==='outward'?1:-1),tolerancePx);
    if(!loops.length)throw new RangeError('内收距离过大，所选轮廓已消失');
   }else loops=[openOffset(points,distancePx*(openSide==='left'?1:-1),tolerancePx,source)];
   const signedAmount=distancePx*(source.closed?Math.sign(area(points))*(closedDirection==='outward'?1:-1):(openSide==='left'?1:-1));
   const curved=source.nodes.some((a,i)=>{
    if(!source.closed&&i===source.nodes.length-1)return false;
    const b=source.nodes[(i+1)%source.nodes.length];return Math.max(lineDistance(a.out,a,b),lineDistance(b.in,a,b))>1e-7;
   });
   const sourceFitting=source.closed&&source.nodes.length<=200&&loops.length===1&&curved;
   // Reject invalid/collapsed topology at the normal sampling cost first.
   // Curved boundaries then use a finer reference for the distance certificate.
   if(curved){
    const precisePoints=flatten(source,tolerancePx/32,distancePx);
    loops=source.closed?closedOffsetLoops(precisePoints,distancePx*(closedDirection==='outward'?1:-1),tolerancePx/32):[openOffset(precisePoints,signedAmount,tolerancePx/32,source)];
    if(!loops.length)throw new RangeError('内收距离过大，所选轮廓已消失');
   }
   for(let loop of loops){
    if(source.closed&&curved)loop=exactConvexMiters(loop,source,signedAmount,tolerancePx,Math.sign(area(points)));
    if(loop.some(p=>!validPoint(p)))throw new RangeError('偏移结果坐标超出范围');
    const path=clone(source);
    const certified=nodes=>{
     if(nodes.length>MAX||nodes.some(n=>![n,n.in,n.out].every(validPoint)))return false;
     try{
      const sampled=flatten({...source,nodes},tolerancePx/8,1);
      return !selfIntersects(sampled,!!source.closed)&&F.withinTolerance(sampled,loop,tolerancePx*.97,!!source.closed).accepted;
     }catch{return false;}
    };
    const candidate=sourceFitting&&loops.length===1?F.fitOriginalNodes(source,loop,signedAmount,tolerancePx,certified):null;
    path.nodes=candidate;
    if(!path.nodes)for(const fraction of [1,.5,.25]){
     const nodes=fitPolyline(loop,!!source.closed,tolerancePx*fraction);
     if(certified(nodes)){path.nodes=nodes;break;}
    }
    if(!path.nodes)throw new RangeError('当前精度下无法可靠生成偏移轮廓，请调整允许偏差或拆分曲线');
    path.closed=!!source.closed;
    // v1 readers require at least three closed anchors. Split without moving the
    // fitted curve, so very thin insets keep their topology when opened again.
    if(path.closed&&path.nodes.length===2)G.split(path,0,.5);
    validatePath(path);result.push({path,sourceIds:clone(contour.sourceIds||[source.id])});
   }
  }
  if(result.reduce((n,c)=>n+c.path.nodes.length,0)>MAX)throw new RangeError('本次偏移结果节点合计不能超过 10000 个');
  return result;
 }
 const api={prepareContours,offsetContours,physicalDistancePixels};
 if(common)module.exports=api;else root.CurveOffset=api;
})(typeof window!=='undefined'?window:globalThis);
