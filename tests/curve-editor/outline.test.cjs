const {test}=require('node:test');
const assert=require('node:assert/strict');
const T=require('../../tools/curve-editor/tracing.js');

function image(width=100,height=80,color=[245,245,245,255]){
 const data=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<data.length;i+=4)data.set(color,i);
 return {width,height,data};
}
function setPixel(im,x,y,color){im.data.set(color,(y*im.width+x)*4);}
function rect(im,x0,y0,x1,y1,color){
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)setPixel(im,x,y,color);
}
function polygon(im,vertices,colorAt){
 const minY=Math.floor(Math.min(...vertices.map(p=>p.y))),maxY=Math.ceil(Math.max(...vertices.map(p=>p.y)));
 for(let y=minY;y<maxY;y++)for(let x=0;x<im.width;x++){
  let inside=false;
  for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
   const a=vertices[i],b=vertices[j];
   if((a.y>y+.5)!==(b.y>y+.5)&&x+.5<(b.x-a.x)*(y+.5-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  if(inside)setPixel(im,x,y,colorAt(x,y));
 }
}
const bounds=r=>({
 minX:Math.min(...r.points.map(p=>p.x)),maxX:Math.max(...r.points.map(p=>p.x)),
 minY:Math.min(...r.points.map(p=>p.y)),maxY:Math.max(...r.points.map(p=>p.y))
});

test('outline follows the outer boundary of a textured concave object and ignores its hole',()=>{
 const im=image(110,90);
 polygon(im,[{x:15,y:12},{x:88,y:12},{x:88,y:34},{x:58,y:34},{x:58,y:72},{x:15,y:72}],
  (x,y)=>{const v=88+((x*17+y*29)%45);return [v,v+5,v+9,255];});
 rect(im,27,25,39,38,[245,245,245,255]);
 const r=T.trace(im,{x:20,y:50},{mode:'outline',tolerance:30,smoothing:1});
 assert.ok(r);assert.equal(r.closed,true);assert.equal(r.dashed,false);assert.equal(r.segments,1);
 const b=bounds(r);assert.deepEqual(b,{minX:15,maxX:88,minY:12,maxY:72});
 assert.ok(r.points.some(p=>p.x===58&&p.y>=34&&p.y<=60),'concave notch should remain in the contour');
 assert.ok(!r.points.some(p=>p.x>=27&&p.x<=39&&p.y>=25&&p.y<=38),'the internal hole must not become the selected contour');
});

test('the seed chooses one of two independent objects',()=>{
 const im=image(130,70);rect(im,10,12,45,55,[80,95,105,255]);rect(im,78,18,120,50,[110,80,90,255]);
 const left=T.trace(im,{x:25,y:30},{mode:'outline'}),right=T.trace(im,{x:95,y:30},{mode:'outline'});
 assert.ok(left&&right);assert.deepEqual(bounds(left),{minX:10,maxX:45,minY:12,maxY:55});
 assert.deepEqual(bounds(right),{minX:78,maxX:120,minY:18,maxY:50});
});

test('transparent cutouts use alpha as the background and accept a seed just outside the edge',()=>{
 const im=image(80,70,[0,0,0,0]);rect(im,18,15,62,58,[30,160,115,255]);
 const r=T.trace(im,{x:15,y:35},{mode:'outline',radius:5});assert.ok(r);
 assert.deepEqual(bounds(r),{minX:18,maxX:62,minY:15,maxY:58});
 assert.equal(r.color,'#1ea073');
});

test('blank backgrounds, distant background clicks, and faint background noise return no contour',()=>{
 assert.equal(T.trace(image(),{x:40,y:30},{mode:'outline'}),null);
 const im=image();rect(im,15,18,50,60,[90,90,95,255]);
 for(let y=4;y<12;y++)for(let x=72;x<88;x++)setPixel(im,x,y,[229+(x+y)%3,229,229,255]);
 assert.equal(T.trace(im,{x:90,y:65},{mode:'outline',radius:5,tolerance:30}),null);
 assert.equal(T.trace(im,{x:78,y:8},{mode:'outline',radius:3,tolerance:30}),null);
});

test('background tolerance excludes a faint fringe and higher values shrink toward the solid object',()=>{
 const im=image(90,70,[240,240,240,255]);rect(im,18,13,72,58,[222,222,222,255]);rect(im,23,18,67,53,[105,110,115,255]);
 const low=T.trace(im,{x:40,y:35},{mode:'outline',tolerance:12}),high=T.trace(im,{x:40,y:35},{mode:'outline',tolerance:30});
 assert.ok(low&&high);assert.deepEqual(bounds(low),{minX:18,maxX:72,minY:13,maxY:58});
 assert.deepEqual(bounds(high),{minX:23,maxX:67,minY:18,maxY:53});
});

test('light objects on dark backgrounds produce finite editable nodes',()=>{
 const im=image(100,80,[20,24,28,255]);
 polygon(im,[{x:17,y:18},{x:75,y:14},{x:84,y:55},{x:45,y:68},{x:14,y:48}],()=>[215,220,225,255]);
 const r=T.traceOutline(im,{x:45,y:35},{tolerance:30,smoothing:2});assert.ok(r);assert.equal(r.closed,true);
 assert.ok(r.nodes.length>=3&&r.nodes.length<20);
 for(const n of r.nodes)for(const p of [n,n.in,n.out])assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
});

test('extreme smoothing never returns an invalid two-node closed curve',()=>{
 const im=image(40,40);rect(im,18,12,19,20,[70,70,70,255]);
 const result=T.trace(im,{x:18,y:15},{mode:'outline',smoothing:12});
 assert.ok(result);assert.ok(result.nodes.length>=3);
});

test('foreground touching any image edge is not mistaken for background variation',()=>{
 const cases=[
  {box:[0,20,60,60],seed:{x:30,y:40}},
  {box:[40,20,100,60],seed:{x:70,y:40}},
  {box:[20,0,80,35],seed:{x:50,y:18}},
  {box:[20,45,80,80],seed:{x:50,y:62}}
 ];
 for(const {box,seed} of cases){
  const im=image(100,80);rect(im,...box,[80,80,80,255]);
  const r=T.trace(im,seed,{mode:'outline',tolerance:8,smoothing:2});
  assert.ok(r,`expected a contour for edge-touching box ${box.join(',')}`);
  assert.ok(r.nodes.length>=3);
 }
});

function curveSamples(nodes){
 const samples=[];
 for(let i=0;i<nodes.length;i++){
  const a=nodes[i],b=nodes[(i+1)%nodes.length];
  for(let j=0;j<=100;j++){
   const t=j/100,s=1-t;
   samples.push({x:s*s*s*a.x+3*s*s*t*a.out.x+3*s*t*t*b.in.x+t*t*t*b.x,
    y:s*s*s*a.y+3*s*s*t*a.out.y+3*s*t*t*b.in.y+t*t*t*b.y});
  }
 }
 return samples;
}
function boundaryDistance(p,points){
 let best=Infinity;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
  best=Math.min(best,Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy));
 }
 return best;
}

test('independent denoise removes same-color hairs while preserving a large notch',()=>{
 const im=image(240,190),color=[80,85,90,255];
 rect(im,35,30,205,160,color);rect(im,145,75,205,115,[245,245,245,255]);
 for(let x=45;x<200;x+=13){rect(im,x,13,x+2,30,color);rect(im,x,160,x+2,180,color);}
 const raw=T.traceOutline(im,{x:60,y:80},{denoise:0,smoothing:2});
 const clean=T.traceOutline(im,{x:60,y:80},{denoise:8,smoothing:2});
 assert.ok(raw&&clean);assert.equal(bounds(raw).minY,13);
 assert.ok(bounds(clean).minY>=28&&bounds(clean).maxY<=162,'same-color hairs should be removed while preserving body bounds within two pixels');
 assert.ok(boundaryDistance({x:145,y:95},clean.points)<.01,'large concavity must remain');
 assert.ok(clean.nodes.length<raw.nodes.length/2,'denoising should remove hair anchors');
 const tight=T.traceOutline(im,{x:60,y:80},{denoise:8,smoothing:.5});
 assert.deepEqual(tight.points,clean.points,'fitting tolerance must not change denoised segmentation');
 assert.deepEqual(T.traceOutline(im,{x:60,y:80},{smoothing:2}).points,raw.points,'omitted denoise preserves raw contour');
});

test('fitted cubic spans stay inside the requested boundary error without handle bulges',()=>{
 const im=image(260,210),vertices=[];
 for(let i=0;i<180;i++){
  const t=i*Math.PI/90,r=1+.15*Math.cos(3*t);
  vertices.push({x:130+95*r*Math.cos(t),y:105+72*r*Math.sin(t)});
 }
 polygon(im,vertices,()=>[75,80,85,255]);
 // Subpixel tolerances are passed when a large source image is downsampled.
 for(const smoothing of [.25,.5,2,6,12]){
  const result=T.traceOutline(im,{x:130,y:105},{smoothing,denoise:0});assert.ok(result);
  const maxError=Math.max(...curveSamples(result.nodes).map(p=>boundaryDistance(p,result.points)));
  assert.ok(maxError<=smoothing+.05,`curve deviates ${maxError.toFixed(2)} px at tolerance ${smoothing}`);
 }
});

test('denoise cannot erase small or edge-contact objects and does not affect line mode',()=>{
 for(const box of [[18,12,21,17],[0,15,65,60],[30,0,65,55]]){
  const im=image();rect(im,...box,[80,80,80,255]);
  const result=T.traceOutline(im,{x:box[0]+1,y:box[1]+1},{denoise:24,smoothing:2});
  assert.ok(result);assert.ok(result.nodes.length>=3);
  if(box[0]===0)assert.equal(bounds(result).minX,0);
  if(box[1]===0)assert.equal(bounds(result).minY,0);
 }
 const im=image();rect(im,12,38,85,41,[40,40,40,255]);
 assert.deepEqual(T.trace(im,{x:40,y:39},{denoise:24}),T.trace(im,{x:40,y:39},{denoise:0}));
});

test('strong denoising of a tiny object at a frame corner stays finite',()=>{
 const im=image(8,20);rect(im,0,0,3,16,[60,60,60,255]);
 const result=T.traceOutline(im,{x:1,y:1},{denoise:16,smoothing:2});
 assert.ok(result);assert.ok(result.nodes.length>=3);
 for(const n of result.nodes)for(const p of [n,n.in,n.out])assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
});

test('denoising cache respects the seed when a narrow connection is removed',()=>{
 const im=image(180,90),color=[80,85,90,255];
 rect(im,15,15,70,75,color);rect(im,110,15,165,75,color);rect(im,70,43,110,46,color);
 const left=T.traceOutline(im,{x:40,y:40},{denoise:5}),right=T.traceOutline(im,{x:135,y:40},{denoise:5});
 assert.ok(left&&right);assert.ok(bounds(left).maxX<90);assert.ok(bounds(right).minX>90);
});

test('denoise fills narrow inward fuzz gaps without flattening a major V notch',()=>{
 const im=image(220,180),color=[80,85,90,255];
 polygon(im,[{x:25,y:35},{x:95,y:35},{x:110,y:75},{x:130,y:35},{x:195,y:35},{x:195,y:155},{x:25,y:155}],()=>color);
 for(let x=35;x<90;x+=12)rect(im,x,35,x+2,42,[245,245,245,255]);
 const r=T.traceOutline(im,{x:60,y:100},{denoise:8,smoothing:2});assert.ok(r);
 assert.ok(boundaryDistance({x:60,y:36},r.points)<=2,'short inward gaps should be filled');
 const roughTop=r.points.filter(p=>p.x>35&&p.x<80&&p.y<50);
 assert.ok(roughTop.every(p=>p.y<=37),'fine inward steps should not remain');
 assert.ok(boundaryDistance({x:110,y:75},r.points)<8,'major V notch should remain within eight pixels');
});

test('smooth fitted arcs share tangent directions between consecutive cubics',()=>{
 const im=image(260,210),vertices=[];
 for(let i=0;i<180;i++){const t=i*Math.PI/90;vertices.push({x:130+95*Math.cos(t),y:105+72*Math.sin(t)});}
 polygon(im,vertices,()=>[75,80,85,255]);
 const r=T.traceOutline(im,{x:130,y:105},{smoothing:2});assert.ok(r);
 for(const n of r.nodes){
  const ax=n.x-n.in.x,ay=n.y-n.in.y,bx=n.out.x-n.x,by=n.out.y-n.y;
  const den=Math.hypot(ax,ay)*Math.hypot(bx,by);
  if(den>1e-5)assert.ok((ax*bx+ay*by)/den>.999,'smooth outline joins should not make visible kinks');
 }
});
