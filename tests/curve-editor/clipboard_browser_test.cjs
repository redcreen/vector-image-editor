// Clipboard coverage uses isolated projects and never reloads a user canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=';

async function setup(t){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-clipboard-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'图片粘贴测试',width:1000,height:700,paths:[{id:'curve',name:'保留曲线',color:'#e04544',role:'outline',closed:false,note:'',nodes:[G.node(100,100),G.node(200,200)]}],originals:[],image:null,opacity:.65,calibration:{a:{x:0,y:0},b:{x:100,y:0},length:10,unit:'cm'},measureUnit:'cm'};
 const saves=path.join(project,'work/curve_editor/sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','auto']);
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',()=>assert.fail('paste must preserve unsaved artwork'));
 await page.goto(url);await page.locator('#curve-list button').filter({hasText:'保留曲线'}).waitFor({state:'attached'});
 for(const id of ['panel-properties','panel-curves'])await page.locator('#'+id).evaluate(el=>el.open=true);
 const save=async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 // Simulate clipboard shapes that differ between applications; normal OS paste is tested below.
 const paste=async(mode='normal',target='body')=>page.evaluate(({png,mode,target})=>{
  const bytes=mode==='invalid'?new Uint8Array([0,1,2]):Uint8Array.from(atob(png),c=>c.charCodeAt(0));
  const file=new File([bytes],mode==='unnamed'?'':'截图.png',{type:mode==='unsupported'?'image/gif':'image/png'}),transfer=new DataTransfer();transfer.items.add(file);
  const e=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});
  if(mode==='files')Object.defineProperty(e,'clipboardData',{value:{items:[],files:[file]}});
  if(mode==='null-first')Object.defineProperty(e,'clipboardData',{value:{files:[],items:[{kind:'file',type:'image/png',getAsFile:()=>null},...transfer.items]}});
  if(mode==='empty')Object.defineProperty(e,'clipboardData',{value:null});
  document.querySelector(target).dispatchEvent(e);return e.defaultPrevented;
 },{png:PNG,mode,target});
 return {page,initial,errors,save,paste};
}

test('a real screenshot clipboard pastes into a new selected layer, preserves artwork and supports undo, redo and reload',async t=>{
 const {page,initial,errors,save}=await setup(t);
 await page.locator('#path-note').fill('尚未保存的修改');
 await page.locator('[data-tool="select"]').click();
 const canvas=await page.locator('#canvas').boundingBox();await page.mouse.click(canvas.x+canvas.width*.75,canvas.y+canvas.height*.75);
 await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=60;const c=canvas.getContext('2d');c.fillStyle='#176bce';c.fillRect(0,0,80,60);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);});
 await page.keyboard.press('ControlOrMeta+v');await page.locator('#paths image').waitFor({state:'attached'});
 let d=await save();assert.equal(d.images.length,1);assert.equal(d.layers.length,2);assert.equal(d.layers.at(-1).locked,false);assert.equal(d.layers.at(-1).visible,true);assert.deepEqual(d.layers.at(-1).imageIds,[d.images[0].id]);
 assert.equal(d.images[0].width,80);assert.equal(d.images[0].height,60);assert.deepEqual(d.calibration,initial.calibration);assert.equal(d.paths[0].note,'尚未保存的修改');assert.deepEqual(d.paths[0].nodes,initial.paths[0].nodes);assert.equal(d.width,1000);assert.equal(d.height,700);
 assert.equal(await page.locator('#layer-list .layer-row.active').count(),1);assert.equal(await page.locator('#selection-overlay [data-corner]').count(),4);assert.equal(await page.locator('[data-tool="select"]').getAttribute('aria-pressed'),'true');
 await page.locator('#undo').click();d=await save();assert.equal(d.images.length,0);assert.equal(d.layers.length,1);assert.equal(d.paths[0].note,'尚未保存的修改');
 await page.locator('#redo').click();d=await save();assert.equal(d.images.length,1);
 const originalImage=d.images[0];
 await page.mouse.click(canvas.x+canvas.width*.75,canvas.y+canvas.height*.75);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'canvas');
 await page.keyboard.press('ControlOrMeta+v');
 await page.locator('#paths image').nth(1).waitFor({state:'attached',timeout:5000});
 d=await save();assert.equal(d.images.length,2);assert.equal(d.layers.length,3);assert.deepEqual(d.images[0],originalImage);assert.notEqual(d.images[1].id,originalImage.id);
 await page.locator('#undo').click();await page.locator('#redo').click();
 await page.locator('#element-width').fill('160');await page.locator('#element-width').press('Enter');d=await save();assert.equal(d.images[1].width,160);assert.equal(d.images[1].height,120);
 await page.reload();await page.locator('#paths image').nth(1).waitFor({state:'attached'});d=await save();assert.equal(d.images[1].width,160);assert.equal(d.images[1].height,120);assert.deepEqual(d.images[0],originalImage);assert.deepEqual(d.calibration,initial.calibration);assert.deepEqual(errors,[]);
});

test('clipboard image files are read even when the application provides no image items',async t=>{
 const {page,errors,save,paste}=await setup(t);
 assert.equal(await paste('files'),true);await page.locator('#paths image').waitFor({state:'attached'});
 const d=await save();assert.equal(d.images.length,1);assert.equal(d.layers.at(-1).name,'截图.png');assert.deepEqual(errors,[]);
});

test('unreadable clipboard items do not hide a later valid image, and unnamed images get a usable layer name',async t=>{
 const {page,errors,save,paste}=await setup(t);
 assert.equal(await paste('null-first'),true);await page.locator('#paths image').waitFor({state:'attached'});
 assert.equal(await paste('unnamed'),true);await page.locator('#paths image').nth(1).waitFor({state:'attached'});
 const d=await save();assert.equal(d.images.length,2);assert.ok(d.images.at(-1).name.trim());assert.ok(d.layers.at(-1).name.trim());assert.deepEqual(errors,[]);
});

test('text editing and save dialogs keep their own paste behavior; unavailable clipboard data is harmless',async t=>{
 const {page,errors,save,paste}=await setup(t);
 await page.locator('#path-note').focus();await page.evaluate(()=>navigator.clipboard.writeText('正常粘贴备注'));await page.keyboard.press('ControlOrMeta+v');assert.equal(await page.locator('#path-note').inputValue(),'正常粘贴备注');
 assert.equal(await paste('normal','#path-note'),false);
 await page.evaluate(()=>{const editor=document.createElement('div');editor.id='editable-test';editor.contentEditable='true';editor.innerHTML='<span>可编辑文字</span>';document.body.append(editor);});
 assert.equal(await paste('normal','#editable-test span'),false);
 await page.locator('#save-as').click();assert.equal(await paste('normal'),false);await page.locator('#save-as-cancel').click();
 assert.equal(await paste('empty'),false);
 const d=await save();assert.equal(d.images.length,0);assert.equal(d.paths[0].note,'正常粘贴备注');assert.deepEqual(errors,[]);
});

test('invalid or unsupported clipboard images show an error without modifying artwork or history',async t=>{
 const {page,errors,save,paste}=await setup(t),initial=await save();
 for(const mode of ['invalid','unsupported']){
  assert.equal(await paste(mode),true);await page.locator('#status').filter({hasText:'粘贴失败'}).waitFor();
  const {savedAt:beforeSavedAt,...before}=initial,{savedAt:afterSavedAt,...after}=await save();assert.deepEqual(after,before);assert.equal(await page.locator('#undo').isDisabled(),true);
 }
 assert.deepEqual(errors,[]);
});
