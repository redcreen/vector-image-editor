// All editing and saves below use a disposable test project.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const {fixtureOptions}=require('./fixture_helpers.cjs');
async function setup(t,{sameLayer=false,doc:customDoc}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-fitting-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,points,closed=false)=>({id,name:id,color:'#176bce',role:'outline',dashed:false,note:'',closed,nodes:points.map(p=>G.node(...p))});
 const seam=curve('moving-seam',[[100,180],[400,180]]),outline=curve('outline',[[90,170],[410,170],[410,280],[90,280]],true),notch=curve('notch',[[220,180],[220,193]]);
 const target=curve('target',[[550,150],[820,260]]);target.nodes[0].out={x:660,y:140};target.nodes[1].in={x:750,y:190};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:650,title:'拟合测试',paths:[seam,outline,notch,target],originals:[],images:[],texts:[],image:null,opacity:.65,newNodeMode:'cusp',calibration:{a:{x:0,y:0},b:{x:100,y:0},length:100,unit:'mm'},layers:[{id:'piece',name:'活动布片',visible:true,locked:false,pathIds:['moving-seam','outline','notch'],imageIds:[],textIds:[]},{id:'fixed',name:'固定布片',visible:true,locked:false,pathIds:['target'],imageIds:[],textIds:[]}]};
 if(sameLayer){initial.layers[0].pathIds.push('target');initial.layers.splice(1);}
 if(customDoc)Object.assign(initial,customDoc);
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.stderr.on('data',s=>log+=s);server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);await page.locator('.layer-row[data-layer="piece"]').waitFor();
 const screen=async p=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},p);
 const click=async p=>{const q=await screen(p);await page.mouse.click(q.x,q.y);};
 const start=async({editing=true,select=true}={})=>{if(select)await page.locator('.layer-row[data-layer="piece"] .layer-select').click();else await page.locator('#deselect').click();await page.locator('#fit-curves').click();await click({x:250,y:180});await click(G.at(initial.paths[3].nodes[0],initial.paths[3].nodes[1],.5));await page.locator('#fitting-panel[data-phase="ready"]').waitFor();await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();if(editing)await page.locator('#fitting-edit').click();};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,initial,errors,start,screen,click,save};
}

function inlineNotchFixture(){
 const curve=(id,points,closed=false)=>({id,name:id,color:'#176bce',role:'outline',note:'',closed,nodes:points.map(p=>G.node(...p))});
 const source=curve('source',[[100,180],[200,180],[210,195],[220,180],[400,180],[400,320],[100,320]],true),target=curve('target',[[550,150],[900,260]]);target.nodes[0].out={x:680,y:130};target.nodes[1].in={x:800,y:220};
 return {paths:[source,target],layers:[{id:'piece',name:'裁片',visible:true,locked:false,pathIds:['source'],imageIds:[],textIds:[]},{id:'fixed',name:'对边',visible:true,locked:false,pathIds:['target'],imageIds:[],textIds:[]}]};
}
async function marquee(page,screen,a,b){const p=await screen(a),q=await screen(b);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:5});await page.mouse.up();}
async function defineInlineNotch(page,click,screen){await click({x:150,y:180});await marquee(page,screen,{x:185,y:158},{x:235,y:211});assert.match(await page.locator('#selection-count').textContent(),/3 个节点/);await page.locator('#notch-define').click();}

function liveEditingFixture(){
 const c=(id,points,closed=false)=>({id,name:id,color:'#176bce',role:'outline',note:'',closed,nodes:points.map(p=>G.node(...p))});
 const source=c('live-source',[[100,180],[200,180],[300,180],[400,180]]),target=c('live-target',[[550,140],[1050,330]]),other=c('other',[[100,420],[300,420],[300,520],[100,520]],true);source.nodes[1].color='#c43283';target.nodes[0].out={x:720,y:70};target.nodes[1].in={x:900,y:300};
 return {paths:[source,target,other],layers:[{id:'piece',name:'原曲线',visible:true,locked:false,pathIds:[source.id],imageIds:[],textIds:[]},{id:'fixed',name:'对边及其他曲线',visible:true,locked:false,pathIds:[target.id,other.id],imageIds:[],textIds:[]}]};
}
async function startLiveSelection(page,click){await click({x:150,y:180});await page.locator('#handles .anchor[data-path="live-source"][data-node="2"]').click({modifiers:['Shift']});await page.keyboard.press('n');assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');await click(G.at(liveEditingFixture().paths[1].nodes[0],liveEditingFixture().paths[1].nodes[1],.5));assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');}
test('N uses the preselected curve, works like fitting and stays inactive in text fields',async t=>{
 const {page,click,save,initial}=await setup(t,{doc:liveEditingFixture()});await page.locator('#panel-properties > summary').click();await page.locator('#path-name').fill('curve n');await page.locator('#path-name').press('n');assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'idle');await page.locator('#path-name').press('Tab');await page.locator('#canvas').focus();
 await page.keyboard.press('n');assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');assert.equal(await page.locator('[data-fit-original="live-source"]').count(),1);await click(G.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.5));assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.match(await page.locator('#fitting-lengths').textContent(),/300\.00 mm/);await page.keyboard.press('n');assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'idle');assert.deepEqual((await save()).paths.map(p=>p.nodes),initial.paths.map(p=>p.nodes));
});
test('native original node and handle edits update fitting live, keep tools usable and undo without closing the preview',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);const preview=page.locator('#fitting-preview [data-fit-path="live-source"]'),before=await preview.getAttribute('d');
 await page.locator('[data-tool="node"]').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');if(await page.locator('#panel-layers').getAttribute('open')===null)await page.locator('#panel-layers > summary').click();await page.locator('.layer-row[data-layer="piece"] .layer-select').click();await page.locator('[data-tool="node"]').click();const h=await page.locator('#handles .anchor[data-path="live-source"][data-node="1"]').boundingBox(),to=await screen({x:200,y:145});await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});assert.notEqual(await preview.getAttribute('d'),before);await page.mouse.up();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');const moved=await save();assert.ok(G.dist(moved.paths[0].nodes[1],{x:200,y:145})<.02);assert.deepEqual(moved.paths[0].nodes[0],initial.paths[0].nodes[0]);assert.deepEqual(moved.paths.slice(1),initial.paths.slice(1));
 await page.locator('#undo').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.deepEqual((await save()).paths,initial.paths);assert.equal(await preview.getAttribute('d'),before);await page.locator('#redo').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');
 await page.locator('#handles .anchor[data-path="live-source"][data-node="1"]').click({button:'right'});await page.getByRole('menuitem',{name:'转为平滑节点',exact:true}).click();const curve=await save();assert.equal(curve.paths[0].nodes[1].mode,'smooth');const control=await page.locator('#handles .control[data-path="live-source"][data-node="1"][data-side="out"]').boundingBox();const old=await preview.getAttribute('d');await page.mouse.move(control.x+control.width/2,control.y+control.height/2);await page.mouse.down();await page.mouse.move(control.x+control.width/2+15,control.y+control.height/2-15,{steps:5});await page.mouse.up();assert.notEqual(await preview.getAttribute('d'),old);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');await page.locator('#fitting-unbend').click();const after=await save();assert.deepEqual(after.paths.slice(1),initial.paths.slice(1));assert.deepEqual(errors,[]);
});
test('B can draw marks on the fitted reference and other original curves stay editable while fitting remains visible',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);const preview=page.locator('[data-fit-path="live-source"]'),d=await preview.getAttribute('d');await page.keyboard.press('b');assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');const W=require('../../tools/curve-editor/walk.js'),root=W.at(W.track(initial.paths[1]),100).point;await click(root);await click({x:root.x,y:root.y+24});await page.keyboard.press('Enter');const marked=await save();assert.equal(marked.paths.length,4);assert.ok(G.dist(marked.paths[3].nodes[0],root)<.02);assert.equal(await preview.getAttribute('d'),d);
 await page.keyboard.press('F10');await click({x:180,y:420});await page.locator('#deselect').click();await click({x:180,y:420});const n=await page.locator('#handles .anchor[data-path="other"][data-node="2"]').boundingBox(),to=await screen({x:320,y:540});await page.mouse.move(n.x+n.width/2,n.y+n.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();const edited=await save();assert.ok(G.dist(edited.paths[2].nodes[2],{x:320,y:540})<.03);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.equal(await preview.getAttribute('d'),d);await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,edited.paths);assert.deepEqual(errors,[]);
});

test('text dialogs, context menus and typing keep native keyboard handling during live fitting',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);await page.keyboard.press('F8');await click({x:350,y:450});await page.locator('#text-dialog').waitFor({state:'visible'});await page.keyboard.press('n');assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');await page.keyboard.press('Escape');assert.equal(await page.locator('#text-dialog').isVisible(),false);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');await page.keyboard.press('F10');await page.locator('#handles .anchor[data-path="live-source"][data-node="1"]').click({button:'right'});await page.getByRole('menuitem',{name:'转为平滑节点',exact:true}).waitFor({state:'visible'});await page.keyboard.press('Escape');assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('native insertion and deletion preserve the selected arc through undo, redo and continuing the range',async t=>{
 const {page,click,screen,save,initial,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);const p=await screen({x:250,y:180});await page.mouse.dblclick(p.x,p.y);let saved=await save();assert.equal(saved.paths[0].nodes.length,5);assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');
 await page.locator('#undo').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.deepEqual((await save()).paths,initial.paths);await page.locator('#redo').click();assert.equal((await save()).paths[0].nodes.length,5);await page.locator('#canvas').focus();await page.keyboard.press('Delete');assert.equal((await save()).paths[0].nodes.length,4);assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);await page.locator('#fitting-continue').click();assert.match(await page.locator('#fitting-lengths').textContent(),/300\.00 mm/);await page.locator('#fitting-back').click();assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);assert.deepEqual(errors,[]);
});
test('editing the target updates the preview and undo recovers a temporarily collapsed original range',async t=>{
 const {page,click,screen,save,initial,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);const preview=page.locator('[data-fit-path="live-source"]');await click(initial.paths[1].nodes[1]);const before=await preview.getAttribute('d');await page.keyboard.press('ArrowDown');assert.notEqual(await preview.getAttribute('d'),before);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');await page.locator('#undo').click();assert.equal(await preview.getAttribute('d'),before);
 if(await page.locator('#panel-layers').getAttribute('open')===null)await page.locator('#panel-layers > summary').click();await page.locator('.layer-row[data-layer="piece"] .layer-select').click();await page.locator('[data-tool="node"]').click();await page.locator('#handles .anchor[data-path="live-source"][data-node="1"]').click();if(await page.locator('#panel-curves').getAttribute('open')===null)await page.locator('#panel-curves > summary').click();await page.locator('#node-x').fill('100');await page.locator('#node-x').press('Enter');await page.locator('#node-x').press('Tab');await page.locator('#handles .anchor[data-path="live-source"][data-node="2"]').click();await page.locator('#node-x').fill('100');await page.locator('#node-x').press('Enter');await page.locator('#node-x').press('Tab');assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'error');assert.equal(await page.locator('#fitting-preview [data-fit-path]').count(),0);await page.locator('#undo').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');await page.locator('#undo').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('range history keeps its physical endpoint after fitted insertion followed by an original edit',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);await page.locator('#fitting-continue').click();await page.locator('#fitting-edit').click();const W=require('../../tools/curve-editor/walk.js'),point=await screen(W.at(W.track(initial.paths[1]),50).point);await page.mouse.dblclick(point.x,point.y);assert.equal((await save()).paths[0].nodes.length,5);await page.locator('[data-tool="node"]').click();await page.locator('#handles .anchor[data-path="live-source"][data-node="4"]').click();await page.keyboard.press('ArrowDown');assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');await page.locator('#fitting-back').click();assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');assert.deepEqual(errors,[]);
});
test('real 1hao copy can edit original geometry live, undo, draw elsewhere and unfold with all changes intact',fixtureOptions('fitting-1hao-inline-notch.json'),async t=>{
 const fixture=require('./fixtures/fitting-1hao-inline-notch.json'),{page,initial,click,screen,save,errors}=await setup(t,{doc:fixture}),source=initial.paths[0],target=initial.paths[1],output=process.env.CURVE_EDITOR_LIVE_DEMO;
 if(output)await mkdir(output,{recursive:true});await click(G.at(source.nodes[19],source.nodes[20],.5));await marquee(page,screen,{x:845,y:180},{x:710,y:465});await page.keyboard.press('n');await click(G.at(target.nodes[3],target.nodes[4],.4));assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');await page.locator('#fitting-guide-minimize').click();const preview=page.locator(`[data-fit-path="${source.id}"]`),before=await preview.getAttribute('d');if(output)await page.screenshot({path:path.join(output,'01-fitted.png')});
 if(await page.locator('#panel-layers').getAttribute('open')===null)await page.locator('#panel-layers > summary').click();await page.locator('.layer-row[data-layer="piece"] .layer-select').click();await page.locator('[data-tool="node"]').click();await page.locator('#fitting-source-none').click();const h=await page.locator(`#handles .anchor[data-path="${source.id}"][data-node="23"]`).boundingBox(),expected={x:source.nodes[23].x-4,y:source.nodes[23].y+2},to=await screen(expected);await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});assert.notEqual(await preview.getAttribute('d'),before);await page.mouse.up();const edited=await save();assert.ok(G.dist(edited.paths[0].nodes[23],expected)<.02);for(let i=0;i<source.nodes.length;i++)if(i!==23)assert.deepEqual(edited.paths[0].nodes[i],source.nodes[i]);assert.deepEqual(edited.paths[1],target);if(output)await page.screenshot({path:path.join(output,'02-original-edited.png')});
 await page.locator('#undo').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.deepEqual((await save()).paths,initial.paths);await page.locator('#redo').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');await page.keyboard.press('b');await click({x:250,y:600});await click({x:265,y:625});await page.keyboard.press('Enter');const marked=await save();assert.equal(marked.paths.length,3);if(output)await page.screenshot({path:path.join(output,'03-other-mark.png')});await page.locator('#fitting-unbend').click();const unfolded=await save();assert.deepEqual(unfolded.paths,marked.paths);if(output){await page.screenshot({path:path.join(output,'04-unfolded.png')});await writeFile(path.join(output,'verification.json'),JSON.stringify({source:fixture.title,livePreviewChanged:true,nativeUndoAndRedoKeptPreview:true,changedNode:23,changedNodePositionError:G.dist(edited.paths[0].nodes[23],expected),otherOriginalNodesAndTargetUnchanged:true,markCreatedElsewhere:true,unfoldedMatchesEditedCanonicalData:true},null,2));}assert.deepEqual(errors,[]);
});

test('selected nodes accept colors in a batch, preserve geometry and restore colors through undo and local recovery',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:inlineNotchFixture()});await click({x:150,y:180});await marquee(page,screen,{x:185,y:158},{x:235,y:211});await page.locator('#panel-curves > summary').click();
 await page.locator('#node-color').evaluate(e=>{e.value='#c43283';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));});
 const colored=await save(),plain=structuredClone(colored.paths);for(const p of plain)for(const n of p.nodes)delete n.color;assert.deepEqual(plain,initial.paths);assert.ok(colored.paths[0].nodes.slice(1,4).every(n=>n.color==='#c43283'));
 await page.locator('#deselect').click();assert.equal(await page.locator('#node-colors [data-node-color-path="source"]').count(),3);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);await page.locator('#redo').click();assert.deepEqual((await save()).paths,colored.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('.layer-row[data-layer="piece"]').waitFor();assert.deepEqual((await save()).paths,colored.paths);
 await page.locator('[data-tool="node"]').click();await page.locator('#select-all').click();if(await page.locator('#panel-curves').getAttribute('open')===null)await page.locator('#panel-curves > summary').click();assert.equal(await page.locator('#node-color-clear').isEnabled(),true);await page.locator('#node-color-clear').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('preset colors apply to a single node and a mixed selection can be recolored in one undoable step',async t=>{
 const {page,initial,click,screen,save}=await setup(t,{doc:inlineNotchFixture()});await click({x:150,y:180});await click({x:400,y:180});assert.match(await page.locator('#selection-count').textContent(),/1 个节点/);await page.locator('#panel-curves > summary').click();await page.locator('[data-node-color="#176bce"]').click();let saved=await save();assert.equal(saved.paths[0].nodes[4].color,'#176bce');assert.ok(saved.paths[0].nodes.filter((_,i)=>i!==4).every(n=>!n.color));
 await click({x:100,y:180});await page.locator('[data-node-color="#128043"]').click();const mixed=await save();await marquee(page,screen,{x:85,y:155},{x:415,y:215});assert.match(await page.locator('#node-color-info').textContent(),/多种颜色/);await page.locator('[data-node-color="#8b3ec9"]').click();saved=await save();assert.ok(saved.paths[0].nodes.slice(0,5).every(n=>n.color==='#8b3ec9'));assert.equal(saved.paths[0].color,initial.paths[0].color);await page.locator('#undo').click();assert.deepEqual((await save()).paths,mixed.paths);
});

test('colored nodes stay visible at their original and fitted positions including rigid notch nodes and survive moving and unfolding',async t=>{
 const fixture=inlineNotchFixture();for(const [i,color]of [[0,'#c43283'],[1,'#d47500'],[2,'#8b3ec9'],[3,'#128043'],[4,'#176bce'],[6,'#543223']])fixture.paths[0].nodes[i].color=color;fixture.paths[1].nodes[0].color='#b72532';
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:fixture});await defineInlineNotch(page,click,screen);const tagged=await save();assert.equal(tagged.paths[0].nodes[2].color,'#8b3ec9');await marquee(page,screen,{x:85,y:155},{x:415,y:215});await page.locator('#fit-curves').click();await click({x:640,y:155});await page.locator('#fitting-panel[data-phase="ready"]').waitFor();
 const colored=page.locator('#fitting-preview [data-fit-node-color-path="source"]');assert.equal(await colored.count(),5);assert.equal(await page.locator('#fitting-preview [data-fit-node-color-index="6"]').count(),0);
 assert.equal(await page.locator('#fitting-originals [data-fit-node-color-path="source"]').count(),6);assert.equal(await page.locator('#fitting-originals [data-fit-node-color-path="target"]').getAttribute('fill'),'#b72532');
 const N=require('../../tools/curve-editor/notches.js'),W=require('../../tools/curve-editor/walk.js'),F=require('../../tools/curve-editor/fitting.js'),B=require('../../tools/curve-editor/bend.js'),g=N.groups(tagged.paths[0])[0],source=F.cut(G,N.baseline(G,tagged.paths[0]),{index:0,t:0},{index:3,t:1}),track=W.track(source),target=F.cut(G,initial.paths[1],{index:0,t:0},G.nearest(initial.paths[1],W.at(W.track(initial.paths[1]),300).point)),map=B.create(source,target),s=W.nearest(track,g.anchor).s,rigid=N.rigid(G,tagged.paths[0],g,{point:g.anchor,tangent:W.at(track,s).tangent},{point:map.forward(g.anchor),tangent:W.at(W.track(initial.paths[1]),s).tangent});
 const dot=page.locator('#fitting-preview [data-fit-node-color-path="source"][data-fit-node-color-index="2"]'),point=await dot.evaluate(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))}));assert.equal(await dot.getAttribute('fill'),'#8b3ec9');assert.ok(G.dist(point,rigid.nodes[2])<.02);
 await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();assert.equal(await colored.count(),6);await page.locator('#fitting-whole').uncheck();await page.locator('#fitting-edit').click();assert.equal(await dot.getAttribute('fill'),'#8b3ec9');await page.locator('#fitting-edit').click();
 const h=await page.locator('[data-fit-inline-root]').boundingBox(),destination=await screen(W.at(W.track(initial.paths[1]),s+20).point);await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:8});await page.mouse.up();assert.equal(await dot.getAttribute('fill'),'#8b3ec9');
 if(process.env.CURVE_EDITOR_NODE_COLORS_SCREENSHOT){await page.locator('#fitting-guide-minimize').click();await page.screenshot({path:process.env.CURVE_EDITOR_NODE_COLORS_SCREENSHOT});}
 await page.locator('#fitting-unbend').click();const after=await save();for(let i=0;i<after.paths[0].nodes.length;i++)assert.equal(after.paths[0].nodes[i].color,tagged.paths[0].nodes[i].color);assert.deepEqual(after.paths[1],tagged.paths[1]);assert.deepEqual(errors,[]);
});
test('marquee-defined inline notches keep coordinates, undo cleanly and persist through save and reload',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:inlineNotchFixture()});await defineInlineNotch(page,click,screen);
 const tagged=await save(),group=tagged.paths[0].nodes.slice(1,4);assert.ok(group[0].notchId);assert.ok(group.every(n=>n.notchId===group[0].notchId));
 const clean=structuredClone(tagged.paths);for(const p of clean)for(const n of p.nodes)delete n.notchId;assert.deepEqual(clean,initial.paths);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);await page.locator('#redo').click();assert.deepEqual((await save()).paths,tagged.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('.layer-row[data-layer="piece"]').waitFor();assert.deepEqual((await save()).paths,tagged.paths);
 await page.locator('#notch-clear').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('an inline V notch stays rigid while fitted and a whole-notch drag unfolds at the same seam station',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:inlineNotchFixture()});await defineInlineNotch(page,click,screen);const tagged=await save();
 await marquee(page,screen,{x:85,y:155},{x:415,y:215});await page.locator('#fit-curves').click();await click(G.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.5));await page.locator('#fitting-panel[data-phase="ready"]').waitFor();
 const N=require('../../tools/curve-editor/notches.js'),W=require('../../tools/curve-editor/walk.js'),F=require('../../tools/curve-editor/fitting.js'),feature=N.groups(tagged.paths[0])[0],track=W.track(F.cut(G,N.baseline(G,tagged.paths[0]),{index:0,t:0},{index:3,t:1}));
 const notch=page.locator('[data-fit-inline-notch]');assert.equal(await notch.count(),1);const shape={nodes:feature.indices.map(i=>tagged.paths[0].nodes[i]),closed:false},length=G.pathLength(shape),displayLength=await notch.evaluate(e=>e.getTotalLength());assert.ok(Math.abs(displayLength-length)<.02,[displayLength,length]);
 assert.match(await page.locator('#fitting-lengths').textContent(),/300\.00 mm/);
 const station=W.nearest(track,feature.anchor).s,to=station+30,destination=await screen(W.at(W.track(initial.paths[1]),to).point),handle=await page.locator('[data-fit-inline-root]').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:12});await page.mouse.up();
 assert.ok(Math.abs(await notch.evaluate(e=>e.getTotalLength())-length)<.02);
 await page.locator('#fitting-unbend').click();const result=await save(),expected=N.rigid(G,tagged.paths[0],feature,W.at(track,station),W.at(track,to));
 for(let i=0;i<result.paths[0].nodes.length;i++){if(feature.indices.includes(i)){for(const key of [null,'in','out'])assert.ok(G.dist(key?result.paths[0].nodes[i][key]:result.paths[0].nodes[i],key?expected.nodes[i][key]:expected.nodes[i])<.03);}else assert.deepEqual(result.paths[0].nodes[i],tagged.paths[0].nodes[i]);}
 assert.deepEqual(result.paths[1],tagged.paths[1]);assert.ok(Math.abs(G.pathLength({nodes:feature.indices.map(i=>result.paths[0].nodes[i]),closed:false})-length)<.00001);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,tagged.paths);assert.deepEqual(errors,[]);
});

test('whole-piece notches beyond the selected seam use the continued route direction and never jump into range on drag',async t=>{
 const fixture=inlineNotchFixture();fixture.paths[1].nodes=[[550,150],[550,250],[800,250]].map(p=>G.node(...p));
 const {page,click,screen,save}=await setup(t,{doc:fixture});await defineInlineNotch(page,click,screen);const tagged=await save();await page.locator('#deselect').click();await page.locator('#fit-curves').click();await click({x:150,y:180});await click({x:550,y:190});await page.locator('#fitting-panel[data-phase="ready"]').waitFor();await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();
 const notch=page.locator('[data-fit-inline-notch]'),delta=await notch.evaluate(e=>{const a=e.getPointAtLength(0),b=e.getPointAtLength(e.getTotalLength());return {x:b.x-a.x,y:b.y-a.y};});assert.ok(Math.abs(delta.x-20)<.01&&Math.abs(delta.y)<.01,JSON.stringify(delta));
 const handle=await page.locator('[data-fit-inline-root]').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+25,handle.y+10,{steps:5});await page.mouse.up();await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,tagged.paths);
});

test('continuing through a notch includes the complete group and range undo keeps the definition intact',async t=>{
 const {page,click,screen,save}=await setup(t,{doc:inlineNotchFixture()});await defineInlineNotch(page,click,screen);const tagged=await save();
 await page.locator('#deselect').click();await page.locator('#fit-curves').click();await click({x:150,y:180});await click({x:640,y:155});await page.locator('#fitting-panel[data-phase="ready"]').waitFor();assert.equal(await page.locator('[data-fit-inline-notch]').count(),0);
 await page.locator('#fitting-continue').click();assert.equal(await page.locator('[data-fit-inline-notch]').count(),1);assert.match(await page.locator('#fitting-lengths').textContent(),/120\.00 mm/);
 await page.locator('#fitting-back').click();assert.equal(await page.locator('[data-fit-inline-notch]').count(),0);await page.locator('#redo').click();assert.equal(await page.locator('[data-fit-inline-notch]').count(),1);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,tagged.paths);
});

test('cancelling an inline notch drag restores the whole group and editing mode protects its individual points',async t=>{
 const {page,click,screen,save}=await setup(t,{doc:inlineNotchFixture()});await defineInlineNotch(page,click,screen);const tagged=await save();await marquee(page,screen,{x:85,y:155},{x:415,y:215});await page.locator('#fit-curves').click();await click({x:640,y:155});await page.locator('#fitting-panel[data-phase="ready"]').waitFor();
 await page.locator('#fitting-edit').click();assert.equal(await page.locator('[data-fit-owner="source"][data-fit-node="2"]').count(),0);
 const h=await page.locator('[data-fit-inline-root]').boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+25,h.y+h.height/2+5,{steps:6});await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'idle');assert.deepEqual((await save()).paths,tagged.paths);
});

test('real 1hao copy preserves an inline notch while fitting and unfolds a 5 mm whole-notch move accurately',fixtureOptions('fitting-1hao-inline-notch.json'),async t=>{
 const fixture=require('./fixtures/fitting-1hao-inline-notch.json'),{page,initial,click,screen,save,errors}=await setup(t,{doc:fixture});
 const [source,target]=initial.paths,N=require('../../tools/curve-editor/notches.js'),W=require('../../tools/curve-editor/walk.js'),F=require('../../tools/curve-editor/fitting.js'),output=process.env.CURVE_EDITOR_NOTCH_DEMO;
 if(output)await mkdir(output,{recursive:true});const shot=async name=>{if(output)await page.screenshot({path:path.join(output,name)});};
 await click(G.at(source.nodes[19],source.nodes[20],.5));await marquee(page,screen,{x:795,y:267},{x:748,y:313});assert.match(await page.locator('#selection-count').textContent(),/3 个节点/);await page.locator('#notch-define').click();const tagged=await save();await shot('01-defined.png');
 await marquee(page,screen,{x:845,y:180},{x:710,y:465});assert.match(await page.locator('#selection-count').textContent(),/6 个节点/);
 await page.locator('#fit-curves').click();await click(G.at(target.nodes[3],target.nodes[4],.4));assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready',await page.locator('#fitting-feedback').textContent());await page.locator('#fitting-guide-minimize').click();await shot('02-fitted.png');
 const feature=N.groups(tagged.paths[0])[0],track=W.track(F.cut(G,N.baseline(G,tagged.paths[0]),{index:19,t:0},{index:23,t:1})),targetTrack=W.track(F.route(G,W,N.baseline(G,target),[{index:3,t:0},{index:3,t:1}]).path),scale=G.millimetersPerPixel(initial.calibration),from=W.nearest(track,feature.anchor).s,to=from+5/scale,originalShape={closed:false,nodes:feature.indices.map(i=>source.nodes[i])},originalLength=G.pathLength(originalShape),notch=page.locator('[data-fit-inline-notch]');
 assert.ok(Math.abs(await notch.evaluate(e=>e.getTotalLength())-originalLength)*scale<.005);
 const h=await page.locator('[data-fit-inline-root]').boundingBox(),destination=await screen(W.at(targetTrack,to).point);await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:15});await page.mouse.up();await shot('03-moved.png');
 if(output){const root=await page.locator('[data-fit-inline-root]').boundingBox(),zoom=await page.locator('#viewport').evaluate(e=>e.getScreenCTM().a);await page.mouse.move(root.x+root.width/2,root.y+root.height/2);await page.mouse.wheel(0,-1200);await page.waitForFunction(z=>document.getElementById('viewport').getScreenCTM().a>z*2,zoom);await shot('03-notch-detail.png');await page.mouse.wheel(0,1200);await page.waitForFunction(z=>document.getElementById('viewport').getScreenCTM().a<z*1.01,zoom);}
 assert.ok(Math.abs(await notch.evaluate(e=>e.getTotalLength())-originalLength)*scale<.005);
 await page.locator('#fitting-unbend').click();const unfolded=await save();await shot('04-unfolded.png');const expected=N.rigid(G,tagged.paths[0],feature,W.at(track,from),W.at(track,to)),actual=N.groups(unfolded.paths[0])[0],positionErrorMm=G.dist(actual.anchor,W.at(track,to).point)*scale;
 let maximumErrorMm=0;for(let i=0;i<source.nodes.length;i++){if(feature.indices.includes(i)){for(const k of [null,'in','out'])maximumErrorMm=Math.max(maximumErrorMm,G.dist(k?unfolded.paths[0].nodes[i][k]:unfolded.paths[0].nodes[i],k?expected.nodes[i][k]:expected.nodes[i])*scale);}else assert.deepEqual(unfolded.paths[0].nodes[i],tagged.paths[0].nodes[i]);}
 assert.ok(maximumErrorMm<.002,String(maximumErrorMm));assert.ok(positionErrorMm<.002,String(positionErrorMm));assert.deepEqual(unfolded.paths[1],tagged.paths[1]);
 const verification={notchShiftMm:(W.nearest(track,actual.anchor).s-from)*scale,positionErrorMm,maximumNodeAndHandleErrorMm:maximumErrorMm,notchLengthBeforeMm:originalLength*scale,notchLengthAfterMm:G.pathLength({closed:false,nodes:feature.indices.map(i=>unfolded.paths[0].nodes[i])})*scale,untouchedNodesAndTargetUnchanged:true};
 if(output){await writeFile(path.join(output,'verification.json'),JSON.stringify(verification,null,2));await writeFile(path.join(output,'defined.json'),JSON.stringify(tagged,null,2));await writeFile(path.join(output,'unfolded.json'),JSON.stringify(unfolded,null,2));}
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,tagged.paths);assert.deepEqual(errors,[]);
});
test('reversible fitting bends the whole contour and notch without changing original artwork',async t=>{
 const {page,initial,errors,start,save}=await setup(t);await start();
 if(process.env.CURVE_EDITOR_FITTING_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_FITTING_SCREENSHOT});
 const preview=page.locator('#fitting-preview [data-fit-path="notch"]');assert.equal(await preview.count(),1);
 const d=await preview.getAttribute('d');assert.notEqual(d,G.pathD(initial.paths[2]));
 assert.match(await page.locator('#fitting-lengths').textContent(),/300\.00 mm/);
 assert.equal(await page.locator('#fitting-3d').count(),0);
 const handle=await page.locator('#fitting-preview [data-fit-offset]').boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+25,handle.y+handle.height/2+5,{steps:6});await page.mouse.up();await page.locator('#fitting-panel[data-position-state="idle"]').waitFor();assert.notEqual(await preview.getAttribute('d'),d);
 await page.locator('#fitting-unbend').click();assert.equal(await page.locator('#fitting-preview').locator('[data-fit-path]').count(),0);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});
test('bent notch edits survive unbending, preserve all untouched nodes and support undo',async t=>{
 const {page,initial,errors,start,save}=await setup(t);await start();
 await page.locator('#fitting-preview [data-fit-path="notch"]').click();
 const n=page.locator('#fitting-preview [data-fit-node="1"][data-fit-owner="notch"]'),b=await n.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+14,b.y+b.height/2+5,{steps:6});await page.mouse.up();
 await page.locator('#fitting-unbend').click();let saved=await save();assert.deepEqual(saved.paths.slice(0,2),initial.paths.slice(0,2));assert.deepEqual(saved.paths[3],initial.paths[3]);assert.deepEqual(saved.paths[2].nodes[0],initial.paths[2].nodes[0]);assert.notDeepEqual(saved.paths[2].nodes[1],initial.paths[2].nodes[1]);
 await page.locator('#undo').click();saved=await save();assert.deepEqual(saved.paths,initial.paths);assert.deepEqual(errors,[]);
});
test('a deliberate extension and inserted control point return to the original coordinate system',async t=>{
 const {page,initial,errors,start,screen,save}=await setup(t);await start();
 const projected=async p=>page.evaluate(({source,target,p})=>{const w=CurveWalk.track(target),end=CurveWalk.at(w,Math.min(w.length,CurveWalk.track(source).length)).point,t=CurveFitting.cut(CurveGeometry,target,{index:0,t:0},CurveGeometry.nearest(target,end));return CurveBend.create(source,t).forward(p);},{source:initial.paths[0],target:initial.paths[3],p});
 const endpoint=page.locator('#fitting-preview [data-fit-owner="moving-seam"][data-fit-node="1"]'),b=await endpoint.boundingBox(),destination=await screen(await projected({x:430,y:180}));
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:8});await page.mouse.up();
 const middle=await screen(await projected({x:250,y:180}));await page.mouse.dblclick(middle.x,middle.y);
 assert.equal(await page.locator('#fitting-preview [data-fit-owner="moving-seam"][data-fit-node]').count()>=3,true,JSON.stringify({status:await page.locator('#status').textContent(),owners:await page.locator('#fitting-preview [data-fit-owner]').evaluateAll(ns=>ns.map(n=>[n.dataset.fitOwner,n.dataset.fitNode])),target:await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.dataset.fitPath,middle)}));
 await page.locator('#fitting-unbend').click();const saved=await save(),seam=saved.paths[0];assert.equal(seam.nodes.length,3);assert.ok(Math.abs(seam.nodes.at(-1).x-430)<.15);assert.ok(Math.abs(seam.nodes.at(-1).y-180)<.15);assert.ok(G.pathLength(seam)>329.8);assert.deepEqual(saved.paths.slice(1),initial.paths.slice(1));
 // The canonical edit is also the recoverable local draft, even after leaving preview.
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('.layer-row[data-layer="piece"]').waitFor();assert.deepEqual((await save()).paths,saved.paths);assert.deepEqual(errors,[]);
});
test('Escape during a fitted drag cancels that gesture, restores original data and releases preview',async t=>{
 const {page,initial,errors,start,save}=await setup(t);await start();await page.locator('#fitting-preview [data-fit-path="notch"]').click();
 const n=page.locator('#fitting-preview [data-fit-owner="notch"][data-fit-node="1"]'),b=await n.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+20,b.y+b.height/2+10,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'idle');assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

test('unsupported bending keeps every original line clear and reports the failed preview',async t=>{
 const {page,initial,start,save}=await setup(t);
 await page.evaluate(()=>{const create=CurveBend.create;CurveBend.create=(...args)=>{const map=create(...args);return {...map,forward(){throw Error('unsupported test geometry');},preview(){throw Error('unsupported test geometry');}};};});
 await start();
 const opacity=await page.locator('#paths .hit-line').evaluateAll(lines=>lines.map(e=>getComputedStyle(e.previousElementSibling).opacity));
 assert.ok(opacity.every(v=>v==='1'),JSON.stringify(opacity));
 assert.match(await page.locator('#fitting-summary').textContent(),/原线|原形/);
 assert.deepEqual((await save()).paths,initial.paths);
});
test('leaving fitting with an empty undo history restores line visibility and hit targets',async t=>{
 const {page,initial,start,save}=await setup(t);await start();await page.keyboard.press('Control+z');
 assert.equal(await page.locator('#fitting-preview [data-fit-path]').count(),0);
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'idle');
 assert.equal(await page.locator('#fitting-start').isVisible(),true);
 const lines=await page.locator('#paths .hit-line').evaluateAll(ns=>ns.map(e=>({opacity:getComputedStyle(e.previousElementSibling).opacity,pointer:getComputedStyle(e).pointerEvents})));
 assert.ok(lines.every(e=>e.opacity==='1'&&e.pointer!=='none'),JSON.stringify(lines));
 assert.deepEqual((await save()).paths,initial.paths);
});
test('guided fitting starts directly on the canvas with two edge clicks and the current quick controls',async t=>{
 const {page,click}=await setup(t,{sameLayer:true});await page.locator('#deselect').click();await page.locator('#fit-curves').click();
 assert.match(await page.locator('#fitting-summary').textContent(),/起点或终点.*节点/);
 assert.equal(await page.locator('#fitting-guide-actions').isVisible(),true);assert.equal(await page.locator('.fitting-guide-steps,.fitting-guide-current,.fitting-example').count(),0);
 await click({x:250,y:180});assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');
 await click({x:690,y:175});await page.locator('#fitting-panel[data-phase="ready"]').waitFor();
 assert.equal(await page.locator('#fitting-preview [data-fit-path="notch"]').count(),1);
 assert.equal(await page.locator('#fitting-preview [data-fit-node]').count(),0);
});

test('default notch dragging carries the complete mark back without changing its length or other curves',async t=>{
 const {page,initial,start,screen,save}=await setup(t);await start({editing:false,select:false});
 const from=await page.locator('[data-fit-mark-root="notch"]').boundingBox();
 const target=await page.evaluate(({source,target})=>{const w=CurveWalk.track(target),end=CurveWalk.at(w,Math.min(w.length,CurveWalk.track(source).length)).point,part=CurveFitting.cut(CurveGeometry,target,{index:0,t:0},CurveGeometry.nearest(target,end));return CurveBend.create(source,part).forward({x:250,y:180});},{source:initial.paths[0],target:initial.paths[3]});
 const to=await screen(target);await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
 await page.locator('#fitting-unbend').click();const after=await save();
 assert.ok(Math.abs(after.paths[2].nodes[0].x-250)<.03);assert.ok(Math.abs(after.paths[2].nodes[0].y-180)<.0001);
 assert.ok(Math.abs(G.pathLength(after.paths[2])-G.pathLength(initial.paths[2]))<1e-8);
 assert.deepEqual(after.paths.filter(p=>p.id!=='notch'),initial.paths.filter(p=>p.id!=='notch'));
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
});
test('zoom, pan, blank clicks and range adjustment keep lines visible and never modify the original document',async t=>{
 const {page,initial,start,screen,save,click}=await setup(t);await start({editing:false});
 const before=await page.locator('[data-fit-path="outline"]').getAttribute('d');
 for(let i=0;i<4;i++){await page.locator('#zoom-in').click();await page.locator('#zoom-out').click();}
 const viewport=page.locator('#viewport'),camera=await viewport.getAttribute('transform'),canvas=await page.locator('#canvas').boundingBox();
 await page.keyboard.down('Control');await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width/2+60,canvas.y+canvas.height/2+30,{steps:6});
 assert.notEqual(await viewport.getAttribute('transform'),camera);assert.equal(await page.locator('[data-fit-path="outline"]').getAttribute('d'),before);
 await page.mouse.up();await page.keyboard.up('Control');
 await click({x:470,y:370});assert.equal(await page.locator('[data-fit-path="outline"]').getAttribute('d'),before);
 await page.locator('#fitting-adjust').click();
 const h=await page.locator('[data-fit-range="source"][data-fit-end="1"]').boundingBox(),to=await screen({x:350,y:180});
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();
 assert.equal(await page.locator('#paths .svg-curve').evaluateAll(ns=>ns.every(e=>getComputedStyle(e).opacity==='1')),true);
 await page.locator('#fitting-adjust').click();assert.match(await page.locator('#fitting-lengths').textContent(),/250\.00 mm/);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);
});
test('the real 1hao contours work in one layer with two clicks and a whole-notch 5 mm edit',fixtureOptions('fitting-1hao.json'),async t=>{
 const fixture=require('./fixtures/fitting-1hao.json'),W=require('../../tools/curve-editor/walk.js'),F=require('../../tools/curve-editor/fitting.js'),B=require('../../tools/curve-editor/bend.js');
 const {page,initial,screen,click,save,errors}=await setup(t,{doc:fixture});const [body,belly,notch]=initial.paths;
 await page.locator('#deselect').click();await page.locator('#fit-curves').click();
 if(process.env.CURVE_EDITOR_GUIDE_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_GUIDE_SCREENSHOT});
 await click(G.at(body.nodes[0],body.nodes[1],.5));await click(G.at(belly.nodes[9],belly.nodes[10],.5));
 await page.locator('#fitting-panel[data-phase="ready"]').waitFor();assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');
 const source=F.cut(G,body,{index:0,t:0},{index:0,t:1}),track=W.track(source),targetEnd={index:10,t:.5297912581645661},target=F.cut(G,belly,{index:9,t:0},targetEnd),map=B.create(source,target);
 const scale=initial.calibration.length/Math.hypot(initial.calibration.b.x-initial.calibration.a.x,initial.calibration.b.y-initial.calibration.a.y),station=W.nearest(track,notch.nodes[0]).s;
 const expected=F.moveMark(G,W,notch,track,station,station+5/scale),to=await screen(map.forward(expected[0]));
 const h=await page.locator(`[data-fit-mark-root="${notch.id}"]`).boundingBox();assert.ok(h);
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:10});await page.mouse.up();
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');
 if(process.env.CURVE_EDITOR_GUIDE_BENT_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_GUIDE_BENT_SCREENSHOT});
 await page.locator('#fitting-unbend').click();const after=await save();assert.deepEqual(after.paths.slice(0,2),initial.paths.slice(0,2));
 for(let i=0;i<2;i++)assert.ok(G.dist(after.paths[2].nodes[i],expected[i])*scale<.002);
 assert.ok(Math.abs(G.pathLength(after.paths[2])-G.pathLength(notch))*scale<.00001);
 assert.ok(Math.abs((W.nearest(track,after.paths[2].nodes[0]).s-station)*scale-5)<.002);
 assert.deepEqual(errors,[]);
});

test('whole notch dragging follows a returning target seam instead of jumping onto its endpoint extension',async t=>{
 const curve=(id,points)=>({id,name:id,color:'#176bce',role:'outline',dashed:false,note:'',closed:false,nodes:points.map(p=>G.node(...p))});
 const seam=curve('moving-seam',[[100,180],[500,180]]),notch=curve('notch',[[220,180],[220,193]]),target=curve('target',[[600,150],[700,150],[700,250],[500,250]]);
 const {page,start,screen,save}=await setup(t,{doc:{paths:[seam,notch,curve('spare',[[80,280],[100,280]]),target],layers:[{id:'piece',name:'test',visible:true,locked:false,pathIds:['moving-seam','notch','spare','target'],imageIds:[],textIds:[]}]}});
 await start({editing:false,select:false});const h=await page.locator('[data-fit-mark-root="notch"]').boundingBox(),to=await screen({x:550,y:250});
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});await page.mouse.up();
 await page.locator('#fitting-unbend').click();const after=await save();assert.ok(Math.abs(after.paths[1].nodes[0].x-450)<.05,JSON.stringify(after.paths[1].nodes));
 assert.ok(Math.abs(G.pathLength(after.paths[1])-13)<1e-8);
});

test('continue fitting adds a real adjacent span, preserves the fitted prefix and brings the notch edit back on unfolding',fixtureOptions('fitting-1hao.json'),async t=>{
 const fixture=require('./fixtures/fitting-1hao.json'),W=require('../../tools/curve-editor/walk.js'),F=require('../../tools/curve-editor/fitting.js'),B=require('../../tools/curve-editor/bend.js');
 const {page,initial,screen,click,save,errors}=await setup(t,{doc:fixture});const [body,belly,notch]=initial.paths;
 await page.locator('#deselect').click();await page.locator('#fit-curves').click();await click(G.at(body.nodes[0],body.nodes[1],.5));await click(G.at(belly.nodes[9],belly.nodes[10],.5));await page.locator('#fitting-panel[data-phase="ready"]').waitFor();
 if(process.env.CURVE_EDITOR_MULTISPAN_STEPS)await page.screenshot({path:path.join(process.env.CURVE_EDITOR_MULTISPAN_STEPS,'01-first-edge-pair.png')});
 const root=page.locator(`[data-fit-mark-root="${notch.id}"]`),before={x:Number(await root.getAttribute('cx')),y:Number(await root.getAttribute('cy'))};
 await page.locator('#fitting-continue').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');assert.match(await page.locator('#fitting-span-count').textContent(),/2 段/);
 if(process.env.CURVE_EDITOR_MULTISPAN_STEPS)await page.screenshot({path:path.join(process.env.CURVE_EDITOR_MULTISPAN_STEPS,'02-continue-two-spans.png')});
 const after={x:Number(await root.getAttribute('cx')),y:Number(await root.getAttribute('cy'))};assert.ok(G.dist(before,after)<.003,JSON.stringify({before,after}));
 const r=F.extend(G,W,body,[{index:0,t:0},{index:0,t:1}],belly,[{index:9,t:0},{index:10,t:.5297912581645661}]);
 const track=W.track(F.cut(G,body,...r.sourcePoints)),map=B.create(track.path,F.cut(G,belly,...r.targetPoints)),station=W.nearest(track,notch.nodes[0]).s,scale=initial.calibration.length/G.dist(initial.calibration.a,initial.calibration.b),expected=F.moveMark(G,W,notch,track,station,station+5/scale),to=await screen(map.forward(expected[0]));
 const h=await root.boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
 if(process.env.CURVE_EDITOR_MULTISPAN_STEPS)await page.screenshot({path:path.join(process.env.CURVE_EDITOR_MULTISPAN_STEPS,'03-notch-moved.png')});
 if(process.env.CURVE_EDITOR_MULTISPAN_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_MULTISPAN_SCREENSHOT});
 await page.locator('#fitting-unbend').click();const saved=await save();if(process.env.CURVE_EDITOR_MULTISPAN_STEPS){await page.screenshot({path:path.join(process.env.CURVE_EDITOR_MULTISPAN_STEPS,'04-unfolded.png')});await writeFile(path.join(process.env.CURVE_EDITOR_MULTISPAN_STEPS,'verification.json'),JSON.stringify({sourceSpans:2,sourceMm:track.length*scale,targetMm:W.track(F.cut(G,belly,...r.targetPoints)).length*scale,notchShiftMm:(W.nearest(track,saved.paths[2].nodes[0]).s-station)*scale,notchBeforeMm:G.pathLength(notch)*scale,notchAfterMm:G.pathLength(saved.paths[2])*scale,untouchedContoursEqual:JSON.stringify(saved.paths.slice(0,2))===JSON.stringify(initial.paths.slice(0,2)),fittedPrefixRootErrorMm:G.dist(before,after)*scale},null,2));}assert.deepEqual(saved.paths.slice(0,2),initial.paths.slice(0,2));for(let i=0;i<2;i++)assert.ok(G.dist(saved.paths[2].nodes[i],expected[i])*scale<.002);assert.ok(Math.abs(G.pathLength(saved.paths[2])-G.pathLength(notch))<.00001);assert.deepEqual(errors,[]);
});
test('a failed continuation keeps the previous fitted result, offsets and document intact',fixtureOptions('fitting-1hao.json'),async t=>{
 const fixture=require('./fixtures/fitting-1hao.json'),{page,initial,click,save}=await setup(t,{doc:fixture});const [body,belly]=initial.paths;
 await page.locator('#deselect').click();await page.locator('#fit-curves').click();await click(G.at(body.nodes[0],body.nodes[1],.5));await click(G.at(belly.nodes[9],belly.nodes[10],.5));await page.locator('#fitting-panel[data-phase="ready"]').waitFor();
 const preview=page.locator(`[data-fit-path="${body.id}"]`),before=await preview.getAttribute('d'),bounds=await page.locator('#fitting-offset').evaluate(e=>[e.min,e.max,e.value]);
 await page.evaluate(()=>{const create=CurveBend.create;CurveBend.create=(...a)=>({...create(...a),forward(){throw Error('unsupported continuation');},preview(){throw Error('unsupported continuation');}});});
 await page.locator('#fitting-continue').click();assert.equal(await preview.getAttribute('d'),before);assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');assert.match(await page.locator('#fitting-feedback').textContent(),/保留.*对合/);assert.deepEqual(await page.locator('#fitting-offset').evaluate(e=>[e.min,e.max,e.value]),bounds);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);
});

test('a whole long seam follows five consecutive spans and preserves every untouched contour after notch editing',fixtureOptions('fitting-1hao.json'),async t=>{
 const fixture=require('./fixtures/fitting-1hao.json'),W=require('../../tools/curve-editor/walk.js'),F=require('../../tools/curve-editor/fitting.js'),B=require('../../tools/curve-editor/bend.js');
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:fixture});const [body,belly,notch]=initial.paths;
 await page.locator('#deselect').click();await page.locator('#fit-curves').click();await click(G.at(body.nodes[0],body.nodes[1],.5));await click(G.at(belly.nodes[9],belly.nodes[10],.5));await page.locator('#fitting-panel[data-phase="ready"]').waitFor();
 let sp=[{index:0,t:0},{index:0,t:1}],tp=[{index:9,t:0},{index:10,t:.5297912581645661}];
 for(let count=2;count<=5;count++){
  const next=F.extend(G,W,body,sp,belly,tp);sp=next.sourcePoints;tp=next.targetPoints;
  await page.locator('#fitting-continue').click();assert.match(await page.locator('#fitting-span-count').textContent(),new RegExp(`${count} 段`));assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');
 }
 const track=W.track(F.cut(G,body,...sp)),map=B.create(track.path,F.cut(G,belly,...tp)),scale=initial.calibration.length/G.dist(initial.calibration.a,initial.calibration.b),station=W.nearest(track,notch.nodes[0]).s,expected=F.moveMark(G,W,notch,track,station,station+5/scale);
 // The highlighted seam is driven by known arc stations, including corners.
 const seam=page.locator('[data-fit-joined-seam]'),end=await seam.evaluate(e=>{const p=e.getPointAtLength(e.getTotalLength());return {x:p.x,y:p.y};}),targetTrack=W.track(F.cut(G,belly,...tp));assert.ok(G.dist(end,W.at(targetTrack,track.length).point)<.002);
 const h=await page.locator(`[data-fit-mark-root="${notch.id}"]`).boundingBox(),to=await screen(map.forward(expected[0]));await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
 if(process.env.CURVE_EDITOR_LONG_SEAM_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_LONG_SEAM_SCREENSHOT});
 await page.locator('#fitting-unbend').click();const after=await save();if(process.env.CURVE_EDITOR_MULTISPAN_STEPS)await writeFile(path.join(process.env.CURVE_EDITOR_MULTISPAN_STEPS,'verification-long.json'),JSON.stringify({sourceSpans:5,sourceMm:track.length*scale,targetMm:targetTrack.length*scale,notchShiftMm:(W.nearest(track,after.paths[2].nodes[0]).s-station)*scale,notchBeforeMm:G.pathLength(notch)*scale,notchAfterMm:G.pathLength(after.paths[2])*scale,untouchedContoursEqual:JSON.stringify(after.paths.slice(0,2))===JSON.stringify(initial.paths.slice(0,2)),seamEndErrorMm:G.dist(end,W.at(targetTrack,track.length).point)*scale},null,2));assert.deepEqual(after.paths.slice(0,2),initial.paths.slice(0,2));for(let i=0;i<2;i++)assert.ok(G.dist(after.paths[2].nodes[i],expected[i])*scale<.002);assert.ok(Math.abs(G.pathLength(after.paths[2])-G.pathLength(notch))<.00001);assert.deepEqual(errors,[]);
});

function localFixture(){
 const curve=(id,pts,closed=false)=>({id,name:id,color:'#176bce',role:'outline',dashed:false,note:'',closed,nodes:pts.map(p=>G.node(...p))});
 const source=curve('source',[[100,180],[200,180],[300,180],[400,180],[400,320],[100,320]],true),inside=curve('mark-in',[[220,180],[220,193]]),outside=curve('mark-out',[[360,180],[360,193]]),target=curve('target',[[550,150],[820,260]]);target.nodes[0].out={x:660,y:140};target.nodes[1].in={x:750,y:190};
 return {paths:[source,inside,outside,target],layers:[{id:'piece',name:'裁片',visible:true,locked:false,pathIds:['source','mark-in','mark-out'],imageIds:[],textIds:[]},{id:'fixed',name:'对边',visible:true,locked:false,pathIds:['target'],imageIds:[],textIds:[]}]};
}
async function selectLocalNodes(page,click){
 await click({x:150,y:180});await page.locator('#handles .anchor[data-path="source"][data-node="2"]').click({modifiers:['Shift']});
 await page.locator('#fit-curves').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');await click({x:696.25,y:177.5});await page.locator('#fitting-panel[data-phase="ready"]').waitFor();
}
test('Shift selection fits only the selected arc and attached notch while the complementary outline and other notches stay in place',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);
 assert.equal(await page.locator('#fitting-whole').isChecked(),false);assert.match(await page.locator('#fitting-span-count').textContent(),/2 段/);
 const preview=page.locator('[data-fit-path="source"]');assert.doesNotMatch(await preview.getAttribute('d'),/Z/);
 const b=await preview.evaluate(e=>{const b=e.getBBox();return {x:b.x,y:b.y,height:b.height};});assert.ok(b.x>500&&b.height<100,JSON.stringify(b));
 assert.equal(await page.locator('[data-fit-path="mark-in"]').count(),1);assert.equal(await page.locator('[data-fit-path="mark-out"]').count(),0);
 assert.equal(await page.locator('#paths .hit-line[data-path="mark-out"]').evaluate(e=>getComputedStyle(e.previousElementSibling).opacity),'1');
 const fixed=await page.locator('#paths .hit-line[data-path="source"]').evaluate(e=>{const b=e.previousElementSibling.getBBox();return {x:b.x,y:b.y,width:b.width,height:b.height};});assert.deepEqual(fixed,{x:100,y:180,width:300,height:140});
 const targetPoint=await page.evaluate(({source,target})=>{const W=CurveWalk,G=CurveGeometry,F=CurveFitting,s=F.cut(G,source,{index:0,t:0},{index:1,t:1}),w=W.track(target),end=W.at(w,200).point,t=F.cut(G,target,{index:0,t:0},G.nearest(target,end));return CurveBend.create(s,t).forward({x:240,y:180});},{source:initial.paths[0],target:initial.paths[3]});
 const h=await page.locator('[data-fit-mark-root="mark-in"]').boundingBox(),to=await screen(targetPoint);await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();
 if(process.env.CURVE_EDITOR_LOCAL_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_LOCAL_SCREENSHOT});
 await page.locator('#fitting-unbend').click();const saved=await save();assert.deepEqual(saved.paths[0],initial.paths[0]);assert.deepEqual(saved.paths.slice(2),initial.paths.slice(2));assert.ok(Math.abs(saved.paths[1].nodes[0].x-240)<.03);assert.ok(Math.abs(G.pathLength(saved.paths[1])-13)<1e-8);assert.deepEqual(errors,[]);
});
test('box selection picks a continuous local range, protects both shared boundaries and edits only interior geometry',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:localFixture()});await click({x:150,y:180});
 const from=await screen({x:80,y:155}),to=await screen({x:320,y:205});await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();
 await page.locator('#fit-curves').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');await click({x:696.25,y:177.5});await page.locator('#fitting-edit').click();
 assert.equal(await page.locator('[data-fit-node-boundary]').count(),2);const node=page.locator('rect[data-fit-owner="source"][data-fit-node="1"]'),b=await node.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+3,b.y+b.height/2+9,{steps:5});await page.mouse.up();
 await page.locator('#fitting-unbend').click();const saved=await save();assert.notDeepEqual(saved.paths[0].nodes[1],initial.paths[0].nodes[1]);for(const i of [0,2,3,4,5])assert.deepEqual(saved.paths[0].nodes[i],initial.paths[0].nodes[i]);assert.deepEqual(saved.paths.slice(1),initial.paths.slice(1));assert.deepEqual(errors,[]);
});

test('inserting a local node keeps the original complementary curve and remaps the editable indices through undo',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);await page.locator('#fitting-edit').click();
 const rest=()=>page.locator('#paths .hit-line[data-path="source"]').evaluate(e=>e.previousElementSibling.getAttribute('d')),before=await rest();
 const q=await page.evaluate(({source,target})=>{const G=CurveGeometry,W=CurveWalk,F=CurveFitting,s=F.cut(G,source,{index:0,t:0},{index:1,t:1}),w=W.track(target),t=F.cut(G,target,{index:0,t:0},G.nearest(target,W.at(w,200).point));return CurveBend.create(s,t).forward({x:150,y:180});},{source:initial.paths[0],target:initial.paths[3]});
 const point=await screen(q);await page.mouse.dblclick(point.x,point.y);assert.equal(await rest(),before);assert.equal(await page.locator('#fitting-adjust').isDisabled(),true);
 const node=page.locator('rect[data-fit-owner="source"][data-fit-node="1"]'),b=await node.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+4,b.y+b.height/2+7,{steps:5});await page.mouse.up();assert.equal(await rest(),before);
 await page.locator('#fitting-unbend').click();let after=await save();assert.equal(after.paths[0].nodes.length,7);assert.deepEqual(after.paths[0].nodes.slice(3),initial.paths[0].nodes.slice(2));assert.deepEqual(after.paths[0].nodes[0].in,initial.paths[0].nodes[0].in);assert.deepEqual(after.paths.slice(1),initial.paths.slice(1));
 await page.locator('#undo').click();await page.locator('#undo').click();after=await save();assert.deepEqual(after.paths,initial.paths);assert.deepEqual(errors,[]);
});
test('a real 1hao local selection leaves the unused outline fixed while a 5 mm notch edit unfolds accurately',fixtureOptions('fitting-1hao.json'),async t=>{
 const fixture=require('./fixtures/fitting-1hao.json'),F=require('../../tools/curve-editor/fitting.js'),W=require('../../tools/curve-editor/walk.js'),B=require('../../tools/curve-editor/bend.js');
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:fixture});const [body,belly,notch]=initial.paths;
 await click(G.at(body.nodes[0],body.nodes[1],.5));await page.locator(`#handles .anchor[data-path="${body.id}"][data-node="2"]`).click({modifiers:['Shift']});await page.locator('#fit-curves').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');await click(G.at(belly.nodes[9],belly.nodes[10],.5));
 const source=F.cut(G,body,{index:0,t:0},{index:1,t:1}),track=W.track(source),r=F.extend(G,W,body,[{index:0,t:0},{index:0,t:1}],belly,[{index:9,t:0},{index:10,t:.5297912581645661}]),target=F.cut(G,belly,...r.targetPoints),map=B.create(source,target),scale=initial.calibration.length/G.dist(initial.calibration.a,initial.calibration.b),station=W.nearest(track,notch.nodes[0]).s,expected=F.moveMark(G,W,notch,track,station,station+5/scale);
 const unchanged=await page.locator(`#paths .hit-line[data-path="${body.id}"]`).evaluate(e=>e.previousElementSibling.getAttribute('d'));assert.equal(unchanged,G.pathD(body));
 const h=await page.locator(`[data-fit-mark-root="${notch.id}"]`).boundingBox(),to=await screen(map.forward(expected[0]));await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
 assert.equal(await page.locator(`#paths .hit-line[data-path="${body.id}"]`).evaluate(e=>e.previousElementSibling.getAttribute('d')),unchanged);
 if(process.env.CURVE_EDITOR_LOCAL_REAL_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_LOCAL_REAL_SCREENSHOT});
 await page.locator('#fitting-unbend').click();const after=await save();assert.deepEqual(after.paths.slice(0,2),initial.paths.slice(0,2));for(let i=0;i<2;i++)assert.ok(G.dist(after.paths[2].nodes[i],expected[i])*scale<.002);assert.ok(Math.abs(G.pathLength(after.paths[2])-G.pathLength(notch))<.00001);assert.deepEqual(errors,[]);
});

test('returning from whole-piece preview to local preview removes outside-notch edit handles',async t=>{
 const {page,initial,click,save}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();await page.locator('#fitting-edit').click();await page.locator('[data-fit-path="mark-out"]').click();assert.equal(await page.locator('[data-fit-owner="mark-out"]').count(),2);
 await page.locator('#fitting-whole').uncheck();assert.equal(await page.locator('[data-fit-owner="mark-out"]').count(),0);assert.equal(await page.locator('[data-fit-path="mark-out"]').count(),0);await page.keyboard.press('ArrowRight');await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);
});
test('deleting an interior node zero in a wrapped local range keeps valid clipping and the original complementary curve',async t=>{
 const {page,initial,click,save,errors}=await setup(t,{doc:localFixture()});await click({x:150,y:180});await page.locator('#handles .anchor[data-path="source"][data-node="5"]').click({modifiers:['Shift']});await page.locator('#fit-curves').click();await click({x:696.25,y:177.5});await page.locator('#fitting-edit').click();
 const rest=()=>page.locator('#paths .hit-line[data-path="source"]').evaluate(e=>e.previousElementSibling.getAttribute('d')),before=await rest();await page.locator('[data-fit-owner="source"][data-fit-node="0"]').click();await page.keyboard.press('Delete');assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');assert.equal(await rest(),before);
 assert.equal(await page.locator('[data-fit-start-end="1"]').getAttribute('aria-disabled'),'true');const preview=await page.locator('[data-fit-joined-seam]').getAttribute('d');await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-reverse-source').click();assert.match(await page.locator('#fitting-feedback').textContent(),/先展开/);assert.equal(await page.locator('[data-fit-start-end="0"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-fit-joined-seam]').getAttribute('d'),preview);
 await page.locator('#fitting-unbend').click();let saved=await save();assert.equal(saved.paths[0].nodes.length,5);assert.deepEqual(saved.paths[0].nodes,initial.paths[0].nodes.slice(1));assert.deepEqual(saved.paths.slice(1),initial.paths.slice(1));await page.locator('#undo').click();saved=await save();assert.deepEqual(saved.paths,initial.paths);assert.deepEqual(errors,[]);
});
test('selecting all nodes of a closed outline still protects its coincident local endpoints',async t=>{
 const {page,initial,click,save,errors}=await setup(t,{doc:localFixture()});await click({x:150,y:180});
 for(const index of [2,3,4,5])await page.locator(`#handles .anchor[data-path="source"][data-node="${index}"]`).click({modifiers:['Shift']});
 await page.locator('#fit-curves').click();await click({x:696.25,y:177.5});await page.locator('#fitting-edit').click();assert.equal(await page.locator('[data-fit-node-boundary]').count(),1);assert.equal(await page.locator('[data-fit-owner="source"][data-fit-node="0"]').count(),0);
 await page.locator('[data-fit-node-boundary]').click();await page.keyboard.press('Delete');await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('both fitting scopes keep the complete original source highlighted and clearly named',async t=>{
 const {page,initial,click,save}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);
 const original=page.locator('[data-fit-original="source"]');assert.equal(await original.count(),1);assert.equal(await original.getAttribute('d'),G.pathD(initial.paths[0]));assert.match(await page.locator('[data-fit-original-label="source"]').textContent(),/source/);assert.equal(await page.locator('[data-fit-source-range]').count(),1);
 await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();assert.equal(await original.getAttribute('d'),G.pathD(initial.paths[0]));assert.equal(await page.locator('[data-fit-target-route]').count(),1);
 await page.locator('#fitting-unbend').click();assert.equal(await original.count(),0);assert.deepEqual((await save()).paths,initial.paths);
});
test('position dragging moves only the landing point until release, then the fit travels along the original target curve',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);const preview=page.locator('[data-fit-path="source"]'),before=await preview.getAttribute('d');
 const handle=await page.locator('[data-fit-offset]').boundingBox(),delta=await page.evaluate(target=>{const w=CurveWalk.track(target),a=CurveWalk.at(w,0).point,b=CurveWalk.at(w,60).point;return {x:b.x-a.x,y:b.y-a.y};},initial.paths[3]),origin=await screen({x:0,y:0}),moved=await screen(delta);
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+moved.x-origin.x,handle.y+handle.height/2+moved.y-origin.y,{steps:6});assert.equal(await preview.getAttribute('d'),before);assert.equal(await page.locator('#fitting-panel').getAttribute('data-position-state'),'placing');assert.equal(await page.locator('[data-fit-offset-landing]').count(),1);
 if(process.env.CURVE_EDITOR_POSITION_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_POSITION_SCREENSHOT.replace('.png','-placing.png')});
 await page.mouse.up();await page.waitForFunction(()=>document.getElementById('fitting-panel').dataset.positionState==='moving'&&Number(document.getElementById('fitting-offset').value)>3);
 const during=await page.locator('[data-fit-joined-seam]').evaluate((el,target)=>{const p=el.getPointAtLength(0),w=CurveWalk.track(target),n=CurveWalk.nearest(w,p);return {station:n.s,distance:n.distance};},initial.paths[3]);assert.ok(during.station>0&&during.station<60);assert.ok(during.distance<.02);
 await page.locator('#fitting-panel[data-position-state="idle"]').waitFor();assert.ok(Math.abs(Number(await page.locator('#fitting-offset').inputValue())-60)<.05);assert.notEqual(await preview.getAttribute('d'),before);
 if(process.env.CURVE_EDITOR_POSITION_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_POSITION_SCREENSHOT});await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('both scopes travel around the next bends of the full target route rather than continuing along a tangent',async t=>{
 for(const whole of [false,true]){
  const doc=localFixture();doc.paths[3].nodes=[[550,150],[700,150],[700,300],[550,300]].map(p=>G.node(...p));
  const {page,initial,click,screen,save,errors}=await setup(t,{doc});await selectLocalNodes(page,click);if(whole){await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();}
  const h=await page.locator('[data-fit-offset]').boundingBox(),from=await screen({x:550,y:150}),to=await screen({x:700,y:220});await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+to.x-from.x,h.y+h.height/2+to.y-from.y,{steps:5});await page.mouse.up();await page.locator('#fitting-panel[data-position-state="idle"]').waitFor();
  const seam=await page.locator('[data-fit-joined-seam]').evaluate(el=>{const a=el.getPointAtLength(0),b=el.getPointAtLength(el.getTotalLength());return {a:{x:a.x,y:a.y},b:{x:b.x,y:b.y}};});assert.ok(G.dist(seam.a,{x:700,y:220})<.03);assert.ok(G.dist(seam.b,{x:580,y:300})<.03);
  const mark=await page.locator('[data-fit-mark-root="mark-in"]').boundingBox(),destination=await screen({x:640,y:300});assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y).getAttribute('data-fit-mark-root'),{x:mark.x+mark.width/2,y:mark.y+mark.height/2}),'mark-in','notch handle must remain above an overlapping track endpoint ring');await page.mouse.move(mark.x+mark.width/2,mark.y+mark.height/2);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:8});await page.mouse.up();await page.locator('#fitting-unbend').click();const after=await save();assert.deepEqual(after.paths[0],initial.paths[0]);assert.deepEqual(after.paths.slice(2),initial.paths.slice(2));assert.ok(G.dist(after.paths[1].nodes[0],{x:240,y:180})<.03,JSON.stringify({whole,nodes:after.paths[1].nodes}));assert.ok(Math.abs(G.pathLength(after.paths[1])-13)<.00001);assert.deepEqual(errors,[]);
 }
});
test('canceling a position placement or leaving an animation stops it without modifying the artwork or leaving stale controls',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);const before=await page.locator('[data-fit-path="source"]').getAttribute('d');
 async function movePoint(){const b=await page.locator('[data-fit-offset]').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+55,b.y+b.height/2+10,{steps:5});}
 await movePoint();await page.locator('#canvas').dispatchEvent('pointercancel');await page.mouse.up();assert.equal(await page.locator('#fitting-panel').getAttribute('data-position-state'),'idle');assert.equal(await page.locator('[data-fit-path="source"]').getAttribute('d'),before);
 await movePoint();await page.mouse.up();await page.waitForFunction(()=>document.getElementById('fitting-panel').dataset.positionState==='moving');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal(await page.locator('#fitting-panel').getAttribute('data-position-state'),'idle');
 await movePoint();await page.mouse.up();await page.keyboard.press('Escape');await page.waitForTimeout(1100);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'idle');assert.equal(await page.locator('[data-fit-path]').count(),0);assert.equal(await page.locator('[data-fit-original]').count(),0);assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('an unsupported movement stops at the last valid station and keeps source highlighting and original data',async t=>{
 const {page,initial,click,save}=await setup(t,{doc:localFixture()});await page.evaluate(()=>{const create=CurveBend.create;CurveBend.create=(...args)=>{const map=create(...args);let offset=0;return {...map,setOffset(v){offset=v;map.setOffset(v);},preview(p){if(offset>30)throw Error('unsupported test station');return map.preview(p);}};};});await selectLocalNodes(page,click);
 const b=await page.locator('[data-fit-offset]').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+100,b.y+b.height/2+15,{steps:5});await page.mouse.up();await page.locator('#fitting-panel[data-position-state="idle"]').waitFor();const offset=Number(await page.locator('#fitting-offset').inputValue());assert.ok(offset>=0&&offset<=30);assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');assert.match(await page.locator('#fitting-feedback').textContent(),/上一个有效位置/);assert.equal(await page.locator('[data-fit-original="source"]').count(),1);await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);
});

test('a notch can still move and unfold accurately after the position travels across the start of a closed target route',async t=>{
 const doc=localFixture();doc.paths[3].closed=true;doc.paths[3].nodes=[[550,150],[700,150],[700,300],[550,300]].map(p=>G.node(...p));const {page,initial,click,screen,save,errors}=await setup(t,{doc});await selectLocalNodes(page,click);
 const b=await page.locator('[data-fit-offset]').boundingBox(),from=await screen({x:700,y:150}),to=await screen({x:650,y:150});await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+to.x-from.x,b.y+b.height/2+to.y-from.y,{steps:5});await page.mouse.up();await page.locator('#fitting-panel[data-position-state="idle"]').waitFor();assert.ok(Math.abs(Number(await page.locator('#fitting-offset').inputValue())-550)<.03);
 const mark=await page.locator('[data-fit-mark-root="mark-in"]').boundingBox(),destination=await screen({x:700,y:240});await page.mouse.move(mark.x+mark.width/2,mark.y+mark.height/2);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:8});await page.mouse.up();await page.locator('#fitting-unbend').click();const after=await save();assert.ok(G.dist(after.paths[1].nodes[0],{x:240,y:180})<.03);assert.deepEqual(after.paths[0],initial.paths[0]);assert.deepEqual(after.paths.slice(2),initial.paths.slice(2));assert.deepEqual(errors,[]);
});

test('the dropped positioning point stays at its landing location while the curve catches up along the route',async t=>{
 const {page,click}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);const b=await page.locator('[data-fit-offset]').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+80,b.y+b.height/2+10,{steps:5});const placed=await page.locator('[data-fit-offset]').evaluate(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))}));await page.mouse.up();await page.waitForFunction(()=>document.getElementById('fitting-panel').dataset.positionState==='moving');const moving=await page.locator('[data-fit-offset]').evaluate(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))}));assert.ok(G.dist(placed,moving)<.01);assert.equal(await page.locator('[data-fit-position-head]').count(),1);assert.equal(await page.locator('[data-fit-offset-landing]').count(),1);await page.locator('#fitting-panel[data-position-state="idle"]').waitFor();await page.locator('#fitting-unbend').click();
});

test('the real 1hao whole-piece fit visibly follows the route and keeps a subsequent 5 mm notch edit accurate on unfolding',fixtureOptions('fitting-1hao.json'),async t=>{
 const fixture=require('./fixtures/fitting-1hao.json'),F=require('../../tools/curve-editor/fitting.js'),W=require('../../tools/curve-editor/walk.js');const {page,initial,click,screen,save,errors}=await setup(t,{doc:fixture});const [body,belly,notch]=initial.paths;
 await click(G.at(body.nodes[0],body.nodes[1],.5));await page.locator(`#handles .anchor[data-path="${body.id}"][data-node="2"]`).click({modifiers:['Shift']});await page.locator('#fit-curves').click();await click(G.at(belly.nodes[9],belly.nodes[10],.5));await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();
 const source=F.cut(G,body,{index:0,t:0},{index:1,t:1}),sourceTrack=W.track(source),route=F.route(G,W,belly,[{index:9,t:0},{index:10,t:1}]),track=W.track(route.path),a=await screen(W.at(track,0).point),b=await screen(W.at(track,60).point),h=await page.locator('[data-fit-offset]').boundingBox();
 await page.evaluate(()=>{window.positionSamples=[];window.positionObserver=new MutationObserver(()=>positionSamples.push(Number(document.getElementById('fitting-offset').value)));positionObserver.observe(document.getElementById('fitting-preview'),{childList:true,subtree:true});});
 await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+b.x-a.x,h.y+h.height/2+b.y-a.y,{steps:5});await page.mouse.up();await page.locator('#fitting-panel[data-position-state="idle"]').waitFor();const samples=await page.evaluate(()=>{positionObserver.disconnect();return positionSamples;});assert.ok(samples.some(s=>s>1&&s<59),JSON.stringify(samples));assert.ok(Math.abs(Number(await page.locator('#fitting-offset').inputValue())-60)<.03);
 if(process.env.CURVE_EDITOR_POSITION_REAL_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_POSITION_REAL_SCREENSHOT});
 const scale=initial.calibration.length/G.dist(initial.calibration.a,initial.calibration.b),station=W.nearest(sourceTrack,notch.nodes[0]).s,expected=F.moveMark(G,W,notch,sourceTrack,station,station+5/scale),destination=await screen(W.at(track,60+station+5/scale).point),mark=await page.locator(`[data-fit-mark-root="${notch.id}"]`).boundingBox();
 await page.mouse.move(mark.x+mark.width/2,mark.y+mark.height/2);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:8});await page.mouse.up();await page.locator('#fitting-unbend').click();const after=await save();assert.deepEqual(after.paths.slice(0,2),initial.paths.slice(0,2));for(let i=0;i<2;i++)assert.ok(G.dist(after.paths[2].nodes[i],expected[i])*scale<.002);assert.ok(Math.abs(G.pathLength(after.paths[2])-G.pathLength(notch))<.00001);assert.deepEqual(errors,[]);
});

test('the floating fitting guide only minimizes and reopens without affecting fitting or artwork, and opens automatically on the next fitting',async t=>{
 const {page,initial,click,save,errors}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);const guide=page.locator('#fitting-guide');assert.equal(await guide.isVisible(),true);
 await page.getByRole('button',{name:'最小化拟合提示',exact:true}).click();assert.equal(await page.locator('#fitting-guide-content').isVisible(),false);const compact=await guide.boundingBox(),canvas=await page.locator('#canvas').boundingBox();assert.ok(compact.height<45&&compact.width<190);assert.ok(compact.y>canvas.y+canvas.height/2);
 await page.getByRole('button',{name:'展开拟合提示',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#fitting-guide-content').isVisible(),true);await page.getByRole('button',{name:'最小化拟合提示',exact:true}).click();assert.equal(await guide.isVisible(),true);assert.equal(await page.locator('#fitting-guide-content').isVisible(),false);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');
 await page.locator('#fitting-guide-show').click();assert.equal(await page.locator('#fitting-guide-content').isVisible(),true);await page.getByRole('button',{name:'最小化拟合提示',exact:true}).click();await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.reload();await page.locator('.layer-row[data-layer="piece"]').waitFor();await selectLocalNodes(page,click);assert.equal(await guide.isVisible(),true);assert.equal(await page.locator('#fitting-guide-content').isVisible(),true);if(process.env.CURVE_EDITOR_GUIDE_SCREENSHOT){await page.getByRole('button',{name:'最小化拟合提示',exact:true}).click();await page.screenshot({path:process.env.CURVE_EDITOR_GUIDE_SCREENSHOT});}await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('the fitting guide can still minimize and reopen when preference storage is unavailable',async t=>{
 const {page,click,errors}=await setup(t,{doc:localFixture()});await page.evaluate(()=>{Storage.prototype.getItem=()=>{throw Error('unavailable');};Storage.prototype.setItem=()=>{throw Error('unavailable');};});await selectLocalNodes(page,click);await page.getByRole('button',{name:'最小化拟合提示',exact:true}).click();assert.equal(await page.locator('#fitting-guide').isVisible(),true);assert.equal(await page.locator('#fitting-guide-content').isVisible(),false);await page.locator('#fitting-guide-show').click();assert.equal(await page.locator('#fitting-guide').isVisible(),true);assert.deepEqual(errors,[]);
});

test('continuing fitting can step backward and forward through toolbar and keyboard in both scopes without changing artwork',fixtureOptions('fitting-1hao.json'),async t=>{
 for(const whole of [false,true]){
  const fixture=require('./fixtures/fitting-1hao.json'),{page,initial,click,save,errors}=await setup(t,{doc:fixture}),[body,belly]=initial.paths;
  await page.locator('#deselect').click();await page.locator('#fit-curves').click();await click(G.at(body.nodes[0],body.nodes[1],.5));await click(G.at(belly.nodes[9],belly.nodes[10],.5));if(whole){await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();}
  const preview=page.locator(`[data-fit-path="${body.id}"]`),first=await preview.getAttribute('d');await page.locator('#fitting-continue').click();const second=await preview.getAttribute('d');await page.locator('#fitting-continue').click();const third=await preview.getAttribute('d');assert.equal(await page.locator('#undo').isEnabled(),true);assert.equal(await page.locator('#undo').evaluate(e=>!!e.closest('[inert]')),false);
  await page.locator('#undo').click();assert.match(await page.locator('#fitting-span-count').textContent(),/2 段/);assert.equal(await preview.getAttribute('d'),second);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');
  if(process.env.CURVE_EDITOR_FITTING_BACK_SCREENSHOT&&!whole)await page.screenshot({path:process.env.CURVE_EDITOR_FITTING_BACK_SCREENSHOT});
  await page.keyboard.press('Control+z');assert.match(await page.locator('#fitting-span-count').textContent(),/1 段/);assert.equal(await preview.getAttribute('d'),first);assert.equal(await page.locator('#fitting-back').isDisabled(),true);
  await page.keyboard.press('Control+Shift+z');assert.equal(await preview.getAttribute('d'),second);await page.locator('#redo').click();assert.equal(await preview.getAttribute('d'),third);await page.locator('#fitting-back').click();assert.equal(await preview.getAttribute('d'),second);await page.locator('#fitting-continue').click();assert.equal(await preview.getAttribute('d'),third);assert.equal(await page.locator('#redo').isDisabled(),true);
  await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
 }
});
test('explicitly stepping back a fitted range keeps the notch edit and document undo still applies to the actual edit',async t=>{
 const {page,initial,click,screen,save,errors}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);await page.locator('#fitting-continue').click();assert.match(await page.locator('#fitting-span-count').textContent(),/3 段/);
 const to=await screen(await page.evaluate(target=>CurveWalk.at(CurveWalk.track(target),140).point,initial.paths[3])),mark=await page.locator('[data-fit-mark-root="mark-in"]').boundingBox();await page.mouse.move(mark.x+mark.width/2,mark.y+mark.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();
 await page.locator('#fitting-back').click();assert.match(await page.locator('#fitting-span-count').textContent(),/2 段/);await page.locator('#redo').click();assert.match(await page.locator('#fitting-span-count').textContent(),/3 段/);await page.locator('#fitting-unbend').click();const edited=await save();assert.ok(G.dist(edited.paths[1].nodes[0],{x:240,y:180})<.03);assert.deepEqual(edited.paths[0],initial.paths[0]);assert.deepEqual(edited.paths.slice(2),initial.paths.slice(2));await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('failed continuation adds no undo range, while a later notch edit is undone before an older continuation',async t=>{
 const {page,initial,click,screen,save}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);await page.evaluate(()=>{window.realBendCreate=CurveBend.create;CurveBend.create=(...a)=>({...realBendCreate(...a),forward(){throw Error('failed continuation');},preview(){throw Error('failed continuation');}});});await page.locator('#fitting-continue').click();assert.equal(await page.locator('#fitting-back').isDisabled(),true);assert.equal(await page.locator('#undo').isDisabled(),true);await page.evaluate(()=>CurveBend.create=realBendCreate);
 await page.locator('#fitting-continue').click();const to=await screen(await page.evaluate(target=>CurveWalk.at(CurveWalk.track(target),140).point,initial.paths[3])),mark=await page.locator('[data-fit-mark-root="mark-in"]').boundingBox();await page.mouse.move(mark.x+mark.width/2,mark.y+mark.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();await page.locator('#undo').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'idle');assert.deepEqual((await save()).paths,initial.paths);
});

test('editing a notch before continuing still undoes the continuation first and keeps the edited notch intact',async t=>{
 const {page,initial,click,screen,save}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);const to=await screen(await page.evaluate(target=>CurveWalk.at(CurveWalk.track(target),140).point,initial.paths[3])),mark=await page.locator('[data-fit-mark-root="mark-in"]').boundingBox();await page.mouse.move(mark.x+mark.width/2,mark.y+mark.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();await page.locator('#fitting-continue').click();assert.match(await page.locator('#fitting-span-count').textContent(),/3 段/);
 await page.locator('#undo').click();assert.match(await page.locator('#fitting-span-count').textContent(),/2 段/);await page.locator('#redo').click();assert.match(await page.locator('#fitting-span-count').textContent(),/3 段/);await page.locator('#undo').click();await page.locator('#fitting-unbend').click();const after=await save();assert.ok(G.dist(after.paths[1].nodes[0],{x:240,y:180})<.03);assert.deepEqual(after.paths[0],initial.paths[0]);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
});

test('fitting colors can change independently in both scopes and persist without changing artwork or range undo',async t=>{
 const {page,initial,click,save,errors}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);
 for(const [id,value] of [['fitting-source-color','#d50f83'],['fitting-target-color','#6c45ce']])await page.locator('#'+id).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
 const colors=async()=>{assert.equal(await page.locator('[data-fit-original="source"]').getAttribute('stroke'),'#d50f83');assert.equal(await page.locator('[data-fit-source-range]').getAttribute('stroke'),'#d50f83');assert.equal(await page.locator('[data-fit-path="source"]').evaluate(e=>e.previousElementSibling.getAttribute('stroke')),'#d50f83');assert.equal(await page.locator('[data-fit-joined-seam]').getAttribute('stroke'),'#d50f83');assert.equal(await page.locator('[data-fit-target-route]').getAttribute('stroke'),'#6c45ce');assert.equal(await page.locator('[data-fit-fixed-seam]').getAttribute('stroke'),'#6c45ce');};
 await colors();await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();await colors();await page.locator('#fitting-continue').click();await page.locator('#fitting-back').click();await colors();await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.reload();await page.locator('.layer-row[data-layer="piece"]').waitFor();await selectLocalNodes(page,click);assert.equal(await page.locator('#fitting-source-color').inputValue(),'#d50f83');assert.equal(await page.locator('#fitting-target-color').inputValue(),'#6c45ce');await colors();assert.deepEqual(errors,[]);
});
test('optional curve labels stay hidden while start and direction labels remain visible',async t=>{
 const {page,initial,click,save,errors}=await setup(t,{doc:localFixture()});await selectLocalNodes(page,click);
 const visible=()=>page.locator('#fitting-originals text:not([data-fit-direction-label]),#fitting-preview text:not([data-fit-direction-label])').evaluateAll(es=>es.filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent));assert.equal(await page.locator('[data-fit-direction-label="source-start"]').isVisible(),true);assert.equal(await page.locator('[data-fit-direction-label="target-start"]').isVisible(),true);assert.deepEqual(await visible(),[]);assert.match(await page.locator('#fitting-piece').textContent(),/source/);
 const h=await page.locator('[data-fit-offset]').boundingBox();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+h.width/2+65,h.y+h.height/2+10,{steps:5});assert.deepEqual(await visible(),[]);await page.mouse.up();await page.locator('#fitting-panel[data-position-state="idle"]').waitFor();assert.deepEqual(await visible(),[]);
 await page.locator('#fitting-show-labels').check();assert.ok((await visible()).includes('对合位置'));await page.locator('#fitting-show-labels').uncheck();assert.deepEqual(await visible(),[]);
 if(process.env.CURVE_EDITOR_FITTING_COLORS_SCREENSHOT){for(const [id,value] of [['fitting-source-color','#d50f83'],['fitting-target-color','#6c45ce']])await page.locator('#'+id).evaluate((e,value)=>{e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));},value);await page.locator('#fitting-guide-minimize').click();await page.screenshot({path:process.env.CURVE_EDITOR_FITTING_COLORS_SCREENSHOT});}
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

async function pickFitStart(page,index){
 const ring=page.locator(`[data-fit-start-end="${index}"]`);await ring.waitFor();
 const box=await ring.boundingBox();await page.mouse.click(box.x+1,box.y+box.height/2);
}
test('local fitting endpoints choose the start before and after target selection without changing the document',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:liveEditingFixture()});
 await click({x:150,y:180});await page.locator('#handles .anchor[data-node="2"]').click({modifiers:['Shift']});await page.keyboard.press('n');
 const first=page.locator('[data-fit-start-end="0"]'),last=page.locator('[data-fit-start-end="1"]');
 await last.waitFor();assert.equal(await first.getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('[data-fit-direction-label="source-start"]').isVisible(),true);
 const arrow=page.locator('[data-fit-direction="source"]').first(),forward=await arrow.getAttribute('d');
 await pickFitStart(page,1);assert.equal(await last.getAttribute('aria-pressed'),'true');assert.notEqual(await arrow.getAttribute('d'),forward);
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');
 await click(G.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.5));
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');
 assert.equal(await last.getAttribute('aria-pressed'),'true');
 const preview=page.locator('#fitting-preview [data-fit-path="live-source"]'),reversed=await preview.getAttribute('d');
 assert.equal(await page.locator('[data-fit-direction-label="target-start"]').isVisible(),true);
 await pickFitStart(page,0);assert.equal(await first.getAttribute('aria-pressed'),'true');assert.notEqual(await preview.getAttribute('d'),reversed);
 await pickFitStart(page,0);assert.equal(await first.getAttribute('aria-pressed'),'true');
 await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-reverse-source').click();assert.equal(await last.getAttribute('aria-pressed'),'true');
 const targetArrow=await page.locator('[data-fit-direction="target"]').first().getAttribute('d');await page.locator('#fitting-reverse-target').click();assert.notEqual(await page.locator('[data-fit-direction="target"]').first().getAttribute('d'),targetArrow);
 if(process.env.FITTING_START_SCREENSHOT)await page.screenshot({path:process.env.FITTING_START_SCREENSHOT});
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await first.count(),0);assert.deepEqual(errors,[]);
});
test('start rings leave original endpoint centers editable and follow changed geometry',async t=>{
 const {page,click,screen,save,initial,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);
 await page.locator('[data-fit-start-end="0"]').waitFor();
 const start=await screen(initial.paths[0].nodes[0]),end=await screen({x:90,y:195});await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5});await page.mouse.up();
 const saved=await save();assert.ok(G.dist(saved.paths[0].nodes[0],{x:90,y:195})<.05);
 assert.ok(Math.abs(Number(await page.locator('[data-fit-start-end="0"]').getAttribute('cx'))-90)<.05);
 await pickFitStart(page,1);assert.equal(await page.locator('[data-fit-start-end="1"]').getAttribute('aria-pressed'),'true');assert.deepEqual((await save()).paths,saved.paths);assert.deepEqual(errors,[]);
});
test('start picking keeps a closed selection across node zero on the same arc',async t=>{
 const fixture=inlineNotchFixture(),{page,click,screen,save,initial,errors}=await setup(t,{doc:fixture});
 await click({x:100,y:250});await marquee(page,screen,{x:85,y:160},{x:110,y:335});await page.keyboard.press('n');
 await page.locator('[data-fit-start-end="1"]').waitFor();
 assert.equal(Number(await page.locator('[data-fit-start-end="0"]').getAttribute('cy')),320);
 assert.equal(Number(await page.locator('[data-fit-start-end="1"]').getAttribute('cy')),180);
 const range=await page.locator('[data-fit-source-range]').getAttribute('d');await pickFitStart(page,1);assert.equal(await page.locator('[data-fit-source-range]').getAttribute('d'),range);
 await click(G.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.5));assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.match(await page.locator('#fitting-lengths').textContent(),/140\.00 mm/);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('changing the start resets old continuation history and new continuation follows the chosen end',async t=>{
 const {page,click,screen,initial,save,errors}=await setup(t,{doc:liveEditingFixture()});await click({x:150,y:180});await marquee(page,screen,{x:185,y:160},{x:315,y:200});await page.keyboard.press('n');await click(G.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.5));
 assert.match(await page.locator('#fitting-lengths').textContent(),/100\.00 mm/);await page.locator('#fitting-continue').click();assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);assert.equal(await page.locator('#fitting-back').isEnabled(),true);
 await pickFitStart(page,1);assert.equal(await page.locator('#fitting-back').isEnabled(),false);assert.equal(Number(await page.locator('[data-fit-start-end="1"]').getAttribute('cx')),400);
 await page.locator('#fitting-continue').click();assert.match(await page.locator('#fitting-lengths').textContent(),/300\.00 mm/);assert.equal(await page.locator('[data-fit-start-end="1"]').getAttribute('aria-pressed'),'true');
 await page.locator('#fitting-back').click();assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);assert.equal(Number(await page.locator('[data-fit-start-end="1"]').getAttribute('cx')),400);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('fitted insertion keeps new nodes when direction switching requires unfolding first',async t=>{
 const {page,click,save,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);await page.locator('#fitting-edit').click();
 const target=page.locator('#fitting-preview [data-fit-path="live-source"]').first();const p=await target.evaluate(el=>{const q=el.getPointAtLength(el.getTotalLength()*.7),r=new DOMPoint(q.x,q.y).matrixTransform(el.getScreenCTM());return {x:r.x,y:r.y};});await page.mouse.dblclick(p.x,p.y);
 const modified=await save();assert.equal(modified.paths[0].nodes.length,5);assert.equal(await page.locator('[data-fit-start-end="1"]').getAttribute('aria-disabled'),'true');
 await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-reverse-source').click();assert.match(await page.locator('#fitting-feedback').textContent(),/先展开/);assert.equal(await page.locator('[data-fit-start-end="0"]').getAttribute('aria-pressed'),'true');
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,modified.paths);assert.deepEqual(errors,[]);
});
test('failed start changes restore the preview, offset, selected endpoint and range history',async t=>{
 const {page,click,save,initial,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);await page.locator('#fitting-continue').click();await page.locator('.fitting-advanced > summary').click();
 await page.locator('#fitting-offset').evaluate(el=>{el.value=20;el.dispatchEvent(new Event('input',{bubbles:true}));});
 const preview=page.locator('#fitting-preview [data-fit-path="live-source"]'),before=await preview.getAttribute('d'),offset=await page.locator('#fitting-offset').inputValue();
 for(const phase of ['build','render']){
  await page.evaluate(phase=>{window.startTestCreate=CurveBend.create;CurveBend.create=(...args)=>{if(phase==='build')throw Error('test start build failure');return {...startTestCreate(...args),forward(){throw Error('test start preview failure');},preview(){throw Error('test start preview failure');}};};},phase);
  await pickFitStart(page,1);assert.match(await page.locator('#fitting-feedback').textContent(),/保留上一次起点/);assert.equal(await page.locator('[data-fit-start-end="0"]').getAttribute('aria-pressed'),'true');assert.equal(await preview.getAttribute('d'),before);assert.equal(await page.locator('#fitting-offset').inputValue(),offset);assert.equal(await page.locator('#fitting-back').isEnabled(),true);
  await page.evaluate(()=>{CurveBend.create=startTestCreate;});
 }
 await page.locator('#fitting-back').click();assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

async function pickTargetStart(page,index){
 const ring=page.locator(`[data-fit-target-start-end="${index}"]`);await ring.waitFor();const box=await ring.boundingBox();await page.mouse.click(box.x+1,box.y+box.height/2);
}
test('target endpoint rings choose the alignment start, reset offset and keep the source start and artwork',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);
 const first=page.locator('[data-fit-target-start-end="0"]'),last=page.locator('[data-fit-target-start-end="1"]');await last.waitFor();
 const ends=await page.locator('[data-fit-target-start-end]').evaluateAll(es=>es.map(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))})));
 assert.equal(await first.getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-fit-direction-label="target-end"]').isVisible(),true);
 const arrow=page.locator('[data-fit-direction="target"]').first(),before=await arrow.getAttribute('d');await pickTargetStart(page,1);assert.equal(await last.getAttribute('aria-pressed'),'true');assert.notEqual(await arrow.getAttribute('d'),before);assert.equal(await page.locator('[data-fit-start-end="0"]').getAttribute('aria-pressed'),'true');
 const actual=page.locator('[data-fit-alignment-start]');assert.ok(Math.abs(Number(await actual.getAttribute('cx'))-ends[1].x)<.01);assert.ok(Math.abs(Number(await actual.getAttribute('cy'))-ends[1].y)<.01);
 await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-reverse-target').click();assert.equal(await first.getAttribute('aria-pressed'),'true');
 await page.locator('#fitting-offset').evaluate(el=>{el.value=35;el.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(Number(await page.locator('#fitting-offset').inputValue()),35);
 await pickTargetStart(page,0);assert.equal(Number(await page.locator('#fitting-offset').inputValue()),0);assert.ok(Math.abs(Number(await actual.getAttribute('cx'))-ends[0].x)<.01);
 const preview=await page.locator('[data-fit-joined-seam]').getAttribute('d');await pickTargetStart(page,0);assert.equal(await page.locator('[data-fit-joined-seam]').getAttribute('d'),preview);
 if(process.env.FITTING_TARGET_SCREENSHOT){await page.locator('#fitting-guide-minimize').click();await page.screenshot({path:process.env.FITTING_TARGET_SCREENSHOT});}
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('failed target endpoint changes restore direction, offset, preview and continuation history',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);await page.locator('#fitting-continue').click();await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-offset').evaluate(el=>{el.value=20;el.dispatchEvent(new Event('input',{bubbles:true}));});
 const before=await page.locator('[data-fit-joined-seam]').getAttribute('d');await page.evaluate(()=>{window.targetStartCreate=CurveBend.create;CurveBend.create=()=>{throw Error('target start failure');};});
 await pickTargetStart(page,1);assert.equal(await page.locator('[data-fit-target-start-end="0"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#fitting-offset').inputValue(),'20');assert.equal(await page.locator('[data-fit-joined-seam]').getAttribute('d'),before);assert.equal(await page.locator('#fitting-back').isEnabled(),true);
 await page.evaluate(()=>{CurveBend.create=targetStartCreate;});await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('target endpoint circles leave native target node centers editable and follow their positions',async t=>{
 const {page,click,screen,initial,save,errors}=await setup(t,{doc:liveEditingFixture()});await startLiveSelection(page,click);await page.locator('[data-fit-target-start-end="0"]').waitFor();
 const a=await screen(initial.paths[1].nodes[0]),b=await screen({x:540,y:130});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();
 const edited=await save();assert.ok(G.dist(edited.paths[1].nodes[0],{x:540,y:130})<.05);assert.ok(Math.abs(Number(await page.locator('[data-fit-target-start-end="0"]').getAttribute('cx'))-540)<.05);
 await pickTargetStart(page,1);assert.equal(await page.locator('[data-fit-target-start-end="1"]').getAttribute('aria-pressed'),'true');await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,edited.paths);assert.deepEqual(errors,[]);
});
test('target start selection reverses a closed track range crossing zero without changing its chosen arc',async t=>{
 const doc=liveEditingFixture();doc.paths[1].closed=true;doc.paths[1].nodes=[[550,140],[950,140],[950,500],[550,500]].map(p=>G.node(...p));
 const {page,click,screen,initial,save,errors}=await setup(t,{doc});await click({x:150,y:180});await page.locator('#handles .anchor[data-node="2"]').click({modifiers:['Shift']});await page.keyboard.press('n');await click({x:550,y:320});
 await page.locator('#fitting-adjust').click();const box=await page.locator('[data-fit-range="target"][data-fit-end="1"]').boundingBox(),to=await screen({x:650,y:140});await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();await page.locator('#fitting-adjust').click();
 const seam=page.locator('[data-fit-fixed-seam]'),beforeLength=await seam.evaluate(e=>e.getTotalLength()),positions=await page.locator('[data-fit-target-start-end]').evaluateAll(es=>es.map(e=>[e.getAttribute('cx'),e.getAttribute('cy')]));
 await pickTargetStart(page,1);assert.equal(await page.locator('[data-fit-target-start-end="1"]').getAttribute('aria-pressed'),'true');assert.ok(Math.abs(await seam.evaluate(e=>e.getTotalLength())-beforeLength)<.01);assert.deepEqual(await page.locator('[data-fit-target-start-end]').evaluateAll(es=>es.map(e=>[e.getAttribute('cx'),e.getAttribute('cy')])),positions);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

function targetNodesFixture(closed=false){const doc=liveEditingFixture();doc.paths[1].nodes=[[550,140],[750,140],[950,240],[950,500],[550,500]].map(p=>G.node(...p));doc.paths[1].closed=closed;return doc;}
async function startTargetNodes(page,click){await click({x:150,y:180});await page.locator('#handles .anchor[data-path="live-source"][data-node="2"]').click({modifiers:['Shift']});await page.keyboard.press('n');await click({x:650,y:140});await page.locator('#fitting-panel[data-phase="ready"]').waitFor();}
async function alignmentPoint(page){return page.locator('[data-fit-alignment-start]').evaluate(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))}));}
test('any target node can start alignment with exact position, reset offset and unchanged artwork',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 assert.equal(await page.locator('[data-fit-target-node]').count(),5);await pickFitStart(page,1);
 await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-offset').evaluate(e=>{e.value=30;e.dispatchEvent(new Event('input',{bubbles:true}));});
 for(const index of [1,2,4,2,0]){
  await click(initial.paths[1].nodes[index]);assert.ok(G.dist(await alignmentPoint(page),initial.paths[1].nodes[index])<.01);assert.equal(await page.locator('#fitting-offset').inputValue(),'0');assert.equal(await page.locator('[data-fit-start-end="1"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');
  const label=await page.locator('[data-fit-direction-label="target-start"]').boundingBox(),canvas=await page.locator('#canvas').boundingBox();assert.ok(label.x>=canvas.x&&label.x+label.width<=canvas.x+canvas.width);
 }
 assert.match(await page.locator('#fitting-action-help').textContent(),/轨道任意节点/);
 if(process.env.FITTING_NODE_OVERVIEW){await click(initial.paths[1].nodes[2]);await page.locator('#fitting-guide-minimize').click();await page.screenshot({path:process.env.FITTING_NODE_OVERVIEW});}
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('target node clicks tolerate jitter and double clicks while dragging still edits with undo',async t=>{
 const {page,click,screen,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 const p=await screen(initial.paths[1].nodes[1]);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+2,p.y+1);await page.mouse.up();assert.ok(G.dist(await alignmentPoint(page),initial.paths[1].nodes[1])<.01);assert.deepEqual((await save()).paths,initial.paths);
 await page.mouse.dblclick(p.x,p.y);assert.deepEqual((await save()).paths,initial.paths);
 const from=await screen(initial.paths[1].nodes[2]),to=await screen({x:970,y:260});await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();
 assert.ok(G.dist((await save()).paths[1].nodes[2],{x:970,y:260})<.05);assert.ok(G.dist(await alignmentPoint(page),initial.paths[1].nodes[1])<.01);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('locked target nodes choose starts but never move and other tools remain usable',async t=>{
 const doc=targetNodesFixture();doc.layers[1].locked=true;const {page,click,screen,initial,save,errors}=await setup(t,{doc});await startTargetNodes(page,click);
 await click(initial.paths[1].nodes[1]);assert.ok(G.dist(await alignmentPoint(page),initial.paths[1].nodes[1])<.01);
 const p=await screen(initial.paths[1].nodes[2]);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+25,p.y+15,{steps:5});await page.mouse.up();assert.ok(G.dist(await alignmentPoint(page),initial.paths[1].nodes[1])<.01);assert.deepEqual((await save()).paths,initial.paths);
 await page.keyboard.press('b');assert.equal(await page.locator('[data-fit-target-node]').count(),0);await page.keyboard.press('F10');assert.equal(await page.locator('[data-fit-target-node]').count(),5);
 await page.locator('#fitting-edit').click();await click(initial.paths[1].nodes[3]);assert.ok(G.dist(await alignmentPoint(page),initial.paths[1].nodes[3])<.01);
 await page.locator('#fitting-adjust').click();assert.equal(await page.locator('[data-fit-target-node]').count(),0);await page.locator('#fitting-adjust').click();await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('closed target node starts cross zero and preserve direction and exact source length',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture(true)});await startTargetNodes(page,click);
 await click(initial.paths[1].nodes[4]);assert.ok(G.dist(await alignmentPoint(page),initial.paths[1].nodes[4])<.01);assert.ok(Math.abs(await page.locator('[data-fit-fixed-seam]').evaluate(e=>e.getTotalLength())-200)<.02);
 await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-reverse-target').click();await click(initial.paths[1].nodes[0]);assert.ok(G.dist(await alignmentPoint(page),initial.paths[1].nodes[0])<.01);assert.ok(Math.abs(await page.locator('[data-fit-fixed-seam]').evaluate(e=>e.getTotalLength())-200)<.02);
 assert.equal(await page.locator('[data-fit-target-start-end="1"]').getAttribute('aria-pressed'),'true');await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('failed target node reanchoring restores preview offset and continuation history',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);await page.locator('#fitting-continue').click();await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-offset').evaluate(e=>{e.value=20;e.dispatchEvent(new Event('input',{bubbles:true}));});
 const before=await page.locator('[data-fit-joined-seam]').getAttribute('d'),start=await alignmentPoint(page);
 await page.evaluate(()=>{window.nodeStartCreate=CurveBend.create;CurveBend.create=()=>{throw Error('node start failure');};});await click(initial.paths[1].nodes[2]);assert.match(await page.locator('#fitting-feedback').textContent(),/保留上一次起点/);assert.deepEqual(await alignmentPoint(page),start);assert.equal(await page.locator('[data-fit-joined-seam]').getAttribute('d'),before);assert.equal(await page.locator('#fitting-offset').inputValue(),'20');assert.equal(await page.locator('#fitting-back').isEnabled(),true);
 await page.evaluate(()=>{CurveBend.create=nodeStartCreate;});await click(initial.paths[1].nodes[2]);assert.equal(await page.locator('#fitting-back').isEnabled(),false);await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('first target click and protected notch inner nodes use the mouth seam position',async t=>{
 const doc=targetNodesFixture();doc.paths[1].nodes=[[550,140],[700,140],[710,165],[720,140],[1050,140]].map(p=>G.node(...p));for(const i of [1,2,3])doc.paths[1].nodes[i].notchId='target-notch';
 const {page,click,initial,save,errors}=await setup(t,{doc});await click({x:150,y:180});await page.locator('#handles .anchor[data-path="live-source"][data-node="2"]').click({modifiers:['Shift']});await page.keyboard.press('n');await click(initial.paths[1].nodes[2]);await page.locator('#fitting-panel[data-phase="ready"]').waitFor();assert.ok(G.dist(await alignmentPoint(page),{x:710,y:140})<.01);
 for(const i of [1,2,3,4]){await click(initial.paths[1].nodes[i]);assert.ok(G.dist(await alignmentPoint(page),{x:initial.paths[1].nodes[i].x,y:140})<.01);assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');}
 if(process.env.FITTING_NODE_SCREENSHOT){await page.locator('#fitting-guide-minimize').click();await page.screenshot({path:process.env.FITTING_NODE_SCREENSHOT});}
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('adjusting source range keeps an arbitrary reversed target node fixed on open and closed tracks',async t=>{
 for(const closed of [false,true]){
  const {page,click,screen,initial,save,errors}=await setup(t,{doc:targetNodesFixture(closed)});await startTargetNodes(page,click);
  if(closed){await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-reverse-target').click();}
  const node=initial.paths[1].nodes[closed?0:4];await click(node);assert.ok(G.dist(await alignmentPoint(page),node)<.01);
  await page.locator('#fitting-adjust').click();const b=await page.locator('[data-fit-range="source"][data-fit-end="1"]').boundingBox(),to=await screen({x:350,y:180});await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();await page.locator('#fitting-adjust').click();
  assert.ok(G.dist(await alignmentPoint(page),node)<.01);assert.match(await page.locator('#fitting-lengths').textContent(),/250\.00 mm/);await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
 }
});

async function sourceBoundary(page,end){return page.locator(`[data-fit-start-end][aria-pressed="${end==='start'?'true':'false'}"]`).evaluate(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))}));}
async function assertRigidNotch(page,id,path,indices){
 const numbers=d=>d.match(/-?\d+(?:\.\d+)?/g).map(Number),before=numbers(G.pathD({closed:false,nodes:indices.map(i=>path.nodes[i])})),after=numbers(await page.locator(`[data-fit-inline-notch="${id}"]`).getAttribute('d'));
 assert.equal(after.length,before.length);
 for(let i=0;i<before.length;i+=2)for(let j=i+2;j<before.length;j+=2)assert.ok(Math.abs(Math.hypot(before[i]-before[j],before[i+1]-before[j+1])-Math.hypot(after[i]-after[j],after[i+1]-after[j+1]))<.001,'notch nodes and handles must move rigidly');
}
test('notch tip boundaries count only the seam and display the entire rigid notch',async t=>{
 const doc=inlineNotchFixture();for(const i of [1,2,3])doc.paths[0].nodes[i].notchId='source-notch';
 const {page,click,screen,initial,save,errors}=await setup(t,{doc});await click({x:150,y:180});await marquee(page,screen,{x:85,y:160},{x:415,y:210});await page.keyboard.press('n');await click(initial.paths[0].nodes[2]);await click(G.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.5));
 assert.match(await page.locator('#fitting-lengths').textContent(),/190\.00 mm/);assert.ok(G.dist(await sourceBoundary(page,'start'),{x:210,y:180})<.01);await assertRigidNotch(page,'source-notch',initial.paths[0],[1,2,3]);
 // The projected start ring must not take clicks intended for a nearby mouth node.
 await page.locator('#fitting-edit').click();await click(initial.paths[0].nodes[1]);assert.ok(G.dist(await sourceBoundary(page,'start'),{x:200,y:180})<.01);await page.locator('#fitting-edit').click();
 await click(initial.paths[0].nodes[0]);await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[2]);assert.match(await page.locator('#fitting-lengths').textContent(),/110\.00 mm/);await assertRigidNotch(page,'source-notch',initial.paths[0],[1,2,3]);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('zero width notch tips select a usable seam and preserve the entire slit',async t=>{
 const doc=inlineNotchFixture();doc.paths[0].nodes[3]=G.node(200,180);doc.paths[0].nodes[2]=G.node(200,195);for(const i of [1,2,3])doc.paths[0].nodes[i].notchId='slit';
 const {page,click,initial,save,errors}=await setup(t,{doc});await page.locator('#deselect').click();await page.keyboard.press('n');await click(initial.paths[0].nodes[2]);await click(G.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.5));
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);assert.ok(G.dist(await sourceBoundary(page,'start'),{x:200,y:180})<.01);await assertRigidNotch(page,'slit',initial.paths[0],[1,2,3]);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('2hao simplified production copy fits tip to seam with rigid boundary notches and unchanged originals',fixtureOptions('fitting-2hao-notch-seam.json'),async t=>{
 const fixture=structuredClone(require('./fixtures/fitting-2hao-notch-seam.json')),N=require('../../tools/curve-editor/notches.js'),W=require('../../tools/curve-editor/walk.js'),F=require('../../tools/curve-editor/fitting.js');
 const source=fixture.paths.find(p=>p.name.includes('肚皮')),target=fixture.paths.find(p=>p.name.includes('大身'));
 const doc={paths:[source,target],calibration:fixture.calibration,layers:[{id:'piece',name:'肚皮 · 验证副本',visible:true,locked:false,pathIds:[source.id],imageIds:[],textIds:[]},{id:'fixed',name:'大身 · 验证副本',visible:true,locked:false,pathIds:[target.id],imageIds:[],textIds:[]}]};
 const {page,click,screen,initial,save,errors}=await setup(t,{doc});await page.locator('#fit').click();const center=await screen({x:90,y:380});await page.mouse.move(center.x,center.y);await page.mouse.wheel(0,-700);await page.waitForFunction(()=>parseFloat(document.getElementById('zoom').textContent)>250);await page.locator('.layer-row[data-layer="piece"] .layer-select').click();await page.keyboard.press('n');await click(source.nodes[11]);await page.locator('#fitting-source-end').click();await click(source.nodes[14]);await click(target.nodes[21]);await click(target.nodes[21]);
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');
 const sb=N.baseline(G,source),tb=N.baseline(G,target),scale=fixture.calibration.length/G.dist(fixture.calibration.a,fixture.calibration.b),length=W.track(F.cut(G,sb,{index:11,t:0},{index:14,t:0})).length*scale;
 assert.equal(await page.locator('[data-fit-source-range]').getAttribute('d'),G.pathD(F.cut(G,sb,{index:11,t:0},{index:14,t:0})));assert.equal(await page.locator('[data-fit-target-route]').getAttribute('d'),G.pathD(tb));
 assert.ok(G.dist(await sourceBoundary(page,'start'),sb.nodes[11])<.001,JSON.stringify({actual:await sourceBoundary(page,'start'),expected:sb.nodes[11],feedback:await page.locator('#fitting-feedback').textContent(),length:await page.locator('#fitting-lengths').textContent()}));assert.ok(G.dist(await sourceBoundary(page,'end'),sb.nodes[14])<.001);assert.ok(G.dist(await alignmentPoint(page),tb.nodes[21])<.001,JSON.stringify({alignment:await alignmentPoint(page),expected:tb.nodes[21],start:await targetBoundary(page,'start'),end:await targetBoundary(page,'end')}));assert.ok((await page.locator('#fitting-lengths').textContent()).includes(length.toFixed(2)+' mm'));
 for(const g of N.groups(source).filter(g=>g.indices.includes(11)||g.indices.includes(14)))await assertRigidNotch(page,g.id,source,g.indices);
 await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-reverse-source').click();assert.ok(G.dist(await sourceBoundary(page,'start'),sb.nodes[14])<.001);assert.ok((await page.locator('#fitting-lengths').textContent()).includes(length.toFixed(2)+' mm'));
 for(const g of N.groups(source).filter(g=>g.indices.includes(11)||g.indices.includes(14)))await assertRigidNotch(page,g.id,source,g.indices);
 if(process.env.FITTING_2HAO_SCREENSHOT){await page.locator('#fitting-guide-minimize').click();await page.keyboard.down('Control');await page.mouse.move(800,450);await page.mouse.down();await page.mouse.move(1070,450,{steps:5});await page.mouse.up();await page.keyboard.up('Control');await page.screenshot({path:process.env.FITTING_2HAO_SCREENSHOT});}
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('source arbitrary nodes set both endpoints before and after target selection with fixed target origin',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await click({x:150,y:180});await page.locator('#handles .anchor[data-path="live-source"][data-node="2"]').click({modifiers:['Shift']});await page.keyboard.press('n');
 assert.equal(await page.locator('[data-fit-source-node]').count(),4);await click(initial.paths[0].nodes[1]);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[1])<.01);
 await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[3]);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[3])<.01);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');
 await click(initial.paths[1].nodes[0]);await click(initial.paths[1].nodes.at(-1));const origin=await alignmentPoint(page);assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);
 await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-offset').evaluate(e=>{e.value=15;e.dispatchEvent(new Event('input',{bubbles:true}));});const aligned=await alignmentPoint(page);
 await page.locator('#fitting-source-start').click();await click(initial.paths[0].nodes[0]);assert.match(await page.locator('#fitting-lengths').textContent(),/300\.00 mm/);assert.ok(G.dist(await alignmentPoint(page),aligned)<.01);assert.equal(await page.locator('#fitting-offset').inputValue(),'15');
 await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[2]);assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[0])<.01);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[2])<.01);
 assert.match(await page.locator('[data-fit-direction-label="source-end"]').textContent(),/拟合终点/);assert.equal(await page.locator('[data-fit-direction="source"]').count()>0,true);if(process.env.FITTING_SOURCE_SCREENSHOT){await page.locator('#fitting-guide-minimize').click();await page.screenshot({path:process.env.FITTING_SOURCE_SCREENSHOT});}await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('source node start and end keep open direction clear and reject a zero length end',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 await click(initial.paths[0].nodes[3]);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[3])<.01);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[2])<.01);assert.equal(await page.locator('[data-fit-start-end="1"]').getAttribute('aria-pressed'),'true');
 await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[0]);assert.match(await page.locator('#fitting-lengths').textContent(),/300\.00 mm/);
 const preview=await page.locator('[data-fit-joined-seam]').getAttribute('d');await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[3]);assert.match(await page.locator('#fitting-feedback').textContent(),/不同节点/);assert.equal(await page.locator('[data-fit-joined-seam]').getAttribute('d'),preview);
 await page.locator('#fitting-source-start').click();await click(initial.paths[0].nodes[0]);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[0])<.01);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[3])<.01);await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('quick popup switching sides keeps both clicked endpoints fixed',async t=>{
 const doc=targetNodesFixture();doc.paths[0].nodes=[[100,180],[300,180],[300,380],[100,380]].map(p=>G.node(...p));doc.paths[0].closed=true;
 const {page,click,initial,save,errors}=await setup(t,{doc});await click({x:150,y:180});await page.keyboard.press('n');await click(initial.paths[0].nodes[3]);await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[0]);await click(initial.paths[1].nodes[0]);await click(initial.paths[1].nodes.at(-1));
 const origin=await alignmentPoint(page),range=await page.locator('[data-fit-source-range]').getAttribute('d');assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);
 await page.locator('#fitting-guide-source-other-side').click();assert.match(await page.locator('#fitting-lengths').textContent(),/600\.00 mm/);assert.notEqual(await page.locator('[data-fit-source-range]').getAttribute('d'),range);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[3])<.01);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[0])<.01);assert.deepEqual(await alignmentPoint(page),origin);
 await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[3]);assert.match(await page.locator('#fitting-lengths').textContent(),/800\.00 mm/);await page.locator('#fitting-source-other-side').click();assert.match(await page.locator('#fitting-lengths').textContent(),/800\.00 mm/);assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('source node picking tolerates jitter, preserves native dragging and can return to ordinary node selection',async t=>{
 const {page,click,screen,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 const p=await screen(initial.paths[0].nodes[1]);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+2,p.y+1);await page.mouse.up();assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[1])<.01);assert.deepEqual((await save()).paths,initial.paths);
 await page.mouse.dblclick(p.x,p.y);assert.deepEqual((await save()).paths,initial.paths);
 const a=await screen(initial.paths[0].nodes[3]),b=await screen({x:420,y:195});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();assert.ok(G.dist((await save()).paths[0].nodes[3],{x:420,y:195})<.05);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[1])<.01);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('#fitting-source-none').click();assert.equal(await page.locator('[data-fit-source-node]').count(),0);await click(initial.paths[0].nodes[0]);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[1])<.01);await page.keyboard.press('b');await page.keyboard.press('F10');await page.locator('#fitting-source-start').click();assert.equal(await page.locator('[data-fit-source-node]').count(),4);await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('failed source endpoint changes restore both ends, target offset, preview and continuation history',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);await page.locator('#fitting-continue').click();await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-offset').evaluate(e=>{e.value=15;e.dispatchEvent(new Event('input',{bubbles:true}));});
 const ends=[await sourceBoundary(page,'start'),await sourceBoundary(page,'end')],preview=await page.locator('[data-fit-joined-seam]').getAttribute('d');
 await page.evaluate(()=>{window.sourceRangeCreate=CurveBend.create;CurveBend.create=()=>{throw Error('source range failure');};});await click(initial.paths[0].nodes[1]);assert.match(await page.locator('#fitting-feedback').textContent(),/保留上一次起终点/);assert.deepEqual([await sourceBoundary(page,'start'),await sourceBoundary(page,'end')],ends);assert.equal(await page.locator('[data-fit-joined-seam]').getAttribute('d'),preview);assert.equal(await page.locator('#fitting-offset').inputValue(),'15');assert.equal(await page.locator('#fitting-back').isEnabled(),true);
 await page.evaluate(()=>{CurveBend.create=sourceRangeCreate;});await click(initial.paths[0].nodes[1]);assert.equal(await page.locator('#fitting-back').isEnabled(),false);await page.locator('#fitting-continue').click();assert.match(await page.locator('#fitting-feedback').textContent(),/到头/);await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('source notch inner endpoints use mouth stations without changing protected document geometry',async t=>{
 const doc=inlineNotchFixture();for(const i of [1,2,3])doc.paths[0].nodes[i].notchId='source-notch';
 const {page,click,screen,initial,save,errors}=await setup(t,{doc});await click({x:150,y:180});await marquee(page,screen,{x:85,y:160},{x:415,y:210});await page.keyboard.press('n');await click(initial.paths[0].nodes[2]);assert.ok(G.dist(await sourceBoundary(page,'start'),{x:210,y:180})<.01);await click(G.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.5));
 const preview=page.locator('[data-fit-joined-seam]');assert.ok(G.dist(await preview.evaluate(e=>{const p=e.getPointAtLength(0);return {x:p.x,y:p.y};}),await alignmentPoint(page))<.02);assert.equal(await page.locator('[data-fit-inline-notch="source-notch"]').count(),1);
 await click(initial.paths[0].nodes[0]);await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[2]);assert.ok(G.dist(await sourceBoundary(page,'end'),{x:210,y:180})<.01);assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('source chosen endpoints survive continuation backtracking and fitted edit topology protection',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);await click(initial.paths[0].nodes[1]);const origin=await alignmentPoint(page);await page.locator('#fitting-continue').click();assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[1])<.01);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[3])<.01);await page.locator('#fitting-back').click();assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[2])<.01);assert.deepEqual(await alignmentPoint(page),origin);
 await page.locator('#fitting-edit').click();const preview=page.locator('[data-fit-path="live-source"]');const p=await preview.evaluate(e=>{const q=e.getPointAtLength(e.getTotalLength()*.55),r=new DOMPoint(q.x,q.y).matrixTransform(e.getScreenCTM());return {x:r.x,y:r.y};});await page.mouse.dblclick(p.x,p.y);assert.equal(await page.locator('#fitting-source-start').isDisabled(),true);assert.equal(await page.locator('#fitting-source-end').isDisabled(),true);assert.equal(await page.locator('[data-fit-source-node]').count(),0);await page.locator('#fitting-unbend').click();assert.equal((await save()).paths[0].nodes.length,5);assert.deepEqual(errors,[]);
});

async function startBoundaryNotch(t){
 const doc=inlineNotchFixture();for(const i of [1,2,3])doc.paths[0].nodes[i].notchId='source-notch';
 const fixture=await setup(t,{doc}),{page,click,screen,initial}=fixture;
 await click({x:150,y:180});await marquee(page,screen,{x:85,y:160},{x:415,y:210});await page.keyboard.press('n');await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[2]);await click(initial.paths[1].nodes[0]);await click(initial.paths[1].nodes[1]);return fixture;
}
test('source boundary notch protection follows continuation, history and dragged range',async t=>{
 const {page,click,screen,initial,save,errors}=await startBoundaryNotch(t),notch=page.locator('[data-fit-inline-notch="source-notch"]');assert.equal(await notch.count(),1);
 await page.locator('#fitting-continue').click();assert.equal(await notch.count(),1);assert.match(await page.locator('#fitting-lengths').textContent(),/120\.00 mm/);
 await page.locator('#fitting-back').click();assert.equal(await notch.count(),1);assert.ok(G.dist(await sourceBoundary(page,'end'),{x:210,y:180})<.01);await page.locator('#redo').click();assert.equal(await notch.count(),1);
 await page.locator('#fitting-back').click();await page.locator('#fitting-adjust').click();const b=await page.locator('[data-fit-range="source"][data-fit-end="1"]').boundingBox(),to=await screen({x:300,y:180});await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();await page.locator('#fitting-adjust').click();assert.equal(await notch.count(),1);assert.match(await page.locator('#fitting-lengths').textContent(),/200\.00 mm/);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('source boundary notch contour refuses fitted double click node insertion',async t=>{
 const {page,initial,save,errors}=await startBoundaryNotch(t);await page.locator('#fitting-edit').click();
 const p=await page.locator('[data-fit-inline-notch="source-notch"]').evaluate(e=>{const q=e.getPointAtLength(e.getTotalLength()*.4),r=new DOMPoint(q.x,q.y).matrixTransform(e.getScreenCTM());return {x:r.x,y:r.y};});await page.mouse.dblclick(p.x,p.y);assert.match(await page.locator('#fitting-feedback').textContent(),/剪口.*展开/);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('source boundary notch continuation uses restored seam length on a short target',async t=>{
 const doc=inlineNotchFixture();for(const i of [1,2,3])doc.paths[0].nodes[i].notchId='source-notch';doc.paths[1].nodes=[[550,150],[670,150]].map(p=>G.node(...p));
 const {page,click,screen,initial,save,errors}=await setup(t,{doc});await click({x:150,y:180});await marquee(page,screen,{x:85,y:160},{x:415,y:210});await page.keyboard.press('n');await page.locator('#fitting-source-end').click();await click(initial.paths[0].nodes[2]);await click(initial.paths[1].nodes[0]);await click(initial.paths[1].nodes[1]);await page.locator('#fitting-continue').click();assert.equal(await page.locator('[data-fit-inline-notch="source-notch"]').count(),1);assert.match(await page.locator('#fitting-lengths').textContent(),/120\.00 mm/);assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('source boundary notch endpoint and history survive original node insertion and undo',async t=>{
 const {page,click,screen,initial,save,errors}=await startBoundaryNotch(t),notch=page.locator('[data-fit-inline-notch="source-notch"]');
 await page.locator('#fitting-continue').click();assert.equal(await notch.count(),1);await page.locator('#fitting-source-none').click();const p=await screen({x:150,y:180});await page.mouse.dblclick(p.x,p.y);assert.equal((await save()).paths[0].nodes.length,8);assert.equal(await notch.count(),1);
 await page.locator('#fitting-back').click();assert.equal(await notch.count(),1);assert.ok(G.dist(await sourceBoundary(page,'end'),{x:210,y:180})<.01);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await notch.count(),1);assert.ok(G.dist(await sourceBoundary(page,'end'),{x:210,y:180})<.01);await page.locator('#fitting-unbend').click();assert.deepEqual(errors,[]);
});

async function targetBoundary(page,end){return page.locator(`[data-fit-target-start-end][aria-pressed="${end==='start'?'true':'false'}"]`).evaluate(e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))}));}
test('floating fitting controls choose all four endpoints and preserve an explicit target end',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 await page.locator('#fitting-guide-source-start').click();await click(initial.paths[0].nodes[1]);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[1])<.01);
 await page.locator('#fitting-guide-source-end').click();await click(initial.paths[0].nodes[3]);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[3])<.01);
 await page.locator('#fitting-guide-target-start').click();await click(initial.paths[1].nodes[1]);assert.ok(G.dist(await targetBoundary(page,'start'),initial.paths[1].nodes[1])<.01);
 await page.locator('#fitting-guide-target-end').click();await click(initial.paths[1].nodes[3]);assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[3])<.01);
 await page.locator('#fitting-guide-source-start').click();await click(initial.paths[0].nodes[0]);assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[3])<.01);
 await page.locator('#fitting-guide-target-start').click();await click(initial.paths[1].nodes[2]);assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[3])<.01);assert.equal(await page.locator('#fitting-guide-target-start').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#fitting-guide-target-end').getAttribute('aria-pressed'),'true');
 await page.locator('#fitting-guide-target-end').click();await click(initial.paths[1].nodes[2]);assert.match(await page.locator('#fitting-feedback').textContent(),/不同节点/);assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[3])<.01);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('visibility toggle hides the fitted source and its hit targets while originals and target stay visible',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 const shown=locator=>locator.evaluate(e=>{for(let n=e;n;n=n.parentElement)if(getComputedStyle(n).display==='none'||getComputedStyle(n).visibility==='hidden')return false;return true;});
 const original=page.locator('[data-fit-original="live-source"]'),target=page.locator('[data-fit-fixed-seam]'),preview=page.locator('[data-fit-joined-seam]'),before=await preview.getAttribute('d');
 await page.locator('#fitting-guide-original').click();assert.equal(await shown(original),true);assert.equal(await shown(target),true);assert.equal(await shown(preview),false);assert.equal(await page.locator('[data-fit-path="live-source"]').isVisible(),false);assert.equal(await page.locator('[data-fit-offset]').isVisible(),false);assert.match(await page.locator('#fitting-guide-original').textContent(),/显示拟合曲线/);
 await page.locator('#fitting-guide-source-end').click();assert.equal(await shown(preview),false);assert.equal(await shown(original),true);
 await page.locator('#fitting-original').click();assert.equal(await shown(preview),true);assert.equal(await preview.getAttribute('d'),before);
 await page.locator('#fitting-guide-original').click();await page.locator('#fitting-edit').click();assert.equal(await shown(preview),true);await page.locator('#fitting-guide-original').click();assert.equal(await shown(preview),false);assert.equal(await shown(page.locator('#paths .hit-line[data-path="live-source"]')),true);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('compact fitting markers retain generous hit targets and readable endpoint labels',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 const sizes=await page.locator('[data-fit-end-symbol]').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return Math.max(b.width,b.height);}));assert.equal(sizes.length,4);assert.ok(sizes.every(s=>s<=12),JSON.stringify(sizes));
 const hit=await page.locator('[data-fit-start-end="1"]').boundingBox();assert.ok(hit.width>=18);await pickFitStart(page,1);assert.equal(await page.locator('[data-fit-start-end="1"]').getAttribute('aria-pressed'),'true');
 await page.locator('#fitting-guide-source-start').click();await click(initial.paths[0].nodes[1]);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[1])<.01);assert.equal(await page.locator('[data-fit-direction-label="source-end"]').isVisible(),true);
 if(process.env.FITTING_CONTROLS_SCREENSHOT)await page.screenshot({path:process.env.FITTING_CONTROLS_SCREENSHOT});await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('compact fractional endpoint centers are clickable without blocking native node dragging',async t=>{
 const {page,click,screen,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);await page.locator('#fitting-guide-source-end').click();await click(initial.paths[0].nodes[3]);
 const end=await targetBoundary(page,'end');assert.ok(!initial.paths[1].nodes.some(n=>G.dist(n,end)<.01));await click(end);assert.ok(G.dist(await targetBoundary(page,'start'),end)<.01);
 await page.locator('#fitting-adjust').click();const b=await page.locator('[data-fit-range="source"][data-fit-end="1"]').boundingBox(),q=await screen({x:350,y:180});await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(q.x,q.y,{steps:5});await page.mouse.up();await page.locator('#fitting-adjust').click();await click({x:350,y:180});assert.ok(G.dist(await sourceBoundary(page,'start'),{x:350,y:180})<.02);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('explicit target end keeps closed wrapping and original edits stable',async t=>{
 const {page,click,screen,initial,save,errors}=await setup(t,{doc:targetNodesFixture(true)});await startTargetNodes(page,click);
 await page.locator('#fitting-guide-target-start').click();await click(initial.paths[1].nodes[4]);await page.locator('#fitting-guide-target-end').click();await click(initial.paths[1].nodes[1]);assert.ok(G.dist(await targetBoundary(page,'start'),initial.paths[1].nodes[4])<.01);assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[1])<.01);
 await page.locator('#fitting-source-none').click();const a=await screen(initial.paths[0].nodes[1]),b=await screen({x:200,y:160});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[1])<.01);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('#fitting-continue').click();assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[1])<.01);await page.locator('#fitting-back').click();assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[1])<.01);await page.locator('#fitting-guide-target-end').click();await click(initial.paths[1].nodes[4]);assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('fitting guide drags by its title, preserves buttons and remembers position without editing artwork',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 const guide=page.locator('#fitting-guide'),bar=page.locator('.fitting-guide-bar'),before=await guide.boundingBox(),b=await bar.boundingBox(),preview=await page.locator('[data-fit-joined-seam]').getAttribute('d');
 await page.mouse.move(b.x+100,b.y+12);await page.mouse.down();await page.mouse.move(b.x+20,b.y+212,{steps:6});await page.mouse.up();const moved=await guide.boundingBox();assert.ok(Math.abs(moved.x-before.x+80)<2);assert.ok(Math.abs(moved.y-before.y-200)<2);assert.equal(await page.locator('[data-fit-joined-seam]').getAttribute('d'),preview);
 await page.locator('#fitting-guide-source-end').click();assert.equal(await page.locator('#fitting-guide-source-end').getAttribute('aria-pressed'),'true');assert.deepEqual(await guide.boundingBox(),moved);
 await page.locator('#fitting-guide-minimize').click();await page.locator('#fitting-guide-expand').click();assert.deepEqual(await guide.boundingBox(),moved);
 await page.locator('#fitting-guide-minimize').click();await page.locator('#fitting-guide-show').click();assert.deepEqual(await guide.boundingBox(),moved);await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.reload();await page.locator('.layer-row[data-layer="piece"]').waitFor();await startTargetNodes(page,click);const restored=await guide.boundingBox();assert.ok(Math.abs(restored.x-moved.x)<2&&Math.abs(restored.y-moved.y)<2);await page.locator('#fitting-unbend').click();assert.deepEqual(errors,[]);
});
test('fitting guide drag stays inside the canvas, cancels safely and adapts to a smaller window',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 const guide=page.locator('#fitting-guide'),bar=page.locator('.fitting-guide-bar'),before=await guide.boundingBox();let b=await bar.boundingBox();
 await page.mouse.move(b.x+100,b.y+12);await page.mouse.down();await page.mouse.move(b.x+200,b.y+150,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await guide.boundingBox(),before);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');
 b=await bar.boundingBox();await page.mouse.move(b.x+100,b.y+12);await page.mouse.down();await page.mouse.move(1490,990,{steps:4});await page.mouse.up();
 const contained=async()=>{const g=await guide.boundingBox(),c=await page.locator('#canvas').boundingBox();assert.ok(g.x>=c.x&&g.y>=c.y&&g.x+g.width<=c.x+c.width+1&&g.y+g.height<=c.y+c.height+1,JSON.stringify({g,c}));};await contained();
 await page.setViewportSize({width:1000,height:700});await page.waitForTimeout(100);await contained();await page.locator('#fitting-guide-original').click();assert.equal(await page.locator('#fitting-guide-original').getAttribute('aria-pressed'),'false');await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('notch fitting highlights follow the straight mouth baseline before and after fitting',async t=>{
 const doc=inlineNotchFixture(),N=require('../../tools/curve-editor/notches.js'),F=require('../../tools/curve-editor/fitting.js');for(const i of [1,2,3])doc.paths[0].nodes[i].notchId='source-notch';
 const {page,click,screen,initial,save,errors}=await setup(t,{doc});await click({x:150,y:180});await marquee(page,screen,{x:85,y:160},{x:415,y:210});await page.keyboard.press('n');
 const baseline=N.baseline(G,initial.paths[0]),expected=G.pathD(F.cut(G,baseline,{index:0,t:0},{index:3,t:1}));
 assert.equal(await page.locator('[data-fit-source-range]').getAttribute('d'),expected);
 assert.equal(await page.locator('[data-fit-seam-highlight="source"]').getAttribute('d'),expected);
 assert.equal(await page.locator('[data-fit-original="source"]').getAttribute('d'),G.pathD(initial.paths[0]),'original V outline remains available');
 if(process.env.FITTING_BASELINE_SCREENSHOT)await page.screenshot({path:process.env.FITTING_BASELINE_SCREENSHOT});
 await click(G.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.5));
 assert.equal(await page.locator('[data-fit-source-range]').getAttribute('d'),expected);await assertRigidNotch(page,'source-notch',initial.paths[0],[1,2,3]);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('quick controls open immediately on every fitting entry even without a source',async t=>{
 const {page,errors}=await setup(t);await page.locator('#deselect').click();
 for(const dismiss of ['#fitting-guide-minimize']){
  await page.locator('#fit-curves').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'source');assert.equal(await page.locator('#fitting-guide-actions').isVisible(),true);assert.equal(await page.locator('#fitting-guide-content').isVisible(),true);assert.equal(await page.locator('#fitting-guide-source-start').isDisabled(),false);assert.equal(await page.locator('#fitting-guide-target-start').isDisabled(),false);assert.match(await page.locator('#fitting-guide-pick-hint').textContent(),/原.*起点/);
  await page.locator(dismiss).click();await page.locator('#fitting-exit').click();
 }
 await page.locator('#fit-curves').click();assert.equal(await page.locator('#fitting-guide-content').isVisible(),true);assert.deepEqual(errors,[]);
});
test('target other side preserves endpoints and origin, uses its own row and survives source range edits',async t=>{
 const doc=targetNodesFixture(true);doc.paths[0].closed=true;
 const {page,click,initial,save,errors}=await setup(t,{doc});await startTargetNodes(page,click);
 const first=await targetBoundary(page,'start'),last=await targetBoundary(page,'end'),origin=await alignmentPoint(page),track=await page.locator('[data-fit-fixed-seam]').getAttribute('d');
 for(const kind of ['source','target']){const side=await page.locator('#fitting-guide-'+kind+'-other-side').boundingBox(),end=await page.locator('#fitting-guide-'+kind+'-end').boundingBox();assert.ok(side.y>=end.y+end.height,kind+' side button needs a separate row');}
 await page.locator('#fitting-guide-target-other-side').click();assert.equal(await page.locator('#fitting-panel').getAttribute('data-preview'),'ok');assert.deepEqual(await targetBoundary(page,'start'),first);assert.deepEqual(await targetBoundary(page,'end'),last);assert.deepEqual(await alignmentPoint(page),origin);assert.notEqual(await page.locator('[data-fit-fixed-seam]').getAttribute('d'),track);
 await page.locator('#fitting-target-other-side').click();assert.equal(await page.locator('[data-fit-fixed-seam]').getAttribute('d'),track);
 await page.locator('#fitting-guide-target-end').click();await click(initial.paths[1].nodes[3]);const pinned=await targetBoundary(page,'end');await page.locator('#fitting-guide-target-other-side').click();
 await page.locator('#fitting-guide-source-end').click();await click(initial.paths[0].nodes[3]);assert.deepEqual(await targetBoundary(page,'end'),pinned);assert.deepEqual(await targetBoundary(page,'start'),first);
 if(process.env.FITTING_QUICK_SCREENSHOT)await page.screenshot({path:process.env.FITTING_QUICK_SCREENSHOT});
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('four endpoint buttons pick curves directly without any prior selection',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture(true)});await page.locator('#deselect').click();await page.keyboard.press('n');
 const pick=async(kind,end,index)=>{await page.locator('#fitting-guide-'+kind+'-'+end).click();await click(initial.paths[kind==='source'?0:1].nodes[index]);};
 await pick('source','start',1);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'source');assert.equal(await page.locator('[data-fit-pending="source-start"]').count(),1);
 await pick('source','end',3);assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[1])<.01);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[3])<.01);
 await pick('target','start',4);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');await pick('target','end',1);
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.ok(G.dist(await targetBoundary(page,'start'),initial.paths[1].nodes[4])<.01);assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[1])<.01);
 if(process.env.FITTING_DIRECT_SCREENSHOT)await page.screenshot({path:process.env.FITTING_DIRECT_SCREENSHOT});
 await page.locator('#fitting-guide-target-other-side').click();assert.ok(G.dist(await targetBoundary(page,'start'),initial.paths[1].nodes[4])<.01);assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[1])<.01);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('direct endpoints accept target first and end first, reject mixed curves and repeated open endpoints',async t=>{
 const doc=targetNodesFixture();doc.layers[1].locked=true;doc.layers[1].pathIds=['live-target'];doc.layers[0].pathIds.push('other');
 const {page,click,initial,save,errors}=await setup(t,{doc});await page.locator('#deselect').click();await page.keyboard.press('n');
 await page.locator('#fitting-guide-target-end').click();await click(initial.paths[1].nodes[1]);await page.locator('#fitting-guide-target-start').click();await click(initial.paths[1].nodes[4]);
 await page.locator('#fitting-guide-source-end').click();await click(initial.paths[0].nodes[0]);await page.locator('#fitting-guide-source-start').click();await click(initial.paths[2].nodes[0]);assert.match(await page.locator('#fitting-feedback').textContent(),/同一条/);
 await click(initial.paths[0].nodes[0]);assert.match(await page.locator('#fitting-feedback').textContent(),/不同节点/);await click(initial.paths[0].nodes[3]);
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[3])<.01);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[0])<.01);assert.ok(G.dist(await targetBoundary(page,'start'),initial.paths[1].nodes[4])<.01);assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[1])<.01);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('explicit start can replace a preselected curve without changing artwork',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await page.keyboard.press('n');
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'target');
 await page.locator('#fitting-guide-source-start').click();await click(initial.paths[2].nodes[0]);assert.equal(await page.locator('[data-fit-pending="source-start"]').count(),1);
 await page.locator('#fitting-guide-source-end').click();await click(initial.paths[2].nodes[2]);assert.equal(await page.locator('[data-fit-original="other"]').count(),1);
 await page.locator('#fitting-guide-target-end').click();await click(initial.paths[1].nodes[3]);await page.locator('#fitting-guide-target-start').click();await click(initial.paths[1].nodes[0]);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('direct target selection never previews the fixed target as an attached moving notch',async t=>{
 const {page,click,initial,save,errors}=await setup(t);await page.locator('#deselect').click();await page.keyboard.press('n');
 const pick=async(kind,end,pathIndex,node)=>{await page.locator('#fitting-guide-'+kind+'-'+end).click();await click(initial.paths[pathIndex].nodes[node]);};
 await pick('source','start',0,0);await pick('source','end',0,1);await page.locator('#fitting-guide-target-start').click();assert.equal(await page.locator('[data-fit-pick-kind="target"][data-path="notch"]').count(),0);
 await page.locator('#fitting-exit').click();await page.keyboard.press('n');
 await pick('target','start',2,0);await pick('target','end',2,1);await pick('source','start',0,0);await pick('source','end',0,1);
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.equal(await page.locator('[data-fit-path="notch"]').count(),0);assert.ok(G.dist(await targetBoundary(page,'start'),initial.paths[2].nodes[0])<.01);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('cancelling an incomplete replacement restores the ready fit and range history',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);await page.locator('#fitting-continue').click();const before=await page.locator('[data-fit-path="live-source"]').getAttribute('d');assert.equal(await page.locator('#fitting-back').isDisabled(),false);
 await page.locator('#fitting-guide-source-start').click();await click(initial.paths[2].nodes[0]);assert.equal(await page.locator('[data-fit-pending="source-start"]').count(),1);await page.keyboard.press('Escape');
 assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');assert.equal(await page.locator('[data-fit-path="live-source"]').getAttribute('d'),before);assert.equal(await page.locator('#fitting-back').isDisabled(),false);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('endpoint workflow automatically advances through four clicks and keeps invalid picks on the same step',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture(true)});await page.locator('#deselect').click();await page.keyboard.press('n');await page.locator('#fitting-guide-source-start').click();
 const active=async(kind,end)=>assert.equal(await page.locator('#fitting-guide-'+kind+'-'+end).getAttribute('aria-pressed'),'true');
 await click(initial.paths[0].nodes[1]);await active('source','end');await click(initial.paths[0].nodes[1]);await active('source','end');assert.match(await page.locator('#fitting-feedback').textContent(),/不同节点/);
 await click(initial.paths[0].nodes[3]);await active('target','start');await click(initial.paths[1].nodes[4]);await active('target','end');await click(initial.paths[1].nodes[1]);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');
 assert.ok(G.dist(await sourceBoundary(page,'start'),initial.paths[0].nodes[1])<.01);assert.ok(G.dist(await sourceBoundary(page,'end'),initial.paths[0].nodes[3])<.01);assert.ok(G.dist(await targetBoundary(page,'start'),initial.paths[1].nodes[4])<.01);assert.ok(G.dist(await targetBoundary(page,'end'),initial.paths[1].nodes[1])<.01);
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('quick fitting colors offer swatches, a two dimensional field and hex input without changing artwork',async t=>{
 const {page,click,initial,save,errors}=await setup(t,{doc:targetNodesFixture()});await startTargetNodes(page,click);
 assert.equal(await page.locator('#fitting-guide-close').count(),0);
 await page.locator('#fitting-guide-source-color').click();assert.equal(await page.locator('#fitting-color-picker').isVisible(),true);
 await page.locator('[data-fitting-color="#e04544"]').click();assert.equal(await page.locator('#fitting-source-color').inputValue(),'#e04544');assert.equal(await page.locator('[data-fit-joined-seam]').getAttribute('stroke'),'#e04544');
 await page.locator('#fitting-guide-target-color').click();await page.locator('#fitting-color-hex').fill('#6c45ce');await page.locator('#fitting-color-hex').press('Enter');assert.equal(await page.locator('#fitting-target-color').inputValue(),'#6c45ce');assert.equal(await page.locator('[data-fit-fixed-seam]').getAttribute('stroke'),'#6c45ce');
 await page.locator('#fitting-color-hex').fill('invalid');await page.locator('#fitting-color-hex').press('Enter');assert.equal(await page.locator('#fitting-target-color').inputValue(),'#6c45ce');assert.equal(await page.locator('#fitting-color-hex').getAttribute('aria-invalid'),'true');
 const field=await page.locator('#fitting-color-field').boundingBox();await page.mouse.move(field.x+field.width*.2,field.y+field.height*.2);await page.mouse.down();await page.mouse.move(field.x+field.width*.7,field.y+field.height*.6,{steps:4});await page.mouse.up();const chosen=await page.locator('#fitting-target-color').inputValue();assert.notEqual(chosen,'#6c45ce');assert.equal(await page.locator('[data-fit-fixed-seam]').getAttribute('stroke'),chosen);assert.equal(await page.locator('#fitting-color-hex').getAttribute('aria-invalid'),'false');
 await page.locator('#fitting-color-field').focus();await page.keyboard.press('ArrowRight');assert.notEqual(await page.locator('#fitting-target-color').inputValue(),chosen);await page.keyboard.press('Escape');assert.equal(await page.locator('#fitting-color-picker').isVisible(),false);assert.equal(await page.locator('#fitting-panel').getAttribute('data-phase'),'ready');
 await page.locator('#fitting-guide-minimize').click();assert.equal(await page.locator('#fitting-guide').isVisible(),true);assert.equal(await page.locator('#fitting-guide-content').isVisible(),false);await page.locator('#fitting-guide-expand').click();
 if(process.env.FITTING_QUICK_COLORS_SCREENSHOT){await page.locator('#fitting-guide-source-color').click();await page.screenshot({path:process.env.FITTING_QUICK_COLORS_SCREENSHOT});}
 await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

test('fitting performance probe preserves geometry across color and offset redraws',{skip:!process.env.FITTING_PERF_REPORT||fixtureOptions('fitting-1hao.json').skip},async t=>{
 const fixture=require('./fixtures/fitting-1hao.json'),{page,initial,click,save,errors}=await setup(t,{doc:fixture}),[body,belly]=initial.paths;
 await click(G.at(body.nodes[0],body.nodes[1],.5));await page.locator(`#handles .anchor[data-path="${body.id}"][data-node="2"]`).click({modifiers:['Shift']});await page.locator('#fit-curves').click();await click(G.at(belly.nodes[9],belly.nodes[10],.5));await page.locator('.fitting-advanced > summary').click();await page.locator('#fitting-whole').check();
 const result=await page.evaluate(()=>{
  const counts={track:0,nearest:0,baseline:0,textMeasure:0},originals=[];
  for(const [object,key,counter] of [[CurveWalk,'track','track'],[CurveWalk,'nearest','nearest'],[CurveNotches,'baseline','baseline'],[SVGTextContentElement.prototype,'getComputedTextLength','textMeasure']]){const fn=object[key];originals.push(()=>object[key]=fn);object[key]=function(...args){counts[counter]++;return fn.apply(this,args);};}
  const run=(id,values)=>{for(const k in counts)counts[k]=0;const samples=[];for(const value of values){const input=document.getElementById(id),start=performance.now();input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));samples.push(performance.now()-start);}return {samples,counts:{...counts},preview:document.querySelector('[data-fit-path]').getAttribute('d')};};
  try{return {colors:run('fitting-source-color',Array.from({length:20},(_,i)=>i%2?'#176bce':'#e04544')),offsets:run('fitting-offset',Array.from({length:20},(_,i)=>String(i*2))),previewState:document.getElementById('fitting-panel').dataset.preview};}finally{for(const restore of originals)restore();}
 });
 assert.equal(result.previewState,'ok');await writeFile(process.env.FITTING_PERF_REPORT,JSON.stringify(result,null,2));await page.locator('#fitting-unbend').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
