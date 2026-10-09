(function(root){
 'use strict';
 function createTapTracker(){
  let last=null;
  return {
   reset(){last=null;},
   push(tap){
    const paired=last&&tap.key===last.key&&tap.time>=last.time&&tap.time-last.time<=500&&Math.hypot(tap.x-last.x,tap.y-last.y)<=9;
    last=paired?null:tap;return Boolean(paired);
   }
  };
 }
 // Callers supply immutable snapshots; a pending gesture is committed once it ends.
 function createHistory({limit=100,same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),describe=()=> '修改作品'}={}){
  const past=[],future=[],pastLabels=[],futureLabels=[];let pending=null,revision=0;
  function hasChanges(current){return pending!==null&&!same(pending,current);}
  function commit(current){
   if(pending===null)return false;
   const before=pending;pending=null;if(same(before,current))return false;
   past.push(before);pastLabels.push(describe(before,current));
   if(past.length>limit){past.shift();pastLabels.shift();}
   future.length=0;futureLabels.length=0;revision++;return true;
  }
  function serialize(current){
   const data={version:1,past:past.slice(),future:future.slice(),pastLabels:pastLabels.slice(),futureLabels:futureLabels.slice()};
   if(hasChanges(current)){
    data.past.push(pending);data.pastLabels.push(describe(pending,current));
    if(data.past.length>limit){data.past.shift();data.pastLabels.shift();}
    data.future=[];data.futureLabels=[];
   }
   return data;
  }
  return {
   get undoCount(){return past.length;},get redoCount(){return future.length;},get revision(){return revision;},
   begin(current){if(pending===null)pending=current;},hasChanges,commit,
   undo(current){commit(current);if(!past.length)return null;future.push(current);futureLabels.push(pastLabels.pop());revision++;return past.pop();},
   redo(current){commit(current);if(!future.length)return null;past.push(current);pastLabels.push(futureLabels.pop());revision++;return future.pop();},
   clear(){past.length=0;future.length=0;pastLabels.length=0;futureLabels.length=0;pending=null;revision++;},
   serialize,
   timeline(current){const data=serialize(current);return {frames:[...data.past,current,...data.future.slice().reverse()],labels:['起始状态',...data.pastLabels,...data.futureLabels.slice().reverse()],cursor:data.past.length};},
   restore(data){
    if(data?.version!==1||![data.past,data.future,data.pastLabels,data.futureLabels].every(Array.isArray)||data.past.length+data.future.length>limit||data.past.length!==data.pastLabels.length||data.future.length!==data.futureLabels.length||![...data.pastLabels,...data.futureLabels].every(label=>typeof label==='string'&&label.length<=200))throw new Error('操作记录无效');
    past.splice(0,past.length,...data.past);future.splice(0,future.length,...data.future);
    pastLabels.splice(0,pastLabels.length,...data.pastLabels);futureLabels.splice(0,futureLabels.length,...data.futureLabels);pending=null;revision++;
   }
  };
 }
 // Store immutable image bytes once, even when many history snapshots use them.
 function packSession(session){
  const assets=[],refs=new Map();
  const data=JSON.parse(JSON.stringify(session,(key,value)=>{
   if(key!=='dataUrl'||typeof value!=='string')return value;
   if(!refs.has(value)){refs.set(value,assets.length);assets.push(value);}
   return {asset:refs.get(value)};
  }));
  return {format:'curve-editor-session',version:1,assets,data};
 }
 function unpackSession(session){
  if(session?.format!=='curve-editor-session'||session.version!==1||!Array.isArray(session.assets)||!session.assets.every(value=>typeof value==='string')||!session.data||typeof session.data!=='object')throw new Error('本机记录无效');
  return JSON.parse(JSON.stringify(session.data),(key,value)=>{
   if(key!=='dataUrl')return value;
   if(!Number.isInteger(value?.asset)||value.asset<0||value.asset>=session.assets.length)throw new Error('记录图片无效');
   return session.assets[value.asset];
  });
 }
 const api={createTapTracker,createHistory,packSession,unpackSession};if(typeof module!=='undefined')module.exports=api;else root.CurveInteractions=api;
})(typeof window!=='undefined'?window:globalThis);
