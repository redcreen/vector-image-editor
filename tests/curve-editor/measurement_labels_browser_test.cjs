const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');

for(const curved of [false,true])test(`measurement labels stay thin and clear with ${curved?'curved':'straight'} outlines`,async t=>{
 const project=await mkdtemp(path.join(tmpdir(),'measure-labels-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve={id:'outline',name:'测量轮廓',color:'#176bce',closed:true,nodes:[[20,20],[80,20],[80.03,20],[140,20],[140,65],[140,65.03],[140,110],[80,110],[79.97,110],[20,110],[20,65],[20,64.97]].map(([x,y])=>G.node(x,y))};
 if(curved){curve.nodes[0].out={x:40,y:0};curve.nodes[1].in={x:60,y:0};curve.nodes[3].out={x:160,y:30};curve.nodes[4].in={x:160,y:55};}
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:180,height:140,title:'测量避让',paths:[curve],originals:[],image:null,opacity:.65};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log)),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL||'chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('.layer-row').waitFor();
 const p=await page.locator('#viewport').evaluate((el,curved)=>{const p=new DOMPoint(50,curved?5:20).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};},curved);await page.mouse.click(p.x,p.y,{button:'right'});await page.getByRole('menuitem',{name:'测量整条曲线',exact:true}).click();
 const total=await page.locator('#measure-total').textContent();
 for(const zoom of ['initial','in','out']){
  if(zoom!=='initial')await page.locator('#zoom-'+zoom).click();
  const labels=await page.locator('#measure-overlay .measurement-label').evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect(),m=el.getScreenCTM();return {x:b.x,y:b.y,w:b.width,h:b.height,stroke:parseFloat(getComputedStyle(el).strokeWidth)*Math.hypot(m.a,m.b)};}));
  assert.equal(labels.length,1,'whole-curve measurement shows only one total');
  assert.match(await page.locator('#measure-overlay .measurement-label').textContent(),/^总长 /);
  for(const [i,a] of labels.entries()){
   assert.ok(a.stroke<=2.1,`screen-space halo must stay thin: ${a.stroke}`);
   for(const b of labels.slice(i+1))assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,'labels overlap');
  }
  const covered=await page.locator('#measure-overlay').evaluate(group=>{
   const labels=[...group.querySelectorAll('text')].map(t=>t.getBBox());
   return [...group.querySelectorAll('path')].some(p=>{const length=p.getTotalLength();for(let d=0;d<=length;d+=.2){const q=p.getPointAtLength(d);if(labels.some(b=>q.x>=b.x&&q.x<=b.x+b.width&&q.y>=b.y&&q.y<=b.y+b.height))return true;}return false;});
  });assert.equal(covered,false,'labels must not cover the measured contour');
  assert.equal(await page.locator('#measure-details li').count(),0);assert.equal(await page.locator('#measure-total').textContent(),total);
  assert.match(await page.locator('#measure-summary').textContent(),/整条曲线/);
 }
 if(process.env.CURVE_EDITOR_MEASUREMENT_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_MEASUREMENT_SCREENSHOT});
 // A normal click switches from whole-curve total to just the chosen segment.
 const click=async(x,y)=>{const point=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});await page.mouse.click(point.x,point.y);};
 await click(50,curved?5:20);
 assert.equal(await page.locator('#measure-overlay .measurement-label').count(),1);
 assert.equal(await page.locator('#measure-details li').count(),1);
 assert.equal(await page.locator('#measure-overlay path').count(),1);
 assert.equal(await page.locator('#measure-overlay .measurement-label').textContent(),`${G.segmentLength(curve,0).toFixed(2)} px`);
 await click(50,110);
 assert.equal(await page.locator('#measure-overlay .measurement-label').count(),1);
 assert.equal(await page.locator('#measure-details li').count(),1);
 assert.equal(await page.locator('#measure-overlay .measurement-label').textContent(),`${G.segmentLength(curve,8).toFixed(2)} px`);
 assert.deepEqual(errors,[]);assert.equal(await page.locator('#undo').isDisabled(),true);
});
