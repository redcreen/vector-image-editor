const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const O=require('../../tools/curve-editor/offset.js');
const path=(pts,closed=true,id='a')=>({id,closed,name:'original',extra:{value:3},nodes:pts.map(([x,y])=>G.node(x,y))});
const square=()=>path([[0,0],[100,0],[100,100],[0,100]]);
const near=(a,b,tol=.08)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const offset=(p,d,opts={})=>O.offsetContours(O.prepareContours(Array.isArray(p)?p:[p]),d,opts);
const bounds=p=>G.pathBounds(p);
function circle(r=100){
 const k=.5522847498307936*r,p=path([[r,0],[0,r],[-r,0],[0,-r]]);
 const handles=[[[r,-k],[r,k]],[[k,r],[-k,r]],[[-r,k],[-r,-k]],[[-k,-r],[k,-r]]];
 p.nodes.forEach((n,i)=>{n.in={x:handles[i][0][0],y:handles[i][0][1]};n.out={x:handles[i][1][0],y:handles[i][1][1]};n.mode='smooth';});return p;
}
test('offset API is available',()=>assert.equal(typeof O.offsetContours,'function'));
test('closed rectangle offsets have fixed normal distance independent of winding',()=>{
 for(const reverse of [false,true])for(const dir of ['outward','inward']){
  const p=square();if(reverse)p.nodes.reverse();const before=JSON.stringify(p),result=offset(p,10,{closedDirection:dir});
  assert.equal(result.length,1);assert.equal(result[0].path.closed,true);assert.equal(result[0].path.nodes.length,4);
  const b=bounds(result[0].path),lo=dir==='outward'?-10:10,hi=dir==='outward'?110:90;
  near(b.x,lo);near(b.y,lo);near(b.x+b.width,hi);near(b.y+b.height,hi);assert.equal(JSON.stringify(p),before);
 }
});
test('curved circles keep editable handles and accurate normal-distance geometry',()=>{
 for(const dir of ['outward','inward']){
  const p=offset(circle(),15,{closedDirection:dir,tolerancePx:.05})[0].path,r=dir==='outward'?115:85;
  assert.ok(p.nodes.length<64,`too many nodes: ${p.nodes.length}`);assert.ok(p.nodes.some(n=>G.dist(n,n.out)>1));
  for(let i=0;i<p.nodes.length;i++)for(let j=0;j<=20;j++){const q=G.at(p.nodes[i],p.nodes[(i+1)%p.nodes.length],j/20);near(Math.hypot(q.x,q.y),r,.1);}
 }
});
test('open lines offset visually left/up and reverse direction switches the side',()=>{
 const p=path([[0,0],[100,0]],false);
 const l=offset(p,12,{openSide:'left'})[0].path,r=offset(p,12,{openSide:'right'})[0].path;
 assert.equal(l.closed,false);assert.deepEqual(l.nodes.map(n=>[n.x,n.y]),[[0,-12],[100,-12]]);
 assert.deepEqual(r.nodes.map(n=>[n.x,n.y]),[[0,12],[100,12]]);
 p.nodes.reverse();assert.deepEqual(offset(p,12,{openSide:'left'})[0].path.nodes.map(n=>[n.x,n.y]),[[100,12],[0,12]]);
});
test('touching pieces join deterministically, reverse handles, retain metadata, and close',()=>{
 const pieces=[path([[0,0],[100,0]],false,'top'),path([[100,100],[100,0]],false,'right'),path([[100,100],[0,100]],false,'bottom'),path([[0,0],[0,100]],false,'left')];
 pieces[1].nodes[0].out={x:100,y:70};pieces[1].nodes[1].in={x:100,y:30};
 const before=JSON.stringify(pieces),c=O.prepareContours(pieces);
 assert.equal(c.length,1);assert.equal(c[0].path.closed,true);assert.equal(c[0].path.nodes.length,4);
 assert.deepEqual(new Set(c[0].sourceIds),new Set(pieces.map(p=>p.id)));assert.deepEqual(c[0].path.extra,{value:3});
 assert.deepEqual(c[0].path.nodes[1].out,{x:100,y:30});assert.deepEqual(c[0].path.nodes[2].in,{x:100,y:70});assert.equal(JSON.stringify(pieces),before);
});
test('touching open chain joins but gaps and independent loops remain separate',()=>{
 const c=O.prepareContours([path([[0,0],[50,0]],false,'a'),path([[100,0],[50,0]],false,'b'),path([[110,0],[150,0]],false,'c'),square()]);
 assert.equal(c.length,3);assert.equal(c[0].path.closed,false);assert.equal(c[0].path.nodes.length,3);
 const p=square(),q=square();q.id='b';q.nodes.forEach(n=>G.move(n,200,0));assert.equal(offset([p,q],10).length,2);
});
test('ambiguous endpoint branches are rejected',()=>{
 assert.throws(()=>O.prepareContours([path([[0,0],[10,0]],false,'a'),path([[10,0],[20,0]],false,'b'),path([[10,0],[10,10]],false,'c')]),/分叉|歧义/);
});
test('concave insets are cleaned and can split into independent loops',()=>{
 const p=path([[0,0],[40,0],[40,15],[60,15],[60,0],[100,0],[100,40],[60,40],[60,25],[40,25],[40,40],[0,40]]);
 const result=offset(p,6,{closedDirection:'inward'});assert.equal(result.length,2);
 for(const c of result){assert.equal(c.path.closed,true);assert.deepEqual(c.sourceIds,['a']);assert.ok(c.path.nodes.length>=4);}
});
test('collapsed inset and self intersecting source fail without returning flipped geometry',()=>{
 assert.throws(()=>offset(square(),60,{closedDirection:'inward'}),/消失|过大/);
 assert.throws(()=>offset(circle(),120,{closedDirection:'inward'}),/消失|过大/);
 assert.throws(()=>offset(path([[0,0],[100,100],[0,100],[100,0]]),5),/自交|退化/);
});
test('calibrated mm/cm values convert to pixels and uncalibrated real units fail',()=>{
 const c={a:{x:0,y:0},b:{x:100,y:0},length:20,unit:'mm'};
 assert.equal(O.physicalDistancePixels(2,'mm',c),10);assert.equal(O.physicalDistancePixels(2,'cm',c),100);
 assert.equal(O.physicalDistancePixels(2,'px',null),2);assert.throws(()=>O.physicalDistancePixels(2,'cm',null),/标定/);
 for(const v of [0,-1,NaN,Infinity,'2',true])assert.throws(()=>O.physicalDistancePixels(v,'px',null));
 assert.throws(()=>O.physicalDistancePixels(2,'inch',c));
});
test('invalid coordinates, limits and distances fail clearly',()=>{
 for(const d of [0,-1,NaN,Infinity,1e9])assert.throws(()=>offset(square(),d));
 assert.throws(()=>offset(path([[0,0],[0,0]],false),2),/退化|重合/);
 const p=square();p.nodes[0].out.x=NaN;assert.throws(()=>offset(p,2),/坐标/);
 assert.throws(()=>offset(square(),2,{closedDirection:'bad'}));assert.throws(()=>offset(square(),2,{tolerancePx:0}));
});
test('open cubic arc endpoints use the exact original endpoint normals',()=>{
 const p=circle();p.closed=false;p.nodes=p.nodes.slice(0,2);
 for(const side of ['left','right']){
  const q=offset(p,25,{openSide:side,tolerancePx:.02})[0].path,r=side==='left'?125:75;
  near(q.nodes[0].x,r,1e-6);near(q.nodes[0].y,0,1e-6);near(q.nodes.at(-1).x,0,1e-6);near(q.nodes.at(-1).y,r,1e-6);
  assert.ok(q.nodes.length<40);
  for(let i=0;i<q.nodes.length-1;i++)for(let j=0;j<=20;j++){const point=G.at(q.nodes[i],q.nodes[i+1],j/20);near(Math.hypot(point.x,point.y),r,.09);}
 }
});
test('the connection tolerance is strict and does not bridge visible gaps',()=>{
 for(const gap of [.009,.01,.1]){
  const c=O.prepareContours([path([[0,0],[10,0]],false,'a'),path([[10+gap,0],[20,0]],false,'b')]);
  assert.equal(c.length,gap<.01?1:2);
 }
});
test('one invalid or collapsed component rejects the entire selection',()=>{
 const a=square(),b=path([[200,0],[210,0],[210,10],[200,10]],true,'b');
 assert.throws(()=>offset([a,b],8,{closedDirection:'inward'}),/消失|过大/);
});
test('large inset of an open arc cannot silently reverse its direction',()=>{
 const p=circle();p.closed=false;p.nodes=p.nodes.slice(0,2);
 assert.throws(()=>offset(p,120,{openSide:'right'}),/折返|自交|过大/);
});
test('general cubic open offset tracks source normals rather than resizing its bounds',()=>{
 const p=path([[0,0],[180,40]],false);p.nodes[0].out={x:30,y:-100};p.nodes[1].in={x:140,y:130};
 const q=offset(p,8,{openSide:'left',tolerancePx:.025})[0].path,a=p.nodes[0],b=p.nodes[1];
 assert.ok(q.nodes.length<80);
 for(let j=1;j<40;j++){
  const t=j/40,u=1-t,at=G.at(a,b,t);
  const dx=3*u*u*(a.out.x-a.x)+6*u*t*(b.in.x-a.out.x)+3*t*t*(b.x-b.in.x);
  const dy=3*u*u*(a.out.y-a.y)+6*u*t*(b.in.y-a.out.y)+3*t*t*(b.y-b.in.y),length=Math.hypot(dx,dy);
  const expected={x:at.x+8*dy/length,y:at.y-8*dx/length};assert.ok(G.nearest(q,expected).distance<.08);
 }
});
test('tiny requested distances retain useful precision',()=>{
 const p=offset(square(),.002,{closedDirection:'inward',tolerancePx:.00001})[0].path,b=bounds(p);
 near(b.x,.002,1e-6);near(b.width,99.996,1e-6);
});
test('thin closed insets retain at least three nodes for v1 save/load compatibility',()=>{
 const source=path([[0,0],[50,2],[100,0]]);
 for(const amount of [.98,.99,.995]){
  const result=offset(source,amount,{closedDirection:'inward',tolerancePx:amount*.005})[0].path;
  assert.equal(result.closed,true);assert.ok(result.nodes.length>=3,`closed nodes: ${result.nodes.length}`);
  const roundTrip=JSON.parse(JSON.stringify(result));assert.equal(roundTrip.closed&&roundTrip.nodes.length>=3,true);
 }
});
test('small contours at allowed large coordinates offset just like contours near the origin',()=>{
 for(const origin of [0,9999990,-9999990]){
  const p=path([[origin,origin],[origin+.1,origin],[origin+.1,origin+.1],[origin,origin+.1]]);
  const result=offset(p,.01,{tolerancePx:.00005})[0].path,b=bounds(result);
  near(b.x,origin-.01,.00001);near(b.y,origin-.01,.00001);near(b.width,.12,.00001);near(b.height,.12,.00001);
 }
});
