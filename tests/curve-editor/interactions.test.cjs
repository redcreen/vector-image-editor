const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTapTracker}=require('../../tools/curve-editor/interactions.js');
test('two nearby pointer taps on the same curve trigger once, independent of native dblclick',()=>{
 const tap=createTapTracker();
 assert.equal(tap.push({x:30,y:40,time:100,key:'curve-a'}),false);
 assert.equal(tap.push({x:32,y:41,time:280,key:'curve-a'}),true);
 assert.equal(tap.push({x:32,y:41,time:350,key:'curve-a'}),false);
});
test('slow, distant, or different-curve taps never insert a node',()=>{
 const tap=createTapTracker();
 assert.equal(tap.push({x:30,y:40,time:100,key:'a'}),false);
 assert.equal(tap.push({x:30,y:40,time:900,key:'a'}),false);
 assert.equal(tap.push({x:80,y:40,time:950,key:'a'}),false);
 assert.equal(tap.push({x:80,y:40,time:1000,key:'b'}),false);
});
test('dragging cancels a pending double tap',()=>{
 const tap=createTapTracker();tap.push({x:30,y:40,time:100,key:'a'});tap.reset();
 assert.equal(tap.push({x:30,y:40,time:200,key:'a'}),false);
});
