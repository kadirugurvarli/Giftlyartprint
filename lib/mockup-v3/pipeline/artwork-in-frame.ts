import type {Quad,RawImage} from "../types";
import {defect,type Defect} from "../detect/defects";
import {apertureFromLayers} from "../detect/frame";
import {edgeLengths,estimateRectAspect,offsetQuad,rectQuad} from "../geometry/quad";
import {applyHomography,homographyFromPoints} from "../geometry/homography";
import {compositeOver,warpToQuad} from "../geometry/warp";
import {applyGain,estimateIlluminationGain,estimateLight} from "../composite/lighting";
import {dirToPlane,innerShadowLayer} from "../composite/shadow";
import {addGrain,estimateCameraTexture,glassSheen,softenLayer} from "../composite/photo";
import {applyOcclusion} from "../composite/occlusion";
import {drawOverlay} from "../debug/overlay";
import {rasterizePolygons} from "../vision/mask";
import {
  FORWARD_TOLERANCES,LIGHTING_FORWARD_TOLERANCES,LIGHTING_RECTIFIED_TOLERANCES,RECTIFIED_TOLERANCES
} from "../qa/metrics";
import {verifyProtectedContent} from "../qa/protected-content";
import {
  checkSceneIntegrity,crossCheckFromSource,extractUpright,needsManual,occlusionExclude,pickFramedCandidate,
  pickOutermostCandidate,prepareReference,qaDefects,resampleOcclusion,resolveOcclusion,statusOf
} from "./common";
import type {MockupJobInput,MockupResult,RealismLevel} from "./types";

const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

function medianColour(img:RawImage,outer:Quad,inner:Quad,exclude?:Uint8Array):[number,number,number]{
  const a=rasterizePolygons([[...outer]],img.width,img.height,1);
  const b=rasterizePolygons([[...inner]],img.width,img.height,1);
  const rs:number[]=[],gs:number[]=[],bs:number[]=[];
  for(let i=0;i<a.length;i++) if(a[i]>200 && b[i]<20 && !(exclude&&exclude[i])){rs.push(img.data[i*4]);gs.push(img.data[i*4+1]);bs.push(img.data[i*4+2]);}
  const med=(v:number[])=>v.length?v.sort((x,y)=>x-y)[v.length>>1]:235;
  return [med(rs),med(gs),med(bs)];
}

/**
 * Workflow A: the source is the customer's bare print. Extract it, find the frame in the
 * reference, and place the WHOLE print in the frame's opening, keeping the reference's frame,
 * room, lighting and perspective untouched. The print is never cropped unless a crop was
 * explicitly approved, and its pixels are never recoloured at the default realism levels.
 */
export async function runArtworkInFrame(input:MockupJobInput):Promise<MockupResult>{
  const opts=input.options ?? {};
  const manual=input.manual ?? {};
  const realism=opts.realism ?? {};
  const level:RealismLevel=realism.level ?? "environment";
  const photographic=level==="photographic";
  const defects:Defect[]=[];
  const ref=prepareReference(input.reference,opts.maxReferenceSide ?? 2400);
  const reference=ref.image;
  const W=reference.width,H=reference.height;
  const refFocal=opts.referenceFocalPx?opts.referenceFocalPx*ref.scale:undefined;

  const result=(partial:Partial<MockupResult>):MockupResult=>({
    mode:"artwork-in-frame",status:"fail",needsManual:true,image:null,sourceQuad:null,targetQuad:null,referenceFrameQuad:null,
    automation:{source:manual.sourceQuad?"manual":"auto",target:manual.targetQuad?"manual":"auto",occlusion:"none"},
    adjustments:{realismLevel:level},defects,qa:{forward:null,crossCheck:null,sceneIntegrity:null},diagnostics:{overlay:null,extracted:null},...partial
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
    if(insets && !manual.apertureLayers) apertureAspect=(rect.width-insets.left-insets.right)/(rect.height-insets.top-insets.bottom);
  }
  if(apertureAspect===null){
    const est=estimateRectAspect(aperture,W,H,{focalPx:refFocal});
    apertureAspect=est.aspect ?? (()=>{const e=edgeLengths(aperture!);return (e[0]+e[2])/(e[1]+e[3]);})();
    apertureAspectReliable=est.reliable;
  }
  if(!apertureAspectReliable) defects.push(defect("PROPORTION_UNVERIFIED","info","The opening's true proportions are estimated without a known camera focal length; the border around the print may differ a few percent from the real mount.",{apertureAspect}));

  // 3. extract the print (single resample from the customer's pixels)
  const apLongest=Math.max(...edgeLengths(aperture));
  const insetPx=opts.edgeInsetPx ?? 0.5;
  const extracted=extractUpright(input.source,sourceQuad,{
    focalPx:opts.sourceFocalPx,knownAspect:opts.artworkAspect,
    maxWidth:Math.min(3000,Math.max(64,2*apLongest)),insetPx
  });
  defects.push(...extracted.defects);
  const art=extracted.image;

  // occluders never feed any scene estimate
  const overlapPx=opts.edgeOverlapPx ?? 1.0;
  const grown=offsetQuad(aperture,overlapPx);
  const occ=await resolveOcclusion(manual.occlusion,reference,grown,ref.scale);
  const exclude=occlusionExclude(occ.mask);

  // 4. fit the WHOLE print into the opening (never crop without approval)
  const aS=art.width/art.height;
  const aT=apertureAspect;
  const mismatch=aS/aT-1;
  const wantCover=(opts.fit ?? "contain")==="cover";
  const margin=clamp(opts.matMarginFraction ?? 0,0,0.3);
  // what a crop would have cost, always reported so a person can decide
  const proposedCrop=Math.abs(mismatch)<=0.004?0:(aS>aT?1-aT/aS:1-aS/aT);
  let cropRect={x:0,y:0,width:art.width,height:art.height};
  let canvas:RawImage=art;
  let artInCanvas={x:0,y:0,width:art.width,height:art.height};
  let cropFraction=0,filledFraction=0,stretchPct=0;
  let mountColour:[number,number,number]|null=null;
  const approved=opts.approvedCrop;
  let doCover=false;
  if(wantCover && margin===0 && proposedCrop>0){
    if(!approved) defects.push(defect("CROP_NOT_APPROVED","warn","Cropping the print would be needed to fill the opening ("+(proposedCrop*100).toFixed(1)+"%). No crop was approved, so the whole print is shown with a mount border instead.",{proposedCrop}));
    else if(proposedCrop>approved.maxFraction) defects.push(defect("CROP_EXCEEDS_APPROVAL","warn","The approved crop limit ("+(approved.maxFraction*100).toFixed(1)+"%) is smaller than the crop needed ("+(proposedCrop*100).toFixed(1)+"%). The whole print is shown with a mount border instead.",{proposedCrop,approved:approved.maxFraction}));
    else doCover=true;
  }
  const anchor=opts.cropAnchor ?? {x:0.5,y:0.5};
  if(doCover){
    if(aS>aT){
      const nw=Math.round(art.height*aT);
      cropRect={x:Math.round((art.width-nw)*clamp(anchor.x,0,1)),y:0,width:nw,height:art.height};
    }else{
      const nh=Math.round(art.width/aT);
      cropRect={x:0,y:Math.round((art.height-nh)*clamp(anchor.y,0,1)),width:art.width,height:nh};
    }
    const sub=new Uint8ClampedArray(cropRect.width*cropRect.height*4);
    for(let y=0;y<cropRect.height;y++){
      const s=((cropRect.y+y)*art.width+cropRect.x)*4;
      sub.set(art.data.subarray(s,s+cropRect.width*4),y*cropRect.width*4);
    }
    canvas={width:cropRect.width,height:cropRect.height,data:sub};
    artInCanvas={x:0,y:0,width:cropRect.width,height:cropRect.height};
    cropFraction=proposedCrop;
    defects.push(defect("ASPECT_MISMATCH_CROPPED","warn","The print was cropped by "+(cropFraction*100).toFixed(1)+"% as approved.",{cropFraction}));
  }else if(Math.abs(mismatch)<=0.004 && margin===0){
    stretchPct=Math.abs(mismatch)*100; // below measurement error: shown edge to edge, whole print
  }else{
    // whole print at its true proportions on a mount-coloured canvas that has the opening's shape
    // the reference's own mount colour, sampled in a thin band just outside the opening
    mountColour=medianColour(reference,offsetQuad(aperture,Math.max(3,0.02*apLongest)),offsetQuad(aperture,1),exclude);
    let cw=art.width,ch=art.height;
    if(aS>aT) ch=Math.round(art.width/aT);else cw=Math.round(art.height*aT);
    cw=Math.round(cw/(1-2*margin));ch=Math.round(ch/(1-2*margin));
    const data=new Uint8ClampedArray(cw*ch*4);
    for(let i=0;i<cw*ch;i++){data[i*4]=mountColour[0];data[i*4+1]=mountColour[1];data[i*4+2]=mountColour[2];data[i*4+3]=255;}
    const ox=Math.round((cw-art.width)/2),oy=Math.round((ch-art.height)/2);
    for(let y=0;y<art.height;y++){
      const s=y*art.width*4,d=((y+oy)*cw+ox)*4;
      data.set(art.data.subarray(s,s+art.width*4),d); // native pixels, copied verbatim
    }
    canvas={width:cw,height:ch,data};
    artInCanvas={x:ox,y:oy,width:art.width,height:art.height};
    filledFraction=1-(art.width*art.height)/(cw*ch);
    if(filledFraction>0.002) defects.push(defect("ASPECT_MISMATCH_FILLED","info","The whole print is shown with a mount-coloured border ("+(filledFraction*100).toFixed(1)+"% of the opening) because its proportions differ from the opening.",{filledFraction,openingAspect:aT,printAspect:aS}));
  }

  // 5. scene estimates (never from occluded pixels)
  const refForLight=outerQuad ?? offsetQuad(aperture,Math.max(8,0.06*apLongest));
  const light=estimateLight(reference,refForLight,exclude);

  // 6. realism effects. Product pixels are touched ONLY at level "photographic".
  let shaded=canvas;
  const bandArt=clamp(0.012*Math.min(canvas.width,canvas.height),3,60);
  const Ha=homographyFromPoints(rectQuad(canvas.width,canvas.height),aperture)!;
  const lipStrength=realism.lipShadowStrength ?? clamp(light.strength*0.8,0.12,0.3);
  if(photographic){
    const dirPlane=dirToPlane(Ha,{x:canvas.width/2,y:canvas.height/2},light.shadowDir);
    shaded=innerShadowLayer(canvas,dirPlane,bandArt,lipStrength);
  }
  const bandImg=photographic?bandArt*(apLongest/canvas.width):0;

  let layer=warpToQuad(shaded,grown,W,H);
  let gain:ReturnType<typeof estimateIlluminationGain>|null=null;
  let texture:ReturnType<typeof estimateCameraTexture>|null=null;
  if(photographic){
    gain=estimateIlluminationGain(reference,refForLight,{strength:realism.gainStrength ?? 0.6,cap:realism.gainCap ?? 0.03,exclude});
    layer=applyGain(layer,gain);
    const edge=(outerQuad?[outerQuad[0],outerQuad[1]]:[aperture[0],aperture[1]]) as [{x:number;y:number},{x:number;y:number}];
    texture=estimateCameraTexture(reference,{exclude,edge});
    const softness=realism.softnessSigma==="auto"||realism.softnessSigma===undefined?texture.blurSigma:realism.softnessSigma;
    const grain=realism.grainSigma==="auto"||realism.grainSigma===undefined?texture.grainSigma:realism.grainSigma;
    // extra blur only beyond what the resampling already contributes
    layer=softenLayer(layer,Math.min(1.2,Math.sqrt(Math.max(0,softness*softness-0.5*0.5))));
    layer=glassSheen(layer,grown,{x:-light.shadowDir.x,y:-light.shadowDir.y},realism.glassSheen ?? 0.03);
    layer=addGrain(layer,grain,realism.textureSeed ?? 1337);
    if(texture.grainSource==="default"||texture.blurSource==="default") defects.push(defect("TEXTURE_DEFAULTS_USED","info","Part of the reference's grain/softness could not be measured and a default was used.",{grain:texture.grainSource,blur:texture.blurSource}));
  }
  const composite=compositeOver(reference,layer);
  const final=occ.mask?applyOcclusion(composite,reference,occ.mask):composite;

  // 7. measured QA
  const fwdTol=photographic?LIGHTING_FORWARD_TOLERANCES:FORWARD_TOLERANCES;
  const crossTol=photographic?LIGHTING_RECTIFIED_TOLERANCES:RECTIFIED_TOLERANCES;
  const qaMargin=Math.ceil(bandImg)+3;
  const includeMask=occ.mask?(()=>{const m=new Uint8Array(W*H);for(let i=0;i<m.length;i++) m[i]=occ.mask!.alpha[i]<8?1:0;return m;})():undefined;
  const forward=verifyProtectedContent(canvas,final,grown,{mode:"forward",tolerances:fwdTol,margin:qaMargin+(photographic?2:0),focalPx:refFocal,includeMask});

  // the print as it appears in the ORIGINAL photo vs the print region of the final image
  const Hs=homographyFromPoints(rectQuad(art.width,art.height),extracted.usedQuad)!;
  const srcRegion=[
    {x:cropRect.x,y:cropRect.y},{x:cropRect.x+cropRect.width,y:cropRect.y},
    {x:cropRect.x+cropRect.width,y:cropRect.y+cropRect.height},{x:cropRect.x,y:cropRect.y+cropRect.height}
  ].map((p)=>applyHomography(Hs,p)!) as Quad;
  // where the print actually lies: the canvas is warped to the GROWN quad (opening + safety overlap)
  const Hg=homographyFromPoints(rectQuad(canvas.width,canvas.height),grown)!;
  const tgtRegion=[
    {x:artInCanvas.x,y:artInCanvas.y},{x:artInCanvas.x+artInCanvas.width,y:artInCanvas.y},
    {x:artInCanvas.x+artInCanvas.width,y:artInCanvas.y+artInCanvas.height},{x:artInCanvas.x,y:artInCanvas.y+artInCanvas.height}
  ].map((p)=>applyHomography(Hg,p)!) as Quad;
  const cross=crossCheckFromSource({source:input.source,sourceQuad:srcRegion,composite:final,targetQuad:tgtRegion,marginPx:qaMargin+1,tol:crossTol,occlusion:occ.mask});
  const integrity=checkSceneIntegrity(reference,final,{
    polys:[offsetQuad(grown,1.5)],
    ring:outerQuad?{outer:offsetQuad(outerQuad,1),inner:offsetQuad(aperture,1.5)}:undefined
  });
  defects.push(...qaDefects(forward.failures,cross.failures));
  if(!integrity.pass){
    defects.push(defect("SCENE_ALTERED","blocker","Pixels outside the opening changed ("+integrity.changedOutsideAllowed+").",{count:integrity.changedOutsideAllowed}));
    if(integrity.changedFramePixels) defects.push(defect("FRAME_ALTERED","blocker","The reference frame was altered.",{count:integrity.changedFramePixels}));
  }

  const overlay=drawOverlay(reference,[
    ...(outerQuad?[{quad:outerQuad,colour:[255,60,60] as [number,number,number],thickness:2}]:[]),
    {quad:aperture,colour:[40,200,90],thickness:2},
    {quad:tgtRegion,colour:[255,200,0],thickness:1.5}
  ]);
  const qaFailed=!forward.pass || !cross.pass || !integrity.pass;
  return result({
    status:statusOf(defects,qaFailed),needsManual:needsManual(defects),image:final,
    sourceQuad,targetQuad:aperture,referenceFrameQuad:outerQuad,
    automation:{source:manual.sourceQuad?"manual":"auto",target:manual.targetQuad?"manual":"auto",occlusion:occ.kind},
    adjustments:{
      realismLevel:level,fit:doCover?"cover":"contain",cropFraction,proposedCropFraction:proposedCrop,filledFraction,stretchPct,
      edgeOverlapPx:overlapPx,sourceEdgeInsetPx:insetPx,
      lightSource:light.source,shadowStrength:light.strength,
      lipShadow:photographic?lipStrength:0,gainMaxDeviation:gain?.maxDeviation ?? 0,
      grainSigma:texture?.grainSigma ?? 0,softnessSigma:texture?.blurSigma ?? 0,
      apertureAspect,artworkAspect:aS,aspectMethod:extracted.aspectMethod,
      mountColour:mountColour?mountColour.join(","):"n/a"
    },
    qa:{
      forward,crossCheck:cross,sceneIntegrity:integrity,
      productPixels:{
        modified:photographic,level,
        note:photographic?"Photographic effects act on the product within measured colour budgets.":"Product pixels are only geometrically resampled; nothing was recoloured."
      }
    },
    diagnostics:{overlay,extracted:canvas}
  });
}
