import type {Quad,RawImage} from "../types";
import {edgeLengths,estimateRectAspect,rectQuad,type AspectMethod} from "../geometry/quad";
import {rectifyQuad,warpToQuad} from "../geometry/warp";
import {
  compareImages,
  erodeMask,
  evaluateFidelity,
  FORWARD_TOLERANCES,
  RECTIFIED_TOLERANCES,
  type FidelityFailureCode,
  type FidelityTolerances,
  type ImageMetrics
} from "./metrics";

export type ProtectedContentReport={
  pass:boolean;
  mode:"forward"|"rectified";
  failures:{code:FidelityFailureCode;detail:string}[];
  metrics:ImageMetrics;
  comparedPixels:number;
  proportion:{
    sourceAspect:number;
    placedAspect:number|null;
    relativeError:number|null;
    method:AspectMethod;
    /** False when the aspect estimate rests on an assumption and was not enforced. */
    reliable:boolean;
  };
};

export type VerifyOptions={
  /** "forward" (default, tight) re-renders the reference with the same warp; "rectified" warps the composite back. */
  mode?:"forward"|"rectified";
  tolerances?:FidelityTolerances;
  /** Pixels trimmed inside the quad edge (anti-aliasing, contact shadow). Default 3. */
  margin?:number;
  /** Known camera focal length in px (e.g. EXIF); makes the proportion check reliable on level-camera shots. */
  focalPx?:number;
  /** Rectified mode only: cap on the comparison width. Default 800. */
  maxCheckWidth?:number;
  /** Full-canvas mask of pixels allowed to be compared (1) e.g. excluding occluders (forward mode). */
  includeMask?:Uint8Array;
};

function proportionCheck(source:RawImage,composite:RawImage,quad:Quad,tol:FidelityTolerances,focalPx?:number){
  const sourceAspect=source.width/source.height;
  const est=estimateRectAspect(quad,composite.width,composite.height,{focalPx});
  const relErr=est.aspect===null?null:Math.abs(est.aspect-sourceAspect)/sourceAspect;
  const failures:{code:FidelityFailureCode;detail:string}[]=[];
  if(est.reliable && relErr!==null && relErr>tol.maxAspectError){
    failures.push({
      code:"PROPORTION_CHANGED",
      detail:`placed aspect ${est.aspect!.toFixed(3)} vs source ${sourceAspect.toFixed(3)} (${(relErr*100).toFixed(1)}% off)`
    });
  }
  return {
    failures,
    proportion:{sourceAspect,placedAspect:est.aspect,relativeError:relErr,method:est.method,reliable:est.reliable}
  };
}

/**
 * The core "did we damage the customer's artwork?" check. The source is never modified.
 *
 * forward  : re-render the source onto `quad` with the same warp on an empty canvas and compare it
 *            with the finished composite pixel for pixel inside the quad. Catches any post-warp
 *            change (tint, overlay, lighting, softening, wrong art, wrong corners).
 * rectified: warp the composite back to an upright rectangle and compare with the source. Does not
 *            depend on the compositor's own warp, at the cost of a second resample.
 *
 * Both also verify that the placed shape keeps the source's proportions (perspective-aware).
 */
export function verifyProtectedContent(
  source:RawImage,
  composite:RawImage,
  quad:Quad,
  opts:VerifyOptions={}
):ProtectedContentReport{
  const mode=opts.mode ?? "forward";
  const tol=opts.tolerances ?? (mode==="forward"?FORWARD_TOLERANCES:RECTIFIED_TOLERANCES);
  const margin=opts.margin ?? 3;

  let metrics:ImageMetrics;
  if(mode==="forward"){
    const reference=warpToQuad(source,quad,composite.width,composite.height);
    const inside=new Uint8Array(composite.width*composite.height);
    for(let i=0;i<inside.length;i++){
      inside[i]=reference.data[i*4+3]===255 && (!opts.includeMask || opts.includeMask[i])?1:0;
    }
    const mask=erodeMask(inside,composite.width,composite.height,margin);
    metrics=compareImages(reference,composite,{mask});
  }else{
    const e=edgeLengths(quad);
    const sourceAspect=source.width/source.height;
    const width=Math.max(16,Math.min(opts.maxCheckWidth ?? 800,Math.round(Math.max(e[0],e[2]))));
    const height=Math.max(16,Math.round(width/sourceAspect));
    const rectified=rectifyQuad(composite,quad,width,height);
    const reference=rectifyQuad(source,rectQuad(source.width,source.height),width,height);
    metrics=compareImages(reference,rectified,{margin});
  }

  const fidelity=evaluateFidelity(metrics,tol);
  const prop=proportionCheck(source,composite,quad,tol,opts.focalPx);
  const failures=[...fidelity.failures,...prop.failures];
  return {
    pass:failures.length===0,
    mode,
    failures,
    metrics,
    comparedPixels:metrics.pixelCount,
    proportion:prop.proportion
  };
}
