const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../../tools/curve-editor/layers.js');
const G=require('../../tools/curve-editor/geometry.js');
let T;try{T=require('../../tools/curve-editor/text.js');}catch{}
const fixture=()=>L.normalize({width:1000,height:700,paths:[],image:null,opacity:.65});
const text=()=>({id:'text-1',name:'文字 1',content:'中文 & <文字>\nSecond line',x:10,y:20,fontSize:32,color:'#243347'});
test('legacy layers get empty text collections and text has one editable layer',()=>{
 const d=fixture();assert.deepEqual(d.texts,[]);assert.deepEqual(d.layers[0].textIds,[]);
 const item=L.addText(d,text(),d.layers[0]);assert.equal(d.texts[0],item);assert.deepEqual(d.layers[0].textIds,[item.id]);
 assert.equal(L.editable(d,item.id,'text'),true);d.layers[0].locked=true;assert.equal(L.editable(d,item.id,'text'),false);
 d.layers[0].visible=false;assert.equal(L.visible(d,item.id,'text'),false);
});
test('multiline text bounds and mixed transforms scale font and coordinates atomically',()=>{
 assert.ok(T,'text model exists');const d=fixture(),item=L.addText(d,text(),d.layers[0]),b=L.bounds(d,[],[],[item.id]);
 assert.ok(b.width>0);assert.equal(b.height,76.8);assert.equal(b.x,10);assert.equal(b.y,20);
 L.transform(d,[],[],b,{x:50,y:60,width:b.width*2,height:b.height*2},[item.id]);
 assert.equal(item.fontSize,64);assert.equal(item.x,50);assert.equal(item.y,60);
 const before=JSON.stringify(d);assert.throws(()=>L.transform(d,[],[],L.bounds(d,[],[],[item.id]),{x:0,y:0,width:b.width*4,height:b.height*2},[item.id]));assert.equal(JSON.stringify(d),before);
});
test('text validation rejects invalid content, sizes and layer membership and prune deletes references',()=>{
 assert.ok(T);const d=fixture();
 for(const changes of [{content:'  \n'},{fontSize:0},{fontSize:4097},{x:Infinity},{color:'url(http://x)'},{content:'a'.repeat(10001)}])assert.throws(()=>L.addText(d,{...text(),...changes},d.layers[0]));
 assert.equal(d.texts.length,0);const item=L.addText(d,text(),d.layers[0]);
 const bad=structuredClone(d);bad.layers[0].textIds=[];assert.throws(()=>L.normalize(bad));
 d.texts=[];L.prune(d);assert.deepEqual(d.layers[0].textIds,[]);
});
test('text, image and curve transformations share one scale and invalid font size leaves the group unchanged',()=>{
 const d=fixture();d.paths=[{id:'p',nodes:[G.node(10,20),G.node(110,120)]}];d.layers[0].pathIds=['p'];
 const imageLayer=L.addImage(d,{name:'i',dataUrl:'data:image/png;base64,AA==',x:10,y:20,width:100,height:100,opacity:1}),item=L.addText(d,text(),d.layers[0]),b=L.bounds(d,['p'],imageLayer.imageIds,[item.id]);
 L.transform(d,['p'],imageLayer.imageIds,b,{x:50,y:60,width:b.width*2,height:b.height*2},[item.id]);
 assert.equal(d.paths[0].nodes[0].x,50);assert.equal(d.images[0].x,50);assert.equal(item.x,50);assert.equal(item.fontSize,64);assert.equal(d.images[0].width,200);
 const before=JSON.stringify(d),next=L.bounds(d,['p'],imageLayer.imageIds,[item.id]);assert.throws(()=>L.transform(d,['p'],imageLayer.imageIds,next,{...next,width:next.width*100,height:next.height*100},[item.id]));assert.equal(JSON.stringify(d),before);
});
