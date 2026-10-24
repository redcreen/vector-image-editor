const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');const {tmpdir}=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
async function setup(t,mutate){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-position-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const nodes=[G.node(100,300),G.node(500,300),G.node(500,600)];nodes[0].out={x:200,y:100};nodes[1].in={x:400,y:100};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'},title:'点位标注测试',width:1000,height:700,paths:[{id:'p',name:'轮廓',role:'outline',note:'',closed:false,color:'#395d6c',nodes}],originals:[],image:null,opacity:.65};
 if(mutate)mutate(initial);
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL||'chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(6000);
 await page.goto(url);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});
 const click=async(x,y,button='left')=>{const p=await screen(x,y);await page.mouse.click(p.x,p.y,{button});};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,errors,initial,screen,click,save};
}
test('point labels snap to curves and nodes, reuse layer, edit, move, undo and recover',async t=>{
 const {page,errors,initial,click,save}=await setup(t);
 await click(300,150,'right');await page.getByRole('menuitem',{name:'添加点位标注…',exact:true}).click();await page.locator('#text-cancel').click();let d=await save();assert.equal(d.texts.length,0);assert.ok(!d.layers.some(l=>l.name==='位置标注'));
 await page.locator('[data-tool="position"]').click();await click(300,152);await page.locator('#new-text-content').fill('A-1');await page.locator('#text-confirm').click();assert.match(await page.locator('#text-error').innerText(),/英文字母或数字/);
 await page.locator('#new-text-content').fill('01');await page.locator('#text-confirm').click();d=await save();assert.equal(d.texts[0].content,'01');assert.ok(Math.abs(d.texts[0].positionMarker.x-300)<.01);assert.ok(Math.abs(d.texts[0].positionMarker.y-150)<.01);assert.deepEqual(d.paths,initial.paths);const layer=d.layers.find(l=>l.name==='位置标注');assert.ok(layer);assert.equal(await page.locator('#paths .position-marker').count(),1);
 await page.locator('[data-tool="node"]').click();await click(500,300,'right');await page.getByRole('menuitem',{name:'添加点位标注…',exact:true}).click();await page.locator('#new-text-content').fill('A2');await page.locator('#text-confirm').click();d=await save();assert.deepEqual(d.texts[1].positionMarker,{x:500,y:300,pathId:'p',attachment:{kind:'node',index:1}});assert.equal(d.layers.filter(l=>l.name==='位置标注').length,1);assert.equal(d.layers.find(l=>l.id===layer.id).textIds.length,2);
 await page.locator('[data-tool="select"]').click();await page.locator(`[data-text="${d.texts[1].id}"] rect`).click();
 await page.locator('#text-content').fill('B02');await page.locator('#text-content').blur();await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowRight');d=await save();assert.equal(d.texts[1].content,'B02');assert.deepEqual(d.texts[1].positionMarker,{x:510,y:300,pathId:'p',attachment:{kind:'node',index:1}});await page.locator('#undo').click();assert.deepEqual((await save()).texts[1].positionMarker,{x:500,y:300,pathId:'p',attachment:{kind:'node',index:1}});await page.locator('#redo').click();
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#paths .position-marker').first().waitFor();assert.equal(await page.locator('#paths .position-marker').count(),2);d=await save();assert.equal(d.texts[1].content,'B02');assert.equal(d.texts[1].positionMarker.x,510);
 const restored=d.texts[1];await page.locator(`[data-text="${restored.id}"] rect`).dblclick({position:{x:2,y:2}});assert.equal(await page.locator('#text-dialog-title').innerText(),'编辑点位标注');await page.locator('#new-text-content').fill('C03');await page.locator('#text-confirm').click();assert.equal((await save()).texts[1].content,'C03');await page.locator('#undo').click();assert.equal((await save()).texts[1].content,'B02');await page.locator('#delete-element').click();assert.equal((await save()).texts.length,1);await page.locator('#undo').click();assert.equal((await save()).texts.length,2);
 const row=page.locator(`#layer-list .layer-row[data-layer="${layer.id}"]`);await row.locator('[data-action="visible"]').click();assert.equal(await page.locator('#paths .position-marker').count(),0);await row.locator('[data-action="visible"]').click();await row.locator('[data-action="locked"]').click();await page.locator('[data-tool="position"]').click();await click(500,500);assert.equal(await page.locator('#text-dialog').isVisible(),false);assert.match(await page.locator('#status').innerText(),/隐藏或锁定/);await row.locator('[data-action="locked"]').click();
 const exportWait=page.waitForEvent('download');await page.locator('#export').click();await page.locator('#vector-export-format').selectOption('svg');await page.locator('#vector-export-confirm').click();const exported=await exportWait,xml=await readFile(await exported.path(),'utf8');assert.match(xml,/<circle/);assert.match(xml,/>01</);assert.match(xml,/>B02</);
 if(process.env.CURVE_EDITOR_POSITION_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_POSITION_SCREENSHOT,fullPage:true});assert.deepEqual(errors,[]);
});
test('annotation mode keeps nodes visible between labels and labels follow curve moves and rotations',async t=>{
 const {page,errors,initial,screen,click,save}=await setup(t);
 const anchors=page.locator('#handles .anchor[data-path="p"]');
 await click(300,150);assert.equal(await anchors.count(),3);
 await page.locator('[data-tool="position"]').click();assert.equal(await anchors.count(),3,'switching to annotation retains visible nodes');assert.equal(await page.locator('#handles [data-side]').count(),0);
 for(const [index,content] of [[0,'01'],[1,'A2']]){
  await anchors.nth(index).click();await page.locator('#new-text-content').fill(content);await page.locator('#text-confirm').click();
  assert.equal(await page.locator('[data-tool="position"]').getAttribute('aria-pressed'),'true');assert.equal(await anchors.count(),3,'creation retains nodes for the next label');
 }
 let d=await save();assert.deepEqual(d.paths,initial.paths);assert.equal(d.texts.length,2);assert.deepEqual(d.texts.map(t=>t.positionMarker.pathId),['p','p']);
 await anchors.nth(2).click();await page.locator('#text-cancel').click();assert.equal(await anchors.count(),3);assert.equal((await save()).texts.length,2);
 await page.locator('[data-tool="select"]').click();await click(500,500);await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowRight');let moved=await save();
 for(let i=0;i<2;i++){assert.equal(moved.texts[i].x,d.texts[i].x+10);assert.equal(moved.texts[i].positionMarker.x,d.texts[i].positionMarker.x+10);}
 const b=G.pathBounds(moved.paths[0]),cx=b.x+b.width/2,cy=b.y+b.height/2;
 await page.locator('#element-rotation').fill('90');await page.locator('#rotate-curves').click();let rotated=await save();
 for(let i=0;i<2;i++){const a=moved.texts[i],z=rotated.texts[i];assert.ok(Math.abs(z.positionMarker.x-(cx-(a.positionMarker.y-cy)))<1e-6);assert.ok(Math.abs(z.positionMarker.y-(cy+(a.positionMarker.x-cx)))<1e-6);assert.equal(z.rotation,0);assert.ok(Math.abs(z.x-(cx-(a.y-cy)))<1e-6);}
 await page.locator('#undo').click();assert.deepEqual((await save()).texts,moved.texts);await page.locator('#redo').click();assert.deepEqual((await save()).texts,rotated.texts);
 await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.deepEqual((await save()).texts,rotated.texts);
 await page.locator('#select-all').click();await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowDown');let all=await save();for(let i=0;i<2;i++)assert.equal(all.texts[i].positionMarker.y,rotated.texts[i].positionMarker.y+10,'mixed selection transforms each label once');
 await page.locator('[data-tool="node"]').click();await page.locator('#select-all').click();await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowRight');let nodesMoved=await save();for(let i=0;i<2;i++)assert.equal(nodesMoved.texts[i].positionMarker.x,all.texts[i].positionMarker.x+10,'moving all nodes moves curve annotations');
 const from=await screen(nodesMoved.paths[0].nodes[2].x,nodesMoved.paths[0].nodes[2].y);await page.keyboard.down('Alt');await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+25,from.y+15,{steps:4});await page.mouse.up();await page.keyboard.up('Alt');let dragged=await save();const dx=dragged.paths[0].nodes[0].x-nodesMoved.paths[0].nodes[0].x,dy=dragged.paths[0].nodes[0].y-nodesMoved.paths[0].nodes[0].y;assert.ok(Math.abs(dx)>1);for(let i=0;i<2;i++){assert.ok(Math.abs(dragged.texts[i].positionMarker.x-nodesMoved.texts[i].positionMarker.x-dx)<1e-6);assert.ok(Math.abs(dragged.texts[i].positionMarker.y-nodesMoved.texts[i].positionMarker.y-dy)<1e-6);}
 await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();await page.locator('#scale-keep-original').check();await page.locator('#element-scale-factor').fill('1.5');await page.locator('#scale-elements').click();const copies=await save(),copyPath=copies.paths.find(p=>p.id!=='p');
 assert.ok(copyPath);assert.deepEqual(copies.texts.slice(0,2),dragged.texts);assert.deepEqual(copies.texts.slice(2).map(t=>t.positionMarker.pathId),[copyPath.id,copyPath.id]);
 await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowRight');const copyMoved=await save();assert.deepEqual(copyMoved.texts.slice(0,2),dragged.texts);for(let i=2;i<4;i++)assert.equal(copyMoved.texts[i].positionMarker.x,copies.texts[i].positionMarker.x+10);
 assert.deepEqual(errors,[]);
});

test('node and curve labels follow live node and handle edits while text stays upright, including undo and reload',async t=>{
 const {page,errors,initial,screen,click,save}=await setup(t);
 const near=(a,b)=>assert.ok(Math.abs(a-b)<.02,`${a} != ${b}`);
 await page.locator('[data-tool="position"]').click();
 for(const [x,y,content] of [[100,300,'N01'],[300,150,'C02']]){await click(x,y);await page.locator('#new-text-content').fill(content);await page.locator('#text-confirm').click();await page.locator('#text-dialog').waitFor({state:'hidden'});}
 assert.deepEqual(errors,[]);assert.equal(await page.locator('#text-dialog').isVisible(),false);
 const before=await save();
 await page.locator('[data-tool="node"]').click();await page.locator('#handles .anchor[data-path="p"][data-node="0"]').click();
 const dragWorld=async(from,to,live)=>{const a=await screen(from.x,from.y),b=await screen(to.x,to.y);await page.keyboard.down('Alt');await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});if(live)await live();await page.mouse.up();await page.keyboard.up('Alt');};
 await dragWorld({x:100,y:300},{x:160,y:340},async()=>{near(Number(await page.locator('#paths .position-marker').first().getAttribute('cx')),160);});
 let moved=await save();
 const assertAttached=d=>{const p=d.paths[0],node=d.texts[0],curve=d.texts[1],a=curve.positionMarker.attachment;
  assert.deepEqual(node.positionMarker.attachment,{kind:'node',index:0});near(node.positionMarker.x,p.nodes[0].x);near(node.positionMarker.y,p.nodes[0].y);
  assert.equal(a.kind,'segment');assert.equal(a.index,0);near(a.t,.5);const point=G.at(p.nodes[0],p.nodes[1],a.t);near(curve.positionMarker.x,point.x);near(curve.positionMarker.y,point.y);
  for(let i=0;i<2;i++){const z=d.texts[i],b=before.texts[i];near(z.x-z.positionMarker.x,b.x-b.positionMarker.x);near(z.y-z.positionMarker.y,b.y-b.positionMarker.y);assert.equal(z.rotation||0,0);}
 };
 assertAttached(moved);assert.notEqual(moved.texts[1].positionMarker.y,before.texts[1].positionMarker.y);
 const handle=moved.paths[0].nodes[0].out;await dragWorld(handle,{x:handle.x+30,y:handle.y+65});let curved=await save();assertAttached(curved);assert.notEqual(curved.texts[1].positionMarker.y,moved.texts[1].positionMarker.y);near(curved.texts[0].positionMarker.x,moved.texts[0].positionMarker.x);
 await page.locator('#node-x').fill('180');await page.locator('#node-x').blur();let field=await save();assertAttached(field);near(field.texts[0].positionMarker.x,180);
 await page.locator('#undo').click();assert.deepEqual((await save()).texts,curved.texts);await page.locator('#redo').click();assert.deepEqual((await save()).texts,field.texts);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.deepEqual((await save()).texts,field.texts);
 await page.locator('#handles .anchor[data-path="p"][data-node="0"]').click();await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowDown');let reloaded=await save();assertAttached(reloaded);near(reloaded.texts[0].positionMarker.y,field.texts[0].positionMarker.y+10);
 await page.locator('#straight').click();const straightened=await save();assertAttached(straightened);assert.notEqual(straightened.texts[1].positionMarker.y,reloaded.texts[1].positionMarker.y);
 assert.deepEqual(errors,[]);
});


test('legacy node and curve labels acquire precise bindings on local edits without changing the loaded document',async t=>{
 const {page,errors,save}=await setup(t,d=>{d.texts=[
  {id:'old-node',name:'01',content:'01',x:510,y:280,fontSize:12,color:'#1685a6',rotation:180,positionMarker:{x:500,y:300,pathId:'p'}},
  {id:'old-curve',name:'C2',content:'C2',x:310,y:130,fontSize:12,color:'#1685a6',rotation:180,positionMarker:{x:300,y:150}}
 ];d.images=[];d.layers=[{id:'curves',name:'曲线',visible:true,locked:false,pathIds:['p'],imageIds:[],textIds:[]},{id:'labels',name:'位置标注',visible:true,locked:false,pathIds:[],imageIds:[],textIds:['old-node','old-curve']}];});
 const before=await save();assert.equal(before.texts[0].positionMarker.attachment,undefined);assert.equal(before.texts[1].positionMarker.pathId,undefined);
 await page.locator('#handles .anchor[data-path="p"][data-node="1"]').click();await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowRight');const after=await save();
 assert.equal(after.texts[0].positionMarker.x,510);assert.deepEqual(after.texts[0].positionMarker.attachment,{kind:'node',index:1});
 const a=after.texts[1].positionMarker.attachment;assert.equal(a.kind,'segment');assert.equal(after.texts[1].positionMarker.pathId,'p');const point=G.at(after.paths[0].nodes[0],after.paths[0].nodes[1],a.t);assert.ok(G.dist(point,after.texts[1].positionMarker)<.001);for(const text of after.texts)assert.equal(text.rotation,0);
 await page.locator('#undo').click();assert.deepEqual((await save()).texts,before.texts);await page.locator('#redo').click();assert.deepEqual((await save()).texts,after.texts);
 await page.locator('#break-node').click();const broken=await save(),owner=broken.texts[0].positionMarker.pathId;assert.notEqual(owner,'p');assert.deepEqual(broken.texts[0].positionMarker.attachment,{kind:'node',index:0});assert.equal(broken.texts[0].positionMarker.x,after.texts[0].positionMarker.x);
 await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowDown');const detached=await save();assert.equal(detached.texts[0].positionMarker.pathId,owner);assert.equal(detached.texts[0].positionMarker.y,broken.texts[0].positionMarker.y+10);assert.equal(detached.texts[0].rotation,0);assert.deepEqual(errors,[]);
});
