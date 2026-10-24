const {test}=require('node:test');
const assert=require('node:assert/strict');
const g=require('../../tools/curve-editor/geometry.js');

const finitePoint=p=>Number.isFinite(p.x)&&Number.isFinite(p.y);
const segmentPoint=(a,b,t)=>g.at(a,b,t);

test('toggleSegment opens editable handles on one straight segment without changing adjacent geometry',()=>{
 const nodes=[g.node(0,0),g.node(100,0,'smooth'),g.node(100,100,'symmetric'),g.node(200,100)];
 nodes[0].out={x:25,y:-10};
 nodes[1].in={x:70,y:-20};
 nodes[2].out={x:130,y:120};
 nodes[3].in={x:175,y:110};
 const path={id:'open',closed:false,nodes},before=structuredClone(path);

 assert.equal(g.toggleSegment(path,1),'curve');

 assert.deepEqual(path.nodes[0],before.nodes[0]);
 assert.deepEqual(path.nodes[3],before.nodes[3]);
 assert.deepEqual({x:path.nodes[1].x,y:path.nodes[1].y,in:path.nodes[1].in},
  {x:before.nodes[1].x,y:before.nodes[1].y,in:before.nodes[1].in});
 assert.deepEqual({x:path.nodes[2].x,y:path.nodes[2].y,out:path.nodes[2].out},
  {x:before.nodes[2].x,y:before.nodes[2].y,out:before.nodes[2].out});
 assert.equal(path.nodes[1].mode,'cusp');assert.equal(path.nodes[2].mode,'cusp');
 assert.ok(g.dist(path.nodes[1],path.nodes[1].out)>.01);
 assert.ok(g.dist(path.nodes[2],path.nodes[2].in)>.01);
 assert.ok(finitePoint(path.nodes[1].out)&&finitePoint(path.nodes[2].in));
 const startDirection={x:path.nodes[1].x-path.nodes[1].in.x,y:path.nodes[1].y-path.nodes[1].in.y};
 const startHandle={x:path.nodes[1].out.x-path.nodes[1].x,y:path.nodes[1].out.y-path.nodes[1].y};
 const endDirection={x:path.nodes[2].out.x-path.nodes[2].x,y:path.nodes[2].out.y-path.nodes[2].y};
 const endHandle={x:path.nodes[2].x-path.nodes[2].in.x,y:path.nodes[2].y-path.nodes[2].in.y};
 assert.ok(Math.abs(startDirection.x*startHandle.y-startDirection.y*startHandle.x)<1e-9);
 assert.ok(startDirection.x*startHandle.x+startDirection.y*startHandle.y>0);
 assert.ok(Math.abs(endDirection.x*endHandle.y-endDirection.y*endHandle.x)<1e-9);
 assert.ok(endDirection.x*endHandle.x+endDirection.y*endHandle.y>0);
});

test('toggleSegment keeps a collinear segment visually straight while exposing nonzero handles',()=>{
 const path={closed:false,nodes:[g.node(0,0),g.node(90,0),g.node(180,0),g.node(270,0)]};
 assert.equal(g.toggleSegment(path,1),'curve');
 assert.ok(g.dist(path.nodes[1],path.nodes[1].out)>.01);
 assert.ok(g.dist(path.nodes[2],path.nodes[2].in)>.01);
 for(let i=0;i<=10;i++)assert.equal(segmentPoint(path.nodes[1],path.nodes[2],i/10).y,0);
});

test('toggleSegment collapses only the selected curved segment handles',()=>{
 const nodes=[g.node(0,0),g.node(100,0,'smooth'),g.node(200,50,'symmetric'),g.node(300,0)];
 nodes[0].out={x:30,y:5};nodes[1].in={x:65,y:-15};nodes[1].out={x:135,y:60};
 nodes[2].in={x:165,y:80};nodes[2].out={x:235,y:10};nodes[3].in={x:270,y:-5};
 const path={closed:false,nodes},before=structuredClone(path);

 assert.equal(g.toggleSegment(path,1),'straight');

 assert.deepEqual(path.nodes[1].out,{x:100,y:0});
 assert.deepEqual(path.nodes[2].in,{x:200,y:50});
 assert.deepEqual(path.nodes[1].in,before.nodes[1].in);
 assert.deepEqual(path.nodes[2].out,before.nodes[2].out);
 assert.equal(path.nodes[1].mode,'cusp');assert.equal(path.nodes[2].mode,'cusp');
 assert.deepEqual(path.nodes[0],before.nodes[0]);assert.deepEqual(path.nodes[3],before.nodes[3]);
});

test('toggleSegment handles the closing segment of a closed path',()=>{
 const path={closed:true,nodes:[g.node(0,0),g.node(100,0),g.node(100,100)]};
 const middle=structuredClone(path.nodes[1]);
 assert.equal(g.toggleSegment(path,2),'curve');
 assert.ok(g.dist(path.nodes[2],path.nodes[2].out)>.01);
 assert.ok(g.dist(path.nodes[0],path.nodes[0].in)>.01);
 assert.deepEqual(path.nodes[1],middle);
 assert.equal(g.toggleSegment(path,2),'straight');
 assert.deepEqual(path.nodes[2].out,{x:100,y:100});
 assert.deepEqual(path.nodes[0].in,{x:0,y:0});
});

test('toggleSegment uses the final anchor before node zero on a closed first segment',()=>{
 const path={closed:true,nodes:[g.node(0,0),g.node(100,0),g.node(-100,0),g.node(0,100)]};
 assert.equal(g.toggleSegment(path,0),'curve');
 assert.ok(path.nodes[0].out.x>path.nodes[0].x);
 assert.ok(path.nodes[0].out.y<path.nodes[0].y);
});

test('toggleSegment rejects invalid segments without mutation',()=>{
 const paths=[null,{}, {closed:false,nodes:[g.node(0,0)]}, {closed:false,nodes:[g.node(0,0),g.node(10,0)]}];
 for(const [path,index] of [[paths[0],0],[paths[1],0],[paths[2],0],[paths[3],-1],[paths[3],1],[paths[3],.5]]){
  const before=structuredClone(path);
  assert.equal(g.toggleSegment(path,index),null);
  assert.deepEqual(path,before);
 }
});

test('toggleSegment treats a partly exposed segment as curved and handles coincident anchors without NaN',()=>{
 const partial={closed:false,nodes:[g.node(0,0),g.node(20,0)]};partial.nodes[0].out={x:.011,y:0};
 assert.equal(g.toggleSegment(partial,0),'straight');
 assert.deepEqual(partial.nodes[0].out,{x:0,y:0});assert.deepEqual(partial.nodes[1].in,{x:20,y:0});

 const coincident={closed:false,nodes:[g.node(5,5),g.node(5,5)]};
 assert.equal(g.toggleSegment(coincident,0),'curve');
 assert.ok(finitePoint(coincident.nodes[0].out)&&finitePoint(coincident.nodes[1].in));
 assert.equal(coincident.nodes[0].mode,'cusp');assert.equal(coincident.nodes[1].mode,'cusp');
});

test('toggleSegment treats handles exactly 0.01 px from their anchors as collapsed',()=>{
 const path={closed:false,nodes:[g.node(0,0),g.node(30,0)]};
 path.nodes[0].out={x:.01,y:0};path.nodes[1].in={x:29.99,y:0};
 assert.equal(g.toggleSegment(path,0),'curve');
 assert.ok(g.dist(path.nodes[0],path.nodes[0].out)>.01);
 assert.ok(g.dist(path.nodes[1],path.nodes[1].in)>.01);
});
