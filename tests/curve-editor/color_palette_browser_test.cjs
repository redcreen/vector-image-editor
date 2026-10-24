// All scaling, saving and reload checks use an isolated temporary project.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),G=require('../../tools/curve-editor/geometry.js'),L=require('../../tools/curve-editor/layers.js');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
async function setup(t,{mutate}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-color-'));let server,browser;
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
 page.setDefaultTimeout(6000);await page.locator('.layer-row[data-layer="main"]').waitFor();const properties=page.locator('.panel-group[data-panel="properties"]');if(!await properties.getAttribute('open'))await properties.locator('summary').click();
 const row=id=>page.locator(`.layer-row[data-layer="${id}"] .layer-select`);
 const save=async()=>{const wait=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await wait).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const scale=async(factor,enter=false)=>{await page.locator('#element-scale-factor').fill(String(factor));if(enter)await page.locator('#element-scale-factor').press('Enter');else await page.locator('#scale-elements').click();};
 return {page,initial,row,save,scale,errors};
}

test('curve palette supports selection, mixed colors, independent undo, custom color and recovery without changing geometry',async t=>{
 const {page,initial,row,save,errors}=await setup(t);
 const blue=page.locator('[data-path-color="#176bce"]'),green=page.locator('[data-path-color="#13816c"]');
 assert.equal(await page.locator('[data-path-color]').count(),20);
 await page.locator('#deselect').click();assert.equal(await blue.isDisabled(),true);
 await row('main').click();await blue.click();
 let result=await save();assert.equal(result.paths[0].color,'#176bce');assert.deepEqual({...result.paths[0],color:initial.paths[0].color},initial.paths[0]);assert.deepEqual(result.paths.slice(1),initial.paths.slice(1));
 assert.equal(await blue.getAttribute('aria-pressed'),'true');await green.click();await page.locator('#undo').click();assert.equal((await save()).paths[0].color,'#176bce');
 await blue.click();await page.locator('#undo').click();assert.equal((await save()).paths[0].color,initial.paths[0].color);await page.locator('#redo').click();
 await row('group').click();assert.equal(await page.locator('[data-path-color][aria-pressed="true"]').count(),0);
 await green.click();result=await save();assert.deepEqual(result.paths.slice(0,2).map(p=>p.color),['#13816c','#13816c']);assert.deepEqual(result.paths.slice(2),initial.paths.slice(2));
 await page.locator('#path-color').fill('#123abc');await page.locator('#path-color').dispatchEvent('change');result=await save();assert.deepEqual(result.paths.slice(0,2).map(p=>p.color),['#123abc','#123abc']);assert.equal(await page.locator('[data-path-color][aria-pressed="true"]').count(),0);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.deepEqual((await save()).paths,result.paths);
 await row('main').click();await blue.click();await page.locator('#properties').scrollIntoViewIfNeeded();
 if(process.env.CURVE_EDITOR_COLOR_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_COLOR_SCREENSHOT});
 assert.deepEqual(errors,[]);
});
