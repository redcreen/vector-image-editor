/* Page naming and menu-bar presence are separate from artwork and edit history. */
(()=>{
 const $=id=>document.getElementById(id),dialog=$('editor-name-dialog');
 const page=crypto.randomUUID(),endpoint='/api/presence';
 let name='',drawingId='',editedAt=0,dirty=true,ready=false,available=false,closed=false,sequence=0,queue=Promise.resolve();
 function apply(info){
  if(typeof info?.name!=='string')return;
  name=info.name;available=true;
  const edition=info.edition==='test'?'test':'official',editionLabel=edition==='test'?'[测试]':'[正式]';
  $('editor-edition').dataset.edition=edition;$('editor-edition').textContent=editionLabel;
  $('editor-label').textContent=`· ${name}`;
  $('editor-label').title=name;
  drawingId=typeof info.drawingId==='string'?info.drawingId:'';
  $('editor-id').textContent=drawingId;$('editor-id').hidden=!drawingId;
  $('editor-id').title='作品固定 ID，改名后仍可用此 ID 告诉 AI';
  document.title=name;
  $('editor-rename').disabled=false;
 }
 function report(){
  if(!available||closed)return;
  queue=queue.catch(()=>{}).then(()=>{
   if(closed)return;
   return fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page,dirty:ready?dirty:true,sequence:++sequence,editedAt}),keepalive:true});
  }).catch(()=>{});
 }
 async function refresh(){
  try{const response=await fetch('/api/editor');if(response.ok)apply(await response.json());}catch{}
 }
 window.EditorSession={
  get name(){return name;},
  get drawingId(){return drawingId;},
  edited(at){editedAt=Math.max(editedAt,at);if(ready)report();},
  setDirty(value){if(dirty!==value){dirty=value;if(ready)report();}},
  ready(value){dirty=value;ready=true;report();}
 };
 $('editor-rename').onclick=()=>{
  $('editor-name').value=name;$('editor-name-error').textContent='';dialog.showModal();$('editor-name').focus();$('editor-name').select();
 };
 $('editor-name-cancel').onclick=()=>dialog.close();
 $('editor-name-form').onsubmit=async event=>{
  event.preventDefault();const button=$('editor-name-confirm');button.disabled=true;
  try{
   const response=await fetch('/api/editor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('editor-name').value})});
   const info=await response.json();if(!response.ok)throw new Error(info.error||'名称保存失败');
   apply(info);dialog.close();
  }catch(error){$('editor-name-error').textContent=error instanceof TypeError?'本机编辑器服务未连接。画布仍保留，请先用“另存为…”备份，再重新启动编辑器。':error.message;}
  finally{button.disabled=false;}
 };
 window.addEventListener('pagehide',()=>{
  closed=true;if(available)navigator.sendBeacon(endpoint,new Blob([JSON.stringify({page,dirty,closed:true,sequence:++sequence})],{type:'application/json'}));
 });
 window.addEventListener('pageshow',()=>{closed=false;report();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();report();}});
 refresh().then(report);
 setInterval(()=>{refresh();report();},2000);
})();
