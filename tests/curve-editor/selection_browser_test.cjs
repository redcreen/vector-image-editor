// Uses an isolated project; never touches an open user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
async function expandPanels(page){const closed=page.locator('.panel-group:not([open]):not([data-panel="help"]) > summary');while(await closed.count())await closed.first().click();}

const g=require('../../tools/curve-editor/geometry.js');

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-selection-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,points)=>({id,name:id,role:'outline',color:'#e04544',closed:false,note:'',nodes:points.map(([x,y])=>g.node(x,y))});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:1000,height:700,title:'无限画布测试',paths:[curve('curve-a',[[100,100],[200,100],[200,200]]),curve('curve-b',[[400,100],[500,100],[500,200]]),curve('outside',[[1300,300],[1400,400]])],originals:[],image:null,opacity:.65,newNodeMode:'cusp'};
 const saves=path.join(project,'work/curve_editor/sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','auto']);
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);await expandPanels(page);await page.locator('#curve-list button').filter({hasText:'outside'}).waitFor();
 const screen=async(x,y)=>page.locator('#viewport').evaluate((el,{x,y})=>{const p=new DOMPoint(x,y).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};},{x,y});
 const click=async(x,y,shift=false)=>{if(shift)await page.keyboard.down('Shift');const p=await screen(x,y);await page.mouse.click(p.x,p.y);if(shift)await page.keyboard.up('Shift');};
 const drag=async(x,y,dx,dy,shift=false)=>{if(shift)await page.keyboard.down('Shift');const a=await screen(x,y),b=await screen(x+dx,y+dy);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();if(shift)await page.keyboard.up('Shift');};
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const selectedIds=async()=>page.locator('#curve-list button[aria-pressed=true] span').allTextContents();
 return {page,initial,errors,screen,click,drag,save,selectedIds};
}

test('infinite background, fitting and exports include artwork beyond the original image area',async t=>{
 const {page,errors,screen,drag,save}=await setup(t);
 async function coversViewport(){return page.locator('#canvas').evaluate(svg=>{
  const viewport=document.getElementById('viewport'),matrix=viewport.getScreenCTM().inverse(),r=svg.getBoundingClientRect();
  const a=new DOMPoint(r.left,r.top).matrixTransform(matrix),b=new DOMPoint(r.right,r.bottom).matrixTransform(matrix),paper=document.getElementById('paper').getBBox();
  return paper.x<=a.x&&paper.y<=a.y&&paper.x+paper.width>=b.x&&paper.y+paper.height>=b.y;
 });}
 assert.equal(await coversViewport(),true);
 const outside=await screen(1400,400),canvas=await page.locator('#canvas').boundingBox();
 assert.ok(outside.x>=canvas.x&&outside.x<=canvas.x+canvas.width);
 await page.keyboard.down('Space');await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width/2+280,canvas.y+canvas.height/2+150,{steps:5});await page.mouse.up();await page.keyboard.up('Space');
 assert.equal(await coversViewport(),true);await page.locator('#zoom-out').click();assert.equal(await coversViewport(),true);
 await page.locator('#fit').click();await page.locator('[data-tool="select"]').click();await page.locator('#select-all').click();
 await drag(100,100,-250,0);await page.locator('#fit').click();assert.equal(await coversViewport(),true);
 const doc=await save();assert.equal(doc.width,1000);assert.equal(doc.height,700);assert.ok(doc.paths[0].nodes[0].x<0);
 const downloading=page.waitForEvent('download');await page.locator('#export').click();
 const stream=await (await downloading).createReadStream();let svg='';for await(const chunk of stream)svg+=chunk;
 const bounds=svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);assert.ok(bounds[0]<doc.paths[0].nodes[0].x);assert.ok(bounds[0]+bounds[2]>1150);
 assert.deepEqual(errors,[]);
});

test('marquee, shift selection and select all move/delete curves as one undoable operation',async t=>{
 const {page,initial,errors,click,drag,save,selectedIds}=await setup(t);
 await page.locator('[data-tool="select"]').click();await drag(80,80,140,140);
 assert.deepEqual(await selectedIds(),['curve-a']);assert.equal(await page.locator('#undo').isDisabled(),true);
 await drag(380,80,140,140,true);assert.deepEqual(await selectedIds(),['curve-a','curve-b']);
 await click(400,100,true);assert.deepEqual(await selectedIds(),['curve-a']);
 await click(400,100,true);assert.deepEqual(await selectedIds(),['curve-a','curve-b']);
 await drag(100,100,50,30);let doc=await save();
 for(let i=0;i<2;i++)doc.paths[i].nodes.forEach((n,j)=>{assert.ok(Math.abs(n.x-initial.paths[i].nodes[j].x-50)<.001);assert.ok(Math.abs(n.y-initial.paths[i].nodes[j].y-30)<.001);});
 assert.deepEqual(doc.paths[2],initial.paths[2]);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(await selectedIds(),['curve-a','curve-b']);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,doc.paths);
 await page.locator('#undo').click();await click(400,100,true);assert.deepEqual(await selectedIds(),['curve-a']);
 await page.locator('#deselect').click();await drag(150,80,10,40);assert.deepEqual(await selectedIds(),['curve-a']); // Cross the line without enclosing an anchor.
 await page.keyboard.press('Control+a');assert.deepEqual(await selectedIds(),['curve-a','curve-b','outside']);
 await page.locator('#path-color').evaluate(el=>{el.value='#176bce';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
 assert.ok((await save()).paths.every(p=>p.color==='#176bce'));await page.locator('#undo').click();
 await page.keyboard.press('Delete');assert.equal(await page.locator('#curve-list button').count(),0);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('#deselect').click();await page.locator('#select-all').click();await page.keyboard.press('Shift+ArrowLeft');
 doc=await save();assert.ok(doc.paths.every((p,i)=>p.nodes[0].x===initial.paths[i].nodes[0].x-10));
 assert.deepEqual(errors,[]);
});

test('node marquee/select all preserves handles and supports grouped move, type changes and delete',async t=>{
 const {page,initial,errors,drag,save}=await setup(t);
 await page.locator('[data-tool="node"]').click();await drag(80,80,140,40);
 assert.equal(await page.locator('#handles .anchor[data-selected=true]').count(),2);
 await drag(100,100,20,30);let doc=await save();
 for(let j=0;j<2;j++){assert.ok(Math.abs(doc.paths[0].nodes[j].x-initial.paths[0].nodes[j].x-20)<.001);assert.ok(Math.abs(doc.paths[0].nodes[j].in.x-initial.paths[0].nodes[j].in.x-20)<.001);}
 assert.deepEqual(doc.paths[0].nodes[2],initial.paths[0].nodes[2]);assert.deepEqual(doc.paths[1],initial.paths[1]);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('[data-mode="symmetric"]').click();assert.ok((await save()).paths[0].nodes.slice(0,2).every(n=>n.mode==='symmetric'));await page.locator('#undo').click();
 await page.locator('#delete-node').click();doc=await save();assert.equal(doc.paths[0].nodes.length,1);assert.deepEqual(doc.paths[1],initial.paths[1]);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.keyboard.press('Meta+a');assert.equal(await page.locator('#handles .anchor[data-selected=true]').count(),8);
 await page.keyboard.press('ArrowRight');doc=await save();assert.ok(doc.paths.every((p,i)=>p.nodes.every((n,j)=>n.x===initial.paths[i].nodes[j].x+1)));
 await page.locator('#undo').click();await page.keyboard.press('Delete');assert.equal(await page.locator('#curve-list button').count(),0);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('#curve-list button').filter({hasText:'curve-a'}).click();await page.locator('#path-name').focus();await page.keyboard.press('ControlOrMeta+a');assert.equal(await page.locator('#handles .anchor[data-selected=true]').count(),0);
 await page.locator('#select-all').click();
 assert.deepEqual(errors,[]);
 if(process.env.CURVE_EDITOR_SELECTION_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_SELECTION_SCREENSHOT,fullPage:true});
});

test('Escape cancels an active marquee and subsequent pointer movement cannot select again',async t=>{
 const {page,errors,screen,selectedIds}=await setup(t);
 await page.locator('[data-tool="select"]').click();await page.locator('#deselect').click();
 const a=await screen(80,80),b=await screen(520,220),c=await screen(530,230);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});
 assert.equal(await page.locator('.selection-marquee').count(),1);await page.keyboard.press('Escape');
 assert.equal(await page.locator('.selection-marquee').count(),0);
 await page.mouse.move(c.x,c.y);await page.mouse.up();assert.deepEqual(await selectedIds(),[]);
 assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

test('dragging empty space inside a marquee selection moves the whole group with one undo step',async t=>{
 const {page,initial,errors,screen,click,drag,save,selectedIds}=await setup(t);
 await page.locator('[data-tool="select"]').click();await drag(80,80,440,140);
 assert.deepEqual(await selectedIds(),['curve-a','curve-b']);
 await drag(300,150,40,25);const moved=await save();
 for(let i=0;i<2;i++)moved.paths[i].nodes.forEach((n,j)=>{assert.ok(Math.abs(n.x-initial.paths[i].nodes[j].x-40)<.001);assert.ok(Math.abs(n.y-initial.paths[i].nodes[j].y-25)<.001);});
 assert.deepEqual(moved.paths[2],initial.paths[2]);assert.deepEqual(await selectedIds(),['curve-a','curve-b']);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await click(300,150);assert.deepEqual(await selectedIds(),['curve-a','curve-b']);assert.equal(await page.locator('#redo').isDisabled(),false);
 const inside=await screen(300,150);await page.mouse.move(inside.x,inside.y);assert.equal(await page.locator('#canvas').evaluate(el=>getComputedStyle(el).cursor),'move');
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,moved.paths);await page.locator('#undo').click();
 // Shift still starts a marquee inside the existing selection rather than moving it.
 await drag(300,150,230,80,true);assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(await selectedIds(),['curve-a','curve-b']);
 assert.deepEqual(errors,[]);
});

test('node selection can be dragged from its empty interior without moving unselected curves',async t=>{
 const {page,initial,errors,drag,save}=await setup(t);
 await page.locator('[data-tool="node"]').click();await drag(80,80,140,140);
 assert.equal(await page.locator('#handles .anchor[data-selected=true]').count(),3);
 await drag(150,150,20,30);const moved=await save();
 moved.paths[0].nodes.forEach((n,j)=>{assert.ok(Math.abs(n.x-initial.paths[0].nodes[j].x-20)<.001);assert.ok(Math.abs(n.y-initial.paths[0].nodes[j].y-30)<.001);assert.ok(Math.abs(n.in.x-initial.paths[0].nodes[j].in.x-20)<.001);});
 assert.deepEqual(moved.paths.slice(1),initial.paths.slice(1));assert.equal(await page.locator('#handles .anchor[data-selected=true]').count(),3);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,moved.paths);
 await page.locator('#undo').click();await page.locator('#deselect').click();await drag(80,80,140,40);
 // A flat node selection also drags between the anchors, even over their curve.
 await drag(150,100,20,30);const subset=await save();assert.ok(Math.abs(subset.paths[0].nodes[0].x-120)<.001);assert.ok(Math.abs(subset.paths[0].nodes[1].y-130)<.001);assert.deepEqual(subset.paths[0].nodes[2],initial.paths[0].nodes[2]);assert.deepEqual(errors,[]);
});

test('right-click smoothing preserves a marquee on empty space, curve and node, with one-step undo',async t=>{
 const {page,initial,errors,screen,drag,save}=await setup(t);
 await page.locator('[data-tool="node"]').click();await drag(80,80,140,140);
 const anchors=page.locator('#handles .anchor[data-selected=true]');assert.equal(await anchors.count(),3);
 const smooth=page.getByRole('menuitem',{name:'顺滑所选节点',exact:true});
 let smoothed;
 for(const [x,y] of [[150,150],[150,100],[200,100]]){
  const p=await screen(x,y);await page.mouse.click(p.x,p.y,{button:'right'});
  assert.equal(await anchors.count(),3);await smooth.click();smoothed=await save();
  assert.deepEqual(smoothed.paths[0].nodes.map(g.point),initial.paths[0].nodes.map(g.point));
  assert.ok(smoothed.paths[0].nodes.every(n=>n.mode==='smooth'));
  assert.ok(smoothed.paths[0].nodes[1].out.y>100);assert.equal(smoothed.newNodeMode,'cusp');
  assert.deepEqual(smoothed.paths.slice(1),initial.paths.slice(1));assert.equal(await anchors.count(),3);
  await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
  assert.equal(await page.locator('#undo').isDisabled(),true);assert.equal(await anchors.count(),3);
  await page.locator('#redo').click();assert.deepEqual((await save()).paths,smoothed.paths);
  // Applying the same smoothing twice leaves both history and geometry unchanged.
  await page.mouse.click(p.x,p.y,{button:'right'});await smooth.click();assert.deepEqual((await save()).paths,smoothed.paths);
  await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
  assert.equal(await page.locator('#undo').isDisabled(),true);
 }
 const p=await screen(150,150);await page.mouse.click(p.x,p.y,{button:'right'});await smooth.click();
 smoothed=await save();await page.reload();await expandPanels(page);
 await page.locator('#curve-list button').filter({hasText:'outside'}).waitFor();assert.deepEqual((await save()).paths,smoothed.paths);
 assert.deepEqual(errors,[]);
});

test('smoothing a node subset across curves leaves other nodes untouched and needs node selection',async t=>{
 const {page,initial,errors,screen,drag,save}=await setup(t);
 await page.locator('[data-tool="node"]').click();await drag(80,80,440,40);
 assert.equal(await page.locator('#handles .anchor[data-selected=true]').count(),4);
 const p=await screen(300,100);await page.mouse.click(p.x,p.y,{button:'right'});
 const smooth=page.getByRole('menuitem',{name:'顺滑所选节点',exact:true});await smooth.click();const doc=await save();
 for(let i=0;i<2;i++){
  assert.ok(doc.paths[i].nodes.slice(0,2).every(n=>n.mode==='smooth'));
  assert.deepEqual(doc.paths[i].nodes.map(g.point),initial.paths[i].nodes.map(g.point));
  assert.deepEqual(doc.paths[i].nodes[2],initial.paths[i].nodes[2]);
 }
 assert.deepEqual(doc.paths[2],initial.paths[2]);assert.equal(doc.newNodeMode,initial.newNodeMode);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 assert.equal(await page.locator('#handles .anchor[data-selected=true]').count(),4);
 await page.locator('#deselect').click();await page.mouse.click(p.x,p.y,{button:'right'});assert.equal(await smooth.count(),0);await page.keyboard.press('Escape');
 await page.locator('[data-tool="select"]').click();const line=await screen(150,100);await page.mouse.click(line.x,line.y,{button:'right'});assert.equal(await smooth.count(),0);
 assert.deepEqual(errors,[]);
});
