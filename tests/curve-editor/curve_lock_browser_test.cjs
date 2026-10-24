// All interaction and recovery tests run in an isolated temporary project.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),G=require('../../tools/curve-editor/geometry.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<.002,`${a} != ${b}`);
async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-curve-lock-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,x)=>({id,name:id,color:'#e04544',role:'outline',closed:false,note:'',nodes:[G.node(x,100),G.node(x+100,200)]});
 const layer=(id,pathIds=[],imageIds=[],textIds=[],extra={})=>({id,name:id,visible:true,locked:false,pathIds,imageIds,textIds,...extra});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'图层旋转',width:1000,height:700,image:null,opacity:1,originals:[],
  paths:[curve('p',100),curve('q',400),curve('hidden',600),curve('locked',700)],
  texts:[{id:'t',name:'文字',content:'AB\n旋转',x:500,y:300,fontSize:20,color:'#123456'}],
  images:[{id:'i',name:'图片',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=',x:250,y:250,width:120,height:60,opacity:1}],
  layers:[layer('a',['p']),layer('b',[],['i']),layer('c',[],[],['t']),layer('group',[],[],[],{kind:'group'}),layer('d',['q'],[],[],{parentId:'group'}),layer('h',['hidden'],[],[],{parentId:'group',visible:false}),layer('l',['locked'],[],[],{parentId:'group',locked:true}),layer('empty')]};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);
 await page.locator('.layer-row[data-layer="c"]').waitFor();const closed=page.locator('.panel-group:not([open]):not([data-panel="help"]) > summary');while(await closed.count())await closed.first().click();
 const header=id=>page.locator(`.layer-row[data-layer="${id}"]`),row=id=>header(id).locator('.layer-select');
 const expandLayer=async id=>{const button=header(id).locator('[data-action="collapse"]');if(await button.getAttribute('aria-expanded')==='false')await button.click();};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const rotate=async degrees=>{await page.locator('#element-rotation').fill(String(degrees));await page.locator('#rotate-curves').click();};
 return {page,initial,row,expandLayer,save,rotate,errors};
}
const curveRow=(page,id)=>page.locator(`.curve-item[data-path="${id}"]`);
const locked=(doc,id)=>doc.layers.flatMap(l=>l.items||[]).find(i=>i.type==='path'&&i.id===id)?.locked===true;
const screen=(page,point)=>page.locator('#viewport').evaluate((element,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(element.getScreenCTM());return {x:q.x,y:q.y};},point);
test('curve lock prevents direct edits and deletion, supports undo, redo, save and local recovery',async t=>{
 const {page,initial,row,expandLayer,save,errors}=await setup(t);await expandLayer('a');await curveRow(page,'p').locator('.curve-select').click();
 await curveRow(page,'p').getByRole('button',{name:'锁定曲线 p',exact:true}).click();
 assert.equal(await curveRow(page,'p').locator('.curve-select').isDisabled(),true);assert.equal(await curveRow(page,'p').getAttribute('draggable'),'false');
 assert.equal(await page.locator('#handles [data-path="p"]').count(),0);assert.equal(await page.locator('#delete-element').isDisabled(),true);
 const a=await screen(page,{x:150,y:150}),b=await screen(page,{x:180,y:170});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();await page.mouse.dblclick(a.x,a.y);await page.keyboard.press('ArrowRight');await page.keyboard.press('Delete');
 let result=await save();assert.deepEqual(result.paths,initial.paths);assert.equal(locked(result,'p'),true);
 await page.locator('#undo').click();assert.equal(locked(await save(),'p'),false);await page.locator('#redo').click();assert.equal(locked(await save(),'p'),true);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await expandLayer('a');assert.equal(await curveRow(page,'p').locator('.curve-select').isDisabled(),true);
 await curveRow(page,'p').getByRole('button',{name:'解锁曲线 p',exact:true}).click();assert.equal(await curveRow(page,'p').locator('.curve-select').isEnabled(),true);assert.equal(locked(await save(),'p'),false);assert.deepEqual(errors,[]);
});
test('a layer containing only locked curves rotates numerically, preserves locks and undo history',async t=>{
 const {page,initial,row,expandLayer,save,rotate,errors}=await setup(t);await expandLayer('a');await curveRow(page,'p').getByRole('button',{name:'锁定曲线 p',exact:true}).click();await row('a').click();
 assert.equal(await page.locator('#rotate-curves').isEnabled(),true);assert.equal(await page.locator('#delete-element').isDisabled(),true);assert.equal(await page.locator('[data-corner]').count(),0);
 if(process.env.CURVE_EDITOR_CURVE_LOCK_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_CURVE_LOCK_SCREENSHOT,fullPage:true});
 await rotate(90);let result=await save();close(result.paths[0].nodes[0].x,200);close(result.paths[0].nodes[0].y,100);assert.equal(locked(result,'p'),true);assert.deepEqual(result.paths.slice(1),initial.paths.slice(1));
 await page.locator('#undo').click();result=await save();assert.deepEqual(result.paths,initial.paths);assert.equal(locked(result,'p'),true);
 await page.locator('#redo').click();result=await save();close(result.paths[0].nodes[0].x,200);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();assert.equal(await page.locator('#rotate-curves').isEnabled(),true);await rotate(-90);result=await save();close(result.paths[0].nodes[0].x,100);close(result.paths[0].nodes[0].y,100);assert.equal(locked(result,'p'),true);assert.deepEqual(errors,[]);
});
test('group and mixed selections include curve locks during handle rotation but respect layer locks',async t=>{
 const {page,initial,row,expandLayer,save,errors}=await setup(t);await expandLayer('a');await curveRow(page,'p').getByRole('button',{name:'锁定曲线 p',exact:true}).click();await expandLayer('d');await curveRow(page,'q').getByRole('button',{name:'锁定曲线 q',exact:true}).click();
 await row('group').click();await row('a').click({modifiers:['Shift']});
 const pivot=page.locator('[data-rotation-center]');let c={x:Number(await pivot.getAttribute('cx')),y:Number(await pivot.getAttribute('cy'))};close(c.x,300);close(c.y,150);
 const target={x:350,y:250},pb=await pivot.boundingBox(),to=await screen(page,target);await page.mouse.move(pb.x+pb.width/2,pb.y+pb.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();
 const h=await page.locator('[data-rotate]').boundingBox(),start={x:h.x+h.width/2,y:h.y+h.height/2},center=await screen(page,target),end={x:center.x-(start.y-center.y),y:center.y+(start.x-center.x)};
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.keyboard.down('Shift');await page.mouse.move(end.x,end.y,{steps:10});await page.mouse.up();await page.keyboard.up('Shift');const result=await save();
 for(let j=0;j<2;j++){close(result.paths[j].nodes[0].x,target.x-(initial.paths[j].nodes[0].y-target.y));close(result.paths[j].nodes[0].y,target.y+(initial.paths[j].nodes[0].x-target.x));assert.equal(locked(result,result.paths[j].id),true);}
 assert.deepEqual(result.paths.slice(2),initial.paths.slice(2));assert.deepEqual(errors,[]);
});
test('mixed layer rotation includes locked siblings while selecting a curve directly does not',async t=>{
 const {page,row,expandLayer,save,rotate,errors}=await setup(t);await expandLayer('d');await curveRow(page,'q').locator('.curve-select').click();await page.locator('#element-layer').selectOption('a');await expandLayer('a');
 await curveRow(page,'p').getByRole('button',{name:'锁定曲线 p',exact:true}).click();await row('a').click();await rotate(90);let result=await save();
 close(result.paths[0].nodes[0].x,350);close(result.paths[0].nodes[0].y,-50);close(result.paths[1].nodes[0].x,350);close(result.paths[1].nodes[0].y,250);const lockedPath=result.paths[0];
 await curveRow(page,'q').locator('.curve-select').click();await rotate(90);result=await save();assert.deepEqual(result.paths[0],lockedPath);assert.equal(locked(result,'p'),true);assert.deepEqual(errors,[]);
});
test('locking during fitting ends its preview and retains completed edits without leaving writable handles',async t=>{
 const {page,row,expandLayer,save,errors}=await setup(t);await expandLayer('a');await curveRow(page,'p').locator('.curve-select').click();
 const point=await screen(page,{x:100,y:100});await page.mouse.click(point.x,point.y);await page.keyboard.press('ArrowRight');const before=await save();
 await curveRow(page,'p').locator('.curve-select').click();await page.keyboard.press('n');const target=await screen(page,{x:450,y:150});await page.mouse.click(target.x,target.y);await page.locator('#fitting-panel[data-phase="ready"]').waitFor();
 await curveRow(page,'p').getByRole('button',{name:'锁定曲线 p',exact:true}).click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'idle');assert.equal(await page.locator('#handles [data-path="p"]').count(),0);const after=await save();assert.deepEqual(after.paths,before.paths);assert.equal(locked(after,'p'),true);assert.deepEqual(errors,[]);
});
