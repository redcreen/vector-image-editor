const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
const {fixtureOptions}=require('./fixture_helpers.cjs');
async function setup(t,fixture){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-outline-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('#history-storage').dataset.state!=='loading');
 if(fixture)await page.locator('#image-file').setInputFiles(fixture);
 else{
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=360;c.height=300;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,360,300);ctx.fillStyle='#666';ctx.beginPath();ctx.moveTo(40,40);ctx.lineTo(140,40);ctx.lineTo(170,100);ctx.lineTo(200,40);ctx.lineTo(320,40);ctx.lineTo(320,260);ctx.lineTo(40,260);ctx.closePath();ctx.fill();ctx.strokeStyle='#999';ctx.lineWidth=2;for(let y=125;y<240;y+=12){ctx.beginPath();ctx.moveTo(60,y);ctx.lineTo(300,y);ctx.stroke();}ctx.fillStyle='white';ctx.fillRect(100,160,30,25);return c.toDataURL();});
  await page.locator('#image-file').setInputFiles({name:'有纹理的物体.png',mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});
 }
 await page.locator('image[data-image]').waitFor();
 await expandLayerContents(page);
 const image=await page.locator('image[data-image]').evaluate(e=>({x:+e.getAttribute('x'),y:+e.getAttribute('y'),width:+e.getAttribute('width'),height:+e.getAttribute('height')}));
 const mouse=async(x,y,click=false)=>{const p=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});await page.mouse.move(p.x,p.y);if(click)await page.mouse.click(p.x,p.y);};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,errors,image,mouse,save};
}
test('separate extraction tools preview a single concave outer boundary, preserve the image, and support undo and restoration',async t=>{
 const {page,errors,image,mouse,save}=await setup(t);const before=await save();
 await page.locator('[data-tool="outline"]').click();assert.equal(await page.locator('#outline-tolerance').isVisible(),true);assert.equal(await page.locator('#trace-gap').isVisible(),false);
 await mouse(image.x+220,image.y+180);await page.locator('#trace-preview path').last().waitFor({state:'attached'});assert.equal(await page.locator('#layer-list .curve-select').count(),1);
 await page.locator('[data-tool="trace"]').click();assert.equal(await page.locator('#trace-preview path').count(),0);assert.equal(await page.locator('#trace-gap').isVisible(),true);
 await page.keyboard.press('Shift+t');assert.equal(await page.locator('[data-tool="outline"]').getAttribute('aria-pressed'),'true');
 await mouse(image.x+220,image.y+180,true);await page.waitForFunction(()=>document.querySelectorAll('#layer-list .curve-select').length===2);
 const d=await save(),curve=d.paths.at(-1);assert.equal(curve.closed,true);assert.equal(curve.dashed,false);assert.match(curve.name,/外轮廓/);assert.ok(curve.nodes.length<40);
 assert.ok(curve.nodes.some(n=>Math.abs(n.x-image.x-170)<8&&Math.abs(n.y-image.y-100)<8));assert.deepEqual(d.images,before.images);
 await page.locator('#undo').click();assert.equal(await page.locator('#layer-list .curve-select').count(),1);assert.equal(await page.locator('[data-tool="outline"]').getAttribute('aria-pressed'),'true');
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 await expandLayerContents(page);assert.equal(await page.locator('[data-tool="outline"]').getAttribute('aria-pressed'),'true');await page.locator('#redo').click();assert.equal(await page.locator('#layer-list .curve-select').count(),2);
 await page.locator('#project-file').setInputFiles({name:'轮廓.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(d))});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('已打开'));
 assert.deepEqual((await save()).paths.at(-1),curve);assert.deepEqual(errors,[]);
});
test('outer contour follows moved and scaled locked references; background, cancellation and hidden images cannot create curves',async t=>{
 const {page,errors,mouse,save}=await setup(t);await page.locator('#panel-properties').evaluate(el=>el.open=true);
 for(const [id,value] of [['element-x',200],['element-y',200],['element-width',180]]){await page.locator('#'+id).fill(String(value));await page.locator('#'+id).press('Tab');}
 const layerId=await page.locator('#layer-list .layer-row').first().getAttribute('data-layer'),row=page.locator(`#layer-list .layer-row[data-layer="${layerId}"]`);await row.locator('[data-action="locked"]').click();await page.locator('[data-tool="outline"]').click();
 await mouse(205,205,true);assert.equal((await save()).paths.length,1);
 await mouse(310,290);await page.locator('#trace-preview path').last().waitFor({state:'attached'});await page.keyboard.press('Escape');assert.equal(await page.locator('#trace-preview path').count(),0);
 await page.keyboard.press('Shift+t');await mouse(310,290,true);await page.waitForFunction(()=>document.querySelectorAll('#layer-list .curve-select').length===2);
 const curve=(await save()).paths.at(-1);assert.ok(curve.nodes.every(n=>n.x>=218&&n.x<=362&&n.y>=218&&n.y<=332));
 await page.keyboard.press('Shift+t');await mouse(310,290);await page.locator('#trace-preview path').last().waitFor({state:'attached'});await row.locator('[data-action="visible"]').click();assert.equal(await page.locator('#trace-preview path').count(),0);
 await mouse(310,290,true);assert.equal((await save()).paths.length,2);assert.deepEqual(errors,[]);
});
test('the textured fabric photo produces one closed editable exterior with its top notch intact',fixtureOptions('textured-object.png'),async t=>{
 const {page,errors,image,mouse,save}=await setup(t,path.join(__dirname,'fixtures/textured-object.png'));
 await page.locator('[data-tool="outline"]').click();await mouse(image.x+560,image.y+600);await page.locator('#trace-preview path').last().waitFor({state:'attached'});
 if(process.env.CURVE_EDITOR_OUTLINE_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_OUTLINE_SCREENSHOT,fullPage:true});
 await mouse(image.x+560,image.y+600,true);await page.waitForFunction(()=>document.querySelectorAll('#layer-list .curve-select').length===2);
 const curve=(await save()).paths.at(-1);assert.equal(curve.closed,true);assert.equal(curve.dashed,false);assert.ok(curve.nodes.length>10&&curve.nodes.length<200);
 const xs=curve.nodes.map(n=>n.x-image.x),ys=curve.nodes.map(n=>n.y-image.y);assert.ok(Math.min(...xs)>170&&Math.min(...xs)<260);assert.ok(Math.max(...xs)>930&&Math.max(...xs)<1050);assert.ok(Math.min(...ys)>45&&Math.min(...ys)<130);assert.ok(Math.max(...ys)>1270&&Math.max(...ys)<1360);
 // Default cleanup rounds the noisy tip by up to 8 px; the deep notch remains.
 assert.ok(curve.nodes.some(n=>n.x-image.x>705&&n.x-image.x<745&&n.y-image.y>=225&&n.y-image.y<255));assert.deepEqual(errors,[]);
});
test('denoising and fitting error update the photo preview independently without modifying existing curves',fixtureOptions('textured-object.png'),async t=>{
 const {page,errors,image,mouse,save}=await setup(t,path.join(__dirname,'fixtures/textured-object.png'));
 await page.locator('[data-tool="outline"]').click();
 assert.equal(await page.locator('#outline-denoise').count(),1,'outer contour has a separate fringe removal control');
 assert.equal(await page.locator('#outline-denoise').inputValue(),'8');
 assert.equal(await page.locator('#outline-smoothing').inputValue(),'2');
 const before=await save();
 const update=async(id,value)=>page.locator('#'+id).evaluate((el,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},value);
 const preview=async()=>{await page.waitForFunction(()=>document.querySelector('#trace-summary').textContent.includes('点击生成'));return page.locator('#trace-preview path').last().getAttribute('d');};
 await update('outline-smoothing',3);
 await update('outline-denoise',0);await mouse(image.x+560,image.y+600);const raw=await preview();
 await update('outline-denoise',16);const clean=await preview();assert.notEqual(clean,raw);
 assert.equal(await page.locator('#outline-denoise-value').textContent(),'16 px');
 assert.deepEqual((await save()).paths,before.paths,'preview parameter changes do not touch the artwork');
 await mouse(image.x+560,image.y+600);await preview();
 await update('outline-smoothing',1);const tight=await preview();assert.notEqual(tight,clean);
 await update('outline-smoothing',3);assert.equal(await preview(),clean);
 if(process.env.CURVE_EDITOR_OUTLINE_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_OUTLINE_SCREENSHOT,fullPage:true});
 await mouse(image.x+560,image.y+600,true);await page.waitForFunction(()=>document.querySelectorAll('#layer-list .curve-select').length===2);
 const generated=(await save()).paths.at(-1);assert.ok(generated.nodes.length<100,'denoised photo should use fewer than 100 editable nodes');
 assert.equal(generated.closed,true);assert.deepEqual((await save()).images,before.images);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,before.paths);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths.at(-1),generated);
 await page.keyboard.press('t');assert.equal(await page.locator('#outline-denoise').isVisible(),false);
 assert.equal(await page.locator('#trace-smoothing').inputValue(),'2');assert.deepEqual(errors,[]);
});
