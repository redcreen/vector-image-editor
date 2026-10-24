const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm,stat}=require('node:fs/promises');const {tmpdir}=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const {fixtureOptions}=require('./fixture_helpers.cjs');
const sourceAI=path.resolve('tmp/1  2  号羊.ai');
const simpleAI=Buffer.from('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator\n%%EndComments\n%%EndSetup\n0 0 m 72 0 L 72 36 L 0 36 L s\n%%Trailer\n%%EOF\n');
const unitlessDXF=Buffer.from('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1\n21\n2\n0\nENDSEC\n0\nEOF\n');
async function setup(t,{calibration=true,targetMmPerPx=1,curved=false,circle16=false,withText=false,blank=false}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-vector-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,x)=>({id,name:id,role:'outline',color:'#163d58',closed:true,note:'',nodes:[G.node(x,0),G.node(x+40,0),G.node(x+40,30),G.node(x,30)]});
 const belly=curve('belly',0);belly.nodes[0].out={x:12,y:0};belly.nodes[1].in={x:28,y:0};belly.nodes[1].out={x:40,y:9};belly.nodes[2].in={x:40,y:21};belly.nodes[2].out={x:28,y:30};belly.nodes[3].in={x:12,y:30};belly.nodes[3].out={x:0,y:21};belly.nodes[0].in={x:0,y:9};belly.nodes.forEach(n=>n.mode='smooth');
 if(curved)belly.nodes[0].out.y=12;
 const circleNodes=Array.from({length:16},(_,i)=>{const angle=2*Math.PI*i/16,p=G.node(50+30*Math.cos(angle),50+30*Math.sin(angle)),handle=4/3*Math.tan(Math.PI/32)*30,tx=-Math.sin(angle),ty=Math.cos(angle);p.in={x:p.x-tx*handle,y:p.y-ty*handle};p.out={x:p.x+tx*handle,y:p.y+ty*handle};p.mode='smooth';return p;});
 const circle={id:'circle16',name:'16节点圆',role:'outline',color:'#163d58',closed:true,note:'',nodes:circleNodes};
 const paths=blank?[]:circle16?[circle]:[belly,curve('outside',100),curve('hidden',180)],layers=blank?[{id:'blank-layer',name:'空白图层',visible:true,locked:false,pathIds:[],imageIds:[]}]:circle16?[{id:'circle-layer',name:'16节点圆',visible:true,locked:false,pathIds:['circle16'],imageIds:[]}]:[{id:'group',kind:'group',name:'肚子组',visible:true,locked:false,pathIds:[],imageIds:[]},{id:'belly-layer',parentId:'group',name:'肚子片',visible:true,locked:true,pathIds:['belly'],imageIds:[]},{id:'outside-layer',name:'其他',visible:true,locked:false,pathIds:['outside'],imageIds:[]},{id:'hidden-layer',name:'隐藏原稿',visible:false,locked:false,pathIds:['hidden'],imageIds:[]}];
 const initial={format:'daban-curve-editor',version:1,title:'导出测试',width:200,height:100,units:'image-px',image:null,images:[],texts:[],originals:[],paths,layers,calibration:calibration?{a:{x:0,y:0},b:{x:1,y:0},length:targetMmPerPx,unit:'mm'}:null};
 if(withText){
  initial.texts.push({id:'label',name:'裁片名称',content:withText===true?'羊 A08\n左片':withText,x:10,y:45,fontSize:12,color:'#123456',rotation:20});
  initial.layers.push({id:'text-layer',name:'文字标注',visible:true,locked:false,pathIds:[],imageIds:[],textIds:['label']});
 }
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'initial.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'initial.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 const save=async()=>{const wait=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await wait).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const open=async(name,buffer)=>{await page.locator('#project-file').setInputFiles({name,mimeType:'application/octet-stream',buffer});};
 const importVector=async(name,buffer)=>{await page.locator('#vector-file').setInputFiles({name,mimeType:'application/octet-stream',buffer});};
 const clickPoint=async(x,y)=>{const p=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});await page.mouse.click(p.x,p.y);};
 return {page,errors,save,open,importVector,clickPoint,initial,url};
}
async function exportFile(page,format,scope='all',dxfMode=null){
 await page.locator('#export').click();await page.locator('#vector-export-format').selectOption(format);await page.locator('#vector-export-scope').selectOption(scope);
 await waitForPreview(page,format);
 if(dxfMode!==null)await page.locator('#vector-export-dxf-mode').selectOption(dxfMode);
 const wait=page.waitForEvent('download');await page.locator('#vector-export-confirm').click();const file=await wait;return {name:file.suggestedFilename(),data:await readFile(await file.path())};
}
test('PLT file picker and drop import editable calibrated paths and preserve canvas on failure',fixtureOptions('vector-plt/large-horn.plt'),async t=>{
 const {page,errors,open,save}=await setup(t);page.on('dialog',d=>d.accept());
 const horn=await readFile(path.join(__dirname,'fixtures/vector-plt/large-horn.plt'));
 assert.match(await page.locator('#project-file').getAttribute('accept'),/\.plt/);
 await open('大羊角.PLT',horn);await page.locator('#status').filter({hasText:'已打开 大羊角.PLT'}).waitFor();
 const doc=await save();assert.equal(doc.paths.length,1);assert.equal(doc.paths[0].nodes.length,128);assert.equal(doc.paths[0].closed,true);assert.equal(G.millimetersPerPixel(doc.calibration),1);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 assert.deepEqual((await save()).paths,doc.paths);
 await open('unsupported.plt',Buffer.from('IN;SP1;PU0,0;PD40,40;CI10;'));
 await page.locator('#status').filter({hasText:/打开失败.*CI/}).waitFor();assert.deepEqual((await save()).paths,doc.paths);
 await page.evaluate(()=>{
  const canvas=document.querySelector('#canvas'),box=canvas.getBoundingClientRect(),client={x:box.left+box.width*.7,y:box.top+box.height*.35};
  const dataTransfer=new DataTransfer();dataTransfer.items.add(new File(['IN;SP1;PU0,0;PD400,0,400,200;'],'drop.plt',{type:'application/octet-stream'}));
  canvas.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer,clientX:client.x,clientY:client.y}));
 });
 await page.locator('#status').filter({hasText:'已导入 drop.plt'}).waitFor();
 const dropped=await save(),added=dropped.paths.at(-1),bounds=G.pathBounds(added);assert.equal(dropped.paths.length,2);assert.deepEqual(dropped.paths[0],doc.paths[0]);assert.equal(added.nodes.length,3);assert.equal(bounds.width,10);assert.equal(bounds.height,5);assert.deepEqual(errors,[]);
});
test('vector picker appends at target scale with fresh identities and restores both imports through history and reload',fixtureOptions('vector-plt/large-horn.plt'),async t=>{
 const {page,errors,save,importVector}=await setup(t,{targetMmPerPx:.5,withText:true}),horn=await readFile(path.join(__dirname,'fixtures/vector-plt/large-horn.plt'));
 assert.match(await page.locator('#vector-file').getAttribute('accept'),/\.ai/);assert.match(await page.locator('#vector-file').getAttribute('accept'),/\.dxf/);assert.match(await page.locator('#vector-file').getAttribute('accept'),/\.plt/);assert.equal(await page.locator('#import-vector').isVisible(),true);
 const before=await save(),drawingId=await page.locator('#editor-id').textContent(),existingPathIds=before.paths.map(p=>p.id),existingLayerIds=before.layers.map(l=>l.id);
 await importVector('第一次.plt',horn);await page.locator('#status').filter({hasText:'已导入 第一次.plt'}).waitFor();let once=await save();
 assert.equal(await page.locator('#editor-id').textContent(),drawingId);assert.equal(once.title,before.title);assert.deepEqual(once.texts,before.texts);assert.deepEqual(once.paths.slice(0,before.paths.length),before.paths);assert.deepEqual(once.layers.filter(l=>existingLayerIds.includes(l.id)),before.layers);
 const firstPaths=once.paths.filter(p=>!existingPathIds.includes(p.id)),firstLayers=once.layers.filter(l=>!existingLayerIds.includes(l.id)),firstBounds=G.pathBounds(firstPaths[0]);assert.equal(firstPaths.length,1);assert.equal(firstLayers.length,1);assert.ok(Math.abs(firstBounds.width*.5-189.6)<1e-7);assert.ok(Math.abs(firstBounds.height*.5-98.135)<1e-7);assert.equal(await page.locator(`.curve-item[data-path="${firstPaths[0].id}"]`).getAttribute('aria-pressed'),'true');
 const center=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM()),r=document.querySelector('#canvas').getBoundingClientRect();return {dx:q.x-(r.left+r.width/2),dy:q.y-(r.top+r.height/2)};},{x:firstBounds.x+firstBounds.width/2,y:firstBounds.y+firstBounds.height/2});assert.ok(Math.abs(center.dx)<1);assert.ok(Math.abs(center.dy)<1);
 await importVector('第二次.plt',horn);await page.locator('#status').filter({hasText:'已导入 第二次.plt'}).waitFor();const twice=await save(),allIds=[...twice.paths.map(p=>p.id),...twice.layers.map(l=>l.id)];assert.equal(new Set(allIds).size,allIds.length);assert.equal(twice.paths.length,before.paths.length+2);assert.equal(twice.layers.length,before.layers.length+2);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,once.paths);await page.locator('#redo').click();assert.deepEqual((await save()).paths,twice.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});const restored=await save();assert.deepEqual(restored.paths,twice.paths);assert.deepEqual(restored.layers,twice.layers);assert.equal(await page.locator('#editor-id').textContent(),drawingId);assert.deepEqual(errors,[]);
});
test('uncalibrated artwork queues vector import until two-point calibration is applied',fixtureOptions('vector-plt/large-horn.plt'),async t=>{
 const {page,errors,save,importVector,clickPoint}=await setup(t,{calibration:false,withText:true}),horn=await readFile(path.join(__dirname,'fixtures/vector-plt/large-horn.plt')),before=await save();
 await importVector('待标定.plt',horn);await page.locator('#vector-import-pending').waitFor({state:'visible'});assert.equal(await page.locator('#calibrate').getAttribute('aria-pressed'),'true');assert.deepEqual((await save()).paths,before.paths);assert.deepEqual((await save()).texts,before.texts);
 await clickPoint(0,0);await clickPoint(100,0);await page.locator('#calibration-length').fill('50');await page.locator('#calibration-unit').selectOption('mm');await page.locator('#calibration-apply').click();await page.locator('#status').filter({hasText:'已导入 待标定.plt'}).waitFor();
 const after=await save(),added=after.paths.at(-1),bounds=G.pathBounds(added);assert.equal(after.paths.length,before.paths.length+1);assert.deepEqual(after.paths.slice(0,before.paths.length),before.paths);assert.deepEqual(after.texts,before.texts);assert.equal(G.millimetersPerPixel(after.calibration),.5);assert.ok(Math.abs(bounds.width*.5-189.6)<1e-7);assert.ok(Math.abs(bounds.height*.5-98.135)<1e-7);assert.equal(await page.locator('#vector-import-pending').isVisible(),false);assert.deepEqual(errors,[]);
});
test('pending import reveals collapsed dock and calibration controls before appending normally',fixtureOptions('vector-plt/large-horn.plt'),async t=>{
 const {page,errors,save,importVector,clickPoint}=await setup(t,{calibration:false}),horn=await readFile(path.join(__dirname,'fixtures/vector-plt/large-horn.plt'));
 await page.locator('#toggle-panels').click();assert.equal(await page.locator('#toggle-panels').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#panel-content').isVisible(),false);
 await importVector('折叠侧栏.plt',horn);await page.locator('#status').filter({hasText:/请先完成两点标定/}).waitFor();assert.equal(await page.locator('#toggle-panels').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#panel-content').isVisible(),true);assert.equal(await page.locator('#panel-measurement').getAttribute('open'),'');assert.equal(await page.locator('#vector-import-pending').isVisible(),true);assert.equal(await page.locator('#calibration-editor').isVisible(),true);
 await clickPoint(0,0);await clickPoint(100,0);await page.locator('#calibration-length').fill('100');await page.locator('#calibration-apply').click();await page.locator('#status').filter({hasText:'已导入 折叠侧栏.plt'}).waitFor();const after=await save();assert.equal(after.paths.length,4);assert.equal(G.millimetersPerPixel(after.calibration),1);assert.deepEqual(errors,[]);
});
test('New immediately clears a decoded pending import and later calibration cannot resurrect it',fixtureOptions('vector-plt/large-horn.plt'),async t=>{
 const {page,errors,save,importVector,clickPoint}=await setup(t,{calibration:false}),horn=await readFile(path.join(__dirname,'fixtures/vector-plt/large-horn.plt'));
 await importVector('新建前待导入.plt',horn);await page.locator('#vector-import-pending').waitFor({state:'visible'});await page.locator('#new').click();assert.equal(await page.locator('#vector-import-pending').isVisible(),false);let after=await save();assert.equal(after.paths.length,0);assert.equal(after.calibration,null);
 await page.locator('#calibrate').click();await clickPoint(0,0);await clickPoint(100,0);await page.locator('#calibration-length').fill('100');await page.locator('#calibration-apply').click();after=await save();assert.equal(after.paths.length,0);assert.ok(Math.abs(G.millimetersPerPixel(after.calibration)-1)<1e-6);assert.deepEqual(errors,[]);
});
test('cancel and Escape discard pending uncalibrated imports without later resurrection',fixtureOptions('vector-plt/large-horn.plt'),async t=>{
 const {page,errors,save,importVector,clickPoint}=await setup(t,{calibration:false}),horn=await readFile(path.join(__dirname,'fixtures/vector-plt/large-horn.plt')),before=await save();
 const calibrate=async()=>{await page.locator('#calibrate').click();await clickPoint(0,0);await clickPoint(100,0);await page.locator('#calibration-length').fill('100');await page.locator('#calibration-apply').click();};
 await importVector('取消按钮.plt',horn);await page.locator('#vector-import-pending').waitFor({state:'visible'});await page.locator('#calibration-cancel').click();assert.equal(await page.locator('#vector-import-pending').isVisible(),false);assert.deepEqual((await save()).paths,before.paths);await calibrate();assert.deepEqual((await save()).paths,before.paths);
 await page.locator('#calibration-clear').click();await importVector('Esc取消.plt',horn);await page.locator('#vector-import-pending').waitFor({state:'visible'});await page.locator('#canvas').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('#vector-import-pending').isVisible(),false);assert.deepEqual((await save()).paths,before.paths);await calibrate();assert.deepEqual((await save()).paths,before.paths);assert.deepEqual(errors,[]);
});
test('blank uncalibrated canvas adopts imported scale and undo removes both geometry and calibration',fixtureOptions('vector-plt/large-horn.plt'),async t=>{
 const {page,errors,save,importVector}=await setup(t,{calibration:false,blank:true}),horn=await readFile(path.join(__dirname,'fixtures/vector-plt/large-horn.plt'));
 await importVector('空白导入.plt',horn);await page.locator('#status').filter({hasText:'已导入 空白导入.plt'}).waitFor();const imported=await save();assert.equal(imported.paths.length,1);assert.equal(G.millimetersPerPixel(imported.calibration),1);assert.ok(Math.abs(G.pathBounds(imported.paths[0]).width-189.6)<1e-9);
 await page.locator('#undo').click();let undone=await save();assert.equal(undone.paths.length,0);assert.equal(undone.calibration,null);await page.locator('#redo').click();undone=await save();assert.deepEqual(undone.paths,imported.paths);assert.deepEqual(undone.calibration,imported.calibration);assert.deepEqual(errors,[]);
});
test('failed and stale vector imports cannot alter the current document or history',fixtureOptions('vector-plt/large-horn.plt'),async t=>{
 const {page,errors,save,importVector}=await setup(t),before=await save(),undo=await page.locator('#undo').getAttribute('title');
 await importVector('坏文件.ai',Buffer.from('not an AI'));await page.locator('#status').filter({hasText:'失败'}).waitFor();let after=await save();for(const key of ['paths','texts','layers','calibration'])assert.deepEqual(after[key],before[key]);assert.equal(await page.locator('#undo').getAttribute('title'),undo);
 let release;const gate=new Promise(resolve=>{release=resolve;});await page.route('**/api/vector/import',async route=>{await gate;await route.continue();});await importVector('迟到.plt',await readFile(path.join(__dirname,'fixtures/vector-plt/large-horn.plt')));await page.locator('#status').filter({hasText:/正在读取|正在导入/}).waitFor();await page.locator('#new').click();const response=page.waitForResponse(r=>r.url().endsWith('/api/vector/import'));release();await response;await page.waitForTimeout(100);after=await save();assert.equal(after.paths.length,0);assert.equal(after.calibration,null);assert.deepEqual(errors,[]);
});
test('undo while an uncalibrated import is pending clears it and prevents later append',fixtureOptions('vector-plt/large-horn.plt'),async t=>{
 const {page,errors,save,importVector,clickPoint,initial}=await setup(t,{calibration:false});await page.locator('[data-tool="select"]').click();await page.evaluate(()=>document.querySelector('.curve-item[data-path="outside"] .curve-select').click());await page.locator('#canvas').focus();await page.keyboard.press('ArrowRight');
 await importVector('等待撤销.plt',await readFile(path.join(__dirname,'fixtures/vector-plt/large-horn.plt')));await page.locator('#vector-import-pending').waitFor({state:'visible'});await page.locator('#undo').click();assert.equal(await page.locator('#vector-import-pending').isVisible(),false);assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('#calibrate').click();await clickPoint(0,0);await clickPoint(100,0);await page.locator('#calibration-length').fill('100');await page.locator('#calibration-apply').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
function serializedDxfPointCount(data){
 const lines=data.toString().replace(/\r/g,'').split('\n'),records=[];for(let i=0;i+1<lines.length;i+=2)records.push([lines[i].trim(),lines[i+1].trim()]);
 let entity='',polylineVertexCount=0,splineControlPointCount=0;
 for(const [code,value] of records){
  if(code==='0'){entity=value;if(value==='VERTEX')polylineVertexCount++;continue;}
  if(code==='10'&&entity==='LWPOLYLINE')polylineVertexCount++;
  if(code==='10'&&entity==='SPLINE')splineControlPointCount++;
 }
 return {polylineVertexCount,splineControlPointCount,nodeCount:polylineVertexCount+splineControlPointCount};
}
async function waitForPreview(page,format){await page.locator('#vector-export-file-points').filter({hasText:new RegExp(`^${format.toUpperCase()} `)}).waitFor();await page.locator('#vector-export-confirm:not([disabled])').waitFor();}
const waitForDxfPreview=page=>waitForPreview(page,'dxf');
test('text-only selected layer exports and unsupported glyphs fail visibly without changing artwork',async t=>{
 const {page,errors,save}=await setup(t,{withText:true});
 await page.locator('.layer-row[data-layer="text-layer"] .layer-select').click();
 await page.locator('#export-layers').click();await waitForPreview(page,'ai');
 assert.match(await page.locator('#vector-export-counts').textContent(),/原 0 个 → 导出 \d+ 个.*1 段文字已转曲线/);
 await page.locator('#vector-export-format').selectOption('dxf');await waitForPreview(page,'dxf');
 await page.locator('#vector-export-format').selectOption('svg');await waitForPreview(page,'svg');
 assert.match(await page.locator('#vector-export-counts').textContent(),/原 0 个 → 导出 0 个.*1 段文字/);
 assert.doesNotMatch(await page.locator('#vector-export-counts').textContent(),/已转曲线/);
 await page.locator('#vector-export-cancel').click();
 assert.equal((await save()).texts[0].content,'羊 A08\n左片');assert.deepEqual(errors,[]);
});
test('missing text outlines block AI and DXF downloads with a clear error',async t=>{
 const {page,errors,save}=await setup(t,{withText:'A\u0378B'}),before=await save();
 await page.locator('.layer-row[data-layer="text-layer"] .layer-select').click();
 await page.locator('#export-layers').click();
 for(const format of ['ai','dxf']){
  await page.locator('#vector-export-format').selectOption(format);
  await page.locator('#vector-export-error').filter({hasText:/字形/}).waitFor();
  assert.equal(await page.locator('#vector-export-confirm').isDisabled(),true);
 }
 await page.locator('#vector-export-cancel').click();
 assert.deepEqual((await save()).texts,before.texts);assert.deepEqual(errors,[]);
});
test('multiple selected layers export Chinese multiline rotated text as AI and both DXF modes without editing canvas',async t=>{
 const {page,errors,save,open,initial}=await setup(t,{withText:true});page.on('dialog',d=>d.accept());
 await page.locator('.layer-row[data-layer="group"] .layer-select').click();
 await page.locator('.layer-row[data-layer="text-layer"] .layer-select').click({modifiers:['Shift']});
 const before=await save(),undo=await page.locator('#undo').getAttribute('title'),files=[];
 for(const [format,mode] of [['ai',null],['dxf','spline'],['dxf','polyline']]){
  await page.locator('#export-layers').click();
  await page.locator('#vector-export-format').selectOption(format);
  await waitForPreview(page,format);
  if(mode)await page.locator('#vector-export-dxf-mode').selectOption(mode);
  assert.match(await page.locator('#vector-export-counts').textContent(),/1 段文字已转曲线/);
  assert.match(await page.locator('#vector-export-count-note').textContent(),/文字轮廓/);
  const pending=page.waitForEvent('download');await page.locator('#vector-export-confirm').click();
  const download=await pending;files.push({format,data:await readFile(await download.path())});
 }
 const after=await save();
 for(const key of ['paths','texts','layers','calibration'])assert.deepEqual(after[key],before[key]);
 assert.equal(await page.locator('#undo').getAttribute('title'),undo);
 for(const file of files){
  await open('带文字.'+file.format,file.data);await page.locator('#status').filter({hasText:'已打开 带文字.'+file.format}).waitFor();
  const restored=await save();assert.equal(restored.texts.length,0);assert.equal(restored.layers.length,2);assert.ok(restored.paths.length>5);
  assert.equal(restored.paths.some(p=>p.name==='outside'),false);
  assert.equal(restored.layers.some(l=>l.name.includes('文字标注')),true);
 }
 assert.equal(initial.texts[0].content,'羊 A08\n左片');assert.deepEqual(errors,[]);
});
test('AI is the default export and DXF defaults to the format with fewer actual curve nodes',async t=>{
 const {page,errors}=await setup(t),mode=page.locator('#vector-export-dxf-mode'),hint=page.locator('#vector-export-hint');
 await page.locator('#export').click();assert.equal(await page.locator('#vector-export-format').inputValue(),'ai');assert.equal(await mode.isVisible(),false);assert.equal(await page.locator('#vector-export-confirm').isDisabled(),true);await waitForPreview(page,'ai');assert.match(await page.locator('#vector-export-counts').textContent(),/共 2 条曲线.*曲线节点：原 8 个 → 导出 8 个/);assert.match(await page.locator('#vector-export-file-points').textContent(),/^AI 文件坐标点 \d+ 个（其中控制柄 \d+ 个；含闭合重复点）$/);assert.match(await hint.textContent(),/CorelDRAW \/ Illustrator/);if(process.env.CURVE_EDITOR_VECTOR_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_VECTOR_SCREENSHOT,fullPage:true});
 await page.locator('#vector-export-format').selectOption('svg');await waitForPreview(page,'svg');assert.match(await page.locator('#vector-export-counts').textContent(),/原 8 个 → 导出 8 个/);assert.match(await page.locator('#vector-export-file-points').textContent(),/^SVG 文件坐标点 \d+ 个（其中控制柄 \d+ 个；含闭合重复点）$/);
 await page.locator('#vector-export-format').selectOption('dxf');assert.equal(await mode.isVisible(),true);assert.equal(await mode.isDisabled(),true);assert.equal(await page.locator('#vector-export-confirm').isDisabled(),true);await waitForDxfPreview(page);
 assert.equal(await mode.inputValue(),'spline');assert.deepEqual(await mode.locator('option').allTextContents(),['保留曲线','折线兼容']);assert.match(await hint.textContent(),/软件.*样条|样条.*软件/);
 assert.match(await page.locator('#vector-export-counts').textContent(),/共 2 条曲线.*曲线节点：原 8 个 → 导出 8 个/);assert.match(await page.locator('#vector-export-file-points').textContent(),/^DXF 文件控制点（样条）13 个 · 折线顶点 4 个$/);
 await mode.selectOption('polyline');assert.match(await page.locator('#vector-export-counts').textContent(),/原 8 个 → 导出 8 个/);assert.match(await page.locator('#vector-export-file-points').textContent(),/^DXF 文件控制点（样条）0 个 · 折线顶点 8 个$/);assert.match(await hint.textContent(),/0\.01 mm/);
 await page.locator('#vector-export-format').selectOption('ai');await waitForPreview(page,'ai');assert.equal(await mode.isVisible(),false);assert.match(await page.locator('#vector-export-counts').textContent(),/原 8 个 → 导出 8 个/);await page.locator('#vector-export-format').selectOption('dxf');await waitForDxfPreview(page);assert.equal(await mode.inputValue(),'spline');
 await page.locator('#vector-export-cancel').click();const polyline=await exportFile(page,'dxf','all','polyline'),spline=await exportFile(page,'dxf','all','spline');assert.deepEqual(serializedDxfPointCount(polyline.data),{polylineVertexCount:8,splineControlPointCount:0,nodeCount:8});assert.deepEqual(serializedDxfPointCount(spline.data),{polylineVertexCount:4,splineControlPointCount:13,nodeCount:17});assert.deepEqual(errors,[]);
});
test('curved artwork recommends spline when its actual serialized point count is smaller',async t=>{
 const {page,errors}=await setup(t,{curved:true});await page.locator('#export').click();await page.locator('#vector-export-format').selectOption('dxf');await waitForDxfPreview(page);assert.equal(await page.locator('#vector-export-dxf-mode').inputValue(),'spline');
 const splineText=await page.locator('#vector-export-counts').textContent(),splineCount=Number(splineText.match(/导出 (\d+) 个/)[1]);await page.locator('#vector-export-dxf-mode').selectOption('polyline');const polylineText=await page.locator('#vector-export-counts').textContent(),polylineCount=Number(polylineText.match(/导出 (\d+) 个/)[1]);assert.ok(splineCount<polylineCount,`${splineCount} should be less than ${polylineCount}`);await page.locator('#vector-export-cancel').click();assert.deepEqual(errors,[]);
});
test('16-node circle keeps curve nodes separate from AI handles and DXF control points',async t=>{
 const {page,errors,open,save}=await setup(t,{circle16:true});const before=await page.locator('#paths').innerHTML(),undo=await page.locator('#undo').getAttribute('title');
 await page.locator('#export').click();await waitForPreview(page,'ai');assert.match(await page.locator('#vector-export-counts').textContent(),/共 1 条曲线.*原 16 个 → 导出 16 个/);assert.equal(await page.locator('#vector-export-file-points').textContent(),'AI 文件坐标点 49 个（其中控制柄 32 个；含闭合重复点）');if(process.env.CURVE_EDITOR_VECTOR_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_VECTOR_SCREENSHOT,fullPage:true});
 await page.locator('#vector-export-format').selectOption('dxf');await waitForDxfPreview(page);assert.equal(await page.locator('#vector-export-dxf-mode').inputValue(),'spline');assert.match(await page.locator('#vector-export-counts').textContent(),/原 16 个 → 导出 16 个/);assert.equal(await page.locator('#vector-export-file-points').textContent(),'DXF 文件控制点（样条）49 个 · 折线顶点 0 个');await page.locator('#vector-export-dxf-mode').selectOption('polyline');const polylineNodes=Number((await page.locator('#vector-export-counts').textContent()).match(/导出 (\d+) 个/)[1]);assert.ok(polylineNodes>16);assert.equal(await page.locator('#paths').innerHTML(),before);assert.equal(await page.locator('#undo').getAttribute('title'),undo);await page.locator('#vector-export-cancel').click();
 const ai=await exportFile(page,'ai');await open('16节点圆.ai',ai.data);await page.locator('#status').filter({hasText:'已打开 16节点圆.ai'}).waitFor();const imported=await save();assert.equal(imported.paths.length,1);assert.equal(imported.paths[0].nodes.length,16);assert.deepEqual(errors,[]);
});
test('both DXF modes download from the real server with the requested API field and leave artwork and history unchanged',async t=>{
 const {page,errors}=await setup(t),payloads=[];page.on('request',request=>{if(request.url().endsWith('/api/vector/export'))payloads.push(request.postDataJSON());});
 const before=await page.locator('#paths').innerHTML(),undo=await page.locator('#undo').getAttribute('title');
 await page.locator('#export').click();await page.locator('#vector-export-format').selectOption('dxf');await waitForDxfPreview(page);await page.locator('#vector-export-dxf-mode').selectOption('spline');await page.locator('#vector-export-cancel').click();
 assert.equal(await page.locator('#paths').innerHTML(),before);assert.equal(await page.locator('#undo').getAttribute('title'),undo);
 const polyline=await exportFile(page,'dxf','all','polyline'),spline=await exportFile(page,'dxf','all','spline'),svg=await exportFile(page,'svg');
 assert.match(polyline.data.toString(),/\$INSUNITS/);assert.match(spline.data.toString(),/\nSPLINE\n/);
 assert.match(svg.data.toString(),/^<svg/);assert.deepEqual(payloads.map(p=>[p.format,p.dxfMode]),[['dxf','polyline'],['dxf','spline'],['svg',undefined]]);
 assert.equal(await page.locator('#paths').innerHTML(),before);assert.equal(await page.locator('#undo').getAttribute('title'),undo);assert.deepEqual(errors,[]);
});
test('selected spline DXF roundtrip retains anchors, handles, closure, and physical size',async t=>{
 const {page,errors,open,save,initial}=await setup(t);page.on('dialog',d=>d.accept());
 await page.locator('.layer-row[data-layer="group"] .layer-select').click();const spline=await exportFile(page,'dxf','layers','spline');assert.match(spline.data.toString(),/\nSPLINE\n/);await open('肚子曲线.dxf',spline.data);await page.locator('#status').filter({hasText:'已打开 肚子曲线.dxf'}).waitFor();
 const d=await save(),expected=initial.paths[0];assert.equal(d.paths.length,1);assert.equal(d.paths[0].closed,true);assert.equal(d.paths[0].nodes.length,expected.nodes.length);assert.equal(G.pathBounds(d.paths[0]).width,40);assert.equal(G.pathBounds(d.paths[0]).height,30);assert.equal(G.millimetersPerPixel(d.calibration),1);
 const activeHandles=path=>path.nodes.reduce((count,n)=>count+(['in','out'].filter(side=>Math.hypot(n[side].x-n.x,n[side].y-n.y)>1e-7).length),0);assert.equal(activeHandles(d.paths[0]),activeHandles(expected));assert.ok(activeHandles(d.paths[0])>0);
 for(let i=0;i<expected.nodes.length;i++)for(const key of ['x','y']){assert.ok(Math.abs(d.paths[0].nodes[i][key]-expected.nodes[i][key])<1e-7);assert.ok(Math.abs(d.paths[0].nodes[i].in[key]-expected.nodes[i].in[key])<1e-7);assert.ok(Math.abs(d.paths[0].nodes[i].out[key]-expected.nodes[i].out[key])<1e-7);}
 assert.deepEqual(errors,[]);
});
test('selected group exports only visible locked descendants in mm and opens DXF/AI with editable nodes',async t=>{
 const {page,errors,open,save}=await setup(t);page.on('dialog',d=>d.accept());
 await page.locator('.layer-row[data-layer="group"] .layer-select').click();
 await page.locator('#export-layers').click();assert.equal(await page.locator('#vector-export-scope').inputValue(),'layers');assert.match(await page.locator('#vector-export-size').textContent(),/40\.000 × 高 30\.000 mm/);
 await waitForPreview(page,'ai');assert.match(await page.locator('#vector-export-counts').textContent(),/共 1 条曲线.*原 4 个 → 导出 4 个/);await page.locator('#vector-export-format').selectOption('dxf');await waitForDxfPreview(page);
 await page.locator('#vector-export-dxf-mode').selectOption('polyline');await page.locator('#vector-export-scope').selectOption('all');assert.equal(await page.locator('#vector-export-dxf-mode').isDisabled(),true);await waitForDxfPreview(page);assert.equal(await page.locator('#vector-export-dxf-mode').inputValue(),'spline');assert.match(await page.locator('#vector-export-counts').textContent(),/共 2 条曲线.*原 8 个 → 导出 8 个/);await page.locator('#vector-export-scope').selectOption('layers');await waitForDxfPreview(page);assert.match(await page.locator('#vector-export-counts').textContent(),/共 1 条曲线.*原 4 个 → 导出 4 个/);
 await page.locator('#vector-export-cancel').click();
 const dxf=await exportFile(page,'dxf','layers','spline');assert.match(dxf.name,/\.dxf$/);assert.match(dxf.data.toString(),/\$INSUNITS/);
 await open('肚子.dxf',dxf.data);await page.locator('#status').filter({hasText:'已打开 肚子.dxf'}).waitFor();
 let d=await save();assert.equal(d.paths.length,1);assert.equal(d.paths[0].closed,true);assert.equal(G.pathBounds(d.paths[0]).width,40);assert.equal(G.pathBounds(d.paths[0]).height,30);assert.equal(G.millimetersPerPixel(d.calibration),1);
 const ai=await exportFile(page,'ai');assert.match(ai.data.toString(),/^%!PS-Adobe/);
 await open('肚子.ai',ai.data);await page.locator('#status').filter({hasText:'已打开 肚子.ai'}).waitFor();d=await save();assert.equal(d.paths.length,1);assert.ok(Math.abs(G.pathBounds(d.paths[0]).width-40)<1e-7);
 // Imported nodes and curves remain editable and reversible.
 await page.locator('#select-all').click();await page.locator('#canvas').focus();await page.keyboard.press('ArrowRight');const moved=await save();assert.ok(Math.abs(moved.paths[0].nodes[0].x-d.paths[0].nodes[0].x-1)<1e-7);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,d.paths);assert.deepEqual(errors,[]);
});
test('AI import restores physical scale and failure or dirty-cancel leaves current artwork intact',async t=>{
 const {page,errors,open,save}=await setup(t);
 await open('正方形.ai',simpleAI);await page.locator('#status').filter({hasText:'已打开 正方形.ai'}).waitFor();const d=await save();assert.equal(d.paths.length,1);assert.ok(Math.abs(G.pathBounds(d.paths[0]).width-25.4)<1e-9);
 await page.locator('#select-all').click();await page.locator('#canvas').focus();await page.keyboard.press('ArrowRight');
 const before=await page.locator('#paths .svg-curve').getAttribute('d'),undo=await page.locator('#undo').getAttribute('title');
 await open('坏文件.ai',Buffer.from('not an AI'));await page.locator('#status').filter({hasText:'打开失败'}).waitFor();assert.equal(await page.locator('#paths .svg-curve').getAttribute('d'),before);assert.equal(await page.locator('#undo').getAttribute('title'),undo);
 page.once('dialog',d=>d.dismiss());await open('取消.ai',simpleAI);await page.locator('#status').filter({hasText:'已取消导入'}).waitFor();assert.equal(await page.locator('#paths .svg-curve').getAttribute('d'),before);assert.equal(await page.locator('#undo').getAttribute('title'),undo);assert.deepEqual(errors,[]);
});
test('unknown DXF units require a choice; cancellation preserves artwork and inches convert accurately',async t=>{
 const {page,errors,open,save}=await setup(t);const before=await page.locator('#paths .svg-curve').count();
 await open('无单位.dxf',unitlessDXF);await page.locator('#vector-unit-dialog[open]').waitFor();await page.locator('#vector-unit-cancel').click();assert.equal(await page.locator('#paths .svg-curve').count(),before);
 await open('英寸.dxf',unitlessDXF);await page.locator('#vector-unit-dialog[open]').waitFor();await page.locator('#vector-unit-select').selectOption('in');await page.locator('#vector-unit-confirm').click();await page.locator('#status').filter({hasText:'已打开 英寸.dxf'}).waitFor();const d=await save();assert.equal(G.pathBounds(d.paths[0]).width,25.4);assert.equal(G.pathBounds(d.paths[0]).height,50.8);assert.deepEqual(errors,[]);
});
test('uncalibrated exports are blocked without changing history and point to calibration',async t=>{
 const {page,errors}=await setup(t,{calibration:false});const undo=await page.locator('#undo').getAttribute('title');await page.locator('#export').click();assert.equal(await page.locator('#vector-export-confirm').isDisabled(),true);assert.match(await page.locator('#vector-export-size').textContent(),/比例|标定/);assert.match(await page.locator('#vector-export-counts').textContent(),/共 2 条曲线.*原曲线节点 8 个.*导出后数量暂不可计算/);assert.equal(await page.locator('#vector-export-file-points').textContent(),'');await page.locator('#vector-export-calibrate').click();assert.equal(await page.locator('#vector-export-dialog').isVisible(),false);assert.equal(await page.locator('#calibrate').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#undo').getAttribute('title'),undo);assert.deepEqual(errors,[]);
});
test('vector dialogs keep paste and canvas undo from mutating the work behind them',async t=>{
 const {page,errors,initial,open}=await setup(t);
 await page.locator('.layer-row[data-layer="outside-layer"] .layer-select').click();
 const before=await page.locator('#paths').innerHTML(),undo=await page.locator('#undo').getAttribute('title');
 const paste=async()=>page.evaluate(paths=>{const data=new DataTransfer();data.setData('text/plain',JSON.stringify({format:'curve-editor-clipboard',version:2,calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'},sourcePageId:'fixture',paths}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},[initial.paths[1]]);
 await page.locator('#export').click();await page.locator('#vector-export-cancel').focus();await paste();await page.keyboard.press('Control+z');
 assert.equal(await page.locator('#paths').innerHTML(),before);assert.equal(await page.locator('#undo').getAttribute('title'),undo);await page.locator('#vector-export-cancel').click();
 await open('单位.dxf',unitlessDXF);await page.locator('#vector-unit-dialog[open]').waitFor();await page.locator('#vector-unit-cancel').focus();await paste();
 assert.equal(await page.locator('#paths').innerHTML(),before);assert.equal(await page.locator('#undo').getAttribute('title'),undo);await page.locator('#vector-unit-cancel').click();assert.deepEqual(errors,[]);
});
test('stale previews from a previous scope or dialog open cannot overwrite the current result',async t=>{
 const {page,errors}=await setup(t);let requestNumber=0;
 const stats=(curveCount,nodeCount)=>({sourceNodeCount:nodeCount,curveCount,curveNodeCount:nodeCount,filePointCount:nodeCount,fileHandlePointCount:0,splineControlPointCount:0,polylineVertexCount:0,textCount:0});
 await page.route('**/api/vector/preview',async route=>{const body=route.request().postDataJSON(),number=++requestNumber,selected=Array.isArray(body.layerIds),stale=[1,3].includes(number);if(stale)await new Promise(r=>setTimeout(r,250));const nodeCount=selected?4:(stale?99:8),result=body.format==='dxf'?{modes:{spline:{...stats(selected?1:2,nodeCount),filePointCount:nodeCount+9,splineControlPointCount:nodeCount+9},polyline:{...stats(selected?1:2,nodeCount),polylineVertexCount:nodeCount}},recommendedMode:'spline'}:{stats:stats(selected?1:2,nodeCount)};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});});
 await page.locator('.layer-row[data-layer="group"] .layer-select').click();await page.locator('#export').click();assert.equal(await page.locator('#vector-export-confirm').isDisabled(),true);assert.match(await page.locator('#vector-export-counts').textContent(),/计算/);await page.locator('#vector-export-scope').selectOption('layers');await waitForPreview(page,'ai');assert.match(await page.locator('#vector-export-counts').textContent(),/1 条曲线.*原 4 个 → 导出 4 个/);await new Promise(r=>setTimeout(r,350));assert.match(await page.locator('#vector-export-counts').textContent(),/1 条曲线.*原 4 个 → 导出 4 个/);
 await page.locator('#vector-export-cancel').click();await page.locator('#export').click();assert.match(await page.locator('#vector-export-counts').textContent(),/计算/);await page.locator('#vector-export-cancel').click();await page.locator('#export').click();await waitForPreview(page,'ai');assert.match(await page.locator('#vector-export-counts').textContent(),/2 条曲线.*原 8 个 → 导出 8 个/);await new Promise(r=>setTimeout(r,350));assert.match(await page.locator('#vector-export-counts').textContent(),/原 8 个 → 导出 8 个/);assert.doesNotMatch(await page.locator('#vector-export-counts').textContent(),/99/);await page.locator('#vector-export-cancel').click();assert.deepEqual(errors,[]);
});
test('DXF preview network and per-mode failures block unavailable exports without mutating artwork',async t=>{
 const {page,errors}=await setup(t),before=await page.locator('#paths').innerHTML();
 const polyline={sourceNodeCount:8,curveCount:2,curveNodeCount:8,filePointCount:8,fileHandlePointCount:null,splineControlPointCount:0,polylineVertexCount:8,textCount:0};await page.route('**/api/vector/preview',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({modes:{spline:{error:'样条预览失败'},polyline},recommendedMode:'polyline'})}));
 await page.locator('#export').click();await page.locator('#vector-export-format').selectOption('dxf');await waitForDxfPreview(page);assert.equal(await page.locator('#vector-export-dxf-mode').inputValue(),'polyline');assert.equal(await page.locator('#vector-export-dxf-mode option[value="spline"]').getAttribute('disabled'),'');assert.equal(await page.locator('#vector-export-confirm').isDisabled(),false);await page.locator('#vector-export-cancel').click();
 await page.unroute('**/api/vector/preview');await page.route('**/api/vector/preview',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'预览服务暂不可用'})}));await page.locator('#export').click();await page.locator('#vector-export-error').filter({hasText:'预览服务暂不可用'}).waitFor();assert.equal(await page.locator('#vector-export-confirm').isDisabled(),true);assert.equal(await page.locator('#vector-export-dxf-mode').isDisabled(),true);assert.equal(await page.locator('#paths').innerHTML(),before);await page.locator('#vector-export-cancel').click();assert.deepEqual(errors,[]);
});
test('actual CorelDRAW AI imports all 56 paths at original point-based dimensions',async t=>{
 try{await stat(sourceAI);}catch{t.skip('local user sample not available');return;}
 const {page,errors,open,save}=await setup(t);await open('1 2号羊.ai',await readFile(sourceAI));await page.locator('#status').filter({hasText:'已打开 1 2号羊.ai'}).waitFor();const d=await save();assert.equal(d.paths.length,56);assert.equal(d.paths.reduce((n,p)=>n+p.nodes.length,0),19153);const b=G.pathBounds(d.paths[37]);assert.ok(Math.abs(b.width-63.5499886111)<1e-7);assert.ok(Math.abs(b.height-187.2499994444)<1e-7);assert.deepEqual(errors,[]);
});
