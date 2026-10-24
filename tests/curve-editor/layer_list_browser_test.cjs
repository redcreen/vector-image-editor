// Isolated layer-list interactions, never reloads a user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const {chromium}=require('playwright');const G=require('../../tools/curve-editor/geometry.js');
const imageFile={name:'菜单导入.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=','base64')};

test('layer rows support icon actions, drag ordering, contextual rename/delete/import and undo',async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-layer-list-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'图层列表测试',width:1000,height:700,image:null,opacity:.65,originals:[],images:[],paths:[{id:'a',name:'曲线 A',color:'#e04544',role:'outline',closed:false,note:'',nodes:[G.node(100,100),G.node(200,200)]},{id:'c',name:'曲线 C',color:'#176bce',role:'outline',closed:false,note:'',nodes:[G.node(500,300),G.node(600,400)]}],layers:[{id:'layer-a',name:'图层 A',visible:true,locked:false,pathIds:['a'],imageIds:[]},{id:'layer-b',name:'图层 B',visible:true,locked:false,pathIds:[],imageIds:[]},{id:'layer-c',name:'图层 C',visible:true,locked:false,pathIds:['c'],imageIds:[]}]};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('.layer-row').filter({hasText:'图层 A'}).waitFor();
 const row=name=>page.locator('.layer-row').filter({hasText:name});
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const order=()=>page.locator('.layer-row').evaluateAll(rows=>rows.map(r=>r.dataset.layer));
 const context=async name=>{await row(name).locator('.layer-select').click({button:'right'});await page.getByRole('menu').waitFor();};
 const rename=async(name,value,key='Enter')=>{await context(name);await page.getByRole('menuitem',{name:'重命名图层',exact:true}).click();await page.getByRole('textbox',{name:'图层名称',exact:true}).fill(value);await page.keyboard.press(key);};
 assert.equal((await page.locator('#add-layer').textContent()).trim(),'');
 assert.equal(await page.locator('#add-layer').getAttribute('aria-label'),'新建图层');
 assert.equal(await page.locator('#layer-name,#layer-up,#layer-down,#delete-layer,#import-layer').count(),0);
 assert.equal(await page.locator('.actionbar #import').count(),1);
 assert.equal(await page.locator('header #import').count(),0);
 assert.equal(await row('图层 A').getByRole('button',{name:'隐藏图层 图层 A',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await row('图层 A').locator('[data-action="locked"]').getAttribute('title'),'锁定图层');
 assert.equal(await row('图层 A').locator('[data-action="delete"]').getAttribute('title'),'删除图层 图层 A');
 if(process.env.CURVE_EDITOR_LAYER_LIST_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_LAYER_LIST_SCREENSHOT,fullPage:true});

 await context('图层 C');const front=page.getByRole('menuitem',{name:'置顶',exact:true});
 assert.equal(await front.count(),1);assert.equal(await front.isDisabled(),true);await page.keyboard.press('Escape');
 await context('图层 A');assert.equal(await front.isEnabled(),true);await front.click();
 assert.deepEqual(await order(),['layer-a','layer-c','layer-b']);
 assert.deepEqual(await page.locator('#paths > g[data-layer]').evaluateAll(groups=>groups.map(g=>g.dataset.layer)),['layer-b','layer-c','layer-a']);
 const normalizedLayers=initial.layers.map(layer=>({...layer,textIds:[]}));
 let frontDoc=await save();assert.deepEqual(frontDoc.layers,[normalizedLayers[1],normalizedLayers[2],normalizedLayers[0]]);assert.deepEqual(frontDoc.paths,initial.paths);
 await page.locator('#undo').click();assert.deepEqual(await order(),['layer-c','layer-b','layer-a']);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();await save();await page.reload();await row('图层 A').waitFor();assert.deepEqual(await order(),['layer-a','layer-c','layer-b']);
 const frontHistory=await page.locator('#undo').getAttribute('title');await context('图层 A');assert.equal(await front.isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#undo').getAttribute('title'),frontHistory);
 // Bringing to front changes the current order only: dragging and new layers can still go above it.
 const bottom=await row('图层 B').boundingBox();await row('图层 A').locator('.layer-select').dragTo(row('图层 B'),{targetPosition:{x:20,y:bottom.height-2}});
 assert.deepEqual(await order(),['layer-c','layer-b','layer-a']);await page.locator('#undo').click();
 await page.locator('#add-layer').click();assert.equal((await order())[1],'layer-a');await page.locator('#undo').click();await page.locator('#undo').click();
 assert.deepEqual(await order(),['layer-c','layer-b','layer-a']);assert.equal(await page.locator('#undo').isDisabled(),true);
 await row('图层 A').locator('[data-action="visible"]').click();await row('图层 A').locator('[data-action="locked"]').click();
 await context('图层 A');assert.equal(await front.isEnabled(),true);await front.click();frontDoc=await save();
 assert.deepEqual(frontDoc.layers,[normalizedLayers[1],normalizedLayers[2],{...normalizedLayers[0],visible:false,locked:true}]);
 await page.locator('#undo').click();await page.locator('#undo').click();await page.locator('#undo').click();assert.deepEqual(await order(),['layer-c','layer-b','layer-a']);

 await row('图层 A').locator('.layer-select').dragTo(row('图层 C'),{targetPosition:{x:20,y:2}});
 assert.deepEqual(await order(),['layer-a','layer-c','layer-b']);let d=await save();assert.deepEqual(d.layers.map(l=>l.id),['layer-b','layer-c','layer-a']);assert.deepEqual(d.paths,initial.paths);
 await page.locator('#undo').click();assert.deepEqual(await order(),['layer-c','layer-b','layer-a']);await page.locator('#redo').click();
 const history=await page.locator('#undo').getAttribute('title');
 await row('图层 A').locator('.layer-select').dragTo(row('图层 A'));assert.equal(await page.locator('#undo').getAttribute('title'),history);
 const b=await row('图层 B').boundingBox();await row('图层 C').locator('.layer-select').dragTo(row('图层 B'),{targetPosition:{x:20,y:b.height-2}});
 assert.deepEqual(await order(),['layer-a','layer-b','layer-c']);await page.locator('#undo').click();assert.deepEqual(await order(),['layer-a','layer-c','layer-b']);

 await rename('图层 B','重命名图层');d=await save();assert.equal(d.layers.find(l=>l.id==='layer-b').name,'重命名图层');assert.deepEqual(d.paths,initial.paths);
 await page.locator('#undo').click();assert.equal(await row('图层 B').count(),1);await page.locator('#redo').click();
 const renameHistory=await page.locator('#undo').getAttribute('title');await rename('重命名图层','取消的名称','Escape');assert.equal(await row('重命名图层').count(),1);assert.equal(await page.locator('#undo').getAttribute('title'),renameHistory);
 await rename('重命名图层','   ');assert.equal(await row('重命名图层').count(),1);assert.equal(await page.locator('#undo').getAttribute('title'),renameHistory);
 await context('重命名图层');await page.getByRole('menuitem',{name:'重命名图层',exact:true}).click();await page.getByRole('textbox',{name:'图层名称',exact:true}).fill('点击确认图层');
 const lockBox=await page.locator('.layer-row[data-layer="layer-b"] [data-action="locked"]').boundingBox();await page.mouse.click(lockBox.x+lockBox.width/2,lockBox.y+lockBox.height/2);
 assert.equal(await row('点击确认图层').locator('[data-action="locked"]').getAttribute('aria-pressed'),'true');
 await page.locator('#undo').click();assert.equal(await row('点击确认图层').locator('[data-action="locked"]').getAttribute('aria-pressed'),'false');await page.locator('#undo').click();assert.equal(await row('重命名图层').count(),1);
 await context('重命名图层');await page.getByRole('menuitem',{name:'重命名图层',exact:true}).click();await page.getByRole('textbox',{name:'图层名称',exact:true}).fill('失焦保存');await save();assert.equal(await row('失焦保存').count(),1);await page.locator('#undo').click();
 await row('图层 A').locator('[data-action="delete"]').click();d=await save();assert.equal(d.layers.some(l=>l.id==='layer-a'),false);assert.deepEqual(d.paths,[initial.paths[1]]);
 await page.locator('#undo').click();assert.equal(await row('图层 A').count(),1);assert.deepEqual((await save()).paths,initial.paths);
 await context('重命名图层');await page.getByRole('menuitem',{name:'删除图层',exact:true}).click();assert.equal(await row('重命名图层').count(),0);await page.locator('#undo').click();
 await page.locator('#add-layer').click();assert.equal(await page.locator('.layer-row').count(),4);await page.locator('#undo').click();

 await context('重命名图层');let choosing=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'导入图片',exact:true}).click();await (await choosing).setFiles(imageFile);
 await row('菜单导入.png').waitFor();d=await save();assert.equal(d.images.length,1);assert.equal(d.layers.length,4);assert.deepEqual(d.paths,initial.paths);await page.locator('#undo').click();
 choosing=page.waitForEvent('filechooser');await page.locator('.actionbar #import').click();await (await choosing).setFiles({...imageFile,name:'操作区导入.png'});await row('操作区导入.png').waitFor();d=await save();assert.equal(d.images.length,1);await page.locator('#undo').click();
 const canvas=await page.locator('#canvas').boundingBox();await page.mouse.click(canvas.x+30,canvas.y+80,{button:'right'});choosing=page.waitForEvent('filechooser');await page.getByRole('menuitem',{name:'导入图片',exact:true}).click();await (await choosing).setFiles({...imageFile,name:'画板菜单导入.png'});await row('画板菜单导入.png').waitFor();await page.locator('#undo').click();
 await save();await page.reload();await row('重命名图层').waitFor();assert.deepEqual(await order(),['layer-a','layer-c','layer-b']);
 while(await page.locator('.layer-row').count()>1)await page.locator('.layer-row').first().locator('[data-action="delete"]').click();
 await page.locator('.layer-row [data-action="delete"]').click();assert.equal(await page.locator('.layer-row').count(),1);assert.equal((await save()).paths.length,0);await page.locator('#undo').click();assert.equal(await row('重命名图层').count(),1);
 assert.deepEqual(errors,[]);
});
