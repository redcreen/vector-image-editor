const {test}=require('node:test');
const assert=require('node:assert/strict');
const T=require('../../tools/curve-editor/text.js');
const L=require('../../tools/curve-editor/layers.js');
const marker=()=>({id:'label',name:'01',content:'01',x:110,y:70,fontSize:12,color:'#1685a6',positionMarker:{x:100,y:100}});
const path=(id,points)=>({id,name:id,color:'#123456',nodes:points.map(([x,y])=>G.node(x,y))});
const G=require('../../tools/curve-editor/geometry.js');
function linkedFixture(){
 const d=L.normalize({width:1000,height:700,paths:[path('p',[[100,100],[120,100]]),path('q',[[300,300],[320,300]])],image:null,opacity:.65});
 const p=L.addText(d,{...marker(),positionMarker:{x:100,y:100,pathId:'p',source:'node-0'}});
 const q=L.addText(d,{...marker(),content:'Q1',x:310,y:270,positionMarker:{x:300,y:300,pathId:'q'}});
 return {d,p,q,annotation:L.layerFor(d,p.id,'text')};
}
test('point labels validate coordinates and alphanumeric content without losing leading zeroes',()=>{
 assert.doesNotThrow(()=>T.check(marker()));
 for(const content of ['A1','a01','007'])assert.doesNotThrow(()=>T.check({...marker(),content}));
 for(const content of ['A 1','中文','a\nb','<b>','x'.repeat(33)])assert.throws(()=>T.check({...marker(),content}));
 for(const positionMarker of [null,{}, {x:0,y:Infinity},{x:1e8,y:0}])assert.throws(()=>T.check({...marker(),positionMarker}));
});
test('point-label bounds and hit testing include the point outside the text',()=>{
 const t=marker(),b=T.bounds(t);assert.equal(b.x,98.08);assert.equal(b.y,70);assert.ok(b.y+b.height>=101.92);
 assert.equal(T.contains(t,{x:100,y:100}),true);assert.equal(T.contains(t,{x:98,y:95}),false);
});
test('point labels share the dedicated layer and a locked default layer rejects insertion',()=>{
 const d=L.normalize({paths:[],image:null,opacity:.65});const first=L.addText(d,marker()),second=L.addText(d,{...marker(),content:'A2'});
 const layer=L.layerFor(d,first.id,'text');assert.equal(layer.name,'位置标注');assert.deepEqual(layer.textIds,[first.id,second.id]);
 layer.locked=true;assert.throws(()=>L.addText(d,marker()));assert.equal(d.texts.length,2);
});
test('moving scaling and rotating a point label carries its point along with its text',()=>{
 const d=L.normalize({paths:[],image:null,opacity:.65}),t=L.addText(d,marker()),b=L.bounds(d,[],[],[t.id]);
 L.transform(d,[],[],b,{...b,x:b.x+20,y:b.y+30},[t.id]);assert.deepEqual(t.positionMarker,{x:120,y:130});assert.equal(t.x,130);
 L.rotateElements(d,[],[],{x:0,y:0},90,[t.id]);assert.ok(Math.abs(t.positionMarker.x+130)<1e-9);assert.ok(Math.abs(t.positionMarker.y-120)<1e-9);
 const rotated=L.bounds(d,[],[],[t.id]);L.transform(d,[],[],rotated,{...rotated,width:rotated.width*2,height:rotated.height*2},[t.id]);assert.equal(t.fontSize,24);assert.ok(Number.isFinite(t.positionMarker.x));
});
test('position marker path IDs validate without discarding metadata',()=>{
 assert.doesNotThrow(()=>T.check({...marker(),positionMarker:{x:100,y:100,pathId:'p',source:'node-0'}}));
 for(const pathId of ['',123,'x'.repeat(201)])assert.throws(()=>T.check({...marker(),positionMarker:{x:100,y:100,pathId}}));
});
test('path-only move and rotation carry linked labels even on a hidden locked annotation layer',()=>{
 const {d,p,q,annotation}=linkedFixture();annotation.visible=false;annotation.locked=true;
 L.transform(d,['p'],[],{x:100,y:100,width:20,height:0},{x:110,y:120,width:20,height:0});
 assert.deepEqual(p.positionMarker,{x:110,y:120,pathId:'p',source:'node-0'});assert.equal(p.x,120);assert.equal(p.y,90);
 assert.deepEqual(q.positionMarker,{x:300,y:300,pathId:'q'});
 L.rotateElements(d,['p'],[],{x:0,y:0},90);
 assert.ok(Math.abs(p.positionMarker.x+120)<1e-9);assert.ok(Math.abs(p.positionMarker.y-110)<1e-9);
 assert.ok(Math.abs(p.x+90)<1e-9);assert.ok(Math.abs(p.y-120)<1e-9);assert.equal(p.rotation,0);
 assert.deepEqual(q.positionMarker,{x:300,y:300,pathId:'q'});
});
test('mixed path and explicit text selections transform one attached label exactly once',()=>{
 const {d,p}=linkedFixture();
 L.transform(d,['p'],[],{x:100,y:100,width:20,height:0},{x:110,y:100,width:20,height:0},[p.id]);
 assert.equal(p.positionMarker.x,110);assert.equal(p.x,120);
 L.rotateElements(d,['p'],[],{x:0,y:0},90,[p.id]);
 assert.ok(Math.abs(p.positionMarker.x+100)<1e-9);assert.ok(Math.abs(p.positionMarker.y-110)<1e-9);
});
test('path-only nonuniform resize keeps attached label font undistorted while uniform resize scales it',()=>{
 const {d,p}=linkedFixture();
 L.transform(d,['p'],[],{x:100,y:100,width:20,height:20},{x:100,y:100,width:40,height:60});
 assert.deepEqual(p.positionMarker,{x:100,y:100,pathId:'p',source:'node-0'});assert.equal(p.x,120);assert.equal(p.y,10);assert.equal(p.fontSize,12);
 const {d:d2,p:p2}=linkedFixture();L.transform(d2,['p'],[],{x:100,y:100,width:20,height:20},{x:100,y:100,width:40,height:40});assert.equal(p2.fontSize,24);
 const before=JSON.stringify(d2);assert.throws(()=>L.transform(d2,['p'],[],{x:100,y:100,width:40,height:40},{x:100,y:100,width:80,height:120},[p2.id]),/比例/);assert.equal(JSON.stringify(d2),before);
});
test('legacy association is unique, supports single nodes, persists only on movement, and rejects ambiguity',()=>{
 const d=L.normalize({width:100,height:100,paths:[path('single',[[5,5]]),path('curve',[[20,20],[30,20]])],image:null,opacity:.65});
 const single=L.addText(d,{...marker(),x:8,y:1,positionMarker:{x:5.005,y:5}}),curve=L.addText(d,{...marker(),content:'C1',x:25,y:10,positionMarker:{x:25,y:20.005}});
 assert.equal(L.positionLabelPath(d,single).id,'single');assert.equal(L.positionLabelPath(d,curve).id,'curve');assert.equal(single.positionMarker.pathId,undefined);
 L.translatePositionLabels(d,['curve'],0,0);assert.equal(curve.positionMarker.pathId,undefined);
 L.transform(d,['curve'],[],{x:20,y:20,width:10,height:0},{x:20,y:20,width:10,height:0});assert.equal(curve.positionMarker.pathId,undefined);
 L.translatePositionLabels(d,['single'],2,3);assert.equal(single.positionMarker.pathId,'single');assert.equal(single.positionMarker.x,7.005);assert.equal(single.x,10);
 const ambiguous=L.addText(d,{...marker(),content:'A2',positionMarker:{x:20,y:20}});d.paths.push(path('overlap',[[20,20],[10,20]]));d.layers[0].pathIds.push('overlap');
 assert.equal(L.positionLabelPath(d,ambiguous),null);const copy=structuredClone(ambiguous);L.translatePositionLabels(d,['curve','overlap'],1,1);assert.deepEqual(ambiguous,copy);
 const orphan=L.addText(d,{...marker(),content:'O1',positionMarker:{x:5.005,y:5,pathId:'missing'}});assert.equal(L.positionLabelPath(d,orphan),null);
});
test('translatePositionLabels is atomic and preserves marker metadata',()=>{
 const {d,p,q}=linkedFixture();p.x=1e7;
 const before=JSON.stringify(d);assert.throws(()=>L.translatePositionLabels(d,['p','q'],1,0));assert.equal(JSON.stringify(d),before);
 p.x=110;L.translatePositionLabels(d,['p'],5,-2);assert.deepEqual(p.positionMarker,{x:105,y:98,pathId:'p',source:'node-0'});assert.equal(p.x,115);assert.equal(p.y,68);
});
test('an invalid implicit label transform leaves its source path and every label unchanged',()=>{
 const {d,p}=linkedFixture();p.x=1e7;const before=JSON.stringify(d);
 assert.throws(()=>L.transform(d,['p'],[],{x:100,y:100,width:20,height:0},{x:101,y:100,width:20,height:0}));assert.equal(JSON.stringify(d),before);
});

test('curve rotation keeps linked labels horizontal at every angle without changing ordinary text rotation',()=>{
 for(const degrees of [45,90,180,270,-120]){
  const {d,p}=linkedFixture();p.rotation=30;
  const plain=L.addText(d,{id:'plain',name:'Note',content:'Note',x:150,y:150,fontSize:12,color:'#123456',rotation:20});
  L.rotateElements(d,['p'],[],{x:0,y:0},degrees,[p.id,plain.id]);
  assert.equal(p.rotation,0);assert.equal(plain.rotation,((20+degrees)%360+360)%360);
  assert.ok(Math.abs(p.positionMarker.x-d.paths[0].nodes[0].x)<1e-9);
  assert.ok(Math.abs(p.positionMarker.y-d.paths[0].nodes[0].y)<1e-9);
 }
});
test('position attachments prefer nearby nodes and otherwise retain the nearest segment parameter',()=>{
 const p=path('p',[[0,0],[20,0]]);p.nodes[0].out={x:5,y:10};p.nodes[1].in={x:15,y:10};
 assert.deepEqual(L.positionAttachment(p,{x:.005,y:0}),{kind:'node',index:0});
 const point=G.at(p.nodes[0],p.nodes[1],.4),attachment=L.positionAttachment(p,point);
 assert.equal(attachment.kind,'segment');assert.equal(attachment.index,0);assert.ok(Math.abs(attachment.t-.4)<1e-4);
 assert.equal(L.positionAttachment(p,{x:100,y:100}),null);assert.deepEqual(L.positionAttachment(path('single',[[3,4]]),{x:3,y:4}),{kind:'node',index:0});
});
test('position attachment validation requires a path and bounded node or segment data',()=>{
 const valid=[{kind:'node',index:0},{kind:'segment',index:2,t:.25}];
 for(const attachment of valid)assert.doesNotThrow(()=>T.check({...marker(),positionMarker:{x:100,y:100,pathId:'p',attachment}}));
 for(const attachment of [null,{}, {kind:'node',index:-1},{kind:'node',index:1.5},{kind:'node',index:10000},{kind:'segment',index:0},{kind:'segment',index:0,t:-.1},{kind:'segment',index:0,t:1.1},{kind:'other',index:0}])assert.throws(()=>T.check({...marker(),positionMarker:{x:100,y:100,pathId:'p',attachment}}));
 assert.throws(()=>T.check({...marker(),positionMarker:{x:100,y:100,attachment:{kind:'node',index:0}}}));
});
test('syncPositionLabels follows one moved node and keeps hidden locked labels horizontal',()=>{
 const {d,p,annotation}=linkedFixture();p.rotation=35;p.positionMarker.attachment={kind:'node',index:0};annotation.visible=false;annotation.locked=true;
 const before=structuredClone(d);G.move(d.paths[0].nodes[0],8,-3);
 assert.equal(L.syncPositionLabels(d,before),1);assert.deepEqual(p.positionMarker,{x:108,y:97,pathId:'p',source:'node-0',attachment:{kind:'node',index:0}});
 assert.equal(p.x,118);assert.equal(p.y,67);assert.equal(p.rotation,0);
});
test('syncPositionLabels follows a control-handle edit at the same segment parameter',()=>{
 const {d,p}=linkedFixture(),curve=d.paths[0];curve.nodes[0].out={x:105,y:110};curve.nodes[1].in={x:115,y:110};
 const start=G.at(curve.nodes[0],curve.nodes[1],.25);Object.assign(p.positionMarker,start,{attachment:{kind:'segment',index:0,t:.25}});p.x=start.x+10;p.y=start.y-20;
 const before=structuredClone(d);curve.nodes[0].out.y+=20;const target=G.at(curve.nodes[0],curve.nodes[1],.25),dx=target.x-start.x,dy=target.y-start.y;
 assert.equal(L.syncPositionLabels(d,before),1);assert.ok(Math.abs(p.positionMarker.x-target.x)<1e-9);assert.ok(Math.abs(p.positionMarker.y-target.y)<1e-9);
 assert.ok(Math.abs(p.x-(start.x+10+dx))<1e-9);assert.ok(Math.abs(p.y-(start.y-20+dy))<1e-9);assert.equal(p.positionMarker.attachment.t,.25);
});
test('syncPositionLabels infers legacy attachment once and remaps inserted nodes and reversed topology',()=>{
 const d=L.normalize({width:100,height:100,paths:[path('p',[[0,0],[20,0]])],image:null,opacity:.65});
 const legacy=L.addText(d,{...marker(),x:20,y:-10,positionMarker:{x:10,y:0,source:'legacy'}}),before=structuredClone(d);
 G.split(d.paths[0],0,.5);assert.equal(L.syncPositionLabels(d,before),1);
 assert.equal(legacy.positionMarker.pathId,'p');assert.deepEqual(legacy.positionMarker.attachment,{kind:'node',index:1});assert.equal(legacy.positionMarker.source,'legacy');
 const reversedBefore=structuredClone(d),segment=L.addText(d,{...marker(),content:'R1',x:5,y:-10,positionMarker:{x:5,y:0,pathId:'p',attachment:{kind:'segment',index:0,t:.5}}});
 reversedBefore.texts=structuredClone(d.texts);d.paths[0].nodes.reverse();
 assert.equal(L.syncPositionLabels(d,reversedBefore),1);assert.equal(segment.positionMarker.attachment.kind,'segment');assert.equal(segment.positionMarker.attachment.index,1);assert.ok(Math.abs(segment.positionMarker.attachment.t-.5)<1e-9);
});
test('syncPositionLabels does not double-move whole transforms and no-op geometry adds no metadata',()=>{
 const {d,p}=linkedFixture(),before=structuredClone(d);L.transform(d,['p'],[],{x:100,y:100,width:20,height:0},{x:130,y:140,width:20,height:0});
 const transformed={x:p.x,y:p.y,marker:{x:p.positionMarker.x,y:p.positionMarker.y}};assert.equal(L.syncPositionLabels(d,before),1);
 assert.deepEqual({x:p.x,y:p.y,marker:{x:p.positionMarker.x,y:p.positionMarker.y}},transformed);assert.deepEqual(p.positionMarker.attachment,{kind:'node',index:0});
 const still=structuredClone(d),plain=d.texts.find(t=>t.id===p.id);delete plain.positionMarker.attachment;const snapshot=structuredClone(plain);
 assert.equal(L.syncPositionLabels(d,still),0);assert.deepEqual(plain,snapshot);
 const {d:rotated,p:rotatedLabel}=linkedFixture(),rotationBefore=structuredClone(rotated);L.rotateElements(rotated,['p'],[],{x:110,y:100},180);
 const rotatedPosition=structuredClone(rotatedLabel);assert.equal(L.syncPositionLabels(rotated,rotationBefore),1);assert.equal(rotatedLabel.x,rotatedPosition.x);assert.equal(rotatedLabel.y,rotatedPosition.y);
 assert.equal(rotatedLabel.positionMarker.x,rotatedPosition.positionMarker.x);assert.equal(rotatedLabel.positionMarker.y,rotatedPosition.positionMarker.y);assert.deepEqual(rotatedLabel.positionMarker.attachment,{kind:'node',index:0});
});
test('node-count changes may project an old landing point only onto the same source path',()=>{
 const {d,p}=linkedFixture(),before=structuredClone(d);p.positionMarker.attachment={kind:'segment',index:0,t:.5};p.positionMarker.x=110;p.positionMarker.y=100;p.x=120;p.y=80;
 before.texts=structuredClone(d.texts);d.paths[0].nodes=[G.node(100,105),G.node(110,105),G.node(120,105)];
 assert.equal(L.syncPositionLabels(d,before),1);assert.ok(Math.abs(p.positionMarker.x-110)<1e-6);assert.ok(Math.abs(p.positionMarker.y-105)<1e-6);assert.equal(p.x,120);assert.equal(p.y,85);
 assert.equal(p.positionMarker.pathId,'p');assert.equal(p.positionMarker.attachment.kind,'node');
});
test('syncPositionLabels ignores new texts and deleted source paths and validates every update atomically',()=>{
 const {d,p}=linkedFixture(),before=structuredClone(d);d.texts.push({...marker(),id:'new'});d.layers.at(-1).textIds.push('new');d.paths=d.paths.filter(path=>path.id!=='p');
 const labels=structuredClone(d.texts);assert.equal(L.syncPositionLabels(d,before),0);assert.deepEqual(d.texts,labels);
 const {d:d2,p:p2,q}=linkedFixture();p2.positionMarker.attachment={kind:'node',index:0};q.positionMarker.attachment={kind:'node',index:0};p2.x=1e7;
 const before2=structuredClone(d2);G.move(d2.paths[0].nodes[0],1,0);G.move(d2.paths[1].nodes[0],1,0);const labels2=structuredClone(d2.texts);
 assert.throws(()=>L.syncPositionLabels(d2,before2));assert.deepEqual(d2.texts,labels2);
});
test('syncPositionLabels respects an explicit open-break remap and follows the new path next time',()=>{
 const d=L.normalize({width:100,height:100,paths:[path('p',[[0,0],[10,0],[20,0],[30,0]])],image:null,opacity:.65});
 const label=L.addText(d,{...marker(),x:25,y:-10,positionMarker:{x:20,y:0,pathId:'p',attachment:{kind:'node',index:2},source:'kept'}}),before=structuredClone(d);
 d.paths[0].nodes=d.paths[0].nodes.slice(0,2);d.paths.push(path('q',[[10,0],[20,0],[30,0]]));d.layers[0].pathIds.push('q');
 label.positionMarker={...label.positionMarker,pathId:'q',attachment:{kind:'node',index:1}};
 const remapped=structuredClone(label);assert.equal(L.syncPositionLabels(d,before),0);assert.deepEqual(label,remapped);
 const next=structuredClone(d);G.move(d.paths[1].nodes[1],4,3);
 assert.equal(L.syncPositionLabels(d,next),1);assert.deepEqual(label.positionMarker,{x:24,y:3,pathId:'q',attachment:{kind:'node',index:1},source:'kept'});assert.equal(label.x,29);assert.equal(label.y,-7);
});
test('syncPositionLabels respects caller remapping of a closed path attachment',()=>{
 const d=L.normalize({width:100,height:100,paths:[{...path('p',[[0,0],[20,0],[20,20],[0,20]]),closed:true}],image:null,opacity:.65});
 const label=L.addText(d,{...marker(),x:30,y:10,positionMarker:{x:20,y:20,pathId:'p',attachment:{kind:'node',index:2}}}),before=structuredClone(d);
 d.paths[0].nodes=[d.paths[0].nodes[2],d.paths[0].nodes[3],d.paths[0].nodes[0],d.paths[0].nodes[1]];label.positionMarker.attachment={kind:'node',index:0};
 const remapped=structuredClone(label);assert.equal(L.syncPositionLabels(d,before),0);assert.deepEqual(label,remapped);
});
