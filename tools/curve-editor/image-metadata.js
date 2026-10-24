(function(root,factory){
 const api=factory();
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.CurveImageMetadata=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const MAX_PARTS=4096,MAX_IFD_ENTRIES=512;

 function inputBytes(value){
  if(value instanceof Uint8Array)return value;
  if(typeof ArrayBuffer!=='undefined'&&value instanceof ArrayBuffer)return new Uint8Array(value);
  return null;
 }
 function has(bytes,offset,length){return Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>=0&&offset<=bytes.length-length;}
 function u16be(bytes,offset){return has(bytes,offset,2)?bytes[offset]*256+bytes[offset+1]:null;}
 function u16le(bytes,offset){return has(bytes,offset,2)?bytes[offset]+bytes[offset+1]*256:null;}
 function u32be(bytes,offset){return has(bytes,offset,4)?bytes[offset]*0x1000000+bytes[offset+1]*0x10000+bytes[offset+2]*256+bytes[offset+3]:null;}
 function u32le(bytes,offset){return has(bytes,offset,4)?bytes[offset]+bytes[offset+1]*256+bytes[offset+2]*0x10000+bytes[offset+3]*0x1000000:null;}
 function u24le(bytes,offset){return has(bytes,offset,3)?bytes[offset]+bytes[offset+1]*256+bytes[offset+2]*0x10000:null;}
 function textAt(bytes,offset,value){
  if(!has(bytes,offset,value.length))return false;
  for(let i=0;i<value.length;i++)if(bytes[offset+i]!==value.charCodeAt(i))return false;
  return true;
 }
 function validDensity(x,y){return Number.isFinite(x)&&x>0&&Number.isFinite(y)&&y>0;}
 function result(dpiX,dpiY,orientation,source){return validDensity(dpiX,dpiY)?{dpiX,dpiY,orientation,source}:null;}

 function readPng(bytes){
  const signature=[137,80,78,71,13,10,26,10];
  if(!has(bytes,0,8)||signature.some((value,index)=>bytes[index]!==value))return null;
  let offset=8;
  for(let part=0;part<MAX_PARTS&&has(bytes,offset,12);part++){
   const length=u32be(bytes,offset),data=offset+8,end=data+length;
   if(length===null||!has(bytes,data,length)||!has(bytes,end,4))return null;
   if(textAt(bytes,offset+4,'pHYs')){
    if(length!==9)return null;
    const x=u32be(bytes,data),y=u32be(bytes,data+4),unit=bytes[data+8];
    return unit===1?result(x*.0254,y*.0254,1,'png-pHYs'):null;
   }
   offset=end+4;
   if(textAt(bytes,offset-length-8,'IEND'))break;
  }
  return null;
 }

 function parseTiff(bytes,start,end){
  const length=end-start;
  if(length<8)return {orientation:1,density:null};
  const little=textAt(bytes,start,'II'),big=textAt(bytes,start,'MM');
  if(!little&&!big)return {orientation:1,density:null};
  const u16=offset=>{
   if(!has(bytes,start+offset,2)||start+offset+2>end)return null;
   return little?bytes[start+offset]+bytes[start+offset+1]*256:u16be(bytes,start+offset);
  };
  const u32=offset=>{
   if(!has(bytes,start+offset,4)||start+offset+4>end)return null;
   return little?u32le(bytes,start+offset):u32be(bytes,start+offset);
  };
  if(u16(2)!==42)return {orientation:1,density:null};
  const ifd=u32(4);
  if(ifd===null||ifd>length-2)return {orientation:1,density:null};
  const count=u16(ifd);
  if(count===null||count>MAX_IFD_ENTRIES||count>(length-ifd-2)/12)return {orientation:1,density:null};
  let orientation=1,x=null,y=null,unit=null;
  for(let i=0;i<count;i++){
   const entry=ifd+2+i*12,tag=u16(entry),type=u16(entry+2),items=u32(entry+4),valueOffset=entry+8;
   if(tag===null||type===null||items===null)continue;
   if((tag===0x0112||tag===0x0128)&&type===3&&items===1){
    const value=u16(valueOffset);
    if(tag===0x0112&&value>=1&&value<=8)orientation=value;
    if(tag===0x0128)unit=value;
   }else if((tag===0x011a||tag===0x011b)&&type===5&&items===1){
    const rationalOffset=u32(valueOffset);
    if(rationalOffset===null||rationalOffset>length-8)continue;
    const numerator=u32(rationalOffset),denominator=u32(rationalOffset+4);
    const value=denominator?numerator/denominator:null;
    if(tag===0x011a)x=value;else y=value;
   }
  }
  const scale=unit===2?1:unit===3?2.54:null;
  return {orientation,density:scale&&validDensity(x,y)?{dpiX:x*scale,dpiY:y*scale}:null};
 }
 function parseExif(bytes,start,end){
  if(textAt(bytes,start,'Exif\0\0'))start+=6;
  return parseTiff(bytes,start,end);
 }

 function readJpeg(bytes){
  if(!has(bytes,0,2)||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  let offset=2,jfifDensity=null,exifDensity=null,orientation=1;
  for(let part=0;part<MAX_PARTS&&offset<bytes.length;part++){
   while(offset<bytes.length&&bytes[offset]===0xff)offset++;
   if(offset>=bytes.length)break;
   const marker=bytes[offset++];
   if(marker===0xd9||marker===0xda)break;
   if(marker===0x00||marker===0x01||(marker>=0xd0&&marker<=0xd8))continue;
   const segmentLength=u16be(bytes,offset);
   if(segmentLength===null||segmentLength<2||!has(bytes,offset,segmentLength))break;
   const start=offset+2,end=offset+segmentLength;
   if(marker===0xe0&&textAt(bytes,start,'JFIF\0')&&end-start>=14){
    const unit=bytes[start+7],x=u16be(bytes,start+8),y=u16be(bytes,start+10),scale=unit===1?1:unit===2?2.54:null;
    if(scale&&validDensity(x,y))jfifDensity={dpiX:x*scale,dpiY:y*scale};
   }else if(marker===0xe1&&textAt(bytes,start,'Exif\0\0')){
    const parsed=parseExif(bytes,start,end);
    orientation=parsed.orientation;
    if(parsed.density)exifDensity=parsed.density;
   }
   offset=end;
  }
  const density=exifDensity||jfifDensity;
  return density?result(density.dpiX,density.dpiY,orientation,exifDensity?'jpeg-exif':'jpeg-jfif'):null;
 }

 // User-selected fallback for this scanner's A4/100-DPI pixel dimensions.
 // Explicit metadata always wins; other uncalibrated images stay in pixels.
 function scannerDefault(value){
  if(read(value))return null;
  const size=pixelSize(value);
  return size&&((size.width===826&&size.height===1168)||(size.width===1168&&size.height===826))
   ?{dpiX:100,dpiY:100,orientation:1,source:'scanner-default',defaultDpi:true}:null;
 }

 function readWebp(bytes){
  if(!textAt(bytes,0,'RIFF')||!textAt(bytes,8,'WEBP'))return null;
  const riffSize=u32le(bytes,4),limit=riffSize===null?0:8+riffSize;
  if(riffSize<4||limit>bytes.length)return null;
  let offset=12;
  for(let part=0;part<MAX_PARTS&&offset<limit;part++){
   if(offset>limit-8)return null;
   const size=u32le(bytes,offset+4),start=offset+8,end=start+size,padded=end+(size&1);
   if(size===null||end>limit||padded>limit)return null;
   if(textAt(bytes,offset,'EXIF')){
    const parsed=parseExif(bytes,start,end),density=parsed.density;
    return density?result(density.dpiX,density.dpiY,parsed.orientation,'webp-exif'):null;
   }
   offset=padded;
  }
  return null;
 }

 function read(value){
  try{
   const bytes=inputBytes(value);
   if(!bytes)return null;
   if(has(bytes,0,8)&&bytes[0]===137&&textAt(bytes,1,'PNG')&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10)return readPng(bytes);
   if(has(bytes,0,2)&&bytes[0]===0xff&&bytes[1]===0xd8)return readJpeg(bytes);
   if(textAt(bytes,0,'RIFF')&&textAt(bytes,8,'WEBP'))return readWebp(bytes);
   return null;
  }catch{return null;}
 }

 function sizeResult(width,height){return Number.isInteger(width)&&width>0&&Number.isInteger(height)&&height>0?{width,height}:null;}
 function pngPixelSize(bytes){
  if(!has(bytes,0,33)||bytes[0]!==137||!textAt(bytes,1,'PNG')||bytes[4]!==13||bytes[5]!==10||bytes[6]!==26||bytes[7]!==10)return null;
  if(u32be(bytes,8)!==13||!textAt(bytes,12,'IHDR'))return null;
  const width=u32be(bytes,16),height=u32be(bytes,20);
  return width<=0x7fffffff&&height<=0x7fffffff?sizeResult(width,height):null;
 }
 function isSof(marker){return (marker>=0xc0&&marker<=0xc3)||(marker>=0xc5&&marker<=0xc7)||(marker>=0xc9&&marker<=0xcb)||(marker>=0xcd&&marker<=0xcf);}
 function jpegPixelSize(bytes){
  if(!has(bytes,0,2)||bytes[0]!==0xff||bytes[1]!==0xd8)return null;
  let offset=2;
  for(let part=0;part<MAX_PARTS&&offset<bytes.length;part++){
   while(offset<bytes.length&&bytes[offset]===0xff)offset++;
   if(offset>=bytes.length)return null;
   const marker=bytes[offset++];
   if(marker===0xd9||marker===0xda)return null;
   if(marker===0x00||marker===0x01||(marker>=0xd0&&marker<=0xd8))continue;
   const segmentLength=u16be(bytes,offset);
   if(segmentLength===null||segmentLength<2||!has(bytes,offset,segmentLength))return null;
   const start=offset+2,end=offset+segmentLength;
   if(isSof(marker)){
    if(end-start<6)return null;
    const components=bytes[start+5];
    if(components<1||end-start<6+components*3)return null;
    return sizeResult(u16be(bytes,start+3),u16be(bytes,start+1));
   }
   offset=end;
  }
  return null;
 }
 function webpPixelSize(bytes){
  if(!textAt(bytes,0,'RIFF')||!textAt(bytes,8,'WEBP'))return null;
  const riffSize=u32le(bytes,4),limit=riffSize===null?0:8+riffSize;
  if(riffSize<4||limit>bytes.length)return null;
  let offset=12;
  for(let part=0;part<MAX_PARTS&&offset<limit;part++){
   if(offset>limit-8)return null;
   const size=u32le(bytes,offset+4),start=offset+8,end=start+size,padded=end+(size&1);
   if(size===null||end>limit||padded>limit)return null;
   if(textAt(bytes,offset,'VP8X')){
    if(size!==10)return null;
    const width=u24le(bytes,start+4)+1,height=u24le(bytes,start+7)+1;
    return width*height<=0xffffffff?sizeResult(width,height):null;
   }
   if(textAt(bytes,offset,'VP8 ')){
    if(size<10||(bytes[start]&1)!==0||bytes[start+3]!==0x9d||bytes[start+4]!==0x01||bytes[start+5]!==0x2a)return null;
    return sizeResult(u16le(bytes,start+6)&0x3fff,u16le(bytes,start+8)&0x3fff);
   }
   if(textAt(bytes,offset,'VP8L')){
    if(size<5||bytes[start]!==0x2f)return null;
    const packed=u32le(bytes,start+1);
    return sizeResult((packed&0x3fff)+1,((packed>>>14)&0x3fff)+1);
   }
   offset=padded;
  }
  return null;
 }
 function pixelSize(value){
  try{
   const bytes=inputBytes(value);
   if(!bytes)return null;
   if(has(bytes,0,8)&&bytes[0]===137&&textAt(bytes,1,'PNG'))return pngPixelSize(bytes);
   if(has(bytes,0,2)&&bytes[0]===0xff&&bytes[1]===0xd8)return jpegPixelSize(bytes);
   if(textAt(bytes,0,'RIFF')&&textAt(bytes,8,'WEBP'))return webpPixelSize(bytes);
   return null;
  }catch{return null;}
 }
 return {read,pixelSize,scannerDefault};
});
