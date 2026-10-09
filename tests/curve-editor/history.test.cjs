const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHistory,packSession,unpackSession}=require('../../tools/curve-editor/interactions.js');
const state=value=>({doc:{value},selected:null});

test('multiple edits undo and redo in order through both boundaries',()=>{
 const history=createHistory();let current=state(0);
 for(let i=1;i<=4;i++){history.begin(current);current=state(i);assert.equal(history.commit(current),true);}
 assert.equal(history.undoCount,4);
 for(let i=3;i>=0;i--){current=history.undo(current);assert.equal(current.doc.value,i);}
 assert.equal(history.undo(current),null);assert.equal(history.redoCount,4);
 for(let i=1;i<=4;i++){current=history.redo(current);assert.equal(current.doc.value,i);}
 assert.equal(history.redo(current),null);
});

test('one continuous gesture becomes one step and can undo before it ends',()=>{
 const history=createHistory();history.begin(state(0));history.begin(state(1));
 assert.equal(history.hasChanges(state(3)),true);
 const restored=history.undo(state(3));assert.equal(restored.doc.value,0);
 assert.equal(history.redo(restored).doc.value,3);
});

test('clicking or returning a gesture to its start preserves the redo branch',()=>{
 const history=createHistory();history.begin(state(0));history.commit(state(1));
 const current=history.undo(state(1));history.begin(current);
 assert.equal(history.commit(state(0)),false);assert.equal(history.undoCount,0);
 assert.equal(history.redoCount,1);assert.equal(history.redo(current).doc.value,1);
});

test('a new edit after undo discards only the redo branch',()=>{
 const history=createHistory();history.begin(state(0));history.commit(state(1));
 history.begin(state(1));history.commit(state(2));
 const current=history.undo(state(2));history.begin(current);history.commit(state(9));
 assert.equal(history.redoCount,0);assert.equal(history.redo(state(9)),null);
 assert.equal(history.undo(state(9)).doc.value,1);assert.equal(history.undo(state(1)).doc.value,0);
});

test('selection-only changes do not create document edits',()=>{
 const history=createHistory({same:(a,b)=>a.doc.value===b.doc.value});
 history.begin(state(0));assert.equal(history.commit({...state(0),selected:'curve'}),false);
 assert.equal(history.undoCount,0);
});

test('history keeps the most recent 100 edits by default',()=>{
 const history=createHistory();let current=state(0);
 for(let i=1;i<=105;i++){history.begin(current);current=state(i);history.commit(current);}
 assert.equal(history.undoCount,100);
 for(let i=0;i<100;i++)current=history.undo(current);
 assert.equal(current.doc.value,5);assert.equal(history.undo(current),null);
 for(let i=0;i<100;i++)current=history.redo(current);
 assert.equal(current.doc.value,105);assert.equal(history.undoCount,100);
});

test('resetting the document clears committed and pending history',()=>{
 const history=createHistory();history.begin(state(0));history.commit(state(1));history.begin(state(1));
 history.clear();assert.equal(history.undoCount,0);assert.equal(history.redoCount,0);
 assert.equal(history.hasChanges(state(2)),false);assert.equal(history.undo(state(2)),null);
});

test('recorded steps serialize and restore the current undo and redo position',()=>{
 const history=createHistory({describe:(a,b)=>`调整到 ${b.doc.value}`});
 history.begin(state(0));history.commit(state(1));history.begin(state(1));history.commit(state(2));
 const current=history.undo(state(2)),saved=history.serialize(current),restored=createHistory();
 restored.restore(JSON.parse(JSON.stringify(saved)));
 assert.deepEqual(restored.timeline(current).frames.map(s=>s.doc.value),[0,1,2]);
 assert.deepEqual(restored.timeline(current).labels,['起始状态','调整到 1','调整到 2']);
 assert.equal(restored.timeline(current).cursor,1);
 assert.equal(restored.redo(current).doc.value,2);
 assert.equal(restored.undo(state(2)).doc.value,1);
 assert.equal(restored.undo(state(1)).doc.value,0);
});

test('serializing an unfinished gesture records one step without ending the live gesture',()=>{
 const history=createHistory();history.begin(state(0));
 const saved=history.serialize(state(3)),restored=createHistory();restored.restore(saved);
 assert.equal(history.hasChanges(state(4)),true);
 assert.equal(restored.undo(state(3)).doc.value,0);
 history.commit(state(4));assert.equal(history.undoCount,1);
});

test('replay frames respect branching and the 100 step limit without mutating history',()=>{
 const history=createHistory({limit:2});
 for(let i=1;i<=3;i++){history.begin(state(i-1));history.commit(state(i));}
 const current=history.undo(state(3));history.begin(current);history.commit(state(9));
 assert.deepEqual(history.timeline(state(9)).frames.map(s=>s.doc.value),[1,2,9]);
 assert.equal(history.undoCount,2);assert.equal(history.redoCount,0);
 assert.throws(()=>history.restore({past:[],future:[]}));
 assert.equal(history.undo(state(9)).doc.value,2);
});

test('persisted sessions store each image once and restore all snapshot references',()=>{
 const dataUrl='data:image/png;base64,YWJj',doc={image:null,images:[{id:'image',dataUrl}]};
 const session={current:{doc},history:{past:[{doc},{doc}],future:[]},cleanDoc:doc};
 const packed=packSession(session);
 assert.deepEqual(packed.assets,[dataUrl]);
 assert.equal(JSON.stringify(packed).split(dataUrl).length-1,1);
 assert.deepEqual(unpackSession(JSON.parse(JSON.stringify(packed))),session);
 packed.assets=[];assert.throws(()=>unpackSession(packed));
});
