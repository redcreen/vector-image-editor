const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const W=require('../../tools/curve-editor/walk.js');
const B=require('../../tools/curve-editor/bend.js');
const {fixtureOptions}=require('./fixture_helpers.cjs');

const near=(actual,expected,tolerance=2e-2)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const nearPoint=(actual,expected,tolerance=2e-2)=>{near(actual.x,expected.x,tolerance);near(actual.y,expected.y,tolerance);};
const line=(a,b)=>({closed:false,nodes:[G.node(...a),G.node(...b)]});
const polyline=points=>({closed:false,nodes:points.map(point=>G.node(...point))});

test('forward maps straight to curved seam by equal physical station and preserves signed normal distance',()=>{
 const source=line([0,0],[100,0]),target=line([10,20],[110,20]);
 target.nodes[0].out={x:10,y:120};target.nodes[1].in={x:110,y:120};
 const mapping=B.create(source,target),point={x:25,y:12},actual=mapping.forward(point);
 const targetTrack=W.track(target),frame=W.at(targetTrack,25),expected={x:frame.point.x-frame.tangent.y*12,y:frame.point.y+frame.tangent.x*12};
 nearPoint(actual,expected);near(mapping.sourceLength,100);assert.ok(mapping.targetLength>190);
 assert.ok(25/mapping.targetLength<.14,'mapping must not normalize by percentage');
});

test('offset and short-target endpoint extension use target station units',()=>{
 const mapping=B.create(line([0,0],[100,0]),line([10,10],[10,50]),{offset:15});
 nearPoint(mapping.forward({x:40,y:5}),{x:5,y:65});
 mapping.setOffset(30);nearPoint(mapping.forward({x:40,y:5}),{x:5,y:80});
 assert.throws(()=>mapping.setOffset(NaN),/finite/i);
});

test('supported points roundtrip exactly enough in both directions',()=>{
 const source=line([0,0],[100,0]),target=line([0,0],[100,0]);
 target.nodes[0].out={x:0,y:80};target.nodes[1].in={x:100,y:80};
 const mapping=B.create(source,target,{offset:7});
 for(const point of [{x:5,y:3},{x:35,y:-12},{x:92,y:8}])nearPoint(mapping.inverse(mapping.forward(point)),point,.06);
});

test('an intentional edit in fitted coordinates maps back and persists on the source side',()=>{
 const mapping=B.create(line([0,0],[100,0]),line([20,20],[20,120]));
 const fitted=mapping.forward({x:30,y:8}),moved={x:fitted.x-3,y:fitted.y};
 const editedSource=mapping.inverse(moved);
 nearPoint(editedSource,{x:30,y:11},.03);nearPoint(mapping.forward(editedSource),moved,.03);
});

test('create snapshots inputs and never mutates source paths',()=>{
 const source=line([0,0],[100,0]),target=line([0,0],[0,100]),before=JSON.stringify([source,target]);
 const mapping=B.create(source,target);mapping.forward({x:20,y:5});mapping.inverse({x:-5,y:20});
 assert.equal(JSON.stringify([source,target]),before);
 source.nodes[1].x=500;near(mapping.sourceLength,100);
});

test('inverse rejects an ambiguous folded target instead of corrupting coordinates',()=>{
 const mapping=B.create(line([0,0],[200,0]),polyline([[0,0],[100,0],[0,0]]));
 assert.throws(()=>mapping.inverse({x:50,y:5}),/ambiguous|unsupported/i);
});

test('inverse uses an original-point hint to stay on the same material branch at a fold',()=>{
 const source=line([0,0],[200,0]),target=line([0,0],[100,0]);
 target.nodes[0].out={x:0,y:100};target.nodes[1].in={x:100,y:100};
 const mapping=B.create(source,target),original={x:0,y:-100},fitted=mapping.forward(original);
 nearPoint(fitted,{x:100,y:0},.03);
 const restored=mapping.inverse(fitted,original);
 nearPoint(restored,original,.05);nearPoint(mapping.forward(restored),fitted,.05);
});

test('inverse rejects a hinted branch where the normal map is locally singular',()=>{
 const source=line([0,0],[200,0]),target=line([0,0],[100,0]);
 target.nodes[0].out={x:0,y:100};target.nodes[1].in={x:100,y:100};
 const mapping=B.create(source,target),original={x:0,y:-150},fitted=mapping.forward(original);
 assert.throws(()=>mapping.inverse(fitted,original),/non-invertible|unsupported/i);
});

test('inverse rejects a hinted edit whose source result displays on another unhinted branch',()=>{
 const source=line([0,0],[100,0]);source.nodes[0].out={x:0,y:100};source.nodes[1].in={x:100,y:100};
 const mapping=B.create(source,line([0,0],[200,0])),original={x:44,y:-20};
 const fitted=mapping.forward(original);nearPoint(mapping.forward(mapping.inverse(fitted,original)),fitted,.05);
 assert.throws(()=>mapping.inverse({x:-20,y:-54},original),/ambiguous|unsupported/i);
});

test('closed or zero-length seams are rejected by the pre-cut open-path API',()=>{
 const closed={closed:true,nodes:[G.node(0,0),G.node(10,0),G.node(0,10)]};
 assert.throws(()=>B.create(closed,line([0,0],[10,0])),/open/i);
 assert.throws(()=>B.create(line([0,0],[0,0]),line([0,0],[10,0])),/non-zero|length/i);
});

test('illustrative preview shows a wide contour across a long concave seam without loosening inverse safety',fixtureOptions('fitting-1hao.json'),()=>{
 const F=require('../../tools/curve-editor/fitting.js'),fixture=require('./fixtures/fitting-1hao.json'),[body,target]=fixture.paths;
 const source=F.cut(G,body,{index:0,t:0},{index:3,t:1}),mapping=B.create(source,F.cut(G,target,{index:9,t:0},{index:17,t:0})),before=JSON.stringify([body,target]);
 let unsupported=null;
 for(let i=0;i<G.segmentCount(body);i++)for(let k=0;k<=20;k++){
  const p=G.at(body.nodes[i],body.nodes[(i+1)%body.nodes.length],k/20);let strict;
  try{strict=mapping.forward(p);}catch(_err){unsupported??=p;}
  const shown=mapping.preview(p);assert.ok(Number.isFinite(shown.x)&&Number.isFinite(shown.y));if(strict)nearPoint(shown,strict,1e-7);
 }
 assert.ok(unsupported);assert.throws(()=>mapping.inverse(mapping.preview(unsupported),unsupported),/ambiguous|unsupported/i);assert.equal(JSON.stringify([body,target]),before);
 const nearest=W.nearest;let searches=0;W.nearest=(...args)=>{searches++;return nearest(...args);};
 try{mapping.setOffset(12);const shifted=mapping.preview({...unsupported});assert.ok(Number.isFinite(shifted.x));assert.equal(searches,0);assert.throws(()=>mapping.forward(unsupported),/ambiguous|unsupported/i);assert.throws(()=>mapping.inverse(shifted,unsupported),/ambiguous|unsupported/i);}finally{W.nearest=nearest;}
 assert.throws(()=>mapping.preview({x:NaN,y:0}),/finite/i);
});

test('a moving fit follows the complete target route beyond its initially selected seam and preserves distance',()=>{
 const route=line([500,100],[600,100]);route.nodes.push(G.node(600,300));
 const source=line([0,0],[100,0]),selected=line([500,100],[600,100]),mapping=B.create(source,selected,{targetRoute:route,targetOrigin:0,offset:150});
 nearPoint(mapping.forward({x:0,y:0}),{x:600,y:150});nearPoint(mapping.forward({x:100,y:0}),{x:600,y:250});near(mapping.sourceLength,100);near(mapping.targetLength,100);
 nearPoint(mapping.inverse(mapping.forward({x:25,y:4}),{x:25,y:4}),{x:25,y:4},.03);
});
test('a closed target route wraps the moving fit around the seam start instead of extending a tangent',()=>{
 const route={closed:false,nodes:[[500,100],[700,100],[700,300],[500,300],[500,100]].map(p=>G.node(...p))};
 const mapping=B.create(line([0,0],[100,0]),line([500,100],[600,100]),{targetRoute:route,targetLoop:true,offset:750});
 nearPoint(mapping.forward({x:0,y:0}),{x:500,y:150});nearPoint(mapping.forward({x:100,y:0}),{x:550,y:100});
});

test('repeated source coordinates are reused across offsets without caching mutable input objects',()=>{
 const source=line([0,0],[100,0]),target=line([10,20],[210,20]),map=B.create(source,target),original=W.nearest;let searches=0;
 W.nearest=(...args)=>{searches++;return original(...args);};
 try{
  const point={x:25,y:7};nearPoint(map.forward(point),{x:35,y:27});const first=searches;
  map.setOffset(15);nearPoint(map.forward({...point}),{x:50,y:27});nearPoint(map.preview({...point}),{x:50,y:27});assert.equal(searches,first);
  point.x=30;nearPoint(map.forward(point),{x:55,y:27});assert.ok(searches>first);assert.throws(()=>map.forward({x:NaN,y:7}),/finite/i);
  nearPoint(map.inverse({x:55,y:27},point),point);nearPoint(B.create(source,line([0,0],[0,100])).forward(point),{x:-7,y:30});
 }finally{W.nearest=original;}
});


test('bounded source cache retains hits when the repeated working set exceeds capacity',()=>{
 const map=B.create(line([0,0],[100,0]),line([0,10],[100,10]));
 for(let i=0;i<8200;i++)map.preview({x:i/100,y:3});
 const original=W.nearest;let searches=0;W.nearest=(...args)=>{searches++;return original(...args);};
 try{
  map.setOffset(9);for(let i=0;i<8200;i++)nearPoint(map.preview({x:i/100,y:3}),{x:i/100+9,y:13});
  assert.equal(searches,8,'the first 8192 entries survive a repeated scan');
  map.preview({x:81.99,y:3});assert.equal(searches,9,'overflow points are recomputed without growing the cache');
 }finally{W.nearest=original;}
});
