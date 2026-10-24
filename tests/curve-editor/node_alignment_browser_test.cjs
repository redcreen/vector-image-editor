// Isolated projects only: never replace or refresh the user's active canvas.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
async function setup(t,{targetY=100}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-alignment-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,x)=>({id,name:id,color:'#e04544',role:'outline',closed:false,note:'',nodes:[G.node(x,100),G.node(x+100,100),G.node(x+100,200)]});
 const paths=[curve('moving',100),curve('target',400),{...curve('hidden-path',600),visible:false},curve('hidden-layer',600),curve('locked',750)];
 paths[1].nodes[0]=G.node(400,targetY);
 // Keep these tests about alignment: an open endpoint now deliberately joins on release.
 paths[1].closed=true;
 paths[0].nodes[0].in={x:80,y:80};paths[0].nodes[0].out={x:120,y:120};
 const layers=[{id:'main',name:'可编辑',visible:true,locked:false,pathIds:['moving','target','hidden-path'],imageIds:[],textIds:[]},{id:'hidden',name:'隐藏',visible:false,locked:false,pathIds:['hidden-layer'],imageIds:[],textIds:[]},{id:'reference',name:'锁定参考',visible:true,locked:true,pathIds:['locked'],imageIds:[],textIds:[]}];
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'节点吸附测试',image:null,images:[],texts:[],opacity:.65,originals:[],paths,layers,newNodeMode:'cusp'};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(6000);
 await page.goto(url);await page.locator('#paths [data-path="moving"]').waitFor({state:'attached'});await expandLayerContents(page);await page.locator('.curve-item[data-path="moving"] .curve-select').click();
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});
 const move=async(x,y,offset=0)=>{const p=await screen(x,y);await page.mouse.move(p.x+offset,p.y);};
 const begin=async(x=100,y=100,whole=false)=>{await move(x,y);if(whole){const q=await screen(x,y);assert.equal(await page.evaluate(q=>!!document.elementFromPoint(q.x,q.y)?.closest('[data-rotation-center],[data-rotate],[data-node],[data-side],[data-corner]'),q),false,'whole-curve drag must not start on an editing handle');}await page.mouse.down();};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const hint=page.locator('#node-alignment [data-alignment="coincident"]');
 return {page,initial,errors,screen,move,begin,save,hint};
}

test('node drag snaps only within three screen pixels, preserves handles and is one undo step',async t=>{
 const {page,initial,errors,move,begin,save,hint}=await setup(t);
 await begin();await move(400,100,-5);assert.equal(await hint.count(),0);
 await move(400,100,-2);assert.equal(await hint.count(),1);assert.match(await page.locator('#node-alignment').textContent(),/节点重合/);
 if(process.env.CURVE_EDITOR_ALIGNMENT_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_ALIGNMENT_SCREENSHOT,fullPage:true});
 await page.mouse.up();assert.equal(await hint.count(),0);
 const d=await save(),node=d.paths[0].nodes[0];assert.equal(node.x,400);assert.equal(node.y,100);assert.deepEqual(node.in,{x:380,y:80});assert.deepEqual(node.out,{x:420,y:120});
 assert.deepEqual(d.paths[0].nodes.slice(1),initial.paths[0].nodes.slice(1));assert.deepEqual(d.paths.slice(1),initial.paths.slice(1));
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,d.paths);assert.deepEqual(errors,[]);
});

test('whole-curve and multiple-curve drags use one shared translation and ignore all moving anchors',async t=>{
 const {page,initial,errors,begin,move,save,hint}=await setup(t);
 await begin(165,150,true);await move(465,150,-2);assert.equal(await hint.count(),1);await page.mouse.up();
 let d=await save();d.paths[0].nodes.forEach((n,i)=>{assert.equal(n.x,initial.paths[0].nodes[i].x+300);assert.equal(n.y,initial.paths[0].nodes[i].y);});
 await page.locator('#undo').click();
 await page.locator('.curve-item[data-path="target"] .curve-select').click({modifiers:['Shift']});
 await begin(165,150,true);await move(165,150,2);assert.equal(await hint.count(),0);await page.mouse.up();d=await save();
 assert.ok(d.paths[0].nodes[0].x>100&&d.paths[0].nodes[0].x<105);assert.ok(Math.abs(d.paths[1].nodes[0].x-d.paths[0].nodes[0].x-300)<1e-8);
 await page.locator('#undo').click();await begin(165,150,true);await move(515,150,-2);assert.equal(await hint.count(),1);await page.mouse.up();d=await save();
 for(let i=0;i<2;i++)d.paths[i].nodes.forEach((n,j)=>assert.equal(n.x,initial.paths[i].nodes[j].x+350));assert.deepEqual(d.paths.slice(2),initial.paths.slice(2));assert.deepEqual(errors,[]);
});

test('same-curve anchors and locked visible references align, hidden paths and layers do not',async t=>{
 const {page,errors,begin,move,save,hint}=await setup(t);
 await begin();await move(200,100,-2);assert.equal(await hint.count(),1);await page.mouse.up();assert.equal((await save()).paths[0].nodes[0].x,200);await page.locator('#undo').click();
 await begin();await move(600,100,-2);assert.equal(await hint.count(),0);await page.mouse.up();assert.notEqual((await save()).paths[0].nodes[0].x,600);await page.locator('#undo').click();
 await begin();await move(750,100,-2);assert.equal(await hint.count(),1);await page.mouse.up();assert.equal((await save()).paths[0].nodes[0].x,750);assert.deepEqual(errors,[]);
});

test('Alt bypasses snapping and zoom keeps the radius small in screen pixels',async t=>{
 const {page,errors,begin,move,save,hint}=await setup(t);
 await begin();await move(400,100,-2);assert.equal(await hint.count(),1);await page.keyboard.down('Alt');assert.equal(await hint.count(),0);await page.keyboard.up('Alt');assert.equal(await hint.count(),1);await page.keyboard.down('Alt');await page.mouse.up();await page.keyboard.up('Alt');assert.notEqual((await save()).paths[0].nodes[0].x,400);await page.locator('#undo').click();
 // Zoom around the source so the drag starts on the canvas, not the toolbar.
 await move(100,100);const previous=await page.locator('#zoom').textContent();await page.mouse.wheel(0,-300);await page.waitForFunction(previous=>document.getElementById('zoom').textContent!==previous,previous);
 await begin();await move(400,100,-4);assert.equal(await hint.count(),0);await move(400,100,-2);assert.equal(await hint.count(),1);await page.mouse.up();assert.equal((await save()).paths[0].nodes[0].x,400);assert.deepEqual(errors,[]);
});

test('Shift preserves the constrained direction and refreshes alignment when modifiers change',async t=>{
 const {page,errors,begin,move,save,hint}=await setup(t,{targetY:102});
 await begin();await page.keyboard.down('Shift');await move(400,100,-1);assert.equal(await hint.count(),0);
 await move(500,100,-2);assert.equal(await hint.count(),1);
 await move(400,100,-1);assert.equal(await hint.count(),0);await page.keyboard.up('Shift');assert.equal(await hint.count(),1);await page.mouse.up();
 const d=await save();assert.equal(d.paths[0].nodes[0].x,400);assert.equal(d.paths[0].nodes[0].y,102);assert.deepEqual(errors,[]);
});

test('hints disappear during temporary pan and on cancelled/lost drags, without snapping control handles',async t=>{
 const {page,errors,begin,move,hint}=await setup(t);
 for(const finish of ['Escape','pointercancel','lostpointercapture','blur']){
  await page.locator('.curve-item[data-path="moving"] .curve-select').click();await begin();await move(400,100,-2);assert.equal(await hint.count(),1);
  await page.keyboard.down('Space');assert.equal(await hint.count(),0);await page.keyboard.up('Space');assert.equal(await hint.count(),1);
  if(finish==='Escape')await page.keyboard.press('Escape');else if(finish==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else await page.locator('#canvas').dispatchEvent(finish);
  assert.equal(await hint.count(),0);await page.mouse.up();await page.locator('#undo').click();
 }
 await page.locator('.curve-item[data-path="moving"] .curve-select').click();await move(100,100);await page.mouse.click((await page.locator('.anchor[data-node="0"]').boundingBox()).x+7,(await page.locator('.anchor[data-node="0"]').boundingBox()).y+7);
 await begin(120,120);await move(400,100,-2);assert.equal(await hint.count(),0);await page.mouse.up();assert.deepEqual(errors,[]);
});
