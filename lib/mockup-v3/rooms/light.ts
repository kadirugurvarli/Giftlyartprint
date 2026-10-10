import type {Pt} from "../types";
import {maskFromPolygons,type OcclusionMask} from "../composite/occlusion";
import type {RealismOptions} from "../pipeline/types";
import type {RoomDefinition} from "./schema";

/** Unit vector (image space) along which shadows fall for an azimuth in degrees (0 = right, 90 = down). */
export function shadowDirFromDeg(deg:number):Pt{
  const r=deg*Math.PI/180;
  return {x:Math.cos(r),y:Math.sin(r)};
}

/**
 * Wall-only shadow mask at the room image's own resolution: 255 on the wall, 0 on furniture, floor,
 * windows and anything else. Built from polygons so no mask image has to be stored.
 */
export function buildShadowMask(room:RoomDefinition,featherPx=1):OcclusionMask|null{
  const sm=room.shadowMask;
  if(!sm?.wallPolygons?.length) return null;
  const {width:W,height:H}=room.image;
  const wall=maskFromPolygons(sm.wallPolygons,W,H,featherPx);
  if(sm.excludePolygons?.length){
    const ex=maskFromPolygons(sm.excludePolygons,W,H,featherPx);
    for(let i=0;i<wall.alpha.length;i++) wall.alpha[i]=Math.round(wall.alpha[i]*(1-ex.alpha[i]/255));
  }
  return wall;
}

/** Engine light override from the room's calibrated light; penumbra converted cm -> reference px. */
export function lightOverrideFor(room:RoomDefinition,pxPerCm:number):NonNullable<RealismOptions["lightOverride"]>{
  const l=room.light;
  return {
    shadowDir:shadowDirFromDeg(l.shadowDirectionDeg),
    intensity:l.intensity,
    softnessPx:Math.max(0.6,l.softnessCm*pxPerCm),
    colourTempK:l.colourTempK
  };
}
