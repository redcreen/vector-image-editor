// Regression checks use temporary projects and never touch an open user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-async-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 return {page,errors};
}
async function currentSession(page){
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('curve-editor-sessions',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects'),store=tx.objectStore('projects'),keys=store.getAllKeys();keys.onsuccess=()=>{const record=store.get(keys.result.find(key=>key.endsWith(':sync-v1')));record.onsuccess=()=>resolve(record.result.data);};tx.oncomplete=()=>db.close();};}));
}
async function currentTitle(page){return (await currentSession(page)).current.doc.title;}
const artwork=title=>({format:'daban-curve-editor',version:1,units:'image-px',title,width:1000,height:700,paths:[],originals:[],image:null,images:[],texts:[],layers:[{id:'blank',name:'空图层',visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]}]});
const openJSON=(page,title)=>page.locator('#project-file').setInputFiles({name:title+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(artwork(title)))});
async function delayFileRead(page){
 await page.evaluate(()=>{const read=File.prototype.text;window.delayedReads={};File.prototype.text=function(){return new Promise(resolve=>{window.delayedReads[this.name]=()=>read.call(this).then(resolve);});};});
}
async function releaseFile(page,name){await page.evaluate(name=>window.delayedReads[name](),name+'.json');await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));}

test('a delayed JSON read cannot replace a newly created canvas',async t=>{
 const {page,errors}=await setup(t);await delayFileRead(page);await openJSON(page,'过期作品');
 await page.locator('#new').click();const name=await currentTitle(page),history=await page.locator('#undo').getAttribute('title');
 await releaseFile(page,'过期作品');
 assert.equal(await currentTitle(page),name);assert.equal(await page.locator('#undo').getAttribute('title'),history);assert.deepEqual(errors,[]);
});

test('the latest JSON open request wins even when an earlier read finishes first',async t=>{
 const {page,errors}=await setup(t);await delayFileRead(page);await openJSON(page,'较早作品');await openJSON(page,'最新作品');
 await releaseFile(page,'较早作品');assert.notEqual(await currentTitle(page),'较早作品');
 await releaseFile(page,'最新作品');assert.equal(await currentTitle(page),'最新作品');assert.deepEqual(errors,[]);
});

test('the page naming dialog isolates canvas keyboard and clipboard commands',async t=>{
 const {page,errors}=await setup(t);await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();
 const before=await page.locator('#paths').innerHTML(),history=await page.locator('#undo').getAttribute('title');
 await page.locator('#editor-rename').click();await page.locator('#editor-name-cancel').focus();await page.keyboard.press('Delete');
 assert.equal(await page.locator('#paths').innerHTML(),before);assert.equal(await page.locator('#undo').getAttribute('title'),history);
 const copied=await page.locator('#editor-name-cancel').evaluate(el=>{const e=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()});el.dispatchEvent(e);return e.defaultPrevented;});
 assert.equal(copied,false);await page.keyboard.press('Control+p');assert.equal(await page.locator('#print-dialog').evaluate(el=>el.open),false);
 await page.locator('#editor-name-cancel').click();assert.deepEqual(errors,[]);
});

test('IME composing keystrokes do not change canvas selection, geometry or tools',async t=>{
 const {page,errors}=await setup(t);await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();
 const before=await page.locator('#paths').innerHTML(),history=await page.locator('#undo').getAttribute('title');
 const consumed=await page.locator('#canvas').evaluate(el=>['ArrowRight','Delete','Escape','b'].map(key=>{const e=new KeyboardEvent('keydown',{key,isComposing:true,bubbles:true,cancelable:true});el.dispatchEvent(e);return e.defaultPrevented;}));
 assert.deepEqual(consumed,[false,false,false,false]);assert.equal(await page.locator('#paths').innerHTML(),before);assert.equal(await page.locator('#undo').getAttribute('title'),history);
 assert.equal(await page.locator('[data-tool="select"]').getAttribute('aria-pressed'),'true');assert.deepEqual(errors,[]);
});

for(const needsUnit of [false,true])test(`new JSON open supersedes an earlier vector response${needsUnit?' requiring units':''}`,async t=>{
 const {page,errors}=await setup(t);let pending,resolveRequest;
 const requestReady=new Promise(resolve=>{resolveRequest=resolve;});
 await page.route('**/api/vector/import',route=>{pending=route;resolveRequest();});
 await page.locator('#project-file').setInputFiles({name:'old.dxf',mimeType:'application/dxf',buffer:Buffer.from('test')});
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('old.dxf'));
 // Wait for the intercepted request, without releasing its response yet.
 await requestReady;
 await delayFileRead(page);await openJSON(page,'latest-json');
 await pending.fulfill({status:200,contentType:'application/json',body:JSON.stringify(needsUnit?{needsUnit:true}:{document:artwork('old-vector'),warnings:[]})});
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,30)));
 assert.equal(await page.locator('#vector-unit-dialog').evaluate(el=>el.open),false);
 await releaseFile(page,'latest-json');assert.equal(await currentTitle(page),'latest-json');assert.deepEqual(errors,[]);
});
async function delaySave(page){
 await page.evaluate(()=>{const original=window.fetch;window.fetch=(url,options)=>url==='/api/save'?new Promise(resolve=>{window.finishSave=ok=>resolve(new Response(ok?JSON.stringify({filename:'old-save.json'}):'save failed',{status:ok?200:500,headers:{'Content-Type':'application/json'}}));}):original(url,options);});
}
test('save response cannot mark an identical reopened document workspace-clean',async t=>{
 const {page,errors}=await setup(t);await openJSON(page,'saved-A');await page.waitForFunction(()=>document.getElementById('status').textContent==='已打开 saved-A.json');await delaySave(page);await page.locator('#save').click();
 const original=(await currentSession(page)).current.doc;
 await page.locator('#project-file').setInputFiles({name:'copy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});
 await page.waitForFunction(()=>document.getElementById('status').textContent==='已打开 copy.json');
 const before=await currentSession(page),status=await page.locator('#status').textContent();
 await page.evaluate(()=>window.finishSave(true));await page.waitForFunction(()=>!document.getElementById('save').disabled);
 const after=await currentSession(page);assert.equal(after.savedRevision,before.savedRevision);assert.equal(after.workspaceClean,false);assert.equal(await page.locator('#status').textContent(),status);assert.deepEqual(errors,[]);
});
test('failed stale save downloads the saved document name without overwriting current status',async t=>{
 const {page,errors}=await setup(t);await openJSON(page,'saved-A');await page.waitForFunction(()=>document.getElementById('status').textContent==='已打开 saved-A.json');await delaySave(page);await page.locator('#save').click();await openJSON(page,'current-B');await page.waitForFunction(()=>document.getElementById('status').textContent==='已打开 current-B.json');
 const status=await page.locator('#status').textContent(),downloadEvent=page.waitForEvent('download');
 await page.evaluate(()=>window.finishSave(false));const download=await downloadEvent;
 assert.equal(download.suggestedFilename(),'saved-A.json');assert.equal(await currentTitle(page),'current-B');assert.equal(await page.locator('#status').textContent(),status);assert.deepEqual(errors,[]);
});
for(const input of ['project-file','vector-file'])test(`a vector unit response from ${input} after New cannot open a stale unit dialog`,{timeout:15000},async t=>{
 const {page,errors}=await setup(t);let pending,resolveRequest;
 const requestReady=new Promise(resolve=>{resolveRequest=resolve;});
 await page.route('**/api/vector/import',route=>{pending=route;resolveRequest();});
 await page.locator('#'+input).setInputFiles({name:'old.dxf',mimeType:'application/dxf',buffer:Buffer.from('test')});await requestReady;
 await page.locator('#new').click();const title=await currentTitle(page),status=await page.locator('#status').textContent();
 await pending.fulfill({status:200,contentType:'application/json',body:JSON.stringify({needsUnit:true})});
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,30)));
 assert.equal(await page.locator('#vector-unit-dialog').evaluate(el=>el.open),false);assert.equal(await currentTitle(page),title);assert.equal(await page.locator('#status').textContent(),status);assert.deepEqual(errors,[]);
});
