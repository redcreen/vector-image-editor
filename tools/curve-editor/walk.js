(function(root){
 'use strict';
 const common=typeof module!=='undefined'&&module.exports;
 const G=common?require('./geometry.js'):root.CurveGeometry;
 const EPSILON=1e-12;

 const finitePoint=(point,label='Point')=>{
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new RangeError(`${label} coordinates must be finite`);
 };
 const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const cubic=(a,b,t)=>G.at(a,b,t);
 const derivative=(a,b,t)=>{
  const u=1-t;
  return {
   x:3*(u*u*(a.out.x-a.x)+2*u*t*(b.in.x-a.out.x)+t*t*(b.x-b.in.x)),
   y:3*(u*u*(a.out.y-a.y)+2*u*t*(b.in.y-a.out.y)+t*t*(b.y-b.in.y))
  };
 };
 const GAUSS_NODES=[-.9602898564975363,-.7966664774136267,-.525532409916329,-.1834346424956498,.1834346424956498,.525532409916329,.7966664774136267,.9602898564975363];
 const GAUSS_WEIGHTS=[.1012285362903763,.2223810344533745,.3137066458778873,.362683783378362,.362683783378362,.3137066458778873,.2223810344533745,.1012285362903763];
 const arcLength=(a,b,t0,t1)=>{
  const half=(t1-t0)/2,middle=(t0+t1)/2;let total=0;
  for(let index=0;index<GAUSS_NODES.length;index++){
   const speed=derivative(a,b,middle+half*GAUSS_NODES[index]);
   total+=GAUSS_WEIGHTS[index]*Math.hypot(speed.x,speed.y);
  }
  return half*total;
 };
 const unit=vector=>{
  const length=Math.hypot(vector.x,vector.y);
  return length>EPSILON?{x:vector.x/length,y:vector.y/length}:null;
 };
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 const station=(track,value)=>track.closed?((value%track.length)+track.length)%track.length:clamp(value,0,track.length);

 function validatePath(path){
  if(!path||!Array.isArray(path.nodes)||path.nodes.length<2)throw new RangeError('A walk path needs at least two nodes');
  for(const node of path.nodes){
   finitePoint(node,'Node');finitePoint(node.in,'Incoming handle');finitePoint(node.out,'Outgoing handle');
  }
 }

 function track(path,tolerance=.002){
  validatePath(path);
  if(!Number.isFinite(tolerance)||tolerance<=0)throw new RangeError('Arc tolerance must be a positive finite number');
  const segmentCount=path.nodes.length-(path.closed?0:1),spans=[];
  let length=0;
  const append=(segment,t0,t1,p0,p1,a,b)=>{
   const spanLength=arcLength(a,b,t0,t1);
   if(spanLength<=EPSILON)return;
   spans.push({segment,t0,t1,s0:length,s1:length+spanLength,p0,p1});length+=spanLength;
  };
  const flatten=(segment,a,b,t0,t1,p0,p1,p2,p3,budget,depth)=>{
   const chord=distance(p0,p3),polygon=distance(p0,p1)+distance(p1,p2)+distance(p2,p3);
   const p01=mix(p0,p1,.5),p12=mix(p1,p2,.5),p23=mix(p2,p3,.5);
   const p012=mix(p01,p12,.5),p123=mix(p12,p23,.5),middle=mix(p012,p123,.5),tm=(t0+t1)/2;
   if(depth>=24||polygon-chord<=budget){append(segment,t0,t1,p0,p3,a,b);return;}
   flatten(segment,a,b,t0,tm,p0,p01,p012,middle,budget/2,depth+1);
   flatten(segment,a,b,tm,t1,middle,p123,p23,p3,budget/2,depth+1);
  };
  for(let index=0;index<segmentCount;index++){
   const a=path.nodes[index],b=path.nodes[(index+1)%path.nodes.length];
   flatten(index,a,b,0,1,{x:a.x,y:a.y},a.out,b.in,{x:b.x,y:b.y},tolerance/segmentCount,0);
  }
  if(!(length>EPSILON)||!spans.length)throw new RangeError('Walk path must have non-zero length');
  return {path,length,closed:Boolean(path.closed),tolerance,spans};
 }

 function spanAt(track,s){
  let low=0,high=track.spans.length-1;
  while(low<high){const middle=(low+high)>>1;if(track.spans[middle].s1<s)low=middle+1;else high=middle;}
  return track.spans[low];
 }

 function parameterAtStation(track,span,s){
  if(s<=span.s0)return span.t0;
  if(s>=span.s1)return span.t1;
  const a=track.path.nodes[span.segment],b=track.path.nodes[(span.segment+1)%track.path.nodes.length];
  const wanted=clamp(s-span.s0,0,span.s1-span.s0);let low=span.t0,high=span.t1;
  for(let iteration=0;iteration<28;iteration++){
   const middle=(low+high)/2;
   if(arcLength(a,b,span.t0,middle)<wanted)low=middle;else high=middle;
  }
  return (low+high)/2;
 }

 function stableTangent(track,span,t){
  const a=track.path.nodes[span.segment],b=track.path.nodes[(span.segment+1)%track.path.nodes.length];
  let tangent=unit(derivative(a,b,t));
  if(tangent)return tangent;
  for(const offset of [1e-7,1e-6,1e-5,1e-4,1e-3,.01,.1]){
   const candidates=t<=0?[t+offset]:t>=1?[t-offset]:[t+offset,t-offset];
   for(const candidate of candidates){
    if(candidate<0||candidate>1)continue;
    tangent=unit(derivative(a,b,candidate));if(tangent)return tangent;
   }
  }
  tangent=unit({x:span.p1.x-span.p0.x,y:span.p1.y-span.p0.y});
  if(tangent)return tangent;
  throw new RangeError('Walk path has no usable tangent');
 }

 function at(track,s){
  if(!track||!Array.isArray(track.spans)||!(track.length>0))throw new TypeError('Expected a CurveWalk track');
  if(!Number.isFinite(s))throw new RangeError('Arc station must be finite');
  const target=clamp(s,0,track.length),span=spanAt(track,target);
  const t=parameterAtStation(track,span,target);
  const a=track.path.nodes[span.segment],b=track.path.nodes[(span.segment+1)%track.path.nodes.length];
  return {point:cubic(a,b,t),tangent:stableTangent(track,span,t),s:target};
 }

 function nearest(track,point){
  if(!track||!Array.isArray(track.spans)||!(track.length>0))throw new TypeError('Expected a CurveWalk track');
  finitePoint(point);
  let best=null;
  for(const span of track.spans){
   // A geometrically straight cubic may still have extremely non-uniform
   // parameter speed, so chord projection cannot safely narrow the t bracket.
   let left=0,right=1;
   const a=track.path.nodes[span.segment],b=track.path.nodes[(span.segment+1)%track.path.nodes.length];
   const measure=ratio=>{const t=span.t0+(span.t1-span.t0)*ratio,p=cubic(a,b,t);return {ratio,p,distance:distance(point,p)};};
   for(let iteration=0;iteration<36;iteration++){
    const third=(right-left)/3,m1=measure(left+third),m2=measure(right-third);
    if(m1.distance<=m2.distance)right=right-third;else left=left+third;
   }
   for(const candidate of [measure((left+right)/2),measure(0),measure(1)]){
    if(!best||candidate.distance<best.distance){
     const t=span.t0+(span.t1-span.t0)*candidate.ratio;
     best={s:span.s0+arcLength(a,b,span.t0,t),point:candidate.p,distance:candidate.distance};
    }
   }
  }
  return best;
 }

 function limit(track,start,direction=1){
  if(!track||!(track.length>0))throw new TypeError('Expected a CurveWalk track');
  if(!Number.isFinite(start))throw new RangeError('Walk start must be finite');
  if(direction!==1&&direction!==-1)throw new RangeError('Walk direction must be 1 or -1');
  if(track.closed)return track.length;
  const origin=station(track,start);return direction===1?track.length-origin:origin;
 }

 function position(track,start,direction=1,distanceAlong=0){
  if(!Number.isFinite(distanceAlong))throw new RangeError('Walk distance must be finite');
  const available=limit(track,start,direction),origin=station(track,start),walked=clamp(distanceAlong,0,available);
  const s=station(track,origin+direction*walked),sample=at(track,s);
  if(direction===-1)sample.tangent={x:-sample.tangent.x,y:-sample.tangent.y};
  return sample;
 }

 const api={track,at,nearest,limit,position};
 if(common)module.exports=api;else root.CurveWalk=api;
})(typeof window!=='undefined'?window:globalThis);
