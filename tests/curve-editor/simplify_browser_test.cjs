// All browser fixtures run in disposable test projects, never in live artwork.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
const {fixtureOptions}=require('./fixture_helpers.cjs');
async function setup(t,{calibrated=true,locked=false,legacyMarker=false,realSample=false}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-simplify-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const nodes=Array.from({length:81},(_,i)=>G.node(100+i*5,200+80*Math.sin(i/80*Math.PI)));
 const curve={id:'dense',name:'密集曲线',closed:false,color:'#272727',role:'outline',note:'保留说明',dashed:true,nodes};
 const other={...structuredClone(curve),id:'other',name:'其他曲线',nodes:nodes.map(n=>{const c=structuredClone(n);G.move(c,0,200);return c;})};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:900,height:650,title:'简化测试',paths:[curve,other],originals:[],images:[],image:null,opacity:.65,newNodeMode:'cusp',texts:[],layers:[{id:'base',name:'测试图层',visible:true,locked:false,pathIds:['dense','other'],imageIds:[],textIds:[],items:[{type:'path',id:'dense'},{type:'path',id:'other',locked}]}],calibration:calibrated?{a:{x:0,y:0},b:{x:100,y:0},length:100,unit:'mm'}:null};
 if(legacyMarker){const n=nodes[21];initial.texts=[{id:'mark',name:'A',content:'A',x:n.x+10,y:n.y-15,fontSize:10,color:'#1685a6',positionMarker:{x:n.x,y:n.y}}];initial.layers[0].textIds=['mark'];initial.layers[0].items.push({type:'text',id:'mark'});}
 if(realSample){initial.paths=[require(realSample==='body'?'./fixtures/simplify-body-small.json':'./fixtures/simplify-2-small.json')];initial.paths[0]=structuredClone(initial.paths[0]);initial.paths[0].name='密集曲线';const bounds=G.pathBounds(initial.paths[0]);for(const node of initial.paths[0].nodes)G.move(node,100-bounds.x,70-bounds.y);initial.width=300;initial.height=300;initial.layers[0].pathIds=[initial.paths[0].id];initial.layers[0].items=[{type:'path',id:initial.paths[0].id}];}
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.stderr.on('data',s=>log+=s);server.once('error',reject);});
 browser=await chromium.launch({headless:true,channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL||'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);await expandLayerContents(page);
 const row=name=>page.locator('#layer-list .curve-select').filter({hasText:name});
 await row('密集曲线').waitFor();
 const read=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const open=async()=>{await row('密集曲线').click({button:'right'});await page.getByRole('menuitem',{name:'简化曲线点…',exact:true}).click();await page.locator('#simplify-info[data-state="ready"],#simplify-info[data-state="error"]').waitFor();assert.equal(await page.locator('#simplify-info').getAttribute('data-state'),'ready',await page.locator('#simplify-info').textContent());};
 return {page,initial,errors,row,read,open};
}
test('simplification preview cancels without edits, applies once, restores via undo/redo and local recovery',async t=>{
 const {page,initial,errors,read,open}=await setup(t);await open();
 assert.equal(await page.locator('#simplify-unit').inputValue(),'mm');assert.equal(await page.locator('#simplify-tolerance').inputValue(),'0.01');
 assert.equal(await page.locator('#simplify-tolerance').evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))),false);
 assert.equal(await page.locator('#simplify-preview [data-simplify-preview]').count(),1);assert.equal(await page.locator('#undo').isDisabled(),true);
 assert.match(await page.locator('#simplify-info').textContent(),/81 →/);
 const source=await page.locator('#paths .hit-line[data-path="dense"]').getAttribute('d');
 const zoomBefore=await page.locator('#viewport').getAttribute('transform');await page.locator('#zoom-in').click();assert.notEqual(await page.locator('#viewport').getAttribute('transform'),zoomBefore);await page.locator('#simplify-tolerance').focus();await page.keyboard.press('Delete');assert.equal(await page.locator('#paths .hit-line[data-path="dense"]').getAttribute('d'),source);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#simplify-dialog').isVisible(),false);assert.equal(await page.locator('#undo').isDisabled(),true);
 assert.deepEqual((await read()).paths,initial.paths);await open();
 await page.locator('#simplify-unit').selectOption('cm');assert.equal(Number(await page.locator('#simplify-tolerance').inputValue()),.001);
 await page.locator('#simplify-info[data-state="ready"]').waitFor();await page.locator('#simplify-apply').click();
 const result=await read();assert.ok(result.paths[0].nodes.length<81);assert.deepEqual(result.paths[1],initial.paths[1]);assert.equal(result.paths[0].note,initial.paths[0].note);
 await page.locator('#undo').click();assert.deepEqual((await read()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await read()).paths,result.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await expandLayerContents(page);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.deepEqual((await read()).paths,result.paths);
 assert.deepEqual(errors,[]);
});
test('multi-selection simplifies only selected editable curves; invalid inputs never enable apply',async t=>{
 const {page,initial,errors,row,read,open}=await setup(t,{calibrated:false});
 await row('密集曲线').click();await row('其他曲线').click({modifiers:['Shift']});await open();
 assert.equal(await page.locator('#simplify-unit').inputValue(),'px');assert.equal(await page.locator('#simplify-unit option').count(),1);
 assert.equal(await page.locator('#simplify-preview [data-simplify-preview]').count(),2);
 await page.locator('#simplify-tolerance').fill('-1');await page.locator('#simplify-info[data-state="error"]').waitFor();assert.equal(await page.locator('#simplify-apply').isDisabled(),true);
 await page.locator('#simplify-tolerance').fill('0.1');await page.locator('#simplify-info[data-state="ready"]').waitFor();await page.locator('#simplify-apply').click();const result=await read();assert.ok(result.paths.every(p=>p.nodes.length<81));
 await page.locator('#undo').click();assert.deepEqual((await read()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('locked curves cannot be simplified and preview refresh leaves original geometry',async t=>{
 const {page,initial,row,read,open,errors}=await setup(t,{locked:true});
 await open();await page.reload();await expandLayerContents(page);assert.deepEqual((await read()).paths,initial.paths);
 assert.equal(await row('其他曲线').isDisabled(),true);assert.equal(await page.locator('#context-menu').isVisible(),false);assert.deepEqual(errors,[]);
});

test('legacy position labels retain their anchor coordinates through simplification',async t=>{
 const {page,initial,read,open,errors}=await setup(t,{legacyMarker:true});await open();await page.locator('#simplify-tolerance').fill('0.1');await page.locator('#simplify-info[data-state="ready"]').waitFor();await page.locator('#simplify-apply').click();
 const result=await read(),a=initial.texts[0],b=result.texts[0];assert.ok(result.paths[0].nodes.length<81);assert.equal(b.positionMarker.x,a.positionMarker.x);assert.equal(b.positionMarker.y,a.positionMarker.y);assert.equal(b.x,a.x);assert.equal(b.y,a.y);assert.deepEqual(errors,[]);
});

test('the 415-node small-pattern curve previews at 0.01 mm without altering the source',fixtureOptions('simplify-2-small.json'),async t=>{
 const {page,initial,read,open,errors}=await setup(t,{realSample:true});await open();assert.match(await page.locator('#simplify-info').textContent(),/415 → 111/);
 if(process.env.SIMPLIFY_SCREENSHOT)await page.screenshot({path:process.env.SIMPLIFY_SCREENSHOT,fullPage:true});
 await page.locator('#simplify-cancel').click();assert.deepEqual((await read()).paths,initial.paths);assert.deepEqual(errors,[]);
});


test('576-node body preview enables apply at 0.08 mm and undo restores every original anchor',fixtureOptions('simplify-body-small.json'),async t=>{
 const {page,initial,read,open,errors}=await setup(t,{realSample:'body'});await open();
 assert.match(await page.locator('#simplify-info').textContent(),/576 → 172/);
 await page.locator('#simplify-tolerance').fill('0.08');await page.locator('#simplify-info[data-state="ready"]').waitFor();
 assert.match(await page.locator('#simplify-info').textContent(),/576 → 89/);assert.equal(await page.locator('#simplify-apply').isEnabled(),true);
 if(process.env.SIMPLIFY_BODY_SCREENSHOT)await page.screenshot({path:process.env.SIMPLIFY_BODY_SCREENSHOT,fullPage:true});
 await page.locator('#simplify-apply').click();assert.equal((await read()).paths[0].nodes.length,89);
 await page.locator('#undo').click();assert.deepEqual((await read()).paths,initial.paths);assert.deepEqual(errors,[]);
});
