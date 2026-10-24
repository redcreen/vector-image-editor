const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../../tools/curve-editor/simplify.js');
const {fixtureOptions}=require('./fixture_helpers.cjs');

const node=(x,y,extra={})=>({x,y,in:{x,y},out:{x,y},mode:'cusp',...extra});
const cubic=(p0,p1,p2,p3,t)=>{const u=1-t;return {x:u**3*p0.x+3*u*u*t*p1.x+3*u*t*t*p2.x+t**3*p3.x,y:u**3*p0.y+3*u*u*t*p1.y+3*u*t*t*p2.y+t**3*p3.y}};
const derivative=(p0,p1,p2,p3,t)=>{const u=1-t;return {x:3*u*u*(p1.x-p0.x)+6*u*t*(p2.x-p1.x)+3*t*t*(p3.x-p2.x),y:3*u*u*(p1.y-p0.y)+6*u*t*(p2.y-p1.y)+3*t*t*(p3.y-p2.y)}};
function splitCubic(count=12){
 const controls=[{x:0,y:0},{x:25,y:80},{x:75,y:-40},{x:100,y:20}],nodes=[];
 for(let i=0;i<=count;i++){const t=i/count,p=cubic(...controls,t),v=derivative(...controls,t),h=1/count/3;nodes.push({...node(p.x,p.y,{label:`n${i}`}),in:{x:p.x-v.x*h,y:p.y-v.y*h},out:{x:p.x+v.x*h,y:p.y+v.y*h},mode:'smooth'});}
 return {id:'curve',name:'dense cubic',closed:false,color:'#123456',meta:{owner:'test'},nodes};
}
function unevenCubic(){
 const controls=[{x:0,y:0},{x:25,y:80},{x:75,y:-40},{x:100,y:20}],ts=[0,.01,.04,.12,.31,.57,.74,.9,.98,1];
 const nodes=ts.map((t,i)=>{const p=cubic(...controls,t),v=derivative(...controls,t),before=(t-(ts[i-1]??t))/3,after=((ts[i+1]??t)-t)/3;return {...node(p.x,p.y),in:{x:p.x-v.x*before,y:p.y-v.y*before},out:{x:p.x+v.x*after,y:p.y+v.y*after},mode:'smooth'};});
 return {closed:false,nodes};
}
const snapshot=value=>JSON.stringify(value);
const sampled=(path,steps)=>{const out=[];for(let i=0;i<(path.closed?path.nodes.length:path.nodes.length-1);i++){const a=path.nodes[i],b=path.nodes[(i+1)%path.nodes.length];for(let j=0;j<steps;j++)out.push(cubic(a,a.out,b.in,b,j/steps));}if(!path.closed)out.push({x:path.nodes.at(-1).x,y:path.nodes.at(-1).y});return out;};
const pointSegmentDistance=(p,a,b)=>{const x=b.x-a.x,y=b.y-a.y,d=x*x+y*y,t=d?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/d)):0;return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);};
const sampledDirectedDistance=(source,target,closed)=>Math.max(...source.map(p=>{let best=Infinity,count=target.length-(closed?0:1);for(let i=0;i<count;i++)best=Math.min(best,pointSegmentDistance(p,target[i],target[(i+1)%target.length]));return best;}));

test('dense cubic simplifies to one span with a certified bidirectional error',()=>{
 const path=splitCubic(),before=snapshot(path),r=S.simplifyPath(path,{tolerancePx:.01});
 assert.equal(snapshot(path),before,'input must not be mutated');
 assert.equal(r.before,13);assert.equal(r.after,2);assert.equal(r.changed,true);
 assert.ok(r.maxDeviationPx<=.01);assert.equal(r.path.nodes[0].label,'n0');assert.equal(r.path.nodes[1].label,'n12');
 for(const n of r.path.nodes)if(n.mode==='smooth'){const a={x:n.x-n.in.x,y:n.y-n.in.y},b={x:n.out.x-n.x,y:n.out.y-n.y};assert.ok(Math.abs(a.x*b.y-a.y*b.x)<1e-8);}
});

test('open endpoints and path metadata survive simplification',()=>{
 const path=splitCubic(8),r=S.simplifyPath(path,{tolerancePx:.001});
 assert.deepEqual({x:r.path.nodes[0].x,y:r.path.nodes[0].y},{x:path.nodes[0].x,y:path.nodes[0].y});
 assert.deepEqual({x:r.path.nodes.at(-1).x,y:r.path.nodes.at(-1).y},{x:path.nodes.at(-1).x,y:path.nodes.at(-1).y});
 assert.equal(r.path.id,path.id);assert.equal(r.path.name,path.name);assert.deepEqual(r.path.meta,path.meta);assert.notEqual(r.path.meta,path.meta);
});

test('uneven exact Bezier subdivisions simplify without assuming equal knot spacing',()=>{
 const path=unevenCubic(),r=S.simplifyPath(path,{tolerancePx:.01});assert.equal(r.after,2);assert.ok(r.maxDeviationPx<=.01);
});

test('explicit protected anchors remain at the same coordinates',()=>{
 const path={closed:false,nodes:Array.from({length:9},(_,i)=>node(i*10,0,{tag:i}))};
 const r=S.simplifyPath(path,{tolerancePx:.01,protectedIndices:[4]});
 assert.equal(r.after,3);const protectedNode=r.path.nodes.find(n=>n.x===40&&n.y===0&&n.tag===4);assert.ok(protectedNode);assert.deepEqual(protectedNode,path.nodes[4]);
});

test('geometric corners remain exact and keep their metadata and handles',()=>{
 const nodes=[node(0,0),node(20,0),node(40,0,{kind:'corner'}),node(40,20),node(40,40)];
 nodes[2].in={x:35,y:0};nodes[2].out={x:40,y:5};
 const path={closed:false,nodes},r=S.simplifyPath(path,{tolerancePx:.1});
 const corner=r.path.nodes.find(n=>n.kind==='corner');assert.deepEqual(corner,nodes[2]);assert.equal(r.after,3);
});

test('marked notch nodes and the handles on their adjacent spans stay exact',()=>{
 const nodes=[node(0,0),node(10,0),node(20,0,{notchId:'v'}),node(21,-4,{notchId:'v'}),node(22,0,{notchId:'v'}),node(40,0),node(60,0)];
 nodes.forEach((n,i)=>{n.in={x:n.x-.25-i/100,y:n.y};n.out={x:n.x+.25+i/100,y:n.y};});
 const path={closed:false,nodes},r=S.simplifyPath(path,{tolerancePx:.5});
 for(let i=1;i<=5;i++){const kept=r.path.nodes.find(n=>n.x===nodes[i].x&&n.y===nodes[i].y);assert.ok(kept,`node ${i} retained`);assert.deepEqual(kept,nodes[i]);}
});

test('colored node metadata cannot disappear during reduction',()=>{
 const path={closed:false,nodes:Array.from({length:7},(_,i)=>node(i*10,0,i===3?{color:'#c47713',label:'registration'}:{}))},r=S.simplifyPath(path,{tolerancePx:.01});
 const colored=r.path.nodes.find(n=>n.color==='#c47713');assert.ok(colored);assert.deepEqual(colored,path.nodes[3]);
});

test('closed paths retain at least three nodes and can simplify redundant sides',()=>{
 const points=[];for(let x=0;x<=40;x+=10)points.push([x,0]);for(let y=10;y<=40;y+=10)points.push([40,y]);for(let x=30;x>=0;x-=10)points.push([x,40]);for(let y=30;y>=10;y-=10)points.push([0,y]);
 const path={closed:true,nodes:points.map(([x,y],i)=>node(x,y,{ordinal:i}))},r=S.simplifyPath(path,{tolerancePx:.01});
 assert.ok(r.after>=3);assert.ok(r.after<path.nodes.length);assert.ok(r.maxDeviationPx<=.01);
 for(const p of [[0,0],[40,0],[40,40],[0,40]])assert.ok(r.path.nodes.some(n=>n.x===p[0]&&n.y===p[1]));
});

test('an adversarial narrow excursion is not removed outside tolerance',()=>{
 const path={closed:false,nodes:[node(0,0),node(20,0),node(20,.2),node(20.001,.2),node(20.001,0),node(40,0)]};
 const r=S.simplifyPath(path,{tolerancePx:.05});assert.ok(r.path.nodes.some(n=>n.y===.2));assert.ok(r.maxDeviationPx<=.05);
});

test('self-intersecting input is conservatively returned unchanged',()=>{
 const path={closed:true,nodes:[[0,0],[20,20],[0,20],[20,0]].map(([x,y])=>node(x,y))},r=S.simplifyPath(path,{tolerancePx:1});
 assert.equal(r.changed,false);assert.deepEqual(r.path,path);
});

test('returns an unchanged clone when no node can be certified for removal',()=>{
 const path={closed:false,nodes:[node(0,0),node(10,10),node(20,0)]},before=snapshot(path),r=S.simplifyPath(path,{tolerancePx:.001});
 assert.equal(r.changed,false);assert.equal(r.before,3);assert.equal(r.after,3);assert.equal(r.maxDeviationPx,0);assert.deepEqual(r.path,path);assert.notEqual(r.path,path);assert.equal(snapshot(path),before);
});

test('rejects omitted or invalid tolerances, indices, and coordinates',()=>{
 const path={closed:false,nodes:[node(0,0),node(1,0),node(2,0)]};
 for(const options of [{},{tolerancePx:0},{tolerancePx:-1},{tolerancePx:Infinity},{tolerancePx:.1,protectedIndices:[-1]},{tolerancePx:.1,protectedIndices:[1.2]}])assert.throws(()=>S.simplifyPath(path,options),RangeError);
 const bad=structuredClone(path);bad.nodes[1].out.x=NaN;assert.throws(()=>S.simplifyPath(bad,{tolerancePx:.1}),RangeError);
});

test('browser build exports the same public API',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../../tools/curve-editor/simplify.js'),'utf8'),context={window:{}};vm.runInNewContext(source,context);
 assert.equal(typeof context.window.CurveSimplify.simplifyPath,'function');
});

test('saved 415-node production sample reduces below 150 nodes at 0.01 px',fixtureOptions('simplify-2-small.json'),()=>{
 const path=require('./fixtures/simplify-2-small.json'),r=S.simplifyPath(path,{tolerancePx:.01});assert.equal(r.before,415);assert.ok(r.after<150);assert.ok(r.maxDeviationPx<=.01);
 const a=sampled(path,4),b=sampled(r.path,16),measured=Math.max(sampledDirectedDistance(a,b,true),sampledDirectedDistance(b,a,true));assert.ok(measured<=.0101,`sampled bidirectional deviation ${measured}`);
});

test('consecutive duplicate anchors are not mistaken for a self-intersection',()=>{
 const path={closed:false,nodes:[[0,0],[10,0],[10,0],[20,0],[30,0]].map(([x,y])=>node(x,y))};
 const before=snapshot(path),r=S.simplifyPath(path,{tolerancePx:.01});
 assert.equal(r.changed,true);assert.equal(r.after,2);assert.equal(snapshot(path),before);
});

test('576-node body sample reduces safely despite coincident imported anchors',fixtureOptions('simplify-body-small.json'),()=>{
 const path=require('./fixtures/simplify-body-small.json'),before=snapshot(path);
 for(const tolerancePx of [.01,.08]){
  const r=S.simplifyPath(path,{tolerancePx});assert.equal(r.before,576);assert.ok(r.after<200,`${tolerancePx}: ${r.after}`);assert.ok(r.maxDeviationPx<=tolerancePx);
  const a=sampled(path,4),b=sampled(r.path,32),measured=Math.max(sampledDirectedDistance(a,b,true),sampledDirectedDistance(b,a,true));assert.ok(measured<=tolerancePx+.0001,`sampled deviation ${measured}`);
 }
 assert.equal(snapshot(path),before);
});
