(function(root){
'use strict';
// Fit the actual offset boundary using source anchors as the initial knot budget.
// A candidate is accepted only after independent topology and distance checks.
const add=(a,b,s=1)=>({x:a.x+b.x*s,y:a.y+b.y*s}),sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}),dot=(a,b)=>a.x*b.x+a.y*b.y,cross=(a,b)=>a.x*b.y-a.y*b.x,dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),unit=a=>{let l=Math.hypot(a.x,a.y);return {x:a.x/l,y:a.y/l}};
const cubic=(c,t)=>{const u=1-t;return {x:u**3*c[0].x+3*u*u*t*c[1].x+3*u*t*t*c[2].x+t**3*c[3].x,y:u**3*c[0].y+3*u*u*t*c[1].y+3*u*t*t*c[2].y+t**3*c[3].y}};
function velocity(c,t){let u=1-t;return {x:3*u*u*(c[1].x-c[0].x)+6*u*t*(c[2].x-c[1].x)+3*t*t*(c[3].x-c[2].x),y:3*u*u*(c[1].y-c[0].y)+6*u*t*(c[2].y-c[1].y)+3*t*t*(c[3].y-c[2].y)}}
function acceleration(c,t){let u=1-t;return {x:6*u*(c[2].x-2*c[1].x+c[0].x)+6*t*(c[3].x-2*c[2].x+c[1].x),y:6*u*(c[2].y-2*c[1].y+c[0].y)+6*t*(c[3].y-2*c[2].y+c[1].y)}}
function closestT(c,p,t){for(let k=0;k<12;k++){let q=cubic(c,t),v=velocity(c,t),acc=acceleration(c,t),r=sub(q,p),den=dot(v,v)+dot(r,acc);let nt=Math.max(0,Math.min(1,t-dot(r,v)/den));if(Math.abs(t-nt)<1e-12)break;t=nt;}return t;}
function project(p,poly){let best={d:Infinity};for(let i=0;i<poly.length;i++){let a=poly[i],b=poly[(i+1)%poly.length],v=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),v)/dot(v,v))),q=add(a,v,t),d=dist(q,p);if(d<best.d)best={d,q,s:i+t,i,t};}return best;}
function fit(ps,t0,t1){let ts=[0];for(let i=1;i<ps.length;i++)ts.push(ts.at(-1)+dist(ps[i-1],ps[i]));const len=ts.at(-1);ts=ts.map(t=>t/len);let best,prior=Infinity;const start=ps[0],end=ps.at(-1);
 for(let iter=0;iter<30;iter++){let aa=0,ab=0,bb=0,ax=0,bx=0,ay=0,by=0;for(let i=1;i<ps.length-1;i++){let t=ts[i],u=1-t,b0=u**3,b1=3*u*u*t,b2=3*u*t*t,b3=t**3,r=sub(ps[i],add(add({x:0,y:0},start,b0),end,b3));aa+=b1*b1;ab+=b1*b2;bb+=b2*b2;ax+=b1*r.x;bx+=b2*r.x;ay+=b1*r.y;by+=b2*r.y;}let det=aa*bb-ab*ab,c1={x:(ax*bb-bx*ab)/det,y:(ay*bb-by*ab)/det},c2={x:(aa*bx-ab*ax)/det,y:(aa*by-ab*ay)/det};let c=[start,c1,c2,end],err=0,sum=0,split=1;for(let i=1;i<ps.length-1;i++){ts[i]=closestT(c,ps[i],ts[i]);let e=dist(cubic(c,ts[i]),ps[i]);sum+=e*e;if(e>err){err=e;split=i;}}if(!best||err<best.error)best={c,error:err,split,t0,t1,ps};if(Math.abs(sum-prior)<1e-16)break;prior=sum;}
 return refine(best);}
function solve(mat,rhs){const n=rhs.length,a=mat.map((r,i)=>[...r,rhs[i]]);for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[p][i]))p=j;[a[i],a[p]]=[a[p],a[i]];if(Math.abs(a[i][i])<1e-16)return null;let v=a[i][i];for(let k=i;k<=n;k++)a[i][k]/=v;for(let j=0;j<n;j++)if(j!==i){let m=a[j][i];for(let k=i;k<=n;k++)a[j][k]-=m*a[i][k];}}return a.map(r=>r[n]);}
function refine(f){let power=2;let c=f.c,ps=f.ps,ts=ps.map((p,i)=>closestT(c,p,i/(ps.length-1)));function measure(c){let e=0,sum=0,split=1,nt=[];for(let i=0;i<ps.length;i++){let t=closestT(c,ps[i],ts[i]);nt.push(t);let d=dist(cubic(c,t),ps[i]);sum+=Math.pow(d,power);if(d>e){e=d;split=i;}}return {e,sum,split,nt};}let m=measure(c);ts=m.nt;let bestM=m,bestC=c;
for(power of [2,4,8,16]){m=measure(c);for(let iter=0;iter<30;iter++){let h=Array.from({length:4},()=>[0,0,0,0]),g=[0,0,0,0];for(let i=1;i<ps.length-1;i++){let t=ts[i],u=1-t,q=cubic(c,t),v=unit(velocity(c,t)),normal={x:-v.y,y:v.x},r=dot(sub(q,ps[i]),normal),b1=3*u*u*t,b2=3*u*t*t,j=[normal.x*b1,normal.y*b1,normal.x*b2,normal.y*b2],w=Math.max(1e-12,Math.pow(Math.abs(r)/m.e,power-2));for(let a=0;a<4;a++){g[a]-=w*j[a]*r;for(let b=0;b<4;b++)h[a][b]+=w*j[a]*j[b];}}for(let k=0;k<4;k++)h[k][k]+=1e-9;let step=solve(h,g);if(!step)break;let accepted=false;for(let scale=1;scale>1/1024;scale/=2){let next=[c[0],{x:c[1].x+scale*step[0],y:c[1].y+scale*step[1]},{x:c[2].x+scale*step[2],y:c[2].y+scale*step[3]},c[3]],nm=measure(next);if(nm.sum<m.sum){c=next;m=nm;ts=m.nt;if(m.e<bestM.e){bestM=m;bestC=c;}accepted=true;break;}}if(!accepted)break;}}
return {...f,c:bestC,error:bestM.e,split:bestM.split};}

function fitSourceLoop(inputLoop,source,distancePx,options={}){
 const tolerance=options.tolerancePx??.05,fitTolerance=options.fitTolerance??tolerance*.9;
 const loop=[];for(const p of inputLoop)if(!loop.length||dist(p,loop.at(-1))>tolerance*.01)loop.push({...p});
 if(loop.length>1&&dist(loop[0],loop.at(-1))<tolerance*.01)loop.pop();
 const ns=source.nodes,N=ns.length;let area=0;for(let i=0;i<N;i++)area+=cross(ns[i],ns[(i+1)%N]);
 const amount=options.signedAmount??distancePx*Math.sign(area)*(options.closedDirection==='inward'?-1:1),normal=v=>({x:v.y,y:-v.x});
 let knots=ns.map((n,i)=>{
  let av=sub(n,n.in),bv=sub(n.out,n);if(Math.hypot(av.x,av.y)<1e-10)av=sub(n,ns[(i+N-1)%N]);if(Math.hypot(bv.x,bv.y)<1e-10)bv=sub(ns[(i+1)%N],n);
  let a=unit(av),b=unit(bv),oa=add(n,normal(a),amount),ob=add(n,normal(b),amount),den=cross(a,b);
  let target=Math.abs(den)>1e-8?add(oa,a,cross(sub(ob,oa),b)/den):oa;
  if(dist(target,n)>4*Math.abs(amount))target=add(n,unit(add(normal(a),normal(b))),amount);
  return {...project(target,loop),sourceIndex:i,hard:false};
 });
 // Sharp vertices in the actual offset boundary are authoritative; normal
 // offsets can erase source cusps or create new trim corners.
 for(let i=0;i<loop.length;i++){
  const a=unit(sub(loop[i],loop[(i+loop.length-1)%loop.length])),b=unit(sub(loop[(i+1)%loop.length],loop[i]));
  if(dot(a,b)>=Math.cos(.22))continue;
  let nearest=knots.reduce((best,k)=>!best||dist(k.q,loop[i])<dist(best.q,loop[i])?k:best,null);
  if(nearest&&!nearest.hard&&dist(nearest.q,loop[i])<=Math.max(distancePx*.1,tolerance*2))Object.assign(nearest,{q:loop[i],s:i,i,t:0,hard:true});
  else knots.push({q:loop[i],s:i,i,t:0,hard:true});
 }
 knots.sort((a,b)=>a.s-b.s);knots=knots.filter((k,i)=>!i||dist(k.q,knots[i-1].q)>tolerance*.01);
 function between(k1,k2){let start=k1.s,end=k2.s;if(end<=start)end+=loop.length;let ps=[k1.q];for(let s=Math.floor(start)+1;s<end;s++)if(dist(ps.at(-1),loop[s%loop.length])>1e-10)ps.push(loop[s%loop.length]);if(dist(ps.at(-1),k2.q)>1e-10)ps.push(k2.q);return ps;}
 const curves=[];
 function append(ps,depth=0){
  if(ps.length<3){curves.push({c:[ps[0],ps[0],ps.at(-1),ps.at(-1)],error:0,ps});return;}
  // A straight span has no unique cubic parameterization; keep monotone line
  // handles instead of letting least squares overshoot its endpoints.
  const chord=sub(ps.at(-1),ps[0]),length=Math.hypot(chord.x,chord.y);
  if(length>1e-12&&ps.every(p=>Math.abs(cross(sub(p,ps[0]),chord))/length<=tolerance*.1&&dot(sub(p,ps[0]),chord)>=0&&dot(sub(p,ps.at(-1)),chord)<=0)){
   curves.push({c:[ps[0],ps[0],ps.at(-1),ps.at(-1)],error:tolerance*.1,ps});return;
  }
  const f=fit(ps,null,null);
  // Vertex-to-curve fitting alone can leave a small bulge between samples.
  // Locate that bulge on the reference span so only this span gains an anchor.
  let reverseError=0,reverseSplit=f.split;
  for(let j=1;j<64;j++){
   const q=cubic(f.c,j/64);let best=Infinity,index=1;
   for(let i=0;i<ps.length-1;i++){
    const v=sub(ps[i+1],ps[i]),length=dot(v,v),t=length?Math.max(0,Math.min(1,dot(sub(q,ps[i]),v)/length)):0;
    const d=dist(q,add(ps[i],v,t));if(d<best){best=d;index=i+1;}
   }
   if(best>reverseError){reverseError=best;reverseSplit=index;}
  }
  if(f.error<=fitTolerance&&reverseError<=tolerance*.96){curves.push(f);return;}
  const split=Math.max(1,Math.min(ps.length-2,reverseError>tolerance*.96?reverseSplit:f.split));
  if(depth>=18||curves.length>10000)throw Error('source offset fitting complexity');
  append(ps.slice(0,split+1),depth+1);append(ps.slice(split),depth+1);
 }
 for(let i=0;i<knots.length;i++)append(between(knots[i],knots[(i+1)%knots.length]));
 const nodes=curves.map((f,i)=>{const node={...f.c[0],in:{...curves[(i+curves.length-1)%curves.length].c[2]},out:{...f.c[1]},mode:'cusp'};
  const a=sub(node,node.in),b=sub(node.out,node);if(Math.hypot(a.x,a.y)>1e-9&&Math.hypot(b.x,b.y)>1e-9&&dot(unit(a),unit(b))>.999999)node.mode='smooth';return node;});
 return {nodes,curves,knots,maxSampleError:Math.max(...curves.map(f=>f.error))};
}
// signedAmount is the signed displacement along the source right-hand normal
// (tangent.y,-tangent.x). Return null for unsupported/open input or rejected fit.
function fitOriginalNodes(source,loop,signedAmount,tolerance=.05,certificate){
 if(!source.closed||source.nodes.length<3||source.nodes.length>200||!Array.isArray(loop)||loop.length<3||loop.length>12000)return null;
 // A vertex fit can narrowly miss the continuous distance check. Tighten its
 // local splitting target once before discarding the source-knot structure.
 for(const fraction of [.9,.65])try{
  const r=fitSourceLoop(loop,source,Math.abs(signedAmount),{tolerancePx:tolerance,fitTolerance:tolerance*fraction,signedAmount});
  if(r.nodes.some(n=>[n,n.in,n.out].some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))))return null;
  if(!certificate||certificate(r.nodes))return r.nodes;
 }catch{return null;}
 return null;
}


// Independent Hausdorff verifier for polygonal sets. Each accepted
// interval uses the 1-Lipschitz distance-to-set bound, not only point samples.
function segmentIndex(points,closed=true){
 const edges=points.slice(0,points.length-(closed?0:1)).map((a,i)=>{const b=points[(i+1)%points.length];return {a,b,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};});
 const build=items=>{const box={minX:Math.min(...items.map(e=>e.minX)),maxX:Math.max(...items.map(e=>e.maxX)),minY:Math.min(...items.map(e=>e.minY)),maxY:Math.max(...items.map(e=>e.maxY))};if(items.length<=8)return {...box,edges:items};const axis=box.maxX-box.minX>box.maxY-box.minY?'X':'Y';items.sort((a,b)=>a['min'+axis]+a['max'+axis]-b['min'+axis]-b['max'+axis]);const mid=items.length>>1;return {...box,left:build(items.slice(0,mid)),right:build(items.slice(mid))};};
 const tree=build(edges),boxDistance=(p,b)=>Math.hypot(Math.max(0,b.minX-p.x,p.x-b.maxX),Math.max(0,b.minY-p.y,p.y-b.maxY));
 function edgeDistance(p,e){const x=e.b.x-e.a.x,y=e.b.y-e.a.y,l=x*x+y*y,t=l?Math.max(0,Math.min(1,((p.x-e.a.x)*x+(p.y-e.a.y)*y)/l)):0;return Math.hypot(p.x-e.a.x-t*x,p.y-e.a.y-t*y);}
 function nearest(p,wantEdge=false){
  let best=Infinity,bestEdge=null;
  const visit=node=>{
   if(boxDistance(p,node)>=best)return;
   if(node.edges){for(const e of node.edges){const d=edgeDistance(p,e);if(d<best){best=d;bestEdge=e;}}}
   else{const [a,b]=boxDistance(p,node.left)<=boxDistance(p,node.right)?[node.left,node.right]:[node.right,node.left];visit(a);visit(b);}
  };
  visit(tree);return wantEdge?bestEdge:best;
 }
 return {edges,nearest,edgeDistance,nearestEdge:p=>nearest(p,true)};
}
function withinTolerance(a,b,tolerance,closed=true,budget=400000){
 const ai=segmentIndex(a,closed),bi=segmentIndex(b,closed);let evaluations=0,maxSample=0,maxBound=0;
 function directed(source,target){
  function measure(p){if(++evaluations>budget)return Infinity;const d=target.nearest(p);maxSample=Math.max(maxSample,d);return d;}
  function interval(a,b,da,db,depth=0){
   if(da>tolerance||db>tolerance)return false;
   const length=Math.hypot(a.x-b.x,a.y-b.y),bound=(da+db+length)/2;
   if(bound<=tolerance){maxBound=Math.max(maxBound,bound);return true;}
   const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},edge=target.nearestEdge(mid);
   // A segment whose endpoints lie in one finite segment's tolerance capsule
   // lies wholly in that convex capsule. Exact long lines need no subdivision.
   if(edge){const upper=Math.max(target.edgeDistance(a,edge),target.edgeDistance(b,edge));if(upper<=tolerance){maxBound=Math.max(maxBound,upper);return true;}}
   if(depth>=30)return false;
   const dm=measure(mid);return interval(a,mid,da,dm,depth+1)&&interval(mid,b,dm,db,depth+1);
  }
  for(const e of source.edges)if(!interval(e.a,e.b,measure(e.a),measure(e.b)))return false;return true;
 }
 const accepted=directed(ai,bi)&&directed(bi,ai);return {accepted,maxSample,maxBound,evaluations};
}

const api={fitOriginalNodes,withinTolerance};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CurveOffsetFit=api;
})(typeof window!=='undefined'?window:globalThis);
