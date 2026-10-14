import type {Quad,RawImage} from "../types";
import {estimateRectAspect} from "../geometry/quad";
import {pickFramedCandidate} from "../pipeline/common";
import {MAX_SOURCE_ASPECT_MISMATCH,type FrameSizeCm} from "./schema";

export type SourceFrameEvidence={
  /** Width/height of the finished framed piece measured from the photo (perspective-corrected). */
  measuredAspect?:number;
  /** False when the measurement had to assume a focal length (it may be off by a few percent). */
  measuredReliable?:boolean;
  /** Width/height from the product record (outer frame dimensions). */
  statedAspect?:number;
};

export type AspectCheck=
  |{ok:true;deviation:number;basis:"measured"|"stated";nominalAspect:number}
  |{ok:false;error:"SOURCE_FRAME_ASPECT_MISMATCH"|"SOURCE_ASPECT_UNVERIFIED"|"INVALID_ASPECT";deviation?:number;nominalAspect:number};

/**
 * The photographed frame must have the proportions of the outer size it is being placed as, within 2 %.
 * Anything else would have to be stretched to fit, and artwork and frames are never stretched.
 * A reliable measurement decides; an unreliable one needs the product record's stated proportions.
 */
export function checkSourceFrameAspect(size:FrameSizeCm,ev:SourceFrameEvidence,tolerance=MAX_SOURCE_ASPECT_MISMATCH):AspectCheck{
  const nominal=size.width/size.height;
  const dev=(a:number)=>Math.abs(a/nominal-1);
  const valid=(a:number|undefined):a is number=>typeof a==="number"&&Number.isFinite(a)&&a>0;
  const results:{basis:"measured"|"stated";d:number}[]=[];
  if(valid(ev.measuredAspect)&&ev.measuredReliable) results.push({basis:"measured",d:dev(ev.measuredAspect)});
  if(valid(ev.statedAspect)) results.push({basis:"stated",d:dev(ev.statedAspect)});
  if(ev.measuredAspect!==undefined&&!valid(ev.measuredAspect)) return {ok:false,error:"INVALID_ASPECT",nominalAspect:nominal};
  if(ev.statedAspect!==undefined&&!valid(ev.statedAspect)) return {ok:false,error:"INVALID_ASPECT",nominalAspect:nominal};
  if(!results.length) return {ok:false,error:"SOURCE_ASPECT_UNVERIFIED",nominalAspect:nominal};
  const worst=results.reduce((a,b)=>b.d>a.d?b:a);
  if(worst.d>tolerance+1e-9) return {ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH",deviation:worst.d,nominalAspect:nominal};
  const best=results.find(r=>r.basis==="measured")??results[0];
  return {ok:true,deviation:worst.d,basis:best.basis,nominalAspect:nominal};
}

/** Measure the finished frame's proportions in a photo (detect the outer quad, then a perspective-corrected aspect). */
export function measureFramedPhotoAspect(photo:RawImage,o:{focalPx?:number;quad?:Quad}={}):{aspect:number;reliable:boolean;method:string;quad:Quad}|null{
  let quad=o.quad??null;
  if(!quad){
    const {evaluated}=pickFramedCandidate(photo,{focalPx:o.focalPx});
    quad=evaluated[0]?.cand.quad ?? null;
  }
  if(!quad) return null;
  const est=estimateRectAspect(quad,photo.width,photo.height,{focalPx:o.focalPx});
  if(est.aspect===null) return null;
  return {aspect:est.aspect,reliable:est.reliable,method:est.method,quad};
}
