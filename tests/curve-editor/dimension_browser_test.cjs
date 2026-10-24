const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');const {tmpdir}=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');const {chromium}=require('playwright');
test('dimensions: create, drag, undo, units, calibration, export and restore',async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-dimension-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'},title:'文字测试',width:1000,height:700,paths:[],originals:[],image:null,opacity:.65};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(6000);
 await page.goto(url);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});
 const click=async(x,y)=>{const p=await screen(x,y);await page.mouse.click(p.x,p.y);};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};

 await page.locator('[data-tool="dimension"]').click();await click(200,200);await page.keyboard.press('Escape');assert.equal((await save()).texts.length,0);
 await page.locator('[data-tool="dimension"]').click();await click(200,200);await click(200,200);assert.equal((await save()).texts.length,0);await click(500,200);
 let d=await save();assert.equal(d.texts.length,1);assert.equal(d.texts[0].content,'300.00 mm');assert.equal(d.layers.find(l=>l.name==='尺寸标注').textIds[0],d.texts[0].id);assert.equal(await page.locator('.dimension-line').count(),7);assert.equal(await page.locator('#text-content').isDisabled(),true);
 const moveHandle=async(part,x,y,cancel=false)=>{const box=await page.locator(`[data-dimension-handle="${part}"]`).boundingBox(),p=await screen(x,y);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(p.x,p.y,{steps:4});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();};
 await moveHandle('b',500,600,true);assert.equal((await save()).texts[0].content,'300.00 mm');
 await moveHandle('b',500,600);assert.equal((await save()).texts[0].content,'500.00 mm');await page.locator('#undo').click();assert.equal((await save()).texts[0].content,'300.00 mm');await page.locator('#redo').click();
 await page.locator('#dimension-unit').selectOption('cm');assert.equal((await save()).texts[0].content,'50.00 cm');
 d=await save();await moveHandle('offset',250,450);let moved=await save();assert.equal(moved.texts[0].content,'50.00 cm');assert.notEqual(moved.texts[0].dimension.offset,d.texts[0].dimension.offset);
 await page.locator('#text-size').fill('24');await page.locator('#text-size').press('Enter');assert.equal((await save()).texts[0].fontSize,24);
 await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowRight');d=await save();assert.ok(Math.abs(d.texts[0].dimension.a.x-210)<.01);assert.equal(d.texts[0].content,'50.00 cm');
 // Calibration changes update the annotation, including undo and restoration.
 await page.locator('#calibrate').click();await click(100,100);await click(200,100);await page.locator('#calibration-length').fill('200');await page.locator('#calibration-unit').selectOption('mm');await page.locator('#calibration-apply').click();assert.equal((await save()).texts[0].content,'100.00 cm');
 await page.locator('#undo').click();assert.equal((await save()).texts[0].content,'50.00 cm');await page.locator('#redo').click();
 await page.locator('#fit').click();await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();
 for(const format of ['ai','dxf','svg']){const download=page.waitForEvent('download');await page.locator('#export').click();await page.locator('#vector-export-format').selectOption(format);await page.locator('#vector-export-confirm:not([disabled])').waitFor();await page.locator('#vector-export-confirm').click();const file=await download,raw=await readFile(await file.path(),'utf8');assert.ok(raw.length>200);if(format==='svg'){assert.match(raw,/100.00 cm/);assert.ok((raw.match(/<line /g)||[]).length>=7);}else assert.doesNotMatch(raw,/<text/);}
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#paths .svg-text').waitFor();assert.equal(await page.locator('#paths .svg-text').textContent(),'100.00 cm');assert.equal(await page.locator('.dimension-line').count(),7);
 await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();
 if(process.env.CURVE_EDITOR_DIMENSION_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_DIMENSION_SCREENSHOT,fullPage:true});
 // Portable history includes states in the new tool, and restores editable endpoints.
 await page.locator('[data-tool="dimension"]').click();
 const portableWait=page.waitForEvent('download');await page.locator('#save-as').click();await page.locator('#save-as-confirm').click();const portable=await portableWait,raw=JSON.parse(await readFile(await portable.path(),'utf8'));assert.ok(raw.operationHistory);assert.equal(raw.texts[0].content,'100.00 cm');
 await page.locator('#project-file').setInputFiles({name:'尺寸副本.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});await page.locator('#status').filter({hasText:'已打开'}).waitFor();assert.equal((await save()).texts[0].content,'100.00 cm');
 await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();await page.locator('#scale-keep-original').check();await page.locator('#element-scale-factor').fill('2');await page.locator('#scale-elements').click();d=await save();assert.deepEqual(d.texts.map(t=>t.content),['100.00 cm','200.00 cm']);await page.locator('#undo').click();assert.equal((await save()).texts.length,1);
 await page.locator('#calibration-clear').click();assert.equal((await save()).texts[0].content,'未标定');await page.locator('[data-tool="dimension"]').click();assert.match(await page.locator('#status').textContent(),/先标定/);assert.equal(await page.locator('[data-tool="dimension"]').getAttribute('aria-pressed'),'false');
 await page.locator('#undo').click();assert.equal((await save()).texts[0].content,'100.00 cm');assert.deepEqual(errors,[]);
});
