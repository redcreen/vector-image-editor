const test=require('node:test');const assert=require('node:assert/strict');
const F=require('../../tools/curve-editor/fairing.js');
const n=(x,y)=>({x,y,in:{x,y},out:{x,y},mode:'cusp'});
const bow=()=>[n(0,0),n(12,15),n(58,27),n(100,0)];
const at=(a,b,t)=>{let u=1-t;return {x:u**3*a.x+3*u*u*t*a.out.x+3*u*t*t*b.in.x+t**3*b.x,y:u**3*a.y+3*u*u*t*a.out.y+3*u*t*t*b.in.y+t**3*b.y}};
function checkC2(r){for(let i=1;i<r.nodes.length-1;i++){let a=r.nodes[i-1],b=r.nodes[i],c=r.nodes[i+1],h=r.parameterIntervals[i-1],k=r.parameterIntervals[i];for(let d of ['x','y']){assert.ok(Math.abs(3*(b[d]-b.in[d])/h-3*(b.out[d]-b[d])/k)<1e-8);assert.ok(Math.abs(6*(b[d]-2*b.in[d]+a.out[d])/h**2-6*(b[d]-2*b.out[d]+c.in[d])/k**2)<1e-8)}}}
test('uneven outward bow is globally C2, bounded, immutable and ordered',()=>{let a=bow(),before=JSON.stringify(a),r=F.fairSpan(a,{tolerance:12});assert.equal(JSON.stringify(a),before);assert.equal(r.nodes.length,4);assert.equal(r.continuity,'C2');assert.ok(r.changed);assert.ok(r.maxDeviation<=12);checkC2(r);for(let i=0;i<3;i++)for(let j=0;j<=100;j++){let p=at(a[i],a[i+1],j/100),q=at(r.nodes[i],r.nodes[i+1],j/100);assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<=r.maxDeviation+1e-8)}});
test('mandatory anchors remain exact while handles are optimized',()=>{let a=bow(),r=F.fairSpan(a,{tolerance:20,fixedIndices:[1,2]});a.forEach((p,i)=>{assert.equal(r.nodes[i].x,p.x);assert.equal(r.nodes[i].y,p.y)});checkC2(r);assert.notDeepEqual(r.nodes[1].out,a[1].out)});
test('boundary tangent directions and external handles survive',()=>{let a=bow();a[0].out={x:3,y:6};a[3].in={x:95,y:5};a[0].in={x:-5,y:-3};a[3].out={x:120,y:-3};let r=F.fairSpan(a,{tolerance:25});assert.deepEqual(r.nodes[0].in,a[0].in);assert.deepEqual(r.nodes[3].out,a[3].out);for(let [i,side] of [[0,'out'],[3,'in']]){let p=a[i],q=r.nodes[i],v={x:p[side].x-p.x,y:p[side].y-p.y},w={x:q[side].x-q.x,y:q[side].y-q.y};assert.ok(Math.abs(v.x*w.y-v.y*w.x)<1e-8);assert.ok(v.x*w.x+v.y*w.y>0)}checkC2(r)});
test('zero and tiny tolerance refuse an infeasible cusp span',()=>{for(let tolerance of [0,1e-10])assert.throws(()=>F.fairSpan(bow(),{tolerance}),/偏差|范围/)});
test('invalid, degenerate and excessive input have useful errors',()=>{for(let a of [[],[n(0,0),n(1,1)],[n(0,0),n(0,0),n(1,1)]])assert.throws(()=>F.fairSpan(a,{tolerance:10}));for(let tolerance of [-1,NaN,Infinity])assert.throws(()=>F.fairSpan(bow(),{tolerance}));assert.throws(()=>F.fairSpan(bow(),{tolerance:5,fixedIndices:[99]}));assert.throws(()=>F.fairSpan(Array.from({length:F.MAX_NODES+1},(_,i)=>n(i,0)),{tolerance:5}));});
test('large straight span completes with finite C2 coordinates',()=>{let a=Array.from({length:200},(_,i)=>n(i*3,0)),r=F.fairSpan(a,{tolerance:2});assert.equal(r.nodes.length,a.length);assert.ok(Number.isFinite(r.maxDeviation));checkC2(r)});

test('zero tolerance keeps a valid straight cubic span unchanged',()=>{let a=[n(0,0),n(3,0),n(6,0)];for(let p of a){p.in={x:p.x-1,y:0};p.out={x:p.x+1,y:0}}let r=F.fairSpan(a,{tolerance:0});assert.equal(r.changed,false);assert.deepEqual(r.nodes,a);assert.equal(r.maxDeviation,0);});

test('improves the existing local smoother on the uneven bow within two units',()=>{let a=bow();require('../../tools/curve-editor/geometry.js').smoothNodes({nodes:a,closed:false},[0,1,2,3]);let r=F.fairSpan(a,{tolerance:2});assert.ok(r.changed);assert.ok(r.maxDeviation<=2);checkC2(r);for(let i=0;i<r.nodes.length-1;i++){const b=r.nodes[i],c=r.nodes[i+1],dx=c.x-b.x,dy=c.y-b.y,ps=[b,b.out,c.in,c];for(let j=1;j<4;j++)assert.ok((ps[j].x-ps[j-1].x)*dx+(ps[j].y-ps[j-1].y)*dy>=-1e-8)}});
test('tight tolerance preserves unequal endpoint derivative speeds',()=>{
 const a=[0,10,20,30].map(x=>n(x,0)),speeds=[.6,1.16,.76,1.8];
 a.forEach((p,i)=>{p.in={x:p.x-speeds[i]*10/3,y:0};p.out={x:p.x+speeds[i]*10/3,y:0};});
 a[1].in.y=0.00001;
 const r=F.fairSpan(a,{tolerance:0.0001,fixedIndices:[1,2]});checkC2(r);assert.ok(r.maxDeviation<=0.0001);
 assert.ok(Math.abs((r.nodes[0].out.x-r.nodes[0].x)*3/10-.6)<1e-9);
 assert.ok(Math.abs((r.nodes[3].x-r.nodes[3].in.x)*3/10-1.8)<1e-9);
});
test('explicit endpoint override cannot return incompatible original curve',()=>{
 const a=[0,3,6].map(x=>n(x,0));a.forEach(p=>{p.in={x:p.x-1,y:0};p.out={x:p.x+1,y:0}});
 assert.throws(()=>F.fairSpan(a,{tolerance:0,startTangent:{x:1,y:1}}),/偏差|范围/);
});
test('reference anchors can relax below one sixteenth of the span scale',()=>{
 const seed=F.fairSpan(bow(),{tolerance:20,fixedIndices:[1,2]}).nodes;
 const r=F.fairSpan(seed,{tolerance:.001});checkC2(r);assert.ok(r.maxDeviation<=.001);
 assert.ok(r.nodes.some((p,i)=>Math.hypot(p.x-seed[i].x,p.y-seed[i].y)>1e-6));
 assert.deepEqual({x:r.nodes[0].x,y:r.nodes[0].y},{x:seed[0].x,y:seed[0].y});
});
test('collapsed endpoint handles preserve the first nonzero geometric tangent',()=>{
 for(const controls of [false,true]){
  const a=bow();if(controls){a[1].in={x:8,y:13};a[2].out={x:70,y:20}};
  const r=F.fairSpan(a,{tolerance:30});
  const expectedStart={x:(controls?a[1].in.x:a[1].x)-a[0].x,y:(controls?a[1].in.y:a[1].y)-a[0].y};
  const expectedEnd={x:a[3].x-(controls?a[2].out.x:a[2].x),y:a[3].y-(controls?a[2].out.y:a[2].y)};
  for(const [v,w] of [[expectedStart,{x:r.nodes[0].out.x-r.nodes[0].x,y:r.nodes[0].out.y-r.nodes[0].y}],[expectedEnd,{x:r.nodes[3].x-r.nodes[3].in.x,y:r.nodes[3].y-r.nodes[3].in.y}]]){assert.ok(Math.abs(v.x*w.y-v.y*w.x)<1e-8);assert.ok(v.x*w.x+v.y*w.y>0)}
  checkC2(r);
 }
});

test('traced four-point contour supports fixed or reference middle points within two image pixels',()=>{
 const raw=[[695.1873,329.6349,680.5644,339.2404,712.5049,339.7824],[743.0976,374.3419,728.6574,357.9528,754.5278,387.3147],[773.4282,416.4198,766.3617,400.6398,780.2563,431.6673],[784.2437,465.3585,789.5629,449.5401,780.1805,477.4417]];
 const nodes=raw.map(([x,y,ix,iy,ox,oy])=>({x,y,in:{x:ix,y:iy},out:{x:ox,y:oy},mode:'smooth'}));
 for(const fixedIndices of [[],[1],[1,2]]){
  const r=F.fairSpan(nodes,{tolerance:2,fixedIndices});assert.ok(r.changed);checkC2(r);assert.ok(r.maxDeviation<=2);
  for(const i of [0,3,...fixedIndices])assert.deepEqual({x:r.nodes[i].x,y:r.nodes[i].y},{x:nodes[i].x,y:nodes[i].y});
  for(let i=0;i<3;i++)for(let k=0;k<=100;k++){const p=at(nodes[i],nodes[i+1],k/100),q=at(r.nodes[i],r.nodes[i+1],k/100);assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<=r.maxDeviation+1e-8);}
 }
});
