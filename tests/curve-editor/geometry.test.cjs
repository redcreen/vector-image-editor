const {test}=require('node:test');
const assert=require('node:assert/strict');
const g=require('../../tools/curve-editor/geometry.js');
const near=(a,b)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-7,JSON.stringify({a,b}));
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,JSON.stringify({a,b,tolerance}));
test('new nodes retain the requested type instead of always becoming cusp nodes',()=>{
 for(const mode of ['cusp','smooth','symmetric'])assert.equal(g.node(10,20,mode).mode,mode);
});
test('appending a smooth node gives it handles without changing existing node types',()=>{
 const path={closed:false,nodes:[g.node(0,0,'smooth')]};
 g.append(path,{x:120,y:80},'smooth');
 assert.deepEqual(path.nodes.map(n=>n.mode),['smooth','smooth']);
 assert.ok(g.dist(path.nodes[1],path.nodes[1].in)>0);
 g.append(path,{x:200,y:0},'symmetric');
 assert.deepEqual(path.nodes.map(n=>n.mode),['smooth','smooth','symmetric']);
 const restored=JSON.parse(JSON.stringify({newNodeMode:'symmetric',path}));
 assert.equal(restored.newNodeMode,'symmetric');assert.deepEqual(restored.path.nodes.map(n=>n.mode),['smooth','smooth','symmetric']);
});
test('splitting a cubic preserves the entire curve, not only the split point',()=>{
  const a=g.node(10,20),b=g.node(240,150);a.out={x:60,y:-120};b.in={x:180,y:310};
  const path={nodes:[a,b],closed:false};
  const samples=Array.from({length:101},(_,i)=>g.at(a,b,i/100));
  g.split(path,0,0.37);
  samples.forEach((p,i)=>{let t=i/100;near(p,t<=.37?g.at(path.nodes[0],path.nodes[1],t/.37):g.at(path.nodes[1],path.nodes[2],(t-.37)/.63));});
});
test('moving a node moves both handles by the same offset',()=>{
 const n=g.node(20,30);n.in={x:2,y:8};n.out={x:50,y:60};g.move(n,7,-9);
 near(n,{x:27,y:21});near(n.in,{x:9,y:-1});near(n.out,{x:57,y:51});
});
test('smooth handles remain collinear and preserve the opposite handle length',()=>{
 const n=g.node(0,0);n.mode='smooth';n.in={x:-30,y:0};n.out={x:20,y:0};g.handle(n,'out',{x:0,y:80});near(n.in,{x:0,y:-30});
});
test('symmetric handles mirror exactly; cusp handles stay independent',()=>{
 const n=g.node(10,10);n.mode='symmetric';g.handle(n,'out',{x:30,y:40});near(n.in,{x:-10,y:-20});
 n.mode='cusp';g.handle(n,'out',{x:90,y:90});near(n.in,{x:-10,y:-20});
});
test('closed final segment is split without opening the path',()=>{
 const p={closed:true,nodes:[g.node(0,0),g.node(100,0),g.node(100,100)]};const expected=g.at(p.nodes[2],p.nodes[0],.5);
 g.split(p,2,.5);assert.equal(p.closed,true);assert.equal(p.nodes.length,4);near(p.nodes[3],expected);
});

test('reflectPoint mirrors across horizontal, vertical, and oblique infinite lines',()=>{
 near(g.reflectPoint({x:7,y:9},{x:0,y:2},{x:10,y:2}),{x:7,y:-5});
 near(g.reflectPoint({x:7,y:9},{x:3,y:-10},{x:3,y:20}),{x:-1,y:9});
 near(g.reflectPoint({x:8,y:2},{x:0,y:0},{x:10,y:10}),{x:2,y:8});
});

test('reflectPoint rejects a zero or near-zero mirror axis',()=>{
 assert.throws(()=>g.reflectPoint({x:1,y:2},{x:3,y:4},{x:3,y:4}),RangeError);
 assert.throws(()=>g.reflectPoint({x:1,y:2},{x:3,y:4},{x:3+1e-12,y:4}),RangeError);
});

test('reflectPath preserves metadata and modes in a deeply independent copy',()=>{
 const a=g.node(2,3,'smooth'),b=g.node(8,5,'symmetric');
 a.in={x:1,y:4};a.out={x:4,y:1};b.in={x:6,y:7};b.out={x:9,y:2};
 const path={id:'old',name:'sample',closed:false,color:'#123',meta:{tags:['kept']},nodes:[a,b]};
 const reflected=g.reflectPath(path,{x:0,y:0},{x:10,y:0});
 assert.equal(reflected.id,'old');assert.equal(reflected.name,'sample');
 assert.deepEqual(reflected.nodes.map(n=>n.mode),['smooth','symmetric']);
 near(reflected.nodes[0],{x:2,y:-3});near(reflected.nodes[0].in,{x:1,y:-4});near(reflected.nodes[1].out,{x:9,y:-2});
 const twice=g.reflectPath(reflected,{x:0,y:0},{x:10,y:0});
 near(twice.nodes[0],path.nodes[0]);near(twice.nodes[0].in,path.nodes[0].in);near(twice.nodes[1].out,path.nodes[1].out);
 reflected.meta.tags.push('new');reflected.nodes[0].in.x=99;
 assert.deepEqual(path.meta.tags,['kept']);assert.equal(path.nodes[0].in.x,1);
});

test('reflectPath rejects a degenerate mirror axis without touching its input',()=>{
 const path={closed:false,nodes:[g.node(1,2)]};
 assert.throws(()=>g.reflectPath(path,{x:0,y:0},{x:0,y:0}),RangeError);
 assert.deepEqual(path,{closed:false,nodes:[g.node(1,2)]});
});

test('segmentCount handles open, closed, and undersized paths',()=>{
 assert.equal(g.segmentCount({closed:false,nodes:[]}),0);
 assert.equal(g.segmentCount({closed:true,nodes:[g.node(0,0)]}),0);
 assert.equal(g.segmentCount({closed:false,nodes:[g.node(0,0),g.node(1,0),g.node(2,0)]}),2);
 assert.equal(g.segmentCount({closed:true,nodes:[g.node(0,0),g.node(1,0),g.node(2,0)]}),3);
});

test('segmentLength measures straight, zero, and curved cubic segments',()=>{
 const a=g.node(0,0),b=g.node(100,0);a.out={x:0,y:0};b.in={x:100,y:0};
 const straight={closed:false,nodes:[a,b]};
 close(g.segmentLength(straight,0),100);assert.equal(g.segmentLength(straight,1),0);
 const z0=g.node(5,5),z1=g.node(5,5);close(g.segmentLength({closed:false,nodes:[z0,z1]},0),0);
 const c0=g.node(0,0),c1=g.node(100,0);c0.out={x:0,y:100};c1.in={x:100,y:100};
 close(g.segmentLength({closed:false,nodes:[c0,c1]},0),200,0.002);
});

test('segmentLength measures collinear backtracking even with coincident endpoints',()=>{
 const a=g.node(0,0),b=g.node(0,0);a.out={x:100,y:0};b.in={x:-100,y:0};
 close(g.segmentLength({closed:false,nodes:[a,b]},0),115.470054,0.002);
});

test('cubic arc length is invariant when the segment is split',()=>{
 const a=g.node(0,0),b=g.node(140,30);a.out={x:-40,y:180};b.in={x:210,y:-120};
 const path={closed:false,nodes:[a,b]},before=g.segmentLength(path,0,0.0001);
 g.split(path,0,0.37);
 close(g.segmentLength(path,0,0.0001)+g.segmentLength(path,1,0.0001),before,0.001);
});

test('pathLength sums all or unique valid selected segments, including closed perimeter',()=>{
 const square={closed:true,nodes:[g.node(0,0),g.node(10,0),g.node(10,10),g.node(0,10)]};
 close(g.pathLength(square),40);close(g.pathLength(square,[3,1,1,-1,99]),20);
 assert.equal(g.pathLength({closed:false,nodes:[g.node(0,0)]}),0);
});

test('polylineLength sums consecutive distances without closing the line',()=>{
 close(g.polylineLength([{x:0,y:0},{x:3,y:4},{x:3,y:12}]),13);
 assert.equal(g.polylineLength([]),0);assert.equal(g.polylineLength([{x:1,y:2}]),0);
});

test('segmentRange returns direct open and closed ranges and optional closed wraparound',()=>{
 const open={closed:false,nodes:Array.from({length:6},(_,i)=>g.node(i,0))};
 const closed={closed:true,nodes:Array.from({length:6},(_,i)=>g.node(i,0))};
 assert.deepEqual(g.segmentRange(open,4,1),[1,2,3,4]);
 assert.deepEqual(g.segmentRange(open,4,1,true),[1,2,3,4]);
 assert.deepEqual(g.segmentRange(closed,4,1),[1,2,3,4]);
 assert.deepEqual(g.segmentRange(closed,4,1,true),[4,5,0,1]);
 assert.deepEqual(g.segmentRange(closed,2,2,true),[2]);
 assert.deepEqual(g.segmentRange(closed,-1,2),[]);assert.deepEqual(g.segmentRange(closed,2,6),[]);
});

test('segmentD emits only the requested cubic segment',()=>{
 const a=g.node(0,0),b=g.node(10,20);a.out={x:3,y:4};b.in={x:7,y:8};
 const path={closed:false,nodes:[a,b]};
 assert.equal(g.segmentD(path,0),'M 0 0 C 3 4 7 8 10 20');
 assert.equal(g.segmentD(path,1),'');
});
