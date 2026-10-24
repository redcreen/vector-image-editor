(function(root){
 'use strict';
 const MAX_NODES=10000,MAX_FLAT_POINTS=100000;
 const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,clone(item)])):value;
 const point=p=>({x:p.x,y:p.y}),finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y),sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
 const dot=(a,b)=>a.x*b.x+a.y*b.y,cross=(a,b)=>a.x*b.y-a.y*b.x,length=v=>Math.hypot(v.x,v.y),distance=(a,b)=>length(sub(a,b));
 const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
 const cubic=(c,t)=>{const u=1-t;return {x:u**3*c[0].x+3*u*u*t*c[1].x+3*u*t*t*c[2].x+t**3*c[3].x,y:u**3*c[0].y+3*u*u*t*c[1].y+3*u*t*t*c[2].y+t**3*c[3].y};};
 function validate(path,options){
  if(!path||!Array.isArray(path.nodes)||path.nodes.length<(path.closed?3:2)||path.nodes.length>MAX_NODES)throw new RangeError('曲线节点数量无效');
  if(path.nodes.some(n=>![n,n.in,n.out].every(finite)))throw new RangeError('曲线包含无效坐标');
  const tolerance=options&&options.tolerancePx;
  if(!Number.isFinite(tolerance)||tolerance<=0)throw new RangeError('必须提供大于零的有限允许偏差');
  if(options.protectedIndices!==undefined&&!Array.isArray(options.protectedIndices))throw new RangeError('必经点列表无效');
  for(const i of options.protectedIndices||[])if(!Number.isInteger(i)||i<0||i>=path.nodes.length)throw new RangeError('必经点索引无效');
 }
 function controls(nodes,i,closed){const a=nodes[i],b=nodes[(i+1)%nodes.length];return [a,a.out,b.in,b];}
 function tangent(nodes,index,side,closed){
  const n=nodes.length,p=nodes[index],control=side==='in'?p.in:p.out,v=side==='in'?sub(p,control):sub(control,p);
  if(length(v)>1e-12)return v;
  const other=nodes[(index+(side==='in'?-1:1)+n)%n];
  if(!closed&&(index===0&&side==='in'||index===n-1&&side==='out'))return null;
  return side==='in'?sub(p,other):sub(other,p);
 }
 function sharp(nodes,index,closed){
  if(!closed&&(index===0||index===nodes.length-1))return false;
  const a=tangent(nodes,index,'in',closed),b=tangent(nodes,index,'out',closed);
  if(!a||!b||length(a)<=1e-12||length(b)<=1e-12)return false;
  return dot(a,b)/(length(a)*length(b))<Math.cos(.22);
 }
 function fitRange(nodes,indices,fixedStart,fixedEnd){
  const first=clone(nodes[indices[0]]),last=clone(nodes[indices.at(-1)]),span=indices.length-1,samples=[],weights=Array(span);
  weights[0]=Math.max(1e-12,distance(nodes[indices[0]],nodes[indices[1]]));
  let inferred=true;
  for(let k=1;k<span;k++){const pivot=nodes[indices[k]],incoming=length(sub(pivot,pivot.in)),outgoing=length(sub(pivot.out,pivot));if(incoming<=1e-12||outgoing<=1e-12){inferred=false;break;}weights[k]=weights[k-1]*outgoing/incoming;if(!Number.isFinite(weights[k])||weights[k]/weights[0]>1e12||weights[k]/weights[0]<1e-12){inferred=false;break;}}
  if(!inferred)for(let k=0;k<span;k++)weights[k]=Math.max(1e-12,distance(nodes[indices[k]],nodes[indices[k+1]]));
  const total=weights.reduce((sum,value)=>sum+value,0);let elapsed=0;
  for(let k=0;k<span;k++){for(let j=0;j<=(k===span-1?8:7);j++){const s=j/8,t=(elapsed+s*weights[k])/total,c=controls(nodes,indices[k],true);samples.push({p:cubic(c,s),t});}elapsed+=weights[k];}
  let c1=fixedStart?point(first.out):null,c2=fixedEnd?point(last.in):null;
  const unknown=[];if(!c1)unknown.push(1);if(!c2)unknown.push(2);
  if(unknown.length){
   let aa=0,ab=0,bb=0,rax=0,ray=0,rbx=0,rby=0;
   for(const {p,t} of samples){const u=1-t,b0=u**3,b1=3*u*u*t,b2=3*u*t*t,b3=t**3;let rx=p.x-b0*first.x-b3*last.x,ry=p.y-b0*first.y-b3*last.y;if(c1){rx-=b1*c1.x;ry-=b1*c1.y;}if(c2){rx-=b2*c2.x;ry-=b2*c2.y;}
    if(unknown.length===2){aa+=b1*b1;ab+=b1*b2;bb+=b2*b2;rax+=b1*rx;ray+=b1*ry;rbx+=b2*rx;rby+=b2*ry;}
    else {const basis=unknown[0]===1?b1:b2;aa+=basis*basis;rax+=basis*rx;ray+=basis*ry;}
   }
   if(unknown.length===2){const determinant=aa*bb-ab*ab;if(Math.abs(determinant)<1e-18)return null;c1={x:(rax*bb-rbx*ab)/determinant,y:(ray*bb-rby*ab)/determinant};c2={x:(aa*rbx-ab*rax)/determinant,y:(aa*rby-ab*ray)/determinant};}
   else {if(aa<1e-18)return null;const value={x:rax/aa,y:ray/aa};if(unknown[0]===1)c1=value;else c2=value;}
  }
  if(!finite(c1)||!finite(c2))return null;first.out=c1;last.in=c2;return [first,last];
 }
 // Each accepted chord is compared with the same-parameter linear Bezier.
 // The convex hull of the four difference controls is therefore a rigorous
 // symmetric upper bound between that curve piece and its chord.
 function flatten(path,error){
  const out=[point(path.nodes[0])];
  function visit(c,depth){
   const l1=mix(c[0],c[3],1/3),l2=mix(c[0],c[3],2/3),bound=Math.max(distance(c[1],l1),distance(c[2],l2));
   if(bound<=error){out.push(point(c[3]));return;}
   if(depth>=30||out.length>=MAX_FLAT_POINTS)throw new RangeError('曲线过于复杂，无法在当前偏差下验证');
   const a=mix(c[0],c[1],.5),b=mix(c[1],c[2],.5),d=mix(c[2],c[3],.5),e=mix(a,b,.5),f=mix(b,d,.5),m=mix(e,f,.5);
   visit([c[0],a,e,m],depth+1);visit([m,f,d,c[3]],depth+1);
  }
  const count=path.closed?path.nodes.length:path.nodes.length-1;for(let i=0;i<count;i++)visit(controls(path.nodes,i,path.closed),0);
  if(path.closed){out.pop();while(out.length>1&&distance(out[0],out.at(-1))<=1e-12)out.pop();}return out;
 }
 function segmentIndex(points,closed){
  const count=points.length-(closed?0:1),edges=Array.from({length:count},(_,i)=>{const a=points[i],b=points[(i+1)%points.length];return {a,b,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};});
  const build=items=>{const box={minX:Math.min(...items.map(e=>e.minX)),maxX:Math.max(...items.map(e=>e.maxX)),minY:Math.min(...items.map(e=>e.minY)),maxY:Math.max(...items.map(e=>e.maxY))};if(items.length<=8)return {...box,edges:items};const axis=box.maxX-box.minX>box.maxY-box.minY?'X':'Y';items.sort((a,b)=>a['min'+axis]+a['max'+axis]-b['min'+axis]-b['max'+axis]);const middle=items.length>>1;return {...box,left:build(items.slice(0,middle)),right:build(items.slice(middle))};};
  const tree=build(edges),boxDistance=(p,b)=>Math.hypot(Math.max(0,b.minX-p.x,p.x-b.maxX),Math.max(0,b.minY-p.y,p.y-b.maxY));
  const edgeDistance=(p,e)=>{const v=sub(e.b,e.a),den=dot(v,v),t=den?Math.max(0,Math.min(1,dot(sub(p,e.a),v)/den)):0;return distance(p,{x:e.a.x+v.x*t,y:e.a.y+v.y*t});};
  function nearest(p,wantEdge){let best=Infinity,bestEdge=null;const visit=node=>{if(boxDistance(p,node)>=best)return;if(node.edges){for(const edge of node.edges){const d=edgeDistance(p,edge);if(d<best){best=d;bestEdge=edge;}}}else{const pair=boxDistance(p,node.left)<=boxDistance(p,node.right)?[node.left,node.right]:[node.right,node.left];visit(pair[0]);visit(pair[1]);}};visit(tree);return wantEdge?bestEdge:best;}
  return {edges,edgeDistance,nearest:p=>nearest(p,false),nearestEdge:p=>nearest(p,true)};
 }
 function polygonDistance(a,b,tolerance,closed,budget=500000){
  const ai=segmentIndex(a,closed),bi=segmentIndex(b,closed);let evaluations=0,maxBound=0;
  function directed(source,target){
   const measure=p=>++evaluations>budget?Infinity:target.nearest(p);
   function interval(a,b,da,db,depth=0){
    if(da>tolerance||db>tolerance)return false;const span=distance(a,b),bound=(da+db+span)/2;
    if(bound<=tolerance){maxBound=Math.max(maxBound,bound);return true;}
    const middle=mix(a,b,.5),edge=target.nearestEdge(middle);
    if(edge){const upper=Math.max(target.edgeDistance(a,edge),target.edgeDistance(b,edge));if(upper<=tolerance){maxBound=Math.max(maxBound,upper);return true;}}
    if(depth>=30)return false;const dm=measure(middle);return interval(a,middle,da,dm,depth+1)&&interval(middle,b,dm,db,depth+1);
   }
   for(const edge of source.edges)if(!interval(edge.a,edge.b,measure(edge.a),measure(edge.b)))return false;return true;
  }
  return {accepted:directed(ai,bi)&&directed(bi,ai),maxBound,evaluations};
 }
 function certify(original,candidate,tolerance){
  const flattenError=tolerance/32,limit=tolerance-2*flattenError,a=flatten(original,flattenError),b=flatten(candidate,flattenError),check=polygonDistance(a,b,limit,original.closed);
  return {accepted:check.accepted,maxDeviationPx:check.accepted?Math.min(tolerance,check.maxBound+2*flattenError):Infinity,a,b};
 }
 function intersects(points,closed){
  // Zero-length edges do not change topology. Remove their duplicate vertices
  // before assigning adjacency indices, otherwise the two adjoining edges are
  // mistaken for non-neighbours intersecting at the repeated anchor.
  points=points.filter((p,i)=>!i||p.x!==points[i-1].x||p.y!==points[i-1].y);
  if(closed&&points.length>1&&points[0].x===points.at(-1).x&&points[0].y===points.at(-1).y)points.pop();
  const count=points.length-(closed?0:1),edges=Array.from({length:count},(_,i)=>{const a=points[i],b=points[(i+1)%points.length];return {i,a,b,minX:Math.min(a.x,b.x),maxX:Math.max(a.x,b.x),minY:Math.min(a.y,b.y),maxY:Math.max(a.y,b.y)};}).sort((a,b)=>a.minX-b.minX);
  const lineDistance=(p,a,b)=>{const v=sub(b,a),den=dot(v,v),t=den?Math.max(0,Math.min(1,dot(sub(p,a),v)/den)):0;return distance(p,{x:a.x+v.x*t,y:a.y+v.y*t});};
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length&&edges[j].minX<=edges[i].maxX+1e-10;j++){
   const a=edges[i],b=edges[j];if(Math.abs(a.i-b.i)===1||closed&&Math.abs(a.i-b.i)===count-1||a.maxY<b.minY-1e-10||b.maxY<a.minY-1e-10)continue;
   const d=sub(a.b,a.a),e=sub(b.b,b.a),q=sub(b.a,a.a),den=cross(d,e);
   if(Math.abs(den)>1e-14){const t=cross(q,e)/den,u=cross(q,d)/den;if(t>=-1e-10&&t<=1+1e-10&&u>=-1e-10&&u<=1+1e-10)return true;}
   else if(lineDistance(b.a,a.a,a.b)<1e-10||lineDistance(b.b,a.a,a.b)<1e-10||lineDistance(a.a,b.a,b.b)<1e-10)return true;
  }return false;
 }
 function simplifyPath(path,options={}){
  validate(path,options);const original=clone(path),nodes=original.nodes,n=nodes.length,tolerance=options.tolerancePx,rigid=new Set(options.protectedIndices||[]),anchors=new Set(rigid);
  nodes.forEach((item,i)=>{if(item.notchId!==undefined||item.color!==undefined||sharp(nodes,i,!!path.closed)){rigid.add(i);anchors.add(i);}});
  // A notch is a rigid feature: its marked nodes and both boundary segments are
  // copied byte-for-byte. Colored and caller-protected nodes keep both handles.
  nodes.forEach((item,i)=>{if(item.notchId!==undefined){for(const j of [(i+n-1)%n,(i+1)%n]){rigid.add(j);anchors.add(j);}}});
  if(!path.closed){anchors.add(0);anchors.add(n-1);}else if(anchors.size<3){anchors.add(0);anchors.add(Math.floor(n/3));anchors.add(Math.floor(2*n/3));}
  const ordered=[...anchors].sort((a,b)=>a-b),pieces=[];if(path.closed)ordered.push(ordered[0]+n);
  function range(start,end){const indices=[];for(let i=start;i<=end;i++)indices.push(i%n);return indices;}
  function reduce(indices){
   if(indices.length<=2)return clone(indices.map(i=>nodes[i]));
   const candidateNodes=fitRange(nodes,indices,rigid.has(indices[0]),rigid.has(indices.at(-1)));
   if(candidateNodes)try{const source={closed:false,nodes:indices.map(i=>nodes[i])},candidate={closed:false,nodes:candidateNodes},result=certify(source,candidate,tolerance);if(result.accepted)return candidateNodes;}catch(error){if(!(error instanceof RangeError))throw error;}
   const middle=Math.floor((indices.length-1)/2),left=reduce(indices.slice(0,middle+1)),right=reduce(indices.slice(middle));left.at(-1).out=clone(right[0].out);return left.concat(right.slice(1));
  }
  if(path.closed){for(let i=0;i<ordered.length-1;i++)pieces.push(reduce(range(ordered[i],ordered[i+1])));}else for(let i=0;i<ordered.length-1;i++)pieces.push(reduce(range(ordered[i],ordered[i+1])));
  let simplified=[];for(const piece of pieces){if(!simplified.length)simplified=piece;else{simplified.at(-1).out=clone(piece[0].out);simplified.push(...piece.slice(1));}}
  if(path.closed){const duplicate=simplified.pop();simplified[0].in=clone(duplicate.in);}
  const sameGeometry=(a,b)=>a.x===b.x&&a.y===b.y&&a.in.x===b.in.x&&a.in.y===b.in.y&&a.out.x===b.out.x&&a.out.y===b.out.y;
  for(const item of simplified){
   if([...rigid].some(i=>sameGeometry(item,nodes[i]))||!['smooth','symmetric'].includes(item.mode))continue;
   const incoming=sub(item,item.in),outgoing=sub(item.out,item),a=length(incoming),b=length(outgoing),aligned=a>1e-12&&b>1e-12&&dot(incoming,outgoing)>0&&Math.abs(cross(incoming,outgoing))<=1e-9*a*b;
   if(!aligned)item.mode='cusp';else if(item.mode==='symmetric'&&Math.abs(a-b)>1e-9*Math.max(1,a,b))item.mode='smooth';
  }
  const candidate={...clone(original),nodes:simplified},changed=simplified.length<n;
  if(!changed)return {path:original,before:n,after:n,maxDeviationPx:0,changed:false};
  let final;try{final=certify(original,candidate,tolerance);}catch(error){if(!(error instanceof RangeError))throw error;return {path:original,before:n,after:n,maxDeviationPx:0,changed:false};}
  const originalCross=intersects(final.a,!!path.closed),candidateCross=intersects(final.b,!!path.closed);
  if(!final.accepted||originalCross!==candidateCross||simplified.length<(path.closed?3:2))return {path:original,before:n,after:n,maxDeviationPx:0,changed:false};
  return {path:candidate,before:n,after:simplified.length,maxDeviationPx:final.maxDeviationPx,changed:true};
 }
 const api={simplifyPath};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.CurveSimplify=api;
})(typeof window!=='undefined'?window:globalThis);
