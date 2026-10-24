(function(root){
 'use strict';
 const G=typeof module!=='undefined'?require('./geometry.js'):root.CurveGeometry;
 const L=typeof module!=='undefined'?require('./layers.js'):root.CurveLayers;
 const PAPERS={A4:[210,297],A3:[297,420]},MARGIN=10,FOOTER=10,PADDING=1,OVERLAP=5;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>Number(value.toFixed(6));
 function layout(doc,ids,{paper='A4',orientation='portrait'}={}){
  if(!ids?.length)throw new Error('请先选择要打印的曲线，可用 Shift 多选');
  const selected=new Set(ids),paths=doc.paths.filter(p=>selected.has(p.id)&&L.visible(doc,p.id)&&G.segmentCount(p)>0);
  if(!paths.length)throw new Error('所选范围没有可见曲线，请先选择有线段的曲线');
  if(!doc.calibration)throw new Error('尚未设置实际尺寸，请先完成两点标定');
  const scale=G.millimetersPerPixel(doc.calibration);
  if(!PAPERS[paper]||!['portrait','landscape'].includes(orientation))throw new Error('请选择有效纸张和方向');
  const boxes=paths.map(G.pathBounds),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  const widthMm=(Math.max(...boxes.map(b=>b.x+b.width))-x)*scale,heightMm=(Math.max(...boxes.map(b=>b.y+b.height))-y)*scale;
  const [paperWidthMm,paperHeightMm]=orientation==='landscape'?[...PAPERS[paper]].reverse():PAPERS[paper];
  const tileWidthMm=paperWidthMm-MARGIN*2,tileHeightMm=paperHeightMm-MARGIN*2-FOOTER;
  const columns=Math.max(1,Math.ceil((widthMm+PADDING*2-OVERLAP-1e-8)/(tileWidthMm-OVERLAP)));
  const rows=Math.max(1,Math.ceil((heightMm+PADDING*2-OVERLAP-1e-8)/(tileHeightMm-OVERLAP)));
  if(!Number.isFinite(widthMm+heightMm)||columns*rows>100)throw new Error('实际尺寸超过 100 页，请缩小所选范围或检查标定比例');
  const pages=[];for(let row=0;row<rows;row++)for(let column=0;column<columns;column++)pages.push({row:row+1,column:column+1,x:column*(tileWidthMm-OVERLAP),y:row*(tileHeightMm-OVERLAP)});
  const point=p=>({x:(p.x-x)*scale+PADDING,y:(p.y-y)*scale+PADDING});
  return {title:doc.title||'选中曲线',paper,orientation,paperWidthMm,paperHeightMm,tileWidthMm,tileHeightMm,widthMm,heightMm,columns,rows,overlapMm:OVERLAP,pages,pathIds:paths.map(p=>p.id),
   paths:paths.map(p=>({id:p.id,closed:p.closed,dashed:p.dashed,nodes:p.nodes.map(n=>({...point(n),in:point(n.in),out:point(n.out)}))}))};
 }
 function documentHTML(plan){
  const p=plan,w=p.tileWidthMm,h=p.tileHeightMm;
  const curves=p.paths.map(path=>`<path data-curve="${escape(path.id)}" d="${G.pathD(path)}" fill="none" stroke="#000" stroke-width="0.2"${path.dashed?' stroke-dasharray="2 1.5"':''}/>`).join('');
  const pages=p.pages.map((page,i)=>`<section class="print-sheet"><svg xmlns="http://www.w3.org/2000/svg" class="print-curves" width="${w}mm" height="${h}mm" viewBox="${number(page.x)} ${number(page.y)} ${w} ${h}">${curves}<rect x="${page.x}" y="${page.y}" width="${w}" height="${h}" fill="none" stroke="#999" stroke-width="0.1" stroke-dasharray="2 2"/></svg><footer><svg xmlns="http://www.w3.org/2000/svg" width="55mm" height="8mm" viewBox="0 0 55 8"><path d="M 1 1 V 4 M 1 2.5 H 51 M 51 1 V 4" stroke="#000" stroke-width="0.2" fill="none"/><text x="26" y="7" text-anchor="middle" font-size="2.5">50 mm 校验线</text></svg><span>${escape(p.title)} · 1:1<br>第 ${page.row} 行 ${page.column} 列 · ${i+1}/${p.pages.length} 页${p.pages.length>1?' · 相邻页重叠 5 mm':''}</span></footer></section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(p.title)} · 实际尺寸打印</title><style>@page { size: ${p.paperWidthMm}mm ${p.paperHeightMm}mm; margin: ${MARGIN}mm; }*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,"PingFang SC",sans-serif}.print-sheet{position:relative;width:${w}mm;height:${p.paperHeightMm-MARGIN*2}mm;overflow:hidden;break-inside:avoid;break-after:page;page-break-after:always}.print-sheet:last-child{break-after:auto;page-break-after:auto}.print-curves{display:block;width:${w}mm;height:${h}mm;overflow:hidden}footer{position:absolute;bottom:0;left:0;right:0;height:8mm;display:flex;align-items:center;gap:5mm}footer svg{flex:none}footer span{font-size:2.5mm;line-height:1.4;overflow:hidden;max-height:8mm;overflow-wrap:anywhere}@media screen{body{background:#eee}.print-sheet{background:white;margin:10mm;padding:0;box-shadow:0 1px 6px #999}}</style></head><body>${pages}</body></html>`;
 }
 function init(bridge){
  const $=id=>document.getElementById(id),dialog=$('print-dialog');let source=null,ids=[],plan=null,frame=null;
  function update(){
   plan=null;$('print-error').textContent='';
   try{plan=layout(source,ids,{paper:$('print-paper').value,orientation:$('print-orientation').value});$('print-size').textContent=`${plan.pathIds.length} 条曲线 · 宽 ${plan.widthMm.toFixed(2)} × 高 ${plan.heightMm.toFixed(2)} mm · 1:1`;$('print-pages').textContent=`${plan.columns} 列 × ${plan.rows} 行，共 ${plan.pages.length} 页${plan.pages.length>1?'；相邻页重叠 5 mm，按虚线框对齐拼接':''}`;}
   catch(err){$('print-size').textContent=err.message;$('print-pages').textContent='';}
   $('print-size').dataset.error=plan?'false':'true';$('print-confirm').disabled=!plan;$('print-calibrate').hidden=!!source?.calibration;
  }
  function open(){
   if(bridge.isReplaying?.())return;bridge.prepare?.();
   const doc=bridge.getDocument();ids=bridge.getPathIds().slice();
   // Printing never copies bitmap data or the operation history.
   source={title:doc.title,calibration:doc.calibration,paths:doc.paths.filter(p=>ids.includes(p.id)),layers:doc.layers};
   source=JSON.parse(JSON.stringify(source));update();dialog.showModal();
  }
  $('print-paper').onchange=update;$('print-orientation').onchange=update;
  $('print-selected').onclick=open;$('print-cancel').onclick=()=>dialog.close();
  $('print-calibrate').onclick=()=>{dialog.close();$('calibrate').click();};
  $('print-form').onsubmit=e=>{
   e.preventDefault();if(!plan)return;
   frame?.remove();frame=document.createElement('iframe');frame.id='curve-print-frame';frame.title='实际尺寸打印稿';frame.setAttribute('aria-hidden','true');
   frame.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0';
   $('print-confirm').disabled=true;
   frame.onload=()=>{
    $('print-confirm').disabled=false;
    try{const current=frame;current.contentWindow.addEventListener('afterprint',()=>current.remove(),{once:true});current.contentWindow.focus();current.contentWindow.print();bridge.status('已打开浏览器打印；请选择相同纸张、100% / 实际大小，并关闭页眉页脚');}
    catch(err){$('print-error').textContent='打开打印失败：'+err.message;}
   };
   frame.srcdoc=documentHTML(plan);document.body.append(frame);
  };
  return {open};
 }
 const api={layout,documentHTML,init};if(typeof module!=='undefined')module.exports=api;else root.CurvePrinting=api;
})(typeof window!=='undefined'?window:globalThis);
