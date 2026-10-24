const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const N=require('../../tools/curve-editor/notches.js');
const path=(id,points)=>({id,closed:false,nodes:points.map(([x,y])=>G.node(x,y))});
const fixture=()=>{
 const a=path('a',[[0,0],[10,0]]),b=path('b',[[10,0],[15,5],[20,0],[30,0]]);
 N.define(G,b,[0,1,2],'notch');return [a,b];
};
for(const mode of ['merge','join','connect']){
 const connect=(a,b)=>mode==='merge'?G.mergePaths([a,b]):mode==='join'?G.joinEndpoints(a,a.nodes.length-1,b,0).path:G.connectCoincidentEndpoints([a,b],'a').paths[0];
 test(`${mode} retains a protected notch at a coalesced endpoint`,()=>{
  const [a,b]=fixture(),before=structuredClone([a,b]),joined=connect(a,b);
  assert.deepEqual(N.groups(joined).map(g=>({id:g.id,indices:g.indices})),[{id:'notch',indices:[1,2,3]}]);
  assert.equal(G.pathLength(N.baseline(G,joined)),30);
  assert.deepEqual([a,b],before);
 });
 test(`${mode} refuses conflicting protected endpoints without changing sources`,()=>{
  const [a,b]=fixture();a.nodes.unshift(G.node(-10,0),G.node(-5,5));
  N.define(G,a,[1,2,3],'other');const before=structuredClone([a,b]);
  assert.throws(()=>connect(a,b),/剪口/);assert.deepEqual([a,b],before);
 });
}
test('closing explicit endpoints retains the closing notch and rejects incompatible groups',()=>{
 const p=path('closed',[[0,0],[30,0],[30,30],[10,10],[5,5],[0,0]]);
 N.define(G,p,[3,4,5],'end');const before=structuredClone(p);
 const closed=G.joinEndpoints(p,5,p,0).path;
 assert.deepEqual(N.groups(closed).map(g=>g.indices),[[3,4,0]]);assert.deepEqual(p,before);
 N.define(G,p,[0,1,2],'start');const conflict=structuredClone(p);
 assert.throws(()=>G.joinEndpoints(p,5,p,0),/剪口/);assert.deepEqual(p,conflict);
});
