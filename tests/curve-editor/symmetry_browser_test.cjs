// Isolated browser coverage for linked symmetry, preview and persisted relationships.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');

async function setup(t,decorate){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-linked-symmetry-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const source={id:'source',name:'原曲线',role:'cut',color:'#e04544',closed:false,dashed:true,note:'保留曲线和图层',nodes:[G.node(120,130,'smooth'),G.node(210,240,'symmetric'),G.node(140,350)]};
 source.nodes[0].out={x:190,y:110};source.nodes[1].in={x:180,y:180};source.nodes[1].out={x:240,y:300};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:900,height:550,title:'对称轴交互测试',paths:[source],originals:[],image:null,images:[],texts:[],opacity:.65,mirrorAxis:{a:{x:400,y:70},b:{x:400,y:450}}};
 initial.layers=[{id:'source-layer',name:'来源图层',visible:true,locked:false,pathIds:['source'],imageIds:[],textIds:[]}];
 if(decorate)decorate(initial);
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(6000);
 await page.goto(url);await page.locator('#paths [data-path="source"]').waitFor({state:'attached'});await expandLayerContents(page);await page.locator('.curve-item[data-path="source"] .curve-select').click();await page.locator('#panel-mirror > summary').click();
 const screen=async p=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},p);
 const move=async p=>{const q=await screen(p);await page.mouse.move(q.x,q.y);};
 const begin=async p=>{await move(p);await page.mouse.down();};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const axis=async()=>page.locator('#guides circle').evaluateAll(els=>Object.fromEntries(els.map((el,i)=>[i?'b':'a',{x:Number(el.getAttribute('cx')),y:Number(el.getAttribute('cy'))}])));
 const preview=page.locator('#mirror-preview path');
 const near=(a,b)=>{assert.ok(Math.abs(a.x-b.x)<.001,`${a.x} vs ${b.x}`);assert.ok(Math.abs(a.y-b.y)<.001,`${a.y} vs ${b.y}`);};
 return {page,initial,errors,screen,move,begin,save,axis,preview,near};
}

test('linked mirror preserves source choice, hidden axes, rotation, preview, undo and reload',async t=>{
 const {page,initial,errors,save}=await setup(t);
 assert.equal(await page.locator('#mirror-link').isChecked(),true);
 await page.locator('#mirror-copy').click();const linked=await save();
 assert.equal(linked.symmetryLinks.length,1);assert.equal(linked.paths.length,2);
 const source=linked.paths[0],copy=linked.paths[1];
 assert.equal(source.nodes[0].symmetry.out.side,0);assert.equal(copy.nodes[0].symmetry.out.side,1);
 await page.locator('#show-mirror-axis').uncheck();assert.equal(await page.locator('#guides line').count(),0);assert.equal(await page.locator('#axis-controls [data-axis]').count(),0);
 await page.locator('#symmetry-select-pair').click();await page.locator('#element-rotation').fill('37');await page.locator('#rotate-curves').click();
 const rotated=await save();assert.notDeepEqual(rotated.symmetryLinks[0].axis,linked.symmetryLinks[0].axis);
 await page.locator('.curve-item[data-path="source"] .curve-select').click();
 const n=rotated.paths[0].nodes[1];const pos=await page.locator('#viewport').evaluate((el,n)=>{const p=new DOMPoint(n.x,n.y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};},n);
 await page.mouse.click(pos.x,pos.y);await page.keyboard.press('ArrowRight');
 const modified=await save();await page.locator('#panel-mirror > summary').evaluate(el=>{if(!el.parentElement.open)el.click();});
 await page.locator('#symmetry-sync').click();assert.equal(await page.locator('#symmetry-dialog').evaluate(el=>el.open),true);assert.deepEqual((await page.evaluate(()=>fetch('/api/latest').then(r=>r.json()))).paths,modified.paths);
 if(process.env.CURVE_EDITOR_QA_DIR){await mkdir(process.env.CURVE_EDITOR_QA_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.CURVE_EDITOR_QA_DIR,'symmetry-preview.png')});}
 await page.locator('#symmetry-cancel').click();assert.deepEqual((await save()).paths,modified.paths);
 await page.locator('#symmetry-sync').click();await page.locator('#symmetry-apply').click();const synced=await save();
 const axis=synced.symmetryLinks[0].axis,expected=G.reflectPath(synced.paths[0],axis.a,axis.b);
 for(let i=0;i<expected.nodes.length;i++)for(const key of ['x','y'])assert.ok(Math.abs(synced.paths[1].nodes[i][key]-expected.nodes[i][key])<1e-7);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,modified.paths);await page.locator('#redo').click();assert.deepEqual((await save()).paths,synced.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('.curve-item').first().waitFor({state:'attached'});
 const restored=await save();assert.deepEqual(restored.symmetryLinks,synced.symmetryLinks);assert.equal(restored.mirrorAxisVisible,false);assert.deepEqual(restored.paths,synced.paths);
 await page.locator('#new').click();await page.locator('#project-file').setInputFiles({name:'对称作品.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(synced))});await page.locator('#paths [data-path="source"]').waitFor({state:'attached'});const imported=await save();assert.deepEqual(imported.symmetryLinks,synced.symmetryLinks);assert.deepEqual(imported.paths,synced.paths);assert.equal(imported.mirrorAxisVisible,false);assert.deepEqual(errors,[]);
});

test('independent mirror opt-out keeps ordinary geometry and has no link',async t=>{
 const {page,initial,errors,save}=await setup(t);await page.locator('#mirror-link').uncheck();await page.locator('#mirror-copy').click();const d=await save();
 assert.deepEqual(d.paths[0],initial.paths[0]);assert.ok(!d.symmetryLinks?.length);assert.equal(d.paths[1].nodes[0].symmetry,undefined);assert.deepEqual(errors,[]);
});


test('joined closed halves sync from clicked side after rotation and added node, ordinary copies detach',async t=>{
 const {page,errors,save,screen}=await setup(t,d=>{d.paths[0].nodes=[G.node(400,120),G.node(250,230),G.node(400,350)];});
 await page.locator('#mirror-copy').click();await page.locator('#symmetry-select-pair').click();
 await page.locator('.curve-item[data-path="source"] .curve-select').click({button:'right'});await page.getByRole('menuitem',{name:'合并曲线',exact:true}).click();await page.locator('#close-path').click();
 let d=await save();assert.equal(d.paths.length,1);assert.equal(d.paths[0].closed,true);const id=d.paths[0].id;
 await page.locator('[data-tool="select"]').click();await page.locator('#element-rotation').fill('23');await page.locator('#rotate-curves').click();d=await save();
 await page.locator('[data-tool="node"]').click();const p=d.paths[0],point=G.at(p.nodes[0],p.nodes[1],.5),q=await screen(point);
 await page.mouse.dblclick(q.x,q.y);await page.keyboard.press('ArrowRight');d=await save();assert.equal(d.paths[0].nodes.length,p.nodes.length+1);
 const r=await screen(G.at(d.paths[0].nodes[0],d.paths[0].nodes[1],.5));await page.mouse.click(r.x,r.y,{button:'right'});await page.getByRole('menuitem',{name:'以这一侧同步另一侧…',exact:true}).click();await page.locator('#symmetry-apply').click();
 const synced=await save();assert.equal(synced.paths[0].closed,true);assert.ok(synced.paths[0].nodes.length>d.paths[0].nodes.length);assert.equal(synced.symmetryLinks.length,1);
 await page.locator('.curve-item[data-path="'+id+'"] .curve-select').click();await page.locator('#copy-curves').click();await page.locator('#paste-curves').click();const copied=await save();assert.equal(copied.paths.length,2);assert.ok(copied.paths[1].nodes.every(n=>!n.symmetry));assert.deepEqual(copied.symmetryLinks,synced.symmetryLinks);assert.deepEqual(errors,[]);
});

test('node translation carries complete axes, unlink is undoable, and hidden counterpart blocks sync',async t=>{
 const {page,errors,save,screen}=await setup(t);await page.locator('#mirror-copy').click();await page.locator('#symmetry-select-pair').click();await page.locator('[data-tool="node"]').click();await page.locator('#select-all').click();
 const before=await save();await page.keyboard.press('ArrowRight');const moved=await save();assert.equal(moved.symmetryLinks[0].axis.a.x,before.symmetryLinks[0].axis.a.x+1);
 await page.locator('#panel-mirror > summary').evaluate(el=>{if(!el.parentElement.open)el.click();});await page.locator('#symmetry-unlink').click();assert.equal((await save()).symmetryLinks.length,0);await page.locator('#undo').click();assert.deepEqual((await save()).symmetryLinks,moved.symmetryLinks);
 const copy=moved.paths[1];await page.locator('.curve-item[data-path="'+copy.id+'"] .curve-visibility').click();await page.locator('.curve-item[data-path="source"] .curve-select').click();await page.locator('#symmetry-sync').click();assert.equal(await page.locator('#symmetry-dialog').evaluate(el=>el.open),false);assert.deepEqual((await save()).paths,moved.paths.map(p=>p.id===copy.id?{...p,visible:false}:p));assert.deepEqual(errors,[]);
});

for(const endpoint of [0,2])test(`deleting linked open endpoint ${endpoint} can still synchronize the shortened side`,async t=>{
 const {page,save,screen,errors}=await setup(t);await page.locator('#mirror-copy').click();await page.locator('.curve-item[data-path="source"] .curve-select').click();const before=await save(),q=await screen(before.paths[0].nodes[endpoint]);await page.mouse.click(q.x,q.y);await page.keyboard.press('Delete');
 await page.locator('.curve-item[data-path="source"] .curve-select').click();await page.locator('#panel-mirror > summary').evaluate(el=>{if(!el.parentElement.open)el.click();});await page.locator('#symmetry-sync').click();await page.locator('#symmetry-apply').click();const after=await save();assert.equal(after.paths[1].nodes.length,2);assert.deepEqual(errors,[]);
});

test('delete a half then regenerate previews without mutation and preserves undo and reload',async t=>{
 const {page,save,errors}=await setup(t);await page.locator('#mirror-copy').click();const linked=await save();
 await page.locator('.curve-item[data-path="'+linked.paths[1].id+'"] .curve-select').click({button:'right'});await page.getByRole('menuitem',{name:'删除曲线',exact:true}).click();const survivor=await save();assert.equal(survivor.paths.length,1);
 await page.locator('.curve-item[data-path="source"] .curve-select').click({button:'right'});
 await page.getByRole('menuitem',{name:'以这一侧重新生成另一侧…',exact:true}).click();
 assert.equal(await page.locator('#symmetry-dialog').evaluate(e=>e.open),true);assert.match(await page.locator('#symmetry-title').textContent(),/重新生成/);
 if(process.env.CURVE_EDITOR_QA_DIR){await mkdir(process.env.CURVE_EDITOR_QA_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.CURVE_EDITOR_QA_DIR,'symmetry-regenerate-preview.png')});}
 assert.equal(await page.locator('#symmetry-preview path').count(),3);await page.locator('#symmetry-cancel').click();assert.deepEqual((await save()).paths,survivor.paths);
 await page.locator('#symmetry-sync').click();await page.locator('#symmetry-apply').click();const regenerated=await save();
 assert.equal(regenerated.paths.length,2);assert.deepEqual(regenerated.paths[0],survivor.paths[0]);assert.notEqual(regenerated.paths[1].id,linked.paths[1].id);
 assert.deepEqual(regenerated.layers[0].pathIds,['source',regenerated.paths[1].id]);
 const expected=G.reflectPath(regenerated.paths[0],regenerated.symmetryLinks[0].axis.a,regenerated.symmetryLinks[0].axis.b);
 for(let i=0;i<expected.nodes.length;i++)for(const key of ['x','y','in','out'])assert.deepEqual(regenerated.paths[1].nodes[i][key],expected.nodes[i][key]);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,survivor.paths);await page.locator('#redo').click();assert.deepEqual((await save()).paths,regenerated.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('.curve-item').first().waitFor({state:'attached'});
 const restored=await save();assert.deepEqual(restored.paths,regenerated.paths);assert.deepEqual(restored.symmetryLinks,regenerated.symmetryLinks);assert.deepEqual(errors,[]);
});

test('delete a half then ordinary mirror uses the drawing axis and replaces the stale link',async t=>{
 const {page,save,errors}=await setup(t);await page.locator('#mirror-copy').click();const linked=await save();await page.locator('.curve-item[data-path="'+linked.paths[1].id+'"] .curve-select').click({button:'right'});await page.getByRole('menuitem',{name:'删除曲线',exact:true}).click();
 await page.locator('.curve-item[data-path="source"] .curve-select').click();await page.locator('#mirror-copy').click();const again=await save();
 assert.equal(again.paths.length,2);assert.equal(again.symmetryLinks.length,1);assert.notEqual(again.symmetryLinks[0].id,linked.symmetryLinks[0].id);
 assert.deepEqual(again.symmetryLinks[0].axis,again.mirrorAxis);assert.deepEqual(errors,[]);
});
