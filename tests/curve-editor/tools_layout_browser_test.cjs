// Isolated project and browser: never reloads an open user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');

async function setup(t,viewport={width:1440,height:900}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-tools-layout-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('.layer-row').waitFor();await expandLayerContents(page);await page.locator('#layer-list .curve-select').waitFor({state:'attached'});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,errors,settle,save};
}

async function dragSeparator(page,locator,dx){
 const box=await locator.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:8});await page.mouse.up();
}

function screenshotPath(suffix){
 const base=process.env.CURVE_EDITOR_TOOLS_SCREENSHOT;if(!base)return null;
 return /\.png$/i.test(base)?base.replace(/\.png$/i,`-${suffix}.png`):`${base}-${suffix}.png`;
}

const near=(a,b,tolerance=2)=>Math.abs(a-b)<=tolerance;

test('the full-height tools rail fits every tool without scrolling at supported desktop sizes',async t=>{
 const {page,errors,settle}=await setup(t);
 for(const viewport of [{width:1440,height:900},{width:1280,height:720},{width:1024,height:600},{width:1024,height:480}]){
  await page.setViewportSize(viewport);await settle();
  const geometry=await page.evaluate(()=>{
   const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const tools=document.querySelector('.tools'),list=document.getElementById('tool-list'),buttons=[...document.querySelectorAll('#tool-list > button')];
   return {layout:rect('#editor-layout'),tools:rect('.tools'),header:rect('header'),actionbar:rect('.actionbar'),
    toolsScroll:{x:tools.scrollWidth-tools.clientWidth,y:tools.scrollHeight-tools.clientHeight},listScroll:{x:list.scrollWidth-list.clientWidth,y:list.scrollHeight-list.clientHeight},
    buttons:buttons.map(button=>{const r=button.getBoundingClientRect(),icon=button.querySelector(':scope > b,:scope > svg')?.getBoundingClientRect(),labels=[...button.querySelectorAll(':scope > span')].map(e=>parseFloat(getComputedStyle(e).fontSize));return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,icon:icon&&{width:icon.width,height:icon.height},labels};})};
  });
  assert.ok(near(geometry.layout.x,0)&&near(geometry.layout.y,0)&&near(geometry.layout.width,viewport.width)&&near(geometry.layout.height,viewport.height),JSON.stringify({viewport,layout:geometry.layout}));
  assert.ok(near(geometry.tools.y,0)&&near(geometry.tools.bottom,viewport.height),JSON.stringify({viewport,tools:geometry.tools}));
  assert.ok(geometry.header.x>=geometry.tools.right-2&&geometry.actionbar.x>=geometry.tools.right-2,JSON.stringify({viewport,tools:geometry.tools,header:geometry.header,actionbar:geometry.actionbar}));
  assert.equal(geometry.buttons.length,14);
  assert.ok(geometry.buttons.every(r=>r.x>=geometry.tools.x-1&&r.right<=geometry.tools.right+1&&r.y>=0&&r.bottom<=viewport.height+1),JSON.stringify({viewport,buttons:geometry.buttons}));
  assert.ok(geometry.toolsScroll.x<=1&&geometry.toolsScroll.y<=1&&geometry.listScroll.x<=1&&geometry.listScroll.y<=1,JSON.stringify({viewport,toolsScroll:geometry.toolsScroll,listScroll:geometry.listScroll}));
  assert.ok(geometry.buttons.every(r=>r.icon&&r.icon.width<=20.1&&r.icon.height<=20.1&&r.labels.every(size=>size<=12.1)),JSON.stringify({viewport,buttons:geometry.buttons}));
  if(viewport.width===1440&&screenshotPath('default'))await page.screenshot({path:screenshotPath('default'),fullPage:true});
 }
 assert.deepEqual(errors,[]);
});

test('the tools separator changes columns, supports keyboard reset and keeps its width through collapse and reload',async t=>{
 const {page,errors,settle}=await setup(t),rail=page.locator('.tools'),handle=page.locator('#resize-tools');
 assert.equal(await handle.count(),1,'the tools rail needs a draggable right-edge separator');
 assert.equal(await handle.getAttribute('role'),'separator');assert.equal(await handle.getAttribute('aria-orientation'),'vertical');
 const width=async()=>(await rail.boundingBox()).width,initial=await width();assert.ok(initial>=68&&initial<=86,`unexpected default tools width ${initial}`);
 assert.ok(near((await handle.boundingBox()).x+(await handle.boundingBox()).width/2,(await rail.boundingBox()).x+initial,4));
 await handle.focus();await page.keyboard.press('ArrowRight');await settle();assert.ok(near(await width(),initial+10));
 await page.keyboard.press('ArrowLeft');await settle();assert.ok(near(await width(),initial));
 await dragSeparator(page,handle,75);await settle();const widened=await width();assert.ok(widened>=132&&widened<=200);
 let positions=await page.locator('#tool-list [data-tool]').evaluateAll(items=>items.slice(0,2).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y};}));
 assert.ok(near(positions[0].y,positions[1].y,1)&&!near(positions[0].x,positions[1].x,1),JSON.stringify(positions));
 if(screenshotPath('wide'))await page.screenshot({path:screenshotPath('wide'),fullPage:true});
 await page.locator('#toggle-tools').click();assert.equal(await handle.isVisible(),false);await page.locator('#toggle-tools').click();await settle();assert.ok(near(await width(),widened));
 await page.reload();await page.locator('.layer-row').waitFor();await expandLayerContents(page);await page.locator('#layer-list .curve-select').waitFor({state:'attached'});await settle();assert.ok(near(await width(),widened));
 await handle.dblclick();await settle();assert.ok(near(await width(),initial));
 await dragSeparator(page,handle,1000);await settle();assert.ok(near(await width(),200));
 await handle.press('Home');await settle();assert.ok(near(await width(),initial));
 await dragSeparator(page,handle,-1000);await settle();positions=await page.locator('#tool-list [data-tool]').evaluateAll(items=>items.slice(0,2).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y};}));
 assert.ok(near(positions[0].x,positions[1].x,1)&&positions[1].y>positions[0].y,JSON.stringify(positions));
 assert.deepEqual(errors,[]);
});

test('canceled tool resizing preserves the draft, artwork, undo history, zoom and canvas center',async t=>{
 const {page,errors,settle,save}=await setup(t),handle=page.locator('#resize-tools'),rail=page.locator('.tools');
 const initial=await save();await page.locator('#panel-properties > summary').click();await page.locator('#path-name').fill('调整工具栏时保留的修改');await page.locator('#path-name').press('Tab');
 await page.locator('#zoom-in').click();await settle();
 const center=()=>page.locator('#canvas').evaluate(svg=>{const r=svg.getBoundingClientRect(),p=new DOMPoint(r.left+r.width/2,r.top+r.height/2).matrixTransform(document.getElementById('viewport').getScreenCTM().inverse());return {x:p.x,y:p.y};});
 const width=async()=>(await rail.boundingBox()).width,before=await center(),start=await width(),zoom=await page.locator('#zoom').textContent(),undo=await page.locator('#undo').getAttribute('title');
 let box=await handle.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y,{steps:5});await settle();assert.ok(await width()>start+40);
 await page.keyboard.press('Escape');await page.mouse.up();await settle();assert.ok(near(await width(),start));
 await handle.evaluate(el=>el.addEventListener('pointerdown',e=>window.__toolsResizePointerId=e.pointerId,{once:true,capture:true}));
 box=await handle.boundingBox();x=box.x+box.width/2;y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+60,y,{steps:5});await settle();assert.ok(await width()>start+40);
 const pointerId=await page.evaluate(()=>window.__toolsResizePointerId);await handle.dispatchEvent('pointercancel',{pointerId,pointerType:'mouse',isPrimary:true});await page.mouse.up();await settle();assert.ok(near(await width(),start));
 assert.equal(await page.locator('#path-name').inputValue(),'调整工具栏时保留的修改');assert.equal(await page.locator('#zoom').textContent(),zoom);assert.equal(await page.locator('#undo').getAttribute('title'),undo);
 const after=await center();assert.ok(near(after.x,before.x,.001)&&near(after.y,before.y,.001),JSON.stringify({before,after}));
 const saved=await save();assert.deepEqual(saved.paths[0].nodes,initial.paths[0].nodes);assert.equal(saved.paths[0].name,'调整工具栏时保留的修改');assert.equal(Object.keys(saved).some(k=>/tool.*width|layout/i.test(k)),false);
 await page.locator('#undo').click();assert.equal(await page.locator('#path-name').inputValue(),initial.paths[0].name);assert.deepEqual(errors,[]);
});

test('narrow screens do not overflow and focused tool resizing cannot trigger canvas shortcuts',async t=>{
 const {page,errors,settle,save}=await setup(t,{width:620,height:720}),handle=page.locator('#resize-tools'),initial=await save();
 for(const width of [620,390,320]){
  await page.setViewportSize({width,height:720});await settle();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await handle.isVisible(),true);
 }
 await page.setViewportSize({width:620,height:720});await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();const undo=await page.locator('#undo').getAttribute('title');
 await handle.focus();for(const key of ['Delete','Backspace','b','r','t','a','m','h'])await page.keyboard.press(key);
 assert.equal(await page.locator('#undo').getAttribute('title'),undo);assert.equal(await page.locator('[data-tool="select"]').getAttribute('aria-pressed'),'true');assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('#toggle-tools').click();assert.equal(await handle.isVisible(),false);await page.locator('#toggle-tools').click();assert.equal(await handle.isVisible(),true);
 await page.setViewportSize({width:390,height:720});await page.locator('#toggle-tools').click();await settle();
 assert.equal(await page.locator('[data-tool="outline"] .tool-name').isVisible(),false);
 assert.equal(await page.locator('.tools').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1),true);
 assert.deepEqual(errors,[]);
});
