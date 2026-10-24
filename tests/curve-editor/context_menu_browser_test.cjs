// Isolated project and browser; never alters the user's open canvas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const G=require('../../tools/curve-editor/geometry.js');

async function setup(t,{closed=false}={}){
 const project=await mkdtemp(path.join(tmpdir(),'curve-editor-menu-'));let server,browser;
 t.after(async()=>{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await rm(project,{recursive:true,force:true});});
 const nodes=[[100,250],[250,180],[450,250],[600,180]].map(([x,y])=>G.node(x,y,'cusp'));
 const initial={format:'daban-curve-editor',version:1,units:'image-px',width:800,height:500,paths:[{id:'curve',name:'菜单测试',role:'outline',color:'#e04544',closed,nodes}],originals:[],image:null,opacity:.65,newNodeMode:'cusp',mirrorAxis:null};
 const saves=path.join(project,'work/curve_editor/test-sessions');await mkdir(saves,{recursive:true});await writeFile(path.join(saves,'fixture.json'),JSON.stringify(initial));await writeFile(path.join(saves,'latest.txt'),'fixture.json');
 server=spawn('python3',[path.resolve(process.env.CURVE_EDITOR_SERVER||'tools/curve-editor/server.py'),'--project',project,'--port','0','--shared','default'],{env:{...process.env,CURVE_EDITOR_EDITION:'test',CURVE_EDITOR_REGISTRY:path.join(project,'registry'),CURVE_EDITOR_SCAN_PORTS:''}});
 const url=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log||'server timeout')),10000);server.stdout.on('data',s=>{log+=s;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});server.once('error',reject);});
 browser=await chromium.launch({headless:true,...(process.env.CURVE_EDITOR_BROWSER_CHANNEL?{channel:process.env.CURVE_EDITOR_BROWSER_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1100,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('[data-tool="node"]').click();
 const click=async(p,options={})=>{const q=await page.locator('#viewport').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM());return {x:q.x,y:q.y};},p);await page.mouse.click(q.x,q.y,options);};
 const menu=page.locator('#context-menu'),item=name=>page.getByRole('menuitem',{name,exact:true});
 const right=async p=>{await click(p,{button:'right'});await menu.waitFor();};
 return {page,menu,item,nodes,click,right,errors};
}

test('single node menu fits a short window and hides unrelated or inapplicable actions',async t=>{
 const {page,menu,item,nodes,right,errors}=await setup(t);await right(nodes[0]);
 for(const label of ['导入图片','创建文字…','打印选中曲线…','复制曲线','偏移曲线…','删除曲线','整段圆顺…','设为剪口','取消剪口','断开连接','转为尖角节点','撤销','重做'])assert.equal(await item(label).count(),0,label);
 assert.equal(await item('继续画线').isEnabled(),true);assert.equal(await item('添加点位标注…').isEnabled(),true);
 const layout=await menu.evaluate(el=>({scroll:el.scrollHeight,height:el.clientHeight,bottom:el.getBoundingClientRect().bottom,font:getComputedStyle(el.querySelector('button')).fontSize}));
 assert.equal(layout.scroll,layout.height);assert.ok(layout.bottom<=592);assert.equal(layout.font,'12px');
 if(process.env.CURVE_EDITOR_MENU_SCREENSHOT)await page.screenshot({path:process.env.CURVE_EDITOR_MENU_SCREENSHOT});
 await page.keyboard.press('Escape');await right(nodes[1]);assert.equal(await item('继续画线').count(),0);await item('断开连接').click();
 assert.match(await page.locator('#status').textContent(),/连接已断开/);await page.locator('#undo').click();
 await right(nodes[1]);await item('转为平滑节点').click();assert.equal(await page.locator('[data-mode="smooth"]').getAttribute('aria-pressed'),'true');
 await right(G.at(nodes[2],nodes[3],.5));assert.equal(await item('在曲线此处加点').isEnabled(),true);assert.equal(await item('测量整条曲线').isEnabled(),true);assert.deepEqual(errors,[]);
});

test('multi-node menu works from blank canvas and exposes only valid span and notch actions',async t=>{
 const {page,menu,item,nodes,click,right,errors}=await setup(t);await click(nodes[0]);await page.keyboard.down('Shift');await click(nodes[1]);await click(nodes[2]);await page.keyboard.up('Shift');await right({x:350,y:400});
 assert.equal(await menu.getAttribute('aria-label'),'节点操作右键菜单');assert.equal(await item('继续画线').count(),0);assert.equal(await item('断开连接').count(),0);assert.equal(await item('取消剪口').count(),0);
 assert.equal(await item('整段圆顺…').isEnabled(),true);await item('设为剪口').click();
 await right(nodes[1]);assert.equal(await item('取消剪口').isEnabled(),true);await item('取消剪口').click();
 await right(nodes[1]);assert.equal(await item('取消剪口').count(),0);assert.equal(await item('删除所选节点').isEnabled(),true);assert.equal(await menu.evaluate(el=>el.scrollHeight===el.clientHeight),true);assert.deepEqual(errors,[]);
});

test('closed-node menu permits breaking, and scrolling a taller curve menu keeps its actions usable',async t=>{
 const {page,menu,item,nodes,right,errors}=await setup(t,{closed:true});await right(nodes[0]);assert.equal(await item('继续画线').count(),0);assert.equal(await item('断开连接').isEnabled(),true);
 await page.keyboard.press('Escape');await page.setViewportSize({width:1100,height:360});await page.locator('[data-tool="select"]').click();await right(G.at(nodes[1],nodes[2],.5));
 assert.ok(await menu.evaluate(el=>el.scrollHeight>el.clientHeight));await page.keyboard.press('End');
 await page.waitForFunction(()=>document.querySelector('#context-menu').scrollTop>0);assert.equal(await menu.isVisible(),true);
 assert.equal(await menu.evaluate(el=>document.activeElement===[...el.querySelectorAll('button:not(:disabled)')].at(-1)),true);
 await page.keyboard.press('Home');assert.equal(await menu.evaluate(el=>document.activeElement===el.querySelector('button:not(:disabled)')),true);
 const box=await menu.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,260);
 await page.waitForFunction(()=>document.querySelector('#context-menu').hidden||document.querySelector('#context-menu').scrollTop>0);
 assert.equal(await menu.isVisible(),true,'scrolling the menu must not dismiss it');await item('测量整条曲线').click();assert.match(await page.locator('#measure-summary').textContent(),/曲线/);assert.deepEqual(errors,[]);
});
