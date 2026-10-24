const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../../tools/curve-editor/geometry.js');
const line=(id,a,b)=>({id,closed:false,nodes:[G.node(...a),G.node(...b)]});
const targets=paths=>G.alignmentSegments(paths);
const near=(a,b,e=1e-7)=>assert.ok(G.dist(a,b)<e,`${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

test('curve alignment reaches the actual straight or curved segment between anchors without changing inputs',()=>{
 assert.equal(typeof G.nearestCurveAlignment,'function');
 const straight=line('straight',[400,50],[400,450]),curved=line('arc',[500,100],[700,100]);curved.nodes[0].out={x:500,y:300};curved.nodes[1].in={x:700,y:300};
 const before=JSON.stringify([straight,curved]);const source={x:398,y:235},hit=G.nearestCurveAlignment([source],targets([straight,curved]),3);
 near(hit.target,{x:400,y:235});assert.equal(hit.pathId,'straight');assert.equal(hit.index,0);assert.equal(hit.kind,'curve');assert.equal(hit.source,source);
 const arc=G.nearestCurveAlignment([{x:600,y:252}],targets([curved]),3);near(arc.target,{x:600,y:250});near(arc.target,G.at(curved.nodes[0],curved.nodes[1],arc.t));
 assert.equal(JSON.stringify([straight,curved]),before);assert.equal(G.nearestCurveAlignment([{x:396,y:235}],targets([straight]),3),null);assert.equal(G.nearestCurveAlignment([{x:398,y:460}],targets([straight]),3),null);
});

test('curve alignment finds the closest branch, includes closing segments and scales the snap radius',()=>{
 const loop=line('loop',[0,0],[0,0]);loop.nodes[0].out={x:300,y:300};loop.nodes[1].in={x:-300,y:300};
 const p=G.at(loop.nodes[0],loop.nodes[1],.8),hit=G.nearestCurveAlignment([{x:p.x+.1,y:p.y-.1}],targets([loop]),1);assert.ok(hit.distance<.2);assert.ok(hit.t>.5);near(hit.target,G.at(loop.nodes[0],loop.nodes[1],hit.t));
 const triangle={id:'closed',closed:true,nodes:[G.node(0,0),G.node(100,0),G.node(100,100)]};const closing=G.nearestCurveAlignment([{x:48,y:50}],targets([triangle]),3);assert.equal(closing.index,2);near(closing.target,{x:49,y:49});
 assert.equal(G.nearestCurveAlignment([{x:48,y:50}],targets([triangle]),3/4),null);
});

test('Shift curve snapping follows the movement line, including tangencies, and leaves parallel drags constrained',()=>{
 const straight=line('straight',[0,0],[100,0]),index=targets([straight]);
 assert.equal(G.nearestCurveAlignment([{x:20,y:2}],index,3,{x:1,y:0}),null);near(G.nearestCurveAlignment([{x:20,y:2}],index,3,{x:1,y:-1}).target,{x:22,y:0});
 const arc=line('arc',[0,0],[100,0]);arc.nodes[0].out={x:0,y:100};arc.nodes[1].in={x:100,y:100};
 const tangent=G.nearestCurveAlignment([{x:48,y:75}],targets([arc]),3,{x:1,y:0});near(tangent.target,{x:50,y:75},1e-6);
 const onLine=G.nearestCurveAlignment([{x:32,y:0}],index,3,{x:1,y:0});near(onLine.target,{x:32,y:0});
});

test('multi-node curve alignment chooses only the nearest correction and rejects invalid inputs',()=>{
 const index=targets([line('target',[100,0],[100,200])]),sources=[{x:98,y:40},{x:99,y:80}];assert.equal(G.nearestCurveAlignment(sources,index,3).source,sources[1]);
 for(const radius of [0,-1,NaN,Infinity])assert.equal(G.nearestCurveAlignment(sources,index,radius),null);
 assert.equal(G.nearestCurveAlignment([],index,3),null);assert.equal(G.nearestCurveAlignment(sources,[],3),null);
});

test('straight relations distinguish overlap, contact, crossing, nearby parallel and distant lines',()=>{
 assert.equal(typeof G.nearestSegmentRelation,'function');const source=targets([line('a',[0,0],[100,0])]);
 const relation=p=>G.nearestSegmentRelation(source,targets([p]),1);
 assert.equal(relation(line('b',[60,0],[160,0])).kind,'overlap');assert.equal(relation(line('b',[90,0],[20,0])).kind,'overlap');assert.equal(relation(line('b',[100,0],[200,0])),null);assert.equal(relation(line('b',[110,0],[200,0])),null);
 assert.equal(relation(line('b',[50,-20],[50,20])),null);assert.equal(relation(line('b',[20,10],[100,10])).kind,'parallel');assert.equal(relation(line('b',[20,40],[100,40])),null);
 const shallow=relation(line('b',[20,-.2],[100,.2]));assert.equal(shallow.kind,'parallel');assert.notEqual(shallow.kind,'overlap');
 assert.equal(G.nearestSegmentRelation(source,targets([line('b',[20,10],[100,10])]),4),null);
});

test('curved chords do not imply parallel and identical reversed cubics still report overlap',()=>{
 const a=line('a',[0,0],[100,0]);a.nodes[0].out={x:0,y:100};a.nodes[1].in={x:100,y:100};
 const b=JSON.parse(JSON.stringify(a));b.id='b';b.nodes=b.nodes.reverse().map(n=>({...n,in:n.out,out:n.in}));
 assert.equal(G.nearestSegmentRelation(targets([a]),targets([b]),1).kind,'overlap');
 b.nodes.forEach(n=>{n.y+=10;n.in.y+=10;n.out.y+=10;});assert.equal(G.nearestSegmentRelation(targets([a]),targets([b]),1),null);
 const overshoot=line('overshoot',[0,0],[100,0]);overshoot.nodes[0].out={x:200,y:0};assert.equal(G.nearestSegmentRelation(targets([overshoot]),targets([line('b',[0,10],[100,10])]),1),null);
});

test('dense reference indexing includes long segments crossing distant bounds',()=>{
 const paths=Array.from({length:200},(_,i)=>line('distant'+i,[i*20,1000],[i*20+10,1020]));paths.push(line('long',[-10000,0],[10000,0]));const index=targets(paths);
 for(const x of [-9000,0,9000])near(G.nearestCurveAlignment([{x,y:2}],index,3).target,{x,y:0});
 const relation=G.nearestSegmentRelation(targets([line('source',[450,10],[550,10])]),index,1);assert.equal(relation.kind,'parallel');assert.equal(relation.target.pathId,'long');
 assert.equal(G.nearestCurveAlignment([{x:0,y:20}],index,3),null);
});
