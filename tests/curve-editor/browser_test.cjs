// Run with Node and Playwright available (NODE_PATH may point to the bundled runtime).
// Every run uses its own temporary project and headless browser.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const g=require('../../tools/curve-editor/geometry.js');

test('mirror copies, measurement tools, contiguous ranges and save/restore work through the UI',async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-browser-'));
 let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const square={id:'square',name:'矩形',color:'#e04544',role:'outline',note:'保留原作',closed:true,nodes:[[200,200],[350,200],[350,300],[200,300]].map(([x,y])=>g.node(x,y))};
 const arc={id:'arc',name:'弧线',note:'',color:'#176bce',role:'note',closed:false,nodes:[g.node(500,200,'smooth'),g.node(600,200,'symmetric')]};
 arc.nodes[0].out={x:500,y:300};arc.nodes[0].in={x:500,y:150};arc.nodes[1].in={x:600,y:300};arc.nodes[1].out={x:600,y:100};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'浏览器测试',paths:[square,arc],originals:[],image:null,opacity:.65};
 const saves=path.join(project,'work/curve_editor/sessions');await mkdir(saves,{recursive:true});
 await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve('tools/curve-editor/server.py'),'--project',project,'--port','auto']);
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#curve-list button').filter({hasText:'矩形'}).waitFor();
 async function clickPoint(x,y,options={}){const p=await page.locator('#viewport').evaluate((el,{x,y})=>{const p=new DOMPoint(x,y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};},{x,y});await page.mouse.click(p.x,p.y,options);}
 const saved=async()=>page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return saved();};
 const total=async()=>Number((await page.locator('#measure-total').textContent()).replace(/[^\d.]/g,''));

 // Define an arbitrary axis before selecting a curve, and keep the original.
 await page.locator('[data-tool="axis"]').click({timeout:2000});
 await clickPoint(500,100);await clickPoint(500,650);
 await page.locator('#curve-list button').filter({hasText:'矩形'}).click();
 await page.locator('#mirror-copy').click();
 assert.equal(await page.locator('#curve-list button').count(),3);
 await page.locator('#undo').click();assert.equal(await page.locator('#curve-list button').count(),2);
 await page.locator('#redo').click();assert.equal(await page.locator('#curve-list button').count(),3);
 let doc=await save();assert.deepEqual(doc.paths[0],square);assert.equal(doc.paths[2].name,'矩形 · 镜像');assert.notEqual(doc.paths[2].id,square.id);
 doc.paths[2].nodes.forEach((n,i)=>{assert.ok(Math.abs(n.x-(1000-square.nodes[i].x))<1e-6);assert.equal(n.mode,square.nodes[i].mode);});
 assert.ok(doc.mirrorAxis);await page.reload();await page.locator('#curve-list button').filter({hasText:'矩形 · 镜像'}).waitFor();
 assert.match(await page.locator('#axis-info').textContent(),/已设置/);

 // Measurement keyboard input must not nudge a previously selected artwork node.
 await page.locator('#curve-list button').filter({hasText:'弧线'}).click();await clickPoint(500,200);
 await page.locator('[data-tool="measure"]').click();await page.keyboard.press('ArrowRight');
 doc=await save();assert.deepEqual(doc.paths[1],arc);

 // Point measurements snap to anchors, accumulate and never add artwork.
 await page.locator('[data-tool="measure"]').click();await page.locator('[data-measure="points"]').click();
 await clickPoint(202,201);await clickPoint(350,200);await clickPoint(350,300);
 assert.equal(await total(),250);assert.equal(await page.locator('#measure-details li').count(),2);
 await page.locator('#measure-finish').click();await clickPoint(100,100);await clickPoint(130,140);
 assert.equal(await total(),50);await page.keyboard.press('Backspace');assert.equal(await total(),0);

 // Whole-curve length is arc length (200), not the 100-pixel chord.
 await clickPoint(550,275,{button:'right'});
 await page.getByRole('menuitem',{name:'测量整条曲线'}).click();assert.equal(await total(),200);
 await page.locator('#zoom-in').click();assert.equal(await total(),200);await page.locator('#fit').click();
 // Segments are selected without inserting nodes or moving curves.
 await page.locator('[data-measure="segments"]').click();await clickPoint(275,200);
 await page.keyboard.down('Shift');await clickPoint(350,250);await page.keyboard.up('Shift');
 assert.equal(await total(),250);assert.equal(await page.locator('#measure-details li').count(),2);
 await page.locator('#measure-alternate').click();assert.equal(await total(),500);
 // Right-clicking within the selection must retain the selected range.
 await clickPoint(275,300,{button:'right'});
 await page.getByRole('menuitem',{name:'测量已选线段'}).click();assert.equal(await total(),500);
 doc=await save();assert.deepEqual(doc.paths[0],square);assert.deepEqual(doc.paths[1],arc);
 assert.equal(doc.paths.length,3);assert.equal(doc.measurement,undefined);
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();
 const exported=await (await downloadPromise).createReadStream();let svg='';for await(const chunk of exported)svg+=chunk;
 assert.equal((svg.match(/<path /g)||[]).length,3);assert.ok(!svg.includes('对称轴'));assert.ok(!svg.includes('<line '));
 assert.deepEqual(errors,[]);
 if(process.env.CURVE_EDITOR_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_SCREENSHOT,fullPage:true});
});
