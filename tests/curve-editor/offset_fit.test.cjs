const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../../tools/curve-editor/offset-fit.js');

test('offset verification bounds intervals between samples on both polylines',()=>{
 const a=[{x:0,y:0},{x:10,y:0}],b=[{x:0,y:.02},{x:10,y:.02}];
 const result=F.withinTolerance(a,b,.05,false);
 assert.equal(result.accepted,true);assert.ok(result.maxBound<=.05);
});
test('matching endpoints do not hide a missed bend',()=>{
 const a=[{x:0,y:0},{x:2,y:0}],b=[{x:0,y:0},{x:1,y:1},{x:2,y:0}];
 assert.equal(F.withinTolerance(a,b,.05,false).accepted,false);
});
test('a narrow notch must pass the reverse distance check too',()=>{
 const p=(x,y)=>({x,y}),box=[p(0,0),p(10,0),p(10,10),p(0,10)];
 const notch=[p(0,0),p(10,0),p(10,10),p(5.001,10),p(5.001,9.8),p(5,9.8),p(5,10),p(0,10)];
 assert.equal(F.withinTolerance(box,notch,.05,true).accepted,false);
});
test('exhausted verification budget rejects the candidate',()=>{
 const a=[{x:0,y:0},{x:10,y:0}];
 assert.equal(F.withinTolerance(a,a,.05,false,1).accepted,false);
});
test('an exact long line is certified even at fine tolerance without exhaustive subdivision',()=>{
 const a=[{x:0,y:0},{x:10000,y:0}];
 assert.equal(F.withinTolerance(a,a,.000001,false,20).accepted,true);
});
