const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const path=(id,points)=>({id,name:id,color:'#123456',closed:false,nodes:points.map(([x,y])=>({...G.node(x,y),in:{x:x-2,y:y+3},out:{x:x+2,y:y-3}}))});
test('coincident connections preserve every cubic and map reversed nodes and segments in independent chains and rings',()=>{
 const paths=[path('a',[[0,0],[10,0]]),path('b',[[20,0],[10,0]]),path('c',[[100,0],[120,0]]),path('d',[[120,0],[110,20]]),path('e',[[110,20],[100,0]]),path('far',[[30,0],[40,0]])],before=structuredClone(paths);
 const result=G.connectCoincidentEndpoints(paths,'b');
 assert.equal(result.joins,4);assert.equal(result.paths.length,3);
 assert.equal(result.paths.find(p=>p.id==='b').name,'b');assert.equal(result.paths.filter(p=>p.closed).length,1);
 for(const old of paths){
  const map=result.mapping.find(m=>m.sourceId===old.id);if(!map)continue;
  const next=result.paths.find(p=>p.id===map.pathId);
  old.nodes.forEach((n,i)=>assert.deepEqual(G.point(next.nodes[map.nodes[i]]),G.point(n)));
  for(let i=0;i<old.nodes.length-1;i++)for(const t of [0,.2,.63,1]){
   const m=map.segments[i],a=next.nodes[m.index],b=next.nodes[(m.index+1)%next.nodes.length];
   assert.ok(G.dist(G.at(old.nodes[i],old.nodes[i+1],t),G.at(a,b,m.reversed?1-t:t))<1e-9);
  }
 }
 assert.deepEqual(paths,before);assert.deepEqual(result.paths.find(p=>p.id==='far'),paths.at(-1));
});
test('coincident connections never bridge gaps or guess at branches, including a loop at a branch',()=>{
 const paths=[path('a',[[0,0],[10,0]]),path('b',[[10,0],[20,0]]),path('c',[[10,0],[10,20]]),path('near',[[20+1e-10,0],[30,0]])];
 const r=G.connectCoincidentEndpoints(paths);assert.equal(r.joins,0);assert.equal(r.ambiguous,1);assert.deepEqual(r.paths,paths);
 const branch=[path('loop',[[0,0],[10,0],[10,10],[0,0]]),path('tail',[[0,0],[-10,0]])];
 assert.equal(G.connectCoincidentEndpoints(branch).joins,0);
});
test('coincident connections close duplicate-end loops, leave short rings open and preserve closed curves',()=>{
 const loop=path('loop',[[0,0],[10,0],[10,10],[0,0]]),short=path('short',[[30,0],[40,0],[30,0]]),closed={...path('closed',[[0,0],[0,20],[20,20]]),closed:true};
 const r=G.connectCoincidentEndpoints([loop,short,closed]);
 assert.equal(r.joins,1);assert.equal(r.skippedClosures,1);assert.equal(r.paths[0].closed,true);assert.equal(r.paths[0].nodes.length,3);
 assert.deepEqual(r.mapping[0].nodes,[0,1,2,0]);assert.deepEqual(r.paths.slice(1),[short,closed]);
});
test('coincident connections preserve symmetry directions, notch membership and reject oversized results atomically',()=>{
 const a=path('a',[[0,0],[10,0]]),b=path('b',[[20,0],[10,0]]);
 b.nodes[1].notchId='notch';b.nodes[1].symmetry={in:{id:'link',side:'a',dir:1}};
 const r=G.connectCoincidentEndpoints([a,b],'a');assert.equal(r.paths[0].nodes[1].notchId,'notch');
 assert.equal(r.paths[0].nodes[1].symmetry.out.dir,-1);
 const big=path('big',Array.from({length:6000},(_,i)=>[i,0])),other=path('other',Array.from({length:4002},(_,i)=>[5999+i,0]));
 assert.throws(()=>G.connectCoincidentEndpoints([big,other]),/10000/);assert.equal(big.nodes.length,6000);
});
