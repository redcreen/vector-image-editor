const {test}=require('node:test');const assert=require('node:assert/strict');
const V=require('../../tools/curve-editor/vector-files.js'),G=require('../../tools/curve-editor/geometry.js'),L=require('../../tools/curve-editor/layers.js');
function sample(){return L.normalize({paths:[{id:'one',name:'a',nodes:[G.node(0,0),G.node(72,36)],closed:false},{id:'two',name:'b',nodes:[G.node(100,0),G.node(172,36)],closed:false}],texts:[],images:[],layers:[{id:'group',name:'g',kind:'group',visible:true,locked:false,pathIds:[],imageIds:[]},{id:'a',parentId:'group',name:'a',visible:true,locked:true,pathIds:['one'],imageIds:[]},{id:'b',name:'b',visible:true,locked:false,pathIds:['two'],imageIds:[]}],calibration:{a:{x:0,y:0},b:{x:72,y:0},length:25.4,unit:'mm'}});}
test('export summary follows selected subtree with real calibrated size and anchor counts',()=>{const d=sample(),s=V.scopeInfo(d,['group']);assert.deepEqual(s.pathIds,['one']);assert.equal(s.nodeCount,2);assert.equal(V.scopeInfo(d).nodeCount,4);assert.equal(V.scopeInfo(d,['group','a']).nodeCount,2);assert.equal(s.widthMm,25.4);assert.equal(s.heightMm,12.7);assert.equal(s.error,'');});
test('hidden ancestors and items never enter export preview or node counts',()=>{const d=sample();d.layers[0].visible=false;assert.equal(V.scopeInfo(d).nodeCount,2);d.layers[2].items=[{type:'path',id:'two',visible:false}];assert.match(V.scopeInfo(d).error,/可见/);assert.equal(V.scopeInfo(d).nodeCount,0);});
test('unscaled and mixed bitmap work reports errors while still counting curve anchors',()=>{const d=sample();d.calibration=null;assert.match(V.scopeInfo(d).error,/标定|比例/);assert.equal(V.scopeInfo(d).nodeCount,4);d.calibration={a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'};d.images=[{id:'image',x:0,y:0,width:10,height:10}];d.layers[2].imageIds.push('image');assert.match(V.scopeInfo(d).error,/图片/);assert.equal(V.scopeInfo(d).nodeCount,4);});
test('image-pixel dimensions remain distinct from explicit millimetre conversion',()=>{assert.equal(V.physicalSize({width:72,height:36},sample().calibration),'实际尺寸：25.40 × 12.70 mm');assert.equal(V.physicalSize({width:72,height:36},null),'实际尺寸未标定');});
test('append scales imported nodes and handles into target units without changing existing content',()=>{
 const current=sample(),incoming=sample();incoming.paths=incoming.paths.slice(0,1);incoming.layers=incoming.layers.slice(0,2);
 current.title='现有作品';current.drawingId='原作品';current.originals=[];
 incoming.calibration={a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'};
 incoming.paths[0].nodes[0].out={x:12,y:4};
 const before=structuredClone(current),source=structuredClone(incoming),result=V.prepareAppend(current,incoming,{x:200,y:300}),d=result.document;
 assert.deepEqual(current,before);assert.deepEqual(incoming,source);assert.deepEqual(d.paths.slice(0,2),before.paths);assert.deepEqual(d.layers.slice(0,3),before.layers);assert.equal(d.title,current.title);assert.equal(d.drawingId,current.drawingId);assert.deepEqual(d.calibration,current.calibration);
 const added=d.paths.at(-1),scale=G.millimetersPerPixel(d.calibration);assert.ok(Math.abs((added.nodes[1].x-added.nodes[0].x)*scale-72)<1e-9);
 assert.ok(Math.abs((added.nodes[0].out.x-added.nodes[0].x)*scale-12)<1e-9);
 assert.ok(Math.abs((added.nodes[0].out.y-added.nodes[0].y)*scale-4)<1e-9);
 assert.equal(new Set(d.paths.map(p=>p.id)).size,d.paths.length);assert.equal(new Set(d.layers.map(l=>l.id)).size,d.layers.length);
 assert.equal(d.layers.at(-1).parentId,d.layers.at(-2).id);assert.deepEqual(d.layers.at(-1).pathIds,[added.id]);
 const twice=V.prepareAppend(d,incoming,{x:0,y:0}).document;assert.equal(new Set(twice.paths.map(p=>p.id)).size,twice.paths.length);
});
test('append adopts file scale only for an empty canvas and requires calibration for existing content',()=>{
 const incoming=sample(),empty=L.normalize({paths:[],originals:[],images:[],texts:[],layers:[{id:'empty',name:'空层',visible:true,locked:false,pathIds:[],imageIds:[]}],calibration:null});
 const result=V.prepareAppend(empty,incoming,{x:0,y:0});assert.equal(G.millimetersPerPixel(result.document.calibration),G.millimetersPerPixel(incoming.calibration));assert.equal(empty.calibration,null);
 const d=sample();d.calibration=null;assert.equal(V.needsImportCalibration(d),true);assert.throws(()=>V.prepareAppend(d,incoming),/标定/);
 d.paths=[];d.images=[{id:'photo'}];assert.equal(V.needsImportCalibration(d),true);d.images=[];d.texts=[{id:'label'}];assert.equal(V.needsImportCalibration(d),true);
});
test('append rejects missing source scale and excessive combined limits without partial mutation',()=>{
 const d=sample(),incoming=sample(),before=structuredClone(d);incoming.calibration=null;
 assert.throws(()=>V.prepareAppend(d,incoming),/比例|标定/);assert.deepEqual(d,before);
 incoming.calibration=d.calibration;incoming.paths=Array.from({length:499},(_,i)=>({...incoming.paths[0],id:'p'+i}));
 assert.throws(()=>V.prepareAppend(d,incoming),/500|曲线/);assert.deepEqual(d,before);
 const many=sample();many.layers=Array.from({length:199},(_,i)=>({id:'l'+i,name:'层',pathIds:[],imageIds:[]}));
 assert.throws(()=>V.prepareAppend(d,many),/200|图层/);assert.deepEqual(d,before);
 const fullOriginals=sample();fullOriginals.originals=Array.from({length:500},()=>structuredClone(fullOriginals.paths[0]));
 assert.throws(()=>V.prepareAppend(fullOriginals,sample()),/原稿|500/);
});
test('clipboard paste preserves physical geometry including handles and copied scale snapshot',()=>{
 const target=sample();target.calibration={a:{x:0,y:0},b:{x:1,y:0},length:2,unit:'mm'};
 const payload={paths:structuredClone(sample().paths),sourcePageId:'source',calibration:{a:{x:0,y:0},b:{x:100,y:0},length:5,unit:'cm'}};
 payload.paths[0].nodes[0].out={x:12,y:8};const before=structuredClone(payload),original=structuredClone(target);
 const result=V.preparePaste(target,payload,'target');assert.equal(result.scale,.25);assert.deepEqual(result.calibration,target.calibration);
 for(let i=0;i<payload.paths.length;i++)for(let n=0;n<payload.paths[i].nodes.length;n++)for(const key of ['', 'in','out']){
  const a=key?payload.paths[i].nodes[n][key]:payload.paths[i].nodes[n],b=key?result.paths[i].nodes[n][key]:result.paths[i].nodes[n];
  assert.equal(b.x*2,a.x*.5);assert.equal(b.y*2,a.y*.5);
 }
 assert.deepEqual(payload,before);assert.deepEqual(target,original);
});
test('clipboard paste requires known source size across pages and adopts scale only on a blank target',()=>{
 const payload={paths:sample().paths,sourcePageId:'source',calibration:null},target=sample();
 assert.throws(()=>V.preparePaste(target,payload,'other'),/来源.*标定/);
 assert.deepEqual(V.preparePaste(target,payload,'source').paths,payload.paths);
 const unscaled={...sample(),calibration:null};payload.calibration={a:{x:0,y:0},b:{x:1,y:0},length:.5,unit:'mm'};
 assert.throws(()=>V.preparePaste(unscaled,payload,'other'),/画布.*标定/);
 const blank={...unscaled,paths:[],images:[],texts:[],image:null};const result=V.preparePaste(blank,payload,'other');
 assert.equal(G.millimetersPerPixel(result.calibration),.5);assert.deepEqual(result.paths,payload.paths);assert.equal(blank.calibration,null);
 const extreme={...payload,calibration:{a:{x:0,y:0},b:{x:.00001,y:0},length:10000000,unit:'cm'}};
 assert.equal(G.millimetersPerPixel(V.preparePaste(blank,extreme,'other').calibration),G.millimetersPerPixel(extreme.calibration));
 const tooSmall={...target,calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1e-12,unit:'mm'}};
 assert.throws(()=>V.preparePaste(tooSmall,payload,'other'),/坐标|范围/);
});

test('mixed clipboard scales rotated images and annotations then aligns the combined top-left to the paste point',()=>{
 const target=sample();target.calibration={a:{x:0,y:0},b:{x:1,y:0},length:2,unit:'mm'};
 const payload={sourcePageId:'source',calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'},paths:[sample().paths[0]],
  images:[{id:'photo',name:'图片',dataUrl:'data:image/png;base64,AA==',x:-60,y:40,width:80,height:40,opacity:.7,rotation:35}],
  texts:[{id:'label',name:'文字',content:'ABC',x:50,y:-40,fontSize:24,color:'#123456',rotation:20},
   {id:'marker',name:'点位',content:'A1',x:20,y:30,fontSize:20,color:'#123456',positionMarker:{x:0,y:0,pathId:'one',attachment:{kind:'node',index:0}}}]};
 const before=structuredClone(payload),original=structuredClone(target),position={x:345,y:-234};
 const result=V.preparePaste(target,payload,'target',position);
 const box=L.bounds(result,result.paths.map(p=>p.id),result.images.map(p=>p.id),result.texts.map(p=>p.id));
 assert.ok(Math.abs(box.x-position.x)<1e-8);assert.ok(Math.abs(box.y-position.y)<1e-8);
 assert.equal(result.images[0].width,40);assert.equal(result.images[0].height,20);assert.equal(result.images[0].rotation,35);assert.equal(result.images[0].opacity,.7);
 assert.equal(result.texts[0].fontSize,12);assert.equal(result.texts[0].rotation,20);
 assert.equal(result.texts[1].positionMarker.x,result.paths[0].nodes[0].x);assert.equal(result.texts[1].positionMarker.y,result.paths[0].nodes[0].y);
 assert.equal(result.paths[0].nodes[1].x-result.paths[0].nodes[0].x,36);
 assert.deepEqual(payload,before);assert.deepEqual(target,original);
});

test('image-only and text-only clipboards use their rotated bounds and reject out-of-range placements atomically',()=>{
 const target=sample(),payload={sourcePageId:'same',calibration:null,paths:[],images:[{id:'photo',name:'图片',dataUrl:'data:image/png;base64,AA==',x:0,y:0,width:80,height:40,opacity:1,rotation:90}],texts:[]};
 const result=V.preparePaste(target,payload,'same',{x:200,y:300}),box=L.bounds(result,[],['photo']);
 assert.ok(Math.abs(box.x-200)<1e-8);assert.ok(Math.abs(box.y-300)<1e-8);
 const before=structuredClone(payload);assert.throws(()=>V.preparePaste(target,payload,'same',{x:1e8,y:0}),/范围/);assert.deepEqual(payload,before);
 const textPayload={...payload,images:[],texts:[{id:'label',name:'文字',content:'ABC',x:50,y:20,fontSize:24,color:'#123456',rotation:90}]};
 const text=V.preparePaste(target,textPayload,'same',{x:-20,y:50}),textBox=L.bounds(text,[],[],['label']);
 assert.ok(Math.abs(textBox.x+20)<1e-8);assert.ok(Math.abs(textBox.y-50)<1e-8);
});
