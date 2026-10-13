import sharp from "sharp";
import type {RawImage} from "./types";

export const ARTWORK_LIMITS={maxBytes:40*1024*1024,maxSide:8000,minSide:800};

export type IntakeResult={ok:true;image:RawImage;note?:string}|{ok:false;error:string};

/** Decode an uploaded artwork in memory: orientation applied, colour converted to sRGB, transparency flattened on white, metadata dropped. */
export async function prepareArtwork(bytes:Buffer):Promise<IntakeResult>{
  if(!bytes.length) return {ok:false,error:"ARTWORK_EMPTY"};
  if(bytes.length>ARTWORK_LIMITS.maxBytes) return {ok:false,error:"ARTWORK_TOO_LARGE"};
  try{
    const meta=await sharp(bytes,{failOn:"error"}).metadata();
    if(!meta.width||!meta.height) return {ok:false,error:"ARTWORK_UNREADABLE"};
    if(meta.format&&!["jpeg","png","webp"].includes(meta.format)) return {ok:false,error:"ARTWORK_FORMAT_UNSUPPORTED"};
    const s=Math.max(meta.width,meta.height),m=Math.min(meta.width,meta.height);
    if(s>ARTWORK_LIMITS.maxSide) return {ok:false,error:"ARTWORK_TOO_MANY_PIXELS"};
    if(s<ARTWORK_LIMITS.minSide) return {ok:false,error:"ARTWORK_TOO_SMALL"};
    if(s/m>4) return {ok:false,error:"ARTWORK_ASPECT_EXTREME"};
    const hadAlpha=!!meta.hasAlpha;
    const r=await sharp(bytes,{failOn:"error"}).rotate().flatten({background:"#ffffff"}).toColourspace("srgb").ensureAlpha().raw().toBuffer({resolveWithObject:true});
    return {ok:true,image:{width:r.info.width,height:r.info.height,data:new Uint8ClampedArray(r.data.buffer,r.data.byteOffset,r.data.byteLength)},note:hadAlpha?"transparency was flattened onto white":undefined};
  }catch{return {ok:false,error:"ARTWORK_UNREADABLE"};}
}
