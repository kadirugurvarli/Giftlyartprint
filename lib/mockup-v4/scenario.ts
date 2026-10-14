import type {Pt,Quad,RawImage} from "../mockup-v3/types";
import {runRoomMockup,type RoomCheck} from "../mockup-v3/rooms/run";
import {buildShadowMask,shadowDirFromDeg} from "../mockup-v3/rooms/light";
import type {FrameSpec} from "../mockup-v3/rooms/product";
import type {RoomDefinition} from "../mockup-v3/rooms/schema";
import {printQuadFromPlan} from "./run";

export type Scenario={
  size:{width:number;height:number};
  baseline:RawImage;
  outerQuad:Quad;
  artQuad:Quad;
  wallAlpha:Uint8Array|null;
  protect:Pt[][];
  shadowDir:Pt;
  /** Frame moulding width as it appears in the scene (px). */
  mouldingPx:number;
  wallPxPerCm:number;
  physicalAccuracy:string;
  scaleDisclosure:string;
  v3Checks:RoomCheck[];
  v3Status:string;
};

export type ScenarioResult=({ok:true}&Scenario)|{ok:false;error:string;detail?:string};

/**
 * V3 baseline for one outer size: calibrated placement, rendered frame, engine composite and its own checks.
 * The engine runs at FULL room resolution (no downscale) so the V4 edit crop keeps all the detail.
 */
export async function buildScenario(o:{room:RoomDefinition;roomImage:RawImage;artwork:RawImage;frame:FrameSpec;size:{width:number;height:number}}):Promise<ScenarioResult>{
  const r=await runRoomMockup({room:o.room,roomImage:o.roomImage,size:o.size,source:{kind:"flat-artwork",artwork:o.artwork,frame:o.frame},maxReferenceSide:Math.max(o.roomImage.width,o.roomImage.height)});
  if(!r.ok) return {ok:false,error:r.error,detail:r.detail};
  const baseline=r.result.image!;
  if(baseline.width!==o.roomImage.width||baseline.height!==o.roomImage.height) return {ok:false,error:"SCENE_WAS_RESAMPLED"};
  const outerQuad=r.result.targetQuad!;
  const artQuad=printQuadFromPlan(outerQuad,r.frame!.outer,r.frame!.print);
  const wall=buildShadowMask(o.room);
  return {ok:true,size:o.size,baseline,outerQuad,artQuad,wallAlpha:wall?wall.alpha:null,protect:o.room.shadowMask?.excludePolygons ?? [],shadowDir:shadowDirFromDeg(o.room.light.shadowDirectionDeg),
    mouldingPx:o.frame.mouldingWidthCm*r.placement.pxPerCm,wallPxPerCm:r.placement.pxPerCm,physicalAccuracy:r.placement.physicalAccuracy,scaleDisclosure:r.placement.scaleDisclosure,v3Checks:r.checks,v3Status:r.result.status};
}
