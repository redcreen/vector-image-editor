// Independent project and browser; preserves all open user canvases.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-workspaces-')),servers=[],workspaces=new Set();
 const browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];
 context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
 t.after(async()=>{await browser.close();for(const server of servers)if(server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 async function launch(client,shared){
  const args=[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port',workspaces.has(shared===undefined?`session:${client}`:`shared:${shared}`)?'auto':'0'];
  if(shared!==undefined)args.push('--shared',shared);
  workspaces.add(shared===undefined?`session:${client}`:`shared:${shared}`);
  const server=spawn('python3',args,{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:'',CODEX_THREAD_ID:client,CODEX_SESSION_ID:client}});servers.push(server);
  return new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+(?:\?[^\s]+)?/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);server.once('exit',code=>{if(code){clearTimeout(timer);reject(new Error(log));}});});
 }
 async function open(url){const page=await context.newPage();page.on('dialog',d=>d.accept());await page.goto(url);await settled(page);return page;}
 async function settled(page){await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});}
 async function name(page,value){if(await page.locator('#panel-properties').getAttribute('open')===null)await page.locator('#panel-properties > summary').click();if(value!==undefined){await page.locator('#path-name').fill(value);await page.locator('#path-name').press('Tab');await settled(page);}return page.locator('#path-name').inputValue();}
 async function save(page){const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);await settled(page);}
 return {launch,open,settled,name,save,errors,context};
}

test('different Codex sessions isolate drafts, saved work and history; reopening the same session restores them',async t=>{
 const {launch,open,settled,name,save,errors}=await setup(t);
 const a=await launch('session-a'),b=await launch('session-b');assert.notEqual(a,b);
 const pageA=await open(a),pageB=await open(b);
 assert.match(await pageA.locator('#workspace-status').textContent(),/独立会话/);
 await name(pageA,'A 的未保存草稿');await save(pageA);await name(pageA,'A 的下一步');
 assert.equal(await name(pageB),'练习曲线');await name(pageB,'B 的草稿');
 await pageA.reload();await settled(pageA);assert.equal(await name(pageA),'A 的下一步');
 await pageA.locator('#undo').click();assert.equal(await name(pageA),'A 的未保存草稿');
 await pageB.reload();await settled(pageB);assert.equal(await name(pageB),'B 的草稿');
 assert.equal(await launch('session-a'),a);assert.deepEqual(errors,[]);
});

test('refreshing a stale same-address tab follows the latest unsaved canvas and its undo/redo history',async t=>{
 const {launch,open,settled,name,errors}=await setup(t);
 const url=await launch('same-address'),a=await open(url),b=await open(url);
 await name(a,'A 的最新草稿');await name(a,'A 可以重做的修改');
 await a.locator('#undo').click();await settled(a);
 const undo=await a.locator('#undo').getAttribute('title'),redo=await a.locator('#redo').getAttribute('title');
 // A view-only action on the old tab must not claim ownership of the artwork.
 await b.locator('#zoom-in').click();
 await b.reload();await settled(b);
 assert.equal(await name(b),'A 的最新草稿');
 assert.equal(await b.locator('#undo').getAttribute('title'),undo);
 assert.equal(await b.locator('#redo').getAttribute('title'),redo);
 await b.locator('#redo').click();await settled(b);assert.equal(await name(b),'A 可以重做的修改');
 await a.reload();await settled(a);assert.equal(await name(a),'A 可以重做的修改');
 assert.deepEqual(errors,[]);
});

test('closing a stale same-address tab cannot replace another tab canvas, including an immediate refresh edit',async t=>{
 const {launch,open,settled,name,save,errors}=await setup(t);
 const url=await launch('same-address-close'),a=await open(url),b=await open(url);
 await name(a,'A 已保存的新版本');await save(a);await b.close({runBeforeUnload:true});
 await a.reload();await settled(a);assert.equal(await name(a),'A 已保存的新版本');
 // Refresh before the debounce fires: the synchronous journal must retain the edit.
 await a.locator('#path-name').fill('刷新前最后一步');await a.locator('#path-name').press('Tab');
 await a.reload();await settled(a);assert.equal(await name(a),'刷新前最后一步');
 await a.locator('#undo').click();assert.equal(await name(a),'A 已保存的新版本');
 assert.deepEqual(errors,[]);
});

test('a stale tab cannot overwrite a newer refresh journal when its database write was interrupted',async t=>{
 const {launch,open,settled,name,errors}=await setup(t);
 const url=await launch('interrupted-writer'),a=await open(url),b=await open(url);
 await name(a);
 await a.evaluate(()=>{
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(stores,mode,...args){if(mode==='readwrite')throw new Error('Simulated interrupted write');return transaction.call(this,stores,mode,...args);};
 });
 await a.locator('#path-name').fill('A 仅在刷新备份中的最后一步');await a.locator('#path-name').press('Tab');
 await a.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
 await b.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
 // Let B's unload write finish, even though a real navigation may cancel it.
 await b.evaluate(async()=>{
  const request=indexedDB.open('curve-editor-sessions',2),db=await new Promise(r=>request.onsuccess=()=>r(request.result));
  await new Promise(r=>db.transaction('projects').objectStore('projects').getAll().onsuccess=r);db.close();
 });
 await b.reload();await settled(b);assert.equal(await name(b),'A 仅在刷新备份中的最后一步');
 const committed=await b.evaluate(async()=>{
  const health=await fetch('/api/health').then(r=>r.json()),key=JSON.stringify([health.project,health.saves])+':sync-v1';
  const request=indexedDB.open('curve-editor-sessions',2),db=await new Promise(r=>request.onsuccess=()=>r(request.result));
  const record=await new Promise(r=>db.transaction('projects').objectStore('projects').get(key).onsuccess=e=>r(e.target.result));db.close();return record.data.current.doc.paths[0].name;
 });
 assert.equal(committed,'A 仅在刷新备份中的最后一步');
 await b.locator('#undo').click();assert.equal(await name(b),'练习曲线');
 assert.deepEqual(errors,[]);
});

test('plain refreshes do not accumulate full history backups, while conflicting edits remain recoverable',async t=>{
 const {launch,open,settled,name,errors}=await setup(t);
 const url=await launch('bounded-recovery'),a=await open(url),b=await open(url);
 await name(a,'A 的完整分支');await name(b,'B 的独立分支');
 const records=()=>a.evaluate(async()=>{
  const request=indexedDB.open('curve-editor-sessions',2),db=await new Promise(r=>request.onsuccess=()=>r(request.result));
  const records=await new Promise(r=>db.transaction('projects').objectStore('projects').getAll().onsuccess=e=>r(e.target.result));db.close();
  return records.map(record=>({name:record.data.current.doc.paths[0].name,undo:record.data.history.past.length}));
 });
 const before=await records();assert.ok(before.some(record=>record.name==='A 的完整分支'&&record.undo===1));
 assert.ok(before.some(record=>record.name==='B 的独立分支'&&record.undo===1));
 for(let i=0;i<3;i++){await a.reload();await settled(a);}
 assert.equal((await records()).length,before.length);assert.equal(await name(a),'B 的独立分支');assert.deepEqual(errors,[]);
});

test('refresh removes a superseded journal when navigation interrupted only its completion callback',async t=>{
 const {launch,open,settled,name,errors}=await setup(t);
 const a=await open(await launch('committed-journal'));await name(a,'完整的已提交画布');
 await a.evaluate(async()=>{
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(stores,mode,...args){const t=transaction.call(this,stores,mode,...args);if(mode==='readwrite')Object.defineProperty(t,'oncomplete',{set(){}});return t;};
  window.dispatchEvent(new Event('beforeunload'));
  const request=indexedDB.open('curve-editor-sessions',2),db=await new Promise(r=>request.onsuccess=()=>r(request.result));
  await new Promise(r=>db.transaction('projects').objectStore('projects').getAll().onsuccess=r);db.close();
 });
 assert.ok(await a.evaluate(()=>Object.keys(localStorage).some(key=>key.includes(':sync-v1:page:'))));
 await a.reload();await settled(a);assert.equal(await name(a),'完整的已提交画布');
 assert.equal(await a.evaluate(()=>Object.keys(localStorage).filter(key=>key.includes(':sync-v1:page:')).length),0);
 assert.deepEqual(errors,[]);
});

test('an edit followed by undo before the debounce retains its redo history across same-address tabs',async t=>{
 const {launch,open,settled,name,errors}=await setup(t);
 const url=await launch('history-only-change'),a=await open(url),b=await open(url);await name(a);
 await a.evaluate(()=>{const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===120?1000:ms,...args);});
 await a.locator('#path-name').fill('能够重做的修改');await a.locator('#path-name').press('Tab');await a.locator('#undo').click();
 await settled(a);assert.equal(await name(a),'练习曲线');assert.match(await a.locator('#redo').getAttribute('title'),/可重做 1 步/);
 await b.reload();await settled(b);assert.match(await b.locator('#redo').getAttribute('title'),/可重做 1 步/);
 await b.locator('#redo').click();assert.equal(await name(b),'能够重做的修改');assert.deepEqual(errors,[]);
});

test('refreshing twice after journal recovery but before its startup save keeps the recovered canvas and redo',async t=>{
 const {launch,open,name,context,errors}=await setup(t);
 const url=await launch('recovery-double-refresh'),a=await open(url);await name(a);
 await a.evaluate(()=>{
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(stores,mode,...args){if(mode==='readwrite')throw new Error('Simulated interrupted write');return transaction.call(this,stores,mode,...args);};
 });
 await a.locator('#path-name').fill('恢复备份中的画布');await a.locator('#path-name').press('Tab');
 await a.locator('#path-note').fill('保留的重做记录');await a.locator('#path-note').press('Tab');await a.locator('#undo').click();
 await a.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
 const b=await context.newPage();b.on('dialog',d=>d.accept());
 await b.addInitScript(()=>{const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===120?5000:ms,...args);});
 await b.goto(url);await b.locator('#path-name').filter({visible:true}).waitFor();
 await b.waitForFunction(()=>document.querySelector('#path-name').value==='恢复备份中的画布');
 await b.reload();await b.waitForFunction(()=>document.querySelector('#path-name').value==='恢复备份中的画布',null,{timeout:3000});
 assert.match(await b.locator('#redo').getAttribute('title'),/可重做 1 步/);
 assert.deepEqual(errors,[]);
});

test('legacy sessions migrate with history, and an old-version page cannot overwrite the synchronized record',async t=>{
 const {launch,open,settled,name,context,errors}=await setup(t);
 const url=await launch('legacy-upgrade'),a=await open(url);await name(a,'升级前的画布');
 const legacy=await a.evaluate(async()=>{
  const health=await fetch('/api/health').then(r=>r.json()),key=JSON.stringify([health.project,health.saves]);
  const request=indexedDB.open('curve-editor-sessions',2),db=await new Promise(r=>request.onsuccess=()=>r(request.result));
  const read=key=>new Promise(r=>db.transaction('projects').objectStore('projects').get(key).onsuccess=e=>r(e.target.result));
  const packed=await read(key+':sync-v1')||await read(key);
  delete packed.writeId;delete packed.writer;delete packed.updatedAt;delete packed.baseRevision;delete packed.contentChanged;
  await new Promise(r=>{const t=db.transaction('projects','readwrite');t.objectStore('projects').put(packed,key);t.objectStore('projects').delete(key+':sync-v1');t.oncomplete=r;});db.close();
  return {key,packed};
 });
 const b=await open(url);assert.equal(await name(b),'升级前的画布');
 await b.locator('#undo').click();await settled(b);assert.equal(await name(b),'练习曲线');
 await b.locator('#redo').click();await settled(b);await name(b,'升级后的最新画布');
 legacy.packed.data.current.doc.paths[0].name='旧版标签页回写的旧画布';
 const c=await context.newPage();c.on('dialog',d=>d.accept());
 await c.addInitScript(({key,packed})=>localStorage.setItem('curve-editor-refresh:'+key,JSON.stringify(packed)),legacy);
 await c.goto(url);await settled(c);assert.equal(await name(c),'升级后的最新画布');
 const backups=await c.evaluate(async()=>{
  const request=indexedDB.open('curve-editor-sessions',2),db=await new Promise(r=>request.onsuccess=()=>r(request.result));
  const records=await new Promise(r=>db.transaction('projects').objectStore('projects').getAll().onsuccess=e=>r(e.target.result));db.close();
  return records.map(record=>({name:record.data.current.doc.paths[0].name,undo:record.data.history.past.length}));
 });
 assert.ok(backups.some(record=>record.name==='升级前的画布'&&record.undo===1));
 assert.ok(backups.some(record=>record.name==='升级后的最新画布'&&record.undo===2));
 assert.deepEqual(errors,[]);
});

for(const damage of ['image','camera','history'])test(`a damaged refresh journal (${damage}) falls back to the intact canvas and history in the database`,async t=>{
 const {launch,open,settled,name,context,errors}=await setup(t);
 const url=await launch('damaged-journal'),a=await open(url);await name(a,'完整的本机画布');
 const journal=await a.evaluate(async()=>{
  const health=await fetch('/api/health').then(r=>r.json()),key=JSON.stringify([health.project,health.saves])+':sync-v1';
  const request=indexedDB.open('curve-editor-sessions',2),db=await new Promise(r=>request.onsuccess=()=>r(request.result));
  const packed=await new Promise(r=>db.transaction('projects').objectStore('projects').get(key).onsuccess=e=>r(e.target.result));db.close();
  packed.updatedAt+=60000;packed.contentChanged=true;return {key,packed};
 });
 if(damage==='image')journal.packed.assets=[{key:'missing-image'}];
 if(damage==='camera')journal.packed.data.camera.z=0;
 if(damage==='history')journal.packed.data.history.past=null;
 const b=await context.newPage();b.on('dialog',d=>d.accept());
 await b.addInitScript(({key,packed})=>localStorage.setItem('curve-editor-refresh:'+key,JSON.stringify(packed)),journal);
 await b.goto(url);await settled(b);assert.equal(await name(b),'完整的本机画布');
 await b.locator('#undo').click();assert.equal(await name(b),'练习曲线');assert.deepEqual(errors,[]);
});

test('a failed legacy backup does not prevent restoring the intact canonical canvas and history',async t=>{
 const {launch,open,settled,name,context,errors}=await setup(t);
 const url=await launch('backup-failure'),a=await open(url);await name(a,'应该恢复的完整画布');
 const legacy=await a.evaluate(async()=>{
  const health=await fetch('/api/health').then(r=>r.json()),key=JSON.stringify([health.project,health.saves]);
  const request=indexedDB.open('curve-editor-sessions',2),db=await new Promise(r=>request.onsuccess=()=>r(request.result));
  const packed=await new Promise(r=>db.transaction('projects').objectStore('projects').get(key+':sync-v1').onsuccess=e=>r(e.target.result));db.close();
  packed.data.current.doc.paths[0].name='另一份旧版草稿';return {key,packed};
 });
 const b=await context.newPage();b.on('dialog',d=>d.accept());
 await b.addInitScript(({key,packed})=>{
  localStorage.setItem('curve-editor-refresh:'+key,JSON.stringify(packed));
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){if(String(key).includes(':legacy:'))throw new DOMException('Simulated full backup storage','QuotaExceededError');return put.call(this,value,key);};
 },legacy);
 await b.goto(url);await settled(b);assert.equal(await name(b),'应该恢复的完整画布');
 assert.match(await b.locator('#status').textContent(),/另一份记录未能备份/);
 await b.locator('#undo').click();assert.equal(await name(b),'练习曲线');assert.deepEqual(errors,[]);
});

test('named shared workspace loads saved changes while preserving each member draft and history',async t=>{
 const {launch,open,settled,name,save,errors}=await setup(t);
 const a=await launch('member-a','协作稿'),b=await launch('member-b','协作稿');
 assert.equal(new URL(a).origin,new URL(b).origin);assert.notEqual(a,b);
 const pageA=await open(a),pageB=await open(b);assert.match(await pageA.locator('#workspace-status').textContent(),/共享.*协作稿/);
 assert.equal(await name(pageB),'练习曲线');
 await name(pageA,'甲保存');await save(pageA);
 await pageB.reload();await settled(pageB);assert.equal(await name(pageB),'甲保存');
 await name(pageB,'乙未保存');
 await name(pageA,'甲新保存');await save(pageA);
 await pageB.reload();await settled(pageB);assert.equal(await name(pageB),'乙未保存');
 assert.match(await pageB.locator('#status').textContent(),/共享.*新.*草稿/);
 await pageB.locator('#undo').click();assert.equal(await name(pageB),'甲保存');
 await pageB.locator('#redo').click();assert.equal(await name(pageB),'乙未保存');await save(pageB);
 await pageA.reload();await settled(pageA);assert.equal(await name(pageA),'乙未保存');
 const other=await open(await launch('member-c','其他稿'));assert.equal(await name(other),'练习曲线');
 assert.deepEqual(errors,[]);
});

test('shared updates never replace a member locally opened work or Save As copy on reload',async t=>{
 const {launch,open,settled,name,save,errors}=await setup(t);
 const pageA=await open(await launch('local-a','本地副本')),pageB=await open(await launch('local-b','本地副本'));
 await name(pageA,'甲共享版本');await save(pageA);
 await pageB.reload();await settled(pageB);assert.equal(await name(pageB),'甲共享版本');await name(pageB,'乙共享版本');await save(pageB);
 await name(pageA,'甲独立草稿');await pageA.reload();await settled(pageA);
 assert.equal(await name(pageA),'甲独立草稿');
 const latest=await pageA.evaluate(()=>fetch('/api/latest').then(r=>r.json()));latest.paths[0].name='本地打开的作品';
 await pageA.locator('#project-file').setInputFiles({name:'local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(latest))});
 await settled(pageA);assert.equal(await name(pageA),'本地打开的作品');
 await pageA.reload();await settled(pageA);assert.equal(await name(pageA),'本地打开的作品');
 await name(pageA,'仅另存为的作品');
 await pageA.locator('#save-as').click();const downloading=pageA.waitForEvent('download');await pageA.locator('#save-as-confirm').click();await downloading;await settled(pageA);
 await name(pageB,'再一次共享更新');await save(pageB);
 await pageA.reload();await settled(pageA);assert.equal(await name(pageA),'仅另存为的作品');
 assert.deepEqual(errors,[]);
});
