import {sanitiseHint,type ExifHint} from "../hint";

/** Locate the Exif APP1 payload (starting at "Exif\0\0") in a JPEG without decoding the image. */
export function findExifSegment(bytes:Uint8Array):Uint8Array|null{
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8) return null;
  let i=2;
  while(i+4<bytes.length){
    if(bytes[i]!==0xff){i++;continue;}
    const marker=bytes[i+1];
    if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7)){i+=2;continue;}
    if(marker===0xda||marker===0xd9) break; // start of scan / end: no more metadata
    const len=(bytes[i+2]<<8)|bytes[i+3];
    if(len<2) break;
    if(marker===0xe1 && bytes[i+4]===0x45 && bytes[i+5]===0x78 && bytes[i+6]===0x69 && bytes[i+7]===0x66 && bytes[i+8]===0 && bytes[i+9]===0){
      return bytes.subarray(i+4,i+2+len);
    }
    i+=2+len;
  }
  return null;
}

const clean=(v:unknown)=>typeof v==="string"?v.replace(/[^\x20-\x7e]/g,"").trim().slice(0,60)||undefined:undefined;
const pos=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:undefined;};

type Tag=number|string|undefined;
/**
 * Minimal TIFF/EXIF reader (no dependencies, browser-safe). It reads exactly nine tags from IFD0 and the
 * Exif sub-IFD. It never follows the GPS or Interop pointers, so location data is not even parsed.
 */
function readTags(seg:Uint8Array):Record<number,Tag>{
  // seg starts with "Exif\0\0"; the TIFF block follows
  const tiff=seg.subarray(6);
  if(tiff.length<8) return {};
  const dv=new DataView(tiff.buffer,tiff.byteOffset,tiff.byteLength);
  const le=tiff[0]===0x49&&tiff[1]===0x49;
  if(!le&&!(tiff[0]===0x4d&&tiff[1]===0x4d)) return {};
  if(dv.getUint16(2,le)!==42) return {};
  const out:Record<number,Tag>={};
  const WANT0=new Set([0x010f,0x0110,0x8769]),WANT1=new Set([0x920a,0xa405,0xa002,0xa003,0xa20e,0xa210]);
  const SIZE:Record<number,number>={1:1,2:1,3:2,4:4,5:8,7:1};
  let exifPtr=0;
  const readIfd=(off:number,want:Set<number>)=>{
    if(off<8||off+2>tiff.length) return;
    const n=Math.min(dv.getUint16(off,le),200);
    for(let i=0;i<n;i++){
      const e=off+2+i*12;
      if(e+12>tiff.length) return;
      const tag=dv.getUint16(e,le);
      if(!want.has(tag)) continue;
      const type=dv.getUint16(e+2,le),count=dv.getUint32(e+4,le),size=(SIZE[type] ?? 0)*count;
      if(!size||count>256) continue;
      const vo=size<=4?e+8:dv.getUint32(e+8,le);
      if(vo+size>tiff.length) continue;
      if(type===2) out[tag]=String.fromCharCode(...tiff.subarray(vo,vo+Math.max(0,count-1)));
      else if(type===3) out[tag]=dv.getUint16(vo,le);
      else if(type===4) out[tag]=dv.getUint32(vo,le);
      else if(type===5){const d=dv.getUint32(vo+4,le);out[tag]=d?dv.getUint32(vo,le)/d:undefined;}
      if(tag===0x8769) exifPtr=dv.getUint32(e+8,le);
    }
  };
  readIfd(dv.getUint32(4,le),WANT0);
  if(exifPtr) readIfd(exifPtr,WANT1);
  delete out[0x8769];
  return out;
}

/**
 * Camera facts needed for geometry, taken from the ORIGINAL file. Only whitelisted tags are read
 * out: the GPS block is never touched, and nothing but this object leaves the browser.
 */
export function extractHint(original:Uint8Array,oriented:{width:number;height:number}):ExifHint{
  const hint:ExifHint={originalWidth:oriented.width,originalHeight:oriented.height};
  const seg=findExifSegment(original);
  if(!seg) return hint;
  let t:Record<number,Tag>;
  try{t=readTags(seg);}catch{return hint;}
  hint.make=clean(t[0x010f]);hint.model=clean(t[0x0110]);
  hint.focalLengthMm=pos(t[0x920a]);hint.focalLength35mm=pos(t[0xa405]);
  hint.focalPlaneXResolution=pos(t[0xa20e]);
  const u=pos(t[0xa210]);hint.focalPlaneResolutionUnit=u&&u<=5?u:undefined;
  hint.exifWidth=pos(t[0xa002]);hint.exifHeight=pos(t[0xa003]);
  for(const k of Object.keys(hint) as (keyof ExifHint)[]) if(hint[k]===undefined) delete hint[k];
  return sanitiseHint(hint);
}

/** Sizes to try, best quality first: keep full size while quality can absorb it, then step the dimensions down. */
export function resizeCandidates(w:number,h:number,maxSide:number):{width:number;height:number;quality:number}[]{
  const out:{width:number;height:number;quality:number}[]=[];
  let s=Math.min(1,maxSide/Math.max(w,h));
  for(let i=0;i<14;i++){
    for(const q of [0.95,0.92,0.88,0.84]) out.push({width:Math.max(16,Math.round(w*s)),height:Math.max(16,Math.round(h*s)),quality:q});
    s*=0.9;
  }
  return out;
}
