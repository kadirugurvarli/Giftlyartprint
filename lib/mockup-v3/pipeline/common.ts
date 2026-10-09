import type {Quad,RawImage} from "../types";
import {defect,type Defect} from "../detect/defects";
import {detectQuads,type QuadCandidate} from "../detect/quad";
import {analyseFrameLayers,type FrameAnalysis} from "../detect/frame";
import {edgeLengths,estimateRectAspect,offsetQuad} from "../geometry/quad";
import {rectifyQuad} from "../geometry/warp";
import {rasterizePolygons} from "../vision/mask";
import {compareImages,erodeMask,evaluateFidelity,type FidelityTolerances} from "../qa/metrics";
import type {CrossCheck,MockupResult,SceneIntegrity} from "./types";
import type {OcclusionMask} from "../composite/occlusion";

export const clampInt=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,Math.round(v)));

export type ExtractedUpright={
  image:RawImage;
  /** The quad actually sampled (after the edge inset). */
  usedQuad:Quad;
  aspect:number;
  aspectMethod:string;
  aspectReliable:boolean;
  defects:Defect[];
};

/**
 * Extract the object inside `quad` as an upright image with a single resample from the original
 * pixels. `knownAspect` (the real print/frame proportions) wins over the geometric estimate; a
 * disagreement is reported instead of silently stretching the customer's artwork.
 */
export function extractUpright(source:RawImage,quad:Quad,o:{focalPx?:number;knownAspect?:number;maxWidth:number;insetPx?:number}):ExtractedUpright{
  const defects:Defect[]=[];
  const q=o.insetPx?offsetQuad(quad,-o.insetPx):quad;
  const est=estimateRectAspect(quad,source.width,source.height,{focalPx:o.focalPx});
  let aspect=est.aspect ?? 1;
  let reliable=est.reliable;
  let method:string=est.method;
  if(o.knownAspect && o.knownAspect>0){
    if(est.aspect!==null && est.reliable){
      const dis=Math.abs(est.aspect-o.knownAspect)/o.knownAspect;
      if(dis>0.05) defects.push(defect("PROPORTION_UNVERIFIED","warn","The photographed shape disagrees with the stated proportions by "+(dis*100).toFixed(1)+"%; the stated proportions were used. Check the corners.",{measured:est.aspect,stated:o.knownAspect}));
    }
    aspect=o.knownAspect;reliable=true;method="stated";
  }else if(!reliable){
    defects.push(defect("PROPORTION_UNVERIFIED","info","Proportions were estimated without a known focal length, so they may be off by a few percent on an angled photo. Supply the print size or camera focal length to verify.",{estimated:aspect,method}));
  }
  const e=edgeLengths(quad);
  const longest=Math.max(e[0],e[2],1);
  const width=clampInt(Math.min(longest,o.maxWidth),16,6000);
  const height=clampInt(width/aspect,16,6000);
  return {image:rectifyQuad(source,q,width,height),usedQuad:q,aspect,aspectMethod:method,aspectReliable:reliable,defects};
}

/** Rank detector candidates for "the thing that is framed" using frame-layer evidence. */
export function pickFramedCandidate(img:RawImage,opts:{focalPx?:number;maxCandidates?:number;ignore?:OcclusionMask|null}={}){
  const ig=opts.ignore?{width:opts.ignore.width,height:opts.ignore.height,alpha:opts.ignore.alpha}:undefined;
  const det=detectQuads(img,{maxCandidates:opts.maxCandidates ?? 6,foreground:{ignore:ig}});
  const evaluated=det.candidates.map((c)=>{
    const fa=analyseFrameLayers(img,c.quad,{focalPx:opts.focalPx,ignore:ig});
    const rank=c.confidence*(0.3+0.7*fa.framedScore)*(fa.insets?1:0.4);
    return {cand:c,frame:fa,rank};
  }).sort((a,b)=>b.rank-a.rank);
  return {det,evaluated};
}

/** Largest confident candidate = the outermost sheet/print (for bare artwork). */
export function pickOutermostCandidate(img:RawImage):{cand:QuadCandidate|null;defects:Defect[]}{
  const det=detectQuads(img,{maxCandidates:6});
  const confident=det.candidates.filter((c)=>c.confidence>=0.5);
  const pool=confident.length?confident:det.candidates;
  if(!pool.length) return {cand:null,defects:det.defects};
  const best=pool.reduce((a,b)=>b.stats.areaFraction*b.confidence>a.stats.areaFraction*a.confidence?b:a);
  return {cand:best,defects:[...det.defects,...best.defects]};
}

/** Needs-manual if any placement/detection defect is warn or blocker. */
export function needsManual(defects:Defect[]){
  const codes=new Set(["QUAD_NOT_FOUND","QUAD_LOW_CONFIDENCE","QUAD_TOUCHES_BORDER","QUAD_AMBIGUOUS","APERTURE_UNCERTAIN","WALL_NOT_FOUND","NO_FREE_WALL_SPACE","PLACEMENT_UNCERTAIN","PERSPECTIVE_ASSUMED_FRONTAL","CAMERA_NOT_LEVEL"]);
  return defects.some((d)=>codes.has(d.code) && d.severity!=="info");
}

export function statusOf(defects:Defect[],qaFailed:boolean):MockupResult["status"]{
  if(qaFailed || defects.some((d)=>d.severity==="blocker")) return "fail";
  if(defects.some((d)=>d.severity==="warn")) return "review";
  return "pass";
}

/**
 * Nothing outside `allowedPolys` (plus `allowedMask`) may differ from the reference scene. This
 * is what guarantees the clean mockup contains no text, logo or stray edits, and that the
 * reference frame/room are preserved.
 */
export function checkSceneIntegrity(reference:RawImage,final:RawImage,allowed:{polys:Quad[];extra?:Uint8Array;ring?:{outer:Quad;inner:Quad}}):SceneIntegrity{
  const {width:W,height:H}=reference;
  const cov=rasterizePolygons(allowed.polys.map((q)=>[...q]),W,H,2);
  let changed=0,allowedPx=0,frame=0;
  const ring=allowed.ring?rasterizePolygons([[...allowed.ring.outer]],W,H,2):null;
  const inner=allowed.ring?rasterizePolygons([[...allowed.ring.inner]],W,H,2):null;
  for(let i=0;i<W*H;i++){
    const ok=cov[i]>0 || (allowed.extra?allowed.extra[i]>0:false);
    if(ok) allowedPx++;
    const diff=reference.data[i*4]!==final.data[i*4]||reference.data[i*4+1]!==final.data[i*4+1]||reference.data[i*4+2]!==final.data[i*4+2];
    if(!diff) continue;
    if(!ok) changed++;
    if(ring && inner && ring[i]>0 && inner[i]===0 && !ok) frame++;
  }
  return {pass:changed===0,changedOutsideAllowed:changed,allowedPixels:allowedPx,changedFramePixels:frame};
}

/**
 * Independent fidelity cross-check. Takes the customer's ORIGINAL photo region and the FINAL
 * composite region, rectifies each separately to the same upright size and compares them. It does
 * not reuse the extracted artwork or the forward warp, so an error in extraction, placement or
 * compositing shows up. Occluded pixels are excluded.
 */
export function crossCheckFromSource(args:{
  source:RawImage;sourceQuad:Quad;composite:RawImage;targetQuad:Quad;
  maxWidth?:number;marginPx:number;tol:FidelityTolerances;occlusion?:OcclusionMask|null;
}):CrossCheck{
  const e=edgeLengths(args.targetQuad),se=edgeLengths(args.sourceQuad);
  const width=clampInt(Math.min(args.maxWidth ?? 800,Math.max(e[0],e[2]),Math.max(se[0],se[2])),32,1600);
  const tAsp=estimateRectAspect(args.targetQuad,args.composite.width,args.composite.height).aspect ?? ((e[0]+e[2])/(e[1]+e[3]));
  const height=clampInt(width/tAsp,32,2400);
  const A=rectifyQuad(args.source,args.sourceQuad,width,height);
  const B=rectifyQuad(args.composite,args.targetQuad,width,height);
  let mask:Uint8Array|undefined;
  if(args.occlusion){
    const m:RawImage={width:args.composite.width,height:args.composite.height,data:new Uint8ClampedArray(args.composite.width*args.composite.height*4)};
    for(let i=0;i<args.occlusion.alpha.length;i++){const v=args.occlusion.alpha[i];m.data[i*4]=v;m.data[i*4+1]=v;m.data[i*4+2]=v;m.data[i*4+3]=255;}
    const r=rectifyQuad(m,args.targetQuad,width,height);
    const free=new Uint8Array(width*height);
    for(let i=0;i<free.length;i++) free[i]=r.data[i*4]<8?1:0;
    mask=free;
  }
  try{
    const metrics=compareImages(A,B,{margin:args.marginPx,mask:mask?erodeMask(mask,width,height,2):undefined});
    const ev=evaluateFidelity(metrics,args.tol);
    return {pass:ev.pass,failures:ev.failures,metrics,size:{width,height}};
  }catch(err){
    return {pass:false,failures:[{code:"CROSS_CHECK_FAILED",detail:String((err as Error).message)}],metrics:null,size:{width,height}};
  }
}

export function growMask(q:Quad,d:number,W:number,H:number){
  return rasterizePolygons([[...offsetQuad(q,d)]],W,H,2);
}
export type {FrameAnalysis};

import {downscaleToMax} from "../vision/gray";
import {rectQuad} from "../geometry/quad";
import type {OcclusionProvider} from "../composite/occlusion";

/** Resample a mask to a new size (bilinear on alpha) when the reference was downscaled. */
export function resampleOcclusion(m:OcclusionMask,width:number,height:number):OcclusionMask{
  if(m.width===width && m.height===height) return m;
  const g:RawImage={width:m.width,height:m.height,data:new Uint8ClampedArray(m.width*m.height*4)};
  for(let i=0;i<m.alpha.length;i++){g.data[i*4]=m.alpha[i];g.data[i*4+1]=m.alpha[i];g.data[i*4+2]=m.alpha[i];g.data[i*4+3]=255;}
  const r=rectifyQuad(g,rectQuad(m.width,m.height),width,height);
  const a=new Uint8Array(width*height);
  for(let i=0;i<a.length;i++) a[i]=r.data[i*4];
  return {width,height,alpha:a};
}

export async function resolveOcclusion(
  occ:OcclusionMask|OcclusionProvider|undefined,
  reference:RawImage,quad:Quad,refScale:number
):Promise<{mask:OcclusionMask|null;kind:"none"|"manual"|"provider"}>{
  if(!occ) return {mask:null,kind:"none"};
  if("alpha" in occ) return {mask:resampleOcclusion(occ,reference.width,reference.height),kind:"manual"};
  const m=await occ.provide(reference,{quad});
  void refScale;
  return {mask:m?resampleOcclusion(m,reference.width,reference.height):null,kind:"provider"};
}

export function prepareReference(reference:RawImage,maxSide:number){
  const {image,scale}=downscaleToMax(reference,maxSide);
  const q=(quad:Quad):Quad=>quad.map((p)=>({x:p.x*scale,y:p.y*scale})) as Quad;
  return {image,scale,toScene:q};
}

export function qaDefects(forwardFailures:{code:string;detail:string}[],crossFailures:{code:string;detail:string}[]):Defect[]{
  const out:Defect[]=[];
  for(const f of forwardFailures) out.push(defect(f.code as Defect["code"],"blocker",f.detail,{check:"forward"}));
  if(crossFailures.length) out.push(defect("CROSS_CHECK_FAILED","blocker","Independent cross-check against the original photo failed: "+crossFailures.map((f)=>f.code+" ("+f.detail+")").join("; ")));
  return out;
}

/** Pixels (dilated) that scene-lighting estimators must not sample: occluders are not wall. */
export function occlusionExclude(mask:OcclusionMask|null,radius=4):Uint8Array|undefined{
  if(!mask) return undefined;
  const {width:w,height:h,alpha}=mask;
  const base=new Uint8Array(w*h);
  for(let i=0;i<base.length;i++) base[i]=alpha[i]>16?1:0;
  if(radius<=0) return base;
  // separable dilation
  const tmp=new Uint8Array(w*h),out=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){let v=0;for(let i=-radius;i<=radius&&!v;i++){const xx=x+i;if(xx>=0&&xx<w&&base[y*w+xx]) v=1;}tmp[y*w+x]=v;}
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){let v=0;for(let j=-radius;j<=radius&&!v;j++){const yy=y+j;if(yy>=0&&yy<h&&tmp[yy*w+x]) v=1;}out[y*w+x]=v;}
  return out;
}
