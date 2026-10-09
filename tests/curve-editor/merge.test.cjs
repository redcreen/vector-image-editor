const {test}=require('node:test');
const assert=require('node:assert/strict');
const g=require('../../tools/curve-editor/geometry.js');
const curve=(id,xs)=>({id,name:id,role:'outline',color:'#176bce',closed:false,note:'保留说明',dashed:true,nodes:xs.map(x=>g.node(x,0))});
function sameSegment(a,b,c,d,reversed=false){
 for(const t of [0,.17,.5,.83,1]){
  const p=g.at(a,b,t),q=g.at(c,d,reversed?1-t:t);
  assert.ok(g.dist(p,q)<1e-7,JSON.stringify({p,q}));
 }
}

test('merging joins nearest endpoints on both sides and reverses handles without changing source segments',()=>{
 const middle=curve('middle',[100,200]),left=curve('left',[100,0]),right=curve('right',[300,200]);
 for(const p of [middle,left,right]){p.nodes[0].out.y=35;p.nodes[1].in.y=-20;}
 const sources=[right,middle,left],before=structuredClone(sources);
 const merged=g.mergePaths(sources,'middle');
 assert.deepEqual(merged.nodes.map(n=>n.x),[0,100,200,300]);
 sameSegment(left.nodes[0],left.nodes[1],merged.nodes[0],merged.nodes[1],true);
 sameSegment(middle.nodes[0],middle.nodes[1],merged.nodes[1],merged.nodes[2]);
 sameSegment(right.nodes[0],right.nodes[1],merged.nodes[2],merged.nodes[3],true);
 for(const key of ['id','name','role','color','note','dashed'])assert.equal(merged[key],middle[key]);
 assert.equal(merged.closed,false);assert.deepEqual(sources,before);
 merged.nodes[1].in.x=999;assert.deepEqual(sources,before);
});

test('separate endpoints receive a straight bridge while original Bézier segments stay intact',()=>{
 const a=curve('a',[10,30]),b=curve('b',[100,130]);
 a.nodes[0].out={x:15,y:40};a.nodes[1].in={x:25,y:30};a.nodes[1].out={x:40,y:-50};a.nodes[1].mode='symmetric';
 b.nodes[0].in={x:90,y:50};b.nodes[0].out={x:110,y:25};b.nodes[0].mode='smooth';
 const merged=g.mergePaths([a,b]);
 assert.deepEqual(merged.nodes.map(n=>n.x),[10,30,100,130]);
 sameSegment(a.nodes[0],a.nodes[1],merged.nodes[0],merged.nodes[1]);
 sameSegment(b.nodes[0],b.nodes[1],merged.nodes[2],merged.nodes[3]);
 for(const t of [.1,.5,.9])assert.equal(g.at(merged.nodes[1],merged.nodes[2],t).y,0);
 assert.equal(merged.nodes[1].mode,'cusp');assert.equal(merged.nodes[2].mode,'cusp');
});

test('coincident endpoints become one editable node with both original control handles',()=>{
 const a=curve('a',[0,100]),b=curve('b',[100,200]);
 a.nodes[1].in={x:80,y:0};b.nodes[0].out={x:120,y:0};
 let merged=g.mergePaths([a,b]);assert.equal(merged.nodes.length,3);
 assert.deepEqual(merged.nodes[1].in,a.nodes[1].in);assert.deepEqual(merged.nodes[1].out,b.nodes[0].out);
 assert.equal(merged.nodes[1].mode,'symmetric');
 b.nodes[0].out.x=130;assert.equal(g.mergePaths([a,b]).nodes[1].mode,'smooth');
 b.nodes[0].out.y=20;assert.equal(g.mergePaths([a,b]).nodes[1].mode,'cusp');
});

test('merging refuses closed or incomplete curves and results beyond the saved node limit',()=>{
 const a=curve('a',[0,100]),b=curve('b',[100,200]);
 for(const sources of [[a],[a,{...b,closed:true}],[a,{...b,nodes:[g.node(100,0)]}],[a,a]])assert.throws(()=>g.mergePaths(sources),RangeError);
 assert.throws(()=>g.mergePaths([a,b],'missing'),RangeError);
 const large=curve('large',Array.from({length:10000},(_,i)=>i));
 assert.throws(()=>g.mergePaths([large,b]),RangeError);
 assert.equal(large.nodes.length,10000);
});
