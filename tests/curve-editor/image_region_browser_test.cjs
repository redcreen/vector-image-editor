// Uses an isolated temporary project; never opens or changes a user's canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');
const {expandLayerContents}=require('./layer_tree_helpers.cjs');

// The first source column is transparent; clipping must not paint it opaque.
const SOURCE_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAAGklEQVR4nGNkYGBgiGra8h9EYwNMuCSopwAAQq0ClyY0RRcAAAAASUVORK5CYII=';
const OUTLINE_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAYAAABe3VzdAAAAX0lEQVR4nO3XsQ2AQBADwWVFW1/9F/Y0gEQGC2JCR9Zd5G2ttQiTOImTOInbz8Ixxv1NgDnn+y4ocRIncRIncRIncRIncRIncRIncRIncRIncRK3/cP96y+WOJ8ucOUA4+gLNQysWIkAAAAASUVORK5CYII=';
const clone=value=>JSON.parse(JSON.stringify(value));

function fixture(){
 const nodes=[G.node(118,78),G.node(162,78),G.node(162,122),G.node(118,122)];
 nodes[0].out={x:132,y:70};nodes[1].in={x:148,y:70};
 const region={id:'region',name:'清理范围',role:'outline',color:'#e04544',closed:true,note:'',sourceImageId:'scan-rotated',nodes};
 const images=[
  {id:'scan-rotated',name:'旋转扫描图',dataUrl:SOURCE_PNG,x:100,y:100,width:80,height:40,rotation:90,opacity:1},
  {id:'scan-other-layer',name:'其他图层扫描图',dataUrl:SOURCE_PNG,x:100,y:220,width:80,height:40,rotation:0,opacity:1}
 ];
 return {format:'daban-curve-editor',version:1,units:'image-px',title:'图片区域清理测试',width:500,height:400,image:null,opacity:1,originals:[],texts:[],paths:[region],images,layers:[
  {id:'curve',name:'曲线图层',visible:true,locked:false,pathIds:['region'],imageIds:[],textIds:[],items:[{type:'path',id:'region'}]},
  {id:'source',name:'来源扫描图层',visible:true,locked:false,pathIds:[],imageIds:['scan-rotated'],textIds:[],items:[{type:'image',id:'scan-rotated'}]},
  {id:'other',name:'其他图层',visible:true,locked:false,pathIds:[],imageIds:['scan-other-layer'],textIds:[],items:[{type:'image',id:'scan-other-layer'}]}
 ]};
}

async function setup(t,mutate){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-image-region-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}await rm(project,{recursive:true,force:true});});
 const initial=fixture();mutate?.(initial);const saves=path.join(project,'work/curve_editor/test-sessions');
 await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(url);await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await expandLayerContents(page);await page.locator('.curve-item[data-path="region"] .curve-select').waitFor();
 const save=async()=>{const response=page.waitForResponse(result=>result.url().endsWith('/api/save'));await page.locator('#save').click();assert.equal((await response).status(),200);return page.evaluate(()=>fetch('/api/latest').then(result=>result.json()));};
 const alphas=dataUrl=>page.evaluate(async source=>{const image=new Image();image.src=source;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);return {size:[canvas.width,canvas.height],transparent:context.getImageData(0,2,1,1).data[3],left:context.getImageData(1,2,1,1).data[3],right:context.getImageData(6,2,1,1).data[3]};},dataUrl);
 const world=async(x,y)=>page.locator('#viewport').evaluate((element,point)=>{const result=new DOMPoint(point.x,point.y).matrixTransform(element.getScreenCTM());return {x:result.x,y:result.y};},{x,y});
 const menu=label=>page.locator('#context-menu button').filter({hasText:new RegExp('^'+label+'$')});
 const begin=async()=>{await page.locator('.curve-item[data-path="region"] .curve-select').click();await page.locator('.curve-item[data-path="region"] .curve-select').click({button:'right'});await menu('反选图片外区域').click();await page.locator('#image-region-overlay path').first().waitFor();};
 return {page,initial,errors,save,alphas,world,menu,begin};
}

test('image region module clips scaled and rotated raster pixels with a Bezier boundary',async t=>{
 const {page,initial,alphas,errors}=await setup(t),image=initial.images[0],curve=initial.paths[0];
 const output=await page.evaluate(async({image,curve})=>window.CurveImageRegion.erase(image,curve,'outside'),{image,curve});
 assert.match(output,/^data:image\/png;base64,/);const pixels=await alphas(output);
 assert.deepEqual(pixels.size,[8,4]);assert.equal(pixels.transparent,0);assert.equal(pixels.left,255);assert.equal(pixels.right,0);
 const inverted=await page.evaluate(async({image,curve})=>window.CurveImageRegion.erase(image,curve,'inside'),{image,curve}),inversePixels=await alphas(inverted);
 assert.equal(inversePixels.left,0);assert.equal(inversePixels.right,255);assert.deepEqual(errors,[]);
});

test('targets prioritizes source image, explicit image, same layer, then one intersecting fallback',async t=>{
 const {page,initial,errors}=await setup(t);
 const inspect=(document,imageIds=[])=>page.evaluate(({document,imageIds})=>window.CurveImageRegion.targets(document,['region'],imageIds).images.map(image=>image.id),{document,imageIds});
 assert.deepEqual(await inspect(initial),['scan-rotated'],'sourceImageId crosses layer boundaries');
 const explicit=clone(initial);delete explicit.paths[0].sourceImageId;assert.deepEqual(await inspect(explicit,['scan-other-layer']),['scan-other-layer']);
 const sameLayer=clone(explicit),curveLayer=sameLayer.layers.find(layer=>layer.id==='curve'),sourceLayer=sameLayer.layers.find(layer=>layer.id==='source');
 sourceLayer.imageIds=[];sourceLayer.items=[];curveLayer.imageIds=['scan-rotated'];curveLayer.items.push({type:'image',id:'scan-rotated'});assert.deepEqual(await inspect(sameLayer),['scan-rotated']);
 assert.deepEqual(await inspect(explicit),['scan-rotated'],'the only intersecting editable image is a safe fallback');
 const ambiguous=clone(explicit),copy={...clone(ambiguous.images[0]),id:'overlap'};ambiguous.images.push(copy);ambiguous.layers.find(layer=>layer.id==='other').imageIds.push(copy.id);ambiguous.layers.find(layer=>layer.id==='other').items.push({type:'image',id:copy.id});
 await assert.rejects(()=>inspect(ambiguous));
 for(const kind of ['hidden','locked','deleted']){
  const document=clone(initial),layer=document.layers.find(item=>item.id==='source');
  if(kind==='hidden')layer.visible=false;if(kind==='locked')layer.locked=true;if(kind==='deleted'){document.images=document.images.filter(image=>image.id!=='scan-rotated');layer.imageIds=[];layer.items=[];}
  await assert.rejects(()=>inspect(document),`a ${kind} source must not fall back to another image`);
 }
 const open=clone(initial);open.paths[0].closed=false;await assert.rejects(()=>inspect(open));
 const pathLocked=clone(initial);pathLocked.layers.find(layer=>layer.id==='curve').locked=true;await assert.rejects(()=>inspect(pathLocked));assert.deepEqual(errors,[]);
});

test('right-click inversion is transient, bounded by the source image, and cancels from every exit',async t=>{
 const {page,initial,errors,save,begin,menu}=await setup(t),before=await save(),artwork=document=>({paths:document.paths,images:document.images,layers:document.layers,calibration:document.calibration});
 await begin();assert.equal(await page.locator('#image-region-dialog[open]').count(),0);assert.deepEqual(artwork(await save()),artwork(before));
 if(process.env.CURVE_EDITOR_IMAGE_REGION_SCREENSHOT)await page.locator('#canvas').screenshot({path:process.env.CURVE_EDITOR_IMAGE_REGION_SCREENSHOT});
 const clipped=await page.locator('#image-region-overlay path[fill="#e04544"]').evaluate(element=>{const match=element.getAttribute('clip-path').match(/#([^)]*)/),rect=document.querySelector(`#${match[1]} rect`);return {width:+rect.getAttribute('width'),height:+rect.getAttribute('height'),transform:element.parentElement.getAttribute('transform')};});
 assert.deepEqual([clipped.width,clipped.height],[initial.images[0].width,initial.images[0].height]);assert.match(clipped.transform,/rotate\(90\)/);
 await page.locator('#canvas').click({button:'right',position:{x:30,y:30}});for(const label of ['删除所选图片区域','反选图片区域','取消图片区域选择'])assert.equal(await menu(label).count(),1);
 await menu('反选图片区域').click();assert.ok(await page.locator('#image-region-overlay path').count());assert.deepEqual(artwork(await save()),artwork(before));
 await page.locator('[data-tool="pen"]').click();assert.equal(await page.locator('#image-region-overlay path').count(),0);
 await begin();await page.keyboard.press('Escape');assert.equal(await page.locator('#image-region-overlay path').count(),0);
 await begin();await page.locator('#canvas').click({button:'right',position:{x:35,y:35}});await menu('取消图片区域选择').click();assert.equal(await page.locator('#image-region-overlay path').count(),0);
 await begin();await page.locator('#canvas').click({position:{x:40,y:40}});assert.equal(await page.locator('#image-region-overlay path').count(),0);
 await page.locator('.curve-item[data-path="region"] .curve-select').click();await page.locator('#canvas').focus();await page.keyboard.press('ArrowRight');await begin();await page.locator('#undo').click();assert.equal(await page.locator('#image-region-overlay path').count(),0);
 await begin();await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.equal(await page.locator('#image-region-overlay path').count(),0);assert.deepEqual(errors,[]);
});

test('second right-click deletes only source pixels and survives undo, redo, save and reload',async t=>{
 const {page,initial,errors,save,alphas,begin,menu,world}=await setup(t);await begin();
 const imagePoint=await world(140,150);await page.mouse.click(imagePoint.x,imagePoint.y,{button:'right'});await menu('删除所选图片区域').click();await page.locator('#image-region-overlay path').first().waitFor({state:'detached'});const changed=await save();
 assert.deepEqual(changed.paths,initial.paths);assert.equal(changed.calibration,null);assert.deepEqual(changed.layers,initial.layers);assert.equal(changed.images.length,initial.images.length);
 const source=changed.images.find(image=>image.id==='scan-rotated'),protectedImage=changed.images.find(image=>image.id==='scan-other-layer');assert.notEqual(source.dataUrl,initial.images[0].dataUrl);assert.deepEqual(protectedImage,initial.images[1]);
 const pixels=await alphas(source.dataUrl);assert.equal(pixels.transparent,0);assert.equal(pixels.left,255);assert.equal(pixels.right,0);assert.deepEqual({...source,dataUrl:initial.images[0].dataUrl},initial.images[0]);
 await page.locator('#undo').click();assert.deepEqual((await save()).images,initial.images);await page.locator('#redo').click();assert.deepEqual((await save()).images,changed.images);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await expandLayerContents(page);
 assert.equal(await page.locator('#image-region-overlay path').count(),0);assert.deepEqual((await save()).images,changed.images);assert.deepEqual(errors,[]);
});

test('Escape during asynchronous Delete prevents a late commit and a later Delete keeps the curve',async t=>{
 const {page,initial,errors,save,begin}=await setup(t);await begin();
 await page.evaluate(()=>{const decode=Image.prototype.decode;window.__regionDecodeStarted=false;let release;Image.prototype.decode=function(){window.__regionDecodeStarted=true;return new Promise(resolve=>{release=()=>decode.call(this).then(resolve);});};window.__releaseRegionDecode=()=>{Image.prototype.decode=decode;release();};});
 await page.keyboard.press('Delete');await page.waitForFunction(()=>window.__regionDecodeStarted);await page.keyboard.press('Escape');assert.equal(await page.locator('#image-region-overlay path').count(),0);
 await page.evaluate(()=>window.__releaseRegionDecode());await page.waitForTimeout(100);assert.deepEqual((await save()).images,initial.images);
 await begin();await page.keyboard.press('Delete');await page.locator('#image-region-overlay path').first().waitFor({state:'detached'});const changed=await save();assert.deepEqual(changed.paths,initial.paths);assert.notEqual(changed.images[0].dataUrl,initial.images[0].dataUrl);
 await page.locator('#undo').click();await begin();await page.keyboard.press('Backspace');await page.locator('#image-region-overlay path').first().waitFor({state:'detached'});assert.deepEqual((await save()).images,changed.images);assert.deepEqual(errors,[]);
});

test('Shift-selected image remains the explicit target when a legacy curve overlaps multiple images',async t=>{
 const {page,initial,errors,save,menu}=await setup(t,document=>{delete document.paths[0].sourceImageId;const overlap={...clone(document.images[0]),id:'scan-overlap',name:'重叠但未选择'};document.images.push(overlap);const layer=document.layers.find(item=>item.id==='other');layer.imageIds.push(overlap.id);layer.items.push({type:'image',id:overlap.id});});
 await page.locator('.layer-contents [data-image="scan-rotated"]').click();await page.locator('.curve-item[data-path="region"] .curve-select').click({modifiers:['Shift']});await page.locator('.curve-item[data-path="region"] .curve-select').click({button:'right'});await menu('反选图片外区域').click();await page.locator('#image-region-overlay path').first().waitFor();
 assert.equal(await page.locator('#image-region-overlay path[fill="#e04544"]').count(),1);await page.locator('#canvas').click({button:'right',position:{x:30,y:30}});await menu('删除所选图片区域').click();await page.locator('#image-region-overlay path').first().waitFor({state:'detached'});
 const changed=await save();assert.notEqual(changed.images.find(image=>image.id==='scan-rotated').dataUrl,initial.images.find(image=>image.id==='scan-rotated').dataUrl);assert.deepEqual(changed.images.find(image=>image.id==='scan-overlap'),initial.images.find(image=>image.id==='scan-overlap'));assert.deepEqual(errors,[]);
});

test('a newly extracted outline records and reloads its source image id',async t=>{
 const {page,errors,save,world,menu}=await setup(t,document=>{const image=document.images.find(item=>item.id==='scan-rotated');image.dataUrl=OUTLINE_PNG;image.rotation=0;image.width=80;image.height=60;}),count=await page.locator('#layer-list .curve-select').count();await page.locator('[data-tool="outline"]').click();const point=await world(140,130);await page.mouse.move(point.x,point.y);await page.locator('#trace-preview path').last().waitFor();await page.mouse.click(point.x,point.y);
 await page.waitForFunction(expected=>document.querySelectorAll('#layer-list .curve-select').length===expected,count+1);const saved=await save(),created=saved.paths.at(-1);assert.equal(created.sourceImageId,'scan-rotated');
 const anchor=page.locator(`#handles .anchor[data-path="${created.id}"][data-node="0"]`);assert.equal(await anchor.getAttribute('data-selected'),'true');await anchor.click({button:'right'});await menu('反选图片外区域').click();await page.locator('#image-region-overlay path').first().waitFor();await page.keyboard.press('Escape');
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.equal((await save()).paths.find(path=>path.id===created.id).sourceImageId,'scan-rotated');assert.deepEqual(errors,[]);
});

test('detailed dialog retains inversion, async cancellation, deletion and recovery',async t=>{
 const {page,initial,errors,save}=await setup(t),dialog=page.locator('#image-region-dialog');
 await page.locator('.curve-item[data-path="region"] .curve-select').click();await page.locator('#image-region').click();
 assert.match(await page.locator('#image-region-summary').textContent(),/来源扫描图层/);
 await page.locator('#image-region-invert').click();assert.match(await page.locator('#image-region-summary').textContent(),/圈内（保留圈外）/);
 await page.locator('#image-region-cancel').click();assert.deepEqual((await save()).images,initial.images);
 await page.locator('#image-region').click();
 await page.evaluate(()=>{const decode=Image.prototype.decode;let release;Image.prototype.decode=function(){return new Promise(resolve=>{release=()=>decode.call(this).then(resolve);});};window.__releaseDialogDecode=()=>{Image.prototype.decode=decode;release();};});
 await page.locator('#image-region-delete').click();await page.locator('#image-region-delete:disabled').waitFor();await page.locator('#image-region-cancel').click();await page.evaluate(()=>window.__releaseDialogDecode());await page.waitForTimeout(100);assert.deepEqual((await save()).images,initial.images);
 await page.locator('#image-region').click();await page.keyboard.press('Delete');await dialog.waitFor({state:'hidden'});const changed=await save();assert.deepEqual(changed.paths,initial.paths);assert.notEqual(changed.images[0].dataUrl,initial.images[0].dataUrl);assert.deepEqual(changed.images[1],initial.images[1]);
 await page.locator('#undo').click();assert.deepEqual((await save()).images,initial.images);await page.locator('#redo').click();assert.deepEqual((await save()).images,changed.images);
 await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});await page.reload();await page.locator('#history-storage[data-state="saved"]').waitFor({state:'attached'});assert.deepEqual((await save()).images,changed.images);assert.deepEqual(errors,[]);
});

test('page naming dialog cannot delete or cancel an active raster selection',async t=>{
 const {page,begin,errors}=await setup(t);await begin();
 const images=await page.locator('#canvas image').evaluateAll(elements=>elements.map(el=>el.getAttribute('href'))),history=await page.locator('#undo').getAttribute('title');
 await page.locator('#editor-rename').click();await page.locator('#editor-name-cancel').focus();
 const consumed=await page.locator('#editor-name-cancel').evaluate(el=>{const event=new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true});el.dispatchEvent(event);return event.defaultPrevented;});
 assert.equal(consumed,false);assert.deepEqual(await page.locator('#canvas image').evaluateAll(elements=>elements.map(el=>el.getAttribute('href'))),images);assert.equal(await page.locator('#undo').getAttribute('title'),history);
 assert.ok(await page.locator('#image-region-overlay path').count()>0);await page.locator('#editor-name-cancel').click();assert.deepEqual(errors,[]);
});
