const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const N=require('../../tools/curve-editor/notches.js');
const path=(points,closed=false)=>({id:'outline',closed,nodes:points.map(([x,y])=>G.node(x,y))});
const v=()=>path([[0,0],[40,0],[50,15],[60,0],[100,0]]);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const geometry=p=>p.nodes.map(({notchId,...n})=>n);

test('define and clear affect only metadata and clear an entire touched group',()=>{
 assert.equal(typeof N.define,'function');
 const p=v(),before=geometry(p),g=N.define(G,p,[3,1,2],'v');
 assert.deepEqual(g.indices,[1,2,3]);assert.deepEqual(g.anchor,{x:50,y:0});
 assert.deepEqual(geometry(p),before);assert.deepEqual(N.groups(p).map(g=>g.id),['v']);
 N.clear(p,[2]);assert.deepEqual(geometry(p),before);assert.equal(N.groups(p).length,0);
 assert.ok(p.nodes.every(n=>!Object.hasOwn(n,'notchId')));
});

test('splitting a protected internal segment retains the group while splitting an adjacent seam stays untagged',()=>{
 const p=v();N.define(G,p,[1,2,3],'v');const length=G.pathLength(p);
 const added=G.split(p,1,.5);assert.equal(p.nodes[added].notchId,'v');assert.deepEqual(N.groups(p)[0].indices,[1,2,3,4]);close(G.pathLength(p),length);
 const outside=G.split(p,0,.5);assert.equal(p.nodes[outside].notchId,undefined);assert.deepEqual(N.groups(p)[0].indices,[2,3,4,5]);close(G.pathLength(p),length);
});

test('baseline replaces V detour with a chord, retaining external handles and original',()=>{
 const p=v();p.nodes[1].in={x:30,y:-3};p.nodes[3].out={x:70,y:4};N.define(G,p,[1,2,3],'v');
 const original=structuredClone(p),b=N.baseline(G,p);
 assert.deepEqual(p,original);assert.equal(b.nodes.length,p.nodes.length);
 assert.deepEqual(b.nodes[1].in,p.nodes[1].in);assert.deepEqual(b.nodes[3].out,p.nodes[3].out);
 close(G.segmentLength(b,1)+G.segmentLength(b,2),20);
 assert.deepEqual(b.nodes[2].in,{x:50,y:0});assert.deepEqual(b.nodes[2].out,{x:50,y:0});
 assert.ok(G.pathLength(p)>G.pathLength(b));
});

test('rigid transform preserves curved notch distances and handles and round trips',()=>{
 const p=v();p.nodes[2].in={x:46,y:17};p.nodes[2].out={x:56,y:20};p.nodes[1].in={x:37,y:-2};
 const g=N.define(G,p,[1,2,3],'curve'),original=structuredClone(p);
 const from={point:g.anchor,tangent:{x:2,y:0}},to={point:{x:200,y:50},tangent:{x:0,y:3}};
 const moved=N.rigid(G,p,g,from,to);
 assert.deepEqual({x:moved.nodes[2].x,y:moved.nodes[2].y},{x:185,y:50});assert.deepEqual(moved.nodes[2].in,{x:183,y:46});
 assert.deepEqual(p,original);assert.deepEqual(moved.nodes[0],p.nodes[0]);assert.deepEqual(moved.nodes[4],p.nodes[4]);
 for(const i of g.indices){close(G.dist(moved.nodes[i],moved.nodes[i].in),G.dist(p.nodes[i],p.nodes[i].in));close(G.dist(moved.nodes[i],moved.nodes[i].out),G.dist(p.nodes[i],p.nodes[i].out));}
 for(const i of g.indices)for(const j of g.indices)close(G.dist(moved.nodes[i],moved.nodes[j]),G.dist(p.nodes[i],p.nodes[j]));
 const restored=N.project(G,moved,N.groups(moved)[0],to,from);for(let i=0;i<p.nodes.length;i++)for(const k of ['x','y']){close(restored.nodes[i][k],p.nodes[i][k]);close(restored.nodes[i].in[k],p.nodes[i].in[k]);close(restored.nodes[i].out[k],p.nodes[i].out[k]);}
});

test('closed wrap and multiple adjacent groups stay distinct',()=>{
 const p=path([[0,5],[10,0],[30,0],[40,5],[50,0],[50,40],[0,40],[-10,0]],true);
 N.define(G,p,[7,0,1],'wrap');N.define(G,p,[2,3,4],'other');
 assert.deepEqual(N.groups(p).map(g=>[g.id,g.indices]),[['other',[2,3,4]],['wrap',[7,0,1]]]);
 const b=N.baseline(G,p);assert.deepEqual(b.nodes[0].in,{x:0,y:0});assert.deepEqual(b.nodes[3].in,{x:40,y:0});
 N.clear(p,[0]);assert.deepEqual(N.groups(p).map(g=>g.id),['other']);
});

test('invalid selection leaves all metadata and geometry unchanged',()=>{
 const cases=[[1,2],[0,2,4],[1,2,99],[1,1,2],[],[0,1,2,3,4]];
 for(const indices of cases){const p=v();if(indices.length===5)p.closed=true;const before=structuredClone(p);assert.throws(()=>N.define(G,p,indices,'bad'));assert.deepEqual(p,before);}
 const p=v();N.define(G,p,[1,2,3],'first');const before=structuredClone(p);
 assert.throws(()=>N.define(G,p,[0,1,2],'second'));assert.deepEqual(p,before);
 assert.throws(()=>N.define(G,p,[1,2,3],''));assert.deepEqual(p,before);
});

test('disjoint duplicate IDs and partial groups are never accidentally merged',()=>{
 const p=path([[0,0],[1,0],[2,2],[3,0],[4,0],[5,0],[6,2],[7,0],[8,0]]);
 for(const i of [1,2,3,5,6,7])p.nodes[i].notchId='duplicate';
 assert.deepEqual(N.groups(p),[]);assert.deepEqual(N.baseline(G,p),p);
 assert.throws(()=>N.define(G,p,[0,1,2],'duplicate'));
 const q=v();q.nodes[1].notchId='partial';q.nodes[2].notchId='partial';assert.deepEqual(N.groups(q),[]);
});

test('zero-width slit collapses to a point while retaining the adjoining seam direction',()=>{
 const p=path([[0,0],[50,0],[50,15],[50,0],[100,0]]),g=N.define(G,p,[1,2,3],'slit');
 assert.deepEqual(g.anchor,{x:50,y:0});assert.deepEqual(g.tangent,{x:1,y:0});
 close(G.pathLength(N.baseline(G,p)),100);close(G.pathLength(p),130);
 const degenerate=path([[0,0],[0,10],[0,0]]),before=structuredClone(degenerate);
 assert.throws(()=>N.define(G,degenerate,[0,1,2],'slit'));assert.deepEqual(degenerate,before);
});

test('invalid rigid frames and stale group references cannot mutate or move unrelated nodes',()=>{
 const p=v(),g=N.define(G,p,[1,2,3],'v'),before=structuredClone(p),frame={point:g.anchor,tangent:{x:1,y:0}};
 assert.throws(()=>N.rigid(G,p,g,frame,{point:{x:0,y:0},tangent:{x:0,y:0}}));
 assert.throws(()=>N.rigid(G,p,{...g,indices:[0,1,2]},frame,frame));assert.deepEqual(p,before);
});

test('browser export exposes the same standalone notch operations',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../../tools/curve-editor/notches.js'),'utf8'),context={window:{}};
 require('node:vm').runInNewContext(source,context);
 assert.deepEqual(Object.keys(context.window.CurveNotches),Object.keys(N));
});

test('notch seam stations follow mouth projection, not internal node count',()=>{
 const p=path([[0,0],[40,0],[42,12],[60,0],[100,0]]);N.define(G,p,[1,2,3],'v');
 const original=structuredClone(p),b=N.baseline(G,p);close(b.nodes[2].x,42);close(b.nodes[2].y,0);assert.deepEqual(p,original);
 G.split(p,1,.5);const split=N.baseline(G,p);close(split.nodes[3].x,42);close(G.pathLength(split),100);
});

test('baseline projection has no backtracking and is invariant under reversal',()=>{
 const p=path([[0,0],[10,0],[18,8],[12,8],[20,0],[30,0]]);N.define(G,p,[1,2,3,4],'fold');
 const reverse=p=>{p=structuredClone(p);p.nodes.reverse();for(const n of p.nodes)[n.in,n.out]=[n.out,n.in];return p;};
 const b=N.baseline(G,p),r=reverse(N.baseline(G,reverse(p)));close(G.pathLength(b),30);
 for(let i=0;i<b.nodes.length;i++){close(b.nodes[i].x,r.nodes[i].x);close(b.nodes[i].y,r.nodes[i].y);}
});
