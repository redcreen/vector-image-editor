const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const M=require('../../tools/curve-editor/image-metadata.js');

const bytes=(...parts)=>Uint8Array.from(parts.flatMap(part=>Array.from(typeof part==='string'?Buffer.from(part,'ascii'):part)));
const be16=n=>[(n>>>8)&255,n&255];
const be32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
const le32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
function pngPhys(x,y,unit=1){
 return bytes([137,80,78,71,13,10,26,10],be32(9),'pHYs',be32(x),be32(y),[unit],be32(0));
}
function pngSize(width,height){
 return bytes([137,80,78,71,13,10,26,10],be32(13),'IHDR',be32(width),be32(height),[8,6,0,0,0],be32(0));
}
function jpegSegment(marker,payload){return bytes([0xff,marker],be16(payload.length+2),payload);}
function jfif(x,y,unit=1){return jpegSegment(0xe0,bytes('JFIF\0',[1,2,unit],be16(x),be16(y),[0,0]));}
function jpeg(...segments){return bytes([0xff,0xd8],...segments,[0xff,0xd9]);}
function tiff({little=true,x=300,y=300,unit=2,orientation=1,omitY=false,badXOffset=false,zeroDenominator=false}={}){
 const order=little?'II':'MM',u16=n=>little?[n&255,(n>>>8)&255]:be16(n),u32=n=>little?le32(n):be32(n);
 const entries=[];
 entries.push(bytes(u16(0x0112),u16(3),u32(1),u16(orientation),[0,0]));
 entries.push(bytes(u16(0x011a),u16(5),u32(1),u32(badXOffset?0x7fffffff:8+2+(omitY?3:4)*12+4)));
 if(!omitY)entries.push(bytes(u16(0x011b),u16(5),u32(1),u32(8+2+4*12+4+8)));
 entries.push(bytes(u16(0x0128),u16(3),u32(1),u16(unit),[0,0]));
 const ifd=bytes(u16(entries.length),...entries,u32(0));
 const rationals=omitY?bytes(u32(x),u32(zeroDenominator?0:1)):bytes(u32(x),u32(zeroDenominator?0:1),u32(y),u32(1));
 return bytes(order,u16(42),u32(8),ifd,rationals);
}
const exifSegment=options=>jpegSegment(0xe1,bytes('Exif\0\0',tiff(options)));
function webpExif(payload,{declaredSize=payload.length,pad=true}={}){
 const chunk=bytes('EXIF',le32(declaredSize),payload,pad&&payload.length%2?[0]:[]),riffSize=4+chunk.length;
 return bytes('RIFF',le32(riffSize),'WEBP',chunk);
}
function webpChunk(type,payload,{declaredSize=payload.length}={}){
 const chunk=bytes(type,le32(declaredSize),payload,payload.length%2?[0]:[]);
 return bytes('RIFF',le32(4+chunk.length),'WEBP',chunk);
}
const le24=n=>[n&255,(n>>>8)&255,(n>>>16)&255];
function webpVp8x(width,height){return webpChunk('VP8X',bytes([0,0,0,0],le24(width-1),le24(height-1)));}
function webpVp8(width,height){return webpChunk('VP8 ',bytes([0,0,0,0x9d,0x01,0x2a,width&255,(width>>>8)&0x3f,height&255,(height>>>8)&0x3f]));}
function webpVp8l(width,height){
 const bits=(BigInt(height-1)<<14n)|BigInt(width-1);
 return webpChunk('VP8L',bytes([0x2f,Number(bits&255n),Number(bits>>8n&255n),Number(bits>>16n&255n),Number(bits>>24n&255n)]));
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('PNG pHYs converts pixels per metre and accepts ArrayBuffer input',()=>{
 const input=pngPhys(11811,5906);const result=M.read(input.buffer);
 near(result.dpiX,11811*.0254);near(result.dpiY,5906*.0254);
 assert.deepEqual({orientation:result.orientation,source:result.source},{orientation:1,source:'png-pHYs'});
});

test('PNG ignores unitless, zero, truncated, and out-of-bounds pHYs chunks',()=>{
 assert.equal(M.read(pngPhys(300,300,0)),null);
 assert.equal(M.read(pngPhys(0,300,1)),null);
 assert.equal(M.read(pngPhys(300,0,1)),null);
 assert.equal(M.read(pngPhys(300,300,1).slice(0,-6)),null);
 const oversized=pngPhys(300,300,1);oversized.set(be32(0x7fffffff),8);
 assert.equal(M.read(oversized),null);
});

test('JPEG JFIF handles inch and centimetre density while rejecting aspect-only units',()=>{
 assert.deepEqual(M.read(jpeg(jfif(300,150,1))),{dpiX:300,dpiY:150,orientation:1,source:'jpeg-jfif'});
 const cm=M.read(jpeg(jfif(100,50,2)));near(cm.dpiX,254);near(cm.dpiY,127);
 assert.equal(M.read(jpeg(jfif(300,150,0))),null);
 assert.equal(M.read(jpeg(jfif(0,150,1))),null);
});

test('JPEG EXIF reads little- and big-endian rationals and orientation',()=>{
 assert.deepEqual(M.read(jpeg(exifSegment({little:true,x:240,y:120,unit:2,orientation:6}))),{dpiX:240,dpiY:120,orientation:6,source:'jpeg-exif'});
 const big=M.read(jpeg(exifSegment({little:false,x:100,y:50,unit:3,orientation:8})));
 near(big.dpiX,254);near(big.dpiY,127);assert.equal(big.orientation,8);assert.equal(big.source,'jpeg-exif');
});

test('JPEG EXIF density wins over conflicting JFIF regardless of marker order',()=>{
 for(const parts of [[jfif(72,72,1),exifSegment({x:300,y:200})],[exifSegment({x:300,y:200}),jfif(72,72,1)]]){
  const result=M.read(jpeg(...parts));assert.equal(result.dpiX,300);assert.equal(result.dpiY,200);assert.equal(result.source,'jpeg-exif');
 }
});

test('JPEG retains valid EXIF orientation when JFIF supplies density',()=>{
 const result=M.read(jpeg(exifSegment({orientation:7,omitY:true}),jfif(144,96,1)));
 assert.deepEqual(result,{dpiX:144,dpiY:96,orientation:7,source:'jpeg-jfif'});
});

test('EXIF rejects incomplete, unitless, zero-denominator, and out-of-bounds resolution',()=>{
 assert.equal(M.read(jpeg(exifSegment({omitY:true}))),null);
 assert.equal(M.read(jpeg(exifSegment({unit:1}))),null);
 assert.equal(M.read(jpeg(exifSegment({zeroDenominator:true}))),null);
 assert.equal(M.read(jpeg(exifSegment({badXOffset:true}))),null);
 const truncated=jpeg(exifSegment({}));assert.equal(M.read(truncated.slice(0,25)),null);
});

test('WebP reads raw and Exif-prefixed TIFF payloads including orientation',()=>{
 const raw=M.read(webpExif(tiff({x:96,y:192,orientation:5})));
 assert.deepEqual(raw,{dpiX:96,dpiY:192,orientation:5,source:'webp-exif'});
 const prefixed=M.read(webpExif(bytes('Exif\0\0',tiff({little:false,x:100,y:50,unit:3,orientation:8}))));
 near(prefixed.dpiX,254);near(prefixed.dpiY,127);assert.equal(prefixed.orientation,8);assert.equal(prefixed.source,'webp-exif');
});

test('WebP honors RIFF and chunk bounds and odd-size padding',()=>{
 const payload=bytes(tiff({x:72,y:72}),[0]);
 assert.equal(M.read(webpExif(payload)).dpiX,72);
 assert.equal(M.read(webpExif(tiff({}),{declaredSize:0x7fffffff})),null);
 const file=webpExif(tiff({}));file.set(le32(4),4);assert.equal(M.read(file),null);
});

test('unsupported and malformed inputs fail closed without throwing',()=>{
 for(const input of [new Uint8Array(),bytes('not an image'),new Uint8Array([0xff,0xd8,0xff]),null,{},'png']){
  assert.doesNotThrow(()=>M.read(input));assert.equal(M.read(input),null);
 }
});

test('browser UMD exposes the same read API on CurveImageMetadata',()=>{
 const context={Uint8Array,ArrayBuffer};context.globalThis=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../../tools/curve-editor/image-metadata.js'),'utf8'),context);
 assert.equal(typeof context.CurveImageMetadata.read,'function');
 const result=context.CurveImageMetadata.read(pngPhys(300,150));
 near(result.dpiX,7.62);near(result.dpiY,3.81);
});

test('pixelSize reads positive PNG IHDR dimensions from Uint8Array and ArrayBuffer',()=>{
 const input=pngSize(1200,800);
 assert.deepEqual(M.pixelSize(input),{width:1200,height:800});
 assert.deepEqual(M.pixelSize(input.buffer),{width:1200,height:800});
 for(const bad of [pngSize(0,800),pngSize(1200,0),input.slice(0,20)])assert.equal(M.pixelSize(bad),null);
});

test('pixelSize reads all standard JPEG SOF marker families and ignores non-SOF segments',()=>{
 const sofMarkers=[0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf];
 for(const marker of sofMarkers){
  const sof=jpegSegment(marker,bytes([8],be16(480),be16(640),[1,1,0x11,0]));
  assert.deepEqual(M.pixelSize(jpeg(jfif(72,72),sof)),{width:640,height:480},`marker ${marker.toString(16)}`);
 }
 assert.equal(M.pixelSize(jpeg(jfif(72,72))),null);
 assert.equal(M.pixelSize(jpeg(jpegSegment(0xc0,bytes([8],be16(0),be16(640)) ))),null);
 assert.equal(M.pixelSize(jpeg(jpegSegment(0xc0,bytes([8],be16(480),be16(640))))),null);
 assert.equal(M.pixelSize(jpeg(jpegSegment(0xc0,bytes([8],be16(480),be16(640),[1])))),null);
 assert.equal(M.pixelSize(jpeg(jpegSegment(0xc0,bytes([8],be16(480))))),null);
});

test('pixelSize reads WebP VP8X, VP8, and VP8L encoded dimensions',()=>{
 assert.deepEqual(M.pixelSize(webpVp8x(3000,2000)),{width:3000,height:2000});
 assert.deepEqual(M.pixelSize(webpVp8(1024,513)),{width:1024,height:513});
 assert.deepEqual(M.pixelSize(webpVp8l(16384,8193)),{width:16384,height:8193});
});

test('pixelSize rejects malformed WebP signatures, dimensions, and chunk bounds',()=>{
 const badVp8=webpVp8(640,480);badVp8[23]=0;assert.equal(M.pixelSize(badVp8),null);
 const badVp8l=webpVp8l(12,34);badVp8l[20]=0;assert.equal(M.pixelSize(badVp8l),null);
 const oversized=webpChunk('VP8X',bytes([0,0,0,0],le24(1),le24(1)),{declaredSize:0x7fffffff});
 assert.equal(M.pixelSize(oversized),null);
 assert.equal(M.pixelSize(webpVp8x(16777216,16777216)),null);
 const short=webpVp8x(20,10).slice(0,-4);assert.equal(M.pixelSize(short),null);
});

test('pixelSize fails closed for unsupported inputs and is exposed by browser UMD',()=>{
 for(const input of [null,{},bytes('GIF89a'),new Uint8Array([0xff,0xd8,0xff])]){
  assert.doesNotThrow(()=>M.pixelSize(input));assert.equal(M.pixelSize(input),null);
 }
 const context={Uint8Array,ArrayBuffer};context.globalThis=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../../tools/curve-editor/image-metadata.js'),'utf8'),context);
 assert.equal(typeof context.CurveImageMetadata.pixelSize,'function');
 assert.equal(context.CurveImageMetadata.read(pngSize(5,4)),null);
 assert.deepEqual({...context.CurveImageMetadata.pixelSize(pngSize(5,4))},{width:5,height:4});
});

test('user-selected A4 pixel dimensions default to 100 DPI in all supported formats',()=>{
 const jpegSize=jpeg(jpegSegment(0xc0,bytes([8],be16(1168),be16(826),[1,1,0x11,0])));
 for(const b of [pngSize(826,1168),pngSize(1168,826),jpegSize,webpVp8x(826,1168)]){
  assert.equal(M.read(b),null);
  assert.deepEqual(M.scannerDefault(b),{dpiX:100,dpiY:100,orientation:1,source:'scanner-default',defaultDpi:true});
 }
});
test('scanner fallback leaves other sizes, malformed input and explicit DPI alone',()=>{
 for(const b of [pngSize(827,1168),pngSize(826,1169),pngSize(300,150),null,new Uint8Array(),bytes(pngSize(826,1168),pngPhys(11811,11811).slice(8))])assert.equal(M.scannerDefault(b),null);
});
