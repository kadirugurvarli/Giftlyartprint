import type {Quad,Pt} from "../types";
import {applyHomography,homographyFromPoints} from "../geometry/homography";
import {allowedFrameSize,validateRoom,type RoomDefinition,type FrameSizeCm} from "./schema";

export type RoomPlacement={
  ok:true;targetQuad:Quad;size:FrameSizeCm;referenceFocalPx?:number;
}|{ok:false;error:string};

/**
 * The quad maps the real, calibrated wall plane to the image. No estimated scale,
 * automatic wall detection or AI regeneration is used here.
 * Reject unknown scale rather than falsely claiming a 60x80cm physical size.
 */
export function roomPlacement(room:RoomDefinition,size:FrameSizeCm):RoomPlacement{
  const problems=validateRoom(room);
  if(problems.length) return {ok:false,error:problems.join(",")};
  if(!allowedFrameSize(size)) return {ok:false,error:"FRAME_SIZE_OUT_OF_RANGE"};
  const {wall,region}=room;
  const centre=room.centre??{xCm:region.leftCm+region.widthCm/2,yCm:region.topCm+region.heightCm/2};
  const left=centre.xCm-size.width/2,top=centre.yCm-size.height/2;
  if(left<region.leftCm||top<region.topCm||left+size.width>region.leftCm+region.widthCm||top+size.height>region.topCm+region.heightCm)
    return {ok:false,error:"ART_TOO_LARGE_FOR_REGION"};
  const plane:Pt[]=[{x:0,y:0},{x:wall.widthCm,y:0},{x:wall.widthCm,y:wall.heightCm},{x:0,y:wall.heightCm}];
  const H=homographyFromPoints(plane,wall.quad);
  if(!H) return {ok:false,error:"INVALID_WALL_GEOMETRY"};
  const corners:Pt[]=[
    {x:left,y:top},{x:left+size.width,y:top},
    {x:left+size.width,y:top+size.height},{x:left,y:top+size.height}
  ];
  const projected=corners.map(p=>applyHomography(H,p));
  if(projected.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))
    return {ok:false,error:"INVALID_PROJECTED_GEOMETRY"};
  const targetQuad=projected as Quad;
  if(targetQuad.some(p=>p.x<0||p.y<0||p.x>room.image.width||p.y>room.image.height))
    return {ok:false,error:"FRAME_OUTSIDE_IMAGE"};
  return {ok:true,targetQuad,size};
}

/**
 * Adapter for the existing framed-on-wall workflow. This supplies a manual targetQuad,
 * bypassing automatic wall placement. The source MUST be a photo of an already-framed
 * piece; flat artwork + generated frame is a separate, not-yet-implemented workflow.
 *
 * Room images and customer artwork are provided by the caller in memory.
 * No file writes, uploads or background storage are performed here.
 */
export function roomManualPlacement(room:RoomDefinition,size:FrameSizeCm){
  const p=roomPlacement(room,size);
  if(!p.ok) return p;
  return {
    ok:true as const,
    manual:{targetQuad:p.targetQuad},
    options:{
      placement:"free-wall" as const,
      physicalWidthM:size.width/100,
      pieceAspect:size.width/size.height,
      // No synthetic EXIF/focal data: existing engine fallback applies.
    }
  };
}
