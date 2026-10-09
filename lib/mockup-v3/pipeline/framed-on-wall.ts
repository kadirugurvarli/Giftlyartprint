import type {Pt,Quad,RawImage} from "../types";
import {defect,type Defect} from "../detect/defects";
import {analyseFrameLayers} from "../detect/frame";
import {analyseGlare} from "../detect/glare";
import {edgeLengths,estimateRectAspect,offsetQuad,rectQuad} from "../geometry/quad";
import {applyHomography,homographyFromPoints} from "../geometry/homography";
import {compositeOver,solidImage,warpToQuad} from "../geometry/warp";
import {applyGain,estimateIlluminationGain,estimateLight,estimateLightFromGradient,type LightEstimate} from "../composite/lighting";
import {castWallShadows} from "../composite/shadow";
import {depthFaces,outerEdgeColour,renderDepthLayer} from "../composite/depth";
import {addGrain,estimateCameraTexture,glassSheen,softenLayer} from "../composite/photo";
import {applyOcclusion} from "../composite/occlusion";
import {drawOverlay} from "../debug/overlay";
import {analyseWall,proposeWallPlacement} from "../place/wall";
import {rasterizePolygons} from "../vision/mask";
import {getTolerances} from "../qa/tolerance-registry";
import {verifyProtectedContent} from "../qa/protected-content";
import {
  checkSceneIntegrity,crossCheckFromSource,extractUpright,needsManual,occlusionExclude,pickFramedCandidate,
  prepareReference,qaDefects,resampleOcclusion,resolveOcclusion,statusOf
} from "./common";
import type {MockupJobInput,MockupResult,RealismLevel} from "./types";

/**
 * Quad that exactly covers `old` (a frame in the reference) with a piece of aspect `an`, centred on
 * it, built in the old frame's own plane so perspective is inherited from the reference.
 */
export function coveringQuad(old:Quad,oldAspect:number,an:number,margin=1.012):{quad:Quad;scaleX:number;scaleY:number}|null{
  const H=homographyFromPoints([{x:0,y:0},{x:oldAspect,y:0},{x:oldAspect,y:1},{x:0,y:1}],old);
  if(!H) return null;
  const hn=Math.max(1,oldAspect/an)*margin,wn=hn*an;
  const x0=(oldAspect-wn)/2,y0=(1-hn)/2;
  const pts=[{x:x0,y:y0},{x:x0+wn,y:y0},{x:x0+wn,y:y0+hn},{x:x0,y:y0+hn}].map((p)=>applyHomography(H,p)!);
  return {quad:pts as Quad,scaleX:wn/oldAspect,scaleY:hn};
}

/**
 * Workflow B: the source already shows the finished framed piece. Extract the whole piece
 * (moulding, mount, artwork) with one resample and place it where the REFERENCE says it belongs:
 * in place of a framed picture already hanging there, otherwise on free wall. Wall shadows (and,
 * from level "environment", physically derived frame depth) are added AROUND the piece. The
 * piece's own pixels are never regenerated, and never recoloured below level "photographic".
 */
export async function runFramedOnWall(input:MockupJobInput):Promise<MockupResult>{
  const opts=input.options ?? {};
  const manual=input.manual ?? {};
  const realism=opts.realism ?? {};
  const level:RealismLevel=realism.level ?? "environment";
  const photographic=level==="photographic";
  const withDepth=level!=="strict";
  const defects:Defect[]=[];
  const ref=prepareReference(input.reference,opts.maxReferenceSide ?? 2400);
  const reference=ref.image;
  const W=reference.width,H=reference.height;
  const refFocal=opts.referenceFocalPx?opts.referenceFocalPx*ref.scale:undefined;

  const result=(partial:Partial<MockupResult>):MockupResult=>({
    mode:"framed-on-wall",status:"fail",needsManual:true,image:null,sourceQuad:null,targetQuad:null,referenceFrameQuad:null,
    automation:{source:manual.sourceQuad?"manual":"auto",target:manual.targetQuad?"manual":"auto",occlusion:"none"},
    adjustments:{realismLevel:level},defects,qa:{forward:null,crossCheck:null,sceneIntegrity:null},diagnostics:{overlay:null,extracted:null},...partial
  });

  // 1. the framed piece in the source photo
  let sourceQuad:Quad|null=manual.sourceQuad ?? null;
  let sourceFrame:ReturnType<typeof analyseFrameLayers>|null=null;
  if(!sourceQuad){
    const {evaluated,det}=pickFramedCandidate(input.source,{focalPx:opts.sourceFocalPx});
    defects.push(...det.defects);
    const best=evaluated[0];
    if(best){
      defects.push(...best.cand.defects);
      sourceQuad=best.cand.quad;
      sourceFrame=best.frame;
      if(best.frame.framedScore<0.3) defects.push(defect("SOURCE_KIND_UNCERTAIN","warn","The detected object shows little frame structure. If this photo is a bare print, use the artwork-in-frame workflow.",{framedScore:best.frame.framedScore}));
      if(best.cand.confidence<0.6) defects.push(defect("PLACEMENT_UNCERTAIN","warn","Detection of the framed piece's corners is modest; please confirm them.",{confidence:best.cand.confidence}));
    }
  }
  if(!sourceQuad){
    defects.push(defect("QUAD_NOT_FOUND","blocker","No framed piece was found in the source photo; supply its corners."));
    return result({});
  }
  if(!sourceFrame && photographic) sourceFrame=analyseFrameLayers(input.source,sourceQuad,{focalPx:opts.sourceFocalPx});

  // 2. extract the piece
  const placeLong=Math.max(64,Math.min(3000,Math.max(...edgeLengths(sourceQuad))));
  const extracted=extractUpright(input.source,sourceQuad,{
    focalPx:opts.sourceFocalPx,knownAspect:opts.pieceAspect,maxWidth:placeLong,insetPx:opts.edgeInsetPx ?? 0.8
  });
  defects.push(...extracted.defects);
  const piece=extracted.image;
  const aspect=piece.width/piece.height;

  // glass glare baked into the source photo would be carried along: detect and report
  {
    const Hinv=homographyFromPoints(extracted.usedQuad,rectQuad(piece.width,piece.height));
    let inspect:{x:number;y:number;width:number;height:number}|undefined;
    if(sourceFrame?.apertureQuad && Hinv){
      const pts=sourceFrame.apertureQuad.map((p)=>applyHomography(Hinv,p)!);
      const x0=Math.max(0,Math.floor(Math.min(...pts.map((p)=>p.x)))),y0=Math.max(0,Math.floor(Math.min(...pts.map((p)=>p.y))));
      const x1=Math.min(piece.width,Math.ceil(Math.max(...pts.map((p)=>p.x)))),y1=Math.min(piece.height,Math.ceil(Math.max(...pts.map((p)=>p.y))));
      if(x1-x0>20&&y1-y0>20) inspect={x:x0,y:y0,width:x1-x0,height:y1-y0};
    }
    defects.push(...analyseGlare(piece,inspect).defects);
  }

  // 3. the reference decides the placement
  const earlyMask=manual.occlusion && "alpha" in manual.occlusion?resampleOcclusion(manual.occlusion,W,H):null;
  const placementMode=opts.placement ?? "auto";
  let target:Quad|null=null;
  let replacedQuad:Quad|null=null;
  let wallInfo:ReturnType<typeof analyseWall>|null=null;
  let freeFraction=1;
  let usedFocal=refFocal ?? 0;
  let placementKind:"manual"|"replace-existing"|"free-wall"="free-wall";
  let physicalWidthM=opts.physicalWidthM;
  if(manual.targetQuad){
    target=ref.toScene(manual.targetQuad);placementKind="manual";
  }else{
    if(placementMode!=="free-wall"){
      const {evaluated}=pickFramedCandidate(reference,{focalPx:refFocal,ignore:earlyMask});
      const b=evaluated[0];
      if(b && b.frame.framedScore>=0.5){
        if(b.cand.confidence>=0.6){
          const oldAspect=b.frame.rect.width/b.frame.rect.height;
          const cov=coveringQuad(b.cand.quad,oldAspect,aspect);
          if(cov){
            target=cov.quad;replacedQuad=b.cand.quad;placementKind="replace-existing";
            defects.push(...b.cand.defects);
            const scale=Math.max(cov.scaleX,cov.scaleY);
            if(scale>1.25) defects.push(defect("REPLACEMENT_SIZE_MISMATCH","warn","The new piece is "+((scale-1)*100).toFixed(0)+"% larger than the picture it replaces, so it will look bigger than in the reference.",{scale}));
            if(!refFocal) defects.push(defect("FOCAL_ASSUMED","info","No reference focal length supplied; a typical phone lens was assumed for perspective and depth.",{assumedFocalPx:0.72*Math.max(W,H)}));
          }
        }else{
          defects.push(defect("PLACEMENT_UNCERTAIN","warn","The reference seems to contain a framed picture, but it could not be located reliably; the piece was placed on free wall instead. Supply the corners to replace it.",{confidence:b.cand.confidence}));
        }
      }
    }
    if(placementMode==="replace-existing" && placementKind!=="replace-existing"){
      defects.push(defect("QUAD_NOT_FOUND","blocker","Replacement was requested but no framed picture was found in the reference."));
      return result({sourceQuad});
    }
    if(!target){
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
    }
  }
  if(!usedFocal) usedFocal=0.72*Math.max(W,H);
  if(physicalWidthM===undefined) physicalWidthM=0.6;
  const widthM=physicalWidthM,heightM=widthM/aspect;

  // 4. light: measured from the reference's own shadows when it has a frame, otherwise from the wall's gradient
  const occ=await resolveOcclusion(manual.occlusion,reference,target,ref.scale);
  const exclude=occlusionExclude(occ.mask);
  const light:LightEstimate=replacedQuad?estimateLight(reference,replacedQuad,exclude):estimateLightFromGradient(reference,target,exclude);

  // 5. realism around the product: wall shadows always; physically derived frame depth from "environment"
  const depthM=realism.frameDepthM ?? 0.025;
  const dropStrength=realism.dropShadowStrength ?? 0.3;
  const contactStrength=realism.contactShadowStrength ?? 0.2;
  const sh=castWallShadows(reference,target,{width:piece.width,height:piece.height},{
    dir:light.shadowDir,depthPx:Math.max(2,depthM/widthM*piece.width),dropStrength,contactStrength,softness:0.7
  });
  let scene=sh.image;
  const influence=new Uint8Array(sh.influence);
  let faceCount=0;
  if(withDepth){
    const faces=depthFaces(target,widthM,heightM,depthM,usedFocal,W/2,H/2,light.shadowDir);
    faceCount=faces.length;
    if(faces.length){
      const dl=renderDepthLayer(faces,outerEdgeColour(piece),W,H);
      scene=compositeOver(scene,dl);
      for(let i=0;i<influence.length;i++) if(dl.data[i*4+3]>0) influence[i]=1;
      defects.push(defect("DEPTH_FACES_SYNTHESISED","info","The frame's side face is synthesised from the frame's own edge colour (the photo never saw this side).",{faces:faces.length,depthM}));
    }
  }

  // 6. the product layer. Pixels are only touched at level "photographic".
  let layer=warpToQuad(piece,target,W,H);
  let gain:ReturnType<typeof estimateIlluminationGain>|null=null;
  let texture:ReturnType<typeof estimateCameraTexture>|null=null;
  if(photographic){
    gain=estimateIlluminationGain(reference,target,{strength:realism.gainStrength ?? 0.6,cap:realism.gainCap ?? 0.03,exclude});
    layer=applyGain(layer,gain);
    let edge:[Pt,Pt]|null=null;
    if(replacedQuad) edge=[replacedQuad[0],replacedQuad[1]];
    else if(wallInfo?.top) edge=[{x:W*0.2,y:wallInfo.top.m*W*0.2+wallInfo.top.c},{x:W*0.8,y:wallInfo.top.m*W*0.8+wallInfo.top.c}];
    texture=estimateCameraTexture(reference,{exclude,edge});
    const softness=realism.softnessSigma==="auto"||realism.softnessSigma===undefined?texture.blurSigma:realism.softnessSigma;
    const grain=realism.grainSigma==="auto"||realism.grainSigma===undefined?texture.grainSigma:realism.grainSigma;
    layer=softenLayer(layer,Math.min(1.2,Math.sqrt(Math.max(0,softness*softness-0.5*0.5))));
    if(sourceFrame?.apertureQuad){
      const Hx=homographyFromPoints(extracted.usedQuad,target)!;
      const glazed=sourceFrame.apertureQuad.map((p)=>applyHomography(Hx,p)!) as Quad;
      layer=glassSheen(layer,glazed,{x:-light.shadowDir.x,y:-light.shadowDir.y},realism.glassSheen ?? 0.03);
    }
    layer=addGrain(layer,grain,realism.textureSeed ?? 1337);
    if(texture.grainSource==="default"||texture.blurSource==="default") defects.push(defect("TEXTURE_DEFAULTS_USED","info","Part of the reference's grain/softness could not be measured and a default was used.",{grain:texture.grainSource,blur:texture.blurSource}));
  }
  const composite=compositeOver(scene,layer);
  const final=occ.mask?applyOcclusion(composite,reference,occ.mask):composite;

  // 7. measured QA
  const fwdTol=getTolerances(photographic?"lightingForward":"forward");
  const crossTol=getTolerances(photographic?"lightingRectified":"rectified");
  const margin=3+(photographic?2:0);
  const includeMask=occ.mask?(()=>{const m=new Uint8Array(W*H);for(let i=0;i<m.length;i++) m[i]=occ.mask!.alpha[i]<8?1:0;return m;})():undefined;
  const forward=verifyProtectedContent(piece,final,target,{mode:"forward",tolerances:fwdTol,margin,focalPx:refFocal,includeMask});
  const cross=crossCheckFromSource({
    source:input.source,sourceQuad:extracted.usedQuad,composite:final,targetQuad:target,marginPx:margin+1,tol:crossTol,occlusion:occ.mask
  });
  const integrity=checkSceneIntegrity(reference,final,{polys:[offsetQuad(target,1.5)],extra:influence});
  defects.push(...qaDefects(forward.failures,cross.failures));
  if(!integrity.pass) defects.push(defect("SCENE_ALTERED","blocker","Pixels outside the placed piece and its shadow changed ("+integrity.changedOutsideAllowed+").",{count:integrity.changedOutsideAllowed}));
  let replacedCovered=1;
  if(replacedQuad){
    const a=rasterizePolygons([[...replacedQuad]],W,H,2),b=rasterizePolygons([[...target]],W,H,2);
    let tot=0,cov=0;
    for(let i=0;i<a.length;i++) if(a[i]>127){tot++;if(b[i]>=250) cov++;}
    replacedCovered=tot?cov/tot:1;
    if(replacedCovered<0.995) defects.push(defect("REPLACED_FRAME_NOT_COVERED","blocker","The old frame is not fully covered by the new piece ("+((1-replacedCovered)*100).toFixed(1)+"% still visible).",{covered:replacedCovered}));
  }

  const est=estimateRectAspect(target,W,H,{focalPx:refFocal});
  const overlay=drawOverlay(reference,[
    {quad:target,colour:[255,60,60],thickness:2},
    ...(replacedQuad?[{quad:replacedQuad,colour:[255,200,0] as [number,number,number],thickness:1.5}]:[]),
    ...(wallInfo?.top?[{line:[{x:0,y:wallInfo.top.c},{x:W,y:wallInfo.top.m*W+wallInfo.top.c}] as [Pt,Pt],colour:[40,120,255] as [number,number,number],thickness:1.5}]:[]),
    ...(wallInfo?.bottom?[{line:[{x:0,y:wallInfo.bottom.c},{x:W,y:wallInfo.bottom.m*W+wallInfo.bottom.c}] as [Pt,Pt],colour:[40,120,255] as [number,number,number],thickness:1.5}]:[])
  ]);
  const qaFailed=!forward.pass || !cross.pass || !integrity.pass || replacedCovered<0.995;
  return result({
    status:statusOf(defects,qaFailed),needsManual:needsManual(defects),image:final,
    sourceQuad,targetQuad:target,referenceFrameQuad:replacedQuad,
    automation:{source:manual.sourceQuad?"manual":"auto",target:manual.targetQuad?"manual":"auto",occlusion:occ.kind},
    adjustments:{
      realismLevel:level,placement:placementKind,
      lightSource:light.source,shadowDirX:light.shadowDir.x,shadowDirY:light.shadowDir.y,dropStrength,contactStrength,
      frameDepthM:depthM,depthFaces:faceCount,gainMaxDeviation:gain?.maxDeviation ?? 0,
      grainSigma:texture?.grainSigma ?? 0,softnessSigma:texture?.blurSigma ?? 0,
      freeFraction,usedFocalPx:usedFocal,placedAspect:est.aspect ?? 0,pieceAspect:aspect,aspectMethod:extracted.aspectMethod,
      edgeInsetPx:opts.edgeInsetPx ?? 0.8,replacedCovered
    },
    qa:{
      forward,crossCheck:cross,sceneIntegrity:integrity,crossRegions:{source:extracted.usedQuad,target},
      productPixels:{
        modified:photographic,level,
        note:photographic?"Photographic effects act on the product within measured colour budgets.":"Product pixels are only geometrically resampled; nothing was recoloured."
      }
    },
    diagnostics:{overlay,extracted:piece}
  });
}

void solidImage;
