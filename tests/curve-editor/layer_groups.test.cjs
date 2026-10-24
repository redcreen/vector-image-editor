const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const L=require('../../tools/curve-editor/layers.js');
function fixture(){return L.normalize({width:100,height:100,paths:[{id:'p',nodes:[G.node(10,10),G.node(30,20)]},{id:'q',nodes:[G.node(40,20),G.node(60,30)]}],texts:[],images:[{id:'i',name:'img',dataUrl:'data:image/png;base64,AA==',x:0,y:0,width:20,height:20,opacity:1}],layers:[{id:'a',name:'A',visible:true,locked:false,pathIds:['p'],imageIds:[]},{id:'b',name:'B',visible:true,locked:false,pathIds:[],imageIds:['i']},{id:'c',name:'C',visible:true,locked:false,pathIds:['q'],imageIds:[]}]});}
test('grouping nests selected siblings, preserves geometry, and ungroup restores sibling order',()=>{
 const d=fixture(),paths=JSON.stringify(d.paths);const group=L.group(d,['a','b']);
 assert.equal(group.kind,'group');assert.equal(d.layers.find(l=>l.id==='a').parentId,group.id);
 assert.deepEqual(L.ordered(d).map(l=>l.id),['a','b','c']);assert.equal(JSON.stringify(d.paths),paths);
 assert.deepEqual(L.ungroup(d,group.id),['a','b']);assert.deepEqual(L.ordered(d).map(l=>l.id),['a','b','c']);L.normalize(d);
});
test('nested group visibility and lock affect descendants without replacing child flags',()=>{
 const d=fixture(),inner=L.group(d,['a','b']),outer=L.group(d,[inner.id,'c']);
 outer.visible=false;assert.equal(L.visible(d,'p'),false);outer.visible=true;inner.locked=true;
 assert.equal(L.visible(d,'p'),true);assert.equal(L.editable(d,'p'),false);assert.equal(d.layers.find(l=>l.id==='a').locked,false);
 L.ungroup(d,inner.id);assert.equal(L.editable(d,'p'),false);assert.equal(d.layers.find(l=>l.id==='a').locked,true);
});
test('merge keeps path and image identities and exact cross-type paint order',()=>{
 const d=fixture(),paths=JSON.stringify(d.paths),images=JSON.stringify(d.images),group=L.group(d,['a','b']);
 const merged=L.merge(d,[group.id,'c']);
 assert.equal(merged.kind,undefined);assert.equal(d.layers.length,1);
 assert.deepEqual(L.items(d,merged).map(i=>[i.type,i.id]),[['path','p'],['image','i'],['path','q']]);
 assert.equal(JSON.stringify(d.paths),paths);assert.equal(JSON.stringify(d.images),images);L.normalize(d);
 d.paths.push({id:'new',nodes:[G.node(0,0)]});merged.pathIds.push('new');L.prune(d);assert.equal(merged.items.at(-1).id,'new');L.normalize(d);
});
test('invalid trees and item ordering are rejected',()=>{
 for(const change of [d=>d.layers[0].parentId='missing',d=>d.layers[0].kind='bad',d=>d.layers[0].items=[],d=>d.layers[0].collapsed=1]){
  const d=fixture();change(d);assert.throws(()=>L.normalize(d));
 }
 const d=fixture(),g=L.group(d,['a','b']);g.parentId=g.id;assert.throws(()=>L.normalize(d));
});
test('incompatible layer merges and grouping across parents fail atomically',()=>{
 const d=fixture();d.layers[1].locked=true;let before=JSON.stringify(d);assert.throws(()=>L.merge(d,['a','b']));assert.equal(JSON.stringify(d),before);
 d.layers[1].locked=false;const g=L.group(d,['a','b']);before=JSON.stringify(d);assert.throws(()=>L.group(d,['a','c']));assert.equal(JSON.stringify(d),before);
 assert.deepEqual(L.roots(d,[g.id,'a','c']),[g.id,'c']);
});
test('curve reordering in a merged layer updates path slots without moving images',()=>{
 const d=fixture(),merged=L.merge(d,['a','b','c']);d.paths.reverse();L.syncPathOrder(d);
 assert.deepEqual(L.items(d,merged).map(i=>i.id),['q','i','p']);L.normalize(d);
});
test('non-adjacent selections cannot change stacking against unselected siblings',()=>{
 for(const operation of [L.group,L.merge]){const d=fixture(),before=JSON.stringify(d);assert.throws(()=>operation(d,['a','c']),/相邻/);assert.equal(JSON.stringify(d),before);}
});
test('ungrouping the last empty group leaves a writable layer',()=>{
 const d=fixture(),group=L.group(d,['a','b','c']);d.layers=[group];d.paths=[];d.images=[];
 const ids=L.ungroup(d,group.id);assert.equal(ids.length,1);assert.equal(d.layers.length,1);assert.equal(L.writable(d,d.layers[0]),true);L.normalize(d);
});
