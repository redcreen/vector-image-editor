const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../../tools/curve-editor/layers.js');
const G=require('../../tools/curve-editor/geometry.js');
const fixture=()=>L.normalize({width:100,height:100,paths:[{id:'p',nodes:[G.node(10,10),G.node(30,20)]}],image:null});
const text=()=>({content:'文字',name:'文字',x:10,y:20,fontSize:24,color:'#243347'});
test('new text defaults to one dedicated layer and explicit ownership remains supported',()=>{
 const d=fixture(),original=d.layers[0],first=L.addText(d,text());
 const layer=L.layerFor(d,first.id,'text');assert.equal(layer.name,'文字图层');assert.notEqual(layer.id,original.id);
 const next=L.addText(d,text());assert.equal(L.layerFor(d,next.id,'text'),layer);assert.equal(d.layers.length,2);
 const explicit=L.addText(d,text(),original);assert.equal(L.layerFor(d,explicit.id,'text'),original);L.normalize(d);
});
test('default text creation validates before adding a layer and respects existing layer protection',()=>{
 const d=fixture(),before=structuredClone(d);assert.throws(()=>L.addText(d,{...text(),content:''}));assert.deepEqual(d,before);
 const layer=L.addLayer(d,'文字图层');layer.locked=true;const locked=structuredClone(d);
 assert.throws(()=>L.addText(d,text()),/隐藏|锁定/);assert.deepEqual(d,locked);
 layer.locked=false;const group=L.group(d,[d.layers[0].id,layer.id]);group.visible=false;
 assert.throws(()=>L.addText(d,text()),/隐藏|锁定/);
});
test('moving mixed elements preserves data and drawing order, cleans references, and is idempotent',()=>{
 const d=fixture(),source=d.layers[0],t=L.addText(d,text(),source);
 const imageLayer=L.addImage(d,{name:'图片',dataUrl:'data:image/png;base64,AA==',x:0,y:0,width:20,height:20,opacity:1}),image=d.images[0];
 source.items=[{type:'text',id:t.id,visible:true},{type:'path',id:'p'}];
 const target=L.addLayer(d,'目标'),stay=L.addText(d,text(),target),data=structuredClone([d.paths,d.images,d.texts]);
 assert.equal(L.moveElements(d,['p'],[image.id],[t.id,stay.id],target.id),3);
 assert.deepEqual([d.paths,d.images,d.texts],data);assert.deepEqual(source.pathIds,[]);assert.deepEqual(source.textIds,[]);assert.deepEqual(source.items,[]);assert.deepEqual(imageLayer.imageIds,[]);
 assert.deepEqual(target.items,[{type:'text',id:stay.id},{type:'text',id:t.id,visible:true},{type:'path',id:'p'},{type:'image',id:image.id}]);
 assert.equal(L.layerFor(d,'p'),target);assert.equal(L.layerFor(d,image.id,'image'),target);assert.equal(L.layerFor(d,t.id,'text'),target);L.normalize(d);
 const before=structuredClone(d);assert.equal(L.moveElements(d,['p'],[image.id],[t.id],target.id),0);assert.deepEqual(d,before);
});
test('moving rejects missing, protected or group targets and protected sources atomically',()=>{
 for(const mode of ['missing','group','hidden','locked','parent-locked','source-locked','missing-element']){
  const d=fixture(),source=d.layers[0],target=L.addLayer(d,'目标');let id=target.id,ids=['p'];
  if(mode==='missing')id='absent';if(mode==='group')target.kind='group';if(mode==='hidden')target.visible=false;if(mode==='locked')target.locked=true;
  if(mode==='parent-locked'){const parent=L.addLayer(d,'组');parent.kind='group';parent.locked=true;target.parentId=parent.id;}
  if(mode==='source-locked')source.locked=true;if(mode==='missing-element')ids.push('absent');
  const before=structuredClone(d);assert.throws(()=>L.moveElements(d,ids,[],[],id),undefined,mode);assert.deepEqual(d,before,mode);
 }
});
