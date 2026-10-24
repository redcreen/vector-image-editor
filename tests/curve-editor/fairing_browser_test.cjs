// Isolated local projects only: never interact with the user's existing canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
function fixture(closed=false){
 const nodes=[[80,100],[200,120],[320,200],[400,320],[430,470],[360,550]].map(([x,y])=>G.node(x,y));
 const p={id:'bow',name:'圆顺样本',role:'outline',color:'#e04544',closed,note:'原始说明',dashed:false,nodes};G.smoothNodes(p,nodes.map((_,i)=>i));return p;
}
async function setup(t,{closed=false,calibrated=false,overlap=false}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-fairing-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:900,height:650,title:'整段圆顺测试',paths:[fixture(closed),{...fixture(),id:'other',name:'其他曲线',nodes:[G.node(650,100),G.node(750,200),G.node(650,300)]}],originals:[],images:[],image:null,opacity:.65,newNodeMode:'cusp',layers:[{id:'base',name:'原图层',visible:true,locked:false,pathIds:['bow','other'],imageIds:[],textIds:[]}],calibration:calibrated?{a:{x:0,y:0},b:{x:100,y:0},length:50,unit:'mm'}:null};
 if(overlap)initial.paths[1].nodes=structuredClone(initial.paths[0].nodes.slice(0,2));
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.stderr.on('data',s=>log+=s);server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);await expandLayerContents(page);await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'圆顺样本'}).waitFor({state:'attached'});
 const panel=page.locator('[data-panel="curves"]');if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();
 const select=async(indices,pathId='bow',append=false)=>{if(!append)await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:pathId==='bow'?'圆顺样本':'其他曲线'}).click();for(let i=0;i<indices.length;i++)await page.locator(`#handles .anchor[data-path="${pathId}"][data-node="${indices[i]}"]`).click({modifiers:i||append?['Shift']:[]});};
 const open=async()=>{await page.locator('#fair-span').click();await page.locator('#fairing-dialog').waitFor();};
 const ready=async(value='20')=>{await page.locator('#fairing-tolerance').fill(value);await page.locator('#fairing-info[data-state="ready"]').waitFor({timeout:10000});};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,initial,errors,select,open,ready,save};
}
test('node marquee keeps its starting curve scope through empty regions, overlaps and Shift append',async t=>{
 const {page,initial,errors,save}=await setup(t,{overlap:true});
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,p)=>{const s=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:s.x,y:s.y};},{x,y});
 const box=async(x,y,w,h,shift=false)=>{const a=await screen(x,y),b=await screen(x+w,y+h);if(shift)await page.keyboard.down('Shift');await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:20});await page.mouse.up();if(shift)await page.keyboard.up('Shift');};
 const chosen=()=>page.locator('#handles .anchor[data-selected="true"]').evaluateAll(ns=>ns.map(n=>`${n.dataset.path}:${n.dataset.node}`).sort());
 await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'圆顺样本'}).click();
 await box(40,60,400,300);assert.deepEqual(await chosen(),['bow:0','bow:1','bow:2','bow:3']);assert.equal(await page.locator('#fair-span').isDisabled(),false);
 await box(40,60,200,100);assert.deepEqual(await chosen(),['bow:0','bow:1']);
 await box(40,60,400,300,true);assert.deepEqual(await chosen(),['bow:0','bow:1','bow:2','bow:3']);
 // Empty movement initially clears live selection; the gesture must retain its original scope.
 await page.locator('#deselect').click();await box(40,60,400,300);assert.deepEqual(await chosen(),['bow:0','bow:1','bow:2','bow:3','other:0','other:1']);
 await page.locator('#deselect').click();await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'圆顺样本'}).click();await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'其他曲线'}).click({modifiers:['Shift']});
 await box(40,60,200,100);assert.deepEqual(await chosen(),['bow:0','bow:1','other:0','other:1']);
 assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});
test('fairing preview allows wheel, toolbar zoom and drag navigation while protecting artwork and selection',async t=>{
 const {page,initial,errors,select,open,ready,save}=await setup(t);await select([1,2,3,4]);
 const transform=()=>page.locator('#viewport').getAttribute('transform');
 const pathD=()=>page.locator('#paths .hit-line[data-path="bow"]').getAttribute('d');
 const selected=()=>page.locator('#handles .anchor[data-selected="true"]').evaluateAll(ns=>ns.map(n=>n.dataset.node));
 const original=await pathD(),chosen=await selected();await open();await ready();
 const preview=await page.locator('#fairing-preview [data-fairing-preview]').getAttribute('d'),before=await transform();
 const canvas=await page.locator('#canvas').boundingBox();await page.mouse.move(canvas.x+canvas.width/3,canvas.y+canvas.height/2);await page.mouse.wheel(0,-220);
 await page.waitForFunction(before=>document.getElementById('viewport').getAttribute('transform')!==before,before,{timeout:2000});
 for(const id of ['zoom-in','zoom-out','fit']){const previous=await transform();await page.locator('#'+id).click({timeout:2000});assert.notEqual(await transform(),previous);}
 const anchor=await page.locator('#handles .anchor[data-path="bow"][data-node="2"]').boundingBox(),start=await transform();
 await page.mouse.move(anchor.x+anchor.width/2,anchor.y+anchor.height/2);await page.mouse.down();await page.mouse.move(anchor.x+anchor.width/2+65,anchor.y+anchor.height/2+35,{steps:8});await page.mouse.up();assert.notEqual(await transform(),start);
 await page.locator('#handles .anchor[data-path="bow"][data-node="2"]').dblclick();await page.locator('#handles .anchor[data-path="bow"][data-node="2"]').click({button:'right'});
 for(const key of ['Delete','ArrowRight','j','Control+z','F10'])await page.keyboard.press(key);
 assert.equal(await page.locator('#context-menu').isVisible(),false);assert.equal(await pathD(),original);assert.deepEqual(await selected(),chosen);assert.equal(await page.locator('#fairing-preview [data-fairing-preview]').getAttribute('d'),preview);
 assert.equal(await page.locator('#new').evaluate(e=>!!e.closest('[inert]')),true);assert.equal(await page.locator('#tool-dock').evaluate(e=>e.inert),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#fairing-dialog').isVisible(),false);assert.equal(await page.locator('#new').evaluate(e=>!!e.closest('[inert]')),false);
 assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});
test('Escape during preview panning releases capture and restores normal editing and one-step apply',async t=>{
 const {page,initial,errors,select,open,ready,save}=await setup(t);await select([1,2,3,4]);await open();await ready();
 const canvas=await page.locator('#canvas').boundingBox(),x=canvas.x+canvas.width/3,y=canvas.y+canvas.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y+30,{steps:4});await page.keyboard.press('Escape');
 const camera=await page.locator('#viewport').getAttribute('transform');await page.mouse.move(x+100,y+80);await page.mouse.up();
 assert.equal(await page.locator('#viewport').getAttribute('transform'),camera);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#undo').isDisabled(),false);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await open();await ready();await page.locator('#zoom-in').click();await page.locator('#fairing-apply').click();assert.equal(await page.locator('#tool-dock').evaluate(e=>e.inert),false);
 assert.notDeepEqual((await save()).paths,initial.paths);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});
test('whole-span preview fixes ends, optionally locks references, applies once, and survives undo/redo/reload',async t=>{
 const {page,initial,errors,select,open,ready,save}=await setup(t);
 await select([1,2,3,4]);await open();await ready();
 assert.equal(await page.locator('#fairing-unit').inputValue(),'px');
 assert.equal(await page.locator('#fairing-preview [data-fairing-preview]').count(),1);
 assert.equal(await page.locator('#undo').isDisabled(),true);
 assert.equal(await page.locator('#fairing-points input:disabled:checked').count(),2);
 await page.locator('#fairing-points input[data-relative="1"]').check();await ready('21');
 const original=await page.locator('#paths .hit-line[data-path="bow"]').getAttribute('d');
 if(process.env.CURVE_EDITOR_FAIRING_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_FAIRING_SCREENSHOT,fullPage:true});
 await page.locator('#fairing-apply').click();assert.equal(await page.locator('#fairing-preview path').count(),0);
 const result=await save(),before=initial.paths[0],after=result.paths[0];assert.notEqual(await page.locator('#paths .hit-line[data-path="bow"]').getAttribute('d'),original);
 for(const i of [1,2,4])assert.deepEqual(G.point(after.nodes[i]),G.point(before.nodes[i]));
 assert.deepEqual(after.nodes[0],before.nodes[0]);assert.deepEqual(after.nodes[5],before.nodes[5]);assert.deepEqual(after.nodes[1].in,before.nodes[1].in);assert.deepEqual(after.nodes[4].out,before.nodes[4].out);
 assert.deepEqual(result.paths[1],initial.paths[1]);assert.deepEqual(result.layers,initial.layers);assert.equal(after.note,before.note);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,result.paths);
 await page.reload();await expandLayerContents(page);await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'圆顺样本'}).waitFor({state:'attached'});assert.deepEqual((await save()).paths,result.paths);assert.deepEqual(errors,[]);
});
test('cancel, Escape, invalid values and reload during preview do not mutate geometry or consume redo',async t=>{
 const {page,initial,errors,select,open,ready,save}=await setup(t);await select([1,2,3,4]);await open();await ready();await page.locator('#fairing-apply').click();await page.locator('#undo').click();
 await open();await ready();for(const value of ['','-1']){await page.locator('#fairing-tolerance').fill(value);assert.equal(await page.locator('#fairing-apply').isDisabled(),true);assert.equal(await page.locator('#fairing-preview [data-fairing-preview]').count(),0);}
 await ready();await page.locator('#fairing-cancel').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#redo').isDisabled(),false);
 await open();await ready();await page.keyboard.press('Escape');assert.equal(await page.locator('#fairing-dialog').isVisible(),false);assert.deepEqual((await save()).paths,initial.paths);
 await open();await ready();await page.reload();await expandLayerContents(page);await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'圆顺样本'}).waitFor({state:'attached'});assert.equal(await page.locator('#fairing-dialog').isVisible(),false);assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('selection must be a contiguous partial chain on one editable curve',async t=>{
 const {page,errors,select}=await setup(t);await select([1,3,4]);assert.equal(await page.locator('#fair-span').isDisabled(),true);
 await select([1,2]);assert.equal(await page.locator('#fair-span').isDisabled(),true);
 await select([1,2,3]);assert.equal(await page.locator('#fair-span').isDisabled(),false);
 await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'其他曲线'}).click({modifiers:['Shift']});await page.locator('#handles .anchor[data-path="other"][data-node="1"]').click({modifiers:['Shift']});assert.equal(await page.locator('#fair-span').isDisabled(),true);assert.deepEqual(errors,[]);
});
test('calibrated unit changes preserve physical tolerance and selected node right-click opens fairing',async t=>{
 const {page,errors,select,ready}=await setup(t,{calibrated:true});await select([1,2,3,4]);await page.locator('#handles .anchor[data-path="bow"][data-node="2"]').click({button:'right'});await page.getByRole('menuitem',{name:'整段圆顺…',exact:true}).click();
 assert.equal(await page.locator('#fairing-unit').inputValue(),'mm');await ready('10');const d=await page.locator('#fairing-preview [data-fairing-preview]').getAttribute('d');
 await page.locator('#fairing-unit').selectOption('cm');await page.locator('#fairing-info[data-state="ready"]').waitFor();assert.equal(Number(await page.locator('#fairing-tolerance').inputValue()),1);assert.equal(await page.locator('#fairing-preview [data-fairing-preview]').getAttribute('d'),d);
 await page.locator('#fairing-cancel').click();assert.deepEqual(errors,[]);
});
test('closed wraparound span uses traversal order and protects the unselected segment',async t=>{
 const {page,initial,errors,select,open,ready,save}=await setup(t,{closed:true});await select([0,1,4,5]);await open();
 assert.match(await page.locator('#fairing-summary').textContent(),/5 → 2/);await ready('100');await page.locator('#fairing-apply').click();const after=(await save()).paths[0],before=initial.paths[0];
 for(const i of [1,4])assert.deepEqual(G.point(after.nodes[i]),G.point(before.nodes[i]));for(const i of [2,3])assert.deepEqual(after.nodes[i],before.nodes[i]);assert.deepEqual(after.nodes[4].in,before.nodes[4].in);assert.deepEqual(after.nodes[1].out,before.nodes[1].out);assert.equal(after.closed,true);
 await select([0,1,2,3,4,5]);assert.equal(await page.locator('#fair-span').isDisabled(),true);assert.deepEqual(errors,[]);
});

test('a delayed import discards the old preview and cannot apply it to the replacement artwork',async t=>{
 const {page,initial,errors,select,open,ready,save}=await setup(t);await select([1,2,3,4]);
 await page.evaluate(()=>{const read=File.prototype.text;File.prototype.text=function(){return new Promise(resolve=>{window.finishFairingImport=()=>read.call(this).then(resolve);});};});
 const imported={...initial,title:'新作品',paths:[{...fixture(),id:'replacement',name:'替换作品'}],layers:[{id:'replacement-layer',name:'替换图层',visible:true,locked:false,pathIds:['replacement'],imageIds:[],textIds:[]}]};
 await page.locator('#project-file').setInputFiles({name:'replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
 await page.waitForFunction(()=>window.finishFairingImport);await open();await ready();await page.evaluate(()=>window.finishFairingImport());
 await expandLayerContents(page);await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'替换作品'}).waitFor({state:'attached'});
 assert.equal(await page.locator('#fairing-dialog').isVisible(),false);assert.equal(await page.locator('#fairing-preview path').count(),0);
 assert.deepEqual((await save()).paths,imported.paths);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('fairing dialog stays below wrapped navigation controls after viewport resizing',async t=>{
 const {page,errors,select,open,ready}=await setup(t);await select([1,2,3,4]);await open();await ready();
 for(const width of [1440,1100,1600]){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  for(const id of ['zoom-in','zoom-out','fit']){
   const target=await page.locator('#'+id).evaluate(button=>{const r=button.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')?.id;});
   assert.equal(target,id,`navigation remains reachable at width ${width}`);
  }
  const bounds=await page.evaluate(()=>({toolbar:document.querySelector('.actionbar').getBoundingClientRect().bottom,dialog:document.getElementById('fairing-dialog').getBoundingClientRect().top}));
  assert.ok(bounds.dialog>=bounds.toolbar,JSON.stringify(bounds));
 }
 if(process.env.CURVE_EDITOR_FAIRING_LAYOUT_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_FAIRING_LAYOUT_SCREENSHOT,fullPage:true});
 assert.deepEqual(errors,[]);
});
