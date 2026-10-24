// All list gestures run in a temporary project, away from user canvases.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-list-editing-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const curve=(id,x)=>({id,name:`曲线 ${id.toUpperCase()}`,role:'outline',color:'#e04544',closed:false,note:'保留说明',nodes:[G.node(x,100),G.node(x+100,200)]});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',calibration:{a:{x:0,y:0},b:{x:1,y:0},length:1,unit:'mm'},title:'列表编辑测试',width:1000,height:700,image:null,opacity:.65,originals:[],images:[],paths:[curve('a',100),curve('b',300),curve('c',500)],layers:[{id:'layer-a',name:'图层 A',visible:true,locked:false,pathIds:['a','b'],imageIds:[]},{id:'layer-c',name:'图层 C',visible:true,locked:false,pathIds:['c'],imageIds:[]}]};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('.layer-row').filter({hasText:'图层 A'}).waitFor();
 await page.locator('[data-panel="curves"] > summary').click();
 const layerRow=id=>page.locator(`.layer-row[data-layer="layer-${id}"]`);
 const expandLayer=async id=>{const button=layerRow(id).locator('[data-action="collapse"]');if(await button.getAttribute('aria-expanded')==='false')await button.click();};
 const expandLayers=async()=>{await expandLayer('a');await expandLayer('c');};
 await expandLayers();
 const curveRow=id=>page.locator('#layer-list .curve-item').filter({has:page.locator(`span`,{hasText:`曲线 ${id.toUpperCase()}`})});
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 return {page,initial,errors,curveRow,layerRow,expandLayers,save};
}

test('curve visibility preserves its list entry and siblings, clears selection and survives undo and reload',async t=>{
 const {page,initial,errors,curveRow,layerRow,expandLayers,save}=await setup(t);
 const eye=()=>curveRow('a').getByRole('button',{name:/^(隐藏|显示)曲线 曲线 A$/});
 await curveRow('a').click();await curveRow('b').click({modifiers:['Shift']});
 assert.equal(await eye().count(),1);
 await eye().click();
 assert.equal(await eye().getAttribute('aria-pressed'),'false');
 assert.equal(await curveRow('a').count(),1);assert.equal(await curveRow('a').getAttribute('aria-pressed'),'false');
 assert.equal(await curveRow('b').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('#paths [data-path="a"],#handles [data-path="a"]').count(),0);
 assert.equal(await page.locator('#paths .svg-curve').count(),2);
 assert.match(await page.locator('#history-list').textContent(),/显示 \/ 隐藏曲线/);
 if(process.env.CURVE_EDITOR_VISIBILITY_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_VISIBILITY_SCREENSHOT,fullPage:true});
 let saved=await save();assert.deepEqual(saved.paths,initial.paths.map(p=>p.id==='a'?{...p,visible:false}:p));assert.deepEqual(saved.layers,initial.layers.map(l=>({...l,textIds:[]})));
 await page.locator('#undo').click();assert.equal(await eye().getAttribute('aria-pressed'),'true');assert.equal(await curveRow('a').getAttribute('aria-pressed'),'true');
 await page.locator('#redo').click();assert.equal(await eye().getAttribute('aria-pressed'),'false');
 const download=page.waitForEvent('download');await page.locator('#export').click();await page.locator('#vector-export-format').selectOption('svg');await page.locator('#vector-export-confirm').click();const svg=await (await download).createReadStream();let exported='';for await(const chunk of svg)exported+=chunk;
 assert.doesNotMatch(exported,/<title>曲线 A<\/title>/);assert.match(exported,/<title>曲线 B<\/title>/);
 await page.reload();await layerRow('a').waitFor();await expandLayers();await curveRow('a').waitFor();assert.equal(await eye().getAttribute('aria-pressed'),'false');assert.deepEqual((await save()).paths,saved.paths);
 await page.locator('#project-file').setInputFiles({name:'隐藏曲线.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('已打开 隐藏曲线.json'));
 assert.equal(await eye().getAttribute('aria-pressed'),'false');
 await page.locator('#select-all').click();assert.equal(await curveRow('a').getAttribute('aria-pressed'),'false');assert.equal(await curveRow('b').getAttribute('aria-pressed'),'true');assert.equal(await curveRow('c').getAttribute('aria-pressed'),'true');
 await layerRow('a').locator('[data-action="visible"]').click();assert.equal(await curveRow('a').count(),1);assert.equal(await curveRow('a').locator('.curve-select').isDisabled(),true);
 await layerRow('a').locator('[data-action="visible"]').click();assert.equal(await eye().getAttribute('aria-pressed'),'false');
 await eye().focus();await page.keyboard.press('Space');assert.equal(await eye().getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#paths .svg-curve').count(),3);
 await layerRow('a').locator('[data-action="locked"]').click();assert.equal(await eye().isDisabled(),true);
 assert.deepEqual(errors,[]);
});

test('the visibility click that confirms a curve rename also hides that curve as a separate undo step',async t=>{
 const {page,initial,errors,curveRow,save}=await setup(t);
 await curveRow('a').locator('span').dblclick();
 await page.getByRole('textbox',{name:'曲线名称',exact:true}).fill('重命名后隐藏');
 const eye=page.locator('.curve-item[data-path="a"] .curve-visibility'),bounds=await eye.boundingBox();
 await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
 let saved=await save();assert.deepEqual(saved.paths[0],{...initial.paths[0],name:'重命名后隐藏',visible:false});
 assert.equal(await eye.getAttribute('aria-label'),'显示曲线 重命名后隐藏');
 await page.locator('#undo').click();saved=await save();assert.deepEqual(saved.paths[0],{...initial.paths[0],name:'重命名后隐藏'});
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);
 assert.deepEqual(errors,[]);
});

test('curve names edit on double click, commit on blur and preserve the following click',async t=>{
 const {page,initial,errors,curveRow,layerRow,expandLayers,save}=await setup(t);
 await curveRow('a').locator('span').dblclick();
 const input=page.getByRole('textbox',{name:'曲线名称',exact:true});await input.waitFor();assert.equal(await input.inputValue(),'曲线 A');
 await input.fill('  新曲线名称  ');
 await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(await input.count(),1);
 if(process.env.CURVE_EDITOR_LIST_EDITING_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_LIST_EDITING_SCREENSHOT,fullPage:true});
 // The next row must still receive the click that blurs the editor.
 const target=await curveRow('b').boundingBox();await page.mouse.click(target.x+target.width/2,target.y+target.height/2);
 assert.equal(await input.count(),0);assert.equal(await curveRow('b').getAttribute('aria-pressed'),'true');
 let saved=await save();assert.deepEqual(saved.paths,initial.paths.map(p=>p.id==='a'?{...p,name:'新曲线名称'}:p));assert.deepEqual(saved.layers,initial.layers.map(l=>({...l,textIds:[]})));
 await page.locator('#undo').click();assert.deepEqual((await save()).paths,initial.paths);assert.equal(await page.locator('#undo').isDisabled(),true);
 await page.locator('#redo').click();assert.equal((await save()).paths[0].name,'新曲线名称');
 await page.locator('#layer-list .curve-item span').filter({hasText:'新曲线名称'}).dblclick();await input.fill('Enter 确认');await page.keyboard.press('Enter');
 assert.equal(await page.locator('#path-name').inputValue(),'Enter 确认');assert.equal(await page.locator('.layer-contents[data-owner="layer-a"] [data-path]').count(),2);assert.equal(await page.locator('.layer-contents[data-owner="layer-a"]').isVisible(),true);
 await page.locator('#undo').click();const history=await page.locator('#undo').getAttribute('title');
 for(const [value,key] of [['取消名称','Escape'],['   ','Enter'],['新曲线名称','Tab']]){
  await page.locator('#layer-list .curve-item span').filter({hasText:'新曲线名称'}).dblclick();await input.fill(value);await page.keyboard.press(key);
  assert.equal(await page.locator('#undo').getAttribute('title'),history);assert.equal(await page.locator('#redo').isDisabled(),false);
 }
 await page.locator('#redo').click();saved=await save();assert.equal(saved.paths[0].name,'Enter 确认');
 await page.reload();await layerRow('a').waitFor();await expandLayers();await page.locator('#layer-list .curve-item span').filter({hasText:'Enter 确认'}).waitFor();assert.deepEqual((await save()).paths,saved.paths);
 assert.deepEqual(errors,[]);
});

test('curve drag reorders before and after rows, retains selection and saves one undo step',async t=>{
 const {page,initial,errors,curveRow,layerRow,expandLayers,save}=await setup(t);
 const order=()=>page.locator('#layer-list .curve-item span').allTextContents();
 await layerRow('a').locator('[data-action="visible"]').click();assert.deepEqual(await order(),['曲线 C','曲线 A','曲线 B']);assert.equal(await curveRow('a').locator('.curve-select').isDisabled(),true);assert.deepEqual((await save()).paths,initial.paths);
 await page.reload();await layerRow('a').waitFor();await expandLayers();await curveRow('c').waitFor();assert.deepEqual(await order(),['曲线 C','曲线 A','曲线 B']);
 await page.locator('#undo').click();assert.deepEqual(await order(),['曲线 C','曲线 A','曲线 B']);
 await page.locator('#redo').click();assert.deepEqual(await order(),['曲线 C','曲线 A','曲线 B']);await page.locator('#undo').click();
 await curveRow('a').click();await curveRow('b').click({modifiers:['Shift']});
 await curveRow('b').dragTo(curveRow('a'),{targetPosition:{x:30,y:2}});
 assert.deepEqual(await order(),['曲线 C','曲线 B','曲线 A']);let saved=await save();assert.deepEqual(saved.paths,[initial.paths[1],initial.paths[0],initial.paths[2]]);assert.deepEqual(saved.layers,initial.layers.map(l=>({...l,textIds:[]})));
 assert.deepEqual(await page.locator('#layer-list .curve-item[aria-pressed="true"] span').allTextContents(),['曲线 B','曲线 A']);
 assert.match(await page.locator('#history-list').textContent(),/调整曲线顺序/);
 await page.locator('#undo').click();assert.deepEqual(await order(),['曲线 C','曲线 A','曲线 B']);assert.equal(await page.locator('#undo').isDisabled(),true);
 const history=await page.locator('#undo').getAttribute('title');
 await curveRow('a').dragTo(curveRow('a'));await curveRow('a').dragTo(curveRow('b'),{targetPosition:{x:30,y:2}});
 assert.equal(await page.locator('#undo').getAttribute('title'),history);assert.equal(await page.locator('#redo').isDisabled(),false);
 await page.locator('#redo').click();assert.deepEqual(await order(),['曲线 C','曲线 B','曲线 A']);
 const target=await curveRow('b').boundingBox();await curveRow('c').dragTo(curveRow('b'),{targetPosition:{x:30,y:target.height-2}});
 assert.deepEqual(await order(),['曲线 B','曲线 A','曲线 C']);const moved=await save();assert.deepEqual(moved.layers.find(l=>l.id==='layer-a').pathIds,['a','b','c']);assert.deepEqual(moved.layers.find(l=>l.id==='layer-c').pathIds,[]);
 await page.locator('#undo').click();saved=await save();await page.reload();await layerRow('a').waitFor();await expandLayers();await curveRow('c').waitFor();assert.deepEqual((await save()).paths,saved.paths);assert.deepEqual(saved.layers,initial.layers.map(l=>({...l,textIds:[]})));
 assert.equal(await page.locator('#layer-list .curve-dragging,#layer-list .drop-before,#layer-list .drop-after').count(),0);
 assert.deepEqual(errors,[]);
});

test('layer name double click renames on blur and lets the adjacent lock click complete',async t=>{
 const {page,initial,errors,layerRow,save}=await setup(t);
 await layerRow('a').locator('.layer-select').dblclick();
 const input=page.getByRole('textbox',{name:'图层名称',exact:true});await input.waitFor();await input.fill('  双击图层  ');
 const lock=await layerRow('a').locator('[data-action="locked"]').boundingBox();await page.mouse.click(lock.x+lock.width/2,lock.y+lock.height/2);
 assert.equal(await layerRow('a').locator('[data-action="locked"]').getAttribute('aria-pressed'),'true');
 let saved=await save();assert.equal(saved.layers[0].name,'双击图层');assert.deepEqual(saved.paths,initial.paths);
 await page.locator('#undo').click();assert.equal(await layerRow('a').locator('[data-action="locked"]').getAttribute('aria-pressed'),'false');
 await page.locator('#undo').click();assert.equal(await layerRow('a').locator('.layer-select').textContent(),'2图层 A');assert.equal(await page.locator('#undo').isDisabled(),true);
 await layerRow('a').locator('.layer-select').dblclick();await input.fill('保留原名');await page.keyboard.press('Escape');assert.equal(await page.locator('#redo').isDisabled(),false);
 await page.locator('#redo').click();saved=await save();assert.equal(saved.layers[0].name,'双击图层');
 await layerRow('c').locator('.layer-select').dblclick();await input.fill('下一次点击确认');
 const target=await layerRow('a').locator('.layer-select').boundingBox();await page.mouse.click(target.x+30,target.y+target.height-3);
 assert.equal(await layerRow('a').locator('.layer-select').getAttribute('aria-pressed'),'true');assert.equal((await save()).layers[1].name,'下一次点击确认');
 await layerRow('a').locator('.layer-select').dblclick();await input.fill('中文候选');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(await input.count(),1);await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
});
