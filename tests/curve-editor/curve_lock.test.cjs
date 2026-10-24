const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../../tools/curve-editor/layers.js'),G=require('../../tools/curve-editor/geometry.js');
const fixture=()=>{
 const d=L.normalize({width:100,height:100,image:null,paths:[{id:'p',nodes:[G.node(10,10),G.node(30,20)]}]});
 const layer=d.layers[0];layer.items=[{type:'path',id:'p',locked:true}];return {d,layer};
};
test('an individually locked curve cannot rotate directly but follows explicit layer rotation',()=>{
 const {d,layer}=fixture(),before=structuredClone(d.paths[0]);assert.equal(L.editable(d,'p'),false);
 L.rotateElements(d,['p'],[],{x:0,y:0},90);assert.deepEqual(d.paths[0],before);
 L.rotateElements(d,[],[],{x:0,y:0},90,[],[layer.id]);
 assert.ok(Math.abs(d.paths[0].nodes[0].x+10)<1e-8);assert.ok(Math.abs(d.paths[0].nodes[0].y-10)<1e-8);
 assert.equal(layer.items[0].locked,true);assert.equal(L.editable(d,'p'),false);
});
test('layer rotation still protects hidden curves, item visibility and locked ancestors',()=>{
 for(const state of ['layer-hidden','layer-locked','path-hidden','item-hidden','parent-locked']){
  const {d,layer}=fixture();let ids=[layer.id];
  if(state==='layer-hidden')layer.visible=false;if(state==='layer-locked')layer.locked=true;
  if(state==='path-hidden')d.paths[0].visible=false;if(state==='item-hidden')layer.items[0].visible=false;
  if(state==='parent-locked'){d.layers.push({id:'g',kind:'group',name:'group',visible:true,locked:true,pathIds:[],imageIds:[],textIds:[]});layer.parentId='g';ids=['g'];}
  const before=structuredClone(d);L.rotateElements(d,['p'],[],{x:0,y:0},90,[],ids);assert.deepEqual(d,before,state);
 }
});
test('group rotation includes each locked curve once and keeps attached labels upright',()=>{
 const {d,layer}=fixture();d.layers.push({id:'g',kind:'group',name:'group',visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]});layer.parentId='g';
 const label=L.addText(d,{name:'A1',content:'A1',x:15,y:15,fontSize:12,color:'#000000',positionMarker:{x:10,y:10,pathId:'p',attachment:{kind:'node',index:0}}});
 L.rotateElements(d,['p'],[],{x:0,y:0},90,[label.id],['g',layer.id]);
 assert.ok(Math.abs(d.paths[0].nodes[0].x+10)<1e-8);assert.ok(Math.abs(label.x+15)<1e-8);assert.equal(label.rotation,0);
});
