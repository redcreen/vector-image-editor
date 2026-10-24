// Independent test artwork and browser; never modifies an open user canvas.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
async function setup(t,{closed=false,targetState='editable',decorate}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-connections-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,points)=>({id,name:id,role:'cut',color:'#e04544',closed:false,dashed:true,note:'保留弧度和样式',nodes:points.map(([x,y])=>({...G.node(x,y,'smooth'),in:{x:x-25,y:y+20},out:{x:x+25,y:y-20}}))});
 const moving=curve('moving',[[100,150],[220,100],[320,190],[350,320]]),target=curve('target',[[600,120],[700,220],[600,330]]);moving.closed=closed;
 const layers=[{id:'main',name:'来源图层',visible:true,locked:false,pathIds:['moving'],imageIds:[],textIds:[],items:[{type:'path',id:'moving'}]},{id:'other',name:'目标图层',visible:targetState!=='hidden',locked:targetState==='locked',pathIds:['target'],imageIds:[],textIds:[]}];
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:850,height:500,title:'断开连接测试',paths:[moving,target],layers,originals:[],image:null,images:[],texts:[],opacity:.65,newNodeMode:'cusp'};
 if(decorate)decorate(initial);
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(6000);
 await page.goto(url);await page.locator('#paths [data-path="moving"]').waitFor({state:'attached'});await expandLayerContents(page);await page.locator('.curve-item[data-path="moving"] .curve-select').click();
 const screen=async p=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},p);
 const move=async(p,offset=0)=>{const q=await screen(p);await page.mouse.move(q.x+offset,q.y);};
 const begin=async p=>{await move(p);await page.mouse.down();};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const split=async(index,menu=true)=>{const q=await screen(moving.nodes[index]);await page.mouse.click(q.x,q.y,{button:menu?'right':'left'});if(menu)await page.getByRole('menuitem',{name:'断开连接',exact:true}).click();else await page.locator('#break-node').click();};
 const hint=page.locator('#node-alignment [data-connection]');return {page,initial,errors,move,begin,save,split,hint};
}

test('release offers a choice and keeping coincidence preserves separate editable endpoints in one undo step',async t=>{
 const {page,initial,errors,begin,move,save}=await setup(t);
 await begin(initial.paths[0].nodes[0]);await move(initial.paths[1].nodes[0],-2);await page.mouse.up();
 const menu=page.getByRole('menu',{name:'端点重合右键菜单'});await menu.waitFor({state:'visible'});
 assert.equal(await page.locator(':focus').textContent(),'仅保持重合');
 assert.equal(await page.locator('.curve-item').count(),2,'release must not merge the paths');
 await menu.getByRole('menuitem',{name:'仅保持重合',exact:true}).click();
 const coincident=await save();assert.equal(coincident.paths.length,2);assert.deepEqual(coincident.paths[1],initial.paths[1]);
 const a=coincident.paths[0].nodes[0],b=coincident.paths[1].nodes[0];assert.equal(a.x,b.x);assert.equal(a.y,b.y);
 assert.equal(a.in.x-a.x,initial.paths[0].nodes[0].in.x-initial.paths[0].nodes[0].x);
 assert.equal(a.out.y-a.y,initial.paths[0].nodes[0].out.y-initial.paths[0].nodes[0].y);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,coincident.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await expandLayerContents(page);
 assert.deepEqual((await save()).paths,coincident.paths);
 await begin(a);await move({x:a.x-60,y:a.y-40});await page.mouse.up();const separate=await save();
 assert.deepEqual(separate.paths[1],coincident.paths[1]);assert.notEqual(separate.paths[0].nodes[0].x,b.x);assert.deepEqual(errors,[]);
});

test('release waits for explicit connection and combines movement and join into one undo step',async t=>{
 const {page,initial,errors,begin,move,save}=await setup(t);
 await begin(initial.paths[0].nodes[0]);await move(initial.paths[1].nodes[0],-2);await page.mouse.up();
 await page.getByRole('menuitem',{name:'连接节点',exact:true}).waitFor({state:'visible'});
 assert.equal(await page.locator('.curve-item').count(),2);
 await page.getByRole('menuitem',{name:'连接节点',exact:true}).click();const joined=await save();assert.equal(joined.paths.length,1);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,joined.paths);assert.deepEqual(errors,[]);
});

test('pasting during the choice keeps coincidence first and gives the paste its own undo step',async t=>{
 const {page,initial,errors,begin,move,save}=await setup(t,{decorate:doc=>{doc.calibration={a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'};}});
 await begin(initial.paths[0].nodes[0]);await move(initial.paths[1].nodes[0],-2);await page.mouse.up();
 await page.getByRole('menuitem',{name:'连接节点',exact:true}).waitFor({state:'visible'});
 await page.evaluate(curve=>{const data=new DataTransfer();data.setData('application/x-curve-editor-curves',JSON.stringify({format:'curve-editor-clipboard',version:2,calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'},sourcePageId:'fixture',paths:[curve]}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},initial.paths[1]);
 assert.equal(await page.locator('#context-menu').isVisible(),false,'a new edit must settle the choice before it starts');
 const pasted=await save();assert.equal(pasted.paths.length,3);
 await page.locator('#undo').click();const moved=await save();assert.equal(moved.paths.length,2);assert.equal(moved.paths[0].nodes[0].x,moved.paths[1].nodes[0].x);assert.equal(moved.paths[0].nodes[0].y,moved.paths[1].nodes[0].y);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

for(const dismiss of ['Escape','outside','blur','undo'])test(`${dismiss} dismisses the release choice without joining or adding an undo step`,async t=>{
 const {page,initial,errors,begin,move,save}=await setup(t);
 await begin(initial.paths[0].nodes[0]);await move(initial.paths[1].nodes[0],-2);await page.mouse.up();
 await page.getByRole('menuitem',{name:'仅保持重合',exact:true}).waitFor({state:'visible'});
 if(dismiss==='Escape')await page.keyboard.press('Escape');
 else if(dismiss==='outside')await page.locator('#zoom-in').click();
 else if(dismiss==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 else await page.keyboard.press('ControlOrMeta+z');
 assert.equal(await page.locator('#context-menu').isVisible(),false);
 const result=await save();assert.equal(result.paths.length,2);
 if(dismiss==='undo')assert.deepEqual(result.paths,initial.paths);
 else{assert.equal(result.paths[0].nodes[0].x,result.paths[1].nodes[0].x);assert.equal(result.paths[0].nodes[0].y,result.paths[1].nodes[0].y);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);}
 assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

test('refresh while the release choice is open recovers coincidence and the original undo step',async t=>{
 const {page,initial,errors,begin,move,save}=await setup(t);
 await begin(initial.paths[0].nodes[0]);await move(initial.paths[1].nodes[0],-2);await page.mouse.up();
 await page.getByRole('menuitem',{name:'连接节点',exact:true}).waitFor({state:'visible'});
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('.curve-item[data-path="moving"]').waitFor({state:'attached'});
 assert.equal(await page.locator('#context-menu').isVisible(),false);
 const recovered=await save();assert.equal(recovered.paths.length,2);assert.equal(recovered.paths[0].nodes[0].x,recovered.paths[1].nodes[0].x);assert.equal(recovered.paths[0].nodes[0].y,recovered.paths[1].nodes[0].y);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

test('whole-curve keep choice preserves rigid translation, style, layer and independent target',async t=>{
 const {page,initial,errors,begin,move,save}=await setup(t);await page.locator('[data-tool="select"]').click();
 const start=G.at(initial.paths[0].nodes[1],initial.paths[0].nodes[2],.5),delta={x:500,y:-30};
 await begin(start);await move({x:start.x+delta.x,y:start.y+delta.y},-2);await page.mouse.up();
 await page.getByRole('menuitem',{name:'仅保持重合',exact:true}).click();const kept=await save();assert.equal(kept.paths.length,2);assert.deepEqual(kept.paths[1],initial.paths[1]);assert.deepEqual(kept.layers,initial.layers);
 initial.paths[0].nodes.forEach((node,i)=>{for(const pair of [[node,kept.paths[0].nodes[i]],[node.in,kept.paths[0].nodes[i].in],[node.out,kept.paths[0].nodes[i].out]]){assert.ok(Math.abs(pair[1].x-pair[0].x-delta.x)<1e-8);assert.ok(Math.abs(pair[1].y-pair[0].y-delta.y)<1e-8);}});
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

test('ordinary coincidence at an interior node only snaps and does not offer an invalid connection',async t=>{
 const {page,initial,errors,begin,move,save,hint}=await setup(t);
 await begin(initial.paths[0].nodes[0]);await move(initial.paths[1].nodes[1]);assert.equal(await hint.count(),0);await page.mouse.up();
 assert.equal(await page.locator('#context-menu').isVisible(),false);const kept=await save();assert.equal(kept.paths.length,2);assert.ok(G.dist(kept.paths[0].nodes[0],kept.paths[1].nodes[1])<.001);assert.deepEqual(kept.paths[1],initial.paths[1]);assert.deepEqual(errors,[]);
});

test('closed curve opens at the clicked node without losing a segment, then drags apart and recloses in one undo step',async t=>{
 const {page,initial,errors,split,save,begin,move,hint}=await setup(t,{closed:true});
 await split(1);const opened=await save(),p=opened.paths[0];assert.equal(p.closed,false);assert.equal(p.nodes.length,5);
 for(let i=0;i<4;i++)for(const u of [0,.25,.5,.75,1])assert.deepEqual(G.at(p.nodes[i],p.nodes[i+1],u),G.at(initial.paths[0].nodes[(i+1)%4],initial.paths[0].nodes[(i+2)%4],u));
 await begin(p.nodes.at(-1));await move({x:270,y:70});assert.equal(await hint.count(),0);await page.mouse.up();const separated=await save();assert.equal(separated.paths[0].closed,false);assert.notEqual(separated.paths[0].nodes.at(-1).x,p.nodes[0].x);
 await begin(separated.paths[0].nodes.at(-1));await move(p.nodes[0],-2);assert.match(await page.locator('#node-alignment').textContent(),/松开选择闭合/);await page.mouse.up();await page.getByRole('menuitem',{name:'连接节点',exact:true}).click();
 const joined=await save();assert.equal(joined.paths[0].closed,true);assert.equal(joined.paths[0].nodes.length,4);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,separated.paths);await page.locator('#redo').click();assert.deepEqual((await save()).paths,joined.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('.curve-item[data-path="moving"]').waitFor({state:'attached'});assert.deepEqual((await save()).paths,joined.paths);assert.deepEqual(errors,[]);
});

test('interior node splits into two editable paths and a dragged endpoint joins a new curve across layers',async t=>{
 const {page,initial,errors,split,save,begin,move}=await setup(t);await split(1,false);
 const broken=await save();assert.equal(broken.paths.length,3);const pieces=broken.paths.filter(p=>p.id!=='target');assert.deepEqual(pieces.map(p=>p.nodes.length),[2,3]);
 assert.ok(pieces.every(p=>broken.layers[0].pathIds.includes(p.id)));assert.equal(broken.layers[0].items.length,2);
 const piece=pieces[1];await begin(piece.nodes[0]);await move(initial.paths[1].nodes[0],-2);assert.match(await page.locator('#node-alignment').textContent(),/松开选择连接/);await page.mouse.up();await page.getByRole('menuitem',{name:'连接节点',exact:true}).click();
 const joined=await save(),merged=joined.paths.find(p=>p.id===piece.id);assert.equal(joined.paths.length,2);assert.equal(merged.nodes.length,5);assert.equal(merged.closed,false);assert.equal(joined.paths.some(p=>p.id==='target'),false);
 assert.ok(joined.layers[0].pathIds.includes(piece.id));assert.deepEqual(joined.layers[1].pathIds,[]);for(const key of ['name','color','role','dashed','note'])assert.equal(merged[key],piece[key]);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,broken.paths);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('Alt and cancelled gestures never connect; release outside the radius only moves',async t=>{
 const {page,initial,errors,begin,move,save,hint}=await setup(t);
 for(const cancel of ['Alt','Escape','pointercancel','lostpointercapture','blur','outside']){
  await page.locator('.curve-item[data-path="moving"] .curve-select').click();await begin(initial.paths[0].nodes[0]);await move(initial.paths[1].nodes[0],-2);assert.equal(await hint.count(),1);
  if(cancel==='Alt')await page.keyboard.down('Alt');else if(cancel==='Escape')await page.keyboard.press('Escape');else if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else if(cancel==='outside')await move(initial.paths[1].nodes[0],-7);else await page.locator('#canvas').dispatchEvent(cancel);
  assert.equal(await hint.count(),0);await page.mouse.up();if(cancel==='Alt')await page.keyboard.up('Alt');assert.equal((await save()).paths.length,2);await page.locator('#undo').click();
 }
 assert.deepEqual(errors,[]);
});

for(const targetState of ['locked','hidden'])test(`${targetState} endpoints cannot connect`,async t=>{
 const {page,initial,errors,begin,move,save,hint}=await setup(t,{targetState});await begin(initial.paths[0].nodes[0]);await move(initial.paths[1].nodes[0],-2);assert.equal(await hint.count(),0);await page.mouse.up();const d=await save();assert.equal(d.paths.length,2);assert.deepEqual(d.paths[1],initial.paths[1]);assert.deepEqual(errors,[]);
});

test('endpoint click and multi-node movement do not join; open endpoints cannot split',async t=>{
 const {page,initial,errors,begin,move,save,hint}=await setup(t);await begin(initial.paths[0].nodes[0]);await page.mouse.up();assert.equal(await page.locator('#break-node').isDisabled(),true);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.keyboard.press('ControlOrMeta+a');await begin(initial.paths[0].nodes[0]);await move(initial.paths[1].nodes[0],-2);assert.equal(await hint.count(),0);await page.mouse.up();assert.equal((await save()).paths.length,2);assert.deepEqual(errors,[]);
});

test('coincident split ends only reconnect after a real drag, even when returning exactly to the starting position',async t=>{
 const {page,initial,errors,split,begin,move,save,hint}=await setup(t,{closed:true});await split(0);
 const opened=await save(),end=opened.paths[0].nodes.at(-1);
 await begin(end);await page.mouse.up();assert.equal((await save()).paths[0].closed,false);
 await begin(end);await move({x:end.x+40,y:end.y+25});await move(end);assert.equal(await hint.count(),1);await page.mouse.up();await page.getByRole('menuitem',{name:'连接节点',exact:true}).click();
 const closed=await save();assert.equal(closed.paths[0].closed,true);assert.equal(closed.paths[0].nodes.length,initial.paths[0].nodes.length);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,opened.paths);assert.deepEqual(errors,[]);
});

for(const mode of ['select','node','all-nodes'])test(`whole open curve connects by translation in ${mode} mode, preserving its shape and one undo step`,async t=>{
 const {page,initial,errors,begin,move,save,hint}=await setup(t);
 if(mode==='select')await page.locator('[data-tool="select"]').click();
 if(mode==='all-nodes')for(let i=0;i<4;i++)await page.locator(`.anchor[data-path="moving"][data-node="${i}"]`).click({modifiers:['Shift']});
 const source=initial.paths[0],target=initial.paths[1],start=mode==='all-nodes'?source.nodes[0]:G.at(source.nodes[1],source.nodes[2],.5),delta={x:500,y:-30};
 await begin(start);await move({x:start.x+delta.x,y:start.y+delta.y},-2);assert.equal(await hint.count(),1);assert.match(await page.locator('#node-alignment').textContent(),/松开选择连接/);
 await page.mouse.up();await page.getByRole('menuitem',{name:'连接节点',exact:true}).click();const d=await save();assert.equal(d.paths.length,1);assert.equal(d.paths[0].id,source.id);assert.equal(d.paths[0].nodes.length,6);
 // Joining a moving start to a fixed start reverses the source, preserving every cubic.
 for(let i=0;i<3;i++)for(const u of [0,.25,.5,.75,1]){
  const a=G.at(d.paths[0].nodes[i],d.paths[0].nodes[i+1],u);
  const expected=G.at(source.nodes[2-i],source.nodes[3-i],1-u);
  assert.ok(Math.abs(a.x-expected.x-delta.x)<1e-8);assert.ok(Math.abs(a.y-expected.y-delta.y)<1e-8);
 }
 for(let i=0;i<2;i++)for(const u of [0,.5,1])assert.deepEqual(G.at(d.paths[0].nodes[i+3],d.paths[0].nodes[i+4],u),G.at(target.nodes[i],target.nodes[i+1],u));
 assert.match(await page.locator('#selection-count').textContent(),/已选 1 个元素/);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);await page.locator('#redo').click();assert.deepEqual((await save()).paths,d.paths);
 if(mode==='select'){await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('.curve-item[data-path="moving"]').waitFor({state:'attached'});assert.deepEqual((await save()).paths,d.paths);}
 assert.deepEqual(errors,[]);
});

test('whole curve picks only the closest endpoint pair and switches candidates, even when an interior node aligns exactly',async t=>{
 const {page,initial,errors,begin,move,save,hint}=await setup(t,{decorate:d=>{
  d.paths[1].nodes=[G.node(401,150),G.node(520,100),G.node(652,320)];
 }});
 const start=G.at(initial.paths[0].nodes[1],initial.paths[0].nodes[2],.5);
 await begin(start);await move({x:start.x+300,y:start.y});assert.equal(await hint.count(),1);assert.equal(await hint.locator('circle').first().getAttribute('cx'),'401');
 // At this position the second pair is closer: 0.2 px versus 0.8 px before snapping.
 await move({x:start.x+301.8,y:start.y});assert.equal(await hint.count(),1);assert.equal(await hint.locator('circle').first().getAttribute('cx'),'652');
 await page.mouse.up();await page.getByRole('menuitem',{name:'连接节点',exact:true}).click();const d=await save();assert.equal(d.paths.length,1);assert.equal(d.paths[0].nodes[3].x,652);assert.equal(d.paths[0].nodes[3].y,320);
 initial.paths[0].nodes.forEach((n,i)=>{assert.ok(Math.abs(d.paths[0].nodes[i].x-n.x-302)<1e-8);assert.ok(Math.abs(d.paths[0].nodes[i].y-n.y)<1e-8);});
 assert.deepEqual(errors,[]);
});

test('whole-curve connection can be cancelled or bypassed with Alt and keeps one rigid translation',async t=>{
 const {page,initial,errors,begin,move,save,hint}=await setup(t);const start=G.at(initial.paths[0].nodes[1],initial.paths[0].nodes[2],.5);
 for(const cancel of ['Alt','Escape','pointercancel','lostpointercapture','blur','outside']){
  await page.locator('.curve-item[data-path="moving"] .curve-select').click();await begin(start);await move({x:start.x+500,y:start.y-30},-2);assert.equal(await hint.count(),1);
  if(cancel==='Alt')await page.keyboard.down('Alt');else if(cancel==='Escape')await page.keyboard.press('Escape');else if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));else if(cancel==='outside')await move({x:start.x+500,y:start.y-30},-7);else await page.locator('#canvas').dispatchEvent(cancel);
  assert.equal(await hint.count(),0);await page.mouse.up();if(cancel==='Alt')await page.keyboard.up('Alt');const d=await save();assert.equal(d.paths.length,2);
  const dx=d.paths[0].nodes[0].x-initial.paths[0].nodes[0].x,dy=d.paths[0].nodes[0].y-initial.paths[0].nodes[0].y;
  d.paths[0].nodes.forEach((n,i)=>{assert.ok(Math.abs(n.x-initial.paths[0].nodes[i].x-dx)<1e-8);assert.ok(Math.abs(n.y-initial.paths[0].nodes[i].y-dy)<1e-8);});
  await page.locator('#undo').click();
 }
 assert.deepEqual(errors,[]);
});
