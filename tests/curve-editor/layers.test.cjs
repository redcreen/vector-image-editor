const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
let L;try{L=require('../../tools/curve-editor/layers.js');}catch{}
const fixture=()=>({width:1000,height:700,paths:[{id:'p',nodes:[G.node(10,20),G.node(110,120)]}],image:null,opacity:.65});
test('a hidden curve is excluded from visibility, editing and bounds independently of its layer',()=>{
 const d=fixture();L.normalize(d);const layer=d.layers[0];
 assert.equal(L.visible(d,'p'),true);assert.equal(L.editable(d,'p'),true);
 d.paths[0].visible=false;d.paths[0].nodes[0]=G.node(-1000,-1000);
 assert.equal(L.visible(d,'p'),false);assert.equal(L.editable(d,'p'),false);
 assert.deepEqual(L.contentBounds(d),G.contentBounds({...d,paths:[]}));
 assert.equal(layer.visible,true);assert.deepEqual(layer.pathIds,['p']);
 d.paths[0].visible=true;assert.equal(L.visible(d,'p'),true);
 layer.locked=true;assert.equal(L.visible(d,'p'),true);assert.equal(L.editable(d,'p'),false);
 layer.visible=false;assert.equal(L.visible(d,'p'),false);
});
test('legacy artwork becomes layers without changing curve coordinates or metadata',()=>{
 assert.ok(L,'layer model exists');const d=fixture(),paths=JSON.parse(JSON.stringify(d.paths));
 d.image={name:'old.png',dataUrl:'data:image/png;base64,AA=='};L.normalize(d);
 assert.deepEqual(d.paths,paths);assert.equal(d.image,null);assert.equal(d.images[0].width,1000);
 assert.equal(d.images[0].opacity,.65);assert.equal(d.layers[0].locked,true);assert.deepEqual(d.layers[1].pathIds,['p']);
 L.normalize(d);assert.equal(d.images.length,1);
});
test('each import adds an independent layer and preserves the current artboard',()=>{
 assert.ok(L);const d=fixture();L.normalize(d);d.calibration={length:10};
 const layer=L.addImage(d,{name:'new.png',dataUrl:'data:image/png;base64,AA==',x:25,y:30,width:200,height:100,opacity:1});
 assert.equal(d.width,1000);assert.equal(d.height,700);assert.equal(d.paths.length,1);assert.deepEqual(d.calibration,{length:10});
 assert.deepEqual(layer.imageIds,[d.images[0].id]);assert.equal(d.layers.at(-1),layer);
});
test('moving and scaling a mixed selection transforms anchors, handles and images together',()=>{
 assert.ok(L);const d=fixture();L.normalize(d);const layer=L.addImage(d,{name:'new',dataUrl:'data:image/png;base64,AA==',x:10,y:20,width:100,height:100,opacity:1});
 d.paths[0].nodes[0].out={x:30,y:40};const ids=layer.imageIds;
 L.transform(d,['p'],ids,{x:10,y:20,width:100,height:100},{x:50,y:60,width:200,height:300});
 assert.deepEqual({x:d.paths[0].nodes[0].x,y:d.paths[0].nodes[0].y},{x:50,y:60});
 assert.deepEqual(d.paths[0].nodes[0].out,{x:90,y:120});assert.equal(d.paths[0].nodes[1].x,250);
 assert.deepEqual(L.bounds(d,['p'],ids),{x:50,y:60,width:200,height:300});
});
test('invalid memberships and image transforms are rejected before import changes artwork',()=>{
 assert.ok(L);const d=fixture();L.normalize(d);
 for(const value of [0,-1,NaN,Infinity,1e8])assert.throws(()=>L.addImage(d,{name:'bad',dataUrl:'data:image/png;base64,AA==',x:0,y:0,width:value,height:10,opacity:1}));
 assert.equal(d.images.length,0);assert.equal(d.layers.length,1);
 const copy=JSON.parse(JSON.stringify(d));copy.layers[0].pathIds=['missing'];assert.throws(()=>L.normalize(copy));
 const before=JSON.stringify(d);assert.throws(()=>L.transform(d,['p'],[],{x:10,y:20,width:100,height:100},{x:1e8,y:0,width:200,height:200}));assert.equal(JSON.stringify(d),before);
});
const close=(actual,expected,epsilon=1e-9)=>assert.ok(Math.abs(actual-expected)<=epsilon,`${actual} should be within ${epsilon} of ${expected}`);
test('rotatePaths rotates one selected curve clockwise with its absolute handles and preserves metadata',()=>{
 const d=fixture();L.normalize(d);const path=d.paths[0],node=path.nodes[0];
 path.name='kept';path.role='outline';path.closed=false;node.mode='smooth';node.label='anchor metadata';node.in={x:0,y:20};node.out={x:20,y:20};
 const beforeLength=G.pathLength(path);L.rotatePaths(d,['p'],{x:10,y:10},90);const rotated=path.nodes[0];
 close(rotated.x,0);close(rotated.y,10);close(rotated.in.x,0);close(rotated.in.y,0);close(rotated.out.x,0);close(rotated.out.y,20);
 assert.equal(rotated.mode,'smooth');assert.equal(rotated.label,'anchor metadata');
 assert.equal(path.name,'kept');assert.equal(path.role,'outline');assert.equal(path.closed,false);close(G.pathLength(path),beforeLength,1e-7);
});
test('rotatePaths rotates every editable selected curve around one group center',()=>{
 const d=fixture();d.paths.push({id:'q',name:'second',nodes:[G.node(20,10),G.node(30,10)]});L.normalize(d);
 L.rotatePaths(d,['p','q'],{x:10,y:10},-90);
 close(d.paths[0].nodes[0].x,20);close(d.paths[0].nodes[0].y,10);
 close(d.paths[1].nodes[0].x,10);close(d.paths[1].nodes[0].y,0);
});
test('rotatePaths skips hidden, locked and unselected curves',()=>{
 const d={width:100,height:100,paths:[
  {id:'selected',nodes:[G.node(10,0)]},{id:'hidden',visible:false,nodes:[G.node(20,0)]},
  {id:'locked',nodes:[G.node(30,0)]},{id:'unselected',nodes:[G.node(40,0)]}
 ],images:[],texts:[],layers:[
  {id:'editable',name:'editable',visible:true,locked:false,pathIds:['selected','hidden','unselected'],imageIds:[],textIds:[]},
  {id:'locked-layer',name:'locked',visible:true,locked:true,pathIds:['locked'],imageIds:[],textIds:[]}
 ]};
 const before=JSON.parse(JSON.stringify(d.paths));L.rotatePaths(d,['selected','hidden','locked'],{x:0,y:0},90);
 close(d.paths[0].nodes[0].x,0);close(d.paths[0].nodes[0].y,10);
 assert.deepEqual(d.paths.slice(1),before.slice(1));
});
test('rotatePaths rejects invalid geometry atomically before changing any selected curve',()=>{
 const d=fixture();d.paths.push({id:'q',nodes:[G.node(1e7,0)]});L.normalize(d);
 for(const [center,degrees] of [[{x:NaN,y:0},90],[{x:0,y:0},Infinity],[{x:-1e7,y:0},180]]){
  const before=JSON.stringify(d);assert.throws(()=>L.rotatePaths(d,['p','q'],center,degrees));assert.equal(JSON.stringify(d),before);
 }
});
test('rotatePaths normalizes a full turn without introducing coordinate drift',()=>{
 const d=fixture();L.normalize(d);d.paths[0].nodes[0].in={x:3,y:4};d.paths[0].nodes[0].out={x:17,y:26};
 const before=JSON.parse(JSON.stringify(d.paths));L.rotatePaths(d,['p'],{x:12.5,y:-8.25},720);
 assert.deepEqual(d.paths,before);
});
