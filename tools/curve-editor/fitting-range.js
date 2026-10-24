(function(root){
 'use strict';
 const same=(a,b)=>!!a&&!!b&&a.x===b.x&&a.y===b.y;
 const mod=(i,n)=>(i%n+n)%n;
 const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 function valid(G,path,p){
  const count=G.segmentCount(path);
  if(!count)throw Error('拟合范围需要至少一段曲线');
  return {index:clamp(Number.isFinite(p?.index)?Math.floor(p.index):0,0,count-1),t:clamp(Number.isFinite(p?.t)?p.t:0,0,1)};
 }
 function nodeAt(path,i){return path.closed?path.nodes[mod(i,path.nodes.length)]:path.nodes[i];}
 function anchorPosition(path,i,incoming){
  const count=path.nodes.length-(path.closed?0:1);
  if(incoming&&(path.closed||i>0)||!path.closed&&i===count)return {index:mod(i-1,count),t:1};
  return {index:i,t:0};
 }
 // Only an exact reordered anchor sequence proves rotation/reversal. Equal-sized
 // paths otherwise represent node/handle edits, so their bookmarks follow t.
 function reorder(oldPath,newPath){
  const a=oldPath.nodes,b=newPath.nodes,n=a.length;
  if(a.length!==b.length||!!oldPath.closed!==!!newPath.closed)return null;
  if(a.every((p,i)=>same(p,b[i])))return {shift:0,direction:1};
  const shifts=newPath.closed?b.map((_,i)=>i):[0,n-1];
  for(const direction of [1,-1])for(const shift of shifts){
   if(!newPath.closed&&(direction===1&&shift!==0||direction===-1&&shift!==n-1))continue;
   if(a.every((p,i)=>same(p,b[mod(shift+direction*i,n)])))return {shift,direction};
  }
  return null;
 }
 // Coordinates alone cannot distinguish a slit mouth visited twice. Compare
 // neighbors on both sides, including nearby surviving nodes across insertions.
 function neighborScore(a,i,b,j){
  let score=0;
  for(const direction of [-1,1]){
   for(let step=1;step<=Math.min(6,a.nodes.length-1);step++){
    const p=nodeAt(a,i+direction*step);if(!p)break;
    let best=0;
    for(let offset=1;offset<=Math.min(10,b.nodes.length-1);offset++){
     const q=nodeAt(b,j+direction*offset);if(!q)break;
     if(same(p,q))best=Math.max(best,1/(step*(1+Math.abs(offset-step))));
    }
    score+=best;
   }
   const p=nodeAt(a,i+direction),q=nodeAt(b,j+direction);
   if(!p&&!q)score+=2;else if(same(p,q))score+=3;
  }
  if(same(a.nodes[i].in,b.nodes[j].in))score+=.1;
  if(same(a.nodes[i].out,b.nodes[j].out))score+=.1;
  return score;
 }
 function anchorMatcher(oldPath,newPath){
  const byCoordinate=new Map(),cache=new Map(),key=n=>`${n.x},${n.y}`;
  newPath.nodes.forEach((n,i)=>{const k=key(n);if(!byCoordinate.has(k))byCoordinate.set(k,[]);byCoordinate.get(k).push(i);});
  return i=>{
   if(cache.has(i))return cache.get(i);
   let best=-1,score=-Infinity;
   for(const j of byCoordinate.get(key(oldPath.nodes[i]))||[]){
    const s=neighborScore(oldPath,i,newPath,j)-1e-6*Math.abs(i/oldPath.nodes.length-j/newPath.nodes.length);
    if(s>score){score=s;best=j;}
   }
   cache.set(i,best);return best;
  };
 }
 function segmentSame(a,i,b,j){
  const p=a.nodes[i],q=nodeAt(a,i+1),r=b.nodes[j],s=nodeAt(b,j+1);
  return same(p,r)&&same(p.out,r.out)&&same(q.in,s.in)&&same(q,s);
 }
 // Refine every sampled local minimum, rather than only the best sample: loops
 // and very short subarcs can have more than one plausible nearest location.
 function project(G,path,point,indices){
  let best={index:0,t:0,distance:Infinity};
  for(const index of indices){
   const a=path.nodes[index],b=nodeAt(path,index+1),distance=t=>G.dist(G.at(a,b,t),point);
   const samples=64,ds=Array.from({length:samples+1},(_,j)=>distance(j/samples));
   const consider=initial=>{
    let t=initial;
    // Distance comparisons lose precision for a point far off the curve; a
    // few analytic stationary-point steps recover accurate projection t.
    if(t>0&&t<1)for(let step=0;step<6;step++){
     const q=G.at(a,b,t),u=1-t;
     const dx=3*(u*u*(a.out.x-a.x)+2*u*t*(b.in.x-a.out.x)+t*t*(b.x-b.in.x));
     const dy=3*(u*u*(a.out.y-a.y)+2*u*t*(b.in.y-a.out.y)+t*t*(b.y-b.in.y));
     const ddx=6*(u*(b.in.x-2*a.out.x+a.x)+t*(b.x-2*b.in.x+a.out.x));
     const ddy=6*(u*(b.in.y-2*a.out.y+a.y)+t*(b.y-2*b.in.y+a.out.y));
     const denominator=dx*dx+dy*dy+(q.x-point.x)*ddx+(q.y-point.y)*ddy;
     if(!(denominator>1e-20))break;
     const next=t-((q.x-point.x)*dx+(q.y-point.y)*dy)/denominator;
     if(next<0||next>1||!Number.isFinite(next))break;
     t=next;
    }
    const d=distance(t);if(d<best.distance)best={index,t,distance:d};
   };
   consider(0);consider(1);
   // A collapsed cubic has no unique t. Its exact anchor remains a safe answer.
   if(same(a,a.out)&&same(a,b.in)&&same(a,b))continue;
   for(let j=1;j<samples;j++)if(ds[j]<=ds[j-1]&&ds[j]<=ds[j+1]){
    let lo=(j-1)/samples,hi=(j+1)/samples;
    for(let k=0;k<64;k++){
     const u=lo+(hi-lo)/3,v=hi-(hi-lo)/3;
     if(distance(u)<=distance(v))hi=v;else lo=u;
    }
    consider((lo+hi)/2);
   }
   // Minima in the first/last sample interval also need refinement.
   for(const [start,end] of [[0,1/samples],[1-1/samples,1]]){
    let lo=start,hi=end;
    for(let k=0;k<64;k++){const u=lo+(hi-lo)/3,v=hi-(hi-lo)/3;if(distance(u)<=distance(v))hi=v;else lo=u;}
    consider((lo+hi)/2);
   }
  }
  return best;
 }
 function scale(path){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of path.nodes)for(const q of [p,p.in,p.out]){minX=Math.min(minX,q.x);minY=Math.min(minY,q.y);maxX=Math.max(maxX,q.x);maxY=Math.max(maxY,q.y);}
  return Math.hypot(maxX-minX,maxY-minY);
 }
 function stations(G,path,extra){
  const values=[{index:0,t:0,s:0}];let length=0;
  for(let index=0;index<G.segmentCount(path);index++){
   const a=path.nodes[index],b=nodeAt(path,index+1),ts=Array.from({length:32},(_,k)=>(k+1)/32);
   if(extra?.index===index)ts.push(extra.t);
   ts.sort((a,b)=>a-b);let previous=G.at(a,b,0);
   for(const t of ts){const p=G.at(a,b,t);length+=G.dist(previous,p);values.push({index,t,s:length});previous=p;}
  }
  return {values,length};
 }
 function relativeStation(G,oldPath,p,newPath){
  const old=stations(G,oldPath,p),next=stations(G,newPath),s=old.values.find(v=>v.index===p.index&&v.t===p.t)?.s||0;
  const fraction=old.length?s/old.length:(p.index+p.t)/G.segmentCount(oldPath),target=fraction*next.length;
  if(fraction<=0)return {index:0,t:0};
  if(fraction>=1)return {index:G.segmentCount(newPath)-1,t:1};
  if(!next.length){const value=fraction*G.segmentCount(newPath);return {index:Math.min(Math.floor(value),G.segmentCount(newPath)-1),t:value%1};}
  for(let k=1;k<next.values.length;k++){
   const a=next.values[k-1],b=next.values[k];if(b.s<target||b.s===a.s)continue;
   const lo=a.index===b.index?a.t:0;
   return {index:b.index,t:lo+(b.t-lo)*(target-a.s)/(b.s-a.s)};
  }
  return {index:G.segmentCount(newPath)-1,t:1};
 }
 function rebase(G,oldPath,points,newPath){
  const count=G.segmentCount(newPath);if(!count)throw Error('拟合范围需要至少一段曲线');
  const positions=points.map(p=>valid(G,oldPath,p)),order=reorder(oldPath,newPath),n=oldPath.nodes.length;
  if(order)return positions.map(p=>order.direction===1?{index:mod(order.shift+p.index,n),t:p.t}:{index:mod(order.shift-p.index-1,n),t:1-p.t});
  if(n===newPath.nodes.length&&!!oldPath.closed===!!newPath.closed)return positions.map(p=>({...p}));
  const match=anchorMatcher(oldPath,newPath),all=Array.from({length:count},(_,i)=>i);
  const anyAnchor=oldPath.nodes.some((_,i)=>match(i)>=0);
  return positions.map(p=>{
   if(p.t===0||p.t===1){
    const index=match((p.index+(p.t===1?1:0))%n);
    if(index>=0)return anchorPosition(newPath,index,p.t===1);
   }
   const start=match(p.index),end=match((p.index+1)%n);
   if(start>=0&&start<count&&end===(start+1)%newPath.nodes.length&&segmentSame(oldPath,p.index,newPath,start))return {index:start,t:p.t};
   let indices=all;
   if(start>=0&&end>=0&&start!==end&&(newPath.closed||start<end)){
    indices=[];for(let i=start;i!==end&&indices.length<count;i=(i+1)%newPath.nodes.length)indices.push(i);
   }
   const point=G.at(oldPath.nodes[p.index],nodeAt(oldPath,p.index+1),p.t),hit=project(G,newPath,point,indices);
   // A distant complete replacement has no spatial identity. Keep approximate
   // relative arc-length station (32 samples/segment) instead of collapsing a
   // whole range to one nearest end. Local edits/deletions use physical distance.
   if(!anyAnchor&&hit.distance>Math.max(scale(oldPath),scale(newPath),1)*.5)return relativeStation(G,oldPath,p,newPath);
   return {index:hit.index,t:hit.t};
  });
 }
 const api={rebase};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CurveFittingRange=api;
})(typeof globalThis!=='undefined'?globalThis:this);
