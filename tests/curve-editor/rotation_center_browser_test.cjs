// Draggable rotation-center interaction tests use an isolated temporary project.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<.002,message||`${actual} != ${expected}`);
const rotatePoint=(point,center,degrees)=>{const a=degrees*Math.PI/180,dx=point.x-center.x,dy=point.y-center.y;return {x:center.x+dx*Math.cos(a)-dy*Math.sin(a),y:center.y+dx*Math.sin(a)+dy*Math.cos(a)};};

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-rotation-center-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}await rm(project,{recursive:true,force:true});});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'旋转中心测试',width:800,height:600,image:null,opacity:1,originals:[],
  paths:[
   {id:'moving',name:'待旋转',color:'#e04544',role:'outline',closed:false,note:'',nodes:[
    {x:100,y:100,in:{x:80,y:90},out:{x:130,y:110},mode:'smooth'},
    {x:200,y:220,in:{x:170,y:190},out:{x:225,y:240},mode:'smooth'}]},
   {id:'other',name:'其他可编辑曲线',color:'#176bce',role:'outline',closed:false,note:'',nodes:[{x:500,y:120,in:{x:500,y:120},out:{x:500,y:120},mode:'cusp'},{x:560,y:190,in:{x:560,y:190},out:{x:560,y:190},mode:'cusp'}]},
   {id:'locked-target',name:'锁定吸附点',color:'#18804a',role:'outline',closed:false,note:'',nodes:[{x:320,y:260,in:{x:320,y:260},out:{x:320,y:260},mode:'cusp'},{x:380,y:300,in:{x:380,y:300},out:{x:380,y:300},mode:'cusp'}]},
   {id:'hidden-target',name:'隐藏吸附点',color:'#777777',role:'outline',closed:false,note:'',nodes:[{x:420,y:260,in:{x:420,y:260},out:{x:420,y:260},mode:'cusp'},{x:470,y:310,in:{x:470,y:310},out:{x:470,y:310},mode:'cusp'}]}],
  texts:[],images:[],layers:[
   {id:'move-layer',name:'待旋转',visible:true,locked:false,pathIds:['moving'],imageIds:[],textIds:[]},
   {id:'other-layer',name:'其他',visible:true,locked:false,pathIds:['other'],imageIds:[],textIds:[]},
   {id:'locked-layer',name:'锁定参考',visible:true,locked:true,pathIds:['locked-target'],imageIds:[],textIds:[]},
   {id:'hidden-layer',name:'隐藏参考',visible:false,locked:false,pathIds:['hidden-target'],imageIds:[],textIds:[]}]};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error(output||'server timeout')),10000);server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());await page.goto(url);await page.locator('.layer-row[data-layer="move-layer"]').waitFor();
 const closed=page.locator('.panel-group:not([open]):not([data-panel="help"]) > summary');while(await closed.count())await closed.first().click();
 const row=id=>page.locator(`.layer-row[data-layer="${id}"] .layer-select`);
 const screen=point=>page.locator('#viewport').evaluate((element,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(element.getScreenCTM());return {x:q.x,y:q.y};},point);
 const pivot=async()=>{const circle=page.locator('[data-rotation-center]');return {x:Number(await circle.getAttribute('cx')),y:Number(await circle.getAttribute('cy'))};};
 const dragPivot=async(point,options={})=>{const circle=page.locator('[data-rotation-center]'),box=await circle.boundingBox(),to=await screen(point);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();if(options.alt)await page.keyboard.down('Alt');await page.mouse.move(to.x,to.y,{steps:8});if(options.escape)await page.keyboard.press('Escape');else await page.mouse.up();if(options.alt)await page.keyboard.up('Alt');};
 const latest=()=>page.evaluate(()=>fetch('/api/latest').then(response=>response.json()));
 const save=async()=>{const response=page.waitForResponse(item=>item.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return latest();};
 return {page,initial,row,screen,pivot,dragPivot,latest,save,errors};
}

test('free-dragged center drives numeric rotation of nodes and handles without becoming document geometry',async t=>{
 const {page,initial,row,pivot,dragPivot,latest,save,errors}=await setup(t);await row('move-layer').click();await page.locator('[data-rotation-center]').waitFor();
 const center={x:260,y:180};await dragPivot(center);const placed=await pivot();close(placed.x,center.x);close(placed.y,center.y);
 if(process.env.CURVE_EDITOR_ROTATION_CENTER_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_ROTATION_CENTER_SCREENSHOT,fullPage:true});
 assert.deepEqual((await latest()).paths,initial.paths,'moving the center must not edit saved artwork');assert.equal(await page.locator('#undo').isDisabled(),true,'moving the center must not add an undo step');
 await page.locator('#element-rotation').fill('90');await page.locator('#rotate-curves').click();const result=await save();
 for(let i=0;i<initial.paths[0].nodes.length;i++)for(const key of ['x','y'])close(result.paths[0].nodes[i][key],rotatePoint(initial.paths[0].nodes[i],center,90)[key]);
 for(let i=0;i<initial.paths[0].nodes.length;i++)for(const side of ['in','out'])for(const key of ['x','y'])close(result.paths[0].nodes[i][side][key],rotatePoint(initial.paths[0].nodes[i][side],center,90)[key]);
 assert.deepEqual(result.paths.slice(1),initial.paths.slice(1),'unselected reference curves remain fixed');assert.deepEqual(errors,[]);
});

test('center snaps exactly to visible locked nodes, ignores hidden nodes, and Alt bypasses snapping',async t=>{
 const {page,initial,row,screen,pivot,save,errors}=await setup(t);await row('move-layer').click();const circle=page.locator('[data-rotation-center]');await circle.waitFor();
 const dragNear=async(point,{alt=false}={})=>{const box=await circle.boundingBox(),to=await screen(point);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();if(alt)await page.keyboard.down('Alt');await page.mouse.move(to.x,to.y,{steps:8});const during=await pivot(),snapped=await circle.getAttribute('data-snapped');await page.mouse.up();if(alt)await page.keyboard.up('Alt');return {during,snapped};};
 let result=await dragNear({x:326,y:263});close(result.during.x,320);close(result.during.y,260);assert.equal(result.snapped,'true','visible locked node should report snapping');
 await page.locator('#reset-rotation-center').click();result=await dragNear({x:326,y:263},{alt:true});close(result.during.x,326);close(result.during.y,263);assert.notEqual(result.snapped,'true','Alt must bypass node snapping');
 await page.locator('#reset-rotation-center').click();result=await dragNear({x:425,y:264});close(result.during.x,425);close(result.during.y,264);assert.notEqual(result.snapped,'true','hidden nodes must not attract the center');
 await page.locator('#reset-rotation-center').click();await dragNear({x:326,y:263});await page.locator('#element-rotation').fill('90');await page.locator('#rotate-curves').click();const rotated=await save(),expected=rotatePoint(initial.paths[0].nodes[0],{x:320,y:260},90);close(rotated.paths[0].nodes[0].x,expected.x);close(rotated.paths[0].nodes[0].y,expected.y);assert.deepEqual(rotated.paths[2],initial.paths[2],'the locked snap endpoint must stay fixed');assert.deepEqual(errors,[]);
});

test('rotation handle uses the custom center and Shift snaps the result to fifteen degrees',async t=>{
 const {page,initial,row,screen,dragPivot,save,pivot,errors}=await setup(t);await row('move-layer').click();const center={x:280,y:300};await dragPivot(center);const fixed=await pivot();close(fixed.x,center.x);close(fixed.y,center.y);
 const handle=page.locator('[data-rotate]'),box=await handle.boundingBox(),start={x:box.x+box.width/2,y:box.y+box.height/2},centerScreen=await screen(center),radians=22*Math.PI/180,dx=start.x-centerScreen.x,dy=start.y-centerScreen.y;
 const end={x:centerScreen.x+dx*Math.cos(radians)-dy*Math.sin(radians),y:centerScreen.y+dx*Math.sin(radians)+dy*Math.cos(radians)};
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.keyboard.down('Shift');await page.mouse.move(end.x,end.y,{steps:10});await page.mouse.up();await page.keyboard.up('Shift');const result=await save();
 for(let i=0;i<initial.paths[0].nodes.length;i++){const expected=rotatePoint(initial.paths[0].nodes[i],center,15);close(result.paths[0].nodes[i].x,expected.x);close(result.paths[0].nodes[i].y,expected.y);}close((await pivot()).x,center.x);close((await pivot()).y,center.y);assert.deepEqual(errors,[]);
});

test('reset and a differing element selection restore each selection default center',async t=>{
 const {page,row,pivot,dragPivot,errors}=await setup(t);await row('move-layer').click();const original=await pivot();await dragPivot({x:275,y:245});await page.locator('#reset-rotation-center').click();let current=await pivot();close(current.x,original.x);close(current.y,original.y);
 await dragPivot({x:275,y:245});await row('other-layer').click();current=await pivot();assert.ok(Math.abs(current.x-275)>.01||Math.abs(current.y-245)>.01,'different selection must not inherit the previous custom center');
 await row('move-layer').click();current=await pivot();close(current.x,original.x);close(current.y,original.y);assert.deepEqual(errors,[]);
});

test('Esc cancellation and center-only gestures preserve artwork, undo, and redo history in node and select modes',async t=>{
 const {page,initial,row,pivot,dragPivot,save,errors}=await setup(t);await row('move-layer').click();const original=await pivot();await dragPivot({x:270,y:230},{escape:true});let current=await pivot();close(current.x,original.x);close(current.y,original.y);let box=await page.locator('[data-rotation-center]').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('[data-tool="select"]').click();await dragPivot({x:260,y:180});await page.locator('#element-rotation').fill('30');await page.locator('#rotate-curves').click();const rotated=await save();await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#redo').isEnabled(),true);
 current=await pivot();close(current.x,260);close(current.y,180);await dragPivot({x:290,y:210});assert.equal(await page.locator('#redo').isEnabled(),true,'moving only the center must not clear redo');await page.locator('#redo').click();assert.deepEqual((await save()).paths,rotated.paths);assert.deepEqual(errors,[]);
});

test('custom center survives automatic snapshot recovery after refresh',async t=>{
 const {page,row,pivot,dragPivot,errors}=await setup(t);await row('move-layer').click();const center={x:290,y:235};await dragPivot(center);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('[data-rotation-center]').waitFor();const recovered=await pivot();close(recovered.x,center.x);close(recovered.y,center.y);assert.deepEqual(errors,[]);
});

test('a node above a coincident custom center remains editable in node mode and the center remains draggable in select mode',async t=>{
 const {page,row,screen,pivot,dragPivot,save,errors}=await setup(t);await row('move-layer').click();await dragPivot({x:100,y:100});let center=await pivot();close(center.x,100);close(center.y,100);
 await page.keyboard.press('F10');const anchor=page.locator('#handles [data-path="moving"][data-node="0"]:not([data-side])');await anchor.waitFor();
 const box=await anchor.boundingBox(),target={x:118,y:126},to=await screen(target);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();let result=await save();close(result.paths[0].nodes[0].x,target.x);close(result.paths[0].nodes[0].y,target.y);
 await page.keyboard.press('v');center=await pivot();close(center.x,100);close(center.y,100);await dragPivot({x:250,y:250});center=await pivot();close(center.x,250);close(center.y,250);result=await save();close(result.paths[0].nodes[0].x,target.x);close(result.paths[0].nodes[0].y,target.y);assert.deepEqual(errors,[]);
});

test('Ctrl temporary pan can cancel or resume a rotation-center drag without committing artwork history',async t=>{
 const {page,initial,row,screen,pivot,save,errors}=await setup(t);await row('move-layer').click();const circle=page.locator('[data-rotation-center]'),original=await pivot();
 const startDrag=async()=>{const box=await circle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();};
 await startDrag();let to=await screen({x:250,y:210});await page.mouse.move(to.x,to.y,{steps:5});await page.keyboard.down('Control');await page.mouse.move(to.x+45,to.y+30,{steps:5});await page.keyboard.press('Escape');await page.keyboard.up('Control');await page.mouse.up();let center=await pivot();close(center.x,original.x);close(center.y,original.y);
 await startDrag();to=await screen({x:240,y:200});await page.mouse.move(to.x,to.y,{steps:5});await page.keyboard.down('Control');await page.mouse.move(to.x+40,to.y+25,{steps:5});await page.keyboard.up('Control');const expected={x:300,y:245};to=await screen(expected);await page.mouse.move(to.x,to.y,{steps:5});await page.mouse.up();center=await pivot();close(center.x,expected.x);close(center.y,expected.y);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});
