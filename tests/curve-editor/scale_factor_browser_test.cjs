// All scaling, saving and reload checks use an isolated temporary project.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),G=require('../../tools/curve-editor/geometry.js'),L=require('../../tools/curve-editor/layers.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
async function setup(t,{mutate}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-scale-factor-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,x)=>({id,name:id,color:'#e04544',role:'outline',closed:true,note:'cut',nodes:[{...G.node(x,100),out:{x:x+30,y:120}},{...G.node(x+100,100),in:{x:x+70,y:120}},G.node(x+100,150),G.node(x,150)]});
 const line=(id,a,b)=>({id,name:id,color:'#123456',role:'outline',closed:false,note:'',nodes:[G.node(...a),G.node(...b)]});
 const layer=(id,pathIds=[],imageIds=[],textIds=[],extra={})=>({id,name:id,visible:true,locked:false,pathIds,imageIds,textIds,...extra});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'倍率缩放验证',width:1000,height:700,image:null,opacity:1,originals:[],
  calibration:{a:{x:0,y:0},b:{x:10,y:0},length:5,unit:'mm'},
  paths:[curve('p',100),curve('q',400),line('horizontal',[100,300],[200,300]),line('vertical',[300,300],[300,400]),curve('hidden',600),curve('locked',700)],
  images:[{id:'i',name:'图片',dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=',x:250,y:250,width:120,height:60,rotation:45,opacity:1}],
  texts:[{id:'t',name:'文字',content:'切割',x:500,y:300,fontSize:20,color:'#123456',rotation:30}],
  layers:[layer('group',[],[],[],{kind:'group'}),layer('main',['p'],[],[],{parentId:'group'}),layer('other',['q'],[],[],{parentId:'group'}),layer('bitmap',[],['i'],[],{parentId:'group'}),layer('text',[],[],['t'],{parentId:'group'}),layer('hidden',['hidden'],[],[],{parentId:'group',visible:false}),layer('locked',['locked'],[],[],{parentId:'group',locked:true}),layer('horizontal',['horizontal']),layer('vertical',['vertical'])]};
 mutate?.(initial);
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);
 await page.locator('.layer-row[data-layer="main"]').waitFor();const properties=page.locator('.panel-group[data-panel="properties"]');if(!await properties.getAttribute('open'))await properties.locator('summary').click();
 const row=id=>page.locator(`.layer-row[data-layer="${id}"] .layer-select`);
 const save=async()=>{const wait=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await wait).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const scale=async(factor,enter=false)=>{await page.locator('#element-scale-factor').fill(String(factor));if(enter)await page.locator('#element-scale-factor').press('Enter');else await page.locator('#scale-elements').click();};
 return {page,initial,row,save,scale,errors};
}
function assertScaled(actual,before,center,factor){
 assert.equal(actual.nodes.length,before.nodes.length);assert.equal(actual.closed,before.closed);assert.equal(actual.name,before.name);
 before.nodes.forEach((node,i)=>{assert.equal(actual.nodes[i].mode,node.mode);for(const key of [null,'in','out']){const a=key?actual.nodes[i][key]:actual.nodes[i],b=key?node[key]:node;close(a.x,center.x+(b.x-center.x)*factor);close(a.y,center.y+(b.y-center.y)*factor);}});
}
test('factor 2 scales the entire selected Bézier about its center, with undo, recovery and doubled physical export',async t=>{
 const {page,initial,row,save,scale,errors}=await setup(t);
 assert.equal(await page.locator('#element-scale-factor').count(),1,'a direct scale factor field must exist');
 await row('main').click();await page.locator('#keep-ratio').uncheck();await scale(2);
 let result=await save();assertScaled(result.paths[0],initial.paths[0],{x:150,y:125},2);assert.notEqual(result.paths[0].color,initial.paths[0].color);assert.deepEqual(result.paths.slice(1),initial.paths.slice(1));assert.deepEqual(result.calibration,initial.calibration);
 close(Number(await page.locator('#element-width').inputValue()),200);close(Number(await page.locator('#element-height').inputValue()),100);assert.equal(await page.locator('#element-scale-factor').inputValue(),'1');assert.equal(await page.locator('#element-count').textContent(),'1 个元素');
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);await page.locator('#redo').click();assert.deepEqual((await save()).paths,result.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.deepEqual((await save()).paths,result.paths);
 await row('main').click();await page.locator('#export-layers').click();await page.locator('#vector-export-format').selectOption('svg');assert.match(await page.locator('#vector-export-size').textContent(),/100\.000 × 高 50\.000 mm/);
 const download=page.waitForEvent('download');await page.locator('#vector-export-confirm').click();const file=await download,svg=await readFile(await file.path(),'utf8');assert.match(svg,/width="100mm"/);assert.match(svg,/height="50mm"/);
 await scale(.5,true);const halved=await save();assert.deepEqual({...halved.paths[0],color:initial.paths[0].color},initial.paths[0]);assert.notEqual(halved.paths[0].color,result.paths[0].color);await scale(1.25,true);result=await save();assertScaled(result.paths[0],initial.paths[0],{x:150,y:125},1.25);assert.deepEqual(errors,[]);
 if(process.env.CURVE_EDITOR_SCALE_SCREENSHOT){await page.locator('#element-scale-factor').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.CURVE_EDITOR_SCALE_SCREENSHOT,fullPage:true});}
});
test('empty, invalid, no-op and out-of-range factors leave artwork and undo history intact; zero-width lines scale too',async t=>{
 const {page,initial,row,save,scale,errors}=await setup(t);
 assert.equal(await page.locator('#scale-elements').count(),1,'an explicit scale action must exist');
 await page.locator('#deselect').click();assert.equal(await page.locator('#scale-elements').isDisabled(),true);assert.equal(await page.locator('#element-scale-factor').isDisabled(),true);await row('main').click();
 for(const factor of ['',0,-2,1e20]){await scale(factor);assert.match(await page.locator('#status').textContent(),/倍数|范围/);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);}
 await scale(1);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 for(const id of ['horizontal','vertical']){await row(id).click();await scale(2,true);const result=await save(),index=initial.paths.findIndex(p=>p.id===id),b=G.pathBounds(initial.paths[index]);assertScaled(result.paths[index],initial.paths[index],{x:b.x+b.width/2,y:b.y+b.height/2},2);await page.locator('#undo').click();}
 assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});
test('a selected group scales curves, rotated images and text together and skips hidden and locked members',async t=>{
 const {page,initial,row,save,scale,errors}=await setup(t);await row('group').click();assert.equal(await page.locator('#element-count').textContent(),'4 个元素');
 // Formatted UI dimensions are rounded to four decimals; use full precision for geometry assertions.
 const b=L.bounds(initial,['p','q'],['i'],['t']),center={x:b.x+b.width/2,y:b.y+b.height/2};await scale(2);const result=await save();
 for(let i=0;i<2;i++)assertScaled(result.paths[i],initial.paths[i],center,2);assert.deepEqual(result.paths.slice(2),initial.paths.slice(2));
 close(result.images[0].width,240);close(result.images[0].height,120);assert.equal(result.images[0].rotation,45);assert.equal(result.images[0].dataUrl,initial.images[0].dataUrl);close(result.images[0].x+120,center.x+(310-center.x)*2);close(result.images[0].y+60,center.y+(280-center.y)*2);
 close(result.texts[0].fontSize,40);close(result.texts[0].x,center.x+(500-center.x)*2);close(result.texts[0].y,center.y+(300-center.y)*2);assert.equal(result.texts[0].rotation,30);assert.equal(result.texts[0].content,initial.texts[0].content);assert.equal(await page.locator('#element-count').textContent(),'4 个元素');
 await page.locator('#undo').click();const restored=await save();assert.deepEqual(restored.paths,initial.paths);assert.deepEqual(restored.images,initial.images);assert.deepEqual(restored.texts,initial.texts);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});

test('keep original creates a differently colored editable scale copy in the same layer with reversible history and recovery',async t=>{
 const {page,initial,row,save,scale,errors}=await setup(t);assert.equal(await page.locator('#scale-keep-original').count(),1,'keep-original option must exist');
 assert.equal(await page.locator('#scale-keep-original').isChecked(),false);await row('main').click();await page.locator('#scale-keep-original').check();
 for(const factor of [1,0,1e20]){await scale(factor);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);}
 await scale(2,true);const result=await save(),copy=result.paths.at(-1),source=initial.paths[0];assert.equal(result.paths.length,initial.paths.length+1);assert.deepEqual(result.paths.slice(0,-1),initial.paths);assert.deepEqual(result.images,initial.images);assert.deepEqual(result.texts,initial.texts);assert.deepEqual(result.calibration,initial.calibration);
 assert.notEqual(copy.id,source.id);assert.match(copy.name,/缩放副本/);assert.notEqual(copy.color,source.color);assertScaled({...copy,name:source.name},source,{x:150,y:125},2);assert.equal(copy.role,source.role);assert.equal(copy.note,source.note);assert.deepEqual(result.layers.find(l=>l.id==='main').pathIds,[source.id,copy.id]);assert.equal(await page.locator('#path-color').inputValue(),copy.color);
 if(process.env.CURVE_EDITOR_SCALE_COPY_SCREENSHOT){const toggle=page.locator('.panel-group[data-panel="layers"] > summary');await toggle.click();await page.locator('#scale-keep-original').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.CURVE_EDITOR_SCALE_COPY_SCREENSHOT,fullPage:true});await toggle.click();}
 assert.equal(await page.locator('.curve-select[aria-pressed="true"]').count(),1);assert.equal(await page.locator('.curve-item[data-path="'+copy.id+'"] .curve-select').getAttribute('aria-pressed'),'true');
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);await page.locator('#redo').click();assert.deepEqual((await save()).paths,result.paths);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.deepEqual((await save()).paths,result.paths);
 // Editing the copy keeps the original intact.
 const collapse=page.locator('.layer-row[data-layer="main"] [data-action="collapse"]');if(await collapse.getAttribute('aria-expanded')==='false')await collapse.click();await page.locator('.curve-item[data-path="'+copy.id+'"] .curve-select').click();await page.locator('#canvas').focus();await page.keyboard.press('ArrowRight');const moved=await save();assert.deepEqual(moved.paths.slice(0,-1),initial.paths);close(moved.paths.at(-1).nodes[0].x,copy.nodes[0].x+1);assert.equal(moved.paths.at(-1).color,copy.color);assert.deepEqual(errors,[]);
});

test('copy scaling across layers preserves originals, uses a shared center and leaves the new copies selected for another scale',async t=>{
 const {page,initial,row,save,scale,errors}=await setup(t);await row('main').click();await row('other').click({modifiers:['Shift']});await page.locator('#scale-keep-original').check();await scale(2);const result=await save(),copies=result.paths.slice(initial.paths.length),center={x:300,y:125};
 assert.equal(copies.length,2);assert.deepEqual(result.paths.slice(0,initial.paths.length),initial.paths);copies.forEach((copy,i)=>{assertScaled({...copy,name:initial.paths[i].name},initial.paths[i],center,2);assert.notEqual(copy.color,initial.paths[i].color);assert.ok(result.layers.find(l=>l.id===(i?'other':'main')).pathIds.includes(copy.id));});assert.notEqual(copies[0].color,copies[1].color);assert.equal(await page.locator('#element-count').textContent(),'2 个元素');
 await scale(.5);const again=await save(),next=again.paths.slice(result.paths.length);assert.deepEqual(again.paths.slice(0,result.paths.length),result.paths);next.forEach((copy,i)=>{assertScaled({...copy,name:initial.paths[i].name},initial.paths[i],center,1);assert.notEqual(copy.color,copies[i].color);});await page.locator('#undo').click();assert.deepEqual((await save()).paths,result.paths);assert.deepEqual(errors,[]);
});

test('mixed-content copy scaling preserves every original and the draw order of copied members',async t=>{
 const {page,initial,row,save,scale,errors}=await setup(t,{mutate:doc=>{
  const main=doc.layers.find(l=>l.id==='main');main.pathIds=['p','q'];main.imageIds=['i'];main.textIds=['t'];main.items=[{type:'image',id:'i'},{type:'path',id:'p'},{type:'text',id:'t'},{type:'path',id:'q'}];doc.layers=doc.layers.filter(l=>!['other','bitmap','text'].includes(l.id));
 }});await row('main').click();await page.locator('#scale-keep-original').check();await scale(2);const result=await save(),layer=result.layers.find(l=>l.id==='main'),original=initial.layers.find(l=>l.id==='main');assert.deepEqual(result.paths.slice(0,initial.paths.length),initial.paths);assert.deepEqual(result.images.slice(0,initial.images.length),initial.images);assert.deepEqual(result.texts.slice(0,initial.texts.length),initial.texts);assert.equal(result.paths.length,8);assert.equal(result.images.length,2);assert.equal(result.texts.length,2);assert.equal(layer.items.length,8);assert.deepEqual(layer.items.slice(0,4),original.items);assert.deepEqual(layer.items.slice(4).map(i=>i.type),original.items.map(i=>i.type));assert.equal(new Set(layer.items.map(i=>i.id)).size,8);assert.equal(await page.locator('#element-count').textContent(),'4 个元素');
 assert.equal(result.images[1].rotation,45);close(result.images[1].width,240);assert.equal(result.texts[1].rotation,30);close(result.texts[1].fontSize,40);await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.deepEqual(errors,[]);
});

test('copy scaling at the curve limit fails without partial copies, color changes or undo entries',async t=>{
 const {page,initial,row,save,scale,errors}=await setup(t,{mutate:doc=>{const layer=doc.layers.find(l=>l.id==='other');while(doc.paths.length<500){const p={...structuredClone(doc.paths[1]),id:'extra-'+doc.paths.length};doc.paths.push(p);layer.pathIds.push(p.id);}}});await row('main').click();await page.locator('#scale-keep-original').check();await scale(2);assert.match(await page.locator('#status').textContent(),/500/);assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);assert.deepEqual(errors,[]);
});
