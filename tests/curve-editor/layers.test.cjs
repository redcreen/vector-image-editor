const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
let L;try{L=require('../../tools/curve-editor/layers.js');}catch{}
const fixture=()=>({width:1000,height:700,paths:[{id:'p',nodes:[G.node(10,20),G.node(110,120)]}],image:null,opacity:.65});
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
