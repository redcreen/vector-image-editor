const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const N=require('../../tools/curve-editor/notches.js');
const line=(length=100)=>({id:'p',closed:false,nodes:[G.node(0,0),G.node(length,0)]});
const square=()=>({id:'p',closed:true,nodes:[[0,0],[100,0],[100,100],[0,100]].map(p=>G.node(...p))});
function insert(p,hit={index:0,t:.5},options={}){return N.insert(G,p,hit,{id:'new-notch',...options});}
function checkV(result){const group=N.groups(result.path).find(g=>g.id==='new-notch');assert.equal(group.indices.length,3);const [a,tip,b]=group.indices.map(i=>result.path.nodes[i]);const w=G.dist(a,b),mid=G.mix(a,b,.5);assert.ok(Math.abs(G.dist(mid,tip)-w)<1e-7);assert.ok(Math.abs((tip.x-mid.x)*(b.x-a.x)+(tip.y-mid.y)*(b.y-a.y))<1e-7);return {a,b,tip,w};}
test('insert creates a fixed V without mutating source or changing the rest of a straight seam',()=>{
 const p=line(),before=structuredClone(p),r=insert(p),v=checkV(r);assert.deepEqual(p,before);assert.equal(r.path.nodes.length,5);assert.deepEqual(r.path.nodes[0],p.nodes[0]);assert.deepEqual(r.path.nodes.at(-1),p.nodes.at(-1));assert.ok(Math.abs((v.a.x+v.b.x)/2-50)<1e-5);assert.equal(v.tip.y,v.w);
});
test('size follows physical curve size and calibration, independently of document pixels',()=>{
 const a=checkV(insert(line(100))),b=checkV(insert(line(200)));assert.ok(Math.abs(b.w/a.w-2)<1e-5);
 const mm=checkV(insert(line(200),undefined,{mmPerUnit:1})),px=checkV(insert(line(2000),undefined,{mmPerUnit:.1}));assert.ok(Math.abs(mm.w-px.w*.1)<1e-5);assert.ok(mm.w<=3.00001&&mm.w>=.8);
});
test('curved seam outside the notch retains exact Bezier geometry',()=>{
 const p=line();p.nodes[0].out={x:20,y:80};p.nodes[1].in={x:80,y:80};const r=insert(p);checkV(r);
 const a=r.path.nodes[1],b=r.path.nodes[3];const ta=G.nearest(p,a).t,tb=G.nearest(p,b).t;
 for(let j=0;j<=20;j++){const u=j/20;assert.ok(G.dist(G.at(r.path.nodes[0],a,u),G.at(...p.nodes,ta*u))<.001);assert.ok(G.dist(G.at(b,r.path.nodes[4],u),G.at(...p.nodes,tb+(1-tb)*u))<.001);}
});
test('closed outlines insert inward in either direction and across the closing seam',()=>{
 for(const reverse of [false,true])for(const hit of [{index:0,t:.5},{index:0,t:0},{index:3,t:.98}]){const p=square();if(reverse)p.nodes.reverse();const r=insert(p,hit),v=checkV(r);assert.equal(r.path.closed,true);assert.ok(v.tip.x>0&&v.tip.x<100&&v.tip.y>0&&v.tip.y<100);assert.equal(N.groups(r.path).length,1);}
});
test('dense polyline allows mouth to cross existing nodes',()=>{
 const p=line();p.nodes=Array.from({length:1001},(_,i)=>G.node(i/10,0));const r=insert(p,{index:499,t:1});checkV(r);assert.equal(N.groups(r.path).length,1);assert.ok(r.path.nodes.length<1001);
});
test('invalid endpoints, overlapping notches and linked symmetry reject atomically',()=>{
 const p=line(),before=structuredClone(p);assert.throws(()=>insert(p,{index:0,t:0}),/端点/);assert.deepEqual(p,before);
 const r=insert(p);const group=N.groups(r.path)[0];assert.throws(()=>insert(r.path,{index:group.start,t:.5},{id:'another'}),/剪口/);
 p.nodes[0].symmetry={out:{id:'s',side:'a'}};assert.throws(()=>insert(p),/对称/);
 assert.throws(()=>insert(line(0)),/长度|方向/);
});
test('insertion near an open endpoint shrinks instead of moving the selected location',()=>{
 const p=line(),r=insert(p,{index:0,t:.01}),v=checkV(r),at=G.at(...p.nodes,.01);assert.ok(Math.abs((v.a.x+v.b.x)/2-at.x)<1e-6);assert.ok(v.a.x>0);assert.ok(v.w<.1);
});
test('thin closed shapes shrink the fixed V before it reaches the opposite edge',()=>{
 const p=square();p.nodes[2]=G.node(100,.2);p.nodes[3]=G.node(0,.2);const r=insert(p,undefined,{mmPerUnit:1}),v=checkV(r);assert.ok(v.tip.y>0&&v.tip.y<.2);assert.ok(v.w<.2);
});
test('adding near an existing notch keeps that feature exact',()=>{
 const first=insert(line()),old=N.groups(first.path)[0],before=old.indices.map(i=>structuredClone(first.path.nodes[i]));
 const p=first.path,hit=G.nearest(p,{x:52,y:0}),second=N.insert(G,p,hit,{id:'next'}),retained=N.groups(second.path).find(g=>g.id==='new-notch');
 // Subdivision can shorten the exterior handle, but all notch edges stay exact.
 const after=retained.indices.map(i=>second.path.nodes[i]);assert.deepEqual(after.map(n=>[n.x,n.y]),before.map(n=>[n.x,n.y]));assert.deepEqual(after[0].out,before[0].out);assert.deepEqual(after[1],before[1]);assert.deepEqual(after[2].in,before[2].in);assert.equal(N.groups(second.path).length,2);
});
test('insertion exposes original node identity even when dense replacement preserves node count',()=>{
 const p=square();p.nodes=[G.node(0,0),G.node(.1,0),G.node(99.9,0),G.node(100,0),G.node(100,100),G.node(0,100),G.node(0,.1)];
 const r=insert(p,{index:0,t:0});assert.equal(r.path.nodes.length,p.nodes.length);assert.equal(r.nodeMap[0],-1);assert.equal(r.nodeMap[1],-1);assert.equal(r.nodeMap[6],-1);
 for(const i of [2,3,4,5])assert.deepEqual(G.point(r.path.nodes[r.nodeMap[i]]),G.point(p.nodes[i]));
});
