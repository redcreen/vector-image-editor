// Uses an isolated project and browser; never refreshes a user's open artwork.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm,readFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-save-as-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.accept());await page.goto(url);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 const panel=async key=>{if(await page.locator(`#panel-${key}`).getAttribute('open')===null)await page.locator(`#panel-${key} > summary`).click();};
 const settled=()=>page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 return {page,errors,panel,settled,browser,url};
}

const openJSON=async(page,data)=>{
 await page.locator('#project-file').setInputFiles({name:'作品.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
};
async function saveJSON(page){
 await page.locator('#save-as').click({timeout:1500});
 await page.locator('#save-as-name').fill('作品.json');
 const download=page.waitForEvent('download');await page.locator('#save-as-confirm').click();
 const file=await download;return JSON.parse(await readFile(await file.path(),'utf8'));
}

test('saved JSON restores undo, redo and playback in a fresh browser context',async t=>{
 const {page,errors,panel,browser,url}=await setup(t);await panel('properties');await panel('curves');
 const original=await page.locator('#path-name').inputValue();
 await page.locator('#path-name').fill('可携带记录');await page.locator('#path-name').press('Tab');
 await page.locator('#path-note').fill('仍可重做');await page.locator('#path-note').press('Tab');await page.locator('#undo').click();
 const data=await saveJSON(page);assert.ok(data.operationHistory,'saved artwork must contain history');
 const context=await browser.newContext(),fresh=await context.newPage();fresh.on('dialog',d=>d.accept());fresh.on('pageerror',e=>errors.push(e.message));
 await fresh.goto(url);await fresh.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 await openJSON(fresh,data);await fresh.locator('#layer-list .curve-select').filter({hasText:'可携带记录'}).waitFor({state:'attached'});
 assert.match(await fresh.locator('#undo').getAttribute('title'),/可撤销 1 步/);assert.match(await fresh.locator('#redo').getAttribute('title'),/可重做 1 步/);
 // Explicit file-open must replace the other work's history and retain this cursor.
 await fresh.locator('#new').click();await openJSON(fresh,data);
 await fresh.locator('#layer-list .curve-select').filter({hasText:'可携带记录'}).waitFor({state:'attached'});
 await fresh.locator('#panel-properties > summary').click();
 assert.equal(await fresh.locator('#path-note').inputValue(),'');
 await fresh.locator('#redo').click();assert.equal(await fresh.locator('#path-note').inputValue(),'仍可重做');
 await fresh.locator('#undo').click();await fresh.locator('#undo').click();assert.equal(await fresh.locator('#path-name').inputValue(),original);
 await fresh.locator('#show-history').click();await fresh.locator('#history-list [data-step="2"]').click();assert.equal(await fresh.locator('#path-note').inputValue(),'仍可重做');
 await fresh.locator('#replay-stop').click();assert.equal(await fresh.locator('#path-name').inputValue(),original);
 assert.deepEqual(errors,[]);
});

test('Save As downloads a named copy with records and cancel leaves artwork unchanged',async t=>{
 const {page,errors,panel}=await setup(t);await panel('properties');
 await page.evaluate(()=>window.showSaveFilePicker=undefined);
 await page.locator('#path-name').fill('副本里的曲线');await page.locator('#path-name').press('Tab');
 const before=await page.locator('#undo').getAttribute('title');
 await page.locator('#save-as').click({timeout:1500});await page.locator('#save-as-cancel').click();assert.equal(await page.locator('#undo').getAttribute('title'),before);
 await page.locator('#save-as').click();await page.locator('#save-as-name').fill('独立副本.json');
 const download=page.waitForEvent('download');await page.locator('#save-as-confirm').click();const file=await download;
 assert.equal(file.suggestedFilename(),'独立副本.json');const data=JSON.parse(await readFile(await file.path(),'utf8'));
 assert.equal(data.paths[0].name,'副本里的曲线');assert.ok(data.operationHistory);
 assert.equal(await page.locator('#undo').getAttribute('title'),before);
 page.on('dialog',d=>d.accept());await page.locator('#new').click();await openJSON(page,data);
 await page.locator('#layer-list .curve-select').filter({hasText:'副本里的曲线'}).waitFor({state:'attached'});
 assert.match(await page.locator('#undo').getAttribute('title'),/可撤销 1 步/);assert.deepEqual(errors,[]);
});

test('Save As dialog supports the shortcut and preserves unsaved work after download failure or cancellation',async t=>{
 const {page,errors,panel}=await setup(t);await panel('properties');
 await page.keyboard.press('Control+Shift+s');await page.locator('#save-as-dialog[open]').waitFor();
 assert.match(await page.locator('#save-as-name').inputValue(),/\.json$/);
 const download=page.waitForEvent('download');await page.locator('#save-as-name').fill('快捷键副本');await page.locator('#save-as-name').press('Enter');
 const file=await download;assert.equal(file.suggestedFilename(),'快捷键副本.json');assert.ok(JSON.parse(await readFile(await file.path(),'utf8')).operationHistory);
 await page.locator('#path-name').fill('失败后仍须保留');await page.locator('#path-name').press('Tab');
 await page.locator('#path-note').fill('重做分支');await page.locator('#path-note').press('Tab');await page.locator('#undo').click();
 const assertUnsaved=async()=>{
  page.removeAllListeners('dialog');let confirmed=false;page.once('dialog',d=>{confirmed=/未保存/.test(d.message());return d.dismiss();});
  await page.locator('#new').click();assert.equal(confirmed,true);assert.equal(await page.locator('#path-name').inputValue(),'失败后仍须保留');
  assert.equal(await page.locator('#path-note').inputValue(),'');assert.match(await page.locator('#undo').getAttribute('title'),/可撤销 1 步/);assert.match(await page.locator('#redo').getAttribute('title'),/可重做 1 步/);
 };
 await page.evaluate(()=>URL.createObjectURL=()=>{throw new Error('下载不可用');});
 await page.locator('#save-as').click();await page.locator('#save-as-confirm').click();
 assert.match(await page.locator('#save-as-error').textContent(),/下载不可用/);assert.equal(await page.locator('#save-as-dialog').isVisible(),true);
 await page.locator('#save-as-cancel').click();assert.equal(await page.locator('#save-as').isEnabled(),true);await assertUnsaved();
 await page.locator('#save-as').click();await page.locator('#save-as-name').press('Escape');await assertUnsaved();assert.deepEqual(errors,[]);
});

test('portable history keeps deleted image bytes once and rejects corrupt records atomically',async t=>{
 const {page,errors,panel}=await setup(t);await panel('properties');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
 await page.locator('#image-file').setInputFiles({name:'历史参考.png',mimeType:'image/png',buffer:png});await page.locator('#paths image').waitFor({state:'attached'});
 await page.locator('#element-width').fill('40');await page.locator('#element-width').press('Tab');
 await page.locator('[data-tool="select"]').click();await page.keyboard.press('Delete');await page.locator('#paths image').waitFor({state:'detached'});
 const data=await saveJSON(page);assert.ok(data.operationHistory);assert.equal(data.images.length,0);
 assert.equal(data.operationHistory.assets.length,1);assert.equal(JSON.stringify(data).split(data.operationHistory.assets[0]).length-1,1);
 await page.locator('#new').click();await openJSON(page,data);await page.locator('#history-count').filter({hasText:'3 步'}).waitFor({state:'attached'});
 await page.locator('#undo').click();assert.equal(await page.locator('#paths image').count(),1);assert.equal(Number(await page.locator('#element-width').inputValue()),40);
 const bad=structuredClone(data);bad.operationHistory.assets=[];await openJSON(page,bad);
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('打开失败'));
 assert.equal(await page.locator('#paths image').count(),1);assert.match(await page.locator('#redo').getAttribute('title'),/可重做 1 步/);
 assert.deepEqual(errors,[]);
});

test('Save for AI omits portable records and historical images even after opening a full copy',async t=>{
 const {page,errors,panel}=await setup(t);await panel('properties');
 await page.locator('#path-name').fill('仅当前作品给 AI');await page.locator('#path-name').press('Tab');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
 await page.locator('#image-file').setInputFiles({name:'只在历史里的图片.png',mimeType:'image/png',buffer:png});await page.locator('#paths image').waitFor({state:'attached'});
 await page.locator('[data-tool="select"]').click();await page.keyboard.press('Delete');await page.locator('#paths image').waitFor({state:'detached'});
 const portable=await saveJSON(page);assert.equal(portable.operationHistory.assets.length,1);await page.locator('#new').click();await openJSON(page,portable);
 await page.locator('#layer-list .curve-select').filter({hasText:'仅当前作品给 AI'}).waitFor({state:'attached'});
 const response=page.waitForResponse(r=>r.url().endsWith('/api/save')&&r.request().method()==='POST');await page.locator('#save').click();assert.equal((await response).status(),200);
 const ai=await page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));
 assert.equal(ai.paths[0].name,'仅当前作品给 AI');assert.equal(ai.operationHistory,undefined);assert.equal(ai.history,undefined);assert.equal(ai.images.length,0);assert.equal(JSON.stringify(ai).includes(png.toString('base64')),false);
 assert.match(await page.locator('#undo').getAttribute('title'),/可撤销 3 步/);assert.deepEqual(errors,[]);
});

test('Save As uses a visible editor dialog even when browser picker and prompts do not respond',async t=>{
 const {page,errors}=await setup(t);
 await page.evaluate(()=>{
  window.showSaveFilePicker=()=>new Promise(()=>{});
  window.prompt=()=>null;
 });
 await page.locator('#save-as').click();
 await page.locator('#save-as-dialog[open]').waitFor({state:'visible',timeout:1500});
 if(process.env.CURVE_EDITOR_SAVE_AS_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_SAVE_AS_SCREENSHOT,fullPage:true});
 await page.locator('#save-as-name').fill('浏览器兼容副本.json');
 const download=page.waitForEvent('download');await page.locator('#save-as-confirm').click();
 const file=await download;assert.equal(file.suggestedFilename(),'浏览器兼容副本.json');
 assert.ok(JSON.parse(await readFile(await file.path(),'utf8')).operationHistory);
 assert.equal(await page.locator('#save-as').isEnabled(),true);assert.deepEqual(errors,[]);
});

test('a history-bearing artwork above 32MB can open and save again with all 100 steps intact',async t=>{
 const {page,errors,panel}=await setup(t);await panel('properties');await panel('curves');
 const G=require('../../tools/curve-editor/geometry.js');
 const note='保留完整历史'.repeat(20000),doc={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'大记录作品',image:null,
  paths:[{id:'large',name:'大记录曲线',color:'#e04544',role:'outline',closed:false,note,nodes:[G.node(200,200),G.node(500,300)]}],originals:[]};
 const state={selected:'large',ni:0,selection:['large'],imageSelection:[],activeLayer:null,nodeSelection:[{pathId:'large',index:0}],drawing:false,tool:'node'};
 const past=Array.from({length:100},(_,i)=>({...state,doc:{...doc,paths:[{...doc.paths[0],nodes:[G.node(100+i,200),G.node(500,300)]}]}}));
 const data={...doc,operationHistory:{format:'curve-editor-session',version:1,assets:[],data:{current:state,history:{version:1,past,future:[],pastLabels:Array(100).fill('移动节点'),futureLabels:[]}}}};
 const source=Buffer.from(JSON.stringify(data));assert.ok(source.length>32*1024*1024);
 await page.locator('#project-file').setInputFiles({name:'大记录作品.json',mimeType:'application/json',buffer:source});
 await page.locator('#layer-list .curve-select').filter({hasText:'大记录曲线'}).waitFor({state:'attached',timeout:6000});
 assert.match(await page.locator('#undo').getAttribute('title'),/可撤销 100 步/);
 await page.locator('#save-as').click();await page.locator('#save-as-name').fill('完整大记录.json');
 const download=page.waitForEvent('download',{timeout:10000});await page.locator('#save-as-confirm').click();const file=await download;
 const saved=await readFile(await file.path(),'utf8'),restored=JSON.parse(saved);assert.ok(Buffer.byteLength(saved)>32*1024*1024);
 assert.equal(restored.operationHistory.data.history.past.length,100);assert.equal(restored.paths[0].note,note);
 assert.equal(saved,JSON.stringify(restored),'portable files use compact JSON without discarding data');
 await page.locator('#new').click();await page.locator('#project-file').setInputFiles(await file.path());
 await page.locator('#layer-list .curve-select').filter({hasText:'大记录曲线'}).waitFor({state:'attached'});assert.match(await page.locator('#undo').getAttribute('title'),/可撤销 100 步/);
 await page.locator('#undo').click();assert.equal(Number(await page.locator('#node-x').inputValue()),199);
 await page.locator('#redo').click();assert.equal(Number(await page.locator('#node-x').inputValue()),200);assert.deepEqual(errors,[]);
});
