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
 function append(path,pos,mode){
  const previous=path.nodes.at(-1);path.nodes.push(node(pos.x,pos.y,mode));
  const index=path.nodes.length-1;setMode(path,index,path.nodes[index].mode);
  if(previous&&previous.mode!=='cusp'&&dist(previous,previous.in)<.01&&dist(previous,previous.out)<.01)setMode(path,index-1,previous.mode);
  return index;
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
 const api={node,point,mix,dist,at,reflectPoint,reflectPath,split,move,handle,setMode,append,segmentCount,segmentLength,pathLength,polylineLength,segmentRange,segmentD,pathD,nearest};
 if(typeof module!=='undefined')module.exports=api;else root.CurveGeometry=api;
})(typeof window!=='undefined'?window:globalThis);
