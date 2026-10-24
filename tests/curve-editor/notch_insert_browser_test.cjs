// Every interaction below uses a disposable project and never touches an open user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const D=require('../../tools/curve-editor/dimension.js');

const close=(actual,expected,tolerance=.01)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

async function setup(t,{document:customDocument}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-notch-insert-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}await rm(project,{recursive:true,force:true});});
 const curve=(id,points,closed=false)=>({id,name:id,color:'#e04544',role:'outline',closed,note:'',nodes:points.map(([x,y])=>G.node(x,y))});
 const initial=customDocument||{
  format:'daban-curve-editor',version:1,units:'image-px',title:'右键增加剪口测试',width:900,height:600,image:null,opacity:1,originals:[],images:[],texts:[],newNodeMode:'cusp',
  calibration:{a:{x:0,y:0},b:{x:100,y:0},length:50,unit:'mm'},
  paths:[curve('outline',[[100,100],[500,100],[500,400],[100,400]],true)],
  layers:[{id:'piece',name:'裁片',visible:true,locked:false,pathIds:['outline'],imageIds:[],textIds:[]}]
 };
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});
 await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.stderr.on('data',chunk=>log+=chunk);server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(url);await page.locator('.layer-row').first().waitFor();
 const screen=point=>page.locator('#viewport').evaluate((element,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(element.getScreenCTM());return {x:q.x,y:q.y};},point);
 const right=async point=>{const p=await screen(point);await page.mouse.click(p.x,p.y,{button:'right'});await page.locator('#context-menu').waitFor();};
 const item=label=>page.getByRole('menuitem',{name:label,exact:true});
 const save=async()=>{const response=page.waitForResponse(result=>result.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(result=>result.json()));};
 return {page,initial,errors,right,item,save};
}

function notchGroup(path){
 const groups=new Map();for(const node of path.nodes)if(node.notchId){if(!groups.has(node.notchId))groups.set(node.notchId,[]);groups.get(node.notchId).push(node);}
 assert.equal(groups.size,1,'one right-click must create exactly one notch group');const nodes=[...groups.values()][0];assert.equal(nodes.length,3,'the automatic V notch must contain exactly three tagged nodes');return nodes;
}

test('right-click inserts one inward scale-sized V notch and preserves it through history, export and recovery',async t=>{
 const {page,initial,errors,right,item,save}=await setup(t);await page.locator('[data-tool="select"]').click();await right({x:300,y:100});
 assert.equal(await item('增加剪口').count(),1);assert.equal(await item('增加剪口').isEnabled(),true);await item('增加剪口').click();
 assert.match(await page.locator('#status').textContent(),/已增加 V 形剪口.*口宽、深度/);
 let inserted=await save();assert.equal(inserted.paths.length,1);assert.equal(inserted.paths[0].nodes.length,initial.paths[0].nodes.length+3);
 const [mouthA,tip,mouthB]=notchGroup(inserted.paths[0]),width=G.dist(mouthA,mouthB),mid=G.mix(mouthA,mouthB,.5),depth=G.dist(mid,tip);
 close(width,Math.max(G.pathBounds(initial.paths[0]).width,G.pathBounds(initial.paths[0]).height)*.015);close(depth,width);
 assert.ok(tip.y>mouthA.y&&tip.y>mouthB.y,'a notch on the top of this clockwise closed contour must point inward');

 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,inserted.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 inserted=await save();notchGroup(inserted.paths[0]);

 await page.locator('#export').click();await page.locator('#vector-export-format').selectOption('svg');
 await page.waitForFunction(()=>document.querySelector('#vector-export-counts')?.textContent.includes('曲线节点：原 7 个'));
 const download=page.waitForEvent('download');await page.locator('#vector-export-confirm').click();const file=await download,svg=await readFile(await file.path(),'utf8');
 assert.match(svg,/<svg\b/);assert.match(svg,/width="200mm"/);assert.match(svg,/height="150mm"/);assert.deepEqual(errors,[]);
});

test('an open endpoint rejects insertion atomically and a locked curve offers no notch mutation',async t=>{
 const curve=(id,points)=>({id,name:id,color:'#176bce',role:'outline',closed:false,note:'',nodes:points.map(([x,y])=>G.node(x,y))});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'剪口保护测试',width:900,height:600,image:null,opacity:1,originals:[],images:[],texts:[],newNodeMode:'cusp',
  paths:[curve('open',[[100,150],[500,150]]),curve('locked',[[100,350],[500,350]])],
  layers:[{id:'editable',name:'开放曲线',visible:true,locked:false,pathIds:['open'],imageIds:[],textIds:[]},{id:'protected',name:'锁定曲线',visible:true,locked:false,pathIds:['locked'],imageIds:[],textIds:[],items:[{type:'path',id:'locked',locked:true}]}]};
 const {page,errors,right,item,save}=await setup(t,{document:initial});await page.locator('[data-tool="node"]').click();
 const before=await save();await right({x:100,y:150});assert.equal(await item('增加剪口').count(),1);await item('增加剪口').click();
 assert.match(await page.locator('#status').textContent(),/端点没有两侧缝边/);assert.deepEqual((await save()).paths,before.paths);assert.equal(await page.locator('#undo').isDisabled(),true);

 await right({x:300,y:350});assert.equal(await item('增加剪口').count(),0);assert.deepEqual((await save()).paths,before.paths);assert.deepEqual(errors,[]);
});

test('node-bound position and dimension annotations survive normal and closed-wrap notch insertion',async t=>{
 const nodes=[[100,100],[500,100],[500,400],[100,400]].map(([x,y])=>G.node(x,y)),calibration={a:{x:0,y:0},b:{x:100,y:0},length:50,unit:'mm'};
 const marker={id:'marker',name:'N1',content:'N1',x:510,y:75,fontSize:14,color:'#1685a6',rotation:0,positionMarker:{x:500,y:100,pathId:'outline',attachment:{kind:'node',index:1}}};
 const dimension=D.resolve({id:'dimension',name:'右边尺寸',content:'尺寸',x:0,y:0,fontSize:14,color:'#1685a6',dimension:{a:{x:500,y:100},b:{x:500,y:400},offset:35,unit:'mm',bindings:{a:{pathId:'outline',index:1},b:{pathId:'outline',index:2}}}},calibration);
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'剪口标注关联测试',width:900,height:600,image:null,opacity:1,originals:[],images:[],texts:[marker,dimension],newNodeMode:'cusp',calibration,
  paths:[{id:'outline',name:'闭合轮廓',color:'#e04544',role:'outline',closed:true,note:'',nodes}],
  layers:[{id:'piece',name:'裁片',visible:true,locked:false,pathIds:['outline'],imageIds:[],textIds:[]},{id:'annotations',name:'标注',visible:true,locked:false,pathIds:[],imageIds:[],textIds:['marker','dimension']}]};
 const {page,errors,right,item,save}=await setup(t,{document:initial});await page.locator('[data-tool="select"]').click();
 const assertBindings=async expectedNodes=>{
  const saved=await save(),outline=saved.paths[0],savedMarker=saved.texts.find(text=>text.id==='marker'),savedDimension=saved.texts.find(text=>text.id==='dimension');assert.equal(outline.nodes.length,expectedNodes);
  const markerNode=outline.nodes[savedMarker.positionMarker.attachment.index];close(markerNode.x,500);close(markerNode.y,100);close(savedMarker.positionMarker.x,markerNode.x);close(savedMarker.positionMarker.y,markerNode.y);
  for(const key of ['a','b']){const endpoint=savedDimension.dimension[key],binding=savedDimension.dimension.bindings[key],node=outline.nodes[binding.index];close(endpoint.x,node.x);close(endpoint.y,node.y);}
  assert.equal(savedDimension.content,'150.00 mm');
  const dot=page.locator('[data-text="marker"] .position-marker');close(Number(await dot.getAttribute('cx')),500);close(Number(await dot.getAttribute('cy')),100);
  const lines=page.locator('[data-text="dimension"] .dimension-line');close(Number(await lines.nth(0).getAttribute('x1')),savedDimension.dimension.a.x);close(Number(await lines.nth(0).getAttribute('y1')),savedDimension.dimension.a.y);close(Number(await lines.nth(1).getAttribute('x1')),savedDimension.dimension.b.x);close(Number(await lines.nth(1).getAttribute('y1')),savedDimension.dimension.b.y);
 };

 await right({x:300,y:100});await item('增加剪口').click();await assertBindings(7);
 await right({x:100,y:100});await item('增加剪口').click();await assertBindings(9);
 assert.equal((await save()).paths[0].nodes.filter(node=>node.notchId).length,6);assert.deepEqual(errors,[]);
});

test('dense closed-wrap insertion remaps annotations even when the total node count is unchanged',async t=>{
 // The mouth removes old nodes 6, 0 and 1 while adding two mouth nodes plus
 // one tip, so the count stays at seven even though the closed array rotates.
 const nodes=[[100,100],[100.1,100],[499.9,100],[500,100],[500,400],[100,400],[100,100.1]].map(([x,y])=>G.node(x,y)),calibration={a:{x:0,y:0},b:{x:100,y:0},length:50,unit:'mm'};
 const marker={id:'marker',name:'N1',content:'N1',x:510,y:75,fontSize:14,color:'#1685a6',rotation:0,positionMarker:{x:500,y:100,pathId:'outline',attachment:{kind:'node',index:3}}};
 const dimension=D.resolve({id:'dimension',name:'右边尺寸',content:'尺寸',x:0,y:0,fontSize:14,color:'#1685a6',dimension:{a:{x:500,y:100},b:{x:500,y:400},offset:35,unit:'mm',bindings:{a:{pathId:'outline',index:3},b:{pathId:'outline',index:4}}}},calibration);
 const detached=D.resolve({id:'detached',name:'被替换节点尺寸',content:'尺寸',x:0,y:0,fontSize:14,color:'#8b3ec9',dimension:{a:{x:100,y:100},b:{x:500,y:100},offset:-35,unit:'mm',bindings:{a:{pathId:'outline',index:0},b:{pathId:'outline',index:3}}}},calibration);
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'等节点数闭合剪口标注测试',width:900,height:600,image:null,opacity:1,originals:[],images:[],texts:[marker,dimension,detached],newNodeMode:'cusp',calibration,
  paths:[{id:'outline',name:'密集闭合轮廓',color:'#e04544',role:'outline',closed:true,note:'',nodes}],
  layers:[{id:'piece',name:'裁片',visible:true,locked:false,pathIds:['outline'],imageIds:[],textIds:[]},{id:'annotations',name:'标注',visible:true,locked:false,pathIds:[],imageIds:[],textIds:['marker','dimension','detached']}]};
 const {page,errors,right,item,save}=await setup(t,{document:initial});await page.locator('[data-tool="select"]').click();
 // Hide the annotation strokes while opening the curve menu at their shared endpoint.
 const visibility=page.locator('.layer-row[data-layer="annotations"] [data-action="visible"]');await visibility.click();await right({x:100,y:100});await item('增加剪口').click();await visibility.click();
 const saved=await save(),outline=saved.paths[0],savedMarker=saved.texts.find(text=>text.id==='marker'),savedDimension=saved.texts.find(text=>text.id==='dimension'),savedDetached=saved.texts.find(text=>text.id==='detached');assert.equal(outline.nodes.length,nodes.length);assert.equal(outline.nodes.filter(node=>node.notchId).length,3);
 const markerNode=outline.nodes[savedMarker.positionMarker.attachment.index];close(markerNode.x,500);close(markerNode.y,100);close(savedMarker.positionMarker.x,500);close(savedMarker.positionMarker.y,100);
 for(const [key,expected] of [['a',{x:500,y:100}],['b',{x:500,y:400}]]){const endpoint=savedDimension.dimension[key],node=outline.nodes[savedDimension.dimension.bindings[key].index];close(node.x,expected.x);close(node.y,expected.y);close(endpoint.x,expected.x);close(endpoint.y,expected.y);}
 assert.equal(savedDimension.content,'150.00 mm');assert.equal(savedDetached.dimension.bindings.a,undefined);assert.deepEqual(savedDetached.dimension.a,{x:100,y:100});
 const surviving=outline.nodes[savedDetached.dimension.bindings.b.index];close(surviving.x,500);close(surviving.y,100);assert.equal(savedDetached.content,'200.00 mm');assert.deepEqual(errors,[]);
});
