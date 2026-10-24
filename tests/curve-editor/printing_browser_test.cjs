const {test}=require('node:test');const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');
async function setup(t,calibration=true){
 const project=await mkdtemp(path.join(tmpdir(),'curve-print-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const initial={format:'daban-curve-editor',version:1,title:'实际尺寸测试',width:500,height:400,units:'image-px',images:[],texts:[],originals:[],paths:[{id:'a',name:'曲线甲',color:'#123456',closed:true,nodes:[G.node(0,0),G.node(100,0),G.node(100,50),G.node(0,50)]},{id:'b',name:'曲线乙',color:'#123456',nodes:[G.node(200,0),G.node(350,300)]},{id:'h',name:'隐藏曲线',nodes:[G.node(900,0),G.node(1000,100)]}],layers:[{id:'l',name:'曲线',pathIds:['a','b'],imageIds:[],visible:true,locked:false},{id:'hidden',name:'隐藏层',pathIds:['h'],imageIds:[],visible:false,locked:false}],calibration:calibration?{a:{x:0,y:0},b:{x:100,y:0},length:10,unit:'cm'}:null};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'initial.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'initial.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.print=()=>{document.documentElement.dataset.printRequested='true';};});
 await page.goto(url);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 await expandLayerContents(page);
 const choose=async(name,multiple=false)=>page.locator('#layer-list .curve-select').filter({hasText:name}).click(multiple?{modifiers:['Shift']}:{});
 const state=()=>page.evaluate(()=>({paths:document.querySelector('#paths').innerHTML,undo:document.querySelector('#undo').title,redo:document.querySelector('#redo').title,storage:document.querySelector('#history-storage').textContent}));
 return {page,errors,choose,state};
}
test('print requires a selection and calibration, and guides users to two-point calibration',async t=>{
 const {page,errors,choose,state}=await setup(t,false);await page.locator('#deselect').click();const before=await state();
 await page.locator('#print-selected').click();assert.match(await page.locator('#print-size').textContent(),/选择/);assert.equal(await page.locator('#print-confirm').isDisabled(),true);await page.locator('#print-cancel').click();
 await choose('曲线甲');await page.locator('#print-selected').click();assert.match(await page.locator('#print-size').textContent(),/标定/);assert.equal(await page.locator('#print-confirm').isDisabled(),true);
 await page.locator('#print-calibrate').click();assert.equal(await page.locator('#calibrate').getAttribute('aria-pressed'),'true');assert.equal((await state()).undo,before.undo);assert.deepEqual(errors,[]);
});
test('browser print receives selected curves at calibrated mm size and preserves history',async t=>{
 const {page,errors,choose,state}=await setup(t);await choose('曲线甲');await page.locator('#canvas').focus();await page.keyboard.press('ArrowRight');await page.locator('#undo').click();
 await page.locator('#zoom-in').click();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});const before=await state();await page.locator('#print-selected').click();assert.match(await page.locator('#print-size').textContent(),/100\.00 × 高 50\.00 mm · 1:1/);
 if(process.env.CURVE_EDITOR_PRINT_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_PRINT_SCREENSHOT,fullPage:true});
 await page.locator('#print-confirm').click();const frame=page.frameLocator('#curve-print-frame');await frame.locator('html[data-print-requested=true]').waitFor();
 assert.equal(await frame.locator('.print-sheet').count(),1);assert.equal(await frame.locator('[data-curve=a]').count(),1);assert.equal(await frame.locator('[data-curve=b]').count(),0);assert.equal(await frame.locator('[data-curve=h]').count(),0);
 assert.equal(await frame.locator('.print-curves').getAttribute('width'),'190mm');assert.equal(await frame.locator('.print-curves').getAttribute('viewBox'),'0 0 190 267');
 assert.deepEqual(await state(),before);await page.locator('#print-cancel').click();assert.deepEqual(errors,[]);
});
test('multiple curves tile without shrinking, paper changes retile, and modal keys leave artwork intact',async t=>{
 const {page,errors,choose,state}=await setup(t);await choose('曲线甲');await choose('曲线乙',true);const before=await state();
 await page.locator('#canvas').focus();await page.keyboard.press('Control+p');await page.locator('#print-dialog[open]').waitFor();assert.match(await page.locator('#print-pages').textContent(),/共 4 页/);
 await page.locator('#print-cancel').focus();await page.keyboard.press('Control+z');await page.keyboard.press('Delete');await page.evaluate(()=>{const data=new DataTransfer();data.setData('text/plain','test');document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});assert.deepEqual(await state(),before);
 await page.locator('#print-paper').selectOption('A3');await page.locator('#print-orientation').selectOption('landscape');assert.match(await page.locator('#print-pages').textContent(),/共 2 页/);assert.match(await page.locator('#print-size').textContent(),/350\.00 × 高 300\.00/);
 await page.locator('#print-confirm').click();const frame=page.frameLocator('#curve-print-frame');await frame.locator('html[data-print-requested=true]').waitFor();assert.equal(await frame.locator('.print-sheet').count(),2);assert.equal(await frame.locator('.print-curves').first().getAttribute('width'),'400mm');
 await page.locator('#print-cancel').click();assert.deepEqual(await state(),before);assert.deepEqual(errors,[]);
});
test('curve context menu offers selected curve printing',async t=>{
 const {page,errors}=await setup(t);await page.locator('#layer-list .curve-select').filter({hasText:'曲线甲'}).click({button:'right'});await page.getByRole('menuitem',{name:'打印选中曲线…',exact:true}).click();await page.locator('#print-dialog[open]').waitFor();assert.match(await page.locator('#print-size').textContent(),/100\.00/);await page.keyboard.press('Escape');assert.equal(await page.locator('#print-dialog').isVisible(),false);assert.deepEqual(errors,[]);
});
