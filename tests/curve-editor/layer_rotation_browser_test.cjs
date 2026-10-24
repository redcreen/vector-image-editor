// All interaction and recovery tests run in an isolated temporary project.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),G=require('../../tools/curve-editor/geometry.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<.002,`${a} != ${b}`);
async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-layer-rotation-'));let server,browser;
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
test('each ordinary layer selects its contents for rotation, including text, with undo and recovery',async t=>{
 const {page,initial,row,expandLayer,save,rotate,errors}=await setup(t);
 for(const id of ['a','b','c']){
  await row(id).click();assert.equal(await page.locator('#element-count').textContent(),'1 个元素');assert.equal(await page.locator('#rotate-curves').isEnabled(),true);assert.equal(await page.locator('[data-rotate]').count(),1);
  await rotate(90);const result=await save();
  if(id==='a'){close(result.paths[0].nodes[0].x,200);close(result.paths[0].nodes[0].y,100);}
  if(id==='b')assert.equal(result.images[0].rotation,90);
  if(id==='c'){
   assert.equal(result.texts[0].rotation,90);assert.equal(result.texts[0].content,initial.texts[0].content);
   assert.match(await page.locator('#paths g[data-text="t"]').getAttribute('transform'),/^rotate\(90 /);
   const bounds=await page.locator('#paths g[data-text="t"] rect').boundingBox();close(Number(await page.locator('#element-width').inputValue())/Number(await page.locator('#element-height').inputValue()),bounds.width/bounds.height);
  }
  await page.locator('#undo').click();assert.deepEqual((await save()).texts,initial.texts);assert.deepEqual((await save()).paths,initial.paths);
 }
 await row('c').click();await rotate(30);const rotated=await save();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('[data-rotate]').waitFor();assert.deepEqual((await save()).texts,rotated.texts);
 await page.locator('#text-content').fill('仍可编辑\n旋转文字');await page.locator('#text-content').blur();assert.equal((await save()).texts[0].rotation,30);
 await row('empty').click();assert.equal(await page.locator('#rotate-curves').isDisabled(),true);await row('l').click();assert.equal(await page.locator('#rotate-curves').isDisabled(),true);assert.deepEqual(errors,[]);
});
test('arbitrary mixed layers and nested groups rotate together by handle, retain selection and skip hidden or locked items',async t=>{
 const {page,initial,row,save,rotate,errors}=await setup(t);
 await row('a').click();await row('c').click({modifiers:['Shift']});await row('group').click({modifiers:['Meta']});await row('b').click({modifiers:['Shift']});
 assert.equal(await page.locator('#element-count').textContent(),'4 个元素');const selected=await page.locator('.layer-row.selected').count();assert.equal(selected,4);
 const vals=await Promise.all(['x','y','width','height'].map(k=>page.locator('#element-'+k).inputValue()));const [x,y,w,h]=vals.map(Number),cx=x+w/2,cy=y+h/2;
 const center=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x:cx,y:cy});
 const handle=await page.locator('[data-rotate]').boundingBox(),hx=handle.x+handle.width/2,hy=handle.y+handle.height/2,r=center.y-hy;
 await page.mouse.move(hx,hy);await page.mouse.down();await page.keyboard.down('Shift');await page.mouse.move(center.x+r,center.y,{steps:10});await page.mouse.up();await page.keyboard.up('Shift');
 const rotated=await save();for(let j=0;j<2;j++){close(rotated.paths[j].nodes[0].x,cx-(initial.paths[j].nodes[0].y-cy));close(rotated.paths[j].nodes[0].y,cy+(initial.paths[j].nodes[0].x-cx));}
 if(process.env.CURVE_EDITOR_LAYER_ROTATION_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_LAYER_ROTATION_SCREENSHOT,fullPage:true});
 close(rotated.texts[0].x,cx-(initial.texts[0].y-cy));close(rotated.texts[0].y,cy+(initial.texts[0].x-cx));assert.equal(rotated.texts[0].rotation,90);assert.equal(rotated.images[0].rotation,90);
 assert.deepEqual(rotated.paths.slice(2),initial.paths.slice(2));assert.equal(await page.locator('.layer-row.selected').count(),selected);
 await page.locator('#undo').click();assert.deepEqual((await save()).texts,initial.texts);assert.equal(await page.locator('#undo').isDisabled(),true);await page.locator('#redo').click();assert.deepEqual((await save()).texts,rotated.texts);
 await rotate(-90);const restored=await save();close(restored.texts[0].x,initial.texts[0].x);close(restored.texts[0].y,initial.texts[0].y);
 await row('c').click();await row('a').click({modifiers:['Shift']});await row('a').click({modifiers:['Shift']});assert.equal(await page.locator('#element-count').textContent(),'1 个元素');assert.equal(await page.locator('#rotate-curves').isEnabled(),true);assert.deepEqual(errors,[]);
});
test('one mixed-content layer rotates all members and rotated text remains movable and resizable',async t=>{
 const {page,initial,row,expandLayer,save,rotate,errors}=await setup(t);
 await row('a').click();await row('b').click({modifiers:['Shift']});await row('c').click({modifiers:['Shift']});await page.locator('#merge-layers').click();
 const merged=await save(),id=merged.layers.find(l=>l.textIds.includes('t')).id;await row('empty').click();await row(id).click();assert.equal(await page.locator('#element-count').textContent(),'3 个元素');await rotate(45);
 const result=await save();assert.equal(result.images[0].rotation,45);assert.equal(result.texts[0].rotation,45);assert.notDeepEqual(result.paths[0].nodes,initial.paths[0].nodes);assert.deepEqual(result.paths.slice(1),initial.paths.slice(1));
 await expandLayer(id);await page.locator(`.layer-contents[data-owner="${id}"] [data-text="t"]`).click();const x=Number(await page.locator('#element-x').inputValue());await page.locator('#element-x').fill(String(x+30));await page.locator('#element-x').press('Enter');const moved=await save();close(moved.texts[0].x,result.texts[0].x+30);close(moved.texts[0].y,result.texts[0].y);assert.equal(moved.texts[0].rotation,45);
 const width=Number(await page.locator('#element-width').inputValue());await page.locator('#element-width').fill(String(width*2));await page.locator('#element-width').press('Enter');const scaled=await save();close(scaled.texts[0].fontSize,moved.texts[0].fontSize*2);assert.equal(scaled.texts[0].rotation,45);assert.deepEqual(scaled.images,result.images);assert.deepEqual(scaled.paths,result.paths);assert.deepEqual(errors,[]);
});

test('zoomed selections keep a reachable rotation handle and rotate precisely around the original center',async t=>{
 const {page,initial,row,save,errors}=await setup(t);
 await row('b').click();
 const screen=async p=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},p);
 const center={x:310,y:280},pivot=await screen(center);
 await page.mouse.move(pivot.x,pivot.y);await page.mouse.wheel(0,-2000);
 await page.waitForFunction(()=>document.querySelector('#viewport').getScreenCTM().a>10);
 const reachable=async()=>{
  const canvas=await page.locator('#canvas').boundingBox(),handle=await page.locator('[data-rotate]').boundingBox();
  assert.ok(handle.x>=canvas.x+8&&handle.y>=canvas.y+8&&handle.x+handle.width<=canvas.x+canvas.width-8&&handle.y+handle.height<=canvas.y+canvas.height-8,'entire rotation handle must stay inside visible canvas');
  for(const id of ['canvas-label','canvas-hint']){const label=await page.locator('#'+id).boundingBox();assert.ok(handle.x+handle.width<=label.x||handle.x>=label.x+label.width||handle.y+handle.height<=label.y||handle.y>=label.y+label.height,'rotation handle must not overlap canvas labels');}
  return {x:handle.x+handle.width/2,y:handle.y+handle.height/2};
 };
 let handle=await reachable(),c=await screen(center);
 await page.mouse.click(handle.x,handle.y);assert.equal(await page.locator('#undo').isDisabled(),true);
 // Follow a five-degree arc from the relocated handle, without snapping or a scale change.
 const radians=5*Math.PI/180,dx=handle.x-c.x,dy=handle.y-c.y,end={x:c.x+dx*Math.cos(radians)-dy*Math.sin(radians),y:c.y+dx*Math.sin(radians)+dy*Math.cos(radians)};
 const zoom=await page.locator('#zoom').textContent();
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:10});
 const following=await reachable();close(following.x,end.x);close(following.y,end.y);await page.mouse.up();
 const rotated=await save();close(rotated.images[0].rotation,5);close(rotated.images[0].x,initial.images[0].x);close(rotated.images[0].y,initial.images[0].y);assert.equal(await page.locator('#zoom').textContent(),zoom);
 await page.locator('#undo').click();assert.deepEqual((await save()).images,initial.images);await page.locator('#redo').click();close((await save()).images[0].rotation,5);
 // When the pivot is close to the viewport edge, retain a useful drag radius.
 const edgeCanvas=await page.locator('#canvas').boundingBox();c=await screen(center);await page.keyboard.down('Space');await page.mouse.move(c.x,c.y);await page.mouse.down();await page.mouse.move(c.x,edgeCanvas.y+56,{steps:5});await page.mouse.up();await page.keyboard.up('Space');handle=await reachable();c=await screen(center);assert.ok(Math.hypot(handle.x-c.x,handle.y-c.y)>=63,'clipping must not collapse the drag radius');
 // Pan until the actual pivot is outside the canvas, then resize the viewport.
 const canvas=await page.locator('#canvas').boundingBox();await page.keyboard.down('Space');await page.mouse.move(canvas.x+canvas.width*.8,canvas.y+canvas.height*.8);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.2,canvas.y+canvas.height*.2,{steps:5});await page.mouse.up();await page.keyboard.up('Space');
 await page.setViewportSize({width:1200,height:850});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));handle=await reachable();c=await screen(center);
 const visible=await page.locator('#canvas').boundingBox();assert.ok(c.x<visible.x||c.y<visible.y||c.x>visible.x+visible.width||c.y>visible.y+visible.height,'test pivot must be offscreen');
 const target={x:handle.x+12,y:handle.y+6},delta=(Math.atan2(target.y-c.y,target.x-c.x)-Math.atan2(handle.y-c.y,handle.x-c.x))*180/Math.PI;
 await page.mouse.move(handle.x,handle.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:5});await page.mouse.up();close((await save()).images[0].rotation,((5+delta)%360+360)%360);await reachable();
 await row('a').click();await row('b').click({modifiers:['Shift']});await row('c').click({modifiers:['Shift']});await reachable();assert.equal(await page.locator('#element-count').textContent(),'3 个元素');
 if(process.env.CURVE_EDITOR_ZOOM_ROTATION_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_ZOOM_ROTATION_SCREENSHOT,fullPage:true});
 assert.deepEqual(errors,[]);
});
