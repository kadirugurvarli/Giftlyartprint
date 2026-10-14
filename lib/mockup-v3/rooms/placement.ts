import type {Pt,Quad} from "../types";
import {applyHomography} from "../geometry/homography";
import {pointInPolygon,pxPerCmAt} from "./calibration";
import {lightOverrideFor} from "./light";
import {allowedFrameSize,type FrameSizeCm,type RoomDefinition} from "./schema";
import {analyseRoom,type RoomIssue} from "./validate";
import type {RealismOptions} from "../pipeline/types";

export type PhysicalAccuracy="measured"|"illustrative";

export type RoomPlacement={
  ok:true;
  targetQuad:Quad;
  size:FrameSizeCm;
  /** Reference focal length in px of the original room image. */
  referenceFocalPx:number;
  /** Image px per wall cm at the centre of the placed piece. */
  pxPerCm:number;
  /** Centre of the piece on the wall plane, cm. */
  centreCm:Pt;
  /** "measured" only when the room's scale was physically measured; AI and assumed scales are illustrative. */
  physicalAccuracy:PhysicalAccuracy;
  /** Text to show wherever a size is claimed. */
  scaleDisclosure:string;
  /** Plausible outer-width range implied by the scale uncertainty. */
  widthRangeCm:[number,number];
}|{ok:false;error:string;issues?:RoomIssue[]};

export type PlacementOptions={
  /** Refuse anything but a physically measured scale. */
  requirePhysicalAccuracy?:boolean;
};

/**
 * Map an approved outer frame size onto the calibrated wall plane. The quad comes from a least-squares
 * homography of the room's control points: no automatic wall detection and no guessed scale. Cropped or
 * partly visible walls work as long as the control points are visible and the placement stays inside
 * the calibrated area and inside the wall mask.
 */
export function roomPlacement(room:RoomDefinition,size:FrameSizeCm,o:PlacementOptions={}):RoomPlacement{
  const a=analyseRoom(room);
  if(a.issues.length) return {ok:false,error:[...new Set(a.issues.map(i=>i.code))].join(","),issues:a.issues};
  if(!allowedFrameSize(size)) return {ok:false,error:"FRAME_SIZE_OUT_OF_RANGE"};
  const measured=room.scale.confidence==="measured"||(room.scale.confidence==="high"&&room.scale.method!=="ai-estimate"&&room.scale.method!=="assumed-object");
  const physicalAccuracy:PhysicalAccuracy=measured?"measured":"illustrative";
  if(o.requirePhysicalAccuracy&&physicalAccuracy!=="measured") return {ok:false,error:"SCALE_NOT_PHYSICALLY_MEASURED"};
  const {region}=room;
  const centre=room.centre??{xCm:region.leftCm+region.widthCm/2,yCm:region.topCm+region.heightCm/2};
  const left=centre.xCm-size.width/2,top=centre.yCm-size.height/2;
  if(left<region.leftCm-1e-9||top<region.topCm-1e-9||left+size.width>region.leftCm+region.widthCm+1e-9||top+size.height>region.topCm+region.heightCm+1e-9)
    return {ok:false,error:"ART_TOO_LARGE_FOR_REGION"};
  const H=a.fit!.H;
  const corners:Pt[]=[{x:left,y:top},{x:left+size.width,y:top},{x:left+size.width,y:top+size.height},{x:left,y:top+size.height}];
  const projected=corners.map(p=>applyHomography(H,p));
  if(projected.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))) return {ok:false,error:"INVALID_PROJECTED_GEOMETRY"};
  const targetQuad=projected as Quad;
  const {width:W,height:Hh}=room.image;
  if(targetQuad.some(p=>p.x<0||p.y<0||p.x>W||p.y>Hh)) return {ok:false,error:"FRAME_OUTSIDE_IMAGE"};
  // the whole piece must hang on wall, not on furniture
  const sm=room.shadowMask!;
  const onWall=(p:Pt)=>sm.wallPolygons.some(poly=>pointInPolygon(p,poly))&&!(sm.excludePolygons ?? []).some(poly=>pointInPolygon(p,poly));
  if(!targetQuad.every(onWall)||!onWall({x:targetQuad.reduce((s,p)=>s+p.x,0)/4,y:targetQuad.reduce((s,p)=>s+p.y,0)/4})) return {ok:false,error:"FRAME_NOT_ON_WALL_MASK"};
  const pxPerCm=pxPerCmAt(H,{x:centre.xCm,y:centre.yCm});
  const u=room.scale.relativeUncertainty;
  return {
    ok:true,targetQuad,size,referenceFocalPx:room.camera.focalPx,pxPerCm,centreCm:{x:centre.xCm,y:centre.yCm},physicalAccuracy,
    scaleDisclosure:physicalAccuracy==="measured"
      ?`Scale measured (${room.scale.basis}), ±${(u*100).toFixed(0)}%.`
      :`Illustrative scale (${room.scale.method}: ${room.scale.basis}; confidence ${room.scale.confidence}, ±${(u*100).toFixed(0)}%). Not a physical measurement.`,
    widthRangeCm:[size.width*(1-u),size.width*(1+u)]
  };
}

/**
 * Inputs for the existing framed-on-wall pipeline: a manual target quad, the room's focal length, the
 * exact outer width, a calibrated light and the wall-only shadow mask. The room image and the customer's
 * artwork are supplied by the caller in memory; nothing is written or uploaded here.
 */
export function roomManualPlacement(room:RoomDefinition,size:FrameSizeCm,o:PlacementOptions&{frameDepthCm?:number;shadowMask?:RealismOptions["shadowMask"]}={}){
  const p=roomPlacement(room,size,o);
  if(!p.ok) return p;
  const realism:RealismOptions={
    lightOverride:lightOverrideFor(room,p.pxPerCm),
    ...(o.frameDepthCm!==undefined?{frameDepthM:o.frameDepthCm/100}:{}),
    ...(o.shadowMask?{shadowMask:o.shadowMask}:{})
  };
  return {
    ok:true as const,
    manual:{targetQuad:p.targetQuad},
    options:{
      placement:"free-wall" as const,
      physicalWidthM:size.width/100,
      pieceAspect:size.width/size.height,
      referenceFocalPx:p.referenceFocalPx,
      realism
    },
    placement:p
  };
}
