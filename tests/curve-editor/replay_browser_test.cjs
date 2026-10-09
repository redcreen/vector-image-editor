// Uses an isolated project and browser; never refreshes a user's open artwork.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-replay-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','auto']);
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.accept());await page.goto(url);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 const panel=async key=>{if(await page.locator(`#panel-${key}`).getAttribute('open')===null)await page.locator(`#panel-${key} > summary`).click();};
 const settled=()=>page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 return {page,errors,panel,settled};
}

test('unsaved artwork, operation records and redo survive reload; playback preserves the current work',async t=>{
 const {page,errors,panel,settled}=await setup(t);
 await panel('properties');await panel('curves');await panel('history');
 const initialName=await page.locator('#path-name').inputValue(),initialX=Number(await page.locator('#node-x').inputValue());
 await page.locator('#path-name').fill('刷新后的作品');await page.locator('#path-name').press('Tab');
 await page.locator('#node-x').fill(String(initialX+25));await page.locator('#node-x').press('Tab');
 await page.locator('#path-note').fill('稍后重做');await page.locator('#path-note').press('Tab');
 await page.locator('#undo').click();await settled();
 assert.equal(await page.locator('#history-list button').count(),4);
 await page.reload();await settled();
 assert.equal(await page.locator('#path-name').inputValue(),'刷新后的作品');
 assert.equal(Number(await page.locator('#node-x').inputValue()),initialX+25);
 assert.equal(await page.locator('#path-note').inputValue(),'');
 assert.match(await page.locator('#undo').getAttribute('title'),/可撤销 2 步/);
 assert.match(await page.locator('#redo').getAttribute('title'),/可重做 1 步/);
 await page.locator('#history-list [data-step="0"]').click();
 assert.equal(await page.locator('#path-name').inputValue(),initialName);
 assert.equal(await page.locator('#save').evaluate(e=>e.closest('[inert]')!==null),true);
 await page.keyboard.press('Delete');
 assert.equal(await page.locator('#curve-list button').count(),1);
 await page.locator('#replay-next').click();assert.equal(await page.locator('#path-name').inputValue(),'刷新后的作品');
 await page.locator('#replay-stop').click();
 assert.equal(Number(await page.locator('#node-x').inputValue()),initialX+25);
 assert.match(await page.locator('#redo').getAttribute('title'),/可重做 1 步/);
 await page.locator('#replay-speed').selectOption('300');await page.locator('#replay-play').click();
 await page.locator('#replay-play').click();assert.equal(await page.locator('#replay-play').textContent(),'继续');
 const paused=await page.locator('#replay-progress').textContent();await page.waitForTimeout(400);assert.equal(await page.locator('#replay-progress').textContent(),paused);
 await page.locator('#replay-play').click();await page.locator('#replay-stop:disabled').waitFor();
 assert.equal(await page.locator('#path-note').inputValue(),'');
 await page.locator('#redo').click();assert.equal(await page.locator('#path-note').inputValue(),'稍后重做');
 // Refresh during preview must retain the actual work, never the previewed frame.
 await settled();await page.locator('#history-list [data-step="0"]').click();await page.reload();await settled();
 assert.equal(await page.locator('#path-name').inputValue(),'刷新后的作品');assert.equal(await page.locator('#path-note').inputValue(),'稍后重做');
 assert.equal(await page.locator('#history-list button').count(),4);
 if(process.env.CURVE_EDITOR_REPLAY_SCREENSHOT){await page.locator('#show-history').click();await page.screenshot({path:process.env.CURVE_EDITOR_REPLAY_SCREENSHOT,fullPage:true});}
 assert.deepEqual(errors,[]);
});

test('image import and transform remain replayable after refresh and sessions are scoped by project',async t=>{
 const {page,errors,panel,settled}=await setup(t);await panel('history');
 // Valid PNG with trailing padding: larger than localStorage's image quota.
 const png=Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64'),Buffer.alloc(6*1024*1024)]);
 await page.locator('#image-file').setInputFiles({name:'参考.png',mimeType:'image/png',buffer:png});
 await page.locator('#layer-list').filter({hasText:'参考.png'}).waitFor();await panel('properties');await settled();
 await page.locator('#element-width').fill('60');await page.locator('#element-width').press('Tab');
 await page.reload();await settled();
 assert.equal(await page.locator('#paths image').count(),1);assert.equal(Number(await page.locator('#element-width').inputValue()),60);
 await page.locator('#history-list [data-step="0"]').click();assert.equal(await page.locator('#paths image').count(),0);
 await page.locator('#replay-stop').click();assert.equal(await page.locator('#paths image').count(),1);
 await page.route('**/api/health',route=>route.fulfill({json:{project:'/different-project',saves:'/different-project/work/curve_editor/sessions'}}));
 await page.reload();await settled();assert.equal(await page.locator('#paths image').count(),0);assert.equal(await page.locator('#undo').isDisabled(),true);
 assert.deepEqual(errors,[]);
});

test('unavailable browser session storage keeps editing and playback functional with a clear warning',async t=>{
 const {page,errors,panel}=await setup(t);
 await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{get(){throw new Error('Storage unavailable');}}));
 await page.reload();await page.locator('#history-storage[data-state="unavailable"]').waitFor({state:'attached'});
 await panel('properties');await panel('history');
 await page.locator('#path-name').fill('仍可编辑');await page.locator('#path-name').press('Tab');
 await page.locator('#replay-play').click();await page.locator('#replay-stop:disabled').waitFor();
 assert.equal(await page.locator('#path-name').inputValue(),'仍可编辑');assert.match(await page.locator('#history-storage').textContent(),/无法.*刷新/);
 assert.deepEqual(errors,[]);
});

test('a file import finishing during replay returns to the real artwork before adding its history step',async t=>{
 const {page,errors,panel}=await setup(t);await panel('properties');await panel('history');
 await page.locator('#path-name').fill('导入前');await page.locator('#path-name').press('Tab');
 await page.evaluate(()=>{const text=File.prototype.text;File.prototype.text=function(){return new Promise(resolve=>{window.finishFileRead=()=>text.call(this).then(resolve);});};});
 const G=require('../../tools/curve-editor/geometry.js');
 const imported={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'新导入作品',image:null,paths:[{id:'imported',name:'导入后',color:'#e04544',role:'outline',closed:false,nodes:[G.node(100,100),G.node(300,300)]}]};
 await page.locator('#project-file').setInputFiles({name:'imported.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
 await page.waitForFunction(()=>window.finishFileRead);await page.locator('#history-list [data-step="0"]').click();
 await page.evaluate(()=>window.finishFileRead());await page.locator('#curve-list button').filter({hasText:'导入后'}).waitFor({state:'attached'});
 assert.equal(await page.locator('#replay-stop').isDisabled(),true);
 await page.locator('#undo').click();assert.equal(await page.locator('#path-name').inputValue(),'导入前');
 await page.evaluate(()=>{const decode=Image.prototype.decode;Image.prototype.decode=function(){return new Promise(resolve=>{window.finishImageRead=()=>decode.call(this).then(resolve);});};});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
 await page.locator('#image-file').setInputFiles({name:'异步参考.png',mimeType:'image/png',buffer:png});
 await page.waitForFunction(()=>window.finishImageRead);await page.locator('#history-list [data-step="0"]').click();await page.evaluate(()=>window.finishImageRead());
 await page.locator('#paths image').waitFor({state:'attached'});assert.equal(await page.locator('#replay-stop').isDisabled(),true);
 await page.locator('#undo').click();assert.equal(await page.locator('#paths image').count(),0);assert.equal(await page.locator('#path-name').inputValue(),'导入前');
 assert.deepEqual(errors,[]);
});

test('refresh during continuous typing restores the unfinished edit as one undoable step',async t=>{
 const {page,errors,panel,settled}=await setup(t);await panel('properties');
 const original=await page.locator('#path-name').inputValue();
 await page.locator('#path-name').fill('输入中也能刷新');await page.reload();await settled();
 assert.equal(await page.locator('#path-name').inputValue(),'输入中也能刷新');assert.match(await page.locator('#undo').getAttribute('title'),/可撤销 1 步/);
 await page.locator('#undo').click();assert.equal(await page.locator('#path-name').inputValue(),original);
 assert.deepEqual(errors,[]);
});

test('refreshing again while local records are still loading never overwrites the saved draft',async t=>{
 const {page,errors,panel,settled}=await setup(t);await panel('properties');
 await page.locator('#path-name').fill('必须保留的草稿');await page.locator('#path-name').press('Tab');await settled();
 await page.addInitScript(()=>{
  const get=IDBObjectStore.prototype.get,handler=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess');
  IDBObjectStore.prototype.get=function(...args){const request=get.apply(this,args);window.sessionReadStarted=true;Object.defineProperty(request,'onsuccess',{set(callback){handler.set.call(request,()=>setTimeout(callback,500));}});return request;};
 });
 await page.reload();await page.waitForFunction(()=>window.sessionReadStarted);await page.reload();await settled();
 assert.equal(await page.locator('#path-name').inputValue(),'必须保留的草稿');assert.equal(await page.locator('#undo').isDisabled(),false);
 assert.deepEqual(errors,[]);
});

test('an older completed save does not erase a newer refresh journal from another writer',async t=>{
 const {page,errors,panel}=await setup(t);await panel('properties');
 await page.evaluate(()=>{
  const transaction=IDBDatabase.prototype.transaction,complete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
  IDBDatabase.prototype.transaction=function(stores,...args){const t=transaction.call(this,stores,...args);if(args[0]==='readwrite'&&Array.from(stores).includes('projects'))Object.defineProperty(t,'oncomplete',{set(callback){complete.set.call(t,()=>{window.finishQueuedSave=callback;});}});return t;};
 });
 await page.locator('#path-name').fill('较早保存的文字');await page.locator('#path-name').press('Tab');await page.waitForFunction(()=>window.finishQueuedSave);
 const journalKey=await page.evaluate(async()=>{
  const health=await fetch('/api/health').then(r=>r.json()),key=JSON.stringify([health.project,health.saves]);
  const request=indexedDB.open('curve-editor-sessions',2),db=await new Promise(r=>request.onsuccess=()=>r(request.result));
  const get=db.transaction('projects').objectStore('projects').get(key),journal=await new Promise(r=>get.onsuccess=()=>r(get.result));db.close();
  journal.journalId='another-writer';journal.data.current.doc.paths[0].name='另一个标签的最新文字';
  const storageKey=`curve-editor-refresh:${key}`;localStorage.setItem(storageKey,JSON.stringify(journal));window.finishQueuedSave();return storageKey;
 });
 assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key))?.journalId,journalKey),'another-writer');
 assert.deepEqual(errors,[]);
});

test('another open page changing its history cannot delete images still used by the first page',async t=>{
 const {page,errors,panel,settled}=await setup(t);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
 await page.locator('#image-file').setInputFiles({name:'共享参考.png',mimeType:'image/png',buffer:png});await page.locator('#paths image').waitFor({state:'attached'});await settled();
 const other=await page.context().newPage();other.on('dialog',d=>d.accept());other.on('pageerror',e=>errors.push(e.message));
 await other.goto(page.url());await other.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await other.locator('#new').click();
 await other.evaluate(()=>{for(let i=0;i<101;i++)document.querySelector(`[data-mode="${i%2?'cusp':'smooth'}"]`).click();});
 await other.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await other.reload();await other.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 await panel('properties');await page.locator('#element-width').fill('45');await page.locator('#element-width').press('Tab');await settled();
 await page.reload();await settled();assert.equal(await page.locator('#paths image').count(),1);assert.equal(Number(await page.locator('#element-width').inputValue()),45);
 assert.deepEqual(errors,[]);
});
