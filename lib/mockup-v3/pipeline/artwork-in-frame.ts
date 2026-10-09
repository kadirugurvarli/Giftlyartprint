import type {Pt,Quad,RawImage} from "../types";
import {defect,type Defect} from "../detect/defects";
import {apertureFromLayers} from "../detect/frame";
import {edgeLengths,estimateRectAspect,offsetQuad,rectQuad} from "../geometry/quad";
import {homographyFromPoints,applyHomography} from "../geometry/homography";
import {compositeOver,rectifyQuad,warpToQuad} from "../geometry/warp";
import {applyGain,estimateIlluminationGain,estimateLight} from "../composite/lighting";
import {dirToPlane,innerShadowLayer} from "../composite/shadow";
import {applyOcclusion} from "../composite/occlusion";
import {drawOverlay} from "../debug/overlay";
import {rasterizePolygons} from "../vision/mask";
import {LIGHTING_FORWARD_TOLERANCES,LIGHTING_RECTIFIED_TOLERANCES} from "../qa/metrics";
import {verifyProtectedContent} from "../qa/protected-content";
import {
  checkSceneIntegrity,clampInt,crossCheckFromSource,extractUpright,needsManual,pickFramedCandidate,
  occlusionExclude,pickOutermostCandidate,prepareReference,qaDefects,resampleOcclusion,resolveOcclusion,statusOf
} from "./common";
import type {MockupJobInput,MockupResult} from "./types";

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

function medianColour(img:RawImage,outer:Quad,inner:Quad):[number,number,number]{
  const a=rasterizePolygons([[...outer]],img.width,img.height,1);
  const b=rasterizePolygons([[...inner]],img.width,img.height,1);
  const rs:number[]=[],gs:number[]=[],bs:number[]=[];
  for(let i=0;i<a.length;i++) if(a[i]>200 && b[i]<20){rs.push(img.data[i*4]);gs.push(img.data[i*4+1]);bs.push(img.data[i*4+2]);}
  const med=(v:number[])=>v.length?v.sort((x,y)=>x-y)[v.length>>1]:235;
  return [med(rs),med(gs),med(bs)];
}

/**
 * Workflow A: the source is the customer's bare print. Extract it, find the frame in the
 * reference, and fill the frame's opening with the real print, keeping the reference's frame,
 * room, lighting and perspective untouched.
 */
export async function runArtworkInFrame(input:MockupJobInput):Promise<MockupResult>{
  const opts=input.options ?? {};
  const manual=input.manual ?? {};
  const defects:Defect[]=[];
  const ref=prepareReference(input.reference,opts.maxReferenceSide ?? 2400);
  const reference=ref.image;
  const W=reference.width,H=reference.height;
  const refFocal=opts.referenceFocalPx?opts.referenceFocalPx*ref.scale:undefined;

  const result=(partial:Partial<MockupResult>):MockupResult=>({
    mode:"artwork-in-frame",status:"fail",needsManual:true,image:null,sourceQuad:null,targetQuad:null,referenceFrameQuad:null,
    automation:{source:manual.sourceQuad?"manual":"auto",target:manual.targetQuad?"manual":"auto",occlusion:"none"},
    adjustments:{},defects,qa:{forward:null,crossCheck:null,sceneIntegrity:null},diagnostics:{overlay:null,extracted:null},...partial
  });

  // 1. the print in the source photo
  let sourceQuad:Quad|null=manual.sourceQuad ?? null;
  if(!sourceQuad){
    const pick=pickOutermostCandidate(input.source);
    defects.push(...pick.defects);
    sourceQuad=pick.cand?.quad ?? null;
  }
  if(!sourceQuad) return result({needsManual:true});

  // masked (occluded) pixels are unknown to detection: a plant over the frame is not frame
  const earlyMask=manual.occlusion && "alpha" in manual.occlusion?resampleOcclusion(manual.occlusion,W,H):null;

  // 2. the frame and its opening in the reference
  let outerQuad:Quad|null=null;
  let aperture:Quad|null=null;
  let apertureAspect:number|null=null;
  let apertureAspectReliable=true;
  let frameAnalysis=null as ReturnType<typeof pickFramedCandidate>["evaluated"][number]["frame"]|null;
  if(manual.targetQuad){
    aperture=ref.toScene(manual.targetQuad);
  }else{
    const {evaluated,det}=pickFramedCandidate(reference,{focalPx:refFocal,ignore:earlyMask});
    defects.push(...det.defects);
    const best=evaluated[0];
    if(!best){
      defects.push(defect("QUAD_NOT_FOUND","blocker","No framed picture was found in the reference; supply the opening's corners."));
      return result({sourceQuad});
    }
    defects.push(...best.cand.defects);
    outerQuad=best.cand.quad;
    frameAnalysis=best.frame;
    defects.push(...best.frame.defects);
    aperture=manual.apertureLayers?apertureFromLayers(best.frame,manual.apertureLayers):best.frame.apertureQuad;
    if(!aperture){
      return result({sourceQuad,referenceFrameQuad:outerQuad,
        diagnostics:{overlay:drawOverlay(reference,[{quad:outerQuad,colour:[255,0,0],thickness:3}]),extracted:null}});
    }
    if(best.frame.framedScore<0.35) defects.push(defect("APERTURE_UNCERTAIN","warn","The detected object shows little frame structure; confirm the opening.",{framedScore:best.frame.framedScore}));
    if(best.cand.confidence<0.6 || best.frame.confidence<0.5) defects.push(defect("PLACEMENT_UNCERTAIN","warn","Frame/opening detection confidence is modest; please confirm the opening.",{quadConfidence:best.cand.confidence,apertureConfidence:best.frame.confidence}));
    const est=estimateRectAspect(best.cand.quad,W,H,{focalPx:refFocal});
    apertureAspectReliable=est.reliable;
    const {insets,rect}=best.frame;
    const lay=manual.apertureLayers?null:insets;
    if(lay) apertureAspect=(rect.width-lay.left-lay.right)/(rect.height-lay.top-lay.bottom);
  }
  if(apertureAspect===null){
    const est=estimateRectAspect(aperture,W,H,{focalPx:refFocal});
    apertureAspect=est.aspect ?? (()=>{const e=edgeLengths(aperture!);return (e[0]+e[2])/(e[1]+e[3]);})();
    apertureAspectReliable=est.reliable;
  }
  if(!apertureAspectReliable) defects.push(defect("PROPORTION_UNVERIFIED","info","The opening's true proportions are estimated without a known camera focal length; the print may be cropped a few percent differently than intended.",{apertureAspect}));

  // 3. extract the print (single resample from the customer's pixels)
  const apLongest=Math.max(...edgeLengths(aperture));
  const extracted=extractUpright(input.source,sourceQuad,{
    focalPx:opts.sourceFocalPx,knownAspect:opts.artworkAspect,
    maxWidth:Math.min(3000,Math.max(64,2*apLongest)),insetPx:0.5
  });
  defects.push(...extracted.defects);
  const art=extracted.image;

  // 4. fit to the opening (explicit policy, measured and reported)
  const aS=art.width/art.height;
  const aT=apertureAspect;
  const fit=opts.fit ?? "cover";
  const anchor=opts.cropAnchor ?? {x:0.5,y:0.5};
  let fitted:RawImage=art;
  let cropRect={x:0,y:0,width:art.width,height:art.height};
  let cropFraction=0,stretchPct=0,filledFraction=0;
  const mismatch=aS/aT-1;
  if(Math.abs(mismatch)<=0.012){
    stretchPct=Math.abs(mismatch)*100;
  }else if(fit==="cover"){
    if(aS>aT){
      const nw=Math.round(art.height*aT);
      cropRect={x:Math.round((art.width-nw)*clamp(anchor.x,0,1)),y:0,width:nw,height:art.height};
      cropFraction=1-nw/art.width;
    }else{
      const nh=Math.round(art.width/aT);
      cropRect={x:0,y:Math.round((art.height-nh)*clamp(anchor.y,0,1)),width:art.width,height:nh};
      cropFraction=1-nh/art.height;
    }
    const sub=new Uint8ClampedArray(cropRect.width*cropRect.height*4);
    for(let y=0;y<cropRect.height;y++){
      const s=((cropRect.y+y)*art.width+cropRect.x)*4;
      sub.set(art.data.subarray(s,s+cropRect.width*4),y*cropRect.width*4);
    }
    fitted={width:cropRect.width,height:cropRect.height,data:sub};
    const maxCrop=opts.maxCropFraction ?? 0.06;
    if(cropFraction>maxCrop) defects.push(defect("ASPECT_MISMATCH_EXCESSIVE","warn","The print's proportions differ a lot from the opening; "+(cropFraction*100).toFixed(1)+"% of it would be cropped. Consider 'contain' or a different frame.",{cropFraction,maxCrop}));
    else defects.push(defect("ASPECT_MISMATCH_CROPPED",cropFraction>0.03?"warn":"info","The print was cropped by "+(cropFraction*100).toFixed(1)+"% to fit the opening.",{cropFraction}));
  }else{
    // contain: whole print visible, remainder filled with the reference's mount colour
    const mount=outerQuad?medianColour(reference,offsetQuad(aperture,Math.max(3,0.02*apLongest)),offsetQuad(aperture,1)):[238,234,224] as [number,number,number];
    let cw=art.width,ch=art.height;
    if(aS>aT){ch=Math.round(art.width/aT);}else{cw=Math.round(art.height*aT);}
    const data=new Uint8ClampedArray(cw*ch*4);
    for(let i=0;i<cw*ch;i++){data[i*4]=mount[0];data[i*4+1]=mount[1];data[i*4+2]=mount[2];data[i*4+3]=255;}
    const ox=Math.round((cw-art.width)/2),oy=Math.round((ch-art.height)/2);
    for(let y=0;y<art.height;y++) for(let x=0;x<art.width;x++){
      const s=(y*art.width+x)*4,d=((y+oy)*cw+x+ox)*4;
      data[d]=art.data[s];data[d+1]=art.data[s+1];data[d+2]=art.data[s+2];
    }
    fitted={width:cw,height:ch,data};
    cropRect={x:0,y:0,width:art.width,height:art.height};
    filledFraction=1-(art.width*art.height)/(cw*ch);
    defects.push(defect("ASPECT_MISMATCH_FILLED","warn","The print does not match the opening; "+(filledFraction*100).toFixed(1)+"% of the opening is filled with the mount colour.",{filledFraction}));
  }

  // 5. lighting integration (bounded, colour-neutral); occluders never feed the estimates
  const overlapPx=opts.edgeOverlapPx ?? 0.6;
  const lighting=opts.lighting ?? {};
  const lightsOn=!lighting.disable;
  const refForLight=outerQuad ?? offsetQuad(aperture,Math.max(8,0.06*apLongest));
  const occ=await resolveOcclusion(manual.occlusion,reference,offsetQuad(aperture,overlapPx),ref.scale);
  const exclude=occlusionExclude(occ.mask);
  const light=estimateLight(reference,refForLight,exclude);
  const bandArt=clamp(0.012*Math.min(fitted.width,fitted.height),3,60);
  const Ha=homographyFromPoints(rectQuad(fitted.width,fitted.height),aperture)!;
  const dirPlane=dirToPlane(Ha,{x:fitted.width/2,y:fitted.height/2},light.shadowDir);
  const innerStrength=lighting.innerShadowStrength ?? clamp(light.strength*0.8,0.12,0.3);
  const shaded=lightsOn?innerShadowLayer(fitted,dirPlane,bandArt,innerStrength):fitted;
  const bandImg=bandArt*(apLongest/fitted.width);

  // 6. composite
  const overlap=opts.edgeOverlapPx ?? 0.6;
  const grown=offsetQuad(aperture,overlap);
  let layer=warpToQuad(shaded,grown,W,H);
  const gain=lightsOn?estimateIlluminationGain(reference,refForLight,{strength:lighting.gainStrength ?? 0.6,cap:lighting.gainCap ?? 0.04,exclude}):null;
  if(gain) layer=applyGain(layer,gain);
  const composite=compositeOver(reference,layer);
  const final=occ.mask?applyOcclusion(composite,reference,occ.mask):composite;

  // 7. measured QA
  const margin=Math.ceil(bandImg)+3;
  const includeMask=occ.mask?(()=>{const m=new Uint8Array(W*H);for(let i=0;i<m.length;i++) m[i]=occ.mask!.alpha[i]<8?1:0;return m;})():undefined;
  const forward=verifyProtectedContent(fitted,final,grown,{
    mode:"forward",tolerances:LIGHTING_FORWARD_TOLERANCES,margin,focalPx:refFocal,includeMask
  });
  // the same print as it appears in the ORIGINAL photo (crop mapped back through the source quad)
  const Hs=homographyFromPoints(rectQuad(art.width,art.height),extracted.usedQuad)!;
  const cropCorners=[
    {x:cropRect.x,y:cropRect.y},{x:cropRect.x+cropRect.width,y:cropRect.y},
    {x:cropRect.x+cropRect.width,y:cropRect.y+cropRect.height},{x:cropRect.x,y:cropRect.y+cropRect.height}
  ].map((p)=>applyHomography(Hs,p)!) as Quad;
  const cross=fit==="contain" && filledFraction>0
    ?null
    :crossCheckFromSource({source:input.source,sourceQuad:cropCorners,composite:final,targetQuad:grown,marginPx:margin,tol:LIGHTING_RECTIFIED_TOLERANCES,occlusion:occ.mask});
  const integrity=checkSceneIntegrity(reference,final,{
    polys:[offsetQuad(grown,1.5)],
    ring:outerQuad?{outer:offsetQuad(outerQuad,1),inner:offsetQuad(aperture,1.5)}:undefined
  });
  defects.push(...qaDefects(forward.failures,cross?.failures ?? []));
  if(!integrity.pass){
    defects.push(defect("SCENE_ALTERED","blocker","Pixels outside the opening changed ("+integrity.changedOutsideAllowed+").",{count:integrity.changedOutsideAllowed}));
    if(integrity.changedFramePixels) defects.push(defect("FRAME_ALTERED","blocker","The reference frame was altered.",{count:integrity.changedFramePixels}));
  }

  const overlay=drawOverlay(reference,[
    ...(outerQuad?[{quad:outerQuad,colour:[255,60,60] as [number,number,number],thickness:2}]:[]),
    {quad:aperture,colour:[40,200,90],thickness:2}
  ]);
  const qaFailed=!forward.pass || (cross?!cross.pass:false) || !integrity.pass;
  return result({
    status:statusOf(defects,qaFailed),needsManual:needsManual(defects),image:final,
    sourceQuad,targetQuad:aperture,referenceFrameQuad:outerQuad,
    automation:{source:manual.sourceQuad?"manual":"auto",target:manual.targetQuad?"manual":"auto",occlusion:occ.kind},
    adjustments:{
      fit,cropFraction,stretchPct,filledFraction,edgeOverlapPx:overlap,sourceEdgeInsetPx:0.5,
      lightSource:light.source,shadowStrength:light.strength,innerShadow:lightsOn?innerStrength:0,
      gainMaxDeviation:gain?.maxDeviation ?? 0,apertureAspect,artworkAspect:aS,
      aspectMethod:extracted.aspectMethod
    },
    qa:{forward,crossCheck:cross,sceneIntegrity:integrity},
    diagnostics:{overlay,extracted:fitted}
  });
}

void clampInt;void rectifyQuad;void (undefined as unknown as Pt);
