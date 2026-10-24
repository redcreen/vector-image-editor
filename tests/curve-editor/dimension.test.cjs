const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../../tools/curve-editor/dimension.js');
const L=require('../../tools/curve-editor/layers.js');
const T=require('../../tools/curve-editor/text.js');
const cal={a:{x:0,y:0},b:{x:10,y:0},length:20,unit:'mm'};
const fixture=()=>({id:'dim',name:'尺寸标注',content:'stale',x:0,y:0,fontSize:10,color:'#123456',dimension:{a:{x:0,y:0},b:{x:30,y:40},offset:20,unit:'mm'}});
test('two-point straight distance uses calibration and explicit units without source mutation',()=>{
 const t=fixture(),before=structuredClone(t),r=D.resolve(t,cal);
 assert.equal(r.content,'100.00 mm');assert.equal(r.rotation,Math.atan2(40,30)*180/Math.PI);assert.deepEqual(t,before);
 t.dimension.unit='cm';assert.equal(D.resolve(t,cal).content,'10.00 cm');
 assert.equal(D.resolve(t,null).content,'未标定');
 assert.equal(D.segments(r).length,7);
});
test('dimension validation rejects nonfinite coordinates and conflicting markers',()=>{
 for(const changes of [{offset:Infinity},{unit:'px'},{a:{x:NaN,y:0}},{extra:1}])assert.throws(()=>D.check({...fixture(),dimension:{...fixture().dimension,...changes}}));
 assert.throws(()=>D.check({...fixture(),positionMarker:{x:0,y:0}}));
});
test('dimension bounds include extensions and arrows and endpoints remain selectable',()=>{
 const t=D.resolve(fixture(),cal),bounds=T.bounds(t);
 assert.ok(bounds.x<=0&&bounds.y<=0);assert.ok(bounds.x+bounds.width>=30&&bounds.y+bounds.height>=40);
 assert.equal(T.contains(t,{x:0,y:0}),true);
});
test('dimension transforms recalculate values atomically while movement and rotation preserve distance',()=>{
 const d=L.normalize({width:1000,height:700,paths:[],image:null,opacity:.65,calibration:cal});
 const t=L.addText(d,D.resolve(fixture(),cal)),b=L.bounds(d,[],[],[t.id]);
 L.transform(d,[],[],b,{...b,x:b.x+15,y:b.y+20},[t.id]);
 assert.deepEqual(t.dimension.a,{x:15,y:20});assert.equal(t.content,'100.00 mm');
 const box=L.bounds(d,[],[],[t.id]);L.transform(d,[],[],box,{...box,width:box.width*2,height:box.height*2},[t.id]);
 assert.equal(t.content,'200.00 mm');assert.equal(t.fontSize,20);assert.equal(t.dimension.offset,40);
 L.rotateElements(d,[],[],{x:0,y:0},90,[t.id]);assert.equal(t.content,'200.00 mm');
 assert.ok(t.rotation>=-90&&t.rotation<=90);
 const before=structuredClone(d),c=L.bounds(d,[],[],[t.id]);assert.throws(()=>L.transform(d,[],[],c,{...c,width:c.width*2},[t.id]));assert.deepEqual(d,before);
});
const G=require('../../tools/curve-editor/geometry.js');
const boundDoc=()=>({calibration:cal,paths:[{id:'p',closed:false,nodes:[G.node(0,0),G.node(30,40),G.node(100,40)]}],texts:[{...fixture(),dimension:{...fixture().dimension,bindings:{a:{pathId:'p',index:0},b:{pathId:'p',index:1}}}}]});
test('bound endpoints update from source nodes and zero distance stays valid',()=>{
 const doc=boundDoc();doc.paths[0].nodes[1]=G.node(0,100);D.refresh(doc);assert.equal(doc.texts[0].content,'200.00 mm');assert.deepEqual(doc.texts[0].dimension.b,{x:0,y:100});
 doc.paths[0].nodes[1]=G.node(0,0);D.refresh(doc);assert.equal(doc.texts[0].content,'0.00 mm');assert.ok(D.segments(doc.texts[0]).flat().every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
test('topology remapping keeps original node after insertion and detaches deleted node',()=>{
 const doc=boundDoc(),before=structuredClone(doc);doc.paths[0].nodes.unshift(G.node(-100,0));D.sync(doc,before);assert.equal(doc.texts[0].dimension.bindings.b.index,2);
 const next=structuredClone(doc);doc.paths[0].nodes.splice(2,1);D.sync(doc,next);assert.equal(doc.texts[0].dimension.bindings.b,undefined);assert.deepEqual(doc.texts[0].dimension.b,{x:30,y:40});
});
test('reverse remaps bindings and missing paths freeze cached endpoints',()=>{
 const doc=boundDoc(),before=structuredClone(doc);doc.paths[0].nodes.reverse();D.sync(doc,before);assert.equal(doc.texts[0].dimension.bindings.a.index,2);
 const next=structuredClone(doc);doc.paths=[];D.sync(doc,next);assert.deepEqual(doc.texts[0].dimension.a,{x:0,y:0});assert.deepEqual(doc.texts[0].dimension.bindings,{});
});
test('legacy dimensions adopt unique exact nodes on edits but explicit free endpoints never attach',()=>{
 const doc=boundDoc();delete doc.texts[0].dimension.bindings;const before=structuredClone(doc);doc.paths[0].nodes[1]=G.node(30,0);D.sync(doc,before);assert.equal(doc.texts[0].content,'60.00 mm');assert.equal(doc.texts[0].dimension.bindings.b.index,1);
 doc.texts[0].dimension.bindings={};const next=structuredClone(doc);doc.paths[0].nodes[1]=G.node(60,0);D.sync(doc,next);assert.equal(doc.texts[0].content,'60.00 mm');
});
test('binding validation is strict and selection transforms detach only separately moved annotations',()=>{
 for(const bindings of [null,[],{c:{}},{a:{pathId:'',index:0}},{a:{pathId:'p',index:-1}},{a:{pathId:'p',index:1.5}},{a:{pathId:'p',index:0,extra:1}}])assert.throws(()=>D.check({...fixture(),dimension:{...fixture().dimension,bindings}}));
 const doc=L.normalize({...boundDoc(),width:1000,height:700,image:null,images:[],opacity:.65,layers:[{id:'base',name:'base',visible:true,locked:false,pathIds:['p'],imageIds:[],textIds:['dim']}]});D.refresh(doc);const b=L.bounds(doc,[],[],['dim']);L.transform(doc,[],[],b,{...b,x:b.x+10},['dim']);D.refresh(doc);assert.deepEqual(doc.texts[0].dimension.bindings,{});assert.equal(doc.texts[0].dimension.a.x,10);
});
test('legacy annotation transformed together with its source adopts bindings before later node edits',()=>{
 const doc=L.normalize({...boundDoc(),width:1000,height:700,image:null,images:[],opacity:.65,layers:[{id:'base',name:'base',visible:true,locked:false,pathIds:['p'],imageIds:[],textIds:['dim']}]});delete doc.texts[0].dimension.bindings;D.refresh(doc);
 const before=structuredClone(doc),b=L.bounds(doc,['p'],[],['dim']);L.transform(doc,['p'],[],b,{...b,x:b.x+10},['dim']);D.sync(doc,before);assert.equal(doc.texts[0].dimension.bindings.b.index,1);
 const next=structuredClone(doc);doc.paths[0].nodes[1]=G.node(10,100);D.sync(doc,next);assert.equal(doc.texts[0].content,'200.00 mm');
});
test('tiny nonzero distances preserve their direction',()=>{const t={...fixture(),dimension:{a:{x:0,y:0},b:{x:0,y:1e-13},offset:10,unit:'mm'}};assert.equal(D.resolve(t,cal).rotation,90);});

test('legacy inference does not guess near or duplicate anchors',()=>{const paths=[{id:'p',nodes:[G.node(0,0),G.node(1,1)]}];assert.equal(D.nodeBinding(paths,{x:0,y:1e-8}),null);paths[0].nodes.push(G.node(0,0));assert.equal(D.nodeBinding(paths,{x:0,y:0}),null);});

test('source-only half turns retain dimension node identity instead of being mistaken for reversal',()=>{
 for(const legacy of [false,true]){
  const doc=L.normalize({...boundDoc(),width:1000,height:700,image:null,images:[],opacity:.65,layers:[{id:'base',name:'base',visible:true,locked:false,pathIds:['p'],imageIds:[],textIds:['dim']}]});
  doc.paths[0].nodes=[G.node(0,0),G.node(100,0)];doc.texts[0].dimension.a={x:0,y:0};doc.texts[0].dimension.b={x:100,y:0};
  if(legacy)delete doc.texts[0].dimension.bindings;D.refresh(doc);
  const before=structuredClone(doc);L.rotateElements(doc,['p'],[],{x:50,y:0},180);D.sync(doc,before);
  const t=doc.texts[0];assert.equal(t.dimension.bindings.a.index,0);assert.equal(t.dimension.bindings.b.index,1);
  assert.deepEqual(t.dimension.a,G.point(doc.paths[0].nodes[0]));assert.deepEqual(t.dimension.b,G.point(doc.paths[0].nodes[1]));
  assert.equal(t.content,'200.00 mm');assert.equal(t.dimension.offset,20);assert.equal(t.fontSize,10);
 }
});
test('source-only transforms move only bound dimension endpoints and retain independent ones',()=>{
 const doc=L.normalize({...boundDoc(),width:1000,height:700,image:null,images:[],opacity:.65,layers:[{id:'base',name:'base',visible:true,locked:false,pathIds:['p'],imageIds:[],textIds:['dim']}]});
 delete doc.texts[0].dimension.bindings.b;D.refresh(doc);
 const before=structuredClone(doc),bounds=L.bounds(doc,['p'],[]);
 L.transform(doc,['p'],[],bounds,{...bounds,x:bounds.x+20,y:bounds.y+10});
 assert.deepEqual(doc.texts[0].dimension.a,{x:20,y:10});assert.deepEqual(doc.texts[0].dimension.b,before.texts[0].dimension.b);
 D.sync(doc,before);assert.equal(doc.texts[0].dimension.bindings.a.index,0);assert.equal(doc.texts[0].dimension.bindings.b,undefined);
});
test('no-op source transforms do not add legacy dimension bindings',()=>{
 const doc=L.normalize({...boundDoc(),width:1000,height:700,image:null,images:[],opacity:.65,layers:[{id:'base',name:'base',visible:true,locked:false,pathIds:['p'],imageIds:[],textIds:['dim']}]});
 delete doc.texts[0].dimension.bindings;D.refresh(doc);const before=structuredClone(doc),bounds=L.bounds(doc,['p'],[]);
 L.transform(doc,['p'],[],bounds,{...bounds});assert.deepEqual(doc,before);
});
test('explicit dimension bindings do not inspect unrelated path geometry during sync',()=>{
 const doc=boundDoc(),before=structuredClone(doc);doc.paths[0].nodes[1]=G.node(30,0);
 doc.texts.push({...fixture(),id:'free',dimension:{...fixture().dimension,bindings:{}}});
 before.texts.push(structuredClone(doc.texts[1]));
 // A newly created legacy annotation has no previous dimension to infer from.
 doc.texts.push({...fixture(),id:'new'});
 let reads=0;
 for(const state of [before,doc])state.paths.push({id:'unrelated',get nodes(){reads++;return [G.node(500,500)];}});
 D.sync(doc,before);
 assert.equal(reads,0);assert.equal(doc.texts[0].content,'60.00 mm');
 assert.deepEqual(doc.texts[0].dimension.b,{x:30,y:0});
 assert.deepEqual(doc.texts[1].dimension.bindings,{});assert.equal(doc.texts[2].dimension.bindings,undefined);
});
test('mixed bound and legacy dimensions infer only after geometry changes',()=>{
 const doc=boundDoc();doc.texts.push({...fixture(),id:'legacy'});
 const unchanged=structuredClone(doc);D.sync(doc,unchanged);
 assert.equal(doc.texts[1].dimension.bindings,undefined);
 const before=structuredClone(doc);doc.paths[0].nodes[1]=G.node(30,0);D.sync(doc,before);
 for(const t of doc.texts){assert.deepEqual(t.dimension.bindings,{a:{pathId:'p',index:0},b:{pathId:'p',index:1}});assert.deepEqual(t.dimension.b,{x:30,y:0});assert.equal(t.content,'60.00 mm');}
});
test('dimension baselines clone only referenced paths and dimension texts for fully bound endpoints',()=>{
 const doc=boundDoc();doc.paths.push({id:'other',nodes:[G.node(500,500)]});doc.texts.push({id:'plain',content:'note'});
 const baseline=D.captureBaseline(doc);
 assert.deepEqual(baseline.paths.map(p=>p.id),['p']);assert.deepEqual(baseline.texts.map(t=>t.id),['dim']);
 doc.paths[0].nodes[0].in.x=99;doc.texts[0].dimension.bindings.a.index=2;
 assert.equal(baseline.paths[0].nodes[0].in.x,0);assert.equal(baseline.texts[0].dimension.bindings.a.index,0);
 const free=boundDoc();free.texts[0].dimension.bindings={};assert.deepEqual(D.captureBaseline(free).paths,free.paths);
});
test('mixed legacy baselines retain every path so ambiguous anchors never attach',()=>{
 const doc=boundDoc();doc.texts.push({...fixture(),id:'legacy'});doc.paths.push({id:'duplicate',nodes:[G.node(0,0)]});
 const baseline=D.captureBaseline(doc);assert.deepEqual(baseline.paths.map(p=>p.id),['p','duplicate']);
 doc.paths[0].nodes[1]=G.node(30,0);D.sync(doc,baseline);
 assert.equal(doc.texts[1].dimension.bindings.a,undefined);assert.deepEqual(doc.texts[1].dimension.bindings.b,{pathId:'p',index:1});
 assert.deepEqual(doc.texts[0].dimension.bindings.a,{pathId:'p',index:0});
});
test('compact dimension baselines retain reversal and topology remapping',()=>{
 const doc=boundDoc();let baseline=D.captureBaseline(doc);doc.paths[0].nodes.reverse();D.sync(doc,baseline);
 assert.equal(doc.texts[0].dimension.bindings.a.index,2);
 baseline=D.captureBaseline(doc);doc.paths[0].nodes.unshift(G.node(500,500));D.sync(doc,baseline);assert.equal(doc.texts[0].dimension.bindings.a.index,3);
 baseline=D.captureBaseline(doc);doc.paths[0].nodes.splice(3,1);D.sync(doc,baseline);assert.equal(doc.texts[0].dimension.bindings.a,undefined);
});
test('free endpoint baselines retain paths needed by a newly snapped binding',()=>{
 const doc=boundDoc();doc.texts[0].dimension.bindings={};const baseline=D.captureBaseline(doc);
 doc.texts[0].dimension.bindings.a={pathId:'p',index:2};doc.texts[0].dimension.a={x:100,y:40};
 D.sync(doc,baseline);assert.deepEqual(doc.texts[0].dimension.bindings.a,{pathId:'p',index:2});
 const next=D.captureBaseline(doc);doc.paths[0].nodes[2]=G.node(200,40);D.sync(doc,next);assert.deepEqual(doc.texts[0].dimension.a,{x:200,y:40});
});

test('releasing a bound endpoint captures all paths before snapping to a different path',()=>{
 const doc=boundDoc();doc.paths.push({id:'other',nodes:[G.node(500,500)]});
 const bound=D.captureBaseline(doc);assert.deepEqual(bound.paths.map(p=>p.id),['p']);
 delete doc.texts[0].dimension.bindings.a;doc.texts[0].dimension.a={x:400,y:400};D.sync(doc,bound);
 const free=D.captureBaseline(doc);assert.deepEqual(free.paths.map(p=>p.id),['p','other']);
 doc.texts[0].dimension.bindings.a={pathId:'other',index:0};doc.texts[0].dimension.a={x:500,y:500};D.sync(doc,free);
 assert.deepEqual(doc.texts[0].dimension.bindings.a,{pathId:'other',index:0});
 const rebound=D.captureBaseline(doc);doc.paths[1].nodes[0]=G.node(600,500);D.sync(doc,rebound);assert.deepEqual(doc.texts[0].dimension.a,{x:600,y:500});
});
