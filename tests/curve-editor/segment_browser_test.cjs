// Isolated artwork and browser; never changes an open user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const g=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
const expand=async page=>{const closed=page.locator('.panel-group:not([open]):not([data-panel="help"]) > summary');while(await closed.count())await closed.first().click();await expandLayerContents(page);};

async function setup(t,closed=false,{denyClipboard=false,mirrorAxis=null}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-segment-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const nodes=[[100,250],[250,200],[450,200],[600,250]].map(([x,y])=>g.node(x,y,'symmetric'));
 for(const n of nodes){n.in={x:n.x-50,y:n.y+100};n.out={x:n.x+50,y:n.y-100};}
 const curve={id:'curve',name:'分段曲线',role:'outline',color:'#e04544',closed,dashed:true,note:'保留线段样式',nodes};
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:800,height:500,title:'线段切换测试',paths:[curve],originals:[],image:null,opacity:.65,newNodeMode:'smooth',mirrorAxis};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:950},permissions:['clipboard-read','clipboard-write']}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 if(denyClipboard)await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{readText:async()=>{throw new Error('denied');},writeText:async()=>{throw new Error('denied');}}});});
 await page.goto(url);await expand(page);await page.locator('#mirror-link').uncheck();await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:curve.name}).waitFor();await page.locator('[data-tool="node"]').click();
 const screen=async p=>page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},p);
 const click=async p=>{const q=await screen(p);await page.mouse.click(q.x,q.y);};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,browser,url,initial,errors,screen,click,save};
}

// Pasting places the group's bounds at the last canvas pointer (README),
// so copies retain one translation rather than their original absolute position.
function assertTranslatedNodes(actual,expected){
 assert.equal(actual.length,expected.length);
 const delta={x:actual[0].x-expected[0].x,y:actual[0].y-expected[0].y};
 const near=(a,b)=>assert.ok(g.dist(a,{x:b.x+delta.x,y:b.y+delta.y})<1e-7,JSON.stringify({actual:a,expected:b,delta}));
 actual.forEach((n,i)=>{
  const {x,y,in:incoming,out:outgoing,...metadata}=n,{x:ex,y:ey,in:ei,out:eo,...expectedMetadata}=expected[i];
  assert.deepEqual(metadata,expectedMetadata);near(n,expected[i]);near(incoming,ei);near(outgoing,eo);
 });
 return near;
}
function assertSegmentCopy(copy,source,index){
 const a=source.nodes[index],b=source.nodes[(index+1)%source.nodes.length];
 assert.notEqual(copy.id,source.id);assert.equal(copy.closed,false);assert.equal(copy.nodes.length,2);
 assert.equal(copy.name,`${source.name} · 第 ${index+1} 段 · 副本`);
 assert.notEqual(copy.color,source.color);for(const key of ['role','note','dashed'])assert.equal(copy[key],source[key]);
 const near=assertTranslatedNodes(copy.nodes,[{...a,in:g.point(a),mode:'cusp'},{...b,out:g.point(b),mode:'cusp'}]);
 // Compare the actual cubic, including a closed path's last-to-first segment.
 for(let i=0;i<=20;i++)near(g.at(copy.nodes[0],copy.nodes[1],i/20),g.at(a,b,i/20));
}

function assertSegmentMirror(copy,source,index){
 const a=source.nodes[index],b=source.nodes[(index+1)%source.nodes.length];
 assert.notEqual(copy.id,source.id);assert.equal(copy.closed,false);assert.equal(copy.nodes.length,2);
 assert.equal(copy.name,`${source.name} · 第 ${index+1} 段 · 镜像`);
 for(const key of ['color','role','note','dashed'])assert.equal(copy[key],source[key]);
 const near=(actual,expected)=>{assert.ok(Math.abs(actual.x-expected.x)<1e-6);assert.ok(Math.abs(actual.y-expected.y)<1e-6);};
 const reflect=p=>({x:800-p.x,y:p.y});
 near(copy.nodes[0],reflect(a));near(copy.nodes[0].out,reflect(a.out));
 near(copy.nodes[1],reflect(b));near(copy.nodes[1].in,reflect(b.in));
 near(copy.nodes[0].in,copy.nodes[0]);near(copy.nodes[1].out,copy.nodes[1]);
 assert.deepEqual(copy.nodes.map(n=>n.mode),['cusp','cusp']);
 for(let i=0;i<=20;i++)near(g.at(copy.nodes[0],copy.nodes[1],i/20),reflect(g.at(a,b,i/20)));
}

test('selected segment context menu mirrors only the highlighted cubic and restores selection with undo',async t=>{
 const {page,initial,errors,click,screen,save}=await setup(t),source=initial.paths[0],mid=g.at(source.nodes[1],source.nodes[2],.5);
 const menu=()=>page.getByRole('menuitem',{name:'镜像所选片段',exact:true});
 const rightClick=async()=>{const q=await screen(mid);await page.mouse.click(q.x,q.y,{button:'right'});};
 await click(mid);await rightClick();assert.equal(await menu().count(),1);assert.equal(await menu().isDisabled(),true);
 assert.match(await menu().getAttribute('title'),/对称轴/);await page.keyboard.press('Escape');
 await page.locator('[data-tool="axis"]').click();await click({x:400,y:50});await click({x:400,y:450});
 await click(mid);await rightClick();await menu().click();
 const mirrored=await save();assert.equal(mirrored.paths.length,2);assert.deepEqual(mirrored.paths[0],source);assertSegmentMirror(mirrored.paths[1],source,1);
 assert.deepEqual(mirrored.layers[0].pathIds,[source.id,mirrored.paths[1].id]);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 assert.equal(await page.locator('.selected-segment').getAttribute('data-segment'),'1');
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,mirrored.paths);
 await page.keyboard.press('ArrowRight');const moved=await save();assert.deepEqual(moved.paths[0],source);
 assert.equal(moved.paths[1].nodes[0].out.x,mirrored.paths[1].nodes[0].out.x+1);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();
 await expand(page);await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'第 2 段 · 镜像'}).waitFor({state:'attached'});
 assert.deepEqual((await save()).paths,moved.paths);assert.deepEqual(errors,[]);
});

test('closing and straight segments mirror independently while whole curve mirroring remains available',async t=>{
 const {page,initial,errors,click,screen,save}=await setup(t,true,{mirrorAxis:{a:{x:400,y:50},b:{x:400,y:450}}}),source=initial.paths[0],last=source.nodes.length-1;
 const mid=g.at(source.nodes[last],source.nodes[0],.5);await click(mid);
 assert.equal(await page.locator('#mirror-copy').textContent(),'镜像所选片段');
 await page.locator('#mirror-copy').click();const mirrored=await save();assertSegmentMirror(mirrored.paths[1],source,last);assert.deepEqual(mirrored.paths[0],source);
 await page.locator('#undo').click();await page.keyboard.press('j');const straight=(await save()).paths[0];
 const q=await screen(g.at(straight.nodes[last],straight.nodes[0],.5));await page.mouse.click(q.x,q.y,{button:'right'});
 await page.getByRole('menuitem',{name:'镜像所选片段',exact:true}).click();assertSegmentMirror((await save()).paths[1],straight,last);
 await page.locator('#undo').click();await page.locator('#undo').click();
 await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:source.name}).click();
 assert.equal(await page.locator('#mirror-copy').textContent(),'生成镜像副本');
 const r=await screen(mid);await page.mouse.click(r.x,r.y,{button:'right'});
 assert.equal(await page.getByRole('menuitem',{name:'镜像所选片段',exact:true}).count(),0);
 await page.getByRole('menuitem',{name:'按对称轴生成镜像副本',exact:true}).click();
 const whole=await save();assert.equal(whole.paths[1].nodes.length,source.nodes.length);assert.equal(whole.paths[1].closed,true);assert.deepEqual(whole.paths[0],source);
 await page.locator('#undo').click();await click(mid);await page.locator('.layer-row [data-action="locked"]').click();
 await page.mouse.click(r.x,r.y,{button:'right'});assert.equal(await page.getByRole('menuitem',{name:'镜像所选片段',exact:true}).count(),0);
 assert.equal(await page.locator('#mirror-copy').isDisabled(),true);assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('native copy of a blue segment pastes only that segment, independently editable with one undo step',async t=>{
 const {page,initial,errors,click,save}=await setup(t),source=initial.paths[0];
 await click(g.at(source.nodes[1],source.nodes[2],.5));
 await page.keyboard.press('ControlOrMeta+c');assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.keyboard.press('ControlOrMeta+v');
 await page.waitForFunction(()=>document.querySelectorAll('#layer-list .layer-contents .curve-select').length===2);
 const pasted=await save();assertSegmentCopy(pasted.paths[1],source,1);assert.deepEqual(pasted.paths[0],source);
 assert.equal(await page.locator('[data-tool="select"]').getAttribute('aria-pressed'),'true');
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 assert.equal(await page.locator('.selected-segment').getAttribute('data-segment'),'1');assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,pasted.paths);
 await page.keyboard.press('ArrowRight');const moved=await save();assert.deepEqual(moved.paths[0],source);
 assert.equal(moved.paths[1].nodes[0].out.x,pasted.paths[1].nodes[0].out.x+1);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();
 await expand(page);await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'第 2 段'}).waitFor({state:'attached'});
 assert.deepEqual((await save()).paths,moved.paths);assert.deepEqual(errors,[]);
});

test('toolbar copies the closing segment and a straight segment without system clipboard permission',async t=>{
 const {page,initial,errors,click,save}=await setup(t,true,{denyClipboard:true}),source=initial.paths[0],last=source.nodes.length-1;
 await click(g.at(source.nodes[last],source.nodes[0],.5));
 await page.locator('#copy-curves').click();await page.locator('#status').filter({hasText:'可跨页面粘贴'}).waitFor();
 await page.locator('#paste-curves').click();await page.locator('#status').filter({hasText:'已粘贴'}).waitFor();const pasted=await save();assertSegmentCopy(pasted.paths[1],source,last);assert.deepEqual(pasted.paths[0],source);
 await page.locator('#undo').click();await page.keyboard.press('j');const straight=(await save()).paths[0];
 await page.locator('#copy-curves').click();await page.locator('#status').filter({hasText:'可跨页面粘贴'}).waitFor();await page.locator('#paste-curves').click();await page.locator('#status').filter({hasText:'已粘贴'}).waitFor();
 assertSegmentCopy((await save()).paths[1],straight,last);assert.deepEqual(errors,[]);
});

test('segment context menu copies the highlighted segment, while curve list copy still copies the whole path',async t=>{
 const {page,initial,errors,click,screen,save}=await setup(t),source=initial.paths[0],mid=g.at(source.nodes[1],source.nodes[2],.5);
 await click(mid);const q=await screen(mid);await page.mouse.click(q.x,q.y,{button:'right'});
 await page.getByRole('menuitem',{name:'复制线段',exact:true}).click();await page.locator('#status').filter({hasText:'已复制'}).waitFor();
 await page.locator('#add-layer').click();await page.locator('#paste-curves').click();const pasted=await save();assertSegmentCopy(pasted.paths[1],source,1);
 assert.deepEqual(pasted.layers.at(-1).pathIds,[pasted.paths[1].id]);assert.deepEqual(pasted.layers[0].pathIds,[source.id]);
 await page.locator('#undo').click();await page.locator('#undo').click();
 await page.locator('#layer-list .layer-contents .curve-select').filter({hasText:source.name}).click({button:'right'});
 await page.getByRole('menuitem',{name:'复制曲线',exact:true}).click();await page.locator('#status').filter({hasText:'已复制'}).waitFor();
 await page.locator('#paste-curves').click();const whole=(await save()).paths[1];assertTranslatedNodes(whole.nodes,source.nodes);assert.equal(whole.closed,source.closed);
 assert.deepEqual(errors,[]);
});

test('clicking a segment then J only changes its two handles and keeps selection through undo and redo',async t=>{
 const {page,initial,errors,click,screen,save}=await setup(t),original=initial.paths[0];
 await click(g.at(original.nodes[1],original.nodes[2],.5));
 const highlight=page.locator('.selected-segment');assert.equal(await highlight.count(),1);assert.equal(await highlight.getAttribute('data-segment'),'1');
 assert.equal(await page.locator('#undo').isDisabled(),true);assert.match(await page.locator('#selection-count').textContent(),/第 2 段/);
 assert.equal(await page.locator('#handles .control').count(),2);
 await page.keyboard.press('j');const straight=await save(),p=straight.paths[0];
 assert.deepEqual(p.nodes.map(g.point),original.nodes.map(g.point));assert.deepEqual(p.nodes[0],original.nodes[0]);assert.deepEqual(p.nodes[3],original.nodes[3]);
 assert.deepEqual(p.nodes[1].out,g.point(p.nodes[1]));assert.deepEqual(p.nodes[2].in,g.point(p.nodes[2]));
 assert.deepEqual(p.nodes[1].in,original.nodes[1].in);assert.deepEqual(p.nodes[2].out,original.nodes[2].out);
 assert.equal(g.segmentD(p,0),g.segmentD(original,0));assert.equal(g.segmentD(p,2),g.segmentD(original,2));assert.equal(straight.newNodeMode,initial.newNodeMode);
 assert.equal(p.nodes[1].mode,'cusp');assert.equal(p.nodes[2].mode,'cusp');
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await highlight.getAttribute('data-segment'),'1');
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,straight.paths);
 await page.keyboard.press('j');const curved=await save();assert.ok(g.dist(curved.paths[0].nodes[1],curved.paths[0].nodes[1].out)>.01);
 assert.ok(g.dist(curved.paths[0].nodes[2],curved.paths[0].nodes[2].in)>.01);assert.equal(g.segmentD(curved.paths[0],0),g.segmentD(original,0));assert.equal(g.segmentD(curved.paths[0],2),g.segmentD(original,2));
 await page.locator('#straight').click();assert.deepEqual((await save()).paths,straight.paths);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,curved.paths);
 // Both segment handles remain independently draggable even on formerly symmetric nodes.
 const a=await screen(curved.paths[0].nodes[1].out),b={x:a.x+18,y:a.y-12};await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();
 const moved=await save();assert.notDeepEqual(moved.paths[0].nodes[1].out,curved.paths[0].nodes[1].out);assert.deepEqual(moved.paths[0].nodes[1].in,original.nodes[1].in);
 assert.deepEqual(moved.paths[0].nodes[2],curved.paths[0].nodes[2]);assert.equal(await highlight.count(),1);assert.deepEqual(errors,[]);
 if(process.env.CURVE_EDITOR_SEGMENT_SCREENSHOT){await click(g.at(moved.paths[0].nodes[1],moved.paths[0].nodes[2],.5));await page.screenshot({path:process.env.CURVE_EDITOR_SEGMENT_SCREENSHOT});}
});

test('double-click still inserts exactly one node and a selected segment cannot edit a locked curve',async t=>{
 const {page,initial,errors,click,screen,save}=await setup(t),p=initial.paths[0];
 const midpoint=g.at(p.nodes[1],p.nodes[2],.5),q=await screen(midpoint);
 await page.mouse.dblclick(q.x,q.y);const split=(await save()).paths[0];assert.equal(split.nodes.length,p.nodes.length+1);assert.equal(await page.locator('.selected-segment').count(),0);
 await page.locator('#undo').click();await click(midpoint);
 await page.locator('.layer-row [data-action="locked"]').click();await page.keyboard.press('j');
 assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('.selected-segment').count(),0);
 await page.locator('.layer-row [data-action="locked"]').click();await page.keyboard.press('j');assert.deepEqual((await save()).paths,initial.paths);
 assert.deepEqual(errors,[]);
});

test('closed final segments toggle without touching either neighbor, and clicking a node restores node J',async t=>{
 const {page,initial,errors,click,save}=await setup(t,true),p=initial.paths[0],index=p.nodes.length-1;
 await click(g.at(p.nodes[index],p.nodes[0],.5));assert.equal(await page.locator('.selected-segment').getAttribute('data-segment'),String(index));
 await page.keyboard.press('j');const straight=(await save()).paths[0];assert.deepEqual(straight.nodes[index].out,g.point(p.nodes[index]));assert.deepEqual(straight.nodes[0].in,g.point(p.nodes[0]));
 assert.equal(g.segmentD(straight,0),g.segmentD(p,0));assert.equal(g.segmentD(straight,index-1),g.segmentD(p,index-1));
 await click(p.nodes[0]);assert.equal(await page.locator('.selected-segment').count(),0);await page.keyboard.press('j');const node=(await save()).paths[0].nodes[0];
 assert.deepEqual(node.in,g.point(node));assert.deepEqual(node.out,g.point(node));assert.deepEqual(errors,[]);
});

test('dragging a selected segment handle decouples a symmetric node and undo restores the segment selection',async t=>{
 const {page,initial,errors,click,screen,save}=await setup(t),p=initial.paths[0];
 await click(g.at(p.nodes[1],p.nodes[2],.5));
 const start=await screen(p.nodes[1].out);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+25,start.y+10,{steps:5});await page.mouse.up();
 const moved=(await save()).paths[0];assert.notDeepEqual(moved.nodes[1].out,p.nodes[1].out);assert.deepEqual(moved.nodes[1].in,p.nodes[1].in);
 assert.equal(moved.nodes[1].mode,'cusp');assert.deepEqual(moved.nodes[2],p.nodes[2]);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('.selected-segment').getAttribute('data-segment'),'1');
 assert.deepEqual(errors,[]);
});

test('segment J survives refresh and reopening a portable copy without affecting neighboring curves',async t=>{
 const {page,browser,url,initial,errors,click,save}=await setup(t),original=initial.paths[0];
 await click(g.at(original.nodes[1],original.nodes[2],.5));await page.keyboard.press('j');const straight=await save();
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await expand(page);
 assert.equal(await page.locator('.selected-segment').getAttribute('data-segment'),'1');await page.keyboard.press('j');
 const curved=await save();assert.ok(g.dist(curved.paths[0].nodes[1],curved.paths[0].nodes[1].out)>.01);
 await page.locator('#save-as').click();const download=page.waitForEvent('download');await page.locator('#save-as-confirm').click();const file=await download,data=JSON.parse(await readFile(await file.path(),'utf8'));
 const context=await browser.newContext(),fresh=await context.newPage();fresh.on('pageerror',e=>errors.push(e.message));fresh.on('dialog',d=>d.accept());await fresh.goto(url);
 await fresh.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await fresh.locator('#project-file').setInputFiles({name:'线段副本.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expand(fresh);
 assert.equal(await fresh.locator('.selected-segment').getAttribute('data-segment'),'1');await fresh.keyboard.press('j');
 const response=fresh.waitForResponse(r=>r.url().endsWith('/api/save'));await fresh.locator('#save').click();assert.equal((await response).status(),200);
 const saved=await fresh.evaluate(()=>fetch('/api/latest').then(r=>r.json()));assert.deepEqual(saved.paths,straight.paths);
 await fresh.locator('#undo').click();assert.equal(await fresh.locator('.selected-segment').getAttribute('data-segment'),'1');assert.deepEqual(errors,[]);
});
