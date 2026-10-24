// Uses isolated temporary projects; never edits or refreshes an existing canvas.
const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');const {tmpdir}=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const {chromium}=require('playwright');const G=require('../../tools/curve-editor/geometry.js');
async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-shapes-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const original={id:'original',name:'原曲线',color:'#e04544',role:'outline',closed:false,note:'保留',nodes:[G.node(100,100),G.node(300,100)]};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'形状测试',image:null,opacity:.65,originals:[],paths:[original],layers:[{id:'source',name:'原图层',visible:true,locked:false,pathIds:['original'],imageIds:[],textIds:[]},{id:'target',name:'形状图层',visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]}],calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'}};
 initial.images=[];initial.texts=[];
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(6000);
 await page.goto(url);await page.locator('.layer-row[data-layer="target"] .layer-select').click();
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});
 const move=async(x,y)=>{const p=await screen(x,y);await page.mouse.move(p.x,p.y);};
 const begin=async(kind,a,b)=>{await page.locator(`[data-tool="${kind}"]`).click();await move(...a);await page.mouse.down();await move(...b);};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,initial,errors,move,begin,save,screen};
}
test('rectangle and ellipse preview, near-equal hints, constraints, editable nodes and portable export',async t=>{
 const {page,initial,errors,move,begin,save}=await setup(t);
 await begin('rectangle',[100,100],[300,295]);
 assert.equal(await page.locator('#paths .svg-curve').count(),1);assert.match(await page.locator('#shape-preview').textContent(),/接近正方形/);
 if(process.env.CURVE_EDITOR_SHAPES_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_SHAPES_SCREENSHOT.replace(/\.png$/,'-preview.png'),fullPage:true});
 await move(300,220);assert.doesNotMatch(await page.locator('#shape-preview').textContent(),/接近正方形/);await page.mouse.up();
 let d=await save();assert.deepEqual(d.paths[0],initial.paths[0]);let rectangle=d.paths[1];assert.equal(rectangle.closed,true);assert.equal(rectangle.nodes.length,4);assert.deepEqual(d.layers.find(l=>l.id==='target').pathIds,[rectangle.id]);
 let b=G.pathBounds(rectangle);assert.ok(Math.abs(b.width-200)<.01&&Math.abs(b.height-120)<.01);
 assert.equal(await page.locator('[data-tool="rectangle"]').getAttribute('aria-pressed'),'true');
 await page.locator('#undo').click();assert.equal((await save()).paths.length,1);assert.equal(await page.locator('#undo').isDisabled(),true);await page.locator('#redo').click();assert.deepEqual((await save()).paths[1],rectangle);
 await begin('rectangle',[460,300],[360,205]);await page.keyboard.down('Shift');assert.match(await page.locator('#shape-preview').textContent(),/正方形/);await page.mouse.up();await page.keyboard.up('Shift');
 d=await save();b=G.pathBounds(d.paths.at(-1));assert.ok(Math.abs(b.width-b.height)<1e-6);
 await begin('ellipse',[350,420],[550,615]);assert.match(await page.locator('#shape-preview').textContent(),/接近圆形/);await page.keyboard.down('Shift');await page.mouse.up();await page.keyboard.up('Shift');
 d=await save();b=G.pathBounds(d.paths.at(-1));assert.ok(Math.abs(b.width-b.height)<1e-6);assert.ok(d.paths.at(-1).nodes.every(n=>G.dist(n,n.out)>0));
 await begin('ellipse',[750,500],[600,420]);await page.mouse.up();d=await save();const ellipse=d.paths.at(-1);b=G.pathBounds(ellipse);assert.ok(Math.abs(b.width-150)<.01&&Math.abs(b.height-80)<.01);
 await page.keyboard.press('F10');assert.equal(await page.locator('#handles .anchor').count(),4);const n=ellipse.nodes[0];await move(n.x,n.y);await page.mouse.down();await move(n.x+10,n.y+5);await page.mouse.up();assert.notDeepEqual((await save()).paths.at(-1).nodes,ellipse.nodes);await page.locator('#undo').click();
 for(const format of ['svg','ai','dxf']){const wait=page.waitForEvent('download');await page.locator('#export').click();await page.locator('#vector-export-format').selectOption(format);await page.locator('#vector-export-confirm').click();const download=await wait;assert.ok((await readFile(await download.path())).length>100);}
 await page.locator('[data-tool="ellipse"]').click();const wait=page.waitForEvent('download');await page.locator('#save-as').click();await page.locator('#save-as-confirm').click();const raw=JSON.parse(await readFile(await (await wait).path(),'utf8'));assert.ok(raw.operationHistory);
 assert.equal(await page.evaluate(async data=>(await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).status,raw),200);
 await page.locator('#project-file').setInputFiles({name:'形状副本.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});await page.locator('#status').filter({hasText:'已打开'}).waitFor();assert.deepEqual((await save()).paths,d.paths);
 await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.deepEqual((await save()).paths,d.paths);
 await page.locator('#undo').click();assert.equal((await save()).paths.length,4);await page.locator('#redo').click();assert.equal((await save()).paths.length,5);
 if(process.env.CURVE_EDITOR_SHAPES_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_SHAPES_SCREENSHOT,fullPage:true});assert.deepEqual(errors,[]);
});
test('cancelled, tiny and interrupted shapes leave content and undo history intact; layer gates apply',async t=>{
 const {page,initial,errors,move,begin,save}=await setup(t);
 for(const cancel of ['Escape','pointercancel','lostpointercapture','blur','v']){
  await begin('rectangle',[400,300],[600,450]);
  if(['Escape','v'].includes(cancel))await page.keyboard.press(cancel);else if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else await page.locator('#canvas').dispatchEvent(cancel);
  await page.mouse.up();assert.equal(await page.locator('#shape-preview path').count(),0);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 }
 await begin('ellipse',[400,300],[400,300]);await page.mouse.up();await begin('rectangle',[400,300],[400.1,400]);await page.mouse.up();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 for(const action of ['locked','visible']){await page.locator(`.layer-row[data-layer="target"] [data-action="${action}"]`).click();await begin('rectangle',[400,300],[600,450]);await page.mouse.up();assert.match(await page.locator('#status').textContent(),/图层/);assert.deepEqual((await save()).paths,initial.paths);await page.locator(`.layer-row[data-layer="target"] [data-action="${action}"]`).click();}
 assert.deepEqual(errors,[]);
});
test('shape previews survive temporary pan, Shift release restores free proportions and shortcuts remain usable',async t=>{
 const {page,errors,begin,move,save,screen}=await setup(t);
 await page.locator('#canvas').focus();await page.keyboard.press('r');assert.equal(await page.locator('[data-tool="rectangle"]').getAttribute('aria-pressed'),'true');await page.keyboard.press('e');assert.equal(await page.locator('[data-tool="ellipse"]').getAttribute('aria-pressed'),'true');
 await begin('ellipse',[200,200],[420,330]);await page.keyboard.down('Shift');const constrained=await page.locator('#shape-preview path').getAttribute('d');await page.keyboard.up('Shift');assert.notEqual(await page.locator('#shape-preview path').getAttribute('d'),constrained);
 const preview=await page.locator('#shape-preview path').getAttribute('d'),camera=await page.locator('#viewport').getAttribute('transform'),p=await screen(420,330);await page.keyboard.down('Control');await page.mouse.move(p.x+40,p.y+25);assert.notEqual(await page.locator('#viewport').getAttribute('transform'),camera);assert.equal(await page.locator('#shape-preview path').getAttribute('d'),preview);await page.keyboard.up('Control');await page.mouse.move(p.x+50,p.y+35);await page.mouse.up();
 assert.equal((await save()).paths.length,2);await page.locator('#undo').click();assert.equal((await save()).paths.length,1);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});
test('editing keys during a shape preview cannot change previously selected nodes',async t=>{
 const {page,initial,errors,begin,move,save}=await setup(t);
 await page.locator('[data-tool="node"]').click();await move(100,100);await page.mouse.down();await page.mouse.up();
 await begin('rectangle',[400,300],[600,450]);await page.keyboard.press('ArrowRight');await page.keyboard.press('Delete');await page.keyboard.press('Escape');await page.mouse.up();
 assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});
