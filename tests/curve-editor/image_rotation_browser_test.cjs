// Uses an isolated project; never touches an open user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
async function expandPanels(page){const closed=page.locator('.panel-group:not([open]):not([data-panel="help"]) > summary');while(await closed.count())await closed.first().click();}

const g=require('../../tools/curve-editor/geometry.js');

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-image-rotation-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,points)=>({id,name:id,role:'outline',color:'#e04544',closed:false,note:'',nodes:points.map(([x,y])=>g.node(x,y))});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'},width:1000,height:700,title:'无限画布测试',paths:[curve('curve-a',[[100,100],[200,100],[200,200]]),curve('curve-b',[[400,100],[500,100],[500,200]]),curve('outside',[[1300,300],[1400,400]])],originals:[],image:null,opacity:.65,newNodeMode:'cusp'};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);await expandLayerContents(page);await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'outside'}).waitFor({state:'attached'});await expandPanels(page);
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,{x,y})=>{const p=new DOMPoint(x,y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};},{x,y});
 const click=async(x,y,shift=false)=>{if(shift)await page.keyboard.down('Shift');const p=await screen(x,y);await page.mouse.click(p.x,p.y);if(shift)await page.keyboard.up('Shift');};
 const drag=async(x,y,dx,dy,shift=false)=>{if(shift)await page.keyboard.down('Shift');const a=await screen(x,y),b=await screen(x+dx,y+dy);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();if(shift)await page.keyboard.up('Shift');};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const selectedIds=async()=>page.locator('#layer-list .layer-contents .curve-select[aria-pressed=true] span').allTextContents();
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,200,100);ctx.strokeStyle='#333';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(20,25);ctx.lineTo(180,25);ctx.stroke();ctx.fillStyle='#666';ctx.fillRect(40,45,120,40);return c.toDataURL();});
 await page.locator('#image-file').setInputFiles({name:'rotation.png',mimeType:'image/png',buffer:Buffer.from(data.split(',')[1],'base64')});await page.locator('image[data-image]').waitFor();await expandLayerContents(page);
 const set=async(id,value)=>{await page.locator('#'+id).fill(String(value));await page.locator('#'+id).press('Enter');};
 await set('element-x',300);await set('element-y',250);
 return {page,initial,errors,screen,click,drag,save,selectedIds,set};
}

test('image angle and handle rotation persist through history, moving, resizing and reopening',async t=>{
 const {page,save,set,drag,screen,errors}=await setup(t),before=await save(),original=before.images[0];
 assert.equal(await page.locator('#rotate-curves').isEnabled(),true);
 await set('element-rotation',90);const rotated=await save(),image=rotated.images[0];
 assert.equal(image.rotation,90);assert.equal(image.dataUrl,original.dataUrl);assert.equal(image.width,200);assert.equal(image.height,100);
 assert.equal(await page.locator('#paths image').getAttribute('transform'),'rotate(90 400 300)');
 assert.equal(Number(await page.locator('#element-width').inputValue()),100);assert.equal(Number(await page.locator('#element-height').inputValue()),200);
 assert.equal(await page.locator('#keep-ratio').isDisabled(),true);
 await page.locator('#undo').click();assert.deepEqual((await save()).images,before.images);
 await page.locator('#redo').click();assert.deepEqual((await save()).images,rotated.images);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('[data-rotate]').waitFor();
 assert.deepEqual((await save()).images,rotated.images);
 // This visible point is outside the original unrotated image rectangle.
 await page.locator('#deselect').click();await drag(400,220,30,20);const moved=await save();
 assert.ok(Math.abs(moved.images[0].x-330)<.001);assert.ok(Math.abs(moved.images[0].y-270)<.001);assert.equal(moved.images[0].rotation,90);
 await set('element-width',150);const scaled=await save();assert.ok(Math.abs(scaled.images[0].width-300)<.001);assert.ok(Math.abs(scaled.images[0].height-150)<.001);
 const b=await page.locator('#selection-overlay [data-rotate]').boundingBox(),cx=Number(await page.locator('#element-x').inputValue())+75,cy=Number(await page.locator('#element-y').inputValue())+150;
 const center=await screen(cx,cy),radius=center.y-(b.y+b.height/2),angle=28*Math.PI/180;
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.keyboard.down('Shift');await page.mouse.move(center.x+Math.sin(angle)*radius,center.y-Math.cos(angle)*radius,{steps:8});await page.mouse.up();await page.keyboard.up('Shift');
 const handled=await save();assert.ok(Math.abs(handled.images[0].rotation-120)<.001);
 await page.locator('#undo').click();assert.deepEqual((await save()).images,scaled.images);await page.locator('#redo').click();
 await page.locator('#project-file').setInputFiles({name:'rotated.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(handled))});await page.locator('#status').filter({hasText:'已打开'}).waitFor();await expandLayerContents(page);
 assert.deepEqual((await save()).images,handled.images);
 const row=page.locator('#layer-list .layer-row').filter({hasText:'rotation.png'});await row.locator('.layer-select').click();await page.locator('#layer-list .layer-contents [data-image]').click();await row.locator('[data-action="locked"]').click();
 assert.equal(await page.locator('#rotate-curves').isDisabled(),true);assert.equal(await page.locator('[data-rotate]').count(),0);
 await row.locator('[data-action="locked"]').click();await row.locator('.layer-select').click();await page.locator('#layer-list .layer-contents [data-image]').click();
 await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'curve-a'}).click({modifiers:['Shift']});
 const mixed=await save();await set('element-rotation',45);const mixedRotated=await save();assert.ok(Math.abs(mixedRotated.images[0].rotation-165)<.001);assert.notDeepEqual(mixedRotated.paths[0].nodes,mixed.paths[0].nodes);
 await page.locator('#undo').click();assert.deepEqual((await save()).images,mixed.images);assert.deepEqual(errors,[]);
 if(process.env.CURVE_EDITOR_IMAGE_ROTATION_SCREENSHOT){
  await row.locator('.layer-select').click();await page.locator('#layer-list .layer-contents [data-image]').click();
  await page.locator('#element-rotation').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.CURVE_EDITOR_IMAGE_ROTATION_SCREENSHOT,fullPage:true});
 }
});

test('line and outline extraction follow the rotated raster in world coordinates',async t=>{
 const {page,set,click,save,errors}=await setup(t);await set('element-rotation',90);const before=await save();
 await page.locator('[data-tool="trace"]').click();await click(425,240);await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===4);
 const line=(await save()).paths.at(-1);assert.ok(line.nodes.every(n=>Math.abs(n.x-425)<2));assert.ok(Math.min(...line.nodes.map(n=>n.y))<225);assert.ok(Math.max(...line.nodes.map(n=>n.y))>375);
 await page.locator('[data-tool="outline"]').click();await click(385,300);await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===5);
 const result=await save(),outline=result.paths.at(-1);assert.equal(outline.closed,true);const box=g.pathBounds(outline);
 assert.ok(Math.abs(box.x-365)<5);assert.ok(Math.abs(box.y-240)<5);assert.ok(Math.abs(box.width-40)<6);assert.ok(Math.abs(box.height-120)<6);assert.deepEqual(result.images,before.images);assert.deepEqual(errors,[]);
});

