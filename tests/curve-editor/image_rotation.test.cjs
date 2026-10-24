const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../../tools/curve-editor/layers.js');
const G=require('../../tools/curve-editor/geometry.js');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const fixture=()=>{
 const d=L.normalize({width:100,height:100,paths:[{id:'p',nodes:[G.node(0,0),G.node(20,0)]}],image:null});
 L.addImage(d,{name:'sample',dataUrl:'data:image/png;base64,AA==',x:10,y:20,width:100,height:40,opacity:1});return d;
};
test('rotated image bounds and inverse pixel mapping match its visible rectangle',()=>{
 const d=fixture(),i=d.images[0];i.rotation=90;
 const b=L.bounds(d,[],[i.id]);near(b.x,40);near(b.y,-10);near(b.width,40);near(b.height,100);
 const p=L.imageToWorld(i,{x:10,y:5});near(p.x,75);near(p.y,0);
 const local=L.worldToImage(i,p);near(local.x,10);near(local.y,5);
 assert.equal(L.imageContains(i,p),true);assert.equal(L.imageContains(i,{x:15,y:25}),false);
 assert.ok(L.contentBounds(d).y<0);
 i.rotation=45;
 const box=L.imageBounds(i);assert.equal(L.imageIntersectsRect(i,{x:box.x,y:box.y,width:1,height:1}),false);
 assert.equal(L.imageIntersectsRect(i,{x:59,y:39,width:2,height:2}),true);
});
test('rotation moves images and curves around the same pivot without changing source pixels',()=>{
 const d=fixture(),i=d.images[0],original={...i};L.rotateElements(d,['p'],[i.id],{x:0,y:0},90);
 near(i.x,-90);near(i.y,40);near(i.rotation,90);near(d.paths[0].nodes[1].x,0);near(d.paths[0].nodes[1].y,20);
 assert.equal(i.dataUrl,original.dataUrl);assert.equal(i.width,original.width);assert.equal(i.height,original.height);
 L.rotateElements(d,['p'],[i.id],{x:0,y:0},-90);near(i.x,original.x);near(i.y,original.y);near(i.rotation,0);
});
test('moving and scaling a rotated image follows selection bounds and keeps its angle',()=>{
 const d=fixture(),i=d.images[0];i.rotation=45;const b=L.bounds(d,[],[i.id]);
 const target={x:b.x+30,y:b.y-15,width:b.width*2,height:b.height*2};
 L.transform(d,[],[i.id],b,target);const actual=L.bounds(d,[],[i.id]);
 for(const key of Object.keys(target))near(actual[key],target[key]);near(i.rotation,45);
 const before=JSON.stringify(d);assert.throws(()=>L.transform(d,['p'],[i.id],actual,{...actual,width:actual.width*2}),/比例/);assert.equal(JSON.stringify(d),before);
});
test('invalid rotation is rejected and hidden or locked images are left untouched',()=>{
 for(const angle of [null,NaN,Infinity,true,'90',1e8]){const d=fixture();d.images[0].rotation=angle;assert.throws(()=>L.normalize(d),/旋转/);}
 const d=fixture(),i=d.images[0],layer=L.layerFor(d,i.id,'image');layer.locked=true;
 const before=JSON.stringify(d);L.rotateElements(d,[],[i.id],{x:0,y:0},30);assert.equal(JSON.stringify(d),before);
 layer.locked=false;layer.visible=false;const hidden=JSON.stringify(d);L.rotateElements(d,[],[i.id],{x:0,y:0},30);assert.equal(JSON.stringify(d),hidden);
 layer.visible=true;const valid=JSON.stringify(d);assert.throws(()=>L.rotateElements(d,['p'],[i.id],{x:1e8,y:0},180));assert.equal(JSON.stringify(d),valid);
});
