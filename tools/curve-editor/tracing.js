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

 // Fit outlines independently of line tracing. Each accepted cubic is bounded
 // against its corresponding polygon edges, not just against anchor samples.
 function outlineNodes(points,error){
  const samples=[];
  for(let i=0;i<points.length;i++){
   const a=points[i],b=points[(i+1)%points.length],count=Math.max(1,Math.ceil(distance(a,b)/2));
   for(let j=0;j<count;j++)samples.push({x:a.x+(b.x-a.x)*j/count,y:a.y+(b.y-a.y)*j/count});
  }
  samples.push(point(samples[0]));
  const total=samples.length-1,span=Math.max(3,Math.ceil(error*2)),tangents=[];
  for(let i=0;i<total;i++){
   let before=i,after=i,back=0,forward=0;
   while(back<span){const next=(before+total-1)%total;back+=distance(samples[before],samples[next]);before=next;if(before===i)break;}
   while(forward<span){const next=(after+1)%total;forward+=distance(samples[after],samples[next]);after=next;if(after===i)break;}
   const incoming=unit(samples[before],samples[i]),outgoing=unit(samples[i],samples[after]),smooth=unit(samples[before],samples[after]);
   tangents.push(dot(incoming,outgoing)<.5?{in:incoming,out:outgoing}:{in:smooth,out:smooth});
  }
  tangents.push(tangents[0]);
  function evaluate(c,t){const s=1-t;return {x:s*s*s*c[0].x+3*s*s*t*c[1].x+3*s*t*t*c[2].x+t*t*t*c[3].x,y:s*s*s*c[0].y+3*s*s*t*c[1].y+3*s*t*t*c[2].y+t*t*t*c[3].y};}
  function derivative(c,t){const s=1-t;return {x:3*(s*s*(c[1].x-c[0].x)+2*s*t*(c[2].x-c[1].x)+t*t*(c[3].x-c[2].x)),y:3*(s*s*(c[1].y-c[0].y)+2*s*t*(c[2].y-c[1].y)+t*t*(c[3].y-c[2].y))};}
  const curves=[],pending=[];
  // Four initial arcs avoid degenerate closed fits, including tiny objects.
  for(let k=3;k>=0;k--)pending.push([Math.floor(k*(samples.length-1)/4),Math.floor((k+1)*(samples.length-1)/4)]);
  while(pending.length){
   const [first,last]=pending.pop();if(last<=first)continue;
   const a=samples[first],b=samples[last],u=[0];
   for(let i=first+1;i<=last;i++)u.push(u.at(-1)+distance(samples[i-1],samples[i]));
   const length=u.at(-1);for(let i=1;i<u.length;i++)u[i]/=length;
   const ta=tangents[first].out,tb=tangents[last].in;
   let aa=0,ab=0,bb=0,ar=0,br=0;
   for(let i=0;i<u.length;i++){
    const t=u[i],s=1-t,v=3*s*s*t,w=3*s*t*t,p=samples[first+i];
    const x=p.x-(s*s*s+v)*a.x-(t*t*t+w)*b.x,y=p.y-(s*s*s+v)*a.y-(t*t*t+w)*b.y;
    aa+=v*v;ab-=v*w*dot(ta,tb);bb+=w*w;ar+=v*(ta.x*x+ta.y*y);br-=w*(tb.x*x+tb.y*y);
   }
   const det=aa*bb-ab*ab,chord=distance(a,b);
   const alpha=Math.max(0,Math.min(length,Math.abs(det)>1e-10?(ar*bb-br*ab)/det:chord/3));
   const beta=Math.max(0,Math.min(length,Math.abs(det)>1e-10?(br*aa-ar*ab)/det:chord/3));
   let c=[a,{x:a.x+ta.x*alpha,y:a.y+ta.y*alpha},{x:b.x-tb.x*beta,y:b.y-tb.y*beta},b];
   if(last-first===1)c=[a,point(a),point(b),b];
   let worst=0,split=Math.floor((first+last)/2);
   for(let i=0;i<u.length-1;i++){
    const t0=u[i],t1=u[i+1],dt=(t1-t0)/3,p=samples[first+i],q=samples[first+i+1];
    const v=evaluate(c,t0),w=evaluate(c,t1),dv=derivative(c,t0),dw=derivative(c,t1);
    // Restricted cubic minus the polygon edge is itself a cubic. The convex
    // hull of its four controls certifies the error throughout this interval.
    const bound=Math.max(distance(v,p),distance(w,q),
     Math.hypot(v.x+dv.x*dt-p.x-(q.x-p.x)/3,v.y+dv.y*dt-p.y-(q.y-p.y)/3),
     Math.hypot(w.x-dw.x*dt-p.x-2*(q.x-p.x)/3,w.y-dw.y*dt-p.y-2*(q.y-p.y)/3));
    if(bound>worst){worst=bound;split=Math.max(first+1,Math.min(last-1,first+i+1));}
   }
   if(worst<=error||last-first===1){curves.push(c);continue;}
   pending.push([split,last],[first,split]);
  }
  return curves.map((c,i)=>{
   const previous=curves[(i+curves.length-1)%curves.length],a=unit(previous[2],c[0]),b=unit(c[0],c[1]);
   return {...c[0],in:point(previous[2]),out:point(c[1]),mode:dot(a,b)>.995?'smooth':'cusp'};
  });
 }
 // Half-radius disk closing fills narrow inward gaps before opening removes
 // outward hairs. Work only on the selected component.
 function denoiseOutline(component,w,h,radius,start){
  const closeRadius=Math.max(1,Math.floor(radius/2)),pad=radius+closeRadius+1,x0=component.minX-pad,y0=component.minY-pad;
  const cw=component.maxX-component.minX+1+2*pad,ch=component.maxY-component.minY+1+2*pad;
  const mask=new Uint8Array(cw*ch);
  for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
   // Extend edge-contact objects beyond the frame during filtering.
   const sx=Math.max(0,Math.min(w-1,x+x0)),sy=Math.max(0,Math.min(h-1,y+y0));
   mask[y*cw+x]=component.mask[sy*w+sx];
  }
  function squaredDistance(input,target){
   const result=new Float64Array(input.length),size=Math.max(cw,ch),f=new Float64Array(size),d=new Float64Array(size),v=new Int32Array(size),z=new Float64Array(size+1);
   function transform(n){
    let k=0;v[0]=0;z[0]=-Infinity;z[1]=Infinity;
    for(let q=1;q<n;q++){
     let s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*(q-v[k]));
     while(s<=z[k]){k--;s=((f[q]+q*q)-(f[v[k]]+v[k]*v[k]))/(2*(q-v[k]));}
     k++;v[k]=q;z[k]=s;z[k+1]=Infinity;
    }
    k=0;for(let q=0;q<n;q++){while(z[k+1]<q)k++;d[q]=(q-v[k])**2+f[v[k]];}
   }
   for(let y=0;y<ch;y++){for(let x=0;x<cw;x++)f[x]=input[y*cw+x]===target?0:1e12;transform(cw);for(let x=0;x<cw;x++)result[y*cw+x]=d[x];}
   for(let x=0;x<cw;x++){for(let y=0;y<ch;y++)f[y]=result[y*cw+x];transform(ch);for(let y=0;y<ch;y++)result[y*cw+x]=d[y];}
   return result;
  }
  const dilated=new Uint8Array(mask.length),toMask=squaredDistance(mask,1),close2=closeRadius*closeRadius;
  for(let i=0;i<mask.length;i++)if(toMask[i]<=close2)dilated[i]=1;
  const closed=new Uint8Array(mask.length),toOutside=squaredDistance(dilated,0);
  for(let i=0;i<mask.length;i++)if(toOutside[i]>close2)closed[i]=1;
  const eroded=new Uint8Array(mask.length),toBackground=squaredDistance(closed,0),r2=radius*radius;let count=0;
  for(let i=0;i<mask.length;i++)if(toBackground[i]>r2){eroded[i]=1;count++;}
  if(!count)return component; // A filter larger than the whole object is a no-op.
  const toInterior=squaredDistance(eroded,1),clean=new Uint8Array(w*h);let nearest=-1,best=Infinity;
  const seed={x:start%w,y:Math.floor(start/w)};
  for(let y=component.minY;y<=component.maxY;y++)for(let x=component.minX;x<=component.maxX;x++){
   const i=y*w+x;
   if(toInterior[(y-y0)*cw+x-x0]<=r2){clean[i]=1;const d=(x-seed.x)**2+(y-seed.y)**2;if(d<best){best=d;nearest=i;}}
  }
  if(nearest<0)return component;
  const result=outlineComponent(clean,w,h,nearest);return result.pixels.length>=6?result:component;
 }

 function smoothOutline(points,radius){
  const lengths=[0];for(let i=0;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i],points[(i+1)%points.length]));
  const count=Math.max(4,Math.ceil(lengths.at(-1))),step=lengths.at(-1)/count,samples=[];
  const wrap=index=>((index%count)+count)%count;let edge=0;
  for(let i=0;i<count;i++){
   const length=i*step;while(edge+1<points.length&&lengths[edge+1]<length)edge++;
   const a=points[edge],b=points[(edge+1)%points.length],t=(length-lengths[edge])/(lengths[edge+1]-lengths[edge]);
   samples.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
  }
  let far=1;for(let i=2;i<points.length;i++)if(distance(points[0],points[i])>distance(points[0],points[far]))far=i;
  const coarse=[...simplify(points.slice(0,far+1),radius*.6).slice(0,-1),...simplify([...points.slice(far),points[0]],radius*.6).slice(0,-1)],corners=[];
  for(let i=0;i<coarse.length;i++){
   const a=coarse[(i+coarse.length-1)%coarse.length],b=coarse[i],c=coarse[(i+1)%coarse.length];
   if(Math.min(distance(a,b),distance(b,c))<radius*1.5||dot(unit(a,b),unit(b,c))>=.5)continue;
   let index=0;for(let j=1;j<count;j++)if(distance(samples[j],b)<distance(samples[index],b))index=j;
   if(!corners.includes(index))corners.push(index);
  }
  corners.sort((a,b)=>a-b);
  const reach=Math.ceil(radius*1.5/step),sigma=radius*.65/step,weights=Array.from({length:reach+1},(_,i)=>Math.exp(-i*i/(2*sigma*sigma))),result=[];
  for(let i=0;i<count;i++){
   let lo=-Infinity,hi=Infinity;
   if(corners.length){
    lo=(corners.filter(n=>n<=i).at(-1)??corners.at(-1)-count);hi=(corners.find(n=>n>=i)??corners[0]+count);
   }
   function at(j){
    if(j<lo){const p=samples[wrap(lo)],q=samples[wrap(Math.min(hi,2*lo-j))];return {x:2*p.x-q.x,y:2*p.y-q.y};}
    if(j>hi){const p=samples[wrap(hi)],q=samples[wrap(Math.max(lo,2*hi-j))];return {x:2*p.x-q.x,y:2*p.y-q.y};}
    return samples[wrap(j)];
   }
   if(lo===i||hi===i){result.push(point(samples[i]));continue;}
   let x=0,y=0,weight=0;
   for(let k=-reach;k<=reach;k++){const p=at(i+k),v=weights[Math.abs(k)];x+=p.x*v;y+=p.y*v;weight+=v;}
   result.push({x:x/weight,y:y/weight});
  }
  return result;
 }
 const outlineCaches=new WeakMap();
 function outlineBackground(im){
  const w=im.width,h=im.height,bins=new Map(),samples=[];
  function add(x,y){
   const i=(y*w+x)*4,c=[im.data[i],im.data[i+1],im.data[i+2],im.data[i+3]];
   const key=c.map(v=>Math.round(v/16)).join(',');bins.set(key,(bins.get(key)||0)+1);samples.push({key,c});
  }
  const stride=Math.max(1,Math.floor((w+h)/1000));
  for(let x=0;x<w;x+=stride){add(x,0);if(h>1)add(x,h-1);}
  for(let y=1;y<h-1;y+=stride){add(0,y);if(w>1)add(w-1,y);}
  let best=null,count=-1;for(const [key,n] of bins)if(n>count){best=key;count=n;}
  const chosen=samples.filter(s=>s.key===best),sum=[0,0,0,0];
  for(const s of chosen)for(let k=0;k<4;k++)sum[k]+=s.c[k];
  return sum.map(v=>v/chosen.length);
 }
 function outlineMask(im,tolerance){
  const background=outlineBackground(im),transparent=background[3]<64,n=im.width*im.height,mask=new Uint8Array(n),borderDistances=[],histogram=new Uint32Array(256);
  function colorDistance(p){
   const dr=im.data[p]-background[0],dg=im.data[p+1]-background[1],db=im.data[p+2]-background[2];
   return Math.sqrt(.2126*dr*dr+.7152*dg*dg+.0722*db*db);
  }
  if(!transparent){
   const stride=Math.max(1,Math.floor((im.width+im.height)/1000));
   for(let x=0;x<im.width;x+=stride){borderDistances.push(colorDistance(x*4),colorDistance(((im.height-1)*im.width+x)*4));}
   for(let y=1;y<im.height-1;y+=stride){borderDistances.push(colorDistance((y*im.width)*4),colorDistance((y*im.width+im.width-1)*4));}
   borderDistances.sort((a,b)=>a-b);
   for(let i=0;i<n;i++)histogram[Math.min(255,Math.round(colorDistance(i*4)))]++;
  }
  // Border variation is part of the background, even when the requested tolerance is lower.
  // The small margin prevents compression noise and faint shadows at the frame from becoming an object.
  let borderNoise=0;
  if(!transparent&&borderDistances.length){
   const median=borderDistances[Math.floor(borderDistances.length/2)],deviations=borderDistances.map(value=>Math.abs(value-median)).sort((a,b)=>a-b);
   const mad=deviations[Math.floor(deviations.length/2)];borderNoise=median+3*1.4826*mad;
  }
  let threshold=transparent?tolerance:Math.max(tolerance,borderNoise+7);
  const occupied=histogram.reduce((count,n)=>count+(n>0),0);
  if(!transparent&&occupied>32){
   let total=n,sum=0,lowCount=0,lowSum=0,bestScore=-1,automatic=0;
   for(let i=0;i<256;i++)sum+=i*histogram[i];
   for(let i=0;i<255;i++){
    lowCount+=histogram[i];lowSum+=i*histogram[i];const highCount=total-lowCount;if(!lowCount||!highCount)continue;
    const difference=lowSum/lowCount-(sum-lowSum)/highCount,score=lowCount*highCount*difference*difference;
    if(score>bestScore){bestScore=score;automatic=i;}
   }
   threshold=Math.max(threshold,automatic+7+(tolerance-30)*.5);
  }
  for(let i=0;i<n;i++){
   const p=i*4,a=im.data[p+3];
   if(transparent){mask[i]=a>Math.max(16,background[3]+16)?1:0;continue;}
   if(a<64)continue;
   if(colorDistance(p)>threshold)mask[i]=1;
  }
  return {mask,background};
 }
 function outlineSource(im,tolerance){
  let cache=outlineCaches.get(im);if(!cache){cache=new Map();outlineCaches.set(im,cache);}
  const key=Math.round(tolerance*2)/2;let source=cache.get(key);
  if(!source){source=outlineMask(im,tolerance);if(cache.size>=4)cache.delete(cache.keys().next().value);cache.set(key,source);}
  return source;
 }
 function nearestMaskPixel(mask,w,h,seed,radiusX,radiusY){
  let found=-1,best=Infinity;
  const x0=Math.max(0,Math.floor(seed.x-radiusX)),x1=Math.min(w-1,Math.ceil(seed.x+radiusX));
  const y0=Math.max(0,Math.floor(seed.y-radiusY)),y1=Math.min(h-1,Math.ceil(seed.y+radiusY));
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   if(!mask[y*w+x])continue;
   const dx=(x+.5-seed.x)/radiusX,dy=(y+.5-seed.y)/radiusY,d=dx*dx+dy*dy;
   if(d<=1&&d<best){best=d;found=y*w+x;}
  }
  return found;
 }
 function outlineComponent(mask,w,h,start){
  const component=new Uint8Array(mask.length),queue=[start];component[start]=1;
  let minX=start%w,maxX=minX,minY=Math.floor(start/w),maxY=minY;
  for(let q=0;q<queue.length;q++){
   const i=queue[q],x=i%w,y=Math.floor(i/w);
   if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
   if(x&&mask[i-1]&&!component[i-1]){component[i-1]=1;queue.push(i-1);}
   if(x+1<w&&mask[i+1]&&!component[i+1]){component[i+1]=1;queue.push(i+1);}
   if(y&&mask[i-w]&&!component[i-w]){component[i-w]=1;queue.push(i-w);}
   if(y+1<h&&mask[i+w]&&!component[i+w]){component[i+w]=1;queue.push(i+w);}
  }
  return {mask:component,pixels:queue,minX,maxX,minY,maxY};
 }
 function exteriorContour(component,w,h){
  const {mask,minX,maxX,minY,maxY}=component,x0=Math.max(0,minX-1),x1=Math.min(w-1,maxX+1),y0=Math.max(0,minY-1),y1=Math.min(h-1,maxY+1);
  const exterior=new Uint8Array(mask.length),queue=[];
  function add(x,y){const i=y*w+x;if(!mask[i]&&!exterior[i]){exterior[i]=1;queue.push(i);}}
  for(let x=x0;x<=x1;x++){add(x,y0);add(x,y1);}for(let y=y0+1;y<y1;y++){add(x0,y);add(x1,y);}
  for(let q=0;q<queue.length;q++){
   const i=queue[q],x=i%w,y=Math.floor(i/w);
   if(x>x0)add(x-1,y);if(x<x1)add(x+1,y);if(y>y0)add(x,y-1);if(y<y1)add(x,y+1);
  }
  const edges=[];
  function outside(x,y){return x<0||y<0||x>=w||y>=h||exterior[y*w+x];}
  for(const i of component.pixels){
   const x=i%w,y=Math.floor(i/w);
   if(outside(x,y-1))edges.push([x,y,x+1,y]);
   if(outside(x+1,y))edges.push([x+1,y,x+1,y+1]);
   if(outside(x,y+1))edges.push([x+1,y+1,x,y+1]);
   if(outside(x-1,y))edges.push([x,y+1,x,y]);
  }
  if(edges.length<4)return null;
  const starts=new Map();for(let i=0;i<edges.length;i++){const e=edges[i],key=e[0]+','+e[1];if(!starts.has(key))starts.set(key,[]);starts.get(key).push(i);}
  const used=new Uint8Array(edges.length),loops=[];
  for(let first=0;first<edges.length;first++){
   if(used[first])continue;const points=[];let index=first;
   while(index!==undefined&&!used[index]&&points.length<=edges.length){
    const e=edges[index];used[index]=1;points.push({x:e[0],y:e[1]});
    const candidates=starts.get(e[2]+','+e[3]);index=candidates?.find(i=>!used[i]);
   }
   if(points.length>=4)loops.push(points);
  }
  if(!loops.length)return null;
  const area=points=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0));
  let points=loops.sort((a,b)=>area(b)-area(a))[0],compact=[];
  for(let i=0;i<points.length;i++){
   const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];
   if((b.x-a.x)*(c.y-b.y)!==(b.y-a.y)*(c.x-b.x))compact.push(b);
  }
  return compact.length>=3?compact:points;
 }
 function traceOutline(im,seed,options={}){
  if(!im||im.width<2||im.height<2||im.data.length!==im.width*im.height*4||!Number.isFinite(seed?.x)||!Number.isFinite(seed?.y))return null;
  const tolerance=Math.max(0,Math.min(120,options.tolerance??30)),source=outlineSource(im,tolerance);
  const rx=Math.max(.75,Math.min(40,options.radiusX??options.radius??12)),ry=Math.max(.75,Math.min(40,options.radiusY??options.radius??12));
  const start=nearestMaskPixel(source.mask,im.width,im.height,seed,rx,ry);if(start<0)return null;
  if(!source.labels){source.labels=new Uint32Array(source.mask.length);source.components=new Map();source.nextId=1;}
  let id=source.labels[start],entry,component;
  if(id)entry=source.components.get(id);
  else{
   component=outlineComponent(source.mask,im.width,im.height,start);id=source.nextId++;
   for(const i of component.pixels)source.labels[i]=id;
   entry={points:component.pixels.length>=6?exteriorContour(component,im.width,im.height):null,denoised:new Map()};source.components.set(id,entry);
  }
  let points=entry.points;
  const denoise=Math.max(0,Math.min(24,Math.round(options.denoise??0)));
  if(points&&denoise){
   const cacheKey=denoise+':'+start;
   if(!entry.denoised.has(cacheKey)){
    component=component||outlineComponent(source.mask,im.width,im.height,start);
    const clean=denoiseOutline(component,im.width,im.height,denoise,start);
    if(entry.denoised.size>=3)entry.denoised.delete(entry.denoised.keys().next().value);
    const contour=exteriorContour(clean,im.width,im.height)||points;
    entry.denoised.set(cacheKey,clean===component?contour:smoothOutline(contour,denoise));
   }
   points=entry.denoised.get(cacheKey);
  }
  if(!points||points.length<3)return null;
  const nodes=outlineNodes(points,Math.max(.001,Math.min(12,options.smoothing??2)));if(nodes.length<3)return null;
  const p=start*4,color=[im.data[p],im.data[p+1],im.data[p+2]];
  return {points,nodes,closed:true,dashed:false,segments:1,color:'#'+color.map(v=>v.toString(16).padStart(2,'0')).join('')};
 }
 const caches=new WeakMap();
 function trace(im,seed,options={}){
  if(options.mode==='outline')return traceOutline(im,seed,options);
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
 const api={trace,traceOutline};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CurveTracing=api;
 if(typeof WorkerGlobalScope!=='undefined'&&root instanceof WorkerGlobalScope){
  let raster=null;
  root.onmessage=e=>{const {id,image,seed,options}=e.data;if(image)raster=image;try{root.postMessage({id,result:trace(raster,seed,options)});}catch(err){root.postMessage({id,error:err.message});}};
 }
})(typeof self!=='undefined'?self:globalThis);
