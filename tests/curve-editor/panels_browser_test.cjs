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
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','auto']);
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#curve-list button').waitFor({state:'attached'});
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
 assert.equal(await page.locator('#panel-curves #curve-list').count(),1);
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
 await page.reload();await page.locator('#curve-list button').waitFor({state:'attached'});
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
