(function(root){
 'use strict';
 const EPS=1e-9;
 const point=p=>({x:p.x,y:p.y});
 const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
 function copy(value){
  if(Array.isArray(value))return value.map(copy);
  if(value&&typeof value==='object'){const out={};for(const k of Object.keys(value))out[k]=copy(value[k]);return out;}
  return value;
 }
 const idValid=id=>typeof id==='string'&&id.trim().length>0;
 function unit(a,b){
  if(!finite(a)||!finite(b))return null;
  const x=b.x-a.x,y=b.y-a.y,length=Math.hypot(x,y);return length>EPS?{x:x/length,y:y/length}:null;
 }
 function ordered(path,indices){
  const n=path?.nodes?.length||0,set=new Set(indices);
  if(set.size<3||set.size!==indices.length||[...set].some(i=>!Number.isInteger(i)||i<0||i>=n)||path.closed&&set.size===n)return null;
  const starts=[...set].filter(i=>i===0&&!path.closed||!set.has((i+n-1)%n));
  if(starts.length!==1)return null;
  const out=[];for(let j=0;j<set.size;j++){const index=(starts[0]+j)%n;if(!set.has(index))return null;out.push(index);}
  return out;
 }
 function describe(path,id,indices){
  const ns=path.nodes,start=indices[0],end=indices.at(-1),a=ns[start],b=ns[end];
  if(indices.some(i=>!finite(ns[i])))return null;
  let tangent=unit(a,b);
  // A zero-width slit has no mouth chord: use the incoming seam direction,
  // then the outgoing one. An isolated collapsed seam has no usable frame.
  if(!tangent){
   const previous=start>0?ns[start-1]:path.closed?ns.at(-1):null,next=end<ns.length-1?ns[end+1]:path.closed?ns[0]:null;
   if(previous)tangent=unit(a.in,a)||unit(previous.out,a)||unit(previous,a);
   if(!tangent&&next)tangent=unit(b,b.out)||unit(b,next.in)||unit(b,next);
  }
  if(!tangent)return null;
  return {id,indices,start,end,anchor:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},tangent,width:Math.hypot(b.x-a.x,b.y-a.y)};
 }
 function groups(path){
  const byId=new Map();
  for(const [index,node] of (path?.nodes||[]).entries())if(idValid(node.notchId)){if(!byId.has(node.notchId))byId.set(node.notchId,[]);byId.get(node.notchId).push(index);}
  const out=[];
  for(const [id,selected] of byId){const indices=ordered(path,selected);if(indices){const group=describe(path,id,indices);if(group)out.push(group);}}
  return out.sort((a,b)=>a.start-b.start);
 }
 function baseline(G,path){
  const out=copy(path);
  for(const group of groups(path)){
   const a=path.nodes[group.start],b=path.nodes[group.end],last=group.indices.length-1;
   const dx=b.x-a.x,dy=b.y-a.y,squared=dx*dx+dy*dy,stations=new Array(last+1).fill(0),blocks=[];
   // Project onto the mouth, never distribute by node count. Extra points on a
   // notch edge must not move its tip along the seam. Isotonic projection keeps
   // folded internal details from adding backtracking length, in either direction.
   for(let j=1;j<last;j++){
    const n=path.nodes[group.indices[j]],value=squared>EPS*EPS?Math.max(0,Math.min(1,((n.x-a.x)*dx+(n.y-a.y)*dy)/squared)):0;
    blocks.push({first:j,last:j,sum:value,count:1});
    while(blocks.length>1){const right=blocks.at(-1),left=blocks.at(-2);if(left.sum/left.count<=right.sum/right.count)break;blocks.pop();blocks.pop();blocks.push({first:left.first,last:right.last,sum:left.sum+right.sum,count:left.count+right.count});}
   }
   for(const block of blocks)for(let j=block.first;j<=block.last;j++)stations[j]=block.sum/block.count;
   stations[last]=1;
   for(const [j,index] of group.indices.entries()){
    const n=out.nodes[index],t=stations[j];n.x=a.x+dx*t;n.y=a.y+dy*t;
    if(j>0)n.in=point(n);if(j<last)n.out=point(n);
   }
  }
  return out;
 }
 function define(G,path,selected,id){
  if(!idValid(id)||!Array.isArray(selected))throw new RangeError('请选择至少三个连续节点，并提供有效剪口标识');
  const indices=ordered(path,selected);
  if(!indices)throw new RangeError('剪口需要至少三个连续节点，不能占满闭合轮廓');
  const set=new Set(indices);
  for(const [i,n] of path.nodes.entries()){
   if(set.has(i)&&n.notchId!==undefined&&n.notchId!==id)throw new RangeError('所选节点已属于其他剪口');
   if(!set.has(i)&&n.notchId===id)throw new RangeError('剪口标识已用于其他节点');
  }
  const group=describe(path,id,indices);
  if(!group)throw new RangeError('剪口缺少有效的原缝边方向');
  for(const i of indices)path.nodes[i].notchId=id;
  return group;
 }
 function clear(path,indices){
  const ids=new Set(indices.map(i=>path.nodes[i]?.notchId).filter(idValid));let count=0;
  for(const n of path.nodes)if(ids.has(n.notchId)){delete n.notchId;count++;}
  return count;
 }
 function frame(value){
  const origin=value?.point||value,axis=value?.tangent,tangent=unit({x:0,y:0},axis);
  if(!finite(origin)||!tangent)throw new RangeError('剪口移动需要有效的位置和方向');
  return {point:origin,tangent};
 }
 function rigid(G,path,group,fromFrame,toFrame){
  const current=groups(path).find(g=>g.id===group?.id);
  if(!current||!Array.isArray(group.indices)||current.indices.length!==group.indices.length||current.indices.some((i,j)=>i!==group.indices[j]))throw new RangeError('剪口节点已改变，请重新选择');
  const from=frame(fromFrame),to=frame(toFrame),c=from.tangent.x*to.tangent.x+from.tangent.y*to.tangent.y,s=from.tangent.x*to.tangent.y-from.tangent.y*to.tangent.x;
  const transform=p=>{const x=p.x-from.point.x,y=p.y-from.point.y;return {x:to.point.x+c*x-s*y,y:to.point.y+s*x+c*y};},out=copy(path);
  for(const i of current.indices){const n=out.nodes[i],anchor=transform(n),incoming=transform(n.in),outgoing=transform(n.out);n.x=anchor.x;n.y=anchor.y;n.in={...n.in,...incoming};n.out={...n.out,...outgoing};}
  return out;
 }
 // Insert real contour geometry, so all vector exporters and notch fitting use
 // the same three-node feature. Work on a copy; rejected edits are atomic.
 function insert(G,path,hit,{id,mmPerUnit=null}={}){
  const count=G.segmentCount(path);
  if(!idValid(id)||!Number.isInteger(hit?.index)||hit.index<0||hit.index>=count||!Number.isFinite(hit.t)||hit.t<0||hit.t>1)throw new RangeError('请选择曲线上的有效位置');
  if(path.nodes.some(n=>n.symmetry))throw new RangeError('请先解除对称关联，再增加剪口');
  if(path.nodes.some(n=>n.notchId===id))throw new RangeError('剪口标识已存在');
  const lengths=Array.from({length:count},(_,i)=>G.segmentLength(path,i)),starts=[0];
  for(const length of lengths)starts.push(starts.at(-1)+length);
  const total=starts.at(-1);
  if(!(total>1e-6))throw new RangeError('曲线长度太小，无法增加剪口');
  function partial(i,t){
   if(t<=0)return 0;if(t>=1)return lengths[i];
   const part={closed:false,nodes:[copy(path.nodes[i]),copy(path.nodes[(i+1)%path.nodes.length])]};G.split(part,0,t);return G.segmentLength(part,0,1e-7);
  }
  const station=starts[hit.index]+partial(hit.index,hit.t),wrap=s=>(s%total+total)%total;
  if(!path.closed&&Math.min(station,total-station)<1e-6)throw new RangeError('端点没有两侧缝边，请在曲线内部增加剪口');
  function location(s){
   s=path.closed?wrap(s):s;
   let i=0;while(i<count-1&&starts[i+1]<s)i++;
   const wanted=s-starts[i];if(wanted<1e-8)return {index:i,t:0};if(lengths[i]-wanted<1e-8)return {index:i,t:1};
   let lo=0,hi=1;for(let k=0;k<38;k++){const mid=(lo+hi)/2;if(partial(i,mid)<wanted)lo=mid;else hi=mid;}
   return {index:i,t:(lo+hi)/2};
  }
  const bounds=G.pathBounds(path),size=Math.max(bounds.width,bounds.height);
  let width=size*.015;
  if(Number.isFinite(mmPerUnit)&&mmPerUnit>0)width=Math.max(.8,Math.min(3,width*mmPerUnit))/mmPerUnit;
  width=Math.min(width,total*.04);
  if(!path.closed)width=Math.min(width,Math.min(station,total-station)*1.6);
  // Existing notch spans (including a wraparound group) are protected; even a
  // mouth endpoint is excluded so two features never share a marked node.
  for(const g of groups(path)){
   const start=starts[g.start],end=g.end>g.start?starts[g.end]:starts[g.end]+total;
   let s=station;if(path.closed&&s<start)s+=total;
   if(s>=start-1e-7&&s<=end+1e-7)throw new RangeError('这里已有剪口，请选择其他位置');
   const distance=path.closed?Math.min(wrap(start-station),wrap(station-end)):Math.min(Math.abs(station-start),Math.abs(station-end));
   width=Math.min(width,distance*1.6);
  }
  // Sample only for winding and opposite-edge clearance, never to replace the
  // surviving Beziers. Their handles are retained by exact subdivision below.
  const polygon=[];if(path.closed)for(let i=0;i<count;i++)for(let k=0;k<24;k++)polygon.push(G.at(path.nodes[i],path.nodes[(i+1)%path.nodes.length],k/24));
  let area=0;for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];area+=a.x*b.y-b.x*a.y;}
  if(path.closed&&Math.abs(area)<1e-9)throw new RangeError('闭合曲线方向不明确，无法确定剪口朝内方向');
  let lo,hi,a,b,tip,actualWidth;
  for(let attempt=0;attempt<16;attempt++){
   if(!(width>1e-6))throw new RangeError('此处空间太小，请换一个位置增加剪口');
   lo=location(station-width/2);hi=location(station+width/2);
   a=G.at(path.nodes[lo.index],path.nodes[(lo.index+1)%path.nodes.length],lo.t);b=G.at(path.nodes[hi.index],path.nodes[(hi.index+1)%path.nodes.length],hi.t);
   actualWidth=G.dist(a,b);if(actualWidth<1e-6)throw new RangeError('此处曲线方向不明确，请换一个位置');
   const mid=G.mix(a,b,.5),sign=path.closed&&area<0?-1:1,normal={x:-(b.y-a.y)/actualWidth*sign,y:(b.x-a.x)/actualWidth*sign};
   let clearance=Infinity;
   for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length],dx=q.x-p.x,dy=q.y-p.y,den=normal.x*dy-normal.y*dx;
    if(Math.abs(den)<1e-12)continue;
    const vx=p.x-mid.x,vy=p.y-mid.y,t=(vx*dy-vy*dx)/den,u=(vx*normal.y-vy*normal.x)/den;
    if(t>1e-7&&u>=0&&u<=1)clearance=Math.min(clearance,t);
   }
   if(actualWidth>clearance*.65){width*=.5;continue;}
   tip={x:mid.x+normal.x*actualWidth,y:mid.y+normal.y*actualWidth};break;
  }
  if(!tip)throw new RangeError('此处空间不足，请换一个位置增加剪口');
  const out=copy(path),originalNodes=out.nodes.slice(),order=p=>p.index+p.t;
  // Split in descending original parameter order so indices remain stable.
  const cuts=[{...lo,key:'lo'},{...hi,key:'hi'}].sort((a,b)=>order(b)-order(a)),mouth={};
  for(let k=0;k<cuts.length;k++){
   const c=cuts[k];let index;
   if(c.t<1e-10)index=c.index;
   else if(c.t>1-1e-10)index=(c.index+1)%out.nodes.length;
   else {let t=c.t;if(k&&cuts[0].index===c.index&&cuts[0].t<1-1e-10)t/=cuts[0].t;index=G.split(out,c.index,t);}
   mouth[c.key]=out.nodes[index];
  }
  const start=out.nodes.indexOf(mouth.lo),end=out.nodes.indexOf(mouth.hi),middle=G.node(tip.x,tip.y);
  if(start<end)out.nodes.splice(start+1,end-start-1,middle);
  else out.nodes=[...out.nodes.slice(end,start+1),middle];
  mouth.lo.out=point(mouth.lo);mouth.hi.in=point(mouth.hi);mouth.lo.mode=mouth.hi.mode='cusp';
  for(const node of [mouth.lo,middle,mouth.hi])node.notchId=id;
  if(out.nodes.length>10000)throw new RangeError('增加剪口后节点不能超过 10000 个');
  const group=groups(out).find(g=>g.id===id);if(!group)throw new RangeError('此处无法形成有效剪口');
  return {path:out,indices:group.indices,nodeMap:originalNodes.map(n=>out.nodes.indexOf(n)),width:actualWidth,depth:actualWidth};
 }
 const api={groups,baseline,define,clear,rigid,project:rigid,insert};
 if(typeof module!=='undefined')module.exports=api;else root.CurveNotches=api;
})(typeof window!=='undefined'?window:globalThis);
