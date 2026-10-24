const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const R=require('../../tools/curve-editor/fitting-range.js');
const line=(coords,closed=false)=>({closed,nodes:coords.map(p=>G.node(...p))});
const copy=x=>structuredClone(x),at=(path,p)=>G.at(path.nodes[p.index],path.nodes[(p.index+1)%path.nodes.length],p.t);
const near=(a,b,tol=1e-7)=>assert.ok(G.dist(a,b)<tol,JSON.stringify([a,b]));
const samePhysical=(a,ps,b,qs)=>ps.forEach((p,i)=>near(at(a,p),at(b,qs[i])));
const reverse=p=>{const out=copy(p);out.nodes.reverse();for(const n of out.nodes)[n.in,n.out]=[n.out,n.in];return out;};
test('range rebasing is available as a pure geometry API',()=>assert.equal(typeof R?.rebase,'function'));
test('ordinary node and handle edits retain parameters and return independent bookmarks',()=>{
 const a=line([[0,0],[100,0],[200,20]]),b=copy(a),ps=[{index:0,t:.25},{index:1,t:1}],before=copy([a,ps]);G.move(b.nodes[0],10,30);b.nodes[1].out.y=90;
 const out=R.rebase(G,a,ps,b);assert.deepEqual(out,ps);assert.notEqual(out,ps);assert.notEqual(out[0],ps[0]);assert.deepEqual([a,ps],before);
});
test('exact curved split and undo retain physical fractional endpoints accurately',()=>{
 const a=line([[0,0],[100,0]]);a.nodes[0].out={x:10,y:90};a.nodes[1].in={x:75,y:-40};const b=copy(a),ps=[{index:0,t:.2},{index:0,t:.8}];G.split(b,0,.35);
 const out=R.rebase(G,a,ps,b);samePhysical(a,ps,b,out);assert.ok(Math.abs(out[0].t-.2/.35)<1e-8);assert.ok(Math.abs(out[1].t-(.8-.35)/.65)<1e-8);samePhysical(b,out,a,R.rebase(G,b,out,a));
});
test('deleting interior nodes preserves both boundary anchors',()=>{
 const a=line([[0,0],[10,0],[20,10],[30,0],[40,0]]),b=copy(a),ps=[{index:1,t:0},{index:2,t:1}];b.nodes.splice(2,1);
 assert.deepEqual(R.rebase(G,a,ps,b),[{index:1,t:0},{index:1,t:1}]);
});
test('prepend and append preserve old open ends, including undo',()=>{
 const a=line([[0,0],[100,0]]),b=line([[-50,0],[0,0],[100,0],[150,0]]),ps=[{index:0,t:0},{index:0,t:1}];const out=R.rebase(G,a,ps,b);assert.deepEqual(out,[{index:1,t:0},{index:1,t:1}]);assert.deepEqual(R.rebase(G,b,out,a),ps);
});
test('closed wraparound range survives a split before its start and deletion across zero',()=>{
 const a=line([[0,0],[100,0],[100,100],[0,100]],true),b=copy(a),ps=[{index:3,t:0},{index:0,t:1}];G.split(b,0,.5);const out=R.rebase(G,a,ps,b);assert.deepEqual(out,[{index:4,t:0},{index:1,t:1}]);
 const c=copy(a);c.nodes.splice(0,1);samePhysical(a,ps,c,R.rebase(G,a,ps,c));
});
test('cyclic rotation and reversal preserve physical anchors and fractional locations',()=>{
 const a=line([[0,0],[100,0],[100,100],[0,100]],true),ps=[{index:3,t:.4},{index:0,t:.7}],b=copy(a);b.nodes.push(...b.nodes.splice(0,2));samePhysical(a,ps,b,R.rebase(G,a,ps,b));const c=reverse(a);samePhysical(a,ps,c,R.rebase(G,a,ps,c));
 const open=line([[0,0],[70,40],[100,0]]),op=[{index:0,t:.2},{index:1,t:1}];samePhysical(open,op,reverse(open),R.rebase(G,open,op,reverse(open)));
});
test('duplicate slit mouths retain separate identities after insertion',()=>{
 const a=line([[0,0],[50,0],[50,20],[50,0],[100,0]],true),b=copy(a),ps=[{index:1,t:0},{index:2,t:1}];G.split(b,0,.5);
 assert.deepEqual(R.rebase(G,a,ps,b),[{index:2,t:0},{index:3,t:1}]);
});
test('zero-length duplicate spans preserve their endpoint roles after insertion',()=>{
 const a=line([[0,0],[50,0],[50,0],[100,0]]),b=copy(a),ps=[{index:1,t:0},{index:1,t:1}];G.split(b,0,.5);
 assert.deepEqual(R.rebase(G,a,ps,b),[{index:2,t:0},{index:2,t:1}]);
});
test('an unchanged segment with coincident geometry elsewhere keeps its own fractional range',()=>{
 const a=line([[0,0],[100,0],[0,0],[100,0],[200,0]]),b=copy(a),ps=[{index:2,t:.2},{index:2,t:.8}];G.split(b,3,.5);
 assert.deepEqual(R.rebase(G,a,ps,b),ps);
});
test('deleted boundary projects safely to remaining geometry',()=>{
 const a=line([[0,0],[50,40],[100,0]]),b=line([[0,0],[100,0]]),ps=[{index:0,t:1},{index:1,t:1}],out=R.rebase(G,a,ps,b);near(at(b,out[0]),{x:50,y:0});assert.deepEqual(out[1],{index:0,t:1});
});
test('unrelated distant topology uses relative length station instead of collapsing both ends',()=>{
 const a=line([[0,0],[100,0]]),b=line([[1000,0],[1050,0],[1100,0]]),ps=[{index:0,t:0},{index:0,t:1}],out=R.rebase(G,a,ps,b);assert.deepEqual(out,[{index:0,t:0},{index:1,t:1}]);
});
test('all degenerate surviving segments still return finite valid positions without mutation',()=>{
 const a=line([[0,0],[50,40],[100,0]]),b=line([[0,0],[0,0]]),ps=[{index:0,t:.3},{index:1,t:.7}],before=copy([a,b,ps]),out=R.rebase(G,a,ps,b);for(const p of out){assert.equal(p.index,0);assert.ok(Number.isFinite(p.t)&&p.t>=0&&p.t<=1);}assert.deepEqual([a,b,ps],before);
});
test('browser global exposes the same pure rebase API',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),context={};vm.runInNewContext(fs.readFileSync(require.resolve('../../tools/curve-editor/fitting-range.js'),'utf8'),context);
 assert.equal(typeof context.CurveFittingRange.rebase,'function');
});
test('curved splits near either end preserve fractional positions over different scales',()=>{
 for(const scale of [.001,1,10000])for(const split of [.001,.1,.5,.99,.999]){
  const a=line([[0,0],[100*scale,0]]);a.nodes[0].out={x:15*scale,y:100*scale};a.nodes[1].in={x:60*scale,y:-80*scale};const b=copy(a);G.split(b,0,split);
  const ps=[{index:0,t:split/2},{index:0,t:(1+split)/2}],out=R.rebase(G,a,ps,b);
  assert.equal(out[0].index,0);assert.equal(out[1].index,1);assert.ok(Math.abs(out[0].t-.5)<1e-8);assert.ok(Math.abs(out[1].t-.5)<1e-8);
 }
});
test('whole closed range keeps distinct incoming and outgoing roles through rotation and split',()=>{
 const a=line([[0,0],[100,0],[100,100],[0,100]],true),b=copy(a),ps=[{index:0,t:0},{index:3,t:1}];b.nodes.push(...b.nodes.splice(0,1));
 assert.deepEqual(R.rebase(G,a,ps,b),[{index:3,t:0},{index:2,t:1}]);
 const c=copy(a);G.split(c,3,.5);assert.deepEqual(R.rebase(G,a,ps,c),[{index:0,t:0},{index:4,t:1}]);
});
test('reversing a curved open path switches handles and preserves both physical bookmarks',()=>{
 const a=line([[0,0],[100,0],[200,0]]);a.nodes[0].out={x:25,y:70};a.nodes[1].in={x:70,y:-50};a.nodes[1].out={x:130,y:80};a.nodes[2].in={x:150,y:90};const ps=[{index:0,t:.3},{index:1,t:.7}],b=reverse(a);
 samePhysical(a,ps,b,R.rebase(G,a,ps,b));
});
