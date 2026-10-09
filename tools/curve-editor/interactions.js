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
 const api={createTapTracker};if(typeof module!=='undefined')module.exports=api;else root.CurveInteractions=api;
})(typeof window!=='undefined'?window:globalThis);
