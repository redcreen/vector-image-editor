const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');

for(const fromStart of [false,true])test(`extend ${fromStart?'first':'last'} endpoint without changing existing nodes or segment geometry`,()=>{
 const path={id:'curve',closed:false,nodes:[G.node(100,100,'smooth'),G.node(220,180,'symmetric'),G.node(350,120,'smooth')]};
 path.nodes[1].in={x:190,y:130};path.nodes[1].out={x:250,y:230};
 const before=structuredClone(path),pos={x:fromStart?40:430,y:240};
 const index=G.extend(path,pos,'smooth',fromStart);
 assert.equal(index,fromStart?0:3);assert.equal(path.nodes.length,4);
 assert.deepEqual(fromStart?path.nodes.slice(1):path.nodes.slice(0,-1),before.nodes);
 assert.equal(path.nodes[index].mode,'smooth');assert.equal(path.nodes[index].x,pos.x);assert.equal(path.nodes[index].y,pos.y);
 for(let i=0;i<2;i++)for(const t of [0,.2,.5,.8,1])assert.deepEqual(G.at(path.nodes[i+Number(fromStart)],path.nodes[i+1+Number(fromStart)],t),G.at(before.nodes[i],before.nodes[i+1],t));
});
