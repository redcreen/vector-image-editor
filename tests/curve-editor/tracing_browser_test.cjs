const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-trace-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','auto']);
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#curve-list button').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#history-storage').dataset.state!=='loading');
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='#f8fafb';ctx.fillRect(0,0,500,200);ctx.strokeStyle='#bac4ca';ctx.lineWidth=3;ctx.setLineDash([12,8]);ctx.beginPath();ctx.moveTo(25,80);ctx.lineTo(470,80);ctx.stroke();ctx.strokeStyle='#d95342';ctx.beginPath();ctx.moveTo(25,110);ctx.lineTo(470,110);ctx.stroke();return c.toDataURL();});
 await page.locator('#image-file').setInputFiles({name:'虚线.png',mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});await page.locator('[data-image].selected-image').waitFor();
 const image=await page.locator('image[data-image]').evaluate(e=>({x:Number(e.getAttribute('x')),y:Number(e.getAttribute('y')),width:Number(e.getAttribute('width')),height:Number(e.getAttribute('height')),id:e.getAttribute('data-image')}));
 const mouse=async(x,y,click=false)=>{const p=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});await page.mouse.move(p.x,p.y);if(click)await page.mouse.click(p.x,p.y);};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,errors,image,mouse,save};
}
test('hover previews without mutation; click creates editable dashed geometry with undo, save and reopen',async t=>{
 const {page,errors,image,mouse,save}=await setup(t);const before=await save();
 await page.locator('[data-tool="trace"]').click();await mouse(image.x+60,image.y+80);
 await page.locator('#trace-preview path').last().waitFor({state:'attached'});assert.equal(await page.locator('#curve-list button').count(),1);
 await mouse(image.x+60,image.y+80,true);await page.waitForFunction(()=>document.querySelectorAll('#curve-list button').length===2);
 const traced=await save(),curve=traced.paths.at(-1);assert.equal(curve.dashed,true);assert.ok(curve.nodes.length<=5);
 assert.ok(Math.min(...curve.nodes.map(n=>n.x))<image.x+30);assert.ok(Math.max(...curve.nodes.map(n=>n.x))>image.x+440);
 assert.deepEqual(traced.images,before.images);assert.ok(traced.layers.find(l=>l.pathIds.includes(curve.id)).imageIds.length===0);
 await page.locator('#undo').click();assert.equal(await page.locator('#curve-list button').count(),1);await page.locator('#redo').click();assert.equal(await page.locator('#curve-list button').count(),2);
 const n=curve.nodes[0];await mouse(n.x,n.y,true);await page.locator('#node-y').fill(String(n.y+12));await page.locator('#node-y').press('Tab');const moved=await save();assert.ok(Math.abs(moved.paths.at(-1).nodes[0].y-n.y-12)<.1);
 await page.locator('#project-file').setInputFiles({name:'保存.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(moved))});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已打开'));
 const reopened=await save();assert.deepEqual(reopened.paths.at(-1),moved.paths.at(-1));assert.deepEqual(errors,[]);
});
test('locked reference images can be traced; hidden images and stale previews cannot create curves',async t=>{
 const {page,errors,image,mouse,save}=await setup(t);
 const layer=page.locator('.layer-row').filter({has:page.locator('[data-image]')});
 // Import selects its layer. Lock the active row, leaving the raster available as a reference.
 const row=page.locator('#layer-list .layer-row').first();await row.locator('[data-action="locked"]').click();
 await page.keyboard.press('t');await mouse(image.x+60,image.y+80);await page.locator('#trace-preview path').last().waitFor({state:'attached'});
 await page.keyboard.press('Escape');assert.equal(await page.locator('#trace-preview path').count(),0);assert.equal((await save()).paths.length,1);
 await page.keyboard.press('t');await mouse(image.x+60,image.y+80);await page.locator('#trace-preview path').last().waitFor({state:'attached'});
 await row.locator('button[data-action="visible"]').click();assert.equal(await page.locator('#trace-preview path').count(),0);
 await mouse(image.x+60,image.y+80,true);assert.equal((await save()).paths.length,1);assert.deepEqual(errors,[]);
});
test('tracing follows a moved and scaled image and blank clicks do not mutate the document',async t=>{
 const {page,errors,image,mouse,save}=await setup(t);
 await page.locator('#panel-properties').evaluate(el=>el.open=true);
 for(const [id,value] of [['element-x',250],['element-y',220],['element-width',250]]){await page.locator('#'+id).fill(String(value));await page.locator('#'+id).press('Tab');}
 await page.locator('[data-tool="trace"]').click();await mouse(275,260);await page.locator('#trace-preview path').last().waitFor({state:'attached'});await mouse(275,260,true);
 await page.waitForFunction(()=>document.querySelectorAll('#curve-list button').length===2);const d=await save(),curve=d.paths.at(-1);
 assert.ok(Math.min(...curve.nodes.map(n=>n.x))>=260&&Math.max(...curve.nodes.map(n=>n.x))<=478);assert.ok(curve.nodes.every(n=>Math.abs(n.y-260)<2));
 await page.keyboard.press('t');await mouse(275,310,true);assert.equal((await save()).paths.length,2);assert.deepEqual(errors,[]);
});
test('the annotated reference finds faint gray dashes and leaves green label leaders outside the default preview',async t=>{
 const {page,errors,mouse,save}=await setup(t);
 await page.locator('#image-file').setInputFiles(path.join(__dirname,'fixtures/annotated-dashes.png'));
 await page.waitForFunction(()=>document.querySelectorAll('image[data-image]').length===2);
 const image=await page.locator('image[data-image]').last().evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height'),data:e.getAttribute('href')}));
 const results=await page.evaluate(async data=>{
  const im=new Image();im.src=data;await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const raster=ctx.getImageData(0,0,c.width,c.height);
  return [{x:179,y:420},{x:350,y:262},{x:275,y:278},{x:275,y:273}].map(seed=>{const r=window.CurveTracing.trace(raster,seed);return r&&{...r,points:undefined,bounds:[Math.min(...r.points.map(p=>p.x)),Math.min(...r.points.map(p=>p.y)),Math.max(...r.points.map(p=>p.x)),Math.max(...r.points.map(p=>p.y))]};});
 },image.data);
 const [gray,green,top,jitter]=results;assert.ok(gray&&green&&top&&jitter);
 assert.ok(gray.bounds[0]<190&&gray.bounds[2]>700&&gray.bounds[3]>600);assert.ok(gray.nodes.length<80);
 assert.ok(green.bounds[1]>=255&&green.bounds[3]<=270);assert.equal(green.dashed,true);assert.ok(green.nodes.length<8);
 assert.ok(top.bounds[2]<470);assert.equal(jitter.color,top.color);
 await page.locator('[data-tool="trace"]').click();await mouse(image.x+179,image.y+420);await page.locator('#trace-preview path').last().waitFor({state:'attached'});
 if(process.env.CURVE_EDITOR_TRACE_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_TRACE_SCREENSHOT,fullPage:true});
 await mouse(image.x+179,image.y+420,true);await page.waitForFunction(()=>document.querySelectorAll('#curve-list button').length===2);
 const d=await save();assert.ok(d.paths.at(-1).nodes.length>20);assert.equal(d.paths.at(-1).dashed,true);assert.deepEqual(errors,[]);
});
test('unsaved extraction and its undo history survive refresh; subsequent images stay below their extracted curves',async t=>{
 const {page,image,mouse,save,errors}=await setup(t);
 await page.locator('[data-tool="trace"]').click();await mouse(image.x+60,image.y+80,true);await page.waitForFunction(()=>document.querySelectorAll('#curve-list button').length===2);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 assert.equal(await page.locator('#curve-list button').count(),2);
 await page.locator('#undo').click();assert.equal(await page.locator('#curve-list button').count(),1);await page.locator('#redo').click();
 await page.locator('#image-file').setInputFiles(path.join(__dirname,'fixtures/annotated-dashes.png'));await page.waitForFunction(()=>document.querySelectorAll('image[data-image]').length===2);
 const second=await page.locator('image[data-image]').last().evaluate(e=>({id:e.getAttribute('data-image'),x:+e.getAttribute('x'),y:+e.getAttribute('y')}));
 await page.locator('[data-tool="trace"]').click();await mouse(second.x+350,second.y+262,true);await page.waitForFunction(()=>document.querySelectorAll('#curve-list button').length===3);
 const d=await save(),source=d.layers.findIndex(l=>l.imageIds.includes(second.id)),output=d.layers.findIndex(l=>l.pathIds.includes(d.paths.at(-1).id));assert.ok(output>source);assert.deepEqual(errors,[]);
});
test('a transparent overlaid PNG allows extracting the visible reference below it',async t=>{
 const {page,image,mouse,save,errors}=await setup(t);
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=500;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='green';ctx.fillRect(430,150,30,30);return c.toDataURL();});
 await page.locator('#image-file').setInputFiles({name:'透明覆盖.png',mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});await page.waitForFunction(()=>document.querySelectorAll('image[data-image]').length===2);
 await page.locator('[data-tool="trace"]').click();await mouse(image.x+60,image.y+80);await page.locator('#trace-preview path').last().waitFor({state:'attached'});await mouse(image.x+60,image.y+80,true);
 const d=await save();assert.equal(d.paths.length,2);assert.equal(d.paths.at(-1).color,'#bac4ca');assert.deepEqual(errors,[]);
});
