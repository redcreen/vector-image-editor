const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const W=require('../../tools/curve-editor/walk.js');

const near=(actual,expected,tolerance=1e-5)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const nearPoint=(actual,expected,tolerance=1e-5)=>{near(actual.x,expected.x,tolerance);near(actual.y,expected.y,tolerance);};
const line=(a,b,closed=false)=>({closed,nodes:[G.node(...a),G.node(...b)]});
const polyline=(points,closed=false)=>({closed,nodes:points.map(point=>G.node(...point))});

test('track and at use physical arc length on straight and curved seams',()=>{
 const straight=W.track(line([0,0],[100,0])),curve=line([0,0],[100,0]);
 curve.nodes[0].out={x:0,y:100};curve.nodes[1].in={x:100,y:100};
 const bowed=W.track(curve,.0005);
 near(straight.length,100);assert.ok(bowed.length>190&&bowed.length<210);
 nearPoint(W.at(straight,25).point,{x:25,y:0});
 const quarter=W.at(bowed,bowed.length/4),threeQuarter=W.at(bowed,bowed.length*3/4);
 near(quarter.point.x,100-threeQuarter.point.x,.01);near(quarter.point.y,threeQuarter.point.y,.01);
 near(Math.hypot(quarter.tangent.x,quarter.tangent.y),1,1e-10);
 nearPoint(W.at(straight,-50).point,{x:0,y:0});nearPoint(W.at(straight,500).point,{x:100,y:0});
});

test('at has a stable unit tangent when a cubic endpoint derivative is zero',()=>{
 const path=line([0,0],[100,0]);
 const tracked=W.track(path);
 for(const s of [0,tracked.length]){
  const sample=W.at(tracked,s);near(Math.hypot(sample.tangent.x,sample.tangent.y),1,1e-10);nearPoint(sample.tangent,{x:1,y:0});
 }
});

test('nearest reports the physical station, projected point and distance',()=>{
 const tracked=W.track(polyline([[0,0],[40,0],[40,60]]));
 const hit=W.nearest(tracked,{x:43,y:25});
 near(hit.s,65,.01);nearPoint(hit.point,{x:40,y:25},.01);near(hit.distance,3,.01);
});

test('nearest searches a full span when a straight cubic has highly nonuniform parameter speed',()=>{
 const path=line([0,0],[100,0]);path.nodes[1].in={x:0,y:0};
 const hit=W.nearest(W.track(path),{x:10,y:3});
 nearPoint(hit.point,{x:10,y:0},.002);near(hit.s,10,.002);near(hit.distance,3,.002);
});

test('limit and position clamp open seams and wrap closed seams',()=>{
 const open=W.track(line([0,0],[100,0]));
 near(W.limit(open,30,1),70);near(W.limit(open,30,-1),30);
 let p=W.position(open,30,-1,80);nearPoint(p.point,{x:0,y:0});nearPoint(p.tangent,{x:-1,y:0});near(p.s,0);
 const closed=W.track(polyline([[0,0],[10,0],[10,10],[0,10]],true));
 near(closed.length,40,.001);near(W.limit(closed,8,-1),40);
 p=W.position(closed,38,1,5);near(p.s,3,.001);nearPoint(p.point,{x:3,y:0},.001);
 p=W.position(closed,2,-1,5);near(p.s,37,.001);nearPoint(p.point,{x:0,y:3},.001);
});

test('degenerate paths and invalid points fail explicitly',()=>{
 assert.throws(()=>W.track({closed:false,nodes:[G.node(1,1),G.node(1,1)]}),/non-zero|length/i);
 const tracked=W.track(line([0,0],[10,0]));
 assert.throws(()=>W.nearest(tracked,{x:NaN,y:0}),/finite/i);
});

test('exact and clamped stations preserve large-coordinate endpoints',()=>{
 const path=line([0,0],[10000000,0]);
 path.nodes[0].out={x:3000000,y:0};path.nodes[1].in={x:7000000,y:0};
 const tracked=W.track(path);
 for(const s of [-1,0])assert.deepEqual(W.at(tracked,s).point,G.point(path.nodes[0]));
 for(const s of [tracked.length,tracked.length+1])assert.deepEqual(W.at(tracked,s).point,G.point(path.nodes[1]));
});
