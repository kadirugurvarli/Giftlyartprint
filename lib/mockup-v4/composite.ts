import type {Quad,RawImage} from "../mockup-v3/types";
import {compositeOver,warpToQuad} from "../mockup-v3/geometry/warp";
import {featherAlpha} from "../mockup-v3/vision/mask";
import {linearToSrgb8,SRGB_TO_LINEAR} from "../mockup-v3/composite/color";

/**
 * The original artwork projected onto the calibrated art quad (RGBA, coverage in alpha). This IS the expected warp.
 * The warp is done in a bbox-sized canvas (integer-shifted quad) and pasted back: V3's matrix inversion uses a tolerance relative to the
 * largest matrix entry, which wrongly reports "singular" for a small quad far from the origin in a large image.
 */
export function expectedArtLayer(art:RawImage,artQuad:Quad,width:number,height:number):RawImage{
  const xs=artQuad.map(p=>p.x),ys=artQuad.map(p=>p.y);
  const x0=Math.max(0,Math.floor(Math.min(...xs))-2),y0=Math.max(0,Math.floor(Math.min(...ys))-2);
  const x1=Math.min(width,Math.ceil(Math.max(...xs))+2),y1=Math.min(height,Math.ceil(Math.max(...ys))+2);
  const bw=x1-x0,bh=y1-y0;
  const local=warpToQuad(art,artQuad.map(p=>({x:p.x-x0,y:p.y-y0})) as Quad,bw,bh);
  const out=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<bh;y++) out.set(local.data.subarray(y*bw*4,(y+1)*bw*4),((y0+y)*width+x0)*4);
  return {width,height,data:out};
}

/**
 * Hybrid composite:
 *  1. outside the editable mask the BASELINE pixel is kept byte for byte;
 *  2. inside it the model's pixel is blended (edge feathered inward only, so the outside stays exact);
 *  3. the original artwork is re-projected with the deterministic warp and composited last.
 * `candidate` is full scene size (the model's crop pasted back over the baseline).
 */
export function compositeHybrid(o:{baseline:RawImage;candidate:RawImage;editable:Uint8Array;art:RawImage;artQuad:Quad;featherPx?:number}):{image:RawImage;artLayer:RawImage}{
  const {baseline:B,candidate:C,editable}=o;
  const {width:W,height:H}=B;
  if(C.width!==W||C.height!==H) throw new Error("candidate must be scene size");
  const soft=featherAlpha(editable,W,H,o.featherPx ?? 1);
  const out=new Uint8ClampedArray(B.data);
  for(let i=0;i<W*H;i++){
    if(!editable[i]) continue;
    const a=Math.min(soft[i],editable[i])/255,p=i*4;
    if(a>=0.999){out[p]=C.data[p];out[p+1]=C.data[p+1];out[p+2]=C.data[p+2];continue;}
    for(let c=0;c<3;c++) out[p+c]=linearToSrgb8(SRGB_TO_LINEAR[B.data[p+c]]*(1-a)+SRGB_TO_LINEAR[C.data[p+c]]*a);
  }
  const artLayer=expectedArtLayer(o.art,o.artQuad,W,H);
  return {image:compositeOver({width:W,height:H,data:out},artLayer),artLayer};
}
