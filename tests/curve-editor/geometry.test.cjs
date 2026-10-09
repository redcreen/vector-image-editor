const {test}=require('node:test');
const assert=require('node:assert/strict');
const g=require('../../tools/curve-editor/geometry.js');
const near=(a,b)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-7,JSON.stringify({a,b}));
test('two-point calibration converts mm and cm while retaining image coordinates',()=>{
 const calibration={a:{x:20,y:40},b:{x:80,y:120},length:10,unit:'cm'};
 const before=JSON.stringify(calibration);
 assert.equal(g.millimetersPerPixel(calibration),1);
 assert.deepEqual(g.measureLength(250,calibration,'cm'),{value:25,unit:'cm'});
 assert.deepEqual(g.measureLength(250,calibration,'mm'),{value:250,unit:'mm'});
 assert.equal(g.millimetersPerPixel({...calibration,length:20,unit:'mm'}),.2);
 assert.equal(JSON.stringify(calibration),before);
});
test('uncalibrated drawings keep honest pixel measurements',()=>{
 assert.equal(g.millimetersPerPixel(null),null);
 assert.deepEqual(g.measureLength(25,null,'cm'),{value:25,unit:'px'});
 assert.deepEqual(g.measureLength(0,null,'mm'),{value:0,unit:'px'});
});
test('invalid calibrations cannot produce a physical measurement',()=>{
 const c={a:{x:0,y:0},b:{x:100,y:0},length:10,unit:'cm'};
 for(const bad of [false,{}, {...c,b:c.a},{...c,b:{x:1e-8,y:0}},{...c,length:0},{...c,length:-1},{...c,length:Infinity},{...c,length:true},{...c,length:1e8},{...c,unit:'inch'},{...c,a:{x:NaN,y:0}},{...c,a:{x:1e8,y:0}}])assert.throws(()=>g.millimetersPerPixel(bad),RangeError);
 assert.throws(()=>g.measureLength(100,c,'inch'),RangeError);
});
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,JSON.stringify({a,b,tolerance}));
test('new nodes retain the requested type instead of always becoming cusp nodes',()=>{
 for(const mode of ['cusp','smooth','symmetric'])assert.equal(g.node(10,20,mode).mode,mode);
});
test('appending a smooth node gives it handles without changing existing node types',()=>{
 const path={closed:false,nodes:[g.node(0,0,'smooth')]};
 g.append(path,{x:120,y:80},'smooth');
 assert.deepEqual(path.nodes.map(n=>n.mode),['smooth','smooth']);
 assert.ok(g.dist(path.nodes[1],path.nodes[1].in)>0);
 g.append(path,{x:200,y:0},'symmetric');
 assert.deepEqual(path.nodes.map(n=>n.mode),['smooth','smooth','symmetric']);
 const restored=JSON.parse(JSON.stringify({newNodeMode:'symmetric',path}));
 assert.equal(restored.newNodeMode,'symmetric');assert.deepEqual(restored.path.nodes.map(n=>n.mode),['smooth','smooth','symmetric']);
});
test('splitting a cubic preserves the entire curve, not only the split point',()=>{
  const a=g.node(10,20),b=g.node(240,150);a.out={x:60,y:-120};b.in={x:180,y:310};
  const path={nodes:[a,b],closed:false};
  const samples=Array.from({length:101},(_,i)=>g.at(a,b,i/100));
  g.split(path,0,0.37);
  samples.forEach((p,i)=>{let t=i/100;near(p,t<=.37?g.at(path.nodes[0],path.nodes[1],t/.37):g.at(path.nodes[1],path.nodes[2],(t-.37)/.63));});
});
test('moving a node moves both handles by the same offset',()=>{
 const n=g.node(20,30);n.in={x:2,y:8};n.out={x:50,y:60};g.move(n,7,-9);
 near(n,{x:27,y:21});near(n.in,{x:9,y:-1});near(n.out,{x:57,y:51});
});
test('smooth handles remain collinear and preserve the opposite handle length',()=>{
 const n=g.node(0,0);n.mode='smooth';n.in={x:-30,y:0};n.out={x:20,y:0};g.handle(n,'out',{x:0,y:80});near(n.in,{x:0,y:-30});
});
test('symmetric handles mirror exactly; cusp handles stay independent',()=>{
 const n=g.node(10,10);n.mode='symmetric';g.handle(n,'out',{x:30,y:40});near(n.in,{x:-10,y:-20});
 n.mode='cusp';g.handle(n,'out',{x:90,y:90});near(n.in,{x:-10,y:-20});
});
test('closed final segment is split without opening the path',()=>{
 const p={closed:true,nodes:[g.node(0,0),g.node(100,0),g.node(100,100)]};const expected=g.at(p.nodes[2],p.nodes[0],.5);
 g.split(p,2,.5);assert.equal(p.closed,true);assert.equal(p.nodes.length,4);near(p.nodes[3],expected);
});

test('reflectPoint mirrors across horizontal, vertical, and oblique infinite lines',()=>{
 near(g.reflectPoint({x:7,y:9},{x:0,y:2},{x:10,y:2}),{x:7,y:-5});
 near(g.reflectPoint({x:7,y:9},{x:3,y:-10},{x:3,y:20}),{x:-1,y:9});
 near(g.reflectPoint({x:8,y:2},{x:0,y:0},{x:10,y:10}),{x:2,y:8});
});

test('reflectPoint rejects a zero or near-zero mirror axis',()=>{
 assert.throws(()=>g.reflectPoint({x:1,y:2},{x:3,y:4},{x:3,y:4}),RangeError);
 assert.throws(()=>g.reflectPoint({x:1,y:2},{x:3,y:4},{x:3+1e-12,y:4}),RangeError);
});

test('reflectPath preserves metadata and modes in a deeply independent copy',()=>{
 const a=g.node(2,3,'smooth'),b=g.node(8,5,'symmetric');
 a.in={x:1,y:4};a.out={x:4,y:1};b.in={x:6,y:7};b.out={x:9,y:2};
 const path={id:'old',name:'sample',closed:false,color:'#123',meta:{tags:['kept']},nodes:[a,b]};
 const reflected=g.reflectPath(path,{x:0,y:0},{x:10,y:0});
 assert.equal(reflected.id,'old');assert.equal(reflected.name,'sample');
 assert.deepEqual(reflected.nodes.map(n=>n.mode),['smooth','symmetric']);
 near(reflected.nodes[0],{x:2,y:-3});near(reflected.nodes[0].in,{x:1,y:-4});near(reflected.nodes[1].out,{x:9,y:-2});
 const twice=g.reflectPath(reflected,{x:0,y:0},{x:10,y:0});
 near(twice.nodes[0],path.nodes[0]);near(twice.nodes[0].in,path.nodes[0].in);near(twice.nodes[1].out,path.nodes[1].out);
 reflected.meta.tags.push('new');reflected.nodes[0].in.x=99;
 assert.deepEqual(path.meta.tags,['kept']);assert.equal(path.nodes[0].in.x,1);
});

test('reflectPath rejects a degenerate mirror axis without touching its input',()=>{
 const path={closed:false,nodes:[g.node(1,2)]};
 assert.throws(()=>g.reflectPath(path,{x:0,y:0},{x:0,y:0}),RangeError);
 assert.deepEqual(path,{closed:false,nodes:[g.node(1,2)]});
});

test('segmentCount handles open, closed, and undersized paths',()=>{
 assert.equal(g.segmentCount({closed:false,nodes:[]}),0);
 assert.equal(g.segmentCount({closed:true,nodes:[g.node(0,0)]}),0);
 assert.equal(g.segmentCount({closed:false,nodes:[g.node(0,0),g.node(1,0),g.node(2,0)]}),2);
 assert.equal(g.segmentCount({closed:true,nodes:[g.node(0,0),g.node(1,0),g.node(2,0)]}),3);
});

test('segmentLength measures straight, zero, and curved cubic segments',()=>{
 const a=g.node(0,0),b=g.node(100,0);a.out={x:0,y:0};b.in={x:100,y:0};
 const straight={closed:false,nodes:[a,b]};
 close(g.segmentLength(straight,0),100);assert.equal(g.segmentLength(straight,1),0);
 const z0=g.node(5,5),z1=g.node(5,5);close(g.segmentLength({closed:false,nodes:[z0,z1]},0),0);
 const c0=g.node(0,0),c1=g.node(100,0);c0.out={x:0,y:100};c1.in={x:100,y:100};
 close(g.segmentLength({closed:false,nodes:[c0,c1]},0),200,0.002);
});

test('segmentLength measures collinear backtracking even with coincident endpoints',()=>{
 const a=g.node(0,0),b=g.node(0,0);a.out={x:100,y:0};b.in={x:-100,y:0};
 close(g.segmentLength({closed:false,nodes:[a,b]},0),115.470054,0.002);
});

test('cubic arc length is invariant when the segment is split',()=>{
 const a=g.node(0,0),b=g.node(140,30);a.out={x:-40,y:180};b.in={x:210,y:-120};
 const path={closed:false,nodes:[a,b]},before=g.segmentLength(path,0,0.0001);
 g.split(path,0,0.37);
 close(g.segmentLength(path,0,0.0001)+g.segmentLength(path,1,0.0001),before,0.001);
});

test('pathLength sums all or unique valid selected segments, including closed perimeter',()=>{
 const square={closed:true,nodes:[g.node(0,0),g.node(10,0),g.node(10,10),g.node(0,10)]};
 close(g.pathLength(square),40);close(g.pathLength(square,[3,1,1,-1,99]),20);
 assert.equal(g.pathLength({closed:false,nodes:[g.node(0,0)]}),0);
});

test('polylineLength sums consecutive distances without closing the line',()=>{
 close(g.polylineLength([{x:0,y:0},{x:3,y:4},{x:3,y:12}]),13);
 assert.equal(g.polylineLength([]),0);assert.equal(g.polylineLength([{x:1,y:2}]),0);
});

test('segmentRange returns direct open and closed ranges and optional closed wraparound',()=>{
 const open={closed:false,nodes:Array.from({length:6},(_,i)=>g.node(i,0))};
 const closed={closed:true,nodes:Array.from({length:6},(_,i)=>g.node(i,0))};
 assert.deepEqual(g.segmentRange(open,4,1),[1,2,3,4]);
 assert.deepEqual(g.segmentRange(open,4,1,true),[1,2,3,4]);
 assert.deepEqual(g.segmentRange(closed,4,1),[1,2,3,4]);
 assert.deepEqual(g.segmentRange(closed,4,1,true),[4,5,0,1]);
 assert.deepEqual(g.segmentRange(closed,2,2,true),[2]);
 assert.deepEqual(g.segmentRange(closed,-1,2),[]);assert.deepEqual(g.segmentRange(closed,2,6),[]);
});

test('segmentD emits only the requested cubic segment',()=>{
 const a=g.node(0,0),b=g.node(10,20);a.out={x:3,y:4};b.in={x:7,y:8};
 const path={closed:false,nodes:[a,b]};
 assert.equal(g.segmentD(path,0),'M 0 0 C 3 4 7 8 10 20');
 assert.equal(g.segmentD(path,1),'');
});

test('normalizeRect accepts opposite drag directions and includes its boundary',()=>{
 assert.deepEqual(g.normalizeRect({x:12,y:-4},{x:-8,y:16}),{x:-8,y:-4,width:20,height:20});
});

test('pathBounds handles empty and point-only paths',()=>{
 assert.equal(g.pathBounds({closed:false,nodes:[]}),null);
 assert.deepEqual(g.pathBounds({closed:false,nodes:[g.node(-7,11)]}),{x:-7,y:11,width:0,height:0});
});

test('pathBounds uses cubic extrema instead of control-point bounds',()=>{
 const a=g.node(0,0),b=g.node(100,0);a.out={x:0,y:100};b.in={x:100,y:100};
 assert.deepEqual(g.pathBounds({closed:false,nodes:[a,b]}),{x:0,y:0,width:100,height:75});
 const c=g.node(0,0),d=g.node(100,0);c.out={x:-1000,y:0};d.in={x:1100,y:0};
 const bounds=g.pathBounds({closed:false,nodes:[c,d]});
 assert.ok(bounds.x>-1000&&bounds.x<0,bounds.x);assert.ok(bounds.x+bounds.width<1100&&bounds.x+bounds.width>100);
});

test('pathBounds includes the closing cubic segment',()=>{
 const a=g.node(0,0),b=g.node(100,0);b.out={x:100,y:-200};a.in={x:0,y:-200};
 assert.deepEqual(g.pathBounds({closed:false,nodes:[a,b]}),{x:0,y:0,width:100,height:0});
 assert.deepEqual(g.pathBounds({closed:true,nodes:[a,b]}),{x:0,y:-150,width:100,height:150});
});

test('contentBounds preserves the image extent and pads only overflowing curve edges',()=>{
 const inside={width:300,height:200,paths:[{nodes:[g.node(20,30),g.node(80,90)],closed:false}]};
 assert.deepEqual(g.contentBounds(inside),{x:0,y:0,width:300,height:200});
 const left=g.node(-20,50),far=g.node(340,250);
 assert.deepEqual(g.contentBounds({width:300,height:200,paths:[{nodes:[left,far],closed:false}]}),{x:-24,y:0,width:368,height:254});
 const source={id:'far',closed:false,nodes:[g.node(325,20),g.node(350,40)]};
 const mirrored=g.reflectPath(source,{x:0,y:0},{x:0,y:100});
 assert.deepEqual(g.contentBounds({width:300,height:200,paths:[mirrored]}),{x:-354,y:0,width:654,height:200});
 assert.deepEqual(g.contentBounds({paths:[]}),{x:0,y:0,width:1000,height:700});
});

test('pathsInRect selects curve crossings and rejects bounding-box-only near misses',()=>{
 const a=g.node(0,0),b=g.node(100,0);a.out={x:0,y:100};b.in={x:100,y:100};
 const arch={id:'arch',closed:false,nodes:[a,b]};
 const negative={id:'negative',closed:false,nodes:[g.node(-20,-20),g.node(-10,-10)]};
 const point={id:'point',closed:false,nodes:[g.node(50,10)]};
 const paths=[arch,negative,point];
 assert.deepEqual(g.pathsInRect(paths,{x:45,y:70,width:10,height:10}),['arch']);
 assert.deepEqual(g.pathsInRect(paths,{x:45,y:5,width:10,height:10}),['point']);
 assert.deepEqual(g.pathsInRect(paths,{x:-20,y:-20,width:0,height:0}),['negative']);
});

test('pathsInRect checks the final segment of a closed path',()=>{
 const a=g.node(0,0),b=g.node(100,0);b.out={x:100,y:-100};a.in={x:0,y:-100};
 const path={id:'closed',closed:true,nodes:[a,b]};
 assert.deepEqual(g.pathsInRect([path],{x:45,y:-80,width:10,height:10}),['closed']);
});

test('pathsInRect follows collinear cubic overshoot instead of collapsing to its endpoint chord',()=>{
 const a=g.node(0,0),b=g.node(10,0);a.out={x:100,y:0};b.in={x:100,y:0};
 const path={id:'overshoot',closed:false,nodes:[a,b]};
 assert.ok(g.pathBounds(path).x+g.pathBounds(path).width>76);
 assert.deepEqual(g.pathsInRect([path],{x:60,y:-5,width:15,height:10}),['overshoot']);
});

test('pathsInRect follows collinear backtracking on a closed final segment',()=>{
 const a=g.node(0,0),b=g.node(10,0);b.out={x:100,y:0};a.in={x:100,y:0};
 const path={id:'closed-overshoot',closed:true,nodes:[a,b]};
 assert.deepEqual(g.pathsInRect([path],{x:60,y:-5,width:15,height:10}),['closed-overshoot']);
});

test('pathsInRect subdivides a zero-chord cubic loop',()=>{
 const a=g.node(0,0),b=g.node(0,0);a.out={x:100,y:0};b.in={x:100,y:0};
 const path={id:'zero-chord',closed:false,nodes:[a,b]};
 assert.deepEqual(g.pathsInRect([path],{x:65,y:-5,width:10,height:10}),['zero-chord']);
});

test('nodesInRect returns anchors in path order for normalized rectangles',()=>{
 const paths=[{id:'a',nodes:[g.node(-5,0),g.node(5,5)]},{id:'b',nodes:[g.node(10,10)]}];
 assert.deepEqual(g.nodesInRect(paths,{x:6,y:6,width:-12,height:-12}),[{pathId:'a',index:0},{pathId:'a',index:1}]);
});
