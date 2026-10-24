const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../../tools/curve-editor/printing.js');
const P=fs.existsSync(file)?require(file):{};
const G=require('../../tools/curve-editor/geometry.js'),L=require('../../tools/curve-editor/layers.js');
function sample(width=100,height=50){return L.normalize({title:'打印 <测试>',paths:[{id:'one',closed:true,nodes:[G.node(-20,-10),G.node(width-20,-10),G.node(width-20,height-10),G.node(-20,height-10)]},{id:'two',nodes:[G.node(500,0),G.node(600,0)]}],images:[],texts:[],layers:[{id:'a',name:'a',pathIds:['one'],imageIds:[],visible:true,locked:false},{id:'b',name:'b',pathIds:['two'],imageIds:[],visible:true,locked:false}],calibration:{a:{x:0,y:0},b:{x:100,y:0},length:10,unit:'cm'}});}
test('printing exposes a calibrated layout API',()=>assert.equal(typeof P.layout,'function'));
test('only selected visible curves print in mm without changing source geometry',()=>{
 const doc=sample(),before=JSON.stringify(doc),p=P.layout(doc,['one']);
 assert.equal(p.widthMm,100);assert.equal(p.heightMm,50);assert.equal(p.pages.length,1);assert.deepEqual(p.pathIds,['one']);assert.equal(JSON.stringify(doc),before);
 assert.equal(p.paths[0].nodes[0].x,1);assert.equal(p.paths[0].nodes[0].y,1);
 doc.layers[0].visible=false;assert.throws(()=>P.layout(doc,['one']),/可见曲线/);
});
test('no selection and missing or invalid calibration are actionable errors',()=>{
 const doc=sample();assert.throws(()=>P.layout(doc,[]),/选择/);doc.calibration=null;assert.throws(()=>P.layout(doc,['one']),/标定/);
 doc.calibration={a:{x:0,y:0},b:{x:0,y:0},length:1,unit:'mm'};assert.throws(()=>P.layout(doc,['one']),/标定/);
});
test('true cubic bounds exclude remote handles while retaining actual bow',()=>{
 const doc=sample();doc.paths[0].closed=false;doc.paths[0].nodes=[G.node(0,0),G.node(100,0)];doc.paths[0].nodes[0].out={x:0,y:100};doc.paths[0].nodes[1].in={x:100,y:100};
 const p=P.layout(doc,['one']);assert.equal(p.widthMm,100);assert.equal(p.heightMm,75);
});
test('oversized curves tile with overlap and orientation or paper changes never rescale',()=>{
 const doc=sample(350,300),p=P.layout(doc,['one']);assert.equal(p.pages.length,4);assert.equal(p.columns,2);assert.equal(p.rows,2);
 assert.equal(p.pages[1].x,185);assert.equal(p.pages[2].y,262);assert.equal(p.overlapMm,5);
 const a3=P.layout(doc,['one'],{paper:'A3',orientation:'landscape'});assert.equal(a3.widthMm,350);assert.equal(a3.heightMm,300);assert.equal(a3.paperWidthMm,420);assert.equal(a3.pages.length,2);
 assert.equal(P.layout(sample(188,265),['one']).pages.length,1);
 assert.equal(P.layout(sample(188.1,265),['one']).pages.length,2);
 assert.throws(()=>P.layout(sample(100000,10),['one']),/100 页/);
});
test('horizontal and vertical curves print and HTML has physical page sizes and escaped text',()=>{
 const doc=sample(100,0),p=P.layout(doc,['one']);assert.equal(p.heightMm,0);assert.equal(p.pages.length,1);
 const html=P.documentHTML(p);assert.match(html,/@page\s*\{\s*size:\s*210mm 297mm/);assert.match(html,/width="190mm" height="267mm"/);assert.match(html,/打印 &lt;测试&gt;/);assert.match(html,/50 mm/);assert.doesNotMatch(html,/NaN|Infinity|<script|<image/);
 assert.equal(P.layout(sample(0,100),['one']).widthMm,0);
});
