import type {ExifHint} from "../hint";
import {extractHint,resizeCandidates} from "./jpeg-exif";

export type Shrunk={blob:Blob;hint:ExifHint;width:number;height:number;originalWidth:number;originalHeight:number;quality:number;scaled:boolean};

/**
 * Browser-side: read the camera facts from the original, then re-encode a sRGB JPEG that fits the byte
 * budget, keeping proportions. The re-encoded file carries NO metadata at all (canvas output has none).
 */
export async function shrinkForUpload(file:File,budget:number,maxSide:number):Promise<Shrunk>{
  const bytes=new Uint8Array(await file.arrayBuffer());
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file,{imageOrientation:"from-image"});}
  catch{throw new Error("This browser cannot read that file. If it is an iPhone HEIC photo, set Settings › Camera › Formats › Most Compatible, or choose a JPEG.");}
  const ow=bitmap.width,oh=bitmap.height;
  const hint=extractHint(bytes,{width:ow,height:oh});
  const draw=(w:number,h:number)=>{
    // halve repeatedly while the reduction is large, so fine detail is averaged rather than skipped
    let src:CanvasImageSource=bitmap,sw=ow,sh=oh;
    while(sw/2>=w&&sh/2>=h){
      const c=document.createElement("canvas");c.width=Math.max(1,Math.round(sw/2));c.height=Math.max(1,Math.round(sh/2));
      const g=c.getContext("2d")!;g.imageSmoothingQuality="high";g.drawImage(src,0,0,c.width,c.height);
      src=c;sw=c.width;sh=c.height;
    }
    const c=document.createElement("canvas");c.width=w;c.height=h;
    const g=c.getContext("2d")!;g.imageSmoothingQuality="high";g.drawImage(src,0,0,w,h);
    return c;
  };
  const toBlob=(c:HTMLCanvasElement,q:number)=>new Promise<Blob|null>((res)=>c.toBlob(res,"image/jpeg",q));
  let lastDims="",canvas:HTMLCanvasElement|null=null;
  for(const cand of resizeCandidates(ow,oh,maxSide)){
    const dims=`${cand.width}x${cand.height}`;
    if(dims!==lastDims){canvas=draw(cand.width,cand.height);lastDims=dims;}
    const blob=await toBlob(canvas!,cand.quality);
    if(blob&&blob.size<=budget) return {blob,hint,width:cand.width,height:cand.height,originalWidth:ow,originalHeight:oh,quality:cand.quality,scaled:cand.width!==ow};
  }
  throw new Error("Could not shrink this photo enough to upload. Try a smaller photo.");
}
