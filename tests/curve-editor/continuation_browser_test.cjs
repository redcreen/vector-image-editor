// These fixtures and browser sessions are independent of the user's artwork.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
async function setup(t,{closed=false,oneNode=false,locked=false}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-continuation-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve={id:'curve',name:'续画曲线',color:'#e04544',role:'cut',dashed:true,note:'保留弧线及图层',closed,nodes:[G.node(200,200,'smooth'),G.node(400,160,'symmetric'),G.node(600,300,'smooth')]};
 curve.nodes[1].in={x:350,y:120};curve.nodes[1].out={x:450,y:200};if(oneNode)curve.nodes=curve.nodes.slice(0,1);
 const other={id:'other',name:'另一曲线',role:'outline',note:'',color:'#176bce',closed:false,nodes:[G.node(650,120),G.node(730,150)]};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:900,height:600,title:'端点续画测试',paths:[curve,other],layers:[{id:'main',name:'原图层',visible:true,locked,pathIds:['curve'],imageIds:[],textIds:[]},{id:'other-layer',name:'其他图层',visible:true,locked:false,pathIds:['other'],imageIds:[],textIds:[]}],originals:[],image:null,images:[],texts:[],opacity:.65,newNodeMode:'cusp'};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
 page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#paths .svg-curve').first().waitFor({state:'attached'});await expandLayerContents(page);
 if(!locked)await page.locator('.curve-item[data-path="curve"] .curve-select').click();
 const screen=async p=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},p);
 const click=async(p,button='left')=>{const q=await screen(p);await page.mouse.click(q.x,q.y,{button});};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const reload=async()=>{await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#paths [data-path="curve"]').waitFor({state:'attached'});};
 return {page,initial,errors,screen,click,save,reload};
}

for(const fromStart of [false,true])test(`right-click ${fromStart?'first':'last'} endpoint continues the same path, preserves geometry and restores direction`,async t=>{
 const {page,initial,errors,click,screen,save,reload}=await setup(t),original=initial.paths[0],endpoint=fromStart?original.nodes[0]:original.nodes.at(-1);
 await click(endpoint);await click(endpoint,'right');await page.getByRole('menuitem',{name:'继续画线',exact:true}).click();
 assert.equal(await page.locator('#finish').isDisabled(),false);assert.equal(await page.locator('#undo').isDisabled(),true);
 // Entering and cancelling continuation never adds a node or an undo step.
 await page.keyboard.press('Escape');assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await click(endpoint,'right');await page.getByRole('menuitem',{name:'继续画线',exact:true}).click();await reload();
 assert.equal(await page.locator('[data-tool="pen"]').getAttribute('aria-pressed'),'true');
 // Clicking the same endpoint does not create a duplicate or close the path.
 await click(endpoint);assert.deepEqual((await save()).paths,initial.paths);
 const added={x:fromStart?100:720,y:400};await click(added);
 const first=await save(),extended=first.paths[0];assert.equal(first.paths.length,2);assert.equal(extended.nodes.length,4);
 assert.deepEqual(fromStart?extended.nodes.slice(1):extended.nodes.slice(0,-1),original.nodes);assert.deepEqual(first.paths[1],initial.paths[1]);
 for(const k of ['id','name','role','color','dashed','note'])assert.equal(extended[k],original[k]);assert.deepEqual(first.layers[0].pathIds,['curve']);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);await page.locator('#redo').click();assert.deepEqual((await save()).paths,first.paths);
 await reload();const next={x:fromStart?50:800,y:490},a=await screen(next),b=await screen({x:next.x+30,y:next.y-20});
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});await page.mouse.up();
 const second=await save(),nodes=second.paths[0].nodes;assert.equal(nodes.length,5);assert.deepEqual(fromStart?nodes.slice(2):nodes.slice(0,-2),original.nodes);
 const active=fromStart?nodes[0]:nodes.at(-1);assert.ok(Math.abs(active.x-next.x)<.01);assert.ok(Math.abs(active.y-next.y)<.01);
 assert.ok(Math.abs(active[fromStart?'in':'out'].x-(next.x+30))<.01);assert.ok(Math.abs(active[fromStart?'in':'out'].y-(next.y-20))<.01);
 // Either direction closes at the opposite endpoint of this same path.
 await click(fromStart?original.nodes.at(-1):original.nodes[0]);assert.equal((await save()).paths[0].closed,true);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,second.paths);assert.deepEqual(errors,[]);
});

test('continuation is restricted to single open endpoints',async t=>{
 const {page,initial,click,errors}=await setup(t);
 await click(initial.paths[0].nodes[1],'right');assert.equal(await page.getByRole('menuitem',{name:'继续画线',exact:true}).count(),0);await page.keyboard.press('Escape');
 await click(initial.paths[0].nodes[0]);await page.keyboard.down('Shift');await click(initial.paths[0].nodes.at(-1));await page.keyboard.up('Shift');await click(initial.paths[0].nodes[0],'right');
 assert.equal(await page.getByRole('menuitem',{name:'继续画线',exact:true}).count(),0);await page.keyboard.press('Escape');
 await page.locator('#close-path').click();await click(initial.paths[0].nodes[0],'right');assert.equal(await page.getByRole('menuitem',{name:'继续画线',exact:true}).count(),0);assert.deepEqual(errors,[]);
});

test('a one-node open path can continue without duplicating its endpoint',async t=>{
 const {page,initial,click,save,errors}=await setup(t,{oneNode:true});await click(initial.paths[0].nodes[0],'right');await page.getByRole('menuitem',{name:'继续画线',exact:true}).click();await click({x:330,y:280});
 const d=await save();assert.equal(d.paths.length,2);assert.equal(d.paths[0].nodes.length,2);assert.deepEqual(d.paths[0].nodes[0],initial.paths[0].nodes[0]);assert.deepEqual(errors,[]);
});

test('saved operation history retains start continuation, Shift constraint and right-click extension',async t=>{
 const {page,initial,click,save,errors}=await setup(t);page.on('dialog',d=>d.accept());
 await click(initial.paths[0].nodes[0],'right');await page.getByRole('menuitem',{name:'继续画线',exact:true}).click();
 await page.locator('#save-as').click();const download=page.waitForEvent('download');await page.locator('#save-as-confirm').click();const stream=await(await download).createReadStream();let json='';for await(const chunk of stream)json+=chunk;
 await page.keyboard.press('Escape');await page.locator('#project-file').setInputFiles({name:'继续画线.json',mimeType:'application/json',buffer:Buffer.from(json)});
 await page.locator('#finish:not(:disabled)').waitFor({state:'attached'});await page.keyboard.down('Shift');await click({x:100,y:210});await page.keyboard.up('Shift');
 let d=await save();assert.equal(d.paths[0].nodes.length,4);assert.ok(Math.abs(d.paths[0].nodes[0].y-200)<.01);assert.deepEqual(d.paths[0].nodes.slice(1),initial.paths[0].nodes);
 await click({x:60,y:330},'right');await page.getByRole('menuitem',{name:'在此加点 · 续接当前曲线',exact:true}).click();
 // Native contextmenu events round client coordinates to screen pixels.
 d=await save();assert.equal(d.paths[0].nodes.length,5);assert.ok(Math.abs(d.paths[0].nodes[0].x-60)<1);assert.ok(Math.abs(d.paths[0].nodes[0].y-330)<1);assert.deepEqual(d.paths[0].nodes.slice(2),initial.paths[0].nodes);assert.deepEqual(errors,[]);
});

test('locked paths never offer endpoint continuation',async t=>{
 const {page,initial,click,errors}=await setup(t,{locked:true});await click(initial.paths[0].nodes[0],'right');assert.equal(await page.getByRole('menuitem',{name:'继续画线',exact:true}).count(),0);assert.deepEqual(errors,[]);
});
