(function(root){
 'use strict';
 const common=typeof module!=='undefined'&&module.exports;
 const W=common?require('./walk.js'):root.CurveWalk;
 const finitePoint=(point,label='Point')=>{
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new RangeError(`${label} coordinates must be finite`);
 };
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 const snapshot=path=>JSON.parse(JSON.stringify(path));
 const normal=tangent=>({x:-tangent.y,y:tangent.x});

 function frame(track,s){
  if(track.loop)s=((s%track.length)+track.length)%track.length;
  if(s<0){
   const start=W.at(track,0);
   return {s,point:{x:start.point.x+start.tangent.x*s,y:start.point.y+start.tangent.y*s},tangent:start.tangent};
  }
  if(s>track.length){
   const end=W.at(track,track.length),extra=s-track.length;
   return {s,point:{x:end.point.x+end.tangent.x*extra,y:end.point.y+end.tangent.y*extra},tangent:end.tangent};
  }
  return W.at(track,s);
 }

 function chordCandidates(track,point){
  const candidates=[];
  for(const span of track.spans){
   const vx=span.p1.x-span.p0.x,vy=span.p1.y-span.p0.y,squared=vx*vx+vy*vy;
   if(!(squared>0))continue;
   const ratio=clamp(((point.x-span.p0.x)*vx+(point.y-span.p0.y)*vy)/squared,0,1);
   const q={x:span.p0.x+vx*ratio,y:span.p0.y+vy*ratio};
   candidates.push({s:span.s0+(span.s1-span.s0)*ratio,distance:distance(point,q),segment:span.segment});
  }
  return candidates;
 }

 function normalCoordinates(track,point,hint){
  finitePoint(point);
  const nearest=W.nearest(track,point),start=W.at(track,0),end=W.at(track,track.length),choices=[nearest];
  const fromStart=(point.x-start.point.x)*start.tangent.x+(point.y-start.point.y)*start.tangent.y;
  if(!track.loop&&fromStart<0){
   const q={x:start.point.x+start.tangent.x*fromStart,y:start.point.y+start.tangent.y*fromStart};
   choices.push({s:fromStart,point:q,distance:distance(point,q)});
  }
  const fromEnd=(point.x-end.point.x)*end.tangent.x+(point.y-end.point.y)*end.tangent.y;
  if(!track.loop&&fromEnd>0){
   const q={x:end.point.x+end.tangent.x*fromEnd,y:end.point.y+end.tangent.y*fromEnd};
   choices.push({s:track.length+fromEnd,point:q,distance:distance(point,q)});
  }
  choices.sort((a,b)=>a.distance-b.distance);
  let chosen=choices[0];
  const hinted=Number.isFinite(hint)?hint:hint&&Number.isFinite(hint.s)?hint.s:null;
  const scan=chordCandidates(track,point),minimum=Math.min(...scan.map(candidate=>candidate.distance));
  const distanceSlack=Math.max(track.tolerance*6,1e-5);
  const branches=scan.filter(candidate=>candidate.distance<=minimum+distanceSlack).sort((a,b)=>a.s-b.s);
  if(hinted!==null&&branches.length)chosen=branches.reduce((best,candidate)=>Math.abs(candidate.s-hinted)<Math.abs(best.s-hinted)?candidate:best,branches[0]);
  else if(branches.some((candidate,index)=>branches.slice(0,index).some(other=>candidate.segment!==other.segment&&Math.abs(candidate.s-other.s)>.1)))throw new RangeError('Bend mapping is ambiguous or unsupported at this point');
  const local=frame(track,chosen.s),n=normal(local.tangent);
  const dx=point.x-local.point.x,dy=point.y-local.point.y;
  const tangential=Math.abs(dx*local.tangent.x+dy*local.tangent.y);
  if(tangential>Math.max(track.tolerance*16,.05))throw new RangeError('Bend mapping is unsupported at this point');
  return {s:chosen.s,d:dx*n.x+dy*n.y};
 }

 function fromCoordinates(track,coordinates){
  const local=frame(track,coordinates.s),n=normal(local.tangent);
  return {x:local.point.x+n.x*coordinates.d,y:local.point.y+n.y*coordinates.d};
 }

 function normalCoordinatesNear(track,point,expectedStation){
  finitePoint(point);
  if(!Number.isFinite(expectedStation))throw new RangeError('Bend branch station must be finite');
  let s=expectedStation,derivative=-1;
  const residual=station=>{
   const local=frame(track,station);
   return (point.x-local.point.x)*local.tangent.x+(point.y-local.point.y)*local.tangent.y;
  };
  for(let iteration=0;iteration<16;iteration++){
   const value=residual(s);
   if(Math.abs(value)<=Math.max(track.tolerance*4,1e-6))break;
   const h=Math.max(track.tolerance*2,track.length*1e-6,1e-5);
   derivative=(residual(s+h)-residual(s-h))/(2*h);
   if(!Number.isFinite(derivative)||Math.abs(derivative)<.05)throw new RangeError('Bend mapping is ambiguous or locally non-invertible');
   const step=clamp(value/derivative,-Math.max(track.length*.1,1),Math.max(track.length*.1,1));
   s-=step;
  }
  const local=frame(track,s),dx=point.x-local.point.x,dy=point.y-local.point.y;
  const tangential=Math.abs(dx*local.tangent.x+dy*local.tangent.y);
  if(tangential>Math.max(track.tolerance*12,.03))throw new RangeError('Bend mapping is ambiguous or unsupported at this point');
  const h=Math.max(track.tolerance*2,track.length*1e-6,1e-5);
  const n=normal(local.tangent);
  const coordinates={s,d:dx*n.x+dy*n.y},mapped=fromCoordinates(track,coordinates);
  const before=fromCoordinates(track,{s:s-h,d:coordinates.d}),after=fromCoordinates(track,{s:s+h,d:coordinates.d});
  const backwardSpeed=distance(mapped,before)/h,forwardSpeed=distance(after,mapped)/h;
  if(!Number.isFinite(backwardSpeed)||!Number.isFinite(forwardSpeed)||Math.min(backwardSpeed,forwardSpeed)<.05)throw new RangeError('Bend mapping is ambiguous or locally non-invertible');
  return coordinates;
 }

 function create(sourceOpenPath,targetOpenPath,options={}){
  if(sourceOpenPath&&sourceOpenPath.closed||targetOpenPath&&targetOpenPath.closed)throw new RangeError('CurveBend.create requires pre-cut open paths');
  const sourceTrack=W.track(snapshot(sourceOpenPath)),selectedTarget=W.track(snapshot(targetOpenPath)),targetTrack=options.targetRoute?W.track(snapshot(options.targetRoute)):selectedTarget;
  targetTrack.loop=Boolean(options.targetLoop);
  const origin=options.targetOrigin??0;if(!Number.isFinite(origin))throw new RangeError('Target origin must be finite');
  let offset=options.offset===undefined?0:options.offset;
  if(!Number.isFinite(offset))throw new RangeError('Bend offset must be finite');

  // Source tracks are immutable snapshots. Cache exact source coordinates,
  // never target positions: offset changes still evaluate the target frame.
  // Bound both caches so prolonged node editing cannot retain unlimited points.
  const sourceCache=new Map(),previewCache=new Map(),cacheLimit=8192;
  // Keep the admitted working set: FIFO eviction would miss every point on
  // repeated scans just larger than the limit. Extra points remain uncached.
  const remember=(cache,key,value)=>{if(cache.size<cacheLimit)cache.set(key,value);return value;};
  const sourceCoordinates=point=>{
   finitePoint(point);const key=point.x+','+point.y;
   return sourceCache.get(key)||remember(sourceCache,key,normalCoordinates(sourceTrack,point));
  };
  const forward=(point,hint)=>{
   const hinted=Number.isFinite(hint)?hint:hint&&Number.isFinite(hint.s)?hint.s:null;
   const source=hinted===null?sourceCoordinates(point):normalCoordinatesNear(sourceTrack,point,hinted);
   return fromCoordinates(targetTrack,{s:source.s+offset+origin,d:source.d});
  };
  // The wide part of a flat pattern can fold over itself in a 2D illustration.
  // Show those points in a complete local frame; editing still uses the strict
  // forward/inverse pair below and never relies on this display-only fallback.
  const preview=point=>{
   finitePoint(point);const key=point.x+','+point.y;
   let coordinates=previewCache.get(key);
   if(!coordinates){
    try{const source=sourceCoordinates(point);coordinates={s:source.s,u:0,v:source.d};}
    catch(_error){
     let chosen=W.nearest(sourceTrack,point);
     for(const s of [0,sourceTrack.length]){
      const edge=W.at(sourceTrack,s),along=(point.x-edge.point.x)*edge.tangent.x+(point.y-edge.point.y)*edge.tangent.y;
      if(s===0?along>=0:along<=0)continue;
      const q={x:edge.point.x+edge.tangent.x*along,y:edge.point.y+edge.tangent.y*along},d=distance(point,q);
      if(d<chosen.distance)chosen={s:s+along,distance:d};
     }
     const a=frame(sourceTrack,chosen.s),dx=point.x-a.point.x,dy=point.y-a.point.y;
     coordinates={s:chosen.s,u:dx*a.tangent.x+dy*a.tangent.y,v:-dx*a.tangent.y+dy*a.tangent.x};
    }
    remember(previewCache,key,coordinates);
   }
   const b=frame(targetTrack,coordinates.s+offset+origin),{u,v}=coordinates;
   return {x:b.point.x+u*b.tangent.x-v*b.tangent.y,y:b.point.y+u*b.tangent.y+v*b.tangent.x};
  };
  const inverse=(point,hint)=>{
   const originalHint=hint&&Number.isFinite(hint.x)&&Number.isFinite(hint.y)?sourceCoordinates(hint):null;
   const stationHint=originalHint?originalHint.s+offset+origin:Number.isFinite(hint)?hint:hint&&Number.isFinite(hint.s)?hint.s:null;
   const target=stationHint===null?normalCoordinates(targetTrack,point):normalCoordinatesNear(targetTrack,point,stationHint);
   const result=fromCoordinates(sourceTrack,{s:target.s-offset-origin,d:target.d});
   const roundtrip=forward(result,{s:target.s-offset-origin});
   const tolerance=Math.max(sourceTrack.tolerance,targetTrack.tolerance)*32+.02;
   if(distance(roundtrip,point)>tolerance)throw new RangeError('Bend inverse is ambiguous or unsupported at this point');
   // Rendering and subsequent edits locate source points without a branch hint.
   // Reject a locally plausible inverse if that canonical lookup would display
   // the result on a different branch.
   let displayed;
   try{displayed=forward(result);}catch(_error){throw new RangeError('Bend inverse is ambiguous or unsupported at this point');}
   if(distance(displayed,point)>tolerance)throw new RangeError('Bend inverse is ambiguous or unsupported at this point');
   return result;
  };
  const setOffset=value=>{
   if(!Number.isFinite(value))throw new RangeError('Bend offset must be finite');
   offset=value;return api;
  };
  const api={sourceLength:sourceTrack.length,targetLength:selectedTarget.length,forward,preview,inverse,setOffset};
  return Object.freeze(api);
 }

 const api={create};
 if(common)module.exports=api;else root.CurveBend=api;
})(typeof window!=='undefined'?window:globalThis);
