const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');const {tmpdir}=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const D=require('../../tools/curve-editor/dimension.js');
for(const legacy of [false,true])test(`node-linked dimensions follow edits, topology and recovery (legacy=${legacy})`,async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-dimension-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'},title:'文字测试',width:1000,height:700,paths:[{id:'curve',name:'原曲线',closed:false,color:'#123456',role:'outline',nodes:[G.node(200,200),G.node(500,200),G.node(500,500)]}],originals:[],images:[],image:null,opacity:.65,texts:[],layers:[{id:'curves',name:'曲线',visible:true,locked:false,pathIds:['curve'],imageIds:[],textIds:[]}]};
 if(legacy){initial.texts=[D.resolve({id:'old-dim',name:'旧尺寸',content:'300.00 mm',x:200,y:230,fontSize:16,color:'#1685a6',dimension:{a:{x:200,y:200},b:{x:500,y:200},offset:50,unit:'mm'}},initial.calibration)];initial.layers.push({id:'dimensions',name:'尺寸标注',visible:true,locked:false,pathIds:[],imageIds:[],textIds:['old-dim']});}
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(6000);
 await page.goto(url);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});
 const click=async(x,y)=>{const p=await screen(x,y);await page.mouse.click(p.x,p.y);};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};


 if(!legacy){await page.locator('[data-tool="dimension"]').click();await click(200,200);await click(500,200);}
 let d=await save();assert.equal(d.texts[0].content,'300.00 mm');if(!legacy)assert.deepEqual(d.texts[0].dimension.bindings,{a:{pathId:'curve',index:0},b:{pathId:'curve',index:1}});
 // A full-curve drag repeatedly restores its original geometry; associations must survive every frame.
 await page.locator('[data-tool="select"]').click();await page.locator('#canvas').focus();await page.keyboard.press('Escape');
 const from=await screen(350,200),to=await screen(350,240);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();
 d=await save();assert.equal(d.texts[0].content,'300.00 mm');assert.ok(Math.abs(d.texts[0].dimension.a.y-240)<.01);assert.equal(d.texts[0].dimension.bindings.b.index,1);await page.locator('#undo').click();assert.ok(Math.abs((await save()).paths[0].nodes[0].y-200)<.01);
 const selectCurve=async()=>{await page.locator('[data-tool="node"]').click();await page.locator('#canvas').focus();await page.keyboard.press('Escape');await click(350,200);await page.locator('#handles .anchor[data-path="curve"][data-node="0"]').click({modifiers:['Shift']});};
 await selectCurve();
 const dragNode=async(index,x,y)=>{const box=await page.locator(`#handles .anchor[data-path="curve"][data-node="${index}"]`).boundingBox(),p=await screen(x,y);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(p.x,p.y,{steps:5});await page.mouse.up();};
 await dragNode(1,500,600);assert.equal(await page.locator('#paths .svg-text').textContent(),'500.00 mm');d=await save();assert.deepEqual(d.texts[0].dimension.bindings,{a:{pathId:'curve',index:0},b:{pathId:'curve',index:1}});assert.ok(Math.abs(d.texts[0].dimension.b.y-600)<.01);
 await page.locator('#undo').click();assert.equal((await save()).texts[0].content,'300.00 mm');await page.locator('#redo').click();assert.equal((await save()).texts[0].content,'500.00 mm');
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.equal(await page.locator('#paths .svg-text').textContent(),'500.00 mm');
 // Delete the associated middle node: freeze the last endpoint, never attach to its successor.
 await page.locator('[data-tool="node"]').click();await page.locator('#handles .anchor[data-path="curve"][data-node="1"]').click();await page.locator('#delete-node').click();d=await save();assert.equal(d.texts[0].dimension.bindings.b,undefined);assert.equal(d.texts[0].content,'500.00 mm');await page.locator('#undo').click();assert.equal((await save()).texts[0].dimension.bindings.b.index,1);
 await dragNode(1,200,200);assert.equal((await save()).texts[0].content,'0.00 mm');await page.locator('#undo').click();assert.equal((await save()).texts[0].content,'500.00 mm');
 for(const format of ['ai','dxf','svg']){const download=page.waitForEvent('download');await page.locator('#export').click();await page.locator('#vector-export-format').selectOption(format);await page.locator('#vector-export-confirm:not([disabled])').waitFor();await page.locator('#vector-export-confirm').click();const f=await download,raw=await readFile(await f.path(),'utf8');assert.ok(raw.length>200);if(format==='svg')assert.match(raw,/500.00 mm/);}
 assert.deepEqual(errors,[]);
});
