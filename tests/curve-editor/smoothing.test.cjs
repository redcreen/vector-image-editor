const {test}=require('node:test');
const assert=require('node:assert/strict');
const g=require('../../tools/curve-editor/geometry.js');
const curve=(points,closed=false)=>({closed,nodes:points.map(([x,y])=>g.node(x,y))});
function aligned(n){
 const incoming={x:n.x-n.in.x,y:n.y-n.in.y},outgoing={x:n.out.x-n.x,y:n.out.y-n.y};
 assert.ok(Math.abs(incoming.x*outgoing.y-incoming.y*outgoing.x)<1e-7);
 assert.ok(incoming.x*outgoing.x+incoming.y*outgoing.y>0);
}

test('smoothing rounds selected corners while retaining anchors and unselected nodes',()=>{
 const p=curve([[0,0],[100,0],[100,100],[200,100]]),before=structuredClone(p);
 // Existing handles also need recomputing, rather than simply changing node mode.
 p.nodes[1].in={x:80,y:0};p.nodes[1].out={x:140,y:0};
 g.smoothNodes(p,[1,2]);
 assert.deepEqual(p.nodes.map(g.point),before.nodes.map(g.point));
 assert.deepEqual(p.nodes[0],before.nodes[0]);assert.deepEqual(p.nodes[3],before.nodes[3]);
 for(const i of [1,2]){assert.equal(p.nodes[i].mode,'smooth');aligned(p.nodes[i]);assert.ok(g.dist(p.nodes[i],p.nodes[i].in)>0);}
 assert.ok(p.nodes[1].out.y>p.nodes[1].y);assert.ok(p.nodes[2].in.x<p.nodes[2].x);
 assert.ok(g.at(p.nodes[0],p.nodes[1],.5).y<0);
 const once=structuredClone(p);g.smoothNodes(p,[2,1,2]);assert.deepEqual(p,once);
});

test('open endpoints follow their adjacent segment and unused handles remain collapsed',()=>{
 const p=curve([[0,0],[100,0],[100,100]]);g.smoothNodes(p,[0,1,2]);
 assert.deepEqual(p.nodes[0].in,g.point(p.nodes[0]));assert.deepEqual(p.nodes[2].out,g.point(p.nodes[2]));
 assert.ok(p.nodes[0].out.x>0);assert.equal(p.nodes[0].out.y,0);
 assert.ok(p.nodes[2].in.y<100);assert.equal(p.nodes[2].in.x,100);aligned(p.nodes[1]);
});

test('closed smoothing follows the last-to-first connection without opening the curve',()=>{
 const p=curve([[0,0],[100,0],[100,100],[0,100]],true),before=structuredClone(p);
 g.smoothNodes(p,[3,0]);assert.equal(p.closed,true);assert.equal(p.nodes.length,4);
 assert.deepEqual(p.nodes.map(g.point),before.nodes.map(g.point));
 aligned(p.nodes[0]);aligned(p.nodes[3]);assert.ok(g.dist(p.nodes[0],p.nodes[0].in)>0);
 assert.deepEqual(p.nodes[1],before.nodes[1]);assert.deepEqual(p.nodes[2],before.nodes[2]);
});

test('unequal spacing keeps each handle bounded by its own adjacent segment',()=>{
 const p=curve([[0,0],[1,0],[1,1000]]);g.smoothNodes(p,[1]);const n=p.nodes[1];
 aligned(n);assert.ok(g.dist(n,n.in)<=1/3+1e-9);assert.ok(g.dist(n,n.out)<=1000/3+1e-9);
 assert.ok(g.dist(n,n.in)>0);assert.ok(g.dist(n,n.out)>0);
});

test('coincident anchors, reversals and isolated points remain finite without loops',()=>{
 for(const p of [curve([[5,5]]),curve([[0,0],[0,0],[100,0]]),curve([[0,0],[100,0],[0,0]]),curve([[5,5],[5,5]],true)]){
  const before=structuredClone(p);g.smoothNodes(p,p.nodes.map((_,i)=>i));
  assert.deepEqual(p.nodes.map(g.point),before.nodes.map(g.point));
  for(const n of p.nodes)for(const point of [n,n.in,n.out])assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
  if(p.nodes.length===3&&p.nodes[0].x===p.nodes[2].x){assert.deepEqual(p.nodes[1].in,g.point(p.nodes[1]));assert.deepEqual(p.nodes[1].out,g.point(p.nodes[1]));}
  if(p.nodes.length>1&&g.dist(p.nodes[0],p.nodes[1])===0)assert.equal(g.segmentLength(p,0),0);
 }
 const p=curve([[0,0],[100,100]]),before=structuredClone(p);g.smoothNodes(p,[-1,2,1.5]);assert.deepEqual(p,before);
});
