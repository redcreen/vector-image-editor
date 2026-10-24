// Isolated element-layer browser regressions; never opens or mutates a user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');

const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=';

async function setup(t,initial,label){
 const project=await mkdtemp(path.join(tmpdir(),`curve-editor-${label}-`));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'blank.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'blank.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
 await page.goto(url);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 const closed=page.locator('.panel-group:not([open]):not([data-panel="help"]) > summary');while(await closed.count())await closed.first().click();
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});
 const click=async(x,y)=>{const p=await screen(x,y);await page.mouse.click(p.x,p.y);};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,errors,click,save};
}

test('mixed path, image and text selection moves to one editable layer in one persisted history step',async t=>{
 const curve={id:'path-1',name:'保留曲线',color:'#e04544',role:'outline',closed:false,note:'曲线说明',nodes:[G.node(100,100),G.node(220,180)]};
 const image={id:'image-1',name:'参考图',dataUrl:pixel,x:300,y:120,width:80,height:60,opacity:.7,rotation:12};
 const text={id:'text-1',name:'保留文字',content:'跨图层文字',x:470,y:180,fontSize:28,color:'#243347',rotation:-8};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'元素换层测试',width:1000,height:700,image:null,opacity:.65,originals:[],paths:[curve],images:[image],texts:[text],layers:[
  {id:'layer-path',name:'曲线来源',visible:true,locked:false,pathIds:['path-1'],imageIds:[],textIds:[]},
  {id:'layer-image',name:'图片来源',visible:true,locked:false,pathIds:[],imageIds:['image-1'],textIds:[]},
  {id:'layer-text',name:'文字来源',visible:true,locked:false,pathIds:[],imageIds:[],textIds:['text-1']},
  {id:'layer-group',name:'图层组',kind:'group',visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]},
  {id:'layer-target',name:'可用目标',visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]},
  {id:'layer-hidden',name:'隐藏目标',visible:false,locked:false,pathIds:[],imageIds:[],textIds:[]},
  {id:'layer-locked',name:'锁定目标',visible:true,locked:true,pathIds:[],imageIds:[],textIds:[]},
 ]};
 const {page,errors,save}=await setup(t,initial,'element-layers');
 const header=id=>page.locator(`.layer-row[data-layer="${id}"]`),row=id=>header(id).locator('.layer-select');
 assert.equal(await header('layer-path').locator('[data-action="collapse"]').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.layer-contents[data-owner="layer-path"]').isHidden(),true);
 await header('layer-path').locator('[data-action="collapse"]').click();assert.equal(await page.locator('.layer-contents[data-owner="layer-path"] .curve-item[data-path="path-1"]').isVisible(),true);assert.equal(await page.locator('#undo').isDisabled(),true);
 await row('layer-path').click();await row('layer-image').click({modifiers:['Shift']});await row('layer-text').click({modifiers:['Shift']});
 assert.equal(await page.locator('#selection-count').textContent(),'已选 3 个元素');
 const select=page.locator('#element-layer');await select.waitFor();assert.equal(await select.inputValue(),'');
 assert.equal(await select.locator('option').filter({hasText:'跨图层'}).count(),1);
 assert.equal(await select.locator('option[value="layer-group"]').count(),0);
 assert.equal(await select.locator('option[value="layer-hidden"]').evaluate(option=>option.disabled),true);
 assert.equal(await select.locator('option[value="layer-locked"]').evaluate(option=>option.disabled),true);
 await select.selectOption('layer-target');
 assert.equal(await page.locator('#selection-count').textContent(),'已选 3 个元素');assert.equal(await select.inputValue(),'layer-target');
 let moved=await save(),target=moved.layers.find(layer=>layer.id==='layer-target');
 assert.deepEqual(target.pathIds,['path-1']);assert.deepEqual(target.imageIds,['image-1']);assert.deepEqual(target.textIds,['text-1']);
 for(const id of ['layer-path','layer-image','layer-text']){const layer=moved.layers.find(item=>item.id===id);assert.deepEqual([layer.pathIds,layer.imageIds,layer.textIds],[[],[],[]]);}
 assert.deepEqual(moved.paths,initial.paths);assert.deepEqual(moved.images,initial.images);assert.deepEqual(moved.texts,initial.texts);
 // Dispatching the already-selected destination is a no-op; one undo still restores the original memberships.
 await select.evaluate(element=>element.dispatchEvent(new Event('change',{bubbles:true})));
 await page.locator('#undo').click();let restored=await save();
 for(const source of initial.layers.filter(layer=>['layer-path','layer-image','layer-text','layer-target'].includes(layer.id))){const layer=restored.layers.find(item=>item.id===source.id);assert.deepEqual([layer.pathIds,layer.imageIds,layer.textIds],[source.pathIds,source.imageIds,source.textIds]);}
 assert.equal(await page.locator('#undo').isDisabled(),true);assert.equal(await page.locator('#selection-count').textContent(),'已选 3 个元素');
 await page.locator('#redo').click();moved=await save();assert.deepEqual(moved.layers.find(layer=>layer.id==='layer-target').textIds,['text-1']);
 await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.equal(await page.locator('#selection-count').textContent(),'已选 3 个元素');assert.equal(await page.locator('#element-layer').inputValue(),'layer-target');
 const refreshed=await save();assert.deepEqual(refreshed.paths,initial.paths);assert.deepEqual(refreshed.images,initial.images);assert.deepEqual(refreshed.texts,initial.texts);assert.deepEqual(refreshed.layers.find(layer=>layer.id==='layer-target').pathIds,['path-1']);assert.deepEqual(errors,[]);
});

test('a protected named text layer blocks creation without creating a duplicate',async t=>{
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'受保护文字层测试',width:1000,height:700,image:null,opacity:.65,originals:[],paths:[],images:[],texts:[],layers:[
  {id:'drawing',name:'普通图层',visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]},
  {id:'text-layer',name:'文字图层',visible:true,locked:true,pathIds:[],imageIds:[],textIds:[]},
 ]};
 const {page,errors,click,save}=await setup(t,initial,'protected-text-layer');
 await page.locator('.layer-row[data-layer="drawing"] .layer-select').click();await page.locator('[data-tool="text"]').click();await click(240,180);
 assert.equal(await page.locator('#text-dialog').isVisible(),false);assert.match(await page.locator('#status').textContent(),/文字.*图层.*锁定|锁定.*文字.*图层/);
 let doc=await save();assert.equal(doc.texts.length,0);assert.equal(doc.layers.filter(layer=>layer.name==='文字图层').length,1);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('.layer-row[data-layer="text-layer"] [data-action="locked"]').click();await page.locator('[data-tool="text"]').click();await click(240,180);await page.locator('#new-text-content').fill('解锁后创建');await page.locator('#text-confirm').click();
 doc=await save();assert.equal(doc.layers.filter(layer=>layer.name==='文字图层').length,1);assert.deepEqual(doc.layers.find(layer=>layer.id==='text-layer').textIds,[doc.texts[0].id]);assert.deepEqual(errors,[]);
});

test('canvas menu creates text from a locked active layer and undoes the new text layer together',async t=>{
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'默认文字层菜单',width:1000,height:700,image:null,opacity:.65,originals:[],paths:[],images:[],texts:[],layers:[
  {id:'drawing',name:'锁定参考层',visible:true,locked:true,pathIds:[],imageIds:[],textIds:[]},
 ]};
 const {page,errors,save}=await setup(t,initial,'text-menu-layer');
 await page.locator('#canvas').click({button:'right',position:{x:200,y:160}});
 const create=page.locator('#context-menu button').filter({hasText:'创建文字'});assert.equal(await create.isEnabled(),true);await create.click();
 await page.locator('#new-text-content').fill('独立文字');await page.locator('#text-confirm').click();let doc=await save();
 assert.equal(doc.layers.length,2);assert.equal(doc.layers[1].name,'文字图层');assert.deepEqual(doc.layers[1].textIds,[doc.texts[0].id]);
 await page.locator('#undo').click();doc=await save();assert.equal(doc.layers.length,1);assert.equal(doc.texts.length,0);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();doc=await save();assert.equal(doc.layers.length,2);assert.equal(doc.texts.length,1);assert.deepEqual(errors,[]);
});

test('direct double clicks in the tree keep layer and curve names in place while opening properties',async t=>{
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'列表双击',width:1000,height:700,image:null,opacity:.65,originals:[],images:[],texts:[],paths:[{id:'p',name:'曲线',color:'#e04544',role:'outline',closed:false,note:'',nodes:[G.node(100,100),G.node(200,200)]}],layers:[{id:'l',name:'图层',visible:true,locked:false,pathIds:['p'],imageIds:[],textIds:[]}]};
 const {page,errors}=await setup(t,initial,'tree-double-click');
 await page.locator('#panel-properties > summary').click();await page.locator('#panel-curves > summary').click();
 const header=page.locator('.layer-row[data-layer="l"]');await header.locator('.layer-select').dblclick();await page.locator('.layer-rename').waitFor();await page.locator('.layer-rename').press('Escape');
 await header.locator('[data-action="collapse"]').click();await page.locator('.curve-select span').dblclick();await page.locator('.curve-rename').waitFor();await page.locator('.curve-rename').press('Escape');
 assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

function dragFixture(){
 return {format:'daban-curve-editor',version:1,units:'image-px',title:'拖动换层',width:1000,height:700,image:null,opacity:.65,originals:[],
  paths:[{id:'p',name:'曲线',color:'#e04544',role:'outline',closed:false,note:'',nodes:[G.node(100,100),G.node(200,200)]}],
  images:[{id:'i',name:'图片',dataUrl:pixel,x:300,y:100,width:80,height:60,opacity:1}],
  texts:[{id:'t',name:'文字',content:'拖动文字',x:450,y:100,fontSize:24,color:'#243347'}],
  layers:[{id:'source',name:'来源层',visible:true,locked:false,pathIds:['p'],imageIds:['i'],textIds:['t']},
   {id:'target',name:'目标层',visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]},
   {id:'locked',name:'锁定层',visible:true,locked:true,pathIds:[],imageIds:[],textIds:[]},
   {id:'hidden',name:'隐藏层',visible:false,locked:false,pathIds:[],imageIds:[],textIds:[]},
   {id:'group',name:'组',kind:'group',visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]} ]};
}
test('each element type can be dragged to a collapsed layer with one undo and persistent data',async t=>{
 for(const [type,id,key] of [['path','p','pathIds'],['image','i','imageIds'],['text','t','textIds']])await t.test(type,async t=>{
  const initial=dragFixture(),{page,save,errors}=await setup(t,initial,'drag-'+type);
  await page.locator('.layer-row[data-layer="source"] [data-action="collapse"]').click();
  await page.locator(`.layer-contents[data-owner="source"] [data-${type}="${id}"]`).dragTo(page.locator('.layer-row[data-layer="target"] .layer-select'));
  let doc=await save();assert.deepEqual(doc.layers.find(l=>l.id==='target')[key],[id]);assert.deepEqual([doc.paths,doc.images,doc.texts],[initial.paths,initial.images,initial.texts]);
  assert.equal(await page.locator('#element-layer').inputValue(),'target');assert.equal(await page.locator('.layer-row[data-layer="target"] [data-action="collapse"]').getAttribute('aria-expanded'),'true');
  await page.locator('#undo').click();doc=await save();assert.deepEqual(doc.layers.find(l=>l.id==='source')[key],[id]);assert.equal(await page.locator('#undo').isDisabled(),true);
  await page.locator('#redo').click();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
  assert.deepEqual((await save()).layers.find(l=>l.id==='target')[key],[id]);assert.deepEqual(errors,[]);
 });
});
test('dragging a selected item moves the mixed selection, rejects protected targets and cleans canceled drags',async t=>{
 const initial=dragFixture(),{page,save,errors}=await setup(t,initial,'drag-mixed');
 const header=id=>page.locator(`.layer-row[data-layer="${id}"] .layer-select`);
 await page.locator('.layer-row[data-layer="source"] [data-action="collapse"]').click();await header('source').click();
 const source=()=>page.locator('.layer-contents[data-owner="source"] [data-text="t"]');
 const bounds=await source().boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2-30,bounds.y+bounds.height/2-20,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual((await save()).layers,initial.layers);assert.equal(await page.locator('.element-dragging,.element-drop-target,.element-drop-blocked').count(),0);
 for(const id of ['locked','hidden','group','source']){await source().dragTo(header(id));assert.deepEqual((await save()).layers,initial.layers);assert.equal(await page.locator('#undo').isDisabled(),true);}
 await source().dragTo(header('target'));let doc=await save();assert.deepEqual(doc.layers.find(l=>l.id==='target').pathIds,['p']);assert.deepEqual(doc.layers.find(l=>l.id==='target').imageIds,['i']);assert.deepEqual(doc.layers.find(l=>l.id==='target').textIds,['t']);assert.equal(await page.locator('#selection-count').textContent(),'已选 3 个元素');
 await page.locator('#undo').click();assert.deepEqual((await save()).layers,initial.layers);assert.equal(await page.locator('#undo').isDisabled(),true);assert.equal(await page.locator('.element-dragging,.element-drop-target,.element-drop-blocked').count(),0);assert.deepEqual(errors,[]);
});
