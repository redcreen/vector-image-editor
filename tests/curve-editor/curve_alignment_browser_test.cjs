const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
async function setup(t,decorate){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-curve-alignment-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const source={id:'source',name:'移动曲线',color:'#e04544',role:'cut',closed:false,note:'',nodes:[G.node(100,100),G.node(150,180,'smooth'),G.node(100,280)]};source.nodes[1].in={x:130,y:150};source.nodes[1].out={x:170,y:210};
 const target={id:'target',name:'参考曲线',color:'#176bce',role:'cut',closed:false,note:'',nodes:[G.node(400,100),G.node(600,100)]};target.nodes[0].out={x:400,y:300};target.nodes[1].in={x:600,y:300};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'曲线吸附测试',width:900,height:550,image:null,images:[],texts:[],originals:[],opacity:.65,paths:[source,target],layers:[{id:'source-layer',name:'移动图层',visible:true,locked:false,pathIds:['source'],imageIds:[],textIds:[]},{id:'target-layer',name:'参考图层',visible:true,locked:false,pathIds:['target'],imageIds:[],textIds:[]}]};if(decorate)decorate(initial);
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(6000);
 await page.goto(url);await page.locator('#paths [data-path="source"]').waitFor({state:'attached'});await expandLayerContents(page);await page.locator('.curve-item[data-path="source"] .curve-select').click();
 const screen=async p=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},p);
 const move=async(p,dx=0,dy=0)=>{const q=await screen(p);await page.mouse.move(q.x+dx,q.y+dy);};const begin=async(p,expectedPath)=>{await move(p);if(expectedPath){const q=await screen(p);assert.equal(await page.evaluate(q=>document.elementFromPoint(q.x,q.y)?.getAttribute('data-path'),q),expectedPath,'drag must hit the curve rather than its rotation-center handle');}await page.mouse.down();};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const near=(a,b)=>assert.ok(G.dist(a,b)<.001,`${JSON.stringify(a)} vs ${JSON.stringify(b)}`);return {page,initial,errors,screen,move,begin,save,near,hint:page.locator('#node-alignment [data-alignment="curve"]'),relation:page.locator('#curve-relation [data-relation]')};
}

test('node snaps to the middle of another cubic, releases outside the radius, and preserves target and handles through undo/reload',async t=>{
 const {page,initial,errors,move,begin,save,near,hint}=await setup(t),n=initial.paths[0].nodes[1],contact={x:500,y:250};await begin(n);await move(contact,0,5);assert.equal(await hint.count(),0);await move(contact,0,2);assert.equal(await hint.count(),1);assert.match(await hint.textContent(),/吸附曲线/);await move(contact,0,5);assert.equal(await hint.count(),0);await move(contact,0,2);await page.mouse.up();const d=await save();near(d.paths[0].nodes[1],contact);assert.deepEqual(d.paths[1],initial.paths[1]);assert.equal(d.paths.length,2);assert.equal(d.paths[1].nodes.length,2);for(const side of ['in','out'])near(d.paths[0].nodes[1][side],{x:n[side].x+350,y:n[side].y+70});
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);await page.locator('#redo').click();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#paths [data-path="source"]').waitFor({state:'attached'});assert.deepEqual((await save()).paths,d.paths);assert.deepEqual(errors,[]);
});

for(const state of ['hidden-path','hidden-layer','locked'])test(`curve snap ${state} references follow visibility and protection rules`,async t=>{
 const {page,initial,errors,move,begin,save,hint}=await setup(t,d=>{if(state==='hidden-path')d.paths[1].visible=false;if(state==='hidden-layer')d.layers[1].visible=false;if(state==='locked')d.layers[1].locked=true;});await begin(initial.paths[0].nodes[1]);await move({x:500,y:250},0,2);assert.equal(await hint.count(),state==='locked'?1:0);await page.mouse.up();assert.deepEqual((await save()).paths[1],initial.paths[1]);assert.deepEqual(errors,[]);
});

test('Alt, zoom and Shift work for curve snapping, and a curve never snaps to its own moving segments',async t=>{
 const {page,initial,errors,move,begin,save,hint}=await setup(t,d=>d.paths[1].nodes=[G.node(400,80),G.node(400,400)]),n=initial.paths[0].nodes[1];await move(n);const z=await page.locator('#zoom').textContent();await page.mouse.wheel(0,-250);await page.waitForFunction(old=>document.getElementById('zoom').textContent!==old,z);
 await begin(n);await move({x:400,y:200},5,0);assert.equal(await hint.count(),0);await move({x:400,y:200},2,0);assert.equal(await hint.count(),1);await page.keyboard.down('Alt');assert.equal(await hint.count(),0);await page.keyboard.up('Alt');assert.equal(await hint.count(),1);await move({x:400,y:n.y},2,0);await page.keyboard.down('Shift');assert.equal(Number(await page.locator('#node-x').inputValue()),400);assert.equal(Number(await page.locator('#node-y').inputValue()),n.y);await page.keyboard.up('Shift');await page.mouse.up();await page.locator('#undo').click();
 await begin(n);await move(G.at(initial.paths[0].nodes[0],initial.paths[0].nodes[1],.5),2,0);assert.equal(await hint.count(),0);await page.mouse.up();assert.equal((await save()).paths.length,2);assert.deepEqual(errors,[]);
});

test('node dragging highlights real overlap while keeping both paths independent',async t=>{
 const {page,initial,errors,move,begin,save,relation,hint}=await setup(t,d=>{d.paths[0].nodes=[G.node(100,200),G.node(250,190),G.node(250,280)];d.paths[1].nodes=[G.node(400,200),G.node(700,200)];});await begin(initial.paths[0].nodes[1]);await move({x:550,y:200},0,2);assert.equal(await hint.count(),1);assert.equal(await relation.getAttribute('data-relation'),'overlap');assert.match(await relation.textContent(),/重合/);await page.mouse.up();assert.equal(await relation.count(),0);const d=await save();assert.equal(d.paths[0].nodes[1].y,200);assert.deepEqual(d.paths[1],initial.paths[1]);assert.equal(d.paths.length,2);assert.deepEqual(errors,[]);
});

test('whole-curve translation shows parallel and overlap hints without changing the requested position',async t=>{
 const {page,initial,errors,move,begin,save,near,relation}=await setup(t,d=>{d.paths[0].nodes=[G.node(100,100),G.node(250,100)];d.paths[1].nodes=[G.node(400,200),G.node(700,200)];});await page.locator('[data-tool="select"]').click();await begin({x:150,y:100},'source');await move({x:500,y:190});assert.equal(await relation.getAttribute('data-relation'),'parallel');assert.match(await relation.textContent(),/平行/);await page.keyboard.down('Alt');assert.equal(await relation.count(),0);await page.keyboard.up('Alt');assert.equal(await relation.count(),1);await page.mouse.up();let d=await save();near(d.paths[0].nodes[0],{x:450,y:190});assert.deepEqual(d.paths[1],initial.paths[1]);await page.locator('#undo').click();
 await begin({x:150,y:100},'source');await move({x:500,y:200});assert.equal(await relation.getAttribute('data-relation'),'overlap');await page.mouse.up();d=await save();near(d.paths[0].nodes[0],{x:450,y:200});assert.equal(d.paths.length,2);assert.deepEqual(errors,[]);
});

test('node dragging shows parallel against visible locked references and ignores hidden paths and layers',async t=>{
 const {page,initial,errors,move,begin,save,near,relation,hint}=await setup(t,d=>{
  d.paths[0].nodes=[G.node(100,190),G.node(250,190),G.node(250,280)];d.paths[1].nodes=[G.node(400,200),G.node(700,200)];d.paths[1].visible=false;
  for(const id of ['hidden-layer','locked']){d.paths.push({...JSON.parse(JSON.stringify(d.paths[1])),id,visible:true});d.layers.push({id:id+'-layer',name:id,visible:id!=='hidden-layer',locked:id==='locked',pathIds:[id],imageIds:[],textIds:[]});}
 });
 await begin(initial.paths[0].nodes[1]);await move({x:550,y:190});assert.equal(await hint.count(),0);assert.equal(await relation.getAttribute('data-relation'),'parallel');assert.equal(await relation.getAttribute('data-target'),'locked');
 await page.keyboard.down('Alt');assert.equal(await relation.count(),0);await page.keyboard.up('Alt');assert.equal(await relation.count(),1);await move({x:550,y:160});assert.equal(await relation.count(),0);await move({x:550,y:190});if(process.env.CURVE_EDITOR_CURVE_RELATION_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_CURVE_RELATION_SCREENSHOT,fullPage:true});await page.mouse.up();const d=await save();near(d.paths[0].nodes[1],{x:550,y:190});assert.deepEqual(d.paths.slice(1),initial.paths.slice(1));assert.deepEqual(errors,[]);
});

test('multiple dragged nodes use one curve correction and preserve their handles and unselected nodes',async t=>{
 const {page,initial,errors,move,begin,save,near,hint}=await setup(t),nodes=initial.paths[0].nodes;
 await begin(nodes[0]);await page.mouse.up();
 await page.keyboard.down('Shift');await move(nodes[1]);await page.mouse.down();await page.mouse.up();await page.keyboard.up('Shift');await begin(nodes[0]);await move({x:500,y:250},0,2);assert.equal(await hint.count(),1);await page.mouse.up();const d=await save();
 for(const i of [0,1])for(const p of ['', 'in','out']){const before=p?nodes[i][p]:nodes[i],after=p?d.paths[0].nodes[i][p]:d.paths[0].nodes[i];near(after,{x:before.x+400,y:before.y+150});}assert.deepEqual(d.paths[0].nodes[2],nodes[2]);assert.deepEqual(d.paths[1],initial.paths[1]);assert.deepEqual(errors,[]);
});

test('dragging the last node of a closed path checks its closing segment for parallel hints',async t=>{
 const {page,initial,errors,move,begin,save,near,relation}=await setup(t,d=>{d.paths[0].closed=true;d.paths[0].nodes=[G.node(100,100),G.node(200,100),G.node(200,200),G.node(250,110)];d.paths[1].nodes=[G.node(400,110),G.node(700,110)];});
 await begin(initial.paths[0].nodes[3]);await move({x:550,y:100});assert.equal(await relation.getAttribute('data-relation'),'parallel');assert.equal(await relation.getAttribute('data-segment'),'3');await page.mouse.up();const d=await save();near(d.paths[0].nodes[3],{x:550,y:100});assert.deepEqual(d.paths[1],initial.paths[1]);assert.deepEqual(errors,[]);
});

test('a nearly parallel node segment aligns exactly on release in one undo step, while larger angles stay free',async t=>{
 const {page,initial,errors,move,begin,save,near,relation}=await setup(t,d=>{d.paths[0].nodes=[G.node(100,100),G.node(250,110),G.node(250,280)];d.paths[1].nodes=[G.node(400,110),G.node(700,110)];});
 await begin(initial.paths[0].nodes[1]);await move({x:550,y:101});assert.match(await relation.textContent(),/松手对齐/);await page.mouse.up();const d=await save();near(d.paths[0].nodes[1],{x:550,y:100});assert.deepEqual(d.paths[0].nodes[0],initial.paths[0].nodes[0]);assert.deepEqual(d.paths[1],initial.paths[1]);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);await page.locator('#redo').click();assert.deepEqual((await save()).paths,d.paths);await page.locator('#undo').click();
 await begin(initial.paths[0].nodes[1]);await move({x:550,y:105});assert.equal(await relation.count(),0);await page.mouse.up();near((await save()).paths[0].nodes[1],{x:550,y:105});assert.deepEqual(errors,[]);
});

test('near-parallel whole curves rotate rigidly on release, Alt bypasses and cancellation does not align',async t=>{
 const {page,initial,errors,move,begin,save,near,relation}=await setup(t,d=>{d.paths[0].nodes=[G.node(100,100),G.node(250,100.6)];d.paths[1].nodes=[G.node(400,200),G.node(700,200)];d.texts=[{id:'label',name:'A1',content:'A1',x:110,y:70,fontSize:12,color:'#1685a6',rotation:0,positionMarker:{x:100,y:100,pathId:'source'}}];d.layers[0].textIds=['label'];});await page.locator('[data-tool="select"]').click();
 await begin({x:150,y:100.2},'source');await move({x:500,y:189.9});assert.match(await relation.textContent(),/松手对齐/);if(process.env.CURVE_EDITOR_CURVE_RELATION_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_CURVE_RELATION_SCREENSHOT,fullPage:true});await page.mouse.up();const d=await save(),nodes=d.paths[0].nodes;near(d.texts[0].positionMarker,nodes[0]);assert.equal(d.texts[0].rotation,0);assert.ok(Math.abs(nodes[1].y-nodes[0].y)<1e-8);near({x:(nodes[0].x+nodes[1].x)/2,y:(nodes[0].y+nodes[1].y)/2},{x:525,y:190});assert.ok(Math.abs(G.dist(...nodes)-G.dist(...initial.paths[0].nodes))<1e-8);assert.deepEqual(d.paths[1],initial.paths[1]);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await begin({x:150,y:100.2},'source');await move({x:500,y:189.9});await page.keyboard.down('Alt');assert.equal(await relation.count(),0);await page.mouse.up();await page.keyboard.up('Alt');let free=await save();assert.ok(Math.abs(free.paths[0].nodes[1].y-free.paths[0].nodes[0].y-.6)<1e-8);await page.locator('#undo').click();
 await begin({x:150,y:100.2},'source');await move({x:500,y:189.9});await page.locator('#canvas').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();free=await save();assert.ok(Math.abs(free.paths[0].nodes[1].y-free.paths[0].nodes[0].y-.6)<1e-8);assert.deepEqual(errors,[]);
});

test('first endpoints align against reversed references, while Shift keeps an incompatible drag direction',async t=>{
 const {page,initial,errors,move,begin,save,near,relation}=await setup(t,d=>{d.paths[0].nodes=[G.node(100,100),G.node(600,200),G.node(600,300)];d.paths[1].nodes=[G.node(700,210),G.node(400,210)];});
 await begin(initial.paths[0].nodes[0]);await move({x:450,y:199});assert.equal(await relation.getAttribute('data-relation'),'parallel');await page.mouse.up();near((await save()).paths[0].nodes[0],{x:450,y:200});await page.locator('#undo').click();
 await begin(initial.paths[0].nodes[0]);await move({x:450,y:199});await page.keyboard.down('Shift');assert.equal(await relation.count(),0);await page.mouse.up();await page.keyboard.up('Shift');assert.deepEqual((await save()).paths[1],initial.paths[1]);assert.deepEqual(errors,[]);
});

test('selected endpoint pairs align by rigid rotation and leave unselected nodes unchanged',async t=>{
 const {page,initial,errors,move,begin,save,relation}=await setup(t,d=>{d.paths[0].nodes=[G.node(100,100),G.node(250,100.6),G.node(350,200)];d.paths[1].nodes=[G.node(400,200),G.node(700,200)];}),nodes=initial.paths[0].nodes;
 await begin(nodes[0]);await page.mouse.up();await page.keyboard.down('Shift');await begin(nodes[1]);await page.mouse.up();await page.keyboard.up('Shift');await begin(nodes[0]);await move({x:450,y:190});assert.match(await relation.textContent(),/松手对齐/);await page.mouse.up();const d=await save();assert.ok(Math.abs(d.paths[0].nodes[0].y-d.paths[0].nodes[1].y)<1e-8);assert.ok(Math.abs(G.dist(...d.paths[0].nodes.slice(0,2))-G.dist(...nodes.slice(0,2)))<1e-8);assert.deepEqual(d.paths[0].nodes[2],nodes[2]);assert.deepEqual(d.paths[1],initial.paths[1]);assert.deepEqual(errors,[]);
});

test('near-diagonal segments become exactly parallel without changing their reference',async t=>{
 const {page,initial,errors,move,begin,save,near,relation}=await setup(t,d=>{d.paths[0].nodes=[G.node(100,100),G.node(250,250),G.node(100,300)];d.paths[1].nodes=[G.node(400,410),G.node(700,710)];});
 await begin(initial.paths[0].nodes[1]);await move({x:550,y:549});assert.match(await relation.textContent(),/松手对齐/);await page.mouse.up();const d=await save();near(d.paths[0].nodes[1],{x:549.5,y:549.5});assert.deepEqual(d.paths[1],initial.paths[1]);assert.deepEqual(errors,[]);
});
