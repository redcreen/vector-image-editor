const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');

test('alignment chooses the closest anchor inside a narrow screen-scaled radius without changing input',()=>{
 const sources=[{x:10,y:20},{x:30,y:40}],targets=[{x:12,y:22},{x:31,y:40},{x:100,y:100}];
 const before=JSON.stringify({sources,targets});
 assert.equal(typeof G.nearestNodeAlignment,'function');
 const hit=G.nearestNodeAlignment(sources,targets,3);
 assert.equal(hit.source,sources[1]);assert.equal(hit.target,targets[1]);assert.equal(hit.distance,1);
 assert.equal(hit.dx,1);assert.equal(hit.dy,0);
 assert.equal(JSON.stringify({sources,targets}),before);
 assert.equal(G.nearestNodeAlignment(sources,targets,3/4),null);
});

test('alignment uses circular distance, handles negative cells and includes the exact boundary',()=>{
 const sources=[{x:-3,y:-3}];
 assert.equal(G.nearestNodeAlignment(sources,[{x:0,y:0}],3),null);
 assert.equal(G.nearestNodeAlignment(sources,[{x:0,y:-3}],3).distance,3);
 assert.equal(G.nearestNodeAlignment(sources,[{x:-3,y:-3}],3).distance,0);
 assert.equal(G.nearestNodeAlignment([],sources,3),null);
 assert.equal(G.nearestNodeAlignment(sources,[],3),null);
});

test('Shift direction wins over a nearby off-axis anchor but still allows an on-axis target',()=>{
 const source={x:10,y:10},offAxis={x:11,y:11},onAxis={x:12,y:10};
 const hit=G.nearestNodeAlignment([source],[offAxis,onAxis],3,{x:1,y:0});
 assert.equal(hit.target,onAxis);
 assert.equal(G.nearestNodeAlignment([source],[offAxis],3,{x:1,y:0}),null);
 assert.equal(G.nearestNodeAlignment([source],[offAxis],3,{x:Math.SQRT1_2,y:Math.SQRT1_2}).target,offAxis);
});

test('a dense drawing finds the nearest anchor in distant and negative coordinates',()=>{
 const targets=Array.from({length:20000},(_,i)=>({x:i*5-50000,y:i%19*10}));
 const target=targets[17321],source={x:target.x+.25,y:target.y-.25};
 const hit=G.nearestNodeAlignment([source],targets,3);
 assert.equal(hit.target,target);assert.equal(hit.dx,-.25);assert.equal(hit.dy,.25);
});

test('axis alignment projects the nearest node onto an infinite line without changing inputs',()=>{
 assert.equal(typeof G.nearestAxisAlignment,'function');
 const sources=[{x:12,y:20},{x:10.5,y:-40}],axis={a:{x:10,y:0},b:{x:10,y:10}},before=JSON.stringify({sources,axis});
 const hit=G.nearestAxisAlignment(sources,axis,3);assert.equal(hit.source,sources[1]);assert.deepEqual(hit.target,{x:10,y:-40});assert.equal(hit.dx,-.5);assert.equal(hit.dy,0);assert.equal(hit.distance,.5);assert.equal(hit.kind,'axis');assert.equal(JSON.stringify({sources,axis}),before);
 const horizontal=G.nearestAxisAlignment([{x:150,y:13}],{a:{x:0,y:10},b:{x:1,y:10}},3);assert.deepEqual(horizontal.target,{x:150,y:10});assert.equal(horizontal.distance,3);
 const oblique=G.nearestAxisAlignment([{x:4,y:6}],{a:{x:0,y:0},b:{x:10,y:10}},3);assert.ok(G.dist(oblique.target,{x:5,y:5})<1e-10);
 assert.equal(G.nearestAxisAlignment([{x:12,y:20}],axis,3/4),null);
});

test('axis alignment respects Shift direction and rejects intersections beyond the snap radius',()=>{
 const axis={a:{x:0,y:0},b:{x:10,y:0}},source={x:5,y:2};
 assert.equal(G.nearestAxisAlignment([source],axis,3,{x:1,y:0}),null);
 const hit=G.nearestAxisAlignment([source],axis,3,{x:1,y:-1});assert.ok(G.dist(hit.target,{x:7,y:0})<1e-10);assert.ok(Math.abs(hit.dx+hit.dy)<1e-10);
 assert.equal(G.nearestAxisAlignment([source],axis,2,{x:1,y:-1}),null);
 assert.equal(G.nearestAxisAlignment([{x:5,y:0}],axis,3,{x:1,y:0}).distance,0);
});

test('axis alignment rejects absent or degenerate axes and invalid radii',()=>{
 const sources=[{x:2,y:3}],axis={a:{x:0,y:0},b:{x:10,y:10}};
 for(const radius of [0,-1,NaN,Infinity])assert.equal(G.nearestAxisAlignment(sources,axis,radius),null);
 for(const invalid of [null,{}, {a:{x:0,y:0},b:{x:0,y:0}}])assert.equal(G.nearestAxisAlignment(sources,invalid,3),null);
 assert.equal(G.nearestAxisAlignment([],axis,3),null);
});
