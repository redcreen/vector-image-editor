(function(root){
 'use strict';
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),point=p=>({x:p.x,y:p.y});
 const unit=(a,b)=>{const d=distance(a,b)||1;return {x:(b.x-a.x)/d,y:(b.y-a.y)/d};};
 const dot=(a,b)=>a.x*b.x+a.y*b.y;
 const luminance=c=>.2126*c[0]+.7152*c[1]+.0722*c[2];
 function pixel(im,x,y){
  const i=(y*im.width+x)*4,a=im.data[i+3]/255;
  return [0,1,2].map(k=>im.data[i+k]*a+255*(1-a));
 }
 function seedPixel(im,seed,radiusX,radiusY=radiusX){
  let found=null,best=Infinity;
  for(let y=Math.max(1,Math.floor(seed.y-radiusY));y<Math.min(im.height-1,seed.y+radiusY);y++)for(let x=Math.max(1,Math.floor(seed.x-radiusX));x<Math.min(im.width-1,seed.x+radiusX);x++){
   const d=Math.hypot((x-seed.x)/radiusX,(y-seed.y)/radiusY);if(d>1||im.data[(y*im.width+x)*4+3]<100)continue;
   const c=pixel(im,x,y),l=luminance(c),ring=[];
   for(const [dx,dy] of [[7,0],[-7,0],[0,7],[0,-7],[5,5],[-5,-5],[5,-5],[-5,5]]){
    const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<im.width&&ny<im.height)ring.push(luminance(pixel(im,nx,ny)));
   }
   ring.sort((a,b)=>a-b);const contrast=ring[Math.floor(ring.length/2)]-l;
   if(contrast<16)continue;
   const score=d*12-Math.min(60,contrast)*.03;if(score<best){best=score;found={x,y,color:c};}
  }
  if(!found)return null;
  // Anti-aliased edge pixels must not set the background as the target color.
  let darkest=luminance(found.color);
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
   const x=found.x+dx,y=found.y+dy;if(x<0||y<0||x>=im.width||y>=im.height||distance({x,y},found)>2.1)continue;
   const c=pixel(im,x,y),l=luminance(c);if(l<darkest&&im.data[(y*im.width+x)*4+3]>100){darkest=l;found.color=c;}
  }
  return found;
 }
 function skeleton(im,color,tolerance){
  const w=im.width,h=im.height,n=w*h,mask=new Uint8Array(n),indexes=[];
  const sourceL=luminance(color),maxL=sourceL+Math.min(30,tolerance*.8);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
   const i=y*w+x;if(im.data[i*4+3]<100)continue;const c=pixel(im,x,y);
   const l=luminance(c),delta=l-sourceL;
   if(l<=maxL&&Math.hypot(...c.map((v,k)=>v-color[k]-delta),delta*.7)<=tolerance){mask[i]=1;indexes.push(i);}
  }
  if(indexes.length>n*.3)return null;
  const offsets=[-w,-w+1,1,w+1,w,w-1,-1,-w-1];
  // Zhang-Suen thinning keeps the centerline topology and open endpoints.
  for(let round=0;round<48;round++){
   let changed=false;
   for(let phase=0;phase<2;phase++){
    const remove=[];
    for(const i of indexes){
     if(!mask[i])continue;const p=offsets.map(o=>mask[i+o]);const count=p.reduce((a,b)=>a+b,0);if(count<2||count>6)continue;
     let transitions=0;for(let k=0;k<8;k++)if(!p[k]&&p[(k+1)%8])transitions++;
     if(transitions!==1)continue;
     if(phase===0?(p[0]*p[2]*p[4]||p[2]*p[4]*p[6]):(p[0]*p[2]*p[6]||p[0]*p[4]*p[6]))continue;
     remove.push(i);
    }
    if(remove.length)changed=true;for(const i of remove)mask[i]=0;
   }
   if(!changed)break;
  }
  const neighbors=i=>{
   const list=[];
   for(let k=0;k<8;k++){
    const j=i+offsets[k];if(!mask[j])continue;
    // Avoid triangular shortcut edges at 90-degree corners.
    if(k%2&& (mask[i+offsets[(k+7)%8]]||mask[i+offsets[(k+1)%8]]))continue;
    list.push(j);
   }
   return list;
  };
  const seen=new Uint8Array(n),components=[];
  function walk(start,allowed){
   const queue=[start],previous=new Map([[start,null]]);let last=start;
   for(let q=0;q<queue.length;q++){last=queue[q];for(const j of neighbors(last))if(allowed.has(j)&&!previous.has(j)){previous.set(j,last);queue.push(j);}}
   return {last,previous};
  }
  for(const start of indexes){
   if(!mask[start]||seen[start])continue;const pixels=[start];seen[start]=1;
   for(let q=0;q<pixels.length;q++)for(const j of neighbors(pixels[q]))if(!seen[j]){seen[j]=1;pixels.push(j);}
   if(pixels.length<4)continue;
   const allowed=new Set(pixels),ends=pixels.filter(i=>neighbors(i).length===1);
   let ordered=[],closed=false;
   if(!ends.length&&pixels.every(i=>neighbors(i).length===2)){
    closed=true;let i=start,prev=null;
    do{ordered.push(i);const next=neighbors(i).find(j=>j!==prev);prev=i;i=next;}while(i!==start&&ordered.length<=pixels.length);
   }else{
    const a=walk(ends[0]??start,allowed).last,b=walk(a,allowed);let i=b.last;
    while(i!==null){ordered.push(i);i=b.previous.get(i);}
   }
   if(ordered.length<4)continue;
   components.push({points:ordered.map(i=>({x:i%w,y:Math.floor(i/w)})),closed});
   if(components.length>4000)return null;
  }
  return components;
 }
 function join(components,index,gap){
  function tangent(p,side){
   const samples=(side===0?p.slice(0,Math.min(8,p.length)).reverse():p.slice(-Math.min(8,p.length)));
   const middle=(samples.length-1)/2;let dx=0,dy=0;
   for(let k=0;k<samples.length;k++){dx+=(k-middle)*samples[k].x;dy+=(k-middle)*samples[k].y;}
   const length=Math.hypot(dx,dy)||1;return {x:dx/length,y:dy/length};
  }
  const endpoints=components.map(c=>{
   const p=c.points;
   return [{point:p[0],tangent:tangent(p,0)},{point:p.at(-1),tangent:tangent(p,1)}];
  }),links=new Map(),choices=[];
  for(let a=0;a<components.length;a++){
   if(components[a].closed)continue;
   for(let b=a+1;b<components.length;b++){
    if(components[b].closed)continue;
    for(let sa=0;sa<2;sa++)for(let sb=0;sb<2;sb++){
     const ea=endpoints[a][sa],eb=endpoints[b][sb],d=distance(ea.point,eb.point);if(d>gap||d<.5)continue;
     const direction=unit(ea.point,eb.point),ca=dot(ea.tangent,direction),cb=-dot(eb.tangent,direction);
     const tinyA=components[a].points.length<9,tinyB=components[b].points.length<9;
     if(ca<(tinyA?.12:.5)||cb<(tinyB?.12:.5)||Math.max(ca,cb)<.65)continue;
     choices.push({a:a*2+sa,b:b*2+sb,score:d*(1+2*(2-ca-cb))});
    }
   }
  }
  choices.sort((a,b)=>a.score-b.score);
  for(const c of choices)if(!links.has(c.a)&&!links.has(c.b)){links.set(c.a,c.b);links.set(c.b,c.a);}
  const chain=new Set([index]);let todo=[index];
  for(let q=0;q<todo.length;q++)for(const side of [0,1]){const link=links.get(todo[q]*2+side);if(link!==undefined&&!chain.has(Math.floor(link/2))){chain.add(Math.floor(link/2));todo.push(Math.floor(link/2));}}
  let start=index*2,closed=components[index].closed;
  if(!closed){const free=[...chain].flatMap(i=>[i*2,i*2+1]).find(i=>!links.has(i));closed=free===undefined;start=free??start;}
  const points=[],visited=new Set();let entry=start;
  while(!visited.has(Math.floor(entry/2))){
   const i=Math.floor(entry/2),side=entry%2;visited.add(i);points.push(...(side===0?components[i].points:components[i].points.slice().reverse()));
   const next=links.get(i*2+(1-side));if(next===undefined)break;entry=next;
  }
  return {points,closed,dashed:visited.size>1,segments:visited.size};
 }
 function simplify(points,error){
  if(points.length<=2)return points;
  const a=points[0],b=points.at(-1),dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;let max=error*error,index=-1;
  for(let i=1;i<points.length-1;i++){
   const p=points[i],t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
   const d=(p.x-a.x-t*dx)**2+(p.y-a.y-t*dy)**2;if(d>max){max=d;index=i;}
  }
  if(index===-1)return [a,b];
  return [...simplify(points.slice(0,index+1),error).slice(0,-1),...simplify(points.slice(index),error)];
 }
 function toNodes(points,closed,error){
  let anchors;
  if(closed){
   let split=1;for(let i=2;i<points.length;i++)if(distance(points[0],points[i])>distance(points[0],points[split]))split=i;
   anchors=[...simplify(points.slice(0,split+1),error).slice(0,-1),...simplify([...points.slice(split),points[0]],error).slice(0,-1)];
  }else anchors=simplify(points,error);
  return anchors.map((p,i)=>{
   const before=anchors[i-1]||(closed?anchors.at(-1):null),after=anchors[i+1]||(closed?anchors[0]:null);
   const n={...p,in:point(p),out:point(p),mode:'smooth'};
   const a=before?unit(before,p):after?unit(p,after):{x:0,y:0},b=after?unit(p,after):a;
   if(before&&after&&dot(a,b)<.45){n.mode='cusp';return n;}
   const d=Math.hypot(a.x+b.x,a.y+b.y)||1,t={x:(a.x+b.x)/d,y:(a.y+b.y)/d};
   if(before){const len=distance(before,p)/3;n.in={x:p.x-t.x*len,y:p.y-t.y*len};}
   if(after){const len=distance(p,after)/3;n.out={x:p.x+t.x*len,y:p.y+t.y*len};}
   return n;
  });
 }
 const caches=new WeakMap();
 function trace(im,seed,options={}){
  if(!im||im.width<3||im.height<3||im.data.length!==im.width*im.height*4||!Number.isFinite(seed?.x)||!Number.isFinite(seed?.y))return null;
  const rx=Math.max(.75,Math.min(30,options.radiusX??options.radius??12)),ry=Math.max(.75,Math.min(30,options.radiusY??options.radius??12));
  const s=seedPixel(im,seed,rx,ry);if(!s)return null;
  const tolerance=Math.max(8,Math.min(80,options.tolerance??30)),key=s.color.map(v=>Math.round(v/8)).join(',')+':'+tolerance;
  let cache=caches.get(im);if(!cache){cache=new Map();caches.set(im,cache);}
  let components=cache.get(key);
  if(components===undefined){components=skeleton(im,s.color,tolerance);if(cache.size>=4)cache.delete(cache.keys().next().value);cache.set(key,components);}
  if(!components?.length)return null;
  let index=-1,closest=Infinity;
  components.forEach((c,i)=>c.points.forEach(p=>{const d=distance(p,s);if(d<closest){closest=d;index=i;}}));
  if(closest>Math.max(5,options.radius??12))return null;
  const result=join(components,index,Math.max(0,Math.min(100,options.gap??18)));
  if(result.points.length<6)return null;
  result.nodes=toNodes(result.points,result.closed,Math.max(.5,Math.min(8,options.smoothing??2)));
  result.color='#'+s.color.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');return result;
 }
 const api={trace};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CurveTracing=api;
 if(typeof WorkerGlobalScope!=='undefined'&&root instanceof WorkerGlobalScope){
  let raster=null;
  root.onmessage=e=>{const {id,image,seed,options}=e.data;if(image)raster=image;try{root.postMessage({id,result:trace(raster,seed,options)});}catch(err){root.postMessage({id,error:err.message});}};
 }
})(typeof self!=='undefined'?self:globalThis);
