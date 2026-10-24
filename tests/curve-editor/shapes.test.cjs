const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');

const close=(actual,expected,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<=tolerance,JSON.stringify({actual,expected,tolerance}));

test('shapeBounds normalizes either drag direction',()=>{
 assert.deepEqual(G.shapeBounds({x:80,y:60},{x:20,y:10}),{x:20,y:10,width:60,height:50});
 assert.deepEqual(G.shapeBounds({x:-5,y:12},{x:15,y:-8}),{x:-5,y:-8,width:20,height:20});
});

test('shapeBounds constrains from the start point using the longer drag axis',()=>{
 assert.deepEqual(G.shapeBounds({x:10,y:20},{x:40,y:10},true),{x:10,y:-10,width:30,height:30});
 assert.deepEqual(G.shapeBounds({x:10,y:20},{x:-5,y:60},true),{x:-30,y:20,width:40,height:40});
 assert.deepEqual(G.shapeBounds({x:3,y:4},{x:3,y:4},true),{x:3,y:4,width:0,height:0});
});

test('createShape creates a closed rectangle with cusp nodes and straight segments',()=>{
 const path=G.createShape('rectangle',{x:70,y:50},{x:10,y:20});
 assert.equal(path.closed,true);
 assert.deepEqual(path.nodes.map(n=>({x:n.x,y:n.y})),[
  {x:10,y:20},{x:70,y:20},{x:70,y:50},{x:10,y:50}
 ]);
 for(const n of path.nodes){assert.equal(n.mode,'cusp');assert.deepEqual(n.in,{x:n.x,y:n.y});assert.deepEqual(n.out,{x:n.x,y:n.y});}
 assert.deepEqual(G.pathBounds(path),{x:10,y:20,width:60,height:30});
 for(let i=0;i<4;i++)close(G.segmentLength(path,i),i%2===0?60:30);
});

test('createShape applies equal dimensions to rectangles and ellipses',()=>{
 assert.deepEqual(G.pathBounds(G.createShape('rectangle',{x:25,y:30},{x:5,y:70},true)),{x:-15,y:30,width:40,height:40});
 assert.deepEqual(G.pathBounds(G.createShape('ellipse',{x:25,y:30},{x:5,y:70},true)),{x:-15,y:30,width:40,height:40});
});

test('createShape creates a clockwise four-node ellipse with symmetric tangent handles',()=>{
 const path=G.createShape('ellipse',{x:10,y:20},{x:110,y:80});
 const kappa=4*(Math.sqrt(2)-1)/3;
 assert.equal(path.closed,true);
 assert.deepEqual(path.nodes.map(n=>({x:n.x,y:n.y,mode:n.mode})),[
  {x:60,y:20,mode:'symmetric'},
  {x:110,y:50,mode:'symmetric'},
  {x:60,y:80,mode:'symmetric'},
  {x:10,y:50,mode:'symmetric'}
 ]);
 close(path.nodes[0].out.x,60+50*kappa);close(path.nodes[0].out.y,20);
 close(path.nodes[0].in.x,60-50*kappa);close(path.nodes[0].in.y,20);
 close(path.nodes[1].in.x,110);close(path.nodes[1].in.y,50-30*kappa);
 close(path.nodes[1].out.x,110);close(path.nodes[1].out.y,50+30*kappa);
 for(const n of path.nodes){
  close(n.in.x+n.out.x,2*n.x);close(n.in.y+n.out.y,2*n.y);
  close((n.in.x-n.x)*(n.out.y-n.y)-(n.in.y-n.y)*(n.out.x-n.x),0);
 }
 assert.deepEqual(G.pathBounds(path),{x:10,y:20,width:100,height:60});
});

test('ellipse cubic approximation stays within standard kappa radial error',()=>{
 const path=G.createShape('ellipse',{x:-70,y:15},{x:130,y:95});
 const center={x:30,y:55},radii={x:100,y:40};
 let maximumError=0;
 for(let segment=0;segment<4;segment++)for(let sample=0;sample<=100;sample++){
  const p=G.at(path.nodes[segment],path.nodes[(segment+1)%4],sample/100);
  const radius=Math.hypot((p.x-center.x)/radii.x,(p.y-center.y)/radii.y);
  maximumError=Math.max(maximumError,Math.abs(radius-1));
 }
 assert.ok(maximumError<=0.0003,maximumError);
});

test('createShape rejects degenerate, nonfinite, and unsupported shapes',()=>{
 assert.equal(G.createShape('rectangle',{x:1,y:2},{x:1,y:8}),null);
 assert.equal(G.createShape('ellipse',{x:1,y:2},{x:9,y:2}),null);
 for(const bad of [
  ()=>G.shapeBounds({x:NaN,y:0},{x:1,y:1}),
  ()=>G.shapeBounds({x:0,y:0},{x:Infinity,y:1}),
  ()=>G.createShape('rectangle',{x:0,y:0},{x:1,y:-Infinity}),
  ()=>G.createShape('triangle',{x:0,y:0},{x:1,y:1})
 ])assert.throws(bad,RangeError);
});
