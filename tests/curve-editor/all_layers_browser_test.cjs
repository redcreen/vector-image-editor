// Isolated all-layers visibility interactions, never reloads a user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const {chromium}=require('playwright');const G=require('../../tools/curve-editor/geometry.js');

test('the layer toolbar eye toggles visibility independently from the tri-state layer selection checkbox',async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-all-layers-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const pathA={id:'a',name:'曲线 A',color:'#e04544',role:'outline',closed:false,note:'',nodes:[G.node(100,100),G.node(200,200)]};
 const pathC={id:'c',name:'曲线 C',color:'#176bce',role:'outline',closed:false,note:'',nodes:[G.node(500,300),G.node(600,400)]};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'图层总可见测试',width:1000,height:700,image:null,opacity:.65,originals:[],images:[],paths:[pathA,pathC],layers:[
  {id:'layer-a',name:'图层 A',visible:true,locked:false,pathIds:['a'],imageIds:[]},
  {id:'layer-b',name:'锁定空图层',visible:false,locked:true,pathIds:[],imageIds:[]},
  {id:'layer-c',name:'图层 C',visible:true,locked:false,pathIds:['c'],imageIds:[]},
 ]};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);await page.locator('.layer-row').filter({hasText:'图层 A'}).waitFor();
 const toggle=page.locator('#all-layers-visible'),row=name=>page.locator('.layer-row').filter({hasText:name});
 const state=()=>toggle.evaluate(button=>({checked:button.getAttribute('aria-pressed')==='true',indeterminate:button.getAttribute('aria-pressed')==='mixed',title:button.title}));
 const select=page.locator('#all-layers-selected'),selectionState=()=>select.evaluate(input=>({checked:input.checked,indeterminate:input.indeterminate}));
 const visibilities=()=>page.locator('.layer-row').evaluateAll(rows=>Object.fromEntries(rows.map(row=>[row.dataset.layer,row.querySelector('[data-action="visible"]').getAttribute('aria-pressed')==='true'])));
 const undoCount=async()=>Number((await page.locator('#undo').getAttribute('title')).match(/可撤销 (\d+) 步/)[1]);

 assert.equal(await page.locator('#add-layer').evaluate(button=>button.previousElementSibling?.id),'all-layers-visible');
 assert.equal(await toggle.evaluate(button=>button.tagName),'BUTTON');
 assert.equal(await toggle.locator('svg').count(),1);
 assert.equal(await toggle.evaluate(button=>button.previousElementSibling?.id),'all-layers-selected');
 assert.deepEqual(await state(),{checked:false,indeterminate:true,title:'部分图层可见；点击显示全部图层'});
 assert.equal(await page.locator('#panel-layers').getAttribute('open'),'');

 const beforeSelect=await undoCount(),visibilityBefore=await visibilities();
 await select.check();assert.deepEqual(await selectionState(),{checked:true,indeterminate:false});
 assert.equal(await page.locator('.layer-row.selected').count(),3);assert.equal(await page.locator('#selection-count').textContent(),'已选 2 个元素');
 if(process.env.CURVE_EDITOR_ALL_LAYERS_SCREENSHOT)await page.locator('#panel-layers').screenshot({path:process.env.CURVE_EDITOR_ALL_LAYERS_SCREENSHOT});
 assert.deepEqual(await visibilities(),visibilityBefore);assert.equal(await undoCount(),beforeSelect);
 await select.uncheck();assert.deepEqual(await selectionState(),{checked:false,indeterminate:false});
 assert.equal(await page.locator('.layer-row.selected').count(),0);assert.equal(await page.locator('#selection-count').textContent(),'未选择');
 await row('图层 A').locator('.layer-select').click();assert.deepEqual(await selectionState(),{checked:false,indeterminate:true});
 await select.click();assert.deepEqual(await selectionState(),{checked:true,indeterminate:false});
 assert.equal(await page.locator('.layer-row.selected').count(),3);

 await toggle.click();
 assert.deepEqual(await state(),{checked:true,indeterminate:false,title:'全部图层可见；点击隐藏全部图层'});
 assert.deepEqual(await visibilities(),{'layer-c':true,'layer-b':true,'layer-a':true});
 assert.equal(await page.locator('#panel-layers').getAttribute('open'),'');
 await page.locator('#undo').click();assert.equal((await state()).indeterminate,true);
 await page.locator('#redo').click();assert.equal((await state()).checked,true);

 await page.locator('#select-all').click();const selectedBeforeHide=await page.locator('#selection-count').textContent();assert.notEqual(selectedBeforeHide,'未选择');
 const before=await undoCount();await toggle.click();
 assert.equal(await undoCount(),before+1);assert.deepEqual(await state(),{checked:false,indeterminate:false,title:'全部图层已隐藏；点击显示全部图层'});
 assert.deepEqual(await visibilities(),{'layer-c':false,'layer-b':false,'layer-a':false});assert.equal(await page.locator('#selection-count').textContent(),'未选择');
 await page.locator('#undo').click();assert.deepEqual(await visibilities(),{'layer-c':true,'layer-b':true,'layer-a':true});assert.equal(await page.locator('#selection-count').textContent(),selectedBeforeHide);
 await page.locator('#redo').click();assert.equal(await page.locator('#selection-count').textContent(),'未选择');

 await row('图层 A').locator('[data-action="visible"]').click();assert.deepEqual(await state(),{checked:false,indeterminate:true,title:'部分图层可见；点击显示全部图层'});
 const empty={...initial,title:'空作品',paths:[],layers:[{id:'empty-layer',name:'空图层',visible:true,locked:true,pathIds:[],imageIds:[]}]};
 await page.locator('#project-file').setInputFiles({name:'empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(empty))});
 await page.locator('.layer-row[data-layer="empty-layer"]').waitFor();assert.deepEqual(await state(),{checked:true,indeterminate:false,title:'全部图层可见；点击隐藏全部图层'});
 await select.check();assert.deepEqual(await selectionState(),{checked:true,indeterminate:false});
 await select.uncheck();assert.deepEqual(await selectionState(),{checked:false,indeterminate:false});
 await toggle.click();assert.deepEqual(await state(),{checked:false,indeterminate:false,title:'全部图层已隐藏；点击显示全部图层'});
 // A collapsed group represents its descendants without selecting hidden or locked artwork for editing.
 const nested=structuredClone(initial);nested.layers[0].parentId='group';nested.layers[0].visible=false;nested.layers[1].parentId='group';
 nested.layers.push({id:'group',name:'折叠组',kind:'group',collapsed:true,visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]});
 await page.locator('#project-file').setInputFiles({name:'nested.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(nested))});
 await row('折叠组').waitFor();await select.check();assert.deepEqual(await selectionState(),{checked:true,indeterminate:false});
 assert.equal(await page.locator('.layer-row.selected').count(),2);assert.equal(await page.locator('#selection-count').textContent(),'已选 1 个元素');
 assert.equal(await row('图层 A').count(),0);assert.equal((await visibilities()).group,true);
 await page.waitForFunction(()=>document.querySelector('#history-storage').textContent.includes('已保存在本机'));
 await page.reload();await row('折叠组').waitFor();assert.deepEqual(await selectionState(),{checked:true,indeterminate:false});
 await select.uncheck();assert.equal(await page.locator('.layer-row.selected').count(),0);
 assert.equal(await page.locator('#panel-layers').getAttribute('open'),'');assert.deepEqual(errors,[]);
});
