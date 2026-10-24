// Curve clipboard tests use temporary projects, never an existing user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');

async function setup(t,{denyClipboard=false,pathCount=4,registryPath=null,calibration=true,mmPerPx=1,blank=false,mixed=false}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-curve-clipboard-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id)=>({id,name:id,color:'#176bce',role:'seam',closed:true,dashed:true,note:'保留备注',nodes:[G.node(100,100),G.node(200,100),G.node(200,200)]});
 const a=curve('曲线甲');a.nodes[1].mode='symmetric';a.nodes[1].in={x:160,y:70};a.nodes[1].out={x:240,y:130};
 const paths=blank?[]:[a,curve('曲线乙'),curve('锁定曲线'),{...curve('隐藏曲线'),visible:false}];
 while(!blank&&paths.length<pathCount)paths.push(curve('额外曲线'+paths.length));
 const layers=blank?[{id:'target',name:'目标图层',visible:true,locked:false,pathIds:[],imageIds:[]}]:[
  {id:'source',name:'来源图层',visible:true,locked:false,pathIds:paths.filter(p=>p.id!=='锁定曲线').map(p=>p.id),imageIds:[]},
  {id:'locked',name:'锁定图层',visible:true,locked:true,pathIds:['锁定曲线'],imageIds:[]},
  {id:'target',name:'目标图层',visible:true,locked:false,pathIds:[],imageIds:[]}
 ];
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'曲线复制测试',width:1000,height:700,paths,originals:[],image:null,opacity:.65,newNodeMode:'cusp',layers,images:[],calibration:calibration?{a:{x:0,y:0},b:{x:100,y:0},length:mmPerPx===1?10:mmPerPx*100,unit:mmPerPx===1?'cm':'mm'}:null,measureUnit:mmPerPx===1?'cm':'mm'};
 initial.texts=[];initial.layers.forEach(layer=>{layer.textIds=[];});
 if(mixed){
  initial.images=[{id:'photo',name:'参考图片',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=',x:30,y:70,width:120,height:80,opacity:.65,rotation:30}];
  initial.texts=[{id:'label',name:'名称',content:'混合元素',x:90,y:30,fontSize:24,color:'#123456',rotation:20},
   {id:'marker',name:'点位',content:'A1',x:120,y:120,fontSize:20,color:'#654321',rotation:0,positionMarker:{x:100,y:100,pathId:'曲线甲',attachment:{kind:'node',index:0}}},
   {id:'dimension',name:'尺寸',content:'100.00 mm',x:100,y:70,fontSize:16,color:'#345678',rotation:0,dimension:{a:{x:100,y:100},b:{x:200,y:100},offset:20,unit:'mm',bindings:{a:{pathId:'曲线甲',index:0},b:{pathId:'曲线甲',index:1}}}}];
  layers[0].imageIds=['photo'];layers[0].textIds=initial.texts.map(t=>t.id);
  layers[0].items=[{type:'path',id:'曲线甲'},{type:'image',id:'photo'},{type:'text',id:'label'},{type:'path',id:'曲线乙'},{type:'text',id:'marker'},{type:'text',id:'dimension'},{type:'path',id:'隐藏曲线'}];
 }
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 registryPath ||= path.join(project,'registry');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:registryPath,CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:1600,height:1000},permissions:['clipboard-read','clipboard-write']});
 if(denyClipboard)await context.addInitScript(()=>{window.clipboardReadCalls=0;Object.defineProperty(navigator,'clipboard',{value:{readText:async()=>{window.clipboardReadCalls++;throw new Error('denied');},writeText:async()=>{throw new Error('denied');}}});});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);await expandLayerContents(page);if(!blank)await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'曲线甲'}).waitFor({state:'attached'});
 for(const id of ['panel-properties','panel-curves'])await page.locator('#'+id).evaluate(el=>el.open=true);
 const curveRow=name=>page.locator('#layer-list .layer-contents .curve-select').filter({hasText:name});
 const layerRow=id=>page.locator(`#layer-list [data-layer="${id}"]`);
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const selectedIds=()=>page.locator('#layer-list .layer-contents .curve-select[aria-pressed=true]').evaluateAll(rows=>rows.map(r=>r.closest('.curve-item').dataset.path));
 const clickPoint=async(x,y)=>{const p=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});await page.mouse.click(p.x,p.y);};
 return {page,context,url,initial,errors,curveRow,layerRow,save,selectedIds,clickPoint,registryPath};
}

function assertCopy(copy,source){
 const {id,name,color,nodes,...data}=copy,{id:sourceId,name:sourceName,color:sourceColor,nodes:sourceNodes,...sourceData}=source;
 assert.notEqual(id,sourceId);assert.equal(name,sourceName+' · 副本');assert.notEqual(color.toLowerCase(),sourceColor.toLowerCase());assert.match(color,/^#[0-9a-f]{6}$/i);assert.deepEqual(data,sourceData);
 assertScaledCopy(copy,source,1);
 for(let i=0;i<nodes.length;i++){const {x,y,in:incoming,out,...metadata}=nodes[i],{x:sx,y:sy,in:sin,out:sout,...expected}=sourceNodes[i];assert.deepEqual(metadata,expected);}
}
function assertScaledCopy(copy,source,ratio){
 assert.notEqual(copy.id,source.id);assert.equal(copy.name,source.name+' · 副本');assert.notEqual(copy.color.toLowerCase(),source.color.toLowerCase());
 for(const key of ['role','closed','dashed','note','visible'])assert.deepEqual(copy[key],source[key]);assert.equal(copy.nodes.length,source.nodes.length);
 for(let i=0;i<source.nodes.length;i++)for(const point of ['', 'in', 'out'])for(const key of ['x','y']){const actual=(point?copy.nodes[i][point][key]:copy.nodes[i][key])-copy.nodes[0][key],expected=((point?source.nodes[i][point][key]:source.nodes[i][key])-source.nodes[0][key])*ratio;assert.ok(Math.abs(actual-expected)<1e-8,`${point||'anchor'} ${key}: ${actual} != ${expected}`);}
}

test('cross-port shared paste scales multiple curves and handles from copied calibration snapshot',async t=>{
 const source=await setup(t,{denyClipboard:true,mmPerPx:.5}),target=await setup(t,{denyClipboard:true,mmPerPx:2,registryPath:source.registryPath});
 await source.curveRow('曲线甲').click();await source.curveRow('曲线乙').click({modifiers:['Shift']});const written=source.page.waitForRequest(r=>r.url().endsWith('/api/curve-clipboard')&&r.postDataJSON().action==='write');await source.page.locator('#copy-curves').click();const payload=(await written).postDataJSON().clipboard;
 assert.equal(payload.version,3);assert.deepEqual(payload.calibration,source.initial.calibration);assert.equal(typeof payload.sourcePageId,'string');assert.ok(payload.sourcePageId.length>0);assert.ok(Number.isFinite(payload.copiedAt));assert.equal(payload.paths.length,2);
 await source.page.evaluate(()=>document.querySelector('#calibration-clear').click());assert.equal((await source.save()).calibration,null);
 const targetLayerBefore=target.initial.layers.find(l=>l.id==='target');await target.layerRow('target').locator('.layer-select').click({button:'right'});await target.page.getByRole('menuitem',{name:'粘贴元素',exact:true}).click();await target.page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===6);
 const pasted=await target.save(),copies=pasted.paths.slice(target.initial.paths.length);assert.equal(copies.length,2);copies.forEach((copy,i)=>assertScaledCopy(copy,source.initial.paths[i],.25));assert.deepEqual(pasted.paths.slice(0,target.initial.paths.length),target.initial.paths);assert.equal(new Set(pasted.paths.map(p=>p.id)).size,pasted.paths.length);assert.deepEqual(pasted.layers.find(l=>l.id==='target').pathIds,copies.map(p=>p.id));
 const {pathIds,items,...targetMetadata} = pasted.layers.find(l=>l.id==='target'),{pathIds:ignored,...expectedMetadata}=targetLayerBefore;assert.deepEqual(targetMetadata,{...expectedMetadata,textIds:[]});assert.deepEqual(items,copies.map(p=>({type:"path",id:p.id})));assert.deepEqual(await target.selectedIds(),copies.map(p=>p.id));
 await target.page.locator('#undo').click();assert.deepEqual((await target.save()).paths,target.initial.paths);await target.page.locator('#redo').click();assert.deepEqual((await target.save()).paths,pasted.paths);await target.page.reload();await expandLayerContents(target.page);await target.curveRow('曲线甲 · 副本').waitFor({state:'attached'});assert.deepEqual((await target.save()).paths,pasted.paths);assert.deepEqual([...source.errors,...target.errors],[]);
});

test('native system clipboard paste into another page on a separate port preserves physical curve size',async t=>{
 const source=await setup(t,{mmPerPx:.5}),target=await setup(t,{mmPerPx:2,registryPath:source.registryPath});
 await source.curveRow('曲线甲').click();await source.page.locator('#copy-curves').click();await source.page.locator('#status').filter({hasText:'已复制'}).waitFor();
 const nativeTarget=await source.context.newPage();nativeTarget.setDefaultTimeout(8000);nativeTarget.on('pageerror',e=>source.errors.push(e.message));await nativeTarget.goto(target.url+'?client=native-system');await expandLayerContents(nativeTarget);await nativeTarget.locator('#layer-list .layer-contents .curve-select').filter({hasText:'曲线甲'}).waitFor({state:'attached'});await nativeTarget.locator('#layer-list [data-layer="target"] .layer-select').click();await nativeTarget.locator('#canvas').focus();await nativeTarget.keyboard.press('ControlOrMeta+v');await nativeTarget.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===5);
 const response=nativeTarget.waitForResponse(r=>r.url().endsWith('/api/save'));await nativeTarget.locator('#save').click();assert.equal((await response).status(),200);const pasted=await nativeTarget.evaluate(()=>fetch('/api/latest').then(r=>r.json()));assertScaledCopy(pasted.paths.at(-1),source.initial.paths[0],.25);assert.deepEqual(pasted.layers.find(l=>l.id==='target').pathIds,[pasted.paths.at(-1).id]);assert.deepEqual([...source.errors,...target.errors],[]);
});

test('uncalibrated nonempty target can cancel or calibrate a queued cross-page paste into its chosen layer',async t=>{
 const source=await setup(t,{denyClipboard:true,mmPerPx:.5}),target=await setup(t,{denyClipboard:true,calibration:false,registryPath:source.registryPath});
 await source.curveRow('曲线甲').click();await source.page.locator('#copy-curves').click();await source.page.locator('#status').filter({hasText:'已复制'}).waitFor();await target.layerRow('target').locator('.layer-select').click();
 await target.page.locator('#paste-curves').click();await target.page.locator('#vector-import-pending').waitFor({state:'visible'});assert.deepEqual((await target.save()).paths,target.initial.paths);await target.page.locator('#calibration-cancel').click();assert.equal(await target.page.locator('#vector-import-pending').isVisible(),false);assert.deepEqual((await target.save()).paths,target.initial.paths);
 await target.page.locator('#paste-curves').click();await target.page.locator('#vector-import-pending').waitFor({state:'visible'});await target.clickPoint(0,0);await target.clickPoint(100,0);await target.page.locator('#calibration-length').fill('200');await target.page.locator('#calibration-unit').selectOption('mm');await target.page.locator('#calibration-apply').click();await target.curveRow('曲线甲 · 副本').waitFor({state:'attached'});
 const pasted=await target.save();assert.ok(Math.abs(G.millimetersPerPixel(pasted.calibration)-2)<1e-9);assertScaledCopy(pasted.paths.at(-1),source.initial.paths[0],.25);assert.deepEqual(pasted.layers.find(l=>l.id==='target').pathIds,[pasted.paths.at(-1).id]);assert.deepEqual([...source.errors,...target.errors],[]);
});

test('Escape New and undo discard queued cross-page paste without later resurrection',async t=>{
 const source=await setup(t,{denyClipboard:true,mmPerPx:.5}),target=await setup(t,{denyClipboard:true,calibration:false,registryPath:source.registryPath}),undoTarget=await setup(t,{denyClipboard:true,calibration:false,registryPath:source.registryPath});
 await source.curveRow('曲线甲').click();await source.page.locator('#copy-curves').click();await source.page.locator('#status').filter({hasText:'已复制'}).waitFor();await target.layerRow('target').locator('.layer-select').click();
 await target.page.locator('#paste-curves').click();await target.page.locator('#vector-import-pending').waitFor({state:'visible'});await target.page.locator('#canvas').focus();await target.page.keyboard.press('Escape');assert.equal(await target.page.locator('#vector-import-pending').isVisible(),false);assert.deepEqual((await target.save()).paths,target.initial.paths);
 await target.page.locator('#paste-curves').click();await target.page.locator('#vector-import-pending').waitFor({state:'visible'});await target.page.locator('#new').click();assert.equal(await target.page.locator('#vector-import-pending').isVisible(),false);await target.page.locator('#calibrate').click();await target.clickPoint(0,0);await target.clickPoint(100,0);await target.page.locator('#calibration-length').fill('200');await target.page.locator('#calibration-apply').click();assert.equal((await target.save()).paths.length,0);
 await undoTarget.page.locator('[data-tool="select"]').click();await undoTarget.page.evaluate(()=>document.querySelector('.curve-item[data-path="曲线乙"] .curve-select').click());await undoTarget.page.locator('#canvas').focus();await undoTarget.page.keyboard.press('ArrowRight');await undoTarget.layerRow('target').locator('.layer-select').click();await undoTarget.page.locator('#paste-curves').click();await undoTarget.page.locator('#vector-import-pending').waitFor({state:'visible'});await undoTarget.page.locator('#undo').click();assert.equal(await undoTarget.page.locator('#vector-import-pending').isVisible(),false);assert.deepEqual((await undoTarget.save()).paths,undoTarget.initial.paths);
 await undoTarget.page.locator('#calibrate').click();await undoTarget.clickPoint(0,0);await undoTarget.clickPoint(100,0);await undoTarget.page.locator('#calibration-length').fill('200');await undoTarget.page.locator('#calibration-apply').click();assert.deepEqual((await undoTarget.save()).paths,undoTarget.initial.paths);assert.deepEqual([...source.errors,...target.errors,...undoTarget.errors],[]);
});

test('blank target adopts copied calibration while uncalibrated source is cross-page rejected but same-page permitted',async t=>{
 const source=await setup(t,{denyClipboard:true,mmPerPx:.5}),blank=await setup(t,{denyClipboard:true,calibration:false,blank:true,registryPath:source.registryPath});await source.curveRow('曲线甲').click();await source.page.locator('#copy-curves').click();await source.page.locator('#status').filter({hasText:'已复制'}).waitFor();await blank.page.locator('#paste-curves').click();await blank.curveRow('曲线甲 · 副本').waitFor({state:'attached'});const adopted=await blank.save();assert.equal(G.millimetersPerPixel(adopted.calibration),.5);assertCopy(adopted.paths[0],source.initial.paths[0]);await blank.page.locator('#undo').click();let undone=await blank.save();assert.equal(undone.paths.length,0);assert.equal(undone.calibration,null);await blank.page.locator('#redo').click();assert.deepEqual((await blank.save()).paths,adopted.paths);
 const unscaled=await setup(t,{denyClipboard:true,calibration:false,registryPath:source.registryPath}),scaled=await setup(t,{denyClipboard:true,mmPerPx:2,registryPath:source.registryPath});await unscaled.curveRow('曲线甲').click();await unscaled.page.locator('#copy-curves').click();await unscaled.page.locator('#status').filter({hasText:'已复制'}).waitFor();const before=await scaled.save(),undo=await scaled.page.locator('#undo').getAttribute('title');await scaled.layerRow('target').locator('.layer-select').click();await scaled.page.locator('#paste-curves').click();await scaled.page.locator('#status').filter({hasText:/来源.*标定|重新.*复制|实际比例/}).waitFor();assert.deepEqual((await scaled.save()).paths,before.paths);assert.equal(await scaled.page.locator('#undo').getAttribute('title'),undo);
 await unscaled.layerRow('target').locator('.layer-select').click();await unscaled.page.locator('#paste-curves').click();await unscaled.curveRow('曲线甲 · 副本').waitFor({state:'attached'});const local=await unscaled.save();assertCopy(local.paths.at(-1),unscaled.initial.paths[0]);assert.equal(local.calibration,null);assert.deepEqual([...source.errors,...blank.errors,...unscaled.errors,...scaled.errors],[]);
});

test('legacy v1 clipboard is refused by the UI with recopy guidance and no history mutation',async t=>{
 const {page,initial,errors,layerRow,save}=await setup(t),before=await save(),undo=await page.locator('#undo').getAttribute('title');await layerRow('target').locator('.layer-select').click();
 await page.evaluate(payload=>{const data=new DataTransfer(),text=JSON.stringify(payload);data.setData('application/x-curve-editor-curves',text);data.setData('text/plain',text);document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},{format:'curve-editor-clipboard',version:1,paths:[initial.paths[0]]});
 await page.locator('#status').filter({hasText:/重新复制|旧版/}).waitFor();assert.deepEqual((await save()).paths,before.paths);assert.equal(await page.locator('#undo').getAttribute('title'),undo);assert.deepEqual(errors,[]);
});

test('New and explicit open rotate page identity so an old uncalibrated local copy is no longer pixel-pasted',async t=>{
 const {page,initial,errors,curveRow,save}=await setup(t,{denyClipboard:true,calibration:false});await curveRow('曲线甲').click();await page.locator('#copy-curves').click();await page.locator('#status').filter({hasText:/来源尚未标定/}).waitFor();
 await page.locator('#new').click();await page.locator('#paste-curves').click();await page.locator('#status').filter({hasText:/来源.*标定|重新复制|实际比例/}).waitFor();let current=await save();assert.equal(current.paths.length,0);assert.equal(current.calibration,null);
 const calibrated={...initial,calibration:{a:{x:0,y:0},b:{x:100,y:0},length:200,unit:'mm'},measureUnit:'mm'};await page.locator('#project-file').setInputFiles({name:'已标定目标.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(calibrated))});await page.locator('#status').filter({hasText:'已打开 已标定目标.json'}).waitFor();const before=await save(),undo=await page.locator('#undo').getAttribute('title');await page.locator('#paste-curves').click();await page.locator('#status').filter({hasText:/来源.*标定|重新复制|实际比例/}).waitFor();current=await save();assert.deepEqual(current.paths,before.paths);assert.deepEqual(current.calibration,before.calibration);assert.equal(await page.locator('#undo').getAttribute('title'),undo);assert.deepEqual(errors,[]);
});

test('newer successful local copy wins over an older shared read by copiedAt',async t=>{
 const {page,initial,errors,curveRow,layerRow,save}=await setup(t,{denyClipboard:true});
 const captureCopy=async name=>{const request=page.waitForRequest(r=>r.url().endsWith('/api/curve-clipboard')&&r.postDataJSON().action==='write');await curveRow(name).click();await page.locator('#copy-curves').click();const payload=(await request).postDataJSON().clipboard;await page.locator('#status').filter({hasText:'可跨页面粘贴'}).waitFor();return payload;};
 const oldA=await captureCopy('曲线甲'),newB=await captureCopy('曲线乙');assert.ok(newB.copiedAt>oldA.copiedAt);
 await page.route('**/api/curve-clipboard',route=>route.request().postDataJSON().action==='read'?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(oldA)}):route.continue());await layerRow('target').locator('.layer-select').click();await page.locator('#paste-curves').click();await curveRow('曲线乙 · 副本').waitFor({state:'attached'});const pasted=await save();assert.equal(pasted.paths.some(p=>p.name==='曲线甲 · 副本'),false);assertCopy(pasted.paths.at(-1),initial.paths[1]);assert.deepEqual(errors,[]);
});

test('menus and toolbar paste the latest copy across different ports without system clipboard access',async t=>{
 const source=await setup(t,{denyClipboard:true});
 const target=await setup(t,{denyClipboard:true,registryPath:source.registryPath});
 assert.notEqual(source.url,target.url);
 await source.curveRow('曲线甲').click();await source.page.locator('#copy-curves').click();
 await source.page.locator('#status').filter({hasText:'已复制'}).waitFor();
 await target.layerRow('target').locator('.layer-select').click({button:'right'});
 await target.page.getByRole('menuitem',{name:'粘贴元素',exact:true}).click();
 await target.curveRow('曲线甲 · 副本').waitFor({state:'attached',timeout:3000});
 let pasted=await target.save();assertCopy(pasted.paths[4],source.initial.paths[0]);
 assert.deepEqual(pasted.layers.find(l=>l.id==='target').pathIds,[pasted.paths[4].id]);
 await target.page.locator('#undo').click();assert.deepEqual((await target.save()).paths,target.initial.paths);
 await target.page.locator('#redo').click();assert.deepEqual((await target.save()).paths,pasted.paths);
 // A previous local copy must not override a newer copy in another editor.
 await target.curveRow('曲线甲').filter({hasNotText:'副本'}).click();await target.page.locator('#copy-curves').click();
 await target.page.locator('#status').filter({hasText:'已复制'}).waitFor();
 await source.curveRow('曲线乙').click();await source.page.keyboard.press('ControlOrMeta+c');
 await source.page.locator('#status').filter({hasText:'已复制'}).waitFor();
 await target.layerRow('target').locator('.layer-select').click();await target.page.locator('#paste-curves').click();
 await target.curveRow('曲线乙 · 副本').waitFor({state:'attached',timeout:3000});
 pasted=await target.save();assertCopy(pasted.paths[5],source.initial.paths[1]);
 assert.deepEqual((await source.save()).paths,source.initial.paths);
 assert.equal(await source.page.evaluate(()=>window.clipboardReadCalls),0);
 assert.equal(await target.page.evaluate(()=>window.clipboardReadCalls),0);
 assert.deepEqual([...source.errors,...target.errors],[]);
});

test('shared paste recovers after a failed local publication without replacing the newer local copy with old shared data',async t=>{
 const source=await setup(t,{denyClipboard:true}),target=await setup(t,{denyClipboard:true,registryPath:source.registryPath});
 const sourceCopy=async()=>{
  const response=source.page.waitForResponse(r=>r.url().endsWith('/api/curve-clipboard')&&r.request().postDataJSON().action==='write');
  await source.curveRow('曲线乙').click();await source.page.locator('#copy-curves').click();await response;
  await source.page.locator('#status').filter({hasText:'可跨页面粘贴'}).waitFor();
 };
 await sourceCopy();
 await target.page.route('**/api/curve-clipboard',route=>route.request().postDataJSON().action==='write'?route.fulfill({status:503,body:'{}'}):route.continue());
 await target.curveRow('曲线甲').click();await target.page.locator('#copy-curves').click();
 await target.page.locator('#status').filter({hasText:'当前页面'}).waitFor();
 await target.layerRow('target').locator('.layer-select').click();await target.page.locator('#paste-curves').click();
 await target.curveRow('曲线甲 · 副本').waitFor({state:'attached'});
 await sourceCopy();
 await target.page.locator('#paste-curves').click();
 await target.curveRow('曲线乙 · 副本').waitFor({state:'attached',timeout:3000});
 const pasted=await target.save();assertCopy(pasted.paths[4],target.initial.paths[0]);assertCopy(pasted.paths[5],source.initial.paths[1]);
 assert.equal(await target.page.evaluate(()=>window.clipboardReadCalls),0);assert.deepEqual(target.errors,[]);
});

test('an in-flight shared paste cannot change a newly opened blank document',async t=>{
 const {page,curveRow,save,errors}=await setup(t,{denyClipboard:true});
 await curveRow('曲线甲').click();await page.locator('#copy-curves').click();await page.locator('#status').filter({hasText:'可跨页面粘贴'}).waitFor();
 let release,started;const blocked=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 await page.route('**/api/curve-clipboard',async route=>{started();await gate;await route.continue();});
 await page.locator('#paste-curves').click();await blocked;
 await page.locator('#new').click();const before=await save();assert.equal(before.paths.length,0);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/curve-clipboard'));release();await response;
 assert.deepEqual((await save()).paths,[]);assert.deepEqual(errors,[]);
});

test('native copy and paste place multiple independent curves at the remembered canvas pointer in the chosen layer with one undo step',async t=>{
 const {page,initial,errors,curveRow,layerRow,save,selectedIds}=await setup(t);
 await curveRow('曲线甲').click();await curveRow('曲线乙').click({modifiers:['Shift']});
 await page.keyboard.press('ControlOrMeta+c');
 assert.equal(await page.locator('#undo').isDisabled(),true);
 await layerRow('target').locator('.layer-select').click();await page.keyboard.press('ControlOrMeta+v');
 await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===6);
 const pasted=await save(),copies=pasted.paths.slice(4);
 copies.forEach((copy,i)=>assertCopy(copy,initial.paths[i]));assert.notEqual(copies[0].color,copies[1].color);assert.deepEqual(pasted.paths.slice(0,4),initial.paths);
 assert.deepEqual(pasted.layers.find(l=>l.id==='target').pathIds,copies.map(p=>p.id));assert.deepEqual(await selectedIds(),copies.map(p=>p.id));
 assert.deepEqual(pasted.calibration,initial.calibration);assert.equal(pasted.newNodeMode,initial.newNodeMode);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual((await save()).layers,initial.layers.map(l=>({...l,textIds:[]})));assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,pasted.paths);
 await page.keyboard.press('ArrowRight');const moved=await save();assert.deepEqual(moved.paths.slice(0,4),initial.paths);assert.equal(moved.paths[4].nodes[1].in.x,copies[0].nodes[1].in.x+1);
 await page.reload();await expandLayerContents(page);await curveRow('曲线甲 · 副本').waitFor({state:'attached'});assert.deepEqual((await save()).paths,moved.paths);assert.deepEqual(errors,[]);
});

test('curve and layer menus copy snapshots and paste even when system clipboard access is denied',async t=>{
 const {page,initial,errors,curveRow,layerRow,save}=await setup(t,{denyClipboard:true});
 await curveRow('曲线甲').click({button:'right'});await page.getByRole('menuitem',{name:'复制曲线',exact:true}).click();
 await page.locator('#path-note').fill('来源后来修改');await page.locator('#canvas').focus();
 await layerRow('target').locator('.layer-select').click({button:'right'});await page.getByRole('menuitem',{name:'粘贴元素',exact:true}).click();
 await curveRow('曲线甲 · 副本').waitFor({state:'attached'});let pasted=await save();assertCopy(pasted.paths[4],initial.paths[0]);
 await page.locator('#paste-curves').click();await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===6);pasted=await save();
 assertCopy(pasted.paths[5],initial.paths[0]);assert.notEqual(pasted.paths[4].id,pasted.paths[5].id);assert.notEqual(pasted.paths[4].color,pasted.paths[5].color);assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>window.clipboardReadCalls),0,'menu and toolbar paste must never request system clipboard access');
});

test('paste without a local curve copy gives shortcut guidance without requesting clipboard access or changing history',async t=>{
 const {page,initial,errors,layerRow,save}=await setup(t,{denyClipboard:true});
 await page.locator('#paste-curves').click();
 await page.locator('#status').filter({hasText:'⌘ / Ctrl + V'}).waitFor();
 assert.equal(await page.evaluate(()=>window.clipboardReadCalls),0);
 assert.match(await page.locator('#status').textContent(),/⌘ \/ Ctrl \+ V/);
 await layerRow('target').locator('.layer-select').click({button:'right'});await page.getByRole('menuitem',{name:'粘贴元素',exact:true}).click();
 await page.locator('#status').filter({hasText:'⌘ / Ctrl + V'}).waitFor();
 assert.equal(await page.evaluate(()=>window.clipboardReadCalls),0);
 assert.match(await page.locator('#status').textContent(),/⌘ \/ Ctrl \+ V/);
 assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

test('copy excludes hidden and locked curves; native paste rejects hidden or locked target layers without changing history',async t=>{
 const {page,initial,errors,layerRow,save}=await setup(t);
 await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();await page.keyboard.press('ControlOrMeta+c');
 await layerRow('locked').locator('.layer-select').click();await page.keyboard.press('ControlOrMeta+v');
 await page.locator('#status').filter({hasText:'隐藏或锁定'}).waitFor();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await layerRow('target').locator('[data-action="visible"]').click();const hidden=await save();await layerRow('target').locator('.layer-select').click();
 await page.keyboard.press('ControlOrMeta+v');await page.locator('#status').filter({hasText:'隐藏或锁定'}).waitFor();assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('#undo').click();assert.deepEqual((await save()).layers,initial.layers.map(l=>({...l,textIds:[]})));assert.equal(await page.locator('#undo').isDisabled(),true);
 await layerRow('target').locator('.layer-select').click();await page.keyboard.press('ControlOrMeta+v');await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===6);
 const pasted=await save();assert.equal(pasted.paths.length,6);pasted.paths.slice(4).forEach((copy,i)=>assertCopy(copy,initial.paths[i]));assert.equal(hidden.layers.find(l=>l.id==='target').visible,false);assert.deepEqual(errors,[]);
});

test('system curve clipboard also works in another editor tab while text fields retain native copy and paste',async t=>{
 const {page,context,url,initial,errors,curveRow,layerRow,save}=await setup(t);
 await curveRow('曲线甲').click();await page.locator('#copy-curves').click();await page.locator('#status').filter({hasText:'已复制'}).waitFor();
 const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));await other.goto(url+'?client=clipboard-other');await expandLayerContents(other);await other.locator('#layer-list .layer-contents .curve-select').filter({hasText:'曲线甲'}).waitFor({state:'attached'});
 await other.locator('#layer-list [data-layer="target"] .layer-select').click();await other.keyboard.press('ControlOrMeta+v');
 await other.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===5);
 const result=await other.evaluate(async()=>{document.getElementById('save').click();while(document.getElementById('save').disabled)await new Promise(r=>setTimeout(r,20));return fetch('/api/latest').then(r=>r.json());});assertCopy(result.paths[4],initial.paths[0]);
 await page.bringToFront();await page.locator('#path-note').fill('普通文字');await page.locator('#path-note').focus();await page.keyboard.press('ControlOrMeta+a');await page.keyboard.press('ControlOrMeta+c');
 await layerRow('target').locator('.layer-select').click();await page.keyboard.press('ControlOrMeta+v');assert.deepEqual((await save()).paths.map(p=>p.id),initial.paths.map(p=>p.id));
 await curveRow('曲线甲').click();await page.locator('#path-note').focus();await page.keyboard.press('ControlOrMeta+a');await page.keyboard.press('ControlOrMeta+v');assert.equal(await page.locator('#path-note').inputValue(),'普通文字');assert.deepEqual(errors,[]);
});

test('selected page name and drawing ID copy as text even when a curve is selected',async t=>{
 const {page,curveRow,errors}=await setup(t);
 await curveRow('曲线甲').click();
 for(const selector of ['#editor-label','#editor-id']){
  await page.locator(selector).evaluate(el=>{
   const range=document.createRange();range.selectNodeContents(el);
   const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  const expected=await page.locator(selector).textContent();assert.ok(expected.trim());
  await page.keyboard.press('ControlOrMeta+c');
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),expected);
 }
 // Removing the text selection must leave ordinary canvas copying available.
 await page.evaluate(()=>window.getSelection().removeAllRanges());
 await page.locator('#canvas').focus();await page.keyboard.press('ControlOrMeta+c');
 const copied=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
 assert.equal(copied.format,'curve-editor-clipboard');assert.equal(copied.paths[0].id,'曲线甲');
 assert.deepEqual(errors,[]);
});

test('curve count limits and malformed curve clipboard fail atomically without history entries',async t=>{
 const {page,initial,errors,curveRow,layerRow,save}=await setup(t,{pathCount:500});
 await curveRow('曲线甲').click();await page.keyboard.press('ControlOrMeta+c');await layerRow('target').locator('.layer-select').click();await page.keyboard.press('ControlOrMeta+v');
 await page.locator('#status').filter({hasText:'500'}).waitFor();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 const invalid={format:'curve-editor-clipboard',version:1,paths:[{...initial.paths[0],nodes:[{...initial.paths[0].nodes[0],x:1e8}]}]};
 await page.evaluate(text=>navigator.clipboard.writeText(text),JSON.stringify(invalid));await page.locator('#canvas').focus();await page.keyboard.press('ControlOrMeta+v');
 await page.locator('#status').filter({hasText:'粘贴失败'}).waitFor();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

async function aimPaste(page,xFraction=.7,yFraction=.65){
 const b=await page.locator('#canvas').boundingBox(),screen={x:Math.round(b.x+b.width*xFraction),y:Math.round(b.y+b.height*yFraction)};
 await page.mouse.move(screen.x,screen.y);
 const point=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM().inverse());return {x:q.x,y:q.y};},screen);
 return {screen,point};
}
async function boundsInBrowser(page,d,paths,images,texts){return page.evaluate(({d,paths,images,texts})=>window.CurveLayers.bounds(d,paths,images,texts),{d,paths,images,texts});}
function assertTopLeft(box,point){assert.ok(Math.abs(box.x-point.x)<1e-3,`left ${box.x} != ${point.x}`);assert.ok(Math.abs(box.y-point.y)<1e-3,`top ${box.y} != ${point.y}`);}

test('mixed elements paste at captured pointer across ports with scale order bindings undo and recovery',async t=>{
 const source=await setup(t,{mixed:true,denyClipboard:true}),target=await setup(t,{mmPerPx:2,denyClipboard:true,registryPath:source.registryPath});
 await source.page.locator('[data-tool="select"]').click();await source.page.locator('#select-all').click();
 assert.equal(await source.page.locator('#selection-count').textContent(),'已选 6 个元素');
 await source.page.locator('#copy-curves').click();await source.page.locator('#status').filter({hasText:'已复制 6 个元素'}).waitFor();
 const payload=await source.page.evaluate(()=>fetch('/api/curve-clipboard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read'})}).then(r=>r.json()));
 assert.equal(payload.images.length,1);assert.equal(payload.texts.length,3);assert.equal(payload.paths.length,2);
 await target.layerRow('target').locator('.layer-select').click();await target.page.locator('#zoom-in').click();
 const canvas=await target.page.locator('#canvas').boundingBox();await target.page.mouse.move(canvas.x+100,canvas.y+100);await target.page.mouse.down({button:'middle'});await target.page.mouse.move(canvas.x+145,canvas.y+120);await target.page.mouse.up({button:'middle'});
 const {point}=await aimPaste(target.page);await target.page.locator('#paste-curves').click();
 await target.page.locator('#status').filter({hasText:'已粘贴 6 个元素'}).waitFor();const d=await target.save(),layer=d.layers.find(l=>l.id==='target');
 assertTopLeft(await boundsInBrowser(target.page,d,layer.pathIds,layer.imageIds,layer.textIds),point);
 assert.deepEqual(d.paths.slice(0,4),target.initial.paths);assert.equal(d.images[0].width,60);assert.equal(d.images[0].height,40);assert.equal(d.images[0].rotation,30);assert.equal(d.images[0].opacity,.65);
 assert.deepEqual(layer.items.map(i=>i.type),payload.items.map(i=>i.type));
 const marker=d.texts.find(t=>t.positionMarker),dimension=d.texts.find(t=>t.dimension);
 assert.equal(marker.positionMarker.pathId,layer.pathIds[0]);assert.equal(dimension.dimension.bindings.a.pathId,layer.pathIds[0]);assert.equal(dimension.content,'100.00 mm');
 for(let i=0;i<2;i++)assertScaledCopy(d.paths[4+i],source.initial.paths[i],.5);
 await target.page.locator('#undo').click();let undone=await target.save();assert.equal(undone.images.length,0);assert.equal(undone.texts.length,0);assert.deepEqual(undone.paths,target.initial.paths);
 await target.page.locator('#redo').click();assert.deepEqual((await target.save()).texts,d.texts);
 await target.page.reload();assert.deepEqual((await target.save()).images,d.images);assert.deepEqual((await target.save()).texts,d.texts);assert.deepEqual([...source.errors,...target.errors],[]);
});

test('image-only and text-only keyboard paste align rotated bounds and standalone markers cannot bind the original curve',async t=>{
 const {page,save,errors}=await setup(t,{mixed:true});
 for(const [type,id,key] of [['image','photo','images'],['text','label','texts'],['text','marker','texts']]){
  await page.locator(`#layer-list [data-${type}="${id}"]`).click();assert.equal(await page.locator('#copy-curves').isDisabled(),false);
  await page.keyboard.press('ControlOrMeta+c');const before=await save(),{point}=await aimPaste(page,.65,.75);
  await page.locator('#canvas').focus();await page.keyboard.press('ControlOrMeta+v');await page.locator('#status').filter({hasText:'已粘贴 1 个元素'}).waitFor();
  const d=await save(),added=d[key].at(-1);assert.equal(d[key].length,before[key].length+1);
  assertTopLeft(await boundsInBrowser(page,d,[],type==='image'?[added.id]:[],type==='text'?[added.id]:[]),point);
  if(id==='marker'){assert.notEqual(added.positionMarker.pathId,'曲线甲');assert.equal(added.positionMarker.attachment,undefined);}
 }
 assert.deepEqual(errors,[]);
});

test('shared paste captures the pointer before an async read while canvas context menu uses its opening point',async t=>{
 const {page,curveRow,save,errors}=await setup(t,{denyClipboard:true});
 await curveRow('曲线甲').click();await page.locator('#copy-curves').click();await page.locator('#status').filter({hasText:'可跨页面粘贴'}).waitFor();
 let release,started;const gate=new Promise(r=>release=r),blocked=new Promise(r=>started=r);
 await page.route('**/api/curve-clipboard',async route=>{started();await gate;await route.continue();});
 const first=await aimPaste(page,.6,.6);await page.locator('#paste-curves').click();await blocked;
 await aimPaste(page,.8,.8);release();await page.locator('#status').filter({hasText:'已粘贴 1 个元素'}).waitFor();
 let d=await save();assertTopLeft(await boundsInBrowser(page,d,[d.paths.at(-1).id],[],[]),first.point);
 await page.unroute('**/api/curve-clipboard');
 const second=await aimPaste(page,.55,.45);await page.mouse.click(second.screen.x,second.screen.y,{button:'right'});await page.getByRole('menuitem',{name:'粘贴元素',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===6);
 d=await save();assertTopLeft(await boundsInBrowser(page,d,[d.paths.at(-1).id],[],[]),second.point);assert.deepEqual(errors,[]);
});

test('native v3 clipboard rejects item flags unsupported by shared clipboard without history mutation',async t=>{
 const {page,initial,save}=await setup(t);
 const payload={format:'curve-editor-clipboard',version:3,sourcePageId:'other',calibration:initial.calibration,paths:[initial.paths[0]],images:[],texts:[],items:[{type:'path',id:'曲线甲',visible:false}]};
 await page.evaluate(payload=>{const data=new DataTransfer();data.setData('text/plain',JSON.stringify(payload));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},payload);
 assert.match(await page.locator('#status').textContent(),/粘贴失败/);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
});
