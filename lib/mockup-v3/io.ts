import sharp from "sharp";
import type {RawImage} from "./types";

/** Decode any supported image to RGBA, applying EXIF orientation (phone photos). */
export async function decodeImage(buffer:Buffer):Promise<RawImage>{
  const {data,info}=await sharp(buffer).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {width:info.width,height:info.height,data:new Uint8ClampedArray(data.buffer,data.byteOffset,data.byteLength)};
}

export async function encodePng(img:RawImage):Promise<Buffer>{
  return sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{
    raw:{width:img.width,height:img.height,channels:4}
  }).png().toBuffer();
}
