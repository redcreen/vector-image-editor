const {test}=require('node:test');
const assert=require('node:assert/strict');
const g=require('../../tools/curve-editor/geometry.js');

const path=(id,points,closed=false)=>({
 id,name:`curve-${id}`,role:'outline',color:'#2468ac',note:'keep me',meta:{tags:[id]},closed,
 nodes:points.map(([x,y],index)=>{
  const n=g.node(x,y,index%2?'smooth':'symmetric');
  n.in={x:x-11-index,y:y+7+index};n.out={x:x+13+index,y:y-5-index};n.label=`node-${index}`;
  return n;
 })
});
const reversed=p=>({...structuredClone(p),nodes:structuredClone(p.nodes).reverse().map(n=>({...n,in:n.out,out:n.in}))});
function sameSegment(a,b,c,d,reversedDirection=false){
 for(const t of [0,.13,.5,.81,1]){
  const expected=g.at(a,b,t),actual=g.at(c,d,reversedDirection?1-t:t);
  assert.ok(g.dist(expected,actual)<1e-9,JSON.stringify({expected,actual}));
 }
}

test('breakPath opens a closed curve at any node and preserves every cubic segment',()=>{
 const source=path('ring',[[0,0],[80,10],[100,90],[10,110]],true),before=structuredClone(source);
 const [opened]=g.breakPath(source,2);
 assert.equal(opened.closed,false);assert.deepEqual(opened.nodes.map(n=>[n.x,n.y]),[[100,90],[10,110],[0,0],[80,10],[100,90]]);
 for(let i=0;i<4;i++)sameSegment(before.nodes[(i+2)%4],before.nodes[(i+3)%4],opened.nodes[i],opened.nodes[i+1]);
 assert.deepEqual(opened.nodes[0].in,{x:100,y:90});assert.deepEqual(opened.nodes[0].out,before.nodes[2].out);
 assert.deepEqual(opened.nodes.at(-1).in,before.nodes[2].in);assert.deepEqual(opened.nodes.at(-1).out,{x:100,y:90});
 assert.equal(opened.nodes[0].mode,'cusp');assert.equal(opened.nodes.at(-1).mode,'cusp');
 for(const key of ['id','name','role','color','note'])assert.equal(opened[key],source[key]);
 assert.deepEqual(source,before);opened.meta.tags.push('changed');assert.deepEqual(source.meta.tags,['ring']);
});

test('breakPath splits an open curve at an interior node with independent endpoint copies',()=>{
 const source=path('open',[[0,0],[50,20],[100,-10],[160,30]]),before=structuredClone(source);
 const [left,right]=g.breakPath(source,2);
 assert.deepEqual(left.nodes.map(n=>n.x),[0,50,100]);assert.deepEqual(right.nodes.map(n=>n.x),[100,160]);
 sameSegment(before.nodes[0],before.nodes[1],left.nodes[0],left.nodes[1]);
 sameSegment(before.nodes[1],before.nodes[2],left.nodes[1],left.nodes[2]);
 sameSegment(before.nodes[2],before.nodes[3],right.nodes[0],right.nodes[1]);
 assert.deepEqual(left.nodes.at(-1).in,before.nodes[2].in);assert.deepEqual(left.nodes.at(-1).out,{x:100,y:-10});
 assert.deepEqual(right.nodes[0].in,{x:100,y:-10});assert.deepEqual(right.nodes[0].out,before.nodes[2].out);
 assert.equal(left.nodes.at(-1).mode,'cusp');assert.equal(right.nodes[0].mode,'cusp');
 assert.equal(left.id,'open');assert.equal(right.id,'open');assert.equal(left.closed,false);assert.equal(right.closed,false);
 right.nodes[0].out.x=999;right.meta.tags.push('right');assert.deepEqual(source,before);assert.notEqual(left.nodes.at(-1).out.x,999);assert.deepEqual(left.meta.tags,['open']);
});

test('breakPath rejects unsupported nodes and results beyond the node limit',()=>{
 const open=path('open',[[0,0],[1,0],[2,0]]),closed=path('closed',[[0,0],[1,0],[2,0]],true);
 for(const [candidate,index] of [[null,0],[{},0],[open,-1],[open,0],[open,2],[open,1.5],[closed,3]])assert.throws(()=>g.breakPath(candidate,index),RangeError);
 const huge={id:'huge',closed:true,nodes:Array.from({length:10000},(_,i)=>g.node(i,0))},before=huge.nodes.length;
 assert.throws(()=>g.breakPath(huge,5000),/10000/);assert.equal(huge.nodes.length,before);
});

test('joinEndpoints honors all four explicitly selected endpoint combinations and preserves cubic shapes',()=>{
 for(const sourceAtStart of [false,true])for(const targetAtEnd of [false,true]){
  const canonicalSource=path('source',[[0,0],[80,30]]),canonicalTarget=path('target',[[80,30],[150,-20]]);
  const source=sourceAtStart?reversed(canonicalSource):structuredClone(canonicalSource);
  const target=targetAtEnd?reversed(canonicalTarget):structuredClone(canonicalTarget);
  const sourceIndex=sourceAtStart?0:1,targetIndex=targetAtEnd?1:0;
  const sourceBefore=structuredClone(source),targetBefore=structuredClone(target);
  const {path:joined,nodeIndex}=g.joinEndpoints(source,sourceIndex,target,targetIndex);
  assert.equal(nodeIndex,1);assert.equal(joined.closed,false);assert.deepEqual(joined.nodes.map(n=>[n.x,n.y]),[[0,0],[80,30],[150,-20]]);
  sameSegment(canonicalSource.nodes[0],canonicalSource.nodes[1],joined.nodes[0],joined.nodes[1]);
  sameSegment(canonicalTarget.nodes[0],canonicalTarget.nodes[1],joined.nodes[1],joined.nodes[2]);
  assert.deepEqual(joined.nodes[1].in,canonicalSource.nodes[1].in);assert.deepEqual(joined.nodes[1].out,canonicalTarget.nodes[0].out);
  assert.equal(joined.nodes[1].mode,'cusp');assert.equal(joined.id,'source');assert.equal(joined.name,'curve-source');
  assert.deepEqual(source,sourceBefore);assert.deepEqual(target,targetBefore);
 }
});

test('joinEndpoints closes one path by merging duplicate first and last nodes',()=>{
 const source=path('loop',[[0,0],[100,10],[70,90],[0,0]]),before=structuredClone(source);
 const closingStart=structuredClone(source.nodes[2]),closingEnd=structuredClone(source.nodes[3]);
 const {path:closed,nodeIndex}=g.joinEndpoints(source,3,source,0);
 assert.equal(nodeIndex,0);assert.equal(closed.closed,true);assert.equal(closed.nodes.length,3);
 assert.deepEqual(closed.nodes[0].in,before.nodes[3].in);assert.deepEqual(closed.nodes[0].out,before.nodes[0].out);assert.equal(closed.nodes[0].mode,'cusp');
 sameSegment(closingStart,closingEnd,closed.nodes[2],closed.nodes[0]);
 assert.equal(closed.id,'loop');assert.deepEqual(source,before);closed.meta.tags.push('changed');assert.deepEqual(source.meta.tags,['loop']);
});

test('joinEndpoints rejects implicit pairing, invalid paths, and oversized results',()=>{
 const a=path('a',[[0,0],[10,0]]),b=path('b',[[10,0],[20,0]]),far=path('far',[[11,0],[20,0]]);
 const triangle=path('triangle',[[0,0],[10,0],[0,0]]);
 for(const args of [[a,0,b,0],[a,1,b,1],[a,1,far,0],[a,1,a,0],[triangle,2,triangle,0],[{...a,closed:true},1,b,0],[a,1,{...b,closed:true},0]]){
  assert.throws(()=>g.joinEndpoints(...args),RangeError);
 }
 const large=path('large',Array.from({length:6000},(_,i)=>[i,0]));
 const other=path('other',Array.from({length:4002},(_,i)=>[5999+i,0]));
 assert.throws(()=>g.joinEndpoints(large,5999,other,0),/10000/);
 assert.equal(large.nodes.length,6000);assert.equal(other.nodes.length,4002);
});
