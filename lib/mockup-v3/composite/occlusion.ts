import type {Pt,RawImage} from "../types";
import {featherAlpha,rasterizePolygons} from "../vision/mask";

/** 255 = foreground occluder fully in front of the placed object, 0 = nothing in front. */
export type OcclusionMask={width:number;height:number;alpha:Uint8Array};

export type BrushStroke={points:Pt[];radiusPx:number;erase?:boolean};

export function emptyOcclusion(width:number,height:number):OcclusionMask{
  return {width,height,alpha:new Uint8Array(width*height)};
}

/** Closed polygons (hand-traced outlines). Several polygons are a union. */
export function maskFromPolygons(polys:Pt[][],width:number,height:number,featherSigmaPx=1.0):OcclusionMask{
  return {width,height,alpha:featherAlpha(rasterizePolygons(polys,width,height),width,height,featherSigmaPx)};
}

function capsule(a:Pt,b:Pt,r:number):Pt[]{
  const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy);
  const pts:Pt[]=[];
  const base=l>0?Math.atan2(dy,dx):0;
  const n=14;
  for(let i=0;i<=n;i++){const t=base-Math.PI/2+Math.PI*i/n;pts.push({x:b.x+r*Math.cos(t),y:b.y+r*Math.sin(t)});}
  for(let i=0;i<=n;i++){const t=base+Math.PI/2+Math.PI*i/n;pts.push({x:a.x+r*Math.cos(t),y:a.y+r*Math.sin(t)});}
  return pts;
}

/** Brush (and eraser) strokes as a touch/mouse UI would send them; mobile friendly. */
export function maskFromBrushStrokes(strokes:BrushStroke[],width:number,height:number,featherSigmaPx=1.0):OcclusionMask{
  const acc=new Float32Array(width*height);
  for(const s of strokes){
    const pts=s.points.length===1?[s.points[0],s.points[0]]:s.points;
    const polys:Pt[][]=[];
    for(let i=0;i+1<pts.length;i++) polys.push(capsule(pts[i],pts[i+1],s.radiusPx));
    const cov=rasterizePolygons(polys,width,height,4);
    for(let i=0;i<acc.length;i++){
      const c=cov[i]/255;
      acc[i]=s.erase?acc[i]*(1-c):Math.max(acc[i],c);
    }
  }
  const a=new Uint8Array(width*height);
  for(let i=0;i<a.length;i++) a[i]=Math.round(acc[i]*255);
  return {width,height,alpha:featherAlpha(a,width,height,featherSigmaPx)};
}

export function unionOcclusion(a:OcclusionMask,b:OcclusionMask):OcclusionMask{
  const out=new Uint8Array(a.alpha.length);
  for(let i=0;i<out.length;i++) out[i]=Math.max(a.alpha[i],b.alpha[i]);
  return {width:a.width,height:a.height,alpha:out};
}

/** Put the original scene pixels back wherever an occluder stands in front of the composite. */
export function applyOcclusion(composited:RawImage,originalScene:RawImage,mask:OcclusionMask):RawImage{
  if(composited.width!==mask.width||composited.height!==mask.height) throw new Error("Occlusion mask size mismatch.");
  const out=new Uint8ClampedArray(composited.data);
  for(let i=0;i<mask.alpha.length;i++){
    const a=mask.alpha[i];
    if(a===0) continue;
    if(a===255){
      out[i*4]=originalScene.data[i*4];out[i*4+1]=originalScene.data[i*4+1];out[i*4+2]=originalScene.data[i*4+2];
      continue;
    }
    const k=a/255;
    for(let c=0;c<3;c++) out[i*4+c]=Math.round(composited.data[i*4+c]*(1-k)+originalScene.data[i*4+c]*k);
  }
  return {width:composited.width,height:composited.height,data:out};
}

/**
 * Pluggable source of occlusion masks. The first implementation is manual; an automatic
 * segmenter (e.g. a hosted model) implements the same interface and returns a mask for the
 * placement region, with `null` meaning "nothing in front / not available".
 */
export interface OcclusionProvider{
  readonly id:string;
  provide(scene:RawImage,placement:{quad:Pt[]}):Promise<OcclusionMask|null>;
}

export class ManualOcclusionProvider implements OcclusionProvider{
  readonly id="manual";
  constructor(private readonly mask:OcclusionMask|null){}
  async provide(){return this.mask;}
}
