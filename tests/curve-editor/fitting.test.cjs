const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js'),F=require('../../tools/curve-editor/fitting.js');
const near=(a,b)=>assert.ok(G.dist(a,b)<1e-7,JSON.stringify([a,b]));
test('seam extraction preserves exact cubic subarcs and input handles',()=>{
 const path={closed:false,nodes:[G.node(0,0),G.node(100,0)]};path.nodes[0].out={x:15,y:90};path.nodes[1].in={x:70,y:80};const before=structuredClone(path),part=F.cut(G,path,{index:0,t:.2},{index:0,t:.8});
 for(const t of [0,.1,.5,.9,1])near(G.at(...part.nodes,t),G.at(...path.nodes,.2+.6*t));assert.deepEqual(path,before);
});
test('open seam reverse switches physical start and end and both handle directions',()=>{
 const path={closed:false,nodes:[G.node(0,0),G.node(100,0)]};path.nodes[0].out={x:5,y:40};path.nodes[1].in={x:60,y:70};
 const forward=F.cut(G,path,{index:0,t:0},{index:0,t:1}),backward=F.cut(G,path,{index:0,t:0},{index:0,t:1},true);
 for(const t of [0,.2,.5,.8,1])near(G.at(...forward.nodes,t),G.at(...backward.nodes,1-t));
});
test('closed seams use the clicked direction or the complementary route without modifying the contour',()=>{
 const path={closed:true,nodes:[[0,0],[100,0],[100,100],[0,100]].map(p=>G.node(...p))},before=structuredClone(path),a={index:0,t:.5},b={index:2,t:.5};
 const forward=F.cut(G,path,a,b),backward=F.cut(G,path,a,b,true);near(forward.nodes[0],{x:50,y:0});near(backward.nodes[0],forward.nodes[0]);near(forward.nodes.at(-1),{x:50,y:100});near(backward.nodes.at(-1),forward.nodes.at(-1));assert.ok(forward.nodes.some(p=>p.x===100));assert.ok(backward.nodes.some(p=>p.x===0));assert.deepEqual(path,before);
});

const W=require('../../tools/curve-editor/walk.js'),B=require('../../tools/curve-editor/bend.js');
const line=(points,closed=false)=>({closed,nodes:points.map(p=>G.node(...p))});
test('continuing a seam includes adjacent segments by physical length and keeps the fitted prefix anchored',()=>{
 const source=line([[0,0],[100,0],[200,0],[300,0]]),target=line([[400,0],[500,10],[600,30],[700,60]]),sp=[{index:0,t:0},{index:0,t:1}],tp=[{index:0,t:0},{index:0,t:.9}],before=structuredClone([source,target,sp,tp]);
 const first=F.extend(G,W,source,sp,target,tp),second=F.extend(G,W,source,first.sourcePoints,target,first.targetPoints);
 assert.deepEqual(first.sourcePoints,[{index:0,t:0},{index:1,t:1}]);assert.deepEqual(second.sourcePoints,[{index:0,t:0},{index:2,t:1}]);
 for(const result of [first,second]){
  const s=F.cut(G,source,...result.sourcePoints),t=F.cut(G,target,...result.targetPoints),map=B.create(s,t);
  assert.ok(Math.abs(W.track(s).length-W.track(t).length)<.0001);
  for(const station of [0,25,70,95]){const p={x:station,y:0},reference=B.create(F.cut(G,source,...sp),F.cut(G,target,...result.targetPoints));assert.ok(G.dist(map.forward(p),reference.forward(p))<.001);}
 }
 assert.deepEqual([source,target,sp,tp],before);
});
test('continuation respects reversed open ranges and does not move either physical start',()=>{
 const source=line([[0,0],[100,0],[200,0],[300,0]]),target=line([[400,0],[500,0],[600,0],[700,0]]),sp=[{index:1,t:0},{index:1,t:1}],tp=[{index:1,t:0},{index:1,t:1}];
 const r=F.extend(G,W,source,sp,target,tp,{sourceReverse:true,targetReverse:true});
 assert.deepEqual(r.sourcePoints,[{index:0,t:0},{index:1,t:1}]);
 const s=F.cut(G,source,...r.sourcePoints,true),t=F.cut(G,target,...r.targetPoints,true);near(s.nodes[0],source.nodes[2]);near(t.nodes[0],target.nodes[2]);assert.ok(Math.abs(W.track(s).length-W.track(t).length)<.0001);
});
test('continuation wraps a closed boundary, finishes partial spans and skips zero-length segments',()=>{
 const source=line([[0,0],[100,0],[100,100],[0,100]],true),target=line([[400,0],[500,0],[600,0],[700,0],[800,0]]);
 const r=F.extend(G,W,source,[{index:3,t:0},{index:3,t:1}],target,[{index:0,t:0},{index:0,t:1}]);assert.deepEqual(r.sourcePoints,[{index:3,t:0},{index:0,t:1}]);assert.ok(Math.abs(r.sourceLength-200)<.0001);
 const partial=F.extend(G,W,source,[{index:0,t:.2},{index:0,t:.6}],target,[{index:0,t:0},{index:0,t:.6}]);assert.deepEqual(partial.sourcePoints[1],{index:0,t:1});
 const zero=line([[0,0],[100,0],[100,0],[200,0]]),z=F.extend(G,W,zero,[{index:0,t:0},{index:0,t:1}],target,[{index:0,t:0},{index:0,t:1}]);assert.equal(z.sourcePoints[1].index,2);
});
test('continuation stops at an open end or a short fixed seam without mutating the selected ranges',()=>{
 const source=line([[0,0],[100,0],[200,0]]),target=line([[400,0],[550,0]]),sp=[{index:0,t:0},{index:0,t:1}],tp=[{index:0,t:0},{index:0,t:1}],before=structuredClone([sp,tp]);
 assert.throws(()=>F.extend(G,W,source,sp,target,tp),/绿边|固定/);assert.deepEqual([sp,tp],before);
 assert.throws(()=>F.extend(G,W,source,[{index:0,t:0},{index:1,t:1}],line([[400,0],[800,0]]),tp),/到头|没有/);
});

test('local fitting accepts contiguous node selections and closed ranges across zero without filling gaps',()=>{
 const open=line([[0,0],[100,0],[200,0],[300,0]]),closed=line([[0,0],[100,0],[100,100],[0,100]],true);
 assert.deepEqual(F.selection(G,open,[1,2,3]),[{index:1,t:0},{index:2,t:1}]);
 assert.deepEqual(F.selection(G,closed,[3,0,1]),[{index:3,t:0},{index:0,t:1}]);
 assert.throws(()=>F.selection(G,open,[0,2]),/连续/);assert.throws(()=>F.selection(G,closed,[0,2]),/连续/);
 assert.equal(F.selection(G,open,[1]),null);
});
test('the complementary original outline preserves every unselected cubic exactly',()=>{
 const path=line([[0,0],[100,0],[100,100],[0,100]],true);path.nodes[2].out={x:80,y:130};path.nodes[3].in={x:20,y:150};const before=structuredClone(path),points=[{index:3,t:0},{index:0,t:1}],rest=F.remainder(G,path,points);
 assert.equal(rest.length,1);near(rest[0].nodes[0],path.nodes[3]);near(rest[0].nodes.at(-1),path.nodes[1]);
 assert.ok(rest[0].nodes.some(n=>n.x===100&&n.y===100));assert.deepEqual(path,before);
 const open=line([[0,0],[100,0],[200,0],[300,0]]),parts=F.remainder(G,open,[{index:1,t:0},{index:1,t:1}]);assert.equal(parts.length,2);near(parts[0].nodes.at(-1),open.nodes[1]);near(parts[1].nodes[0],open.nodes[2]);
});
test('reversed open local ranges leave the same complementary geometry',()=>{
 const path=line([[0,0],[100,0],[200,0],[300,0]]),points=[{index:1,t:1},{index:1,t:0}],parts=F.remainder(G,path,points);assert.equal(parts.length,2);near(parts[0].nodes.at(-1),path.nodes[1]);near(parts[1].nodes[0],path.nodes[2]);
});

test('the fitting route includes the original open curve in both directions with the selected physical origin',()=>{
 const path=line([[0,0],[100,0],[100,200]]),points=[{index:1,t:0},{index:1,t:.5}],before=structuredClone(path);
 let result=F.route(G,W,path,points,false);assert.deepEqual(result.path,path);assert.ok(Math.abs(result.origin-100)<.0001);assert.equal(result.loop,false);
 result=F.route(G,W,path,points,true);near(result.path.nodes[0],path.nodes[2]);assert.ok(Math.abs(result.origin-100)<.0001);assert.deepEqual(path,before);
 const closed=line([[0,0],[100,0],[100,100],[0,100]],true),r=F.route(G,W,closed,[{index:0,t:.5},{index:2,t:1}],true);near(r.path.nodes[0],closed.nodes[3]);near(r.path.nodes.at(-1),closed.nodes[3]);assert.equal(r.loop,true);assert.equal(r.origin,0);assert.ok(Math.abs(W.track(r.path).length-400)<.0001);
});

test('reversed open endpoint order and the direction toggle define the same physical route as the selected seam',()=>{
 const path=line([[0,0],[100,0],[200,0]]),points=[{index:1,t:1},{index:0,t:1}],source=line([[0,0],[100,0]]);
 for(const reversed of [false,true]){const r=F.route(G,W,path,points,reversed),target=F.cut(G,path,...points);if(reversed){target.nodes.reverse();for(const n of target.nodes)[n.in,n.out]=[n.out,n.in];}const map=B.create(source,target,{targetRoute:r.path,targetOrigin:r.origin});near(map.forward({x:0,y:0}),reversed?{x:100,y:0}:{x:200,y:0});near(map.forward({x:100,y:0}),reversed?{x:200,y:0}:{x:100,y:0});}
});

test('arbitrary target nodes anchor the requested direction and open endpoints turn inward',()=>{
 const p=line([[0,0],[100,0],[200,0],[300,0]]),before=structuredClone(p);
 for(const [index,reversed,expected] of [[1,false,false],[2,true,true],[3,false,true],[0,true,false]]){
  const r=F.targetRangeFromNode(G,W,p,index,80,reversed),part=F.cut(G,p,...r.points,r.reversed);
  near(part.nodes[0],p.nodes[index]);assert.equal(r.reversed,expected);assert.ok(Math.abs(W.track(part).length-80)<.001);
 }
 const short=F.targetRangeFromNode(G,W,p,2,200,false);assert.ok(Math.abs(W.track(F.cut(G,p,...short.points)).length-100)<.001);assert.deepEqual(p,before);
 assert.throws(()=>F.targetRangeFromNode(G,W,p,4,80),/节点/);
});
test('arbitrary closed target node starts wrap zero in either direction without moving the chosen start',()=>{
 const p=line([[0,0],[100,0],[100,100],[0,100]],true);
 for(const reversed of [false,true])for(const index of [0,3]){
  const r=F.targetRangeFromNode(G,W,p,index,150,reversed),part=F.cut(G,p,...r.points);near(r.reversed?part.nodes.at(-1):part.nodes[0],p.nodes[index]);assert.ok(Math.abs(W.track(part).length-150)<.001);
 }
});

test('source node endpoints preserve the opposite end and infer open direction without changing geometry',()=>{
 const p=line([[0,0],[100,0],[200,0],[300,0]]),points=[{index:0,t:0},{index:1,t:1}],before=structuredClone(p);
 let r=F.sourceRangeFromNode(G,p,points,1,'start',false);assert.deepEqual(r,{points:[{index:1,t:0},{index:1,t:1}],reversed:false});
 r=F.sourceRangeFromNode(G,p,r.points,0,'end',r.reversed);assert.equal(r.reversed,true);near(F.cut(G,p,...r.points,true).nodes[0],p.nodes[1]);near(F.cut(G,p,...r.points,true).nodes.at(-1),p.nodes[0]);
 r=F.sourceRangeFromNode(G,p,points,3,'start',false);assert.equal(r.reversed,true);near(F.cut(G,p,...r.points,true).nodes[0],p.nodes[3]);near(F.cut(G,p,...r.points,true).nodes.at(-1),p.nodes[2]);
 assert.throws(()=>F.sourceRangeFromNode(G,p,points,0,'end',false),/不同/);assert.deepEqual(p,before);
});
test('source node endpoints keep closed direction through zero and can describe a full loop',()=>{
 const p=line([[0,0],[100,0],[100,100],[0,100]],true),points=[{index:0,t:0},{index:1,t:1}];
 const r=F.sourceRangeFromNode(G,p,points,3,'start',false),seam=F.cut(G,p,...r.points);near(seam.nodes[0],p.nodes[3]);near(seam.nodes.at(-1),p.nodes[2]);assert.ok(Math.abs(W.track(seam).length-300)<.001);
 const back=F.sourceRangeFromNode(G,p,[{index:1,t:1},{index:3,t:0}],0,'end',true),part=F.cut(G,p,...back.points);near(part.nodes.at(-1),p.nodes[3]);near(part.nodes[0],p.nodes[0]);assert.ok(Math.abs(W.track(part).length-300)<.001);
 const full=F.sourceRangeFromNode(G,p,r.points,3,'end',false);assert.ok(Math.abs(W.track(F.cut(G,p,...full.points)).length-400)<.001);
});
