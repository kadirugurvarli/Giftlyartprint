import {chooseCrop,type EditMask} from "./mask";
import type {EditorConstraints,Rect} from "./types";

export type RequestPlan=
  |{ok:true;crop:Rect;scale:number;requestWidth:number;requestHeight:number;mouldingPxInRequest:number}
  |{ok:false;error:string};

/** Frame moulding must be at least this many pixels wide in the request for grain, bevel and mitre detail to be possible (provisional). */
export const DEFAULT_MIN_MOULDING_PX=28;

/**
 * Choose the edit crop and an integer upscale so that the request is large enough for realistic frame detail yet inside the
 * provider's limits. Without `mouldingPx` the plan is the plain crop at scale 1 (P1 behaviour).
 */
export function planRequest(o:{mask:EditMask;constraints:EditorConstraints;contextPx:number;mouldingPx?:number;minMouldingPx?:number;maxScale?:number}):RequestPlan{
  const need=o.minMouldingPx ?? DEFAULT_MIN_MOULDING_PX,maxScale=o.maxScale ?? 4;
  const start=o.mouldingPx?Math.max(1,Math.ceil(need/o.mouldingPx)):1;
  if(start>maxScale) return {ok:false,error:"MOULDING_TOO_THIN_FOR_DETAIL"};
  const c=o.constraints;
  const k=start;
  const scaled:EditorConstraints={...c,maxSide:Math.floor(c.maxSide/k),maxPixels:Math.floor(c.maxPixels/(k*k)),minSide:Math.ceil(c.minSide/k)};
  const crop=chooseCrop(o.mask,scaled,o.contextPx);
  if(!crop.ok) return {ok:false,error:crop.error==="CROP_EXCEEDS_EDITOR_LIMITS"?"REQUEST_EXCEEDS_EDITOR_LIMITS":crop.error};
  return {ok:true,crop:crop.crop,scale:k,requestWidth:crop.crop.width*k,requestHeight:crop.crop.height*k,mouldingPxInRequest:(o.mouldingPx ?? 0)*k};
}
