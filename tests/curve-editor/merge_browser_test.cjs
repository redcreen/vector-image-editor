// Isolated projects preserve the user's open canvas and saved work.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const g=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-merge-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,xs)=>({id,name:id,role:'outline',color:'#e04544',closed:false,note:'',nodes:xs.map(x=>g.node(x,120))});
 const a=curve('curve-a',[100,200]),b=curve('curve-b',[300,200]),c=curve('curve-c',[0,100]);
 a.nodes[0].out.y=160;b.nodes[0].out.y=80;c.nodes[0].out.y=140;b.color='#176bce';b.dashed=true;b.note='合并后保留';
 const closed={...curve('closed',[400,450,500]),closed:true},locked=curve('locked',[0,300]);
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:700,height:500,title:'合并测试',paths:[a,b,c,closed,locked],originals:[],images:[],image:null,opacity:.65,newNodeMode:'cusp',layers:[
  {id:'base',name:'底层',visible:true,locked:false,pathIds:['curve-a','curve-c','closed'],imageIds:[]},
  {id:'locked-layer',name:'锁定',visible:true,locked:true,pathIds:['locked'],imageIds:[]},
  {id:'active',name:'目标图层',visible:true,locked:false,pathIds:['curve-b'],imageIds:[]}
 ]};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);await expandLayerContents(page);
 const first=page.locator('#layer-list .layer-contents .curve-select').filter({hasText:'curve-a'});
 try{await first.waitFor({state:'attached',timeout:10000});}catch(error){
  console.error('Initial loading state:',JSON.stringify(await page.evaluate(()=>({status:document.getElementById('status').textContent,curves:document.getElementById('layer-list').textContent,storage:document.getElementById('session-status')?.textContent}))),errors);
  throw error;
 }
 const panel=page.locator('[data-panel="curves"]');if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();await first.waitFor();
 const item=id=>page.locator('#layer-list .layer-contents .curve-select').filter({hasText:new RegExp('^'+id+'\\d+ 点$')});
 const selected=()=>page.locator('#layer-list .layer-contents .curve-select[aria-pressed=true] span').allTextContents();
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,initial,errors,item,selected,save};
}

test('Shift selection and list right-click merge curves across layers, with exact undo/redo and persisted handles',async t=>{
 const {page,initial,errors,item,selected,save}=await setup(t);
 await item('curve-a').click();await item('curve-c').click({modifiers:['Shift']});await item('curve-b').click({modifiers:['Shift']});
 assert.deepEqual(await selected(),['curve-b','curve-a','curve-c']);
 await item('curve-a').click({button:'right'});assert.deepEqual(await selected(),['curve-b','curve-a','curve-c']);
 await page.getByRole('menuitem',{name:'合并曲线',exact:true}).click();
 assert.deepEqual(await selected(),['curve-b']);assert.equal(await page.locator('#layer-list .layer-contents .curve-select').count(),3);
 assert.ok((await page.locator('#history-list').textContent()).includes('合并曲线'));
 const merged=await save(),p=merged.paths.find(p=>p.id==='curve-b');
 assert.deepEqual(p.nodes.map(n=>n.x),[300,200,100,0]);assert.equal(p.nodes.length,4);
 assert.equal(p.color,'#176bce');assert.equal(p.dashed,true);assert.equal(p.note,'合并后保留');
 assert.deepEqual(p.nodes[0].out,initial.paths[1].nodes[0].out);
 assert.deepEqual(p.nodes[2].out,initial.paths[0].nodes[0].in);
 assert.deepEqual(merged.layers.find(l=>l.id==='active').pathIds,['curve-b']);
 assert.deepEqual(merged.layers.find(l=>l.id==='base').pathIds,['closed']);
 assert.deepEqual(merged.paths.filter(p=>p.id!=='curve-b'),initial.paths.slice(3));
 await page.locator('#undo').click();const restored=await save();assert.deepEqual(restored.paths,initial.paths);assert.deepEqual(restored.layers,initial.layers.map(l=>({...l,textIds:[]})));
 assert.deepEqual(await selected(),['curve-b','curve-a','curve-c']);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,merged.paths);
 await page.locator('#handles .anchor[data-path="curve-b"][data-node="1"]').click();await page.keyboard.press('ArrowDown');
 const edited=(await save()).paths.find(p=>p.id==='curve-b');
 for(const point of [edited.nodes[1],edited.nodes[1].in,edited.nodes[1].out])assert.equal(point.y,121);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,merged.paths);
 await page.reload();await expandLayerContents(page);await item('curve-b').waitFor();assert.deepEqual(await selected(),['curve-b']);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 assert.deepEqual(errors,[]);
});

test('right-click selects an unselected curve and disabled merge protects closed, single and locked curves',async t=>{
 const {page,initial,errors,item,selected,save}=await setup(t);
 const action=page.getByRole('menuitem',{name:'合并曲线',exact:true});
 await item('curve-a').click({button:'right'});assert.deepEqual(await selected(),['curve-a']);assert.equal(await action.isDisabled(),true);
 await page.keyboard.press('Escape');await item('curve-b').click({modifiers:['Shift']});await item('curve-a').click({button:'right'});assert.equal(await action.isEnabled(),true);
 await page.keyboard.press('Escape');await item('closed').click({modifiers:['Shift']});await item('curve-a').click({button:'right'});assert.equal(await action.isDisabled(),true);
 await page.keyboard.press('Escape');await item('curve-c').click({button:'right'});assert.deepEqual(await selected(),['curve-c']);assert.equal(await action.isDisabled(),true);
 await page.keyboard.press('Escape');assert.equal(await item('locked').isDisabled(),true);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 assert.deepEqual(errors,[]);
});

test('curve-list context menu deletes single or multiple curves, with layers and selection restored in one undo',async t=>{
 const {page,initial,errors,item,selected,save}=await setup(t);
 await item('closed').click({button:'right'});assert.deepEqual(await selected(),['closed']);
 await page.getByRole('menuitem',{name:'删除曲线',exact:true}).click();
 const single=await save();assert.deepEqual(single.paths,initial.paths.filter(p=>p.id!=='closed'));
 assert.deepEqual(single.layers[0].pathIds,['curve-a','curve-c']);
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(await selected(),['closed']);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,single.paths);await page.locator('#undo').click();
 await item('curve-a').click();await item('curve-b').click({modifiers:['Shift']});await item('closed').click({modifiers:['Shift']});
 await item('curve-a').click({button:'right'});assert.deepEqual(await selected(),['curve-b','curve-a','closed']);
 await page.getByRole('menuitem',{name:'删除所选曲线',exact:true}).click();
 const multiple=await save();assert.deepEqual(multiple.paths,initial.paths.filter(p=>['curve-c','locked'].includes(p.id)));
 assert.deepEqual(multiple.layers[0].pathIds,['curve-c']);assert.deepEqual(multiple.layers[2].pathIds,[]);
 assert.deepEqual(await selected(),[]);await page.locator('#undo').click();
 const restored=await save();assert.deepEqual(restored.paths,initial.paths);assert.deepEqual(restored.layers,initial.layers.map(l=>({...l,textIds:[]})));
 assert.deepEqual(await selected(),['curve-b','curve-a','closed']);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.deepEqual((await save()).paths,multiple.paths);
 await page.reload();await expandLayerContents(page);await item('curve-c').waitFor();await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 assert.deepEqual(errors,[]);
});

test('canvas context menu deletes curves and preserves a curve multiselection even when right-clicking an anchor',async t=>{
 const {page,initial,errors,item,selected,save}=await setup(t);
 const rightPoint=async(p,expectedPath)=>{const screen=await page.locator('#viewport').evaluate((el,p)=>{const s=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:s.x,y:s.y};},p);if(expectedPath)assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.getAttribute('data-path'),screen),expectedPath);await page.mouse.click(screen.x,screen.y,{button:'right'});};
 await rightPoint(initial.paths[2].nodes[0]);
 assert.equal(await page.getByRole('menuitem',{name:'删除这个节点',exact:true}).isVisible(),true);
 assert.equal(await page.getByRole('menuitem',{name:'删除曲线',exact:true}).count(),0);
 await page.keyboard.press('Escape');await page.locator('[data-tool="select"]').click();await rightPoint(initial.paths[2].nodes[0]);
 await page.getByRole('menuitem',{name:'删除曲线',exact:true}).click();
 assert.deepEqual((await save()).paths,initial.paths.filter(p=>p.id!=='curve-c'));
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 await page.locator('[data-tool="node"]').click();
 await item('curve-a').click();await item('curve-b').click({modifiers:['Shift']});await rightPoint(initial.paths[0].nodes[0],'curve-a');
 assert.deepEqual(await selected(),['curve-b','curve-a']);
 await page.getByRole('menuitem',{name:'删除所选曲线',exact:true}).click();
 const removed=await save();assert.deepEqual(removed.paths,initial.paths.slice(2));
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(await selected(),['curve-b','curve-a']);
 await page.locator('[data-tool="select"]').click();await rightPoint(g.at(initial.paths[1].nodes[0],initial.paths[1].nodes[1],.4));
 assert.deepEqual(await selected(),['curve-b','curve-a']);await page.getByRole('menuitem',{name:'删除所选曲线',exact:true}).click();
 assert.deepEqual((await save()).paths,removed.paths);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 assert.deepEqual(errors,[]);
});
