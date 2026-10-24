const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../../tools/curve-editor/layers.js');
const T=require('../../tools/curve-editor/text.js');
const G=require('../../tools/curve-editor/geometry.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture(){
 const d=L.normalize({width:1000,height:700,paths:[{id:'p',nodes:[G.node(10,20),G.node(50,60)]}],image:null,opacity:1});
 const t=L.addText(d,{name:'文字',content:'AB\nCD',x:10,y:20,fontSize:20,color:'#123456'},d.layers[0]);
 return {d,t};
}
test('text rotates with paths around the shared pivot, keeping content and font editable',()=>{
 const {d,t}=fixture(),before=structuredClone(t),b=T.bounds(t);
 L.rotateElements(d,['p'],[],{x:100,y:100},90,[t.id]);
 close(t.x,180);close(t.y,10);assert.equal(t.rotation,90);
 assert.equal(t.content,before.content);assert.equal(t.fontSize,before.fontSize);
 close(d.paths[0].nodes[0].x,t.x);close(d.paths[0].nodes[0].y,t.y);
 const rotated=T.bounds(t);close(rotated.x,180-b.height);close(rotated.y,10);close(rotated.width,b.height);close(rotated.height,b.width);
 assert.equal(T.contains(t,{x:180-b.height/2,y:10+b.width/2}),true);assert.equal(T.contains(t,{x:181,y:11}),false);
 L.transform(d,[],[],rotated,{x:0,y:0,width:rotated.width*2,height:rotated.height*2},[t.id]);
 const scaled=T.bounds(t);close(scaled.x,0);close(scaled.y,0);close(scaled.width,b.height*2);close(scaled.height,b.width*2);assert.equal(t.rotation,90);
});
test('text rotation respects locked and hidden content and handles no-op and invalid rotations atomically',()=>{
 const {d,t}=fixture(),original=JSON.stringify(d);
 L.rotateElements(d,['p'],[],{x:0,y:0},360,[t.id]);assert.equal(JSON.stringify(d),original);
 for(const rotation of [NaN,Infinity,'90',true,1e8])assert.throws(()=>T.check({...t,rotation}));
 for(const property of ['locked','visible']){
  d.layers[0][property]=property==='locked';const before=JSON.stringify(d);
  L.rotateElements(d,['p'],[],{x:0,y:0},90,[t.id]);assert.equal(JSON.stringify(d),before);d.layers[0][property]=property==='visible';
 }
 assert.throws(()=>L.rotateElements(d,['p'],[],{x:1e8,y:1e8},180,[t.id]));assert.equal(JSON.stringify(d),original);
 L.rotateElements(d,[],[],{x:0,y:0},-90,[t.id]);assert.equal(t.rotation,270);
 L.rotateElements(d,[],[],{x:0,y:0},90,[t.id]);close(t.x,10);close(t.y,20);assert.equal(t.rotation,0);
});
