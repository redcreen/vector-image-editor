// Isolated project and browser: never reloads an open user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-panels-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#layer-list .layer-row').first().waitFor({state:'attached'});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,errors,settle,save};
}

test('sidebars collapse independently, retain tool access and preserve artwork, zoom and undo history',async t=>{
 const {page,errors,settle,save}=await setup(t);
 if(process.env.CURVE_EDITOR_PANELS_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_PANELS_SCREENSHOT,fullPage:true});
 const initial=await save();
 await page.locator('#panel-properties > summary').click();
 await page.locator('#path-name').fill('尚未保存的曲线');await page.locator('#path-name').press('Tab');
 await page.locator('#zoom-in').click();await settle();
 const zoom=await page.locator('#zoom').textContent(),undo=await page.locator('#undo').getAttribute('title');
 const center=()=>page.locator('#canvas').evaluate(svg=>{const r=svg.getBoundingClientRect(),p=new DOMPoint(r.left+r.width/2,r.top+r.height/2).matrixTransform(document.getElementById('viewport').getScreenCTM().inverse());return {x:p.x,y:p.y};});
 const before=await center(),wide=await page.locator('#canvas').boundingBox();
 assert.equal(await page.locator('#toggle-tools').getAttribute('aria-expanded'),'true');
 await page.locator('#toggle-tools').click();await page.locator('#toggle-panels').click();await settle();
 assert.equal(await page.locator('#toggle-tools').getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('#toggle-panels').getAttribute('aria-expanded'),'false');
 assert.ok((await page.locator('#canvas').boundingBox()).width>wide.width+150);
 assert.equal(await page.locator('[data-tool="pen"]').isVisible(),true);
 assert.equal(await page.locator('#panel-rail [data-panel-target="measurement"]').isVisible(),true);
 assert.equal(await page.locator('#zoom').textContent(),zoom);
 const after=await center();assert.ok(Math.abs(before.x-after.x)<.001&&Math.abs(before.y-after.y)<.001);
 assert.equal(await page.locator('#path-name').inputValue(),'尚未保存的曲线');
 assert.equal(await page.locator('#undo').getAttribute('title'),undo);
 if(process.env.CURVE_EDITOR_COMPACT_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_COMPACT_SCREENSHOT,fullPage:true});
 await page.locator('#panel-rail [data-panel-target="properties"]').focus();await page.keyboard.press('Enter');await settle();
 assert.equal(await page.locator('#toggle-panels').getAttribute('aria-expanded'),'true');
 assert.equal(await page.locator('#panel-properties').getAttribute('open'),'');
 assert.equal(await page.locator('#path-name').isVisible(),true);
 assert.equal(await page.locator('#toggle-tools').getAttribute('aria-expanded'),'false');
 const saved=await save();assert.deepEqual(saved.paths[0].nodes,initial.paths[0].nodes);assert.equal(saved.paths[0].name,'尚未保存的曲线');
 assert.equal(Object.keys(saved).some(k=>/panel|sidebar/i.test(k)),false);
 await page.locator('#undo').click();assert.equal(await page.locator('#path-name').inputValue(),initial.paths[0].name);
 assert.deepEqual(errors,[]);
});

test('functional groups fold independently, keyboard tools reveal controls and layout preferences survive reload',async t=>{
 const {page,errors,settle}=await setup(t);
 assert.equal(await page.locator('#panel-layers').getAttribute('open'),'');
 assert.equal(await page.locator('#panel-mirror').getAttribute('open'),null);
 assert.equal(await page.locator('#panel-measurement').getAttribute('open'),null);
 assert.equal(await page.locator('#panel-properties').getAttribute('open'),null);
 assert.equal(await page.locator('#panel-curves').getAttribute('open'),null);
 await page.locator('#panel-properties > summary').click();
 assert.equal(await page.locator('#panel-properties #transform-panel').count(),1);
 assert.equal(await page.locator('#panel-properties #properties').count(),1);
 assert.equal(await page.locator('#panel-layers #layer-list').count(),1);
 assert.equal(await page.locator('#panel-curves #node-x').count(),1);
 await page.locator('#panel-layers > summary').focus();await page.keyboard.press('Space');
 assert.equal(await page.locator('#layer-list').isVisible(),false);
 assert.equal(await page.locator('#panel-properties').getAttribute('open'),'');
 await page.keyboard.press('m');assert.equal(await page.locator('#panel-measurement').getAttribute('open'),'');
 assert.equal(await page.locator('#calibrate').isVisible(),true);
 await page.keyboard.press('a');assert.equal(await page.locator('#panel-mirror').getAttribute('open'),'');
 await page.locator('#toggle-tools').click();await page.locator('#toggle-panels').click();await settle();
 await page.reload();await page.locator('#toggle-panels[aria-expanded="false"]').waitFor();
 assert.equal(await page.locator('#toggle-tools').getAttribute('aria-expanded'),'false');
 assert.equal(await page.locator('#panel-layers').getAttribute('open'),null);
 assert.equal(await page.locator('#panel-measurement').getAttribute('open'),'');
 await page.locator('#panel-rail [data-panel-target="layers"]').click();
 assert.equal(await page.locator('#layer-list').isVisible(),true);
 assert.equal(await page.locator('#undo').isDisabled(),true);
 assert.deepEqual(errors,[]);
});

test('panel controls remain reachable on narrow screens and with unavailable preference storage',async t=>{
 const {page,errors,settle}=await setup(t);
 await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage unavailable');}});});
 await page.reload();await page.locator('#layer-list .layer-row').first().waitFor({state:'attached'});
 for(const width of [900,620,390]){
  await page.setViewportSize({width,height:900});await settle();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#toggle-panels').click();
  await page.locator('#panel-rail [data-panel-target="measurement"]').click();
  assert.equal(await page.locator('#measure-total').isVisible(),true);
  await page.locator('#toggle-tools').click();assert.equal(await page.locator('[data-tool="select"]').isVisible(),true);
 }
 assert.deepEqual(errors,[]);
});

test('scrolling the dock does not dismiss a context menu anchored to the canvas',async t=>{
 const {page,errors,settle,save}=await setup(t);
 const G=require('../../tools/curve-editor/geometry.js'),doc=await save(),p=G.at(doc.paths[0].nodes[0],doc.paths[0].nodes[1],.5);
 await page.locator('#panel-measurement > summary').click();
 const position=await page.locator('#viewport').evaluate((el,p)=>{const s=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:s.x,y:s.y};},p);
 await page.mouse.click(position.x,position.y,{button:'right'});
 await page.locator('#context-menu').waitFor();
 const dock=await page.locator('#panel-content').boundingBox();
 await page.mouse.move(dock.x+dock.width/2,dock.y+dock.height/2);await page.mouse.wheel(0,450);await settle();
 assert.equal(await page.locator('#context-menu').isVisible(),true);
 await page.getByRole('menuitem',{name:'测量整条曲线'}).click();
 assert.match(await page.locator('#measure-summary').textContent(),/曲线/);
 assert.deepEqual(errors,[]);
});

async function dragSeparator(page,locator,dx,dy){
 await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();
 const x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();
}

test('dragging the dock edge resizes its width without editing artwork or changing the canvas center',async t=>{
 const {page,errors,settle,save}=await setup(t),handle=page.locator('#resize-panels');
 assert.equal(await handle.count(),1,'the dock needs a draggable edge');
 const initial=await save();await page.locator('#panel-properties > summary').click();
 await page.locator('#path-name').fill('调整面板时保留的修改');await page.locator('#path-name').press('Tab');
 await page.locator('#zoom-in').click();await settle();
 const zoom=await page.locator('#zoom').textContent(),undo=await page.locator('#undo').getAttribute('title');
 const center=()=>page.locator('#canvas').evaluate(svg=>{const r=svg.getBoundingClientRect(),p=new DOMPoint(r.left+r.width/2,r.top+r.height/2).matrixTransform(document.getElementById('viewport').getScreenCTM().inverse());return {x:p.x,y:p.y};});
 const before=await center(),width=(await page.locator('#panel-dock').boundingBox()).width;
 await dragSeparator(page,handle,-110,0);await settle();
 assert.ok(Math.abs((await page.locator('#panel-dock').boundingBox()).width-width-110)<2);
 assert.equal(await page.locator('#zoom').textContent(),zoom);assert.equal(await page.locator('#undo').getAttribute('title'),undo);
 const after=await center();assert.ok(Math.abs(before.x-after.x)<.001&&Math.abs(before.y-after.y)<.001);
 assert.equal(await page.locator('#path-name').inputValue(),'调整面板时保留的修改');
 await page.locator('#toggle-panels').click();assert.equal(await handle.isVisible(),false);
 await page.locator('#toggle-panels').click();await settle();assert.ok(Math.abs((await page.locator('#panel-dock').boundingBox()).width-width-110)<2);
 await page.reload();await page.locator('#layer-list .layer-row').first().waitFor({state:'attached'});await settle();
 assert.ok(Math.abs((await page.locator('#panel-dock').boundingBox()).width-width-110)<2);
 const saved=await save();assert.deepEqual(saved.paths[0].nodes,initial.paths[0].nodes);
 assert.equal(Object.keys(saved).some(k=>/panel|sidebar/i.test(k)),false);
 await page.locator('#undo').click();assert.equal(await page.locator('#path-name').inputValue(),initial.paths[0].name);
 assert.deepEqual(errors,[]);
});

test('group bottom edges resize independently with scrollable content and restore after folding and reload',async t=>{
 const {page,errors,settle}=await setup(t),layers=page.locator('#panel-layers .panel-resize-handle'),properties=page.locator('#panel-properties .panel-resize-handle');
 assert.equal(await layers.count(),1,'functional groups need draggable bottom edges');
 for(let i=0;i<10;i++)await page.locator('#add-layer').click();
 const body=page.locator('#panel-layers .panel-body'),initial=(await body.boundingBox()).height;
 await dragSeparator(page,layers,0,190);await settle();
 const expanded=(await body.boundingBox()).height;assert.ok(expanded>initial+170);
 assert.ok((await page.locator('#layer-list').boundingBox()).height>210,'growing the group must give its list more room');
 if(process.env.CURVE_EDITOR_RESIZED_GROUP_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_RESIZED_GROUP_SCREENSHOT,fullPage:true});
 await page.locator('#panel-properties > summary').click();
 const propertyBody=page.locator('#panel-properties .panel-body'),propertyHeight=(await propertyBody.boundingBox()).height;
 await dragSeparator(page,properties,0,-Math.ceil(propertyHeight));await settle();
 assert.equal(Math.round((await propertyBody.boundingBox()).height),96);
 assert.equal(await propertyBody.evaluate(e=>e.scrollHeight>e.clientHeight),true);
 await page.locator('#delete-element').scrollIntoViewIfNeeded();assert.equal(await page.locator('#delete-element').isVisible(),true);
 assert.ok(Math.abs((await body.boundingBox()).height-expanded)<2);
 await page.locator('#panel-layers > summary').click();assert.equal(await layers.isVisible(),false);
 await page.locator('#panel-layers > summary').click();assert.ok(Math.abs((await body.boundingBox()).height-expanded)<2);
 await page.reload();await page.locator('#layer-list .layer-row').first().waitFor({state:'attached'});await settle();
 assert.ok(Math.abs((await body.boundingBox()).height-expanded)<2);assert.equal(Math.round((await propertyBody.boundingBox()).height),96);
 assert.deepEqual(errors,[]);
});

test('resizers support keyboard adjustment, default reset and canceled pointer gestures',async t=>{
 const {page,errors,settle}=await setup(t),handle=page.locator('#resize-panels'),group=page.locator('#panel-layers .panel-resize-handle');
 assert.equal(await handle.count(),1);
 const width=async()=>(await page.locator('#panel-dock').boundingBox()).width,initial=await width();
 await handle.focus();await page.keyboard.press('ArrowLeft');await settle();assert.equal(await width(),initial+10);
 await handle.dblclick();await settle();assert.equal(await width(),initial);
 const box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x-80,box.y+box.height/2);await settle();assert.ok(await width()>initial+70);
 await page.keyboard.press('Escape');await page.mouse.up();await settle();assert.equal(await width(),initial);
 await group.focus();await page.keyboard.press('ArrowUp');await settle();assert.equal(await group.getAttribute('aria-orientation'),'horizontal');
 assert.ok(await group.getAttribute('aria-valuenow'));await page.keyboard.press('Home');await settle();
 assert.equal(await page.locator('#panel-layers .panel-body').evaluate(e=>e.style.height),'');
 await handle.focus();await page.keyboard.press('End');await settle();assert.equal(await width(),560);
 await page.setViewportSize({width:700,height:900});await settle();assert.ok((await page.locator('#canvas').boundingBox()).width>=239);
 await page.setViewportSize({width:1440,height:1000});await settle();assert.equal(await width(),560);
 await handle.press('Home');await settle();assert.equal(await width(),initial);
 assert.deepEqual(errors,[]);
});

test('resizers remain usable on narrow screens and with invalid or unavailable stored dimensions',async t=>{
 const {page,errors,settle}=await setup(t);
 assert.equal(await page.locator('#resize-panels').count(),1);
 await page.evaluate(()=>localStorage.setItem('curve-editor-layout-v1',JSON.stringify({panelWidth:999999,panelHeights:{layers:-20,properties:'bad',curves:999999}})));
 await page.reload();await page.locator('#layer-list .layer-row').first().waitFor({state:'attached'});await settle();
 assert.ok((await page.locator('#panel-dock').boundingBox()).width<=560);
 assert.equal(await page.locator('#panel-layers .panel-body').evaluate(e=>e.style.height),'');
 for(const width of [620,390]){
  await page.setViewportSize({width,height:900});await settle();
  assert.equal(await page.locator('#resize-panels').isVisible(),false);
  await dragSeparator(page,page.locator('#panel-layers .panel-resize-handle'),0,60);await settle();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage unavailable');}});});
 await page.reload();await page.locator('#layer-list .layer-row').first().waitFor({state:'attached'});
 await dragSeparator(page,page.locator('#panel-layers .panel-resize-handle'),0,60);await settle();
 assert.equal(await page.locator('#panel-layers .panel-body').evaluate(e=>parseFloat(e.style.height)>96),true);
 if(process.env.CURVE_EDITOR_RESIZE_SCREENSHOT){await page.setViewportSize({width:1440,height:1000});await settle();await page.screenshot({path:process.env.CURVE_EDITOR_RESIZE_SCREENSHOT,fullPage:true});}
 assert.deepEqual(errors,[]);
});

test('focused separators isolate layout keys from artwork edits',async t=>{
 const {page,errors,settle,save}=await setup(t),initial=await save();
 await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();
 const undo=await page.locator('#undo').getAttribute('title');
 await page.locator('#resize-panels').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');
 assert.equal(await page.locator('#undo').getAttribute('title'),undo,'layout focus must not move selected artwork');
 const group=page.locator('#panel-layers .panel-resize-handle');await group.focus();
 for(const key of ['ArrowLeft','ArrowRight','Delete','Backspace','Enter','b'])await page.keyboard.press(key);
 assert.equal(await page.locator('#undo').getAttribute('title'),undo);assert.equal(await page.locator('[data-tool="select"]').getAttribute('aria-pressed'),'true');
 assert.deepEqual((await save()).paths,initial.paths);
 assert.deepEqual(errors,[]);
});

test('separator accessibility values follow content and panel size changes',async t=>{
 const {page,errors,settle}=await setup(t),group=page.locator('#panel-layers .panel-resize-handle');await settle();
 const actual=async()=>Math.round((await page.locator('#panel-layers .panel-body').boundingBox()).height);
 assert.equal(Number(await group.getAttribute('aria-valuenow')),await actual());
 for(let i=0;i<4;i++)await page.locator('#add-layer').click();await settle();
 assert.equal(Number(await group.getAttribute('aria-valuenow')),await actual());
 assert.deepEqual(errors,[]);
});

test('panel title dragging reorders groups and rail icons and persists order and folding without artwork edits',async t=>{
 const {page,errors,settle,save}=await setup(t),initial=await save();
 const order=()=>page.locator('#panel-content > .panel-group').evaluateAll(items=>items.map(e=>e.dataset.panel));
 const undo=await page.locator('#undo').getAttribute('title');
 assert.equal(await page.locator('#panel-properties > summary').getAttribute('draggable'),'true');
 await page.locator('#panel-properties > summary').dragTo(page.locator('#panel-layers > summary'),{targetPosition:{x:70,y:4}});await settle();
 assert.deepEqual((await order()).slice(0,2),['properties','layers']);
 assert.equal(await page.locator('#panel-properties').getAttribute('open'),null,'a drag must not also toggle the panel');
 await page.locator('#panel-properties > summary').click();await settle();
 assert.equal(await page.locator('#panel-properties').getAttribute('open'),'');
 await page.locator('#panel-layers > summary').click();await settle();
 const reordered=await order();assert.equal(await page.locator('#undo').getAttribute('title'),undo);
 if(process.env.CURVE_EDITOR_PANEL_ORDER_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_PANEL_ORDER_SCREENSHOT,fullPage:true});
 await page.reload();await page.locator('#layer-list .layer-row').first().waitFor({state:'attached'});await settle();
 assert.deepEqual(await order(),reordered);assert.equal(await page.locator('#panel-layers').getAttribute('open'),null);assert.equal(await page.locator('#panel-properties').getAttribute('open'),'');
 await page.locator('#toggle-panels').click();
 assert.deepEqual(await page.locator('#panel-rail > button').evaluateAll(items=>items.map(e=>e.dataset.panelTarget)),reordered);
 await page.locator('#panel-rail [data-panel-target="properties"]').click();
 await page.locator('#panel-properties > summary').focus();await page.keyboard.press('Alt+ArrowDown');await settle();
 assert.deepEqual((await order()).slice(0,2),['layers','properties']);assert.equal(await page.locator('#panel-properties').getAttribute('open'),'');
 assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').getAttribute('title'),undo);assert.deepEqual(errors,[]);
});

test('dock and group scroll positions restore after artwork is loaded and malformed order is normalized',async t=>{
 const {page,errors,settle}=await setup(t);
 assert.equal(await page.locator('#panel-layers > summary').getAttribute('draggable'),'true');
 for(let i=0;i<10;i++)await page.locator('#add-layer').click();
 await page.locator('#panel-layers .panel-resize-handle').focus();await page.keyboard.press('ArrowUp');
 for(const key of ['properties','curves','measurement'])await page.locator(`#panel-${key} > summary`).click();
 await settle();
 const saved=await page.evaluate(()=>{const dock=document.getElementById('panel-content'),body=document.querySelector('#panel-layers .panel-body');dock.scrollTop=230;body.scrollTop=110;return {dock:dock.scrollTop,body:body.scrollTop};});
 assert.ok(saved.dock>0&&saved.body>0);await settle();
 await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await settle();
 const restored=await page.evaluate(()=>({dock:document.getElementById('panel-content').scrollTop,body:document.querySelector('#panel-layers .panel-body').scrollTop}));
 assert.ok(Math.abs(restored.dock-saved.dock)<2&&Math.abs(restored.body-saved.body)<2,JSON.stringify({saved,restored}));
 await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('curve-editor-layout-v1'));p.panelOrder=['measurement','measurement','missing',17,'layers'];localStorage.setItem('curve-editor-layout-v1',JSON.stringify(p));});
 await page.reload();await page.locator('#layer-list .layer-row').first().waitFor({state:'attached'});
 const order=await page.locator('#panel-content > .panel-group').evaluateAll(items=>items.map(e=>e.dataset.panel));
 assert.deepEqual(order.slice(0,2),['measurement','layers']);assert.equal(order.length,9);assert.equal(new Set(order).size,9);assert.deepEqual(errors,[]);
});

test('a collapsed dock restores group scroll when revealed after reload',async t=>{
 const {page,errors,settle}=await setup(t);
 await page.locator('#panel-properties > summary').click();await dragSeparator(page,page.locator('#panel-properties .panel-resize-handle'),0,-1000);await settle();
 const body=page.locator('#panel-properties .panel-body');const top=await body.evaluate(e=>{e.scrollTop=200;return e.scrollTop;});assert.ok(top>0);await settle();
 await page.locator('#toggle-panels').click();await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await settle();
 assert.equal(await page.locator('#toggle-panels').getAttribute('aria-expanded'),'false');await page.locator('#toggle-panels').click();await settle();
 assert.equal(await body.evaluate(e=>e.scrollTop),top);assert.deepEqual(errors,[]);
});

test('reordering retains the moved group scroll position',async t=>{
 const {page,errors,settle}=await setup(t);
 await page.locator('#panel-properties > summary').click();await dragSeparator(page,page.locator('#panel-properties .panel-resize-handle'),0,-1000);await settle();
 const body=page.locator('#panel-properties .panel-body');const top=await body.evaluate(e=>{e.scrollTop=200;return e.scrollTop;});assert.ok(top>0);await settle();
 await page.locator('#panel-properties > summary').focus();await page.keyboard.press('Alt+ArrowUp');await settle();
 assert.equal(await body.evaluate(e=>e.scrollTop),top);assert.deepEqual(errors,[]);
});
