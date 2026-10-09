import type {Quad} from "../types";
import {defect,type Defect} from "../detect/defects";
import {offsetQuad,edgeLengths,estimateRectAspect} from "../geometry/quad";
import {compositeOver,warpToQuad} from "../geometry/warp";
import {applyGain,estimateIlluminationGain,estimateLightFromGradient} from "../composite/lighting";
import {castWallShadows} from "../composite/shadow";
import {applyOcclusion} from "../composite/occlusion";
import {drawOverlay} from "../debug/overlay";
import {analyseWall,proposeWallPlacement} from "../place/wall";
import {LIGHTING_FORWARD_TOLERANCES,LIGHTING_RECTIFIED_TOLERANCES} from "../qa/metrics";
import {verifyProtectedContent} from "../qa/protected-content";
import {
  checkSceneIntegrity,crossCheckFromSource,extractUpright,needsManual,occlusionExclude,pickFramedCandidate,
  prepareReference,qaDefects,resolveOcclusion,statusOf
} from "./common";
import type {MockupJobInput,MockupResult} from "./types";

/**
 * Workflow B: the source already shows the finished framed piece. Extract the whole piece
 * (moulding, mount, artwork) with one resample, find a free spot on the reference's wall with
 * correct perspective and physical scale, add contact/drop shadows and bounded lighting, and
 * composite it. The customer's frame and artwork are never regenerated or recoloured.
 */
export async function runFramedOnWall(input:MockupJobInput):Promise<MockupResult>{
  const opts=input.options ?? {};
  const manual=input.manual ?? {};
  const defects:Defect[]=[];
  const ref=prepareReference(input.reference,opts.maxReferenceSide ?? 2400);
  const reference=ref.image;
  const W=reference.width,H=reference.height;
  const refFocal=opts.referenceFocalPx?opts.referenceFocalPx*ref.scale:undefined;

  const result=(partial:Partial<MockupResult>):MockupResult=>({
    mode:"framed-on-wall",status:"fail",needsManual:true,image:null,sourceQuad:null,targetQuad:null,referenceFrameQuad:null,
    automation:{source:manual.sourceQuad?"manual":"auto",target:manual.targetQuad?"manual":"auto",occlusion:"none"},
    adjustments:{},defects,qa:{forward:null,crossCheck:null,sceneIntegrity:null},diagnostics:{overlay:null,extracted:null},...partial
  });

  // 1. the framed piece in the source photo
  let sourceQuad:Quad|null=manual.sourceQuad ?? null;
  if(!sourceQuad){
    const {evaluated,det}=pickFramedCandidate(input.source,{focalPx:opts.sourceFocalPx});
    defects.push(...det.defects);
    const best=evaluated[0];
    if(best){
      defects.push(...best.cand.defects);
      sourceQuad=best.cand.quad;
      if(best.frame.framedScore<0.3) defects.push(defect("SOURCE_KIND_UNCERTAIN","warn","The detected object shows little frame structure. If this photo is a bare print, use the artwork-in-frame workflow.",{framedScore:best.frame.framedScore}));
      if(best.cand.confidence<0.6) defects.push(defect("PLACEMENT_UNCERTAIN","warn","Detection of the framed piece's corners is modest; please confirm them.",{confidence:best.cand.confidence}));
    }
  }
  if(!sourceQuad){
    defects.push(defect("QUAD_NOT_FOUND","blocker","No framed piece was found in the source photo; supply its corners."));
    return result({});
  }

  // 2. extract the piece
  const placeLong=Math.max(64,Math.min(3000,Math.max(...edgeLengths(sourceQuad))));
  const extracted=extractUpright(input.source,sourceQuad,{
    focalPx:opts.sourceFocalPx,knownAspect:opts.pieceAspect,maxWidth:placeLong,insetPx:opts.edgeInsetPx ?? 0.8
  });
  defects.push(...extracted.defects);
  const piece=extracted.image;
  const aspect=piece.width/piece.height;

  // 3. where to hang it
  let target:Quad|null=null;
  let wallInfo:ReturnType<typeof analyseWall>|null=null;
  let freeFraction=1;
  let usedFocal=refFocal ?? 0;
  if(manual.targetQuad){
    target=ref.toScene(manual.targetQuad);
  }else{
    wallInfo=analyseWall(reference,{hint:manual.wallHint?{x:manual.wallHint.x*ref.scale,y:manual.wallHint.y*ref.scale}:undefined});
    const placement=proposeWallPlacement(wallInfo,{
      aspect,widthM:opts.physicalWidthM,ceilingHeightM:opts.ceilingHeightM,skirtingM:opts.skirtingM,
      centreHeightM:opts.centreHeightM,focalPx:refFocal
    });
    defects.push(...placement.defects);
    target=placement.quad;
    freeFraction=placement.freeFraction;
    usedFocal=placement.usedFocalPx;
    if(!target) return result({sourceQuad,diagnostics:{overlay:null,extracted:piece}});
    if(placement.perspectiveMethod==="frontal" && wallInfo.top && wallInfo.bottom) {
      // parallel ceiling/floor lines: a genuinely frontal view, not an assumption
    }
  }

  // 4. lighting + shadows
  const lighting=opts.lighting ?? {};
  const lightsOn=!lighting.disable;
  const occ=await resolveOcclusion(manual.occlusion,reference,target,ref.scale);
  const exclude=occlusionExclude(occ.mask);
  const light=estimateLightFromGradient(reference,target,exclude);
  const widthPx=Math.max(...edgeLengths(target));
  const depthPx=Math.max(2,0.028*piece.width); // ~2.8% of the piece width: frame standoff + hanging gap
  const dropStrength=lighting.dropShadowStrength ?? 0.3;
  const contactStrength=lighting.contactShadowStrength ?? 0.2;
  let scene=reference;
  let influence:Uint8Array|undefined;
  if(lightsOn){
    const sh=castWallShadows(reference,target,{width:piece.width,height:piece.height},{
      dir:light.shadowDir,depthPx,dropStrength,contactStrength,softness:0.7
    });
    scene=sh.image;influence=sh.influence;
  }
  let layer=warpToQuad(piece,target,W,H);
  const gain=lightsOn?estimateIlluminationGain(reference,target,{strength:lighting.gainStrength ?? 0.6,cap:lighting.gainCap ?? 0.04,exclude}):null;
  if(gain) layer=applyGain(layer,gain);
  const composite=compositeOver(scene,layer);
  const final=occ.mask?applyOcclusion(composite,reference,occ.mask):composite;

  // 5. measured QA
  const margin=3;
  const includeMask=occ.mask?(()=>{const m=new Uint8Array(W*H);for(let i=0;i<m.length;i++) m[i]=occ.mask!.alpha[i]<8?1:0;return m;})():undefined;
  const focalForCheck=refFocal;
  const forward=verifyProtectedContent(piece,final,target,{mode:"forward",tolerances:LIGHTING_FORWARD_TOLERANCES,margin,focalPx:focalForCheck,includeMask});
  const cross=crossCheckFromSource({
    source:input.source,sourceQuad:extracted.usedQuad,composite:final,targetQuad:target,marginPx:margin+1,
    tol:LIGHTING_RECTIFIED_TOLERANCES,occlusion:occ.mask
  });
  const integrity=checkSceneIntegrity(reference,final,{polys:[offsetQuad(target,1.5)],extra:influence});
  defects.push(...qaDefects(forward.failures,cross.failures));
  if(!integrity.pass) defects.push(defect("SCENE_ALTERED","blocker","Pixels outside the placed piece and its shadow changed ("+integrity.changedOutsideAllowed+").",{count:integrity.changedOutsideAllowed}));

  const est=estimateRectAspect(target,W,H,{focalPx:focalForCheck});
  const overlay=drawOverlay(reference,[
    {quad:target,colour:[255,60,60],thickness:2},
    ...(wallInfo?.top?[{line:[{x:0,y:wallInfo.top.c},{x:W,y:wallInfo.top.m*W+wallInfo.top.c}] as [{x:number;y:number},{x:number;y:number}],colour:[40,120,255] as [number,number,number],thickness:1.5}]:[]),
    ...(wallInfo?.bottom?[{line:[{x:0,y:wallInfo.bottom.c},{x:W,y:wallInfo.bottom.m*W+wallInfo.bottom.c}] as [{x:number;y:number},{x:number;y:number}],colour:[40,120,255] as [number,number,number],thickness:1.5}]:[])
  ]);
  const qaFailed=!forward.pass || !cross.pass || !integrity.pass;
  return result({
    status:statusOf(defects,qaFailed),needsManual:needsManual(defects),image:final,
    sourceQuad,targetQuad:target,
    automation:{source:manual.sourceQuad?"manual":"auto",target:manual.targetQuad?"manual":"auto",occlusion:occ.kind},
    adjustments:{
      lightSource:light.source,shadowDirX:light.shadowDir.x,shadowDirY:light.shadowDir.y,dropStrength,contactStrength,depthPx,
      gainMaxDeviation:gain?.maxDeviation ?? 0,freeFraction,usedFocalPx:usedFocal,
      placedAspect:est.aspect ?? 0,pieceAspect:aspect,aspectMethod:extracted.aspectMethod,placedWidthPx:widthPx,
      edgeInsetPx:opts.edgeInsetPx ?? 0.8
    },
    qa:{forward,crossCheck:cross,sceneIntegrity:integrity},
    diagnostics:{overlay,extracted:piece}
  });
}
