// Run with Node and Playwright available (NODE_PATH may point to the bundled runtime).
// Every run uses its own temporary project and headless browser.
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
const serverScript=path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py');

test('axis drawing snaps near horizontal and vertical with matching preview and saved coordinates',async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-axis-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve={id:'snap-target',name:'吸附参考',note:'',color:'#e04544',role:'outline',closed:false,nodes:[g.node(680,510),g.node(720,510)]};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'对称轴吸附测试',paths:[curve],originals:[],image:null,opacity:.65};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});
 await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[serverScript,'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await expandPanels(page);await page.locator('.layer-row').waitFor();await expandLayerContents(page);await page.locator('#layer-list .curve-select').filter({hasText:'吸附参考'}).waitFor();
 const screen=async p=>page.locator('#viewport').evaluate((el,p)=>{const s=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:s.x,y:s.y};},p);
 const click=async p=>{const s=await screen(p);await page.mouse.click(s.x,s.y);};
 const move=async p=>{const s=await screen(p);await page.mouse.move(s.x,s.y);};
 const preview=async()=>page.locator('#guides circle').evaluateAll(els=>els.map(el=>({x:Number(el.getAttribute('cx')),y:Number(el.getAttribute('cy'))})));
 const near=(actual,expected)=>{assert.ok(Math.abs(actual.x-expected.x)<.001,`X: ${actual.x} vs ${expected.x}`);assert.ok(Math.abs(actual.y-expected.y)<.001,`Y: ${actual.y} vs ${expected.y}`);};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 async function start(a,b){await page.locator('[data-tool="axis"]').click();await click(a);await move(b);}
 async function finish(b,expected,direction){
  const [a,end]=await preview();near(end,expected);
  if(direction){assert.equal(end[direction==='水平'?'y':'x'],a[direction==='水平'?'y':'x']);assert.match(await page.locator('#guides text').textContent(),new RegExp(direction));}
  await click(b);const doc=await save();near(doc.mirrorAxis.a,a);near(doc.mirrorAxis.b,end);
  assert.deepEqual(doc.paths,initial.paths);return doc.mirrorAxis;
 }

 // Leaving the snap range releases the preview; returning snaps without Shift.
 await start({x:150,y:120},{x:600,y:145});
 near((await preview())[1],{x:600,y:120});
 await move({x:600,y:165});near((await preview())[1],{x:600,y:165});
 await move({x:600,y:145});const horizontal=await finish({x:600,y:145},{x:600,y:120},'水平');
 await page.locator('#zoom-in').click();
 await start({x:300,y:220},{x:314,y:500});const vertical=await finish({x:314,y:500},{x:300,y:500},'竖直');
 await page.locator('#undo').click();near((await save()).mirrorAxis.b,horizontal.b);
 await page.locator('#redo').click();near((await save()).mirrorAxis.b,vertical.b);
 await page.reload();await page.locator('.layer-row').waitFor();await expandLayerContents(page);await page.locator('#layer-list .curve-select').filter({hasText:'吸附参考'}).waitFor();
 near((await preview())[1],vertical.b);assert.match(await page.locator('#guides text').textContent(),/竖直/);
 await start({x:660,y:360},{x:250,y:340});await finish({x:250,y:340},{x:250,y:360},'水平');
 await start({x:750,y:560},{x:736,y:220});await finish({x:736,y:220},{x:750,y:220},'竖直');
 // Arbitrary directions and anchor snapping still work, including the first point.
 await start({x:150,y:120},{x:719,y:512});await finish({x:719,y:512},{x:720,y:510});
 await start({x:681,y:511},{x:250,y:489});await finish({x:250,y:489},{x:250,y:510},'水平');
 // Shift still constrains diagonal directions to 45 degrees.
 await page.locator('[data-tool="axis"]').click();await click({x:150,y:120});await page.keyboard.down('Shift');
 await move({x:350,y:285});const diagonal=(await preview())[1];assert.ok(Math.abs((diagonal.x-150)-(diagonal.y-120))<.001);
 await finish({x:350,y:285},diagonal);await page.keyboard.up('Shift');
 assert.deepEqual(errors,[]);
});

test('mirror copies, measurement tools, contiguous ranges and save/restore work through the UI',async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-browser-'));
 let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const square={id:'square',name:'矩形',color:'#e04544',role:'outline',note:'保留原作',closed:true,nodes:[[200,200],[350,200],[350,300],[200,300]].map(([x,y])=>g.node(x,y))};
 const arc={id:'arc',name:'弧线',note:'',color:'#176bce',role:'note',closed:false,nodes:[g.node(500,200,'smooth'),g.node(600,200,'symmetric')]};
 arc.nodes[0].out={x:500,y:300};arc.nodes[0].in={x:500,y:150};arc.nodes[1].in={x:600,y:300};arc.nodes[1].out={x:600,y:100};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'浏览器测试',paths:[square,arc],originals:[],image:null,opacity:.65};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});
 await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[serverScript,'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await expandPanels(page);await page.locator('.layer-row').waitFor();await expandLayerContents(page);await page.locator('#layer-list .curve-select').filter({hasText:'矩形'}).waitFor();
 async function clickPoint(x,y,options={}){const p=await page.locator('#viewport').evaluate((el,{x,y})=>{const p=new DOMPoint(x,y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};},{x,y});await page.mouse.click(p.x,p.y,options);}
 const saved=async()=>page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return saved();};
 const total=async()=>Number((await page.locator('#measure-total').textContent()).replace(/[^\d.]/g,''));

 // Define an arbitrary axis before selecting a curve, and keep the original.
 await page.locator('[data-tool="axis"]').click({timeout:2000});
 await clickPoint(500,100);await clickPoint(500,650);
 await page.locator('#layer-list .curve-select').filter({hasText:'矩形'}).click();
 await page.locator('#mirror-link').uncheck();await page.locator('#mirror-copy').click();
 assert.equal(await page.locator('#layer-list .curve-select').count(),3);
 await page.locator('#undo').click();assert.equal(await page.locator('#layer-list .curve-select').count(),2);
 await page.locator('#redo').click();assert.equal(await page.locator('#layer-list .curve-select').count(),3);
 let doc=await save();assert.deepEqual(doc.paths[0],square);assert.equal(doc.paths[2].name,'矩形 · 镜像');assert.notEqual(doc.paths[2].id,square.id);
 doc.paths[2].nodes.forEach((n,i)=>{assert.ok(Math.abs(n.x-(1000-square.nodes[i].x))<1e-6);assert.equal(n.mode,square.nodes[i].mode);});
 assert.ok(doc.mirrorAxis);await page.reload();await page.locator('.layer-row').waitFor();await expandLayerContents(page);await page.locator('#layer-list .curve-select').filter({hasText:'矩形 · 镜像'}).waitFor();
 assert.match(await page.locator('#axis-info').textContent(),/已设置/);

 // Measurement keyboard input must not nudge a previously selected artwork node.
 await page.locator('#layer-list .curve-select').filter({hasText:'弧线'}).click();await clickPoint(500,200);
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
 // Calibrate 100 image pixels as 10 cm; all existing measurements convert immediately.
 await page.locator('#calibrate').click({timeout:2000});await clickPoint(100,100);await clickPoint(200,100);
 await page.locator('#calibration-length').fill('0');await page.locator('#calibration-apply').click();
 assert.match(await page.locator('#status').textContent(),/长度/);assert.match(await page.locator('#measure-total').textContent(),/px/);
 await page.locator('#calibration-length').fill('10');await page.locator('#calibration-unit').selectOption('cm');await page.locator('#calibration-apply').click();
 assert.equal(await total(),50);assert.match(await page.locator('#measure-total').textContent(),/cm/);
 await page.locator('#measure-unit').selectOption('mm');assert.equal(await total(),500);
 assert.match(await page.locator('#measure-details').textContent(),/mm/);assert.match(await page.locator('#measure-overlay').textContent(),/mm/);
 await page.locator('#measure-unit').selectOption('cm');
 // Starting/canceling replacement calibration retains the active scale.
 await page.locator('#calibrate').click();await clickPoint(120,120);await page.keyboard.press('Escape');assert.equal(await total(),50);
 doc=await save();assert.equal(doc.calibration.length,10);assert.equal(doc.calibration.unit,'cm');assert.equal(doc.measureUnit,'cm');
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();await page.locator('#vector-export-format').selectOption('svg');await page.locator('#vector-export-confirm').click();
 const exported=await (await downloadPromise).createReadStream();let svg='';for await(const chunk of exported)svg+=chunk;
 assert.equal((svg.match(/<path /g)||[]).length,3);assert.ok(!svg.includes('对称轴'));assert.ok(!svg.includes('<line '));

 assert.deepEqual(doc.paths[0],square);assert.deepEqual(doc.paths[1],arc);
 await page.reload();await page.locator('.layer-row').waitFor();await expandLayerContents(page);await page.locator('#layer-list .curve-select').filter({hasText:'弧线'}).waitFor();
 assert.match(await page.locator('#calibration-info').textContent(),/已标定/);
 await clickPoint(550,275,{button:'right'});await page.getByRole('menuitem',{name:'测量整条曲线'}).click();assert.equal(await total(),20);
 await page.locator('#zoom-in').click();assert.equal(await total(),20);await page.locator('#fit').click();
 await page.locator('[data-measure="points"]').click();await clickPoint(200,200);await clickPoint(350,200);await clickPoint(350,300);assert.equal(await total(),25);
 // Invalid imported calibration leaves the current artwork and scale intact.
 await page.locator('#project-file').setInputFiles({name:'invalid-calibration.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...doc,calibration:{...doc.calibration,length:-1}}))});
 await page.locator('#status').filter({hasText:'打开失败'}).waitFor();
 assert.match(await page.locator('#status').textContent(),/打开失败/);assert.equal(await total(),25);
 await page.locator('#calibration-clear').click();assert.equal(await total(),250);assert.match(await page.locator('#measure-total').textContent(),/px/);
 await page.locator('#undo').click();assert.match(await page.locator('#calibration-info').textContent(),/已标定/);
 await clickPoint(550,275,{button:'right'});await page.getByRole('menuitem',{name:'测量整条曲线'}).click();assert.equal(await total(),20);
 await save();
 assert.deepEqual(errors,[]);
 if(process.env.CURVE_EDITOR_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_SCREENSHOT,fullPage:true});
 await page.locator('#new').click();assert.match(await page.locator('#calibration-info').textContent(),/未标定/);
});

test('history buttons and shortcuts restore multiple edits, group gestures and preserve redo on selection',async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-history-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve={id:'history-curve',name:'历史曲线',color:'#e04544',role:'outline',note:'',closed:false,nodes:[g.node(200,400),g.node(450,200),g.node(700,400)]};
 curve.nodes[0].out={x:300,y:400};curve.nodes[1].in={x:350,y:200};curve.nodes[1].out={x:550,y:200};curve.nodes[2].in={x:600,y:400};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'历史测试',paths:[curve],originals:[],image:null,opacity:.65,newNodeMode:'cusp'};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});
 await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[serverScript,'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',dialog=>dialog.accept());await page.goto(url);await expandPanels(page);await page.locator('.layer-row').waitFor();await expandLayerContents(page);await page.locator('#layer-list .curve-select').filter({hasText:'历史曲线'}).waitFor();
 const undo=page.locator('#undo'),redo=page.locator('#redo');
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,{x,y})=>{const p=new DOMPoint(x,y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};},{x,y});
 const click=async(x,y)=>{const p=await screen(x,y);await page.mouse.click(p.x,p.y);};
 const drag=async(x,y,dx,dy)=>{const a=await screen(x,y),b=await screen(x+dx,y+dy);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const counts=async(u,r)=>{assert.match(await undo.getAttribute('title'),new RegExp(`可撤销 ${u} 步`));assert.match(await redo.getAttribute('title'),new RegExp(`可重做 ${r} 步`));};

 assert.equal(await undo.isDisabled(),true);assert.equal(await redo.isDisabled(),true);
 assert.equal(await undo.locator('svg').count(),1);assert.equal(await redo.locator('svg').count(),1);
 // A click selects a node, but moving nodes, handles, and the whole curve each creates one step.
 await click(200,400);await counts(0,0);
 await drag(200,400,20,30);await counts(1,0);
 await drag(320,430,30,-40);await counts(2,0);
 await page.locator('[data-tool="select"]').click();await drag(220,430,40,20);await counts(3,0);
 const edited=await save();await page.locator('#delete-path').click();await counts(4,0);
 for(let i=0;i<4;i++)await undo.click();await counts(0,4);
 assert.deepEqual((await save()).paths,initial.paths);
 // Mere selection and a drag returning to its starting position keep all redo steps.
 await page.locator('[data-tool="node"]').click();await click(200,400);
 const a=await screen(200,400),b=await screen(210,410);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.mouse.move(a.x,a.y);await page.mouse.up();await counts(0,4);
 for(let i=0;i<3;i++)await redo.click();assert.deepEqual((await save()).paths,edited.paths);
 await redo.click();assert.deepEqual((await save()).paths,[]);await counts(4,0);
 await page.keyboard.press('Control+z');await counts(3,1);
 await page.keyboard.press('Control+Shift+z');await counts(4,0);
 await page.keyboard.press('Meta+z');await counts(3,1);
 await page.keyboard.press('Control+y');await counts(4,0);
 await undo.click();await page.locator('#layer-list .curve-select').click();await click(260,450);
 await page.keyboard.press('ArrowRight');await counts(4,0);assert.equal(await redo.isDisabled(),true);

 // Continuous typing is one edit, and range changes are one edit until change/blur.
 await page.locator('#path-name').focus();await page.locator('#path-name').press('ControlOrMeta+a');
 await page.locator('#path-name').pressSequentially('renamed curve');await counts(5,0);
 await undo.click();assert.equal(await page.locator('#path-name').inputValue(),'历史曲线');await redo.click();assert.equal(await page.locator('#path-name').inputValue(),'renamed curve');
 await page.locator('#opacity').evaluate(el=>{el.focus();for(const value of [60,45,30]){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}el.dispatchEvent(new Event('change',{bubbles:true}));});await counts(6,0);
 await undo.click();assert.equal(await page.locator('#opacity').inputValue(),'65');await redo.click();assert.equal(await page.locator('#opacity').inputValue(),'30');
 // A repeated node-mode choice with unchanged geometry is not a new edit.
 await page.locator('[data-mode="cusp"]').click();await counts(6,0);
 assert.equal((await save()).opacity,.3);
 // Drawing can resume at the same open path after undoing the latest node.
 await page.locator('#new').click();await click(100,100);await click(200,100);await click(300,100);
 await undo.click();await click(350,150);const drawn=await save();
 assert.equal(drawn.paths.length,1);assert.equal(drawn.paths[0].nodes.length,3);assert.ok(Math.abs(drawn.paths[0].nodes[2].x-350)<.001);
 // Clicking the SVG prevents the browser's normal blur; edits on different curves must stay separate.
 const second=JSON.parse(JSON.stringify(curve));second.id='second';second.name='第二条';second.nodes.forEach(n=>g.move(n,0,150));
 await page.locator('#project-file').setInputFiles({name:'two-curves.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...initial,paths:[curve,second]}))});
 await expandLayerContents(page);await page.locator('#layer-list .curve-select').filter({hasText:'第二条'}).waitFor();
 await page.locator('#path-name').fill('first renamed');await click(200,550);
 assert.equal(await page.locator('#path-name').inputValue(),'第二条');
 await page.locator('#path-name').fill('second renamed');await undo.click();
 assert.deepEqual((await save()).paths.map(p=>p.name),['first renamed','第二条']);
 await undo.click();assert.deepEqual((await save()).paths.map(p=>p.name),['历史曲线','第二条']);
 assert.deepEqual(errors,[]);
 if(process.env.CURVE_EDITOR_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_SCREENSHOT,fullPage:true});
});
