const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');const {tmpdir}=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const {chromium}=require('playwright');const G=require('../../tools/curve-editor/geometry.js');
test('layer multi-selection, nested groups, merge paint order and saved history survive undo and reload',async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-groups-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'分组测试',width:1000,height:700,image:null,opacity:.65,originals:[],texts:[{id:'t',name:'字',content:'文字',x:100,y:130,fontSize:20,color:'#176bce'}],images:[{id:'i',name:'图',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=',x:100,y:100,width:100,height:100,opacity:1}],paths:[{id:'p',name:'曲线',color:'#e04544',role:'outline',closed:false,note:'',nodes:[G.node(100,100),G.node(200,200)]}],layers:[{id:'a',name:'图层 A',visible:true,locked:false,pathIds:['p'],imageIds:[],textIds:[]},{id:'b',name:'图层 B',visible:true,locked:false,pathIds:[],imageIds:['i'],textIds:[]},{id:'c',name:'图层 C',visible:true,locked:false,pathIds:[],imageIds:[],textIds:['t']}]};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
 const row=id=>page.locator(`.layer-row[data-layer="${id}"]`),contents=id=>page.locator(`.layer-contents[data-owner="${id}"]`),menu=label=>page.locator('#context-menu button').filter({hasText:new RegExp('^'+label+'$')});
 const expandLayer=async id=>{const button=row(id).locator('[data-action="collapse"]');if(await button.getAttribute('aria-expanded')==='false')await button.click();};
 await row('a').waitFor();await row('a').locator('.layer-select').click();await row('b').locator('.layer-select').click({modifiers:['Shift']});
 assert.equal(await page.locator('.layer-row.selected').count(),2);await row('b').click({button:'right'});await menu('成组').click();
 const group=await page.locator('.layer-row[data-kind="group"]').getAttribute('data-layer');assert.equal(await row('a').getAttribute('data-depth'),'1');
 await row(group).locator('[data-action="collapse"]').click();assert.equal(await row('a').count(),0);await row(group).locator('[data-action="collapse"]').click();await row('a').waitFor();
 await row(group).locator('.layer-select').click();assert.equal(await page.locator('#element-count').textContent(),'2 个元素');
 await page.locator('#element-x').fill('140');await page.locator('#element-x').press('Enter');assert.equal(Number(await page.locator('#element-x').inputValue()),140);await page.locator('#undo').click();assert.equal(Number(await page.locator('#element-x').inputValue()),100);
 await row(group).locator('[data-action="visible"]').click();assert.equal(await page.locator('#paths [data-layer="a"]').count(),0);await page.locator('#undo').click();
 await row(group).locator('[data-action="locked"]').click();assert.equal(await page.locator('#paths [data-path="p"]').count(),0);await page.locator('#undo').click();
 await row(group).locator('.layer-select').click();await row('c').locator('.layer-select').click({modifiers:[process.platform==='darwin'?'Meta':'Control']});assert.equal(await page.locator('.layer-row.selected').count(),2);await page.locator('#group-layers').click();assert.equal(await page.locator('.layer-row[data-kind="group"]').count(),2);
 const outer=await page.locator('.layer-row[data-kind="group"][data-depth="0"]').getAttribute('data-layer');await row(outer).click({button:'right'});await menu('解组').click();assert.equal(await page.locator('.layer-row.selected').count(),2);
 await page.locator('#undo').click();await row(outer).waitFor();await page.locator('#redo').click();assert.equal(await page.locator('.layer-row.selected').count(),2);
 await page.locator('#merge-layers').click();assert.equal(await page.locator('.layer-row').count(),1);
 assert.deepEqual(await page.locator('#paths > g').evaluate(g=>Array.from(g.children).filter(e=>e.classList.contains('svg-curve')||e.tagName==='image'||e.hasAttribute('data-text')).map(e=>e.tagName)),['path','image','g']);
 await page.locator('#undo').click();assert.equal(await page.locator('.layer-row.selected').count(),2);await page.locator('#redo').click();
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已保存'));
 const latest=(await readFile(path.join(saves,'latest.txt'),'utf8')).trim(),saved=JSON.parse(await readFile(path.join(saves,latest),'utf8'));assert.equal(saved.layers.length,1);assert.deepEqual(saved.layers[0].items.map(i=>i.id),['p','i','t']);assert.deepEqual(saved.paths[0].nodes,initial.paths[0].nodes);
 await page.locator('#undo').click();await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已保存'));await page.reload();await row(group).waitFor();assert.equal(await row('a').getAttribute('data-depth'),'1');
 // Portable JSON retains the grouping history and its layer multiselection in a fresh context.
 await page.locator('#save-as').click();await page.locator('#save-as-name').fill('图层组副本.json');const downloading=page.waitForEvent('download');await page.locator('#save-as-confirm').click();
 const portable=JSON.parse(await readFile(await (await downloading).path(),'utf8')),freshContext=await browser.newContext(),fresh=await freshContext.newPage();fresh.on('dialog',d=>d.accept());fresh.on('pageerror',e=>errors.push(e.message));
 await fresh.goto(url);await fresh.locator('#project-file').setInputFiles({name:'副本.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(portable))});
 await fresh.locator(`.layer-row[data-layer="${group}"]`).waitFor();assert.equal(await fresh.locator('.layer-row.selected').count(),2);await fresh.locator('#redo').click();assert.equal(await fresh.locator('.layer-row').count(),1);await fresh.locator('#undo').click();assert.equal(await fresh.locator('.layer-row.selected').count(),2);await freshContext.close();
 if(process.env.CURVE_EDITOR_GROUPS_SCREENSHOT)await page.locator('#panel-layers').screenshot({path:process.env.CURVE_EDITOR_GROUPS_SCREENSHOT});
 // Reparenting selected content under a locked group must immediately remove edit access.
 await row('c').locator('.layer-select').click();await expandLayer('c');await contents('c').locator('[data-text="t"]').click();
 await row(group).locator('[data-action="locked"]').click();assert.equal(await page.locator('#element-count').textContent(),'1 个元素');
 await row('c').locator('.layer-select').dragTo(row('b').locator('.layer-select'));assert.equal(await row('c').getAttribute('data-depth'),'1');
 assert.equal(await page.locator('#element-count').textContent(),'未选择');assert.equal(await page.locator('#element-x').isDisabled(),true);
 await page.locator('#undo').click();await page.locator('#undo').click();
 // A last empty group can be ungrouped, saved, and undone without invalidating the document.
 await row('a').locator('[data-action="delete"]').click();await row('b').locator('[data-action="delete"]').click();await row('c').locator('[data-action="delete"]').click();
 assert.equal(await page.locator('.layer-row').count(),1);await row(group).locator('.layer-select').click();await page.locator('#ungroup-layers').click();
 assert.equal(await page.locator('.layer-row').count(),1);assert.equal(await page.locator('.layer-row[data-kind="group"]').count(),0);
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已保存'));await page.locator('#undo').click();await row(group).waitFor();
 assert.deepEqual(errors,[]);
});
