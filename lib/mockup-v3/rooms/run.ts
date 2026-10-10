import type {Pt,Quad,RawImage} from "../types";
import {runMockup,type MockupResult,type RealismLevel} from "../pipeline";
import {prepareReference} from "../pipeline/common";
import {rectQuad,offsetQuad} from "../geometry/quad";
import {rasterizePolygons} from "../vision/mask";
import {checkSourceFrameAspect,measureFramedPhotoAspect,type AspectCheck} from "./aspect";
import {buildShadowMask,shadowDirFromDeg} from "./light";
import {roomManualPlacement,type PlacementOptions,type RoomPlacement} from "./placement";
import {choosePxPerCm,planFlatFrame,renderFlatFramedPiece,type FramePlan,type FrameSpec} from "./product";
import type {FrameSizeCm,RoomDefinition} from "./schema";

/** What the customer supplied. Held in memory only; this module never writes, stores or uploads anything. */
export type RoomSource=
  |{kind:"flat-artwork";artwork:RawImage;frame:FrameSpec}
  |{kind:"framed-photo";photo:RawImage;statedAspect?:number;sourceFocalPx?:number;sourceQuad?:Quad};

export type RoomRunInput={
  room:RoomDefinition;
  roomImage:RawImage;
  size:FrameSizeCm;
  source:RoomSource;
  level?:RealismLevel;
  placement?:PlacementOptions;
  /** Longer side limit for the room image inside the engine (default 2400). */
  maxReferenceSide?:number;
};

export type RoomCheck={name:string;pass:boolean;detail:string};

export type RoomRunResult=
  |{ok:true;result:MockupResult;placement:Extract<RoomPlacement,{ok:true}>;checks:RoomCheck[];frame?:FramePlan;aspect?:AspectCheck;shadowMaskPixels:number}
  |{ok:false;error:string;detail?:string};

const fail=(error:string,detail?:string):RoomRunResult=>({ok:false,error,detail});

/**
 * Place a customer's piece in a calibrated room.
 *  - flat artwork: rendered into a real-unit frame (moulding, mount, depth) lit by the room's light
 *  - photo of a finished framed piece: its proportions must match the outer size within 2 %
 * Then the existing framed-on-wall pipeline does the compositing and its fidelity gates; afterwards the
 * room-specific protections (no stretch, quad exactness, protected pixels) are verified on the result.
 */
export async function runRoomMockup(input:RoomRunInput):Promise<RoomRunResult>{
  const {room,roomImage,size,source}=input;
  if(roomImage.width!==room.image.width||roomImage.height!==room.image.height) return fail("ROOM_IMAGE_SIZE_MISMATCH",`${roomImage.width}x${roomImage.height} vs ${room.image.width}x${room.image.height}`);
  const wallMask=buildShadowMask(room);
  const planned=roomManualPlacement(room,size,{...input.placement,shadowMask:wallMask ?? undefined,frameDepthCm:source.kind==="flat-artwork"?source.frame.frameDepthCm:undefined});
  if(!planned.ok) return fail(planned.error,"issues" in planned&&planned.issues?planned.issues.map(i=>i.code+(i.detail?` (${i.detail})`:"")).join("; "):undefined);
  const placement=planned.placement;
  const nominal=size.width/size.height;

  let pieceImage:RawImage;
  let framePlan:FramePlan|undefined;
  let aspect:AspectCheck|undefined;
  const manual:{targetQuad:Quad;sourceQuad?:Quad}={targetQuad:placement.targetQuad};
  const options:Record<string,unknown>={...planned.options,maxReferenceSide:input.maxReferenceSide ?? 2400};

  if(source.kind==="flat-artwork"){
    const f=source.frame;
    if(f.outerCm.width!==size.width||f.outerCm.height!==size.height) return fail("FRAME_SIZE_MISMATCH","the frame spec's outer size must equal the requested size");
    const l=room.light;
    const pxPerCm=choosePxPerCm(placement.pxPerCm,Math.max(size.width,size.height));
    const plan=planFlatFrame(f,source.artwork,pxPerCm);
    if(!plan.ok) return fail(plan.error);
    // frame and mount edges are softened to ~0.6 px of the FINAL image (print pixels are never softened)
    const rendered=await renderFlatFramedPiece(source.artwork,f,shadowDirFromDeg(l.shadowDirectionDeg),pxPerCm,0.6*pxPerCm/placement.pxPerCm);
    pieceImage=rendered.image;framePlan=rendered.plan;
    manual.sourceQuad=rectQuad(pieceImage.width,pieceImage.height); // we drew it: its corners are exact
  }else{
    const m=measureFramedPhotoAspect(source.photo,{focalPx:source.sourceFocalPx,quad:source.sourceQuad});
    aspect=checkSourceFrameAspect(size,{measuredAspect:m?.aspect,measuredReliable:m?.reliable,statedAspect:source.statedAspect});
    if(!aspect.ok) return fail(aspect.error,aspect.deviation!==undefined?`${(aspect.deviation*100).toFixed(1)}% from ${nominal.toFixed(3)}`:undefined);
    pieceImage=source.photo;
    if(source.sourceQuad) manual.sourceQuad=source.sourceQuad;
    if(source.sourceFocalPx) options.sourceFocalPx=source.sourceFocalPx;
  }
  (options.realism as Record<string,unknown>).level=input.level ?? "environment";

  const result=await runMockup({mode:"framed-on-wall",source:pieceImage,reference:roomImage,options:options as never,manual:manual as never});
  if(!result.image||!result.targetQuad) return {ok:false,error:"ENGINE_PRODUCED_NO_IMAGE",detail:result.defects.map(d=>d.code).join(",")};

  // ---- room-specific verification on the finished image
  const checks:RoomCheck[]=[];
  const maxSide=input.maxReferenceSide ?? 2400;
  const ref=prepareReference(roomImage,maxSide);
  const s=ref.scale;
  const err=Math.max(...result.targetQuad.map((p,i)=>Math.hypot(p.x-placement.targetQuad[i].x*s,p.y-placement.targetQuad[i].y*s)));
  checks.push({name:"quad-exact",pass:err<0.75,detail:`engine quad vs calibrated wall quad: ${err.toFixed(2)} px`});
  const pa=Number(result.adjustments.pieceAspect),placed=Number(result.adjustments.placedAspect);
  checks.push({name:"piece-not-stretched",pass:Math.abs(pa/nominal-1)<=0.005,detail:`extracted piece aspect ${pa.toFixed(4)} vs outer size ${nominal.toFixed(4)}`});
  checks.push({name:"placed-aspect",pass:!Number.isFinite(placed)||placed===0||Math.abs(placed/nominal-1)<=0.02,detail:`placed aspect ${placed.toFixed(4)} vs ${nominal.toFixed(4)} (≤2 %)`});
  const pp=protectedPixels(ref.image,result.image,result.targetQuad,wallMask,s);
  checks.push({name:"protected-pixels",pass:pp.changedOffWall===0,detail:`${pp.changedOffWall} changed pixels outside the piece and the wall mask (of ${pp.checked}); furniture/floor untouched`});
  checks.push({name:"engine-gates",pass:result.status!=="fail"&&(result.qa.forward?.pass??false)&&(result.qa.crossCheck?.pass??false)&&(result.qa.sceneIntegrity?.pass??false),detail:`status ${result.status}; forward ${result.qa.forward?.pass}, cross-check ${result.qa.crossCheck?.pass}, scene integrity ${result.qa.sceneIntegrity?.pass}`});
  return {ok:true,result,placement,checks,frame:framePlan,aspect,shadowMaskPixels:pp.maskPixels};
}

/**
 * Pixels that changed although they are neither part of the placed piece nor on the wall (shadow may only
 * fall on the wall). `scale` maps room-image coordinates to the (possibly downscaled) engine scene.
 */
export function protectedPixels(reference:RawImage,final:RawImage,target:Quad,wallMask:{width:number;height:number;alpha:Uint8Array}|null,scale=1){
  const W=reference.width,H=reference.height;
  const piece=rasterizePolygons([offsetQuad(target,1.5).map(p=>({x:p.x,y:p.y}))],W,H,2);
  let changedOffWall=0,checked=0,maskPixels=0;
  const mw=wallMask?.width ?? 0;
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const i=y*W+x;
      if(piece[i]>0) continue;
      let onWall=true;
      if(wallMask){
        const mx=Math.min(mw-1,Math.floor(x/scale)),my=Math.min(wallMask.height-1,Math.floor(y/scale));
        onWall=wallMask.alpha[my*mw+mx]>0;
      }
      if(onWall){maskPixels++;continue;}
      checked++;
      if(reference.data[i*4]!==final.data[i*4]||reference.data[i*4+1]!==final.data[i*4+1]||reference.data[i*4+2]!==final.data[i*4+2]) changedOffWall++;
    }
  }
  return {changedOffWall,checked,maskPixels};
}

export type {Pt};
