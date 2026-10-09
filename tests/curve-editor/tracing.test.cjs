const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const location='../../tools/curve-editor/tracing.js';
const T=fs.existsSync(require('node:path').resolve(__dirname,location))?require(location):{};
function image(width=220,height=100){return {width,height,data:new Uint8ClampedArray(width*height*4).fill(255)};}
function line(im,x0,y0,x1,y1,color=[100,140,160],width=2){
 const count=Math.ceil(Math.hypot(x1-x0,y1-y0)*2);
 for(let s=0;s<=count;s++)for(let dy=-width;dy<=width;dy++)for(let dx=-width;dx<=width;dx++){
  const x=Math.round(x0+(x1-x0)*s/count)+dx,y=Math.round(y0+(y1-y0)*s/count)+dy;
  if(x<0||y<0||x>=im.width||y>=im.height)continue;
  im.data.set([...color,255],(y*im.width+x)*4);
 }
}
const bounds=r=>({minX:Math.min(...r.points.map(p=>p.x)),maxX:Math.max(...r.points.map(p=>p.x)),minY:Math.min(...r.points.map(p=>p.y)),maxY:Math.max(...r.points.map(p=>p.y))});

test('hovering a dash or its gap joins the centerline without outlining each short stroke',()=>{
 assert.equal(typeof T.trace,'function');const im=image();
 for(let x=20;x<190;x+=18)line(im,x,40,x+10,40);
 for(const seed of [{x:25,y:40},{x:34,y:40}]){
  const r=T.trace(im,seed,{gap:16,radius:10});assert.ok(r);assert.equal(r.dashed,true);assert.equal(r.closed,false);
  const b=bounds(r);assert.ok(b.minX<24&&b.maxX>180);assert.ok(b.maxY-b.minY<3);
  assert.ok(r.nodes.length<=5);assert.ok(r.nodes.length>=2);
 }
});
test('nearby parallel dashed lines and differently colored marks remain separate',()=>{
 const im=image();for(let x=20;x<190;x+=18){line(im,x,35,x+10,35);line(im,x,48,x+10,48);}
 line(im,105,10,105,80,[240,90,50]);
 const r=T.trace(im,{x:25,y:35},{gap:20});assert.ok(r);const b=bounds(r);
 assert.ok(b.maxX>180);assert.ok(b.minY>32&&b.maxY<38);
});
test('a curved solid stroke creates a few editable Bezier handles',()=>{
 const im=image(180,160);let previous=null;
 for(let angle=0;angle<=Math.PI;angle+=.025){const p={x:90+60*Math.cos(angle),y:85+60*Math.sin(angle)};if(previous)line(im,previous.x,previous.y,p.x,p.y);previous=p;}
 const r=T.trace(im,{x:90,y:145},{smoothing:2});assert.ok(r);assert.equal(r.dashed,false);
 assert.ok(r.nodes.length<25);assert.ok(r.nodes.some(n=>Math.hypot(n.out.x-n.x,n.out.y-n.y)>3));
 for(const n of r.nodes)for(const p of [n,n.in,n.out])assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
});
test('a closed dashed ring becomes one closed curve with no repeated endpoint',()=>{
 const im=image(180,180);for(let a=0;a<Math.PI*2;a+=.25)for(let s=0;s<.15;s+=.015)line(im,90+60*Math.cos(a+s),90+60*Math.sin(a+s),90+60*Math.cos(a+s+.015),90+60*Math.sin(a+s+.015));
 const r=T.trace(im,{x:150,y:90},{gap:18});assert.ok(r);assert.equal(r.closed,true);assert.equal(r.dashed,true);
 assert.ok(r.nodes.length<35);assert.ok(Math.hypot(r.nodes[0].x-r.nodes.at(-1).x,r.nodes[0].y-r.nodes.at(-1).y)>1);
});
test('blank, transparent and far-away pixels never create an editable curve',()=>{
 assert.equal(T.trace(image(),{x:50,y:50}),null);
 const im=image();im.data.fill(0);assert.equal(T.trace(im,{x:50,y:50}),null);
 const mark=image();line(mark,20,20,180,20);assert.equal(T.trace(mark,{x:50,y:80},{radius:10}),null);
});
test('anisotropic hover radii do not pick a distant line on the compressed axis',()=>{
 const im=image(240,100);line(im,100,50,200,50);
 assert.ok(T.trace(im,{x:80,y:50},{radiusX:30,radiusY:3}));
 assert.equal(T.trace(im,{x:140,y:30},{radiusX:30,radiusY:3}),null);
});
