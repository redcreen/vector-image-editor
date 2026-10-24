(function(root){
 'use strict';
 const MAX_NODES=200;
 const point=p=>({x:p.x,y:p.y}),length=p=>Math.hypot(p.x,p.y);
 const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
 const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
 const copy=ns=>ns.map(n=>({...n,in:point(n.in),out:point(n.out)}));
 const fail=()=>{throw new RangeError('在当前偏差范围内无法生成连续平顺曲线，请增大允许偏差或调整必经点');};
 // Solve the nonuniform cubic spline for derivatives in a shared chord-length
 // parameter. Natural boundaries are used only when no endpoint direction exists.
 function spline(points,h,start,end,source){
  const count=points.length,a=new Float64Array(count),b=new Float64Array(count),c=new Float64Array(count),rx=new Float64Array(count),ry=new Float64Array(count);
  for(let i=1;i<count-1;i++){
   const l=h[i-1],r=h[i];a[i]=r;b[i]=2*(l+r);c[i]=l;
   for(const [axis,out] of [['x',rx],['y',ry]])out[i]=3*(r*(points[i][axis]-points[i-1][axis])/l+l*(points[i+1][axis]-points[i][axis])/r);
  }
  for(const [i,j,step,tangent] of [[0,1,h[0],start],[count-1,count-2,h.at(-1),end]]){
   if(tangent){b[i]=1;rx[i]=tangent.x;ry[i]=tangent.y;}
   else {b[i]=2;if(i===0)c[i]=1;else a[i]=1;const sign=i===0?1:-1;rx[i]=3*sign*(points[j].x-points[i].x)/step;ry[i]=3*sign*(points[j].y-points[i].y)/step;}
  }
  for(let i=1;i<count;i++){const w=a[i]/b[i-1];b[i]-=w*c[i-1];rx[i]-=w*rx[i-1];ry[i]-=w*ry[i-1];}
  for(let i=count-1;i>=0;i--){rx[i]=(rx[i]-(i<count-1?c[i]*rx[i+1]:0))/b[i];ry[i]=(ry[i]-(i<count-1?c[i]*ry[i+1]:0))/b[i];}
  const out=copy(source);
  for(let i=0;i<count;i++){out[i].x=points[i].x;out[i].y=points[i].y;if(i)out[i].in={x:points[i].x-rx[i]*h[i-1]/3,y:points[i].y-ry[i]*h[i-1]/3};if(i<count-1)out[i].out={x:points[i].x+rx[i]*h[i]/3,y:points[i].y+ry[i]*h[i]/3};if(i&&i<count-1)out[i].mode='smooth';else if(out[i].mode==='symmetric')out[i].mode='smooth';}
  return out;
 }
 function controls(ns,i){return [ns[i],ns[i].out,ns[i+1].in,ns[i+1]];}
 // Difference curves share exactly the same segment parameterization. The convex
 // hull bound therefore bounds every point, in both Hausdorff directions too.
 function bound(ps,tolerance,depth=0){
  const upper=Math.max(...ps.map(length));if(upper<=tolerance||depth===8)return upper;
  if(Math.max(length(ps[0]),length(ps[3]))>tolerance)return upper;
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const a=mid(ps[0],ps[1]),b=mid(ps[1],ps[2]),c=mid(ps[2],ps[3]),d=mid(a,b),e=mid(b,c),f=mid(d,e);
  return Math.max(bound([ps[0],a,d,f],tolerance,depth+1),bound([f,e,c,ps[3]],tolerance,depth+1));
 }
 function metrics(ns,original,h,tolerance){
  let deviation=0,energy=0;
  for(let i=1;i<ns.length-1;i++)if(length(sub(ns[i].out,ns[i]))<=1e-10*h[i])return null;
  for(let i=0;i<ns.length-1;i++){
   const p=controls(ns,i),old=controls(original,i),chord=sub(p[3],p[0]),sq=chord.x**2+chord.y**2;
   if(!p.every(finite)||sq<=1e-18)return null;
   // Nonnegative projected derivative coefficients certify no local reversal or
   // loop within a segment; rejected candidates are never silently clipped.
   for(let j=0;j<3;j++){const v=sub(p[j+1],p[j]);if(v.x*chord.x+v.y*chord.y < -1e-12*sq)return null;}
   const d=bound(p.map((v,j)=>sub(v,old[j])),tolerance);if(d>tolerance)return null;deviation=Math.max(deviation,d);
   for(const axis of ['x','y']){const a=6*(p[0][axis]-2*p[1][axis]+p[2][axis])/h[i]**2,b=6*(p[1][axis]-2*p[2][axis]+p[3][axis])/h[i]**2;energy+=h[i]*(a*a+a*b+b*b)/3;}
  }
  return {maxDeviation:deviation,energy};
 }
 function fairSpan(nodes,options={}){
  const tolerance=options.tolerance;
  if(!Array.isArray(nodes)||nodes.length<3||nodes.length>MAX_NODES)throw new RangeError('整段顺滑需要 3 至 200 个连续节点');
  if(!Number.isFinite(tolerance)||tolerance<0)throw new RangeError('允许偏差必须是大于或等于零的有限数值');
  if(nodes.some(n=>!finite(n)||!finite(n.in)||!finite(n.out)))throw new RangeError('曲线包含无效坐标');
  const fixed=new Set([0,nodes.length-1]);
  if(options.fixedIndices!==undefined&&!Array.isArray(options.fixedIndices))throw new RangeError('必经点列表无效');
  for(const i of options.fixedIndices||[]){if(!Number.isInteger(i)||i<0||i>=nodes.length)throw new RangeError('必经点索引无效');fixed.add(i);}
  const h=nodes.slice(1).map((n,i)=>length(sub(n,nodes[i])));
  if(h.some(v=>!Number.isFinite(v)||v<=1e-9))throw new RangeError('相邻节点重合或过近，请先调整节点');
  // Endpoint overrides are forward derivative vectors, not absolute handle points.
  // A collapsed first handle has zero parametric derivative, but its geometric
  // tangent is the first nonzero displacement in the remaining control polygon.
  // Use unit chord-parameter speed in that case while preserving its direction.
  const boundary=(vectors,step)=>{
   if(length(vectors[0])>1e-12)return vectors[0];
   const v=vectors.find(v=>length(v)>1e-12);
   return v?{x:v.x/length(v)*step/3,y:v.y/length(v)*step/3}:{x:0,y:0};
  };
  const first=nodes[0],last=nodes.at(-1);
  const start=options.startTangent===undefined?boundary([sub(first.out,first),sub(nodes[1].in,first),sub(nodes[1],first)],h[0]):options.startTangent;
  const end=options.endTangent===undefined?boundary([sub(last,last.in),sub(last,nodes.at(-2).out),sub(last,nodes.at(-2))],h.at(-1)):options.endTangent;
  if(!finite(start)||!finite(end))throw new RangeError('端点切线无效');
  const direction=v=>length(v)>1e-12?{x:v.x/length(v),y:v.y/length(v)}:null;
  const ds=direction(start),de=direction(end);
  let relaxed=nodes.map(point);
  for(let pass=0;pass<12;pass++)relaxed=relaxed.map((p,i)=>{if(fixed.has(i))return p;const t=h[i-1]/(h[i-1]+h[i]);return {x:p.x*.5+(relaxed[i-1].x*(1-t)+relaxed[i+1].x*t)*.5,y:p.y*.5+(relaxed[i-1].y*(1-t)+relaxed[i+1].y*t)*.5};});
  // Keep an already C2 input as a feasible candidate, including exact zero tolerance.
  let continuous=true;
  for(let i=1;i<nodes.length-1;i++)for(const axis of ['x','y']){
   const l=h[i-1],r=h[i],a=nodes[i-1],b=nodes[i],c=nodes[i+1];
   const dl=3*(b[axis]-b.in[axis])/l,dr=3*(b.out[axis]-b[axis])/r;
   const al=6*(b[axis]-2*b.in[axis]+a.out[axis])/l**2,ar=6*(b[axis]-2*b.out[axis]+c.in[axis])/r**2;
   if(Math.abs(dl-dr)>1e-10*Math.max(1,Math.abs(dl),Math.abs(dr))||Math.abs(al-ar)>1e-10*Math.max(1,Math.abs(al),Math.abs(ar)))continuous=false;
  }
  const sameDirection=(a,b)=>{const la=length(a),lb=length(b);return la>1e-12&&lb>1e-12&&a.x*b.x+a.y*b.y>0&&Math.abs(a.x*b.y-a.y*b.x)<=1e-12*la*lb;};
  if(options.startTangent!==undefined&&ds&&!sameDirection(start,sub(nodes[0].out,nodes[0])))continuous=false;
  if(options.endTangent!==undefined&&de&&!sameDirection(end,sub(nodes.at(-1),nodes.at(-1).in)))continuous=false;
  const originalMetrics=continuous?metrics(nodes,nodes,h,tolerance):null;
  let best=originalMetrics?{nodes:copy(nodes),...originalMetrics}:null;
  // Preserve real boundary speeds as independent candidates. Unit speed alone
  // discards unequal endpoint handles and can make tight tolerances infeasible.
  const speedChoices=(v,step,explicit)=>{
   if(!direction(v))return [0];
   const base=length(v)*(explicit?1:3/step);
   return [...new Set([base,1,base*.5,base*1.5])];
  };
  const starts=speedChoices(start,h[0],options.startTangent!==undefined),ends=speedChoices(end,h.at(-1),options.endTangent!==undefined);
  // Scale relaxation to this request's tolerance before sampling it. A long bow
  // no longer needs a large displacement merely to reach the first search step.
  const displacement=Math.max(...relaxed.map((p,i)=>length(sub(p,nodes[i]))));
  const relaxationScale=displacement>0?Math.min(1,tolerance/displacement):0;
  const alphas=relaxationScale>0?Array.from({length:17},(_,i)=>i/16*relaxationScale):[0];
  for(const alpha of alphas){
   const points=nodes.map((p,i)=>fixed.has(i)?point(p):{x:p.x+(relaxed[i].x-p.x)*alpha,y:p.y+(relaxed[i].y-p.y)*alpha});
   for(const startSpeed of starts)for(const endSpeed of ends){
    const scaled=(v,speed)=>v?{x:v.x*speed,y:v.y*speed}:null;
    const candidate=spline(points,h,scaled(ds,startSpeed),scaled(de,endSpeed),nodes),m=metrics(candidate,nodes,h,tolerance);
    if(m&&(!best||m.energy<best.energy))best={nodes:candidate,...m};
   }
  }
  if(!best)fail();
  best.changed=nodes.some((n,i)=>['x','y'].some(a=>n[a]!==best.nodes[i][a]||n.in[a]!==best.nodes[i].in[a]||n.out[a]!==best.nodes[i].out[a]));
  best.continuity='C2';best.parameterIntervals=h;return best;
 }
 const api={fairSpan,MAX_NODES};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.CurveFairing=api;
})(typeof globalThis!=='undefined'?globalThis:this);
