import sharp from "sharp";
import type {RawImage} from "./types";

const toSharp=(img:RawImage)=>sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}});

/** Lanczos resample of an RGBA image, in memory only. */
export async function resizeRaw(img:RawImage,width:number,height:number):Promise<RawImage>{
  if(img.width===width&&img.height===height) return img;
  const r=await toSharp(img).resize(width,height,{fit:"fill",kernel:"lanczos3"}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {width:r.info.width,height:r.info.height,data:new Uint8ClampedArray(r.data.buffer,r.data.byteOffset,r.data.byteLength)};
}

/** Upscale a 0/255 mask smoothly then re-threshold, so the edit area keeps a clean crisp edge. */
export async function resizeMask(mask:Uint8Array,w:number,h:number,tw:number,th:number):Promise<Uint8Array>{
  if(w===tw&&h===th) return mask;
  const r=await sharp(Buffer.from(mask.buffer,mask.byteOffset,mask.byteLength),{raw:{width:w,height:h,channels:1}}).resize(tw,th,{fit:"fill",kernel:"cubic"}).extractChannel(0).raw().toBuffer(); // sharp expands 1-channel input to 3 channels on output
  if(r.length!==tw*th) throw new Error("MASK_RESIZE_CHANNEL_MISMATCH");
  const out=new Uint8Array(tw*th);
  for(let i=0;i<out.length;i++) out[i]=r[i]>=128?255:0;
  return out;
}
