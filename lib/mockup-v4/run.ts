import type {Pt,Quad,RawImage} from "../mockup-v3/types";
import {homographyFromPoints,applyHomography} from "../mockup-v3/geometry/homography";
import {rectQuad} from "../mockup-v3/geometry/quad";
import {rasterizePolygons} from "../mockup-v3/vision/mask";
import {buildEditMask,cropMask,type EditMask} from "./mask";
import {planRequest} from "./request";
import {resizeMask,resizeRaw} from "./resample";
import {compositeHybrid} from "./composite";
import {cropImage,dilateBinary,pasteImage,regionDelta,type RegionDelta} from "./integrity";
import type {EditResult,HybridImageEditor,Rect} from "./types";

export type HybridThresholds={
  /** Provisional: to be calibrated on the first real output. Never loosen merely to pass. */
  maxCandidateArtDriftMeanDE:number;
  maxCandidateOutsideDriftMeanDE:number;
  maxCandidateOutsideDriftP95DE:number;
  maxCandidateOutsideBigFraction:number;
  maxEditableShare:number;
  /** independent baseline art vs deterministic re-warp */
  maxBaselineArtMeanDE:number;
};
export const DEFAULT_THRESHOLDS:HybridThresholds={
  maxCandidateArtDriftMeanDE:4,
  maxCandidateOutsideDriftMeanDE:2.5,
  maxCandidateOutsideDriftP95DE:8,
  maxCandidateOutsideBigFraction:0.005,
  maxEditableShare:0.35,
  maxBaselineArtMeanDE:2.5
};

export type HybridInput={
  baseline:RawImage;
  art:RawImage;
  outerQuad:Quad;
  artQuad:Quad;
  shadowDir:Pt;
  shadowBandPx:number;
  wallAlpha?:Uint8Array|null;
  protect?:Pt[][];
  prompt:string;
  references?:RawImage[];
  editor:HybridImageEditor;
  thresholds?:Partial<HybridThresholds>;
  contextPx?:number;
  /** Frame moulding width in scene px; when given, the request is upscaled until the moulding is wide enough for detail. */
  mouldingPx?:number;
  minMouldingPx?:number;
};

export type HybridCheck={name:string;pass:boolean;detail:string};
export type HybridOutcome=
  |{ok:false;error:string;detail?:string}
  |{ok:true;verdict:"accept"|"reject";rejectReasons:string[];image:RawImage;candidateFull:RawImage;mask:EditMask;crop:Rect;checks:HybridCheck[];meta:EditResult["meta"];metrics:Record<string,RegionDelta>;scale:number};

/** Art quad (inside the mount) from a rendered piece's print rectangle and the piece->scene outer quad. */
export function printQuadFromPlan(outerQuad:Quad,piece:{width:number;height:number},print:Rect):Quad{
  const H=homographyFromPoints(rectQuad(piece.width,piece.height),outerQuad);
  if(!H) throw new Error("degenerate outer quad");
  const c:Pt[]=[{x:print.x,y:print.y},{x:print.x+print.width,y:print.y},{x:print.x+print.width,y:print.y+print.height},{x:print.x,y:print.y+print.height}];
  return c.map((p)=>applyHomography(H,p)!) as Quad;
}

const inside=(q:Quad,W:number,H:number)=>q.every((p)=>p.x>=0&&p.y>=0&&p.x<=W&&p.y<=H);

/**
 * Bounded hybrid edit. The model sees a crop of the baseline composite and may change ONLY the frame/shadow mask.
 * Its output is checked for drift in the protected regions (art, furniture, everything outside the mask) and then
 * composited so that: outside the mask = baseline bytes; art = deterministic re-warp of the original.
 */
export async function runHybridEdit(i:HybridInput):Promise<HybridOutcome>{
  const T={...DEFAULT_THRESHOLDS,...i.thresholds};
  const {width:W,height:H}=i.baseline;
  if(!inside(i.outerQuad,W,H)||!inside(i.artQuad,W,H)) return {ok:false,error:"QUAD_OUTSIDE_IMAGE"};
  const outerPoly=rasterizePolygons([i.outerQuad],W,H),artPoly=rasterizePolygons([i.artQuad],W,H);
  let outerN=0,artN=0,artOutside=0;
  for(let k=0;k<W*H;k++){if(outerPoly[k]>=128)outerN++;if(artPoly[k]>=128){artN++;if(outerPoly[k]<128)artOutside++;}}
  if(artN===0||artOutside>0.01*artN) return {ok:false,error:"ART_NOT_INSIDE_FRAME"};
  if(artN>=outerN) return {ok:false,error:"NO_FRAME_RING"};
  const mask=buildEditMask({width:W,height:H,outerQuad:i.outerQuad,artQuad:i.artQuad,shadowDir:i.shadowDir,shadowBandPx:i.shadowBandPx,wallAlpha:i.wallAlpha,protect:i.protect});
  if(mask.stats.editablePixels===0) return {ok:false,error:"EDIT_MASK_EMPTY"};
  if(mask.stats.share>T.maxEditableShare) return {ok:false,error:"EDIT_MASK_TOO_LARGE",detail:`${(mask.stats.share*100).toFixed(1)}% of the scene`};
  const plan=planRequest({mask,constraints:i.editor.constraints,contextPx:i.contextPx ?? 48,mouldingPx:i.mouldingPx,minMouldingPx:i.minMouldingPx});
  if(!plan.ok) return {ok:false,error:plan.error};
  const {crop,scale:k}=plan;
  const rw=crop.width*k,rh=crop.height*k;
  const baseCrop=cropImage(i.baseline,crop);
  const request={image:await resizeRaw(baseCrop,rw,rh),mask:await resizeMask(cropMask(mask,crop),crop.width,crop.height,rw,rh),prompt:i.prompt,references:i.references};
  const res=await i.editor.edit(request);
  if(res.image.width!==rw||res.image.height!==rh) return {ok:false,error:"CANDIDATE_SIZE_MISMATCH",detail:`${res.image.width}x${res.image.height} vs ${rw}x${rh}`};
  const candidateFull=pasteImage(i.baseline,await resizeRaw(res.image,crop.width,crop.height),crop);
  // What an UNCHANGED model output would look like after the same up/down resampling. Drift is measured against this, so the
  // resampling round trip itself is never mistaken for the model repainting something.
  const identityFull=k===1?i.baseline:pasteImage(i.baseline,await resizeRaw(request.image,crop.width,crop.height),crop);
  const comp=compositeHybrid({baseline:i.baseline,candidate:candidateFull,editable:mask.editable,art:i.art,artQuad:i.artQuad});
  const final=comp.image;

  // ---- protected-region integrity
  // resampling (×k request, Lanczos3) smears the mask edge by up to 3 px; the model is only judged beyond that band
  const near=dilateBinary(mask.editable,W,H,k>1?4:0); // Lanczos3 reaches 3 output px
  const protAlpha=i.protect?.length?rasterizePolygons(i.protect,W,H):null;
  const inCrop=(k:number)=>{const x=k%W,y=(k-x)/W;return x>=crop.x&&x<crop.x+crop.width&&y>=crop.y&&y<crop.y+crop.height;};
  const layerA=comp.artLayer.data;
  const artCov=(k:number)=>layerA[k*4+3];
  const metrics:Record<string,RegionDelta>={};
  // 1. the final image must equal the baseline everywhere outside the mask and the art
  metrics.finalOutside=regionDelta(final,i.baseline,(k)=>!mask.editable[k]&&artCov(k)===0);
  // 2. art: byte-identical to the deterministic re-warp (art interior, coverage 255)
  metrics.finalArtVsWarp=regionDelta(final,comp.artLayer,(k)=>artCov(k)===255);
  // 3. independent check: engine's own art pixels in the baseline vs the deterministic re-warp
  metrics.baselineArtVsWarp=regionDelta(i.baseline,final,(k)=>artCov(k)===255);
  // 4. what the MODEL did to protected areas (diagnostic, decides accept/reject)
  metrics.candidateArtDrift=regionDelta(candidateFull,final,(k)=>artCov(k)===255&&inCrop(k)); // model art vs the exact re-warp (diagnostic)
  metrics.candidateArtDriftVsInput=regionDelta(candidateFull,identityFull,(k)=>artCov(k)===255&&inCrop(k));
  metrics.candidateOutsideDrift=regionDelta(candidateFull,identityFull,(q)=>!near[q]&&artCov(q)===0&&inCrop(q));
  metrics.candidateFurnitureDrift=protAlpha?regionDelta(candidateFull,identityFull,(k)=>protAlpha[k]>=250&&inCrop(k)):{count:0,changed:0,meanDE:0,p95DE:0,maxDE:0,bigFraction:0};

  const checks:HybridCheck[]=[];
  const add=(name:string,pass:boolean,detail:string)=>checks.push({name,pass,detail});
  add("final-outside-mask-identical",metrics.finalOutside.changed===0,`${metrics.finalOutside.changed} of ${metrics.finalOutside.count} pixels outside mask/art differ from baseline`);
  add("art-is-deterministic-warp",metrics.finalArtVsWarp.changed===0,`${metrics.finalArtVsWarp.changed} art pixels differ from the re-warp`);
  add("baseline-art-matches-warp",metrics.baselineArtVsWarp.meanDE<=T.maxBaselineArtMeanDE,`engine vs re-warp mean ΔE ${metrics.baselineArtVsWarp.meanDE.toFixed(2)} (limit ${T.maxBaselineArtMeanDE})`);
  add("model-left-art-alone",metrics.candidateArtDriftVsInput.meanDE<=T.maxCandidateArtDriftMeanDE,`model art drift vs its input mean ΔE ${metrics.candidateArtDriftVsInput.meanDE.toFixed(2)}, max ${metrics.candidateArtDriftVsInput.maxDE.toFixed(1)} (limit ${T.maxCandidateArtDriftMeanDE})`);
  const o=metrics.candidateOutsideDrift;
  add("model-left-room-alone",o.meanDE<=T.maxCandidateOutsideDriftMeanDE&&o.p95DE<=T.maxCandidateOutsideDriftP95DE&&o.bigFraction<=T.maxCandidateOutsideBigFraction,`outside-mask drift mean ${o.meanDE.toFixed(2)}, p95 ${o.p95DE.toFixed(1)}, ΔE>10 share ${(o.bigFraction*100).toFixed(2)}%`);
  const f=metrics.candidateFurnitureDrift;
  add("model-left-furniture-alone",f.count===0||f.meanDE<=T.maxCandidateOutsideDriftMeanDE&&f.bigFraction<=T.maxCandidateOutsideBigFraction,`furniture drift mean ${f.meanDE.toFixed(2)}, ΔE>10 share ${(f.bigFraction*100).toFixed(2)}%`);
  const hard=["final-outside-mask-identical","art-is-deterministic-warp","baseline-art-matches-warp"];
  const rejectReasons=checks.filter(c=>!c.pass).map(c=>c.name);
  // composite invariants failing is a bug (error); model drift failing is a rejection
  if(checks.some(c=>hard.includes(c.name)&&!c.pass)) return {ok:false,error:"COMPOSITE_INVARIANT_FAILED",detail:rejectReasons.join(",")};
  return {ok:true,verdict:rejectReasons.length?"reject":"accept",rejectReasons,image:final,candidateFull,mask,crop,checks,meta:res.meta,metrics,scale:k};
}
