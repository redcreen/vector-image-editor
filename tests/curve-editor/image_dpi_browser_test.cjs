const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {deflateSync}=require('node:zlib');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
function chunk(type,data){
 const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
 for(const b of body){crc^=b;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);body.copy(result,4);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;
}
function png({x=10000,y=x,unit=1,density=true,width=300,height=150}={}){
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 const phys=Buffer.alloc(9);phys.writeUInt32BE(x);phys.writeUInt32BE(y,4);phys[8]=unit;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),...(density?[chunk('pHYs',phys)]:[]),chunk('IDAT',deflateSync(Buffer.alloc(height*(1+width*3),0))),chunk('IEND',Buffer.alloc(0))]);
}
async function setup(t,{blank=false,calibrated=true,trustedFixture=false}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-image-dpi-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const initial={format:'daban-curve-editor',version:1,units:'image-px',title:'DPI test',width:1000,height:700,paths:blank?[]:[{id:'curve',name:'original',color:'#e04544',role:'outline',closed:false,note:'',nodes:[G.node(100,100),G.node(200,100)]}],originals:[],image:null,opacity:.65,calibration:calibrated?{a:{x:0,y:0},b:{x:100,y:0},length:20,unit:'mm'}:null};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL||'chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']}),errors=[],dialogs=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
 // Test-only bridge injection lets exact metadata-bearing bytes reach the trusted
 // paste path; actual OS/native gestures are independently tested below.
 if(trustedFixture)await page.route('**/app.js*',async route=>{const response=await route.fetch(),body=await response.text();assert.ok(body.includes('pastePosition(),true,e.isTrusted'));await route.fulfill({response,body:body.replace('pastePosition(),true,e.isTrusted','pastePosition(),true,true')});});
 await page.goto(url);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
 const save=async()=>{const wait=page.waitForResponse(r=>r.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await wait).status(),200);return page.evaluate(()=>fetch('/api/latest').then(r=>r.json()));};
 const paste=async(buffer=png(),delay=false,mimeType='image/png')=>page.evaluate(({base64,delay,mimeType})=>{
  const file=new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'scan.'+mimeType.split('/')[1],{type:mimeType}),data=new DataTransfer();data.items.add(file);
  if(delay){const read=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(f){window.releaseImageRead=()=>{FileReader.prototype.readAsDataURL=read;read.call(this,f);};};}
  document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 },{base64:buffer.toString('base64'),delay,mimeType});
 const clickPoint=async(x,y)=>{const p=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},{x,y});await page.mouse.click(p.x,p.y);};
 return {page,initial,errors,dialogs,save,paste,clickPoint};
}
test('DPI paste converts to existing canvas units, preserves old geometry, undo/redo and local recovery',async t=>{
 const {page,initial,save,paste,errors}=await setup(t);await paste();await page.locator('#paths image').waitFor({state:'attached'});
 assert.match(await page.locator('#status').textContent(),/DPI.*30\.00.*15\.00.*mm/);
 let d=await save();assert.equal(d.images[0].width,150);assert.equal(d.images[0].height,75);assert.deepEqual(d.calibration,initial.calibration);assert.deepEqual(d.paths,initial.paths);
 await page.locator('#undo').click();assert.equal((await save()).images.length,0);await page.locator('#redo').click();d=await save();assert.equal(d.images[0].width,150);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#paths image').waitFor({state:'attached'});assert.deepEqual((await save()).images,d.images);assert.deepEqual(errors,[]);
});
test('blank uncalibrated canvas adopts DPI, including unequal horizontal and vertical density, in one undo step',async t=>{
 const {page,save,paste,errors}=await setup(t,{blank:true,calibrated:false});await paste(png({y:5000}));await page.locator('#paths image').waitFor({state:'attached'});
 let d=await save(),scale=G.millimetersPerPixel(d.calibration);assert.ok(Math.abs(scale-.1)<1e-10);assert.ok(Math.abs(d.images[0].width*scale-30)<1e-8);assert.ok(Math.abs(d.images[0].height*scale-30)<1e-8);
 await page.locator('#undo').click();d=await save();assert.equal(d.images.length,0);assert.ok(!d.calibration);await page.locator('#redo').click();assert.ok(Math.abs(G.millimetersPerPixel((await save()).calibration)-.1)<1e-10);assert.deepEqual(errors,[]);
});
test('missing, unitless and invalid density silently paste pixels without calibration or prompts',async t=>{
 const {page,save,paste,dialogs,errors}=await setup(t,{calibrated:false});
 let count=0;for(const opts of [{density:false},{unit:0},{x:0}]){await paste(png(opts));await page.locator('#paths image').nth(count++).waitFor({state:'attached'});assert.doesNotMatch(await page.locator('#status').textContent(),/标定|DPI/);}
 const d=await save();assert.equal(d.images.length,3);for(const i of d.images){assert.equal(i.width,300);assert.equal(i.height,150);}assert.ok(!d.calibration);assert.equal(await page.locator('#vector-import-pending').isVisible(),false);assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);
});
test('DPI on a populated uncalibrated canvas waits for calibration, resumes at physical size, and cancellation adds nothing',async t=>{
 const {page,save,paste,clickPoint,errors}=await setup(t,{calibrated:false});await paste();await page.locator('#vector-import-pending').waitFor();assert.equal((await save()).images.length,0);
 await page.locator('#calibration-cancel').click();assert.equal(await page.locator('#vector-import-pending').isVisible(),false);assert.equal((await save()).images.length,0);
 await paste();await page.locator('#vector-import-pending').waitFor();await clickPoint(100,100);await clickPoint(200,100);await page.locator('#calibration-length').fill('20');await page.locator('#calibration-apply').click();await page.locator('#paths image').waitFor({state:'attached'});
 const d=await save();assert.equal(d.images[0].width,150);assert.equal(d.images[0].height,75);assert.equal(G.millimetersPerPixel(d.calibration),.2);assert.deepEqual(errors,[]);
});
test('delayed image decoding never writes into a newly opened document',async t=>{
 const {page,save,paste,initial,errors}=await setup(t);await paste(png(),true);
 await page.locator('#project-file').setInputFiles({name:'new.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...initial,title:'New document'}))});await page.locator('#status').filter({hasText:'已打开 new.json'}).waitFor();await page.evaluate(()=>window.releaseImageRead());
 await page.locator('#status').filter({hasText:'取消'}).waitFor();const d=await save();assert.equal(d.title,'New document');assert.equal(d.images.length,0);assert.deepEqual(errors,[]);
});
test('decoded JPEG and WebP EXIF orientation and non-square DPI produce the intended physical bounds',async t=>{
 const {page,save,paste,errors}=await setup(t);
 for(const format of ['JPEG','WEBP']){
  const buffer=execFileSync('python3',['-c',`from PIL import Image
import io,sys
im=Image.new('RGB',(300,150),'white')
exif=Image.Exif();exif[274]=6;exif[282]=300;exif[283]=150;exif[296]=2
b=io.BytesIO();im.save(b,format='${format}',exif=exif);sys.stdout.buffer.write(b.getvalue())`]);
  await paste(buffer,false,'image/'+(format==='JPEG'?'jpeg':'webp'));await page.locator('#paths image').nth(format==='JPEG'?0:1).waitFor({state:'attached'});
  const d=await save(),i=d.images.at(-1),scale=G.millimetersPerPixel(d.calibration);
  assert.ok(Math.abs(i.width*scale-25.4)<1e-8,`${format} width ${i.width*scale}`);assert.ok(Math.abs(i.height*scale-25.4)<1e-8,`${format} height ${i.height*scale}`);
 }
 assert.deepEqual(errors,[]);
});
test('native browser clipboard uses delivered DPI when present and silently falls back if the browser removes it',async t=>{
 const {page,save,errors}=await setup(t),encoded=png().toString('base64');
 const received=await page.evaluate(async base64=>{
  const blob=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/png'});
  await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
  const items=await navigator.clipboard.read(),actual=await items[0].getType('image/png');
  return window.CurveImageMetadata.read(await actual.arrayBuffer());
 },encoded);
 await page.locator('#canvas').focus();await page.keyboard.press('ControlOrMeta+v');await page.locator('#paths image').waitFor({state:'attached'});
 const d=await save();assert.ok(Math.abs(d.images[0].width-(received?150:300))<1e-8);
 console.log('Native browser clipboard retained DPI:',!!received);assert.deepEqual(errors,[]);
});
test('DPI that cannot form a valid canvas scale falls back without corrupting blank canvas recovery',async t=>{
 const {page,save,paste,errors,dialogs}=await setup(t,{blank:true,calibrated:false});
 const buffer=execFileSync('python3',['-c',`from PIL import Image,TiffImagePlugin
import io,sys
exif=Image.Exif();exif[282]=TiffImagePlugin.IFDRational(1,4294967295);exif[283]=exif[282];exif[296]=2
b=io.BytesIO();Image.new('RGB',(300,150),'white').save(b,format='JPEG',exif=exif);sys.stdout.buffer.write(b.getvalue())`]);
 await paste(buffer,false,'image/jpeg');await page.locator('#paths image').waitFor({state:'attached'});
 const d=await save();assert.ok(!d.calibration);assert.equal(d.images[0].width,300);assert.equal(d.images[0].height,150);assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});
});
async function nativePaste(page,width=300,height=150){
 await page.evaluate(async({width,height})=>{
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#176bce';ctx.fillRect(0,0,width,height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
 },{width,height});
 await page.locator('#canvas').focus();await page.keyboard.press('ControlOrMeta+v');
}
test('trusted native paste recovers matched DPI from local helper without changing the clipboard image',async t=>{
 const {page,initial,save,errors}=await setup(t);let requests=0;
 await page.route('**/api/image-clipboard',route=>{requests++;assert.ok(route.request().postDataJSON().data.length>0);return route.fulfill({json:{metadata:{dpiX:254,dpiY:254,orientation:1,source:'macos-clipboard'}}});});
 await nativePaste(page);await page.locator('#paths image').waitFor({state:'attached'});
 const d=await save();assert.equal(requests,1);assert.equal(d.images[0].width,150);assert.equal(d.images[0].height,75);assert.deepEqual(d.calibration,initial.calibration);assert.deepEqual(d.paths,initial.paths);
 await page.locator('#undo').click();assert.equal((await save()).images.length,0);await page.locator('#redo').click();assert.equal((await save()).images[0].width,150);assert.deepEqual(errors,[]);
});
test('unmatched native metadata and unavailable helper silently preserve pixel paste',async t=>{
 const {page,save,dialogs,errors}=await setup(t);let count=0;
 await page.route('**/api/image-clipboard',route=>++count===1?route.fulfill({json:{metadata:null}}):route.abort());
 for(let i=0;i<2;i++){await nativePaste(page);await page.locator('#paths image').nth(i).waitFor({state:'attached'});}
 const d=await save();assert.equal(count,2);assert.ok(d.images.every(i=>i.width===300&&i.height===150));assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);
});
test('synthetic paste and file import never read the system clipboard',async t=>{
 const {page,paste,errors}=await setup(t);let count=0;
 await page.route('**/api/image-clipboard',route=>{count++;return route.fulfill({json:{metadata:null}});});
 await paste(png({density:false}));await page.locator('#paths image').waitFor({state:'attached'});
 await page.locator('#image-file').setInputFiles({name:'file.png',mimeType:'image/png',buffer:png({density:false})});await page.locator('#paths image').nth(1).waitFor({state:'attached'});
 assert.equal(count,0);assert.deepEqual(errors,[]);
});
test('a late native metadata response cannot insert into another document',async t=>{
 const {page,initial,save,errors}=await setup(t);let release;const gate=new Promise(r=>release=r);let started;const requested=new Promise(r=>started=r);
 await page.route('**/api/image-clipboard',async route=>{started();await gate;await route.fulfill({json:{metadata:{dpiX:254,dpiY:254,orientation:1,source:'macos-clipboard'}}});});
 await nativePaste(page);await requested;
 await page.locator('#project-file').setInputFiles({name:'next.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...initial,title:'Next document'}))});await page.locator('#status').filter({hasText:'已打开 next.json'}).waitFor();release();
 await page.locator('#status').filter({hasText:'取消'}).waitFor();assert.equal((await save()).images.length,0);assert.deepEqual(errors,[]);
});

test('native recovery preserves embedded DPI and does not normalize WebP orientation',async t=>{
 const {page,paste,save}=await setup(t,{trustedFixture:true});let requests=0;
 await page.route('**/api/image-clipboard',route=>{requests++;return route.fulfill({json:{metadata:{dpiX:150,dpiY:300,orientation:1,source:'macos-clipboard'}}});});
 await paste(png());await page.locator('#paths image').waitFor({state:'attached'});
 assert.equal((await save()).images[0].width,150);
 const buffer=execFileSync('python3',['-c',`from PIL import Image
import io,sys
exif=Image.Exif();exif[274]=6;exif[282]=300;exif[283]=150;exif[296]=2
b=io.BytesIO();Image.new('RGB',(300,150),'white').save(b,format='WEBP',exif=exif);sys.stdout.buffer.write(b.getvalue())`]);
 await paste(buffer,false,'image/webp');await page.locator('#paths image').nth(1).waitFor({state:'attached'});
 let d=await save(),im=d.images[1],scale=G.millimetersPerPixel(d.calibration);
 assert.ok(Math.abs(im.width*scale-25.4)<1e-8);assert.ok(Math.abs(im.height*scale-25.4)<1e-8);
 const plain=execFileSync('python3',['-c',`from PIL import Image
import io,sys
exif=Image.Exif();exif[274]=6
b=io.BytesIO();Image.new('RGB',(300,150),'white').save(b,format='WEBP',exif=exif);sys.stdout.buffer.write(b.getvalue())`]);
 await paste(plain,false,'image/webp');await page.locator('#paths image').nth(2).waitFor({state:'attached'});
 d=await save();assert.equal(d.images[2].width,300);assert.equal(d.images[2].height,150);assert.equal(requests,0);
});

test('826 by 1168 image defaults to 100 DPI, preserves canvas scale and supports undo',async t=>{
 const {page,initial,save,paste,errors}=await setup(t);
 await paste(png({density:false,width:826,height:1168}));await page.locator('#paths image').waitFor({state:'attached'});
 assert.match(await page.locator('#status').textContent(),/扫描默认 DPI 100/);
 let d=await save();assert.deepEqual(d.calibration,initial.calibration);assert.deepEqual(d.paths,initial.paths);
 assert.ok(Math.abs(d.images[0].width*.2-209.804)<1e-8);assert.ok(Math.abs(d.images[0].height*.2-296.672)<1e-8);
 await page.locator('#undo').click();assert.equal((await save()).images.length,0);await page.locator('#redo').click();assert.equal((await save()).images.length,1);
 await paste(png({density:false,width:827,height:1168}));await page.locator('#paths image').nth(1).waitFor({state:'attached'});assert.equal((await save()).images[1].width,827);
 await paste(png({width:826,height:1168}));await page.locator('#paths image').nth(2).waitFor({state:'attached'});
 d=await save();assert.ok(Math.abs(d.images[2].width*.2-82.6)<1e-8);assert.deepEqual(errors,[]);
});
test('scanner pixel fallback on a blank canvas creates actual scale and keeps rotated dimensions',async t=>{
 const {page,paste,save}=await setup(t,{blank:true,calibrated:false});
 await paste(png({density:false,width:1168,height:826}));await page.locator('#paths image').waitFor({state:'attached'});
 const d=await save();assert.equal(G.millimetersPerPixel(d.calibration),.254);assert.ok(Math.abs(d.images[0].width-1168)<1e-8);assert.ok(Math.abs(d.images[0].height-826)<1e-8);
});

test('native explicit DPI takes precedence over scanner-sized pixels, missing metadata uses the default',async t=>{
 const {page,save}=await setup(t);let count=0;
 await page.route('**/api/image-clipboard',route=>route.fulfill({json:{metadata:++count===1?{dpiX:300,dpiY:300,orientation:1,source:'macos-clipboard'}:null}}));
 await nativePaste(page,826,1168);await page.locator('#paths image').waitFor({state:'attached'});
 let d=await save();assert.ok(Math.abs(d.images[0].width*.2-826*25.4/300)<1e-8);assert.doesNotMatch(await page.locator('#status').textContent(),/扫描默认/);
 await nativePaste(page,826,1168);await page.locator('#paths image').nth(1).waitFor({state:'attached'});
 assert.match(await page.locator('#status').textContent(),/扫描默认/);d=await save();assert.ok(Math.abs(d.images[1].width*.2-209.804)<1e-8);
});
