(function(root){
 'use strict';
 const D=typeof module!=='undefined'?require('./dimension.js'):root.CurveDimension;
 let context;
 function check(t){
  if(!t||typeof t.id!=='string'||!t.id.trim()||t.id.length>200||typeof t.name!=='string'||t.name.length>80||typeof t.content!=='string'||!t.content.trim()||t.content.length>10000)throw new Error('文字内容无效（最多 10000 字符）');
  if(![t.x,t.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7)||!Number.isFinite(t.fontSize)||t.fontSize<1||t.fontSize>4096||!/^#[0-9a-f]{6}$/i.test(t.color))throw new Error('文字位置、字号或颜色无效（字号 1–4096 px）');
  if(t.rotation!==undefined&&(!Number.isFinite(t.rotation)||Math.abs(t.rotation)>1e7))throw new Error('文字旋转角度无效');
  if(t.dimension!==undefined)D.check(t);
  if(t.positionMarker!==undefined){
   if(!t.positionMarker||![t.positionMarker.x,t.positionMarker.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7))throw new Error('标注点位置无效');
   if(t.positionMarker.pathId!==undefined&&(typeof t.positionMarker.pathId!=='string'||!t.positionMarker.pathId.trim()||t.positionMarker.pathId.length>200))throw new Error('标注关联曲线无效');
   if(t.positionMarker.attachment!==undefined){
    const a=t.positionMarker.attachment,indexValid=Number.isInteger(a?.index)&&a.index>=0&&a.index<10000;
    if(t.positionMarker.pathId===undefined||!a||!indexValid||!['node','segment'].includes(a.kind)||a.kind==='segment'&&(!Number.isFinite(a.t)||a.t<0||a.t>1))throw new Error('标注附着位置无效');
   }
   if(!/^[A-Za-z0-9]{1,32}$/.test(t.content))throw new Error('点位标注请填写 1–32 位英文字母或数字，例如 01、A1');
  }
 }
 const lines=t=>t.content.replace(/\r\n?/g,'\n').split('\n');
 function localBounds(t){
  if(!context&&root.document)context=root.document.createElement('canvas').getContext('2d');
  if(context)context.font=`${t.fontSize}px sans-serif`;
  const widths=lines(t).map(line=>context?context.measureText(line).width:[...line].reduce((n,c)=>n+t.fontSize*(c.codePointAt(0)>=0x2e80?1:.6),0));
  return {x:t.x,y:t.y,width:Math.max(t.fontSize*.1,...widths),height:t.fontSize*1.2*widths.length};
 }
 function bounds(t){
  const b=localBounds(t),angle=((t.rotation||0)%360)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const points=[[0,0],[b.width,0],[b.width,b.height],[0,b.height]].map(([x,y])=>({x:t.x+x*c-y*s,y:t.y+x*s+y*c}));
  if(t.positionMarker){const p=t.positionMarker,r=t.fontSize*.16;points.push({x:p.x-r,y:p.y-r},{x:p.x+r,y:p.y+r},markerEnd(t));}
  if(t.dimension)points.push(...D.segments(t).flat());
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
  return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
 }
 function contains(t,p){
  if(t.dimension&&D.segments(t).some(([a,b])=>{const dx=b.x-a.x,dy=b.y-a.y,q=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-q*dx,p.y-a.y-q*dy)<=t.fontSize*.3;}))return true;
  if(t.positionMarker&&Math.hypot(p.x-t.positionMarker.x,p.y-t.positionMarker.y)<=t.fontSize*.3)return true;
  const b=localBounds(t),angle=-((t.rotation||0)%360)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=p.x-t.x,dy=p.y-t.y,x=dx*c-dy*s,y=dx*s+dy*c;
  return x>=0&&y>=0&&x<=b.width&&y<=b.height;
 }
 function markerEnd(t){const a=(t.rotation||0)*Math.PI/180;return {x:t.x-Math.sin(a)*t.fontSize*.6,y:t.y+Math.cos(a)*t.fontSize*.6};}
 const api={check,lines,localBounds,bounds,contains,markerEnd};
 if(typeof module!=='undefined')module.exports=api;else root.CurveText=api;
})(typeof window!=='undefined'?window:globalThis);
