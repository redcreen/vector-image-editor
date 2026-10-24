const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const N=require('../../tools/curve-editor/notches.js');
const W=require('../../tools/curve-editor/walk.js');
const F=require('../../tools/curve-editor/fitting.js');
const {fixtureOptions}=require('./fixture_helpers.cjs');
const fixtureState=fixtureOptions('fitting-2hao-notch-seam.json');
const fixture=fixtureState.skip?null:require('./fixtures/fitting-2hao-notch-seam.json');
const scale=fixture?G.millimetersPerPixel(fixture.calibration):null;
const near=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const section=(path,group)=>({closed:false,nodes:group.indices.map(i=>structuredClone(path.nodes[i]))});
const reversed=path=>{const p=structuredClone(path);p.nodes.reverse();for(const n of p.nodes)[n.in,n.out]=[n.out,n.in];return p;};
const groups=fixture?fixture.paths.flatMap(path=>N.groups(path).map(group=>({path,group}))):[];

test('real 2hao fixture preserves the two optimized patterns and all thirteen marked notches',fixtureState,()=>{
 assert.equal(fixture.paths.length,2);assert.equal(groups.length,13);
 assert.deepEqual(fixture.paths.map(p=>p.nodes.length),[46,60]);
 assert.deepEqual(fixture.paths.map(p=>N.groups(p).length),[3,10]);
 assert.ok(scale>0);
});

test('every real marked notch contributes its mouth width instead of the cut-edge detour',fixtureState,t=>{
 const before=structuredClone(fixture);let detour=0,mouth=0;
 for(const {path,group} of groups){
  const base=N.baseline(G,path),actual=W.track(section(path,group)).length,seam=W.track(section(base,group)).length;
  near(seam,group.width);assert.ok(actual>seam);
  detour+=actual;mouth+=seam;
 }
 for(const path of fixture.paths){
  const expected=N.groups(path).reduce((sum,g)=>sum+W.track(section(path,g)).length-g.width,0);
  near(W.track(path).length-W.track(N.baseline(G,path)).length,expected,1e-4);
 }
 assert.deepEqual(fixture,before);
 t.diagnostic(JSON.stringify({markedNotches:groups.length,cutEdgeMm:detour*scale,mouthMm:mouth*scale,excludedDetourMm:(detour-mouth)*scale}));
});

test('real notch baseline stations are monotone and independent of walking direction',fixtureState,()=>{
 for(const path of fixture.paths){
  const base=N.baseline(G,path),back=reversed(N.baseline(G,reversed(path)));
  for(let i=0;i<base.nodes.length;i++){
   near(G.dist(base.nodes[i],back.nodes[i]),0);
   near(G.dist(base.nodes[i].in,back.nodes[i].in),0);
   near(G.dist(base.nodes[i].out,back.nodes[i].out),0);
  }
  for(const group of N.groups(path)){
   const a=base.nodes[group.start],b=base.nodes[group.end],dx=b.x-a.x,dy=b.y-a.y;
   let previous=-1e-8;
   for(const i of group.indices){
    const n=base.nodes[i],s=((n.x-a.x)*dx+(n.y-a.y)*dy)/group.width;
    assert.ok(s>=previous-1e-8&&s>=-1e-8&&s<=group.width+1e-8);
    near((n.x-a.x)*dy-(n.y-a.y)*dx,0);previous=s;
   }
  }
 }
});

test('real notch tips select projected seam stations, including redundant-node and wrapped groups',fixtureState,t=>{
 let maximumOldEqualSpacingErrorMm=0;
 for(const {path,group} of groups){
  const a=path.nodes[group.start],b=path.nodes[group.end],dx=b.x-a.x,dy=b.y-a.y;
  const inner=group.indices.slice(1,-1),tip=inner.reduce((best,i)=>Math.abs((path.nodes[i].x-a.x)*dy-(path.nodes[i].y-a.y)*dx)>Math.abs((path.nodes[best].x-a.x)*dy-(path.nodes[best].y-a.y)*dx)?i:best,inner[0]);
  const point=path.nodes[tip],expected=Math.max(0,Math.min(group.width,((point.x-a.x)*dx+(point.y-a.y)*dy)/group.width));
  const base=N.baseline(G,path),track=W.track(section(base,group));
  near(W.nearest(track,base.nodes[tip]).s,expected,1e-4);
  near(G.dist(a,base.nodes[tip]),expected);
  const end={index:(tip+path.nodes.length-1)%path.nodes.length,t:1};
  near(W.track(F.cut(G,base,{index:group.start,t:0},end)).length,expected,1e-4);
  const selected=F.targetRangeFromNode(G,W,base,tip,2);
  const start=selected.points[selected.reversed?1:0];
  const origin=G.at(base.nodes[start.index],base.nodes[(start.index+1)%base.nodes.length],start.t);
  near(G.dist(origin,base.nodes[tip]),0);
  const old=group.indices.indexOf(tip)/(group.indices.length-1)*group.width;
  maximumOldEqualSpacingErrorMm=Math.max(maximumOldEqualSpacingErrorMm,Math.abs(old-expected)*scale);
 }
 assert.ok(maximumOldEqualSpacingErrorMm>.5);
 t.diagnostic(JSON.stringify({maximumOldEqualSpacingTipErrorMm:maximumOldEqualSpacingErrorMm}));
});

test('rigid real notch projection preserves every node and handle distance without modifying the source',fixtureState,()=>{
 const before=structuredClone(fixture),angle=.71;
 for(const {path,group} of groups){
  const from={point:group.anchor,tangent:group.tangent};
  const to={point:{x:group.anchor.x+75,y:group.anchor.y-32},tangent:{x:Math.cos(angle)*group.tangent.x-Math.sin(angle)*group.tangent.y,y:Math.sin(angle)*group.tangent.x+Math.cos(angle)*group.tangent.y}};
  const moved=N.rigid(G,path,group,from,to),members=new Set(group.indices);
  const originalPoints=group.indices.flatMap(i=>[path.nodes[i],path.nodes[i].in,path.nodes[i].out]);
  const movedPoints=group.indices.flatMap(i=>[moved.nodes[i],moved.nodes[i].in,moved.nodes[i].out]);
  for(let i=0;i<originalPoints.length;i++)for(let j=i+1;j<originalPoints.length;j++)near(G.dist(originalPoints[i],originalPoints[j]),G.dist(movedPoints[i],movedPoints[j]));
  near(W.track(section(path,group)).length,W.track(section(moved,group)).length);
  for(let i=0;i<path.nodes.length;i++)if(!members.has(i))assert.deepEqual(moved.nodes[i],path.nodes[i]);
  const restored=N.rigid(G,moved,N.groups(moved).find(g=>g.id===group.id),to,from);
  for(const i of group.indices)for(const p of [null,'in','out'])near(G.dist(p?restored.nodes[i][p]:restored.nodes[i],p?path.nodes[i][p]:path.nodes[i]),0);
 }
 assert.deepEqual(fixture,before);
});
