// Isolated fixtures: never refreshes or edits a user's open canvas.
const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');const {tmpdir}=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const {chromium}=require('playwright');const G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
async function setup(t,{withDimension=false}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-navigation-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const pathA={id:'a',name:'A',role:'outline',color:'#e04544',closed:false,note:'',nodes:[G.node(100,100,'smooth'),G.node(300,100,'smooth')]};pathA.nodes[0].out={x:150,y:150};pathA.nodes[1].in={x:250,y:150};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'画布导航测试',image:null,opacity:.65,originals:[],paths:[pathA,{...pathA,id:'b',name:'B',nodes:[G.node(100,300),G.node(300,300)]}],texts:[{id:'t',name:'字',content:'测试文字',x:500,y:100,fontSize:24,color:'#176bce'}],images:[{id:'i',name:'图',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=',x:500,y:300,width:100,height:100,opacity:1}],layers:[{id:'la',name:'曲线图层 A',parentId:'g',visible:true,locked:false,pathIds:['a'],imageIds:[],textIds:[]},{id:'lb',name:'曲线图层 B',parentId:'g',visible:true,locked:false,pathIds:['b'],imageIds:[],textIds:[]},{id:'g',name:'图层组',kind:'group',visible:true,locked:false,pathIds:[],imageIds:[],textIds:[]},{id:'li',name:'图片图层',visible:true,locked:false,pathIds:[],imageIds:['i'],textIds:[]},{id:'lt',name:'文字图层',visible:true,locked:false,pathIds:[],imageIds:[],textIds:['t']}]};
 if(withDimension){const D=require('../../tools/curve-editor/dimension.js');initial.calibration={a:{x:0,y:0},b:{x:100,y:0},length:100,unit:'mm'};initial.texts.push(D.resolve({id:'dim',name:'尺寸',content:'',fontSize:14,color:'#1685a6',dimension:{a:G.point(pathA.nodes[0]),b:G.point(pathA.nodes[1]),offset:30,unit:'mm',bindings:{a:{pathId:'a',index:0},b:{pathId:'a',index:1}}}},initial.calibration));initial.layers.find(l=>l.id==='lt').textIds.push('dim');}
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);await page.locator('.layer-row[data-layer="g"]').waitFor();await expandLayerContents(page);const closed=page.locator('.panel-group:not([open]):not([data-panel="help"]) > summary');while(await closed.count())await closed.first().click();
 const screen=async p=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},p);
 const click=async(p,options)=>{const q=await screen(p);await page.mouse.click(q.x,q.y,options);};
 const camera=()=>page.locator('#viewport').getAttribute('transform');const activeLayer=()=>page.locator('.layer-row.active').getAttribute('data-layer');
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const state=()=>page.evaluate(()=>({tool:document.querySelector('[data-tool][aria-pressed="true"]')?.dataset.tool||'calibrate',count:document.querySelector('#selection-count').textContent,segment:document.querySelector('.selected-segment')?.dataset.segment??null,nodes:Array.from(document.querySelectorAll('#handles .anchor[data-selected="true"]')).map(n=>[n.dataset.path,n.dataset.node]),undo:document.querySelector('#undo').title,redo:document.querySelector('#redo').title}));
 return {page,browser,initial,errors,screen,click,camera,activeLayer,save,state};
}
test('25600% zoom keeps fine strokes, precise node and handle drags, and recoverable history',async t=>{
 const {page,click,screen,camera,save,initial,errors}=await setup(t);
 const near=(a,b)=>assert.ok(Math.abs(a-b)<.005,`${a} != ${b}`);
 const magnify=async p=>{
  const projected=await screen(p),at={x:Math.floor(projected.x),y:Math.floor(projected.y)};
  const focal=await page.locator('#viewport').evaluate((e,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(e.getScreenCTM().inverse());return {x:q.x,y:q.y};},at);
  await page.mouse.move(at.x,at.y);await page.mouse.wheel(0,-10000);
  await page.waitForFunction(()=>document.querySelector('#zoom').textContent==='25600%',null,{timeout:6000});
  const after=await screen(focal);near(after.x,at.x);near(after.y,at.y);
 };
 const dragBy=async(p,dx,dy)=>{
  const at=await screen(p);await page.mouse.move(at.x,at.y);await page.keyboard.down('Alt');await page.mouse.down();await page.mouse.move(at.x+dx,at.y+dy,{steps:4});await page.mouse.up();await page.keyboard.up('Alt');
 };
 await click({x:100,y:100});await magnify({x:100,y:100});
 const widths=await page.locator('.svg-curve').evaluateAll(es=>es.map(e=>parseFloat(getComputedStyle(e).strokeWidth)*e.getScreenCTM().a));
 assert.ok(widths.every(w=>w>=.99&&w<=1.26));
 await dragBy({x:100,y:100},32,16);const moved=await save();
 near(moved.paths[0].nodes[0].x,100+32/256);near(moved.paths[0].nodes[0].y,100+16/256);
 assert.deepEqual(moved.paths[1],initial.paths[1]);
 const view=await camera();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 assert.equal(await page.locator('#zoom').textContent(),'25600%');assert.equal(await camera(),view);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,moved.paths);
 await page.locator('#fit').click();const node=moved.paths[0].nodes[0];await click(node);await magnify(node.out);
 await dragBy(node.out,16,-8);const handled=await save();
 near(handled.paths[0].nodes[0].out.x,node.out.x+16/256);near(handled.paths[0].nodes[0].out.y,node.out.y-8/256);
 near(handled.paths[0].nodes[0].x,node.x);near(handled.paths[0].nodes[0].y,node.y);
 await page.locator('#zoom-out').click();assert.equal(await page.locator('#zoom').textContent(),'20480%');
 await page.locator('#zoom-in').click();assert.equal(await page.locator('#zoom').textContent(),'25600%');
 await page.locator('#zoom-in').click();assert.equal(await page.locator('#zoom').textContent(),'25600%');
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,moved.paths);assert.deepEqual(errors,[]);
});
test('clicking an already selected member locates its layer without collapsing element or node multiselection',async t=>{
 const {page,click,activeLayer,errors}=await setup(t);
 await page.locator('.layer-row[data-layer="g"] .layer-select').click();await click({x:210,y:300});
 assert.equal(await activeLayer(),'lb');assert.equal(await page.locator('.layer-row.selected').count(),1);assert.equal(await page.locator('#element-count').textContent(),'2 个元素');
 await page.locator('[data-tool="node"]').click();await page.locator('#select-all').click();await click({x:100,y:100});
 assert.equal(await activeLayer(),'la');assert.equal(await page.locator('#handles .anchor[data-selected="true"]').count(),4);
 await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();await click({x:520,y:120});assert.equal(await activeLayer(),'lt');await click({x:550,y:350});assert.equal(await activeLayer(),'li');assert.equal(await page.locator('#element-count').textContent(),'4 个元素');
 assert.deepEqual(errors,[]);
});
test('Ctrl temporarily pans in every canvas tool, retains edit state and does not create history',async t=>{
 const {page,screen,camera,state,save,initial,errors}=await setup(t);await page.locator('.layer-row[data-layer="la"] .layer-select').click();
 for(const tool of ['node','select','pen','trace','outline','axis','measure','text','calibrate']){
  await page.locator(tool==='calibrate'?'#calibrate':`[data-tool="${tool}"]`).click();await page.locator('#canvas').focus();const before=await state(),view=await camera(),start=await screen({x:750,y:500});
  await page.keyboard.down('Control');assert.equal((await state()).tool,'pan');await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+35,start.y+20,{steps:4});await page.mouse.up();
  assert.notEqual(await camera(),view);assert.equal(await page.locator('#context-menu').isVisible(),false);await page.keyboard.up('Control');assert.deepEqual(await state(),before);
 }
 assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('Ctrl preserves a selected segment and an unfinished pen curve across panning',async t=>{
 const {page,initial,click,screen,state,save,errors}=await setup(t);await click(G.at(initial.paths[0].nodes[0],initial.paths[0].nodes[1],.5));const segment=await state();assert.equal(segment.segment,'0');
 await page.keyboard.down('Control');const start=await screen({x:200,y:140});await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+25,start.y+30,{steps:4});await page.mouse.up();await page.keyboard.up('Control');assert.deepEqual(await state(),segment);
 await page.keyboard.press('j');assert.deepEqual((await save()).paths[0].nodes[0].out,G.point(initial.paths[0].nodes[0]));await page.locator('#undo').click();
 await page.locator('.layer-row[data-layer="la"] .layer-select').click();await page.locator('#add-path').click();await click({x:400,y:500});const before=await save();
 await page.locator('#canvas').focus();await page.keyboard.down('Control');const p=await screen({x:600,y:500});await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+45,p.y+10,{steps:3});await page.mouse.up();await page.keyboard.up('Control');await click({x:600,y:500});
 const after=await save();assert.equal(after.paths.length,before.paths.length);assert.equal(after.paths.at(-1).nodes.length,2);assert.deepEqual(after.paths.at(-1).nodes[0],before.paths.at(-1).nodes[0]);assert.ok(G.dist(after.paths.at(-1).nodes[1],{x:600,y:500})<1e-3);assert.deepEqual(errors,[]);
});
test('holding Ctrl during a node drag freezes geometry, pans and resumes the same undoable drag',async t=>{
 const {page,click,screen,camera,state,save,initial,errors}=await setup(t);await click({x:100,y:100});const start=await screen({x:100,y:100});
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+20,start.y+10,{steps:3});const beforePan=await camera();await page.keyboard.down('Control');
 await page.mouse.move(start.x+70,start.y+40,{steps:4});assert.notEqual(await camera(),beforePan);await page.keyboard.up('Control');await page.mouse.move(start.x+80,start.y+45,{steps:3});await page.mouse.up();
 const doc=await save(),node=doc.paths[0].nodes[0],zoom=await page.locator('#viewport').evaluate(el=>el.getScreenCTM().a);
 assert.ok(Math.abs(node.x-(100+30/zoom))<1e-4);assert.ok(Math.abs(node.y-(100+15/zoom))<1e-4);assert.equal((await state()).nodes.length,1);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});
test('Ctrl shortcuts and text inputs keep their behavior, while focus loss clears temporary panning',async t=>{
 const {page,state,errors}=await setup(t);await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'A'}).click();await page.locator('#path-name').focus();await page.keyboard.down('Control');assert.equal((await state()).tool,'node');await page.keyboard.up('Control');
 await page.locator('#canvas').focus();await page.keyboard.press('Control+a');assert.equal((await state()).nodes.length,4);assert.equal((await state()).tool,'node');
 await page.keyboard.down('Control');assert.equal((await state()).tool,'pan');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal((await state()).tool,'node');await page.keyboard.up('Control');assert.deepEqual(errors,[]);
});
test('temporary panning blocks text double-click editing as well as double-click node insertion',async t=>{
 const {page,save,initial,errors}=await setup(t);await page.locator('#canvas').focus();await page.keyboard.down('Control');
 await page.locator('#paths [data-text="t"]').dispatchEvent('dblclick',{ctrlKey:true});assert.equal(await page.locator('#text-dialog').isVisible(),false);
 await page.locator('#paths [data-path="a"]').dispatchEvent('dblclick',{ctrlKey:true});await page.keyboard.up('Control');assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('Ctrl+A during a suspended handle drag cannot apply that handle to another selected curve',async t=>{
 const {page,click,screen,save,initial,errors}=await setup(t);await click({x:100,y:100});const start=await screen({x:150,y:150});
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+15,start.y-8,{steps:3});await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.mouse.move(start.x+30,start.y+20,{steps:3});await page.mouse.up();
 assert.deepEqual((await save()).paths[1],initial.paths[1]);assert.deepEqual(errors,[]);
});
test('visible locked content can locate its layer in node mode while hidden content cannot',async t=>{
 const {page,click,activeLayer,save,initial,errors}=await setup(t);await page.locator('.layer-row[data-layer="li"] [data-action="locked"]').click();await click({x:100,y:100});assert.equal(await activeLayer(),'la');
 await click({x:550,y:350});assert.equal(await activeLayer(),'li');assert.equal(await page.locator('.layer-row[data-layer="li"] [data-action="locked"]').getAttribute('aria-pressed'),'true');
 await page.locator('.layer-row[data-layer="li"] [data-action="visible"]').click();await click({x:100,y:100});await click({x:550,y:350});assert.equal(await activeLayer(),'la');assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('Ctrl pauses and restores handles, whole curves, resize, rotation and newly drawn handles',async t=>{
 for(const kind of ['handle','elements','resize','rotate','new'])await t.test(kind,async sub=>{
  const {page,click,screen,camera,save,initial,errors}=await setup(sub);let start;
  if(kind==='handle'){await click({x:100,y:100});start=await screen({x:150,y:150});}
  else if(kind==='new'){await page.locator('.layer-row[data-layer="la"] .layer-select').click();await page.locator('#add-path').click();start=await screen({x:450,y:500});}
  else{await page.locator('.layer-row[data-layer="g"] .layer-select').click();if(kind==='elements')start=await screen({x:200,y:300});else{const box=await page.locator(kind==='rotate'?'[data-rotate]':'[data-corner="se"]').boundingBox();start={x:box.x+box.width/2,y:box.y+box.height/2};}}
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+15,start.y+10,{steps:3});
  const geometry=()=>page.evaluate(()=>({paths:Array.from(document.querySelectorAll('#paths .svg-curve')).map(p=>p.getAttribute('d')),handles:Array.from(document.querySelectorAll('#handles .anchor,#handles .control')).map(p=>['x','y','cx','cy'].map(a=>p.getAttribute(a)))}));
  const frozen=await geometry(),view=await camera();await page.keyboard.down('Control');await page.mouse.move(start.x+55,start.y+35,{steps:4});assert.notEqual(await camera(),view);assert.deepEqual(await geometry(),frozen);
  await page.keyboard.up('Control');assert.deepEqual(await geometry(),frozen);await page.mouse.move(start.x+60,start.y+40,{steps:2});await page.mouse.up();await save();await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
 });
});


test('camera-only navigation retains artwork nodes and avoids repeated geometry synchronization',async t=>{
 const {page,camera,save,errors}=await setup(t,{withDimension:true});
 await page.locator('[data-tool="select"]').click();await page.locator('.layer-row[data-layer="la"] .layer-select').click();
 const before=await save(),view=await camera(),canvas=await page.locator('#canvas').boundingBox();
 await page.evaluate(()=>{window.navigationCounts={sync:0,pathD:0};window.navigationCounting=false;document.addEventListener('pointermove',()=>{navigationCounting=true;},true);document.addEventListener('pointermove',()=>{navigationCounting=false;});const sync=CurveDimension.sync,pathD=CurveGeometry.pathD;CurveDimension.sync=function(...args){if(navigationCounting)navigationCounts.sync++;return sync.apply(this,args);};CurveGeometry.pathD=function(...args){if(navigationCounting)navigationCounts.pathD++;return pathD.apply(this,args);};});
 await page.keyboard.down('Control');await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.down();
 await page.evaluate(()=>{window.navigationNodes=[...document.getElementById('paths').querySelectorAll('*')];navigationCounts.sync=0;navigationCounts.pathD=0;});
 await page.mouse.move(canvas.x+canvas.width/2+90,canvas.y+canvas.height/2+35,{steps:8});
 const pan=await page.evaluate(()=>({same:navigationNodes.every((n,i)=>n===document.getElementById('paths').querySelectorAll('*')[i]),counts:{...navigationCounts}}));
 assert.equal(pan.same,true);assert.deepEqual(pan.counts,{sync:0,pathD:0});assert.notEqual(await camera(),view);
 await page.mouse.up();await page.keyboard.up('Control');
 await page.evaluate(()=>{navigationCounts.sync=0;navigationCounts.pathD=0;navigationCounting=true;try{for(let i=0;i<6;i++)document.getElementById(i%2?'zoom-out':'zoom-in').click();}finally{navigationCounting=false;}});
 const zoom=await page.evaluate(()=>navigationCounts);assert.equal(zoom.sync,0);assert.equal(zoom.pathD,before.paths.length*6);
 const after=await save();assert.deepEqual(after.paths,before.paths);assert.deepEqual(after.texts,before.texts);assert.deepEqual(after.calibration,before.calibration);assert.deepEqual(errors,[]);
});
