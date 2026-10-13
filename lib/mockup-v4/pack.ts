import type {FrameSpec} from "../mockup-v3/rooms/product";
import {validateFrameSpec} from "../mockup-v3/rooms/product";
import type {RoomDefinition} from "../mockup-v3/rooms/schema";
import {validateRoomIssues} from "../mockup-v3/rooms/validate";

/**
 * A local "experiment pack": one rights-cleared room image + its V3 calibration + one NON-customer sample artwork.
 * This module only validates the manifest (pure, no fs). `scripts/v4-pack.ts` reads the files.
 */
export type PackManifest={
  schemaVersion:1;
  id:string;
  /** file names inside the pack folder (no paths) */
  roomImage:string;
  artworkImage:string;
  room:RoomDefinition;
  provenance:{
    kind:"ai-generated"|"synthetic-test";
    generator?:string;generatedOn?:string;
    /** the owner confirms the right to use this image for the experiment */
    rightsCleared:boolean;licence:string;
    /** the owner confirms the wall has no frame, art, poster or text on it */
    emptyWallConfirmed:boolean;
  };
  artwork:{origin:"sample"|"synthetic-test";customer:false;licence:string};
  frame:{mouldingWidthCm:number;mountWidthCm:number;frameDepthCm:number;mouldingColour:[number,number,number];mountColour:[number,number,number];description:string};
  /** Plain-language light description for the prompt; derived from `room.light` when absent. */
  lightDescription?:string;
};

export const PACK_SIZES=[{width:30,height:40},{width:60,height:80}] as const;

export type PackIssue={code:string;detail?:string};

const safeName=(n:unknown)=>typeof n==="string"&&/^[A-Za-z0-9._-]+$/.test(n)&&!n.startsWith(".")&&n.length<=80;
const imageName=(n:unknown)=>safeName(n)&&/\.(png|jpe?g|webp)$/i.test(n as string);

export function frameSpecFor(m:PackManifest,size:{width:number;height:number}):FrameSpec{
  return {outerCm:size,mouldingWidthCm:m.frame.mouldingWidthCm,mountWidthCm:m.frame.mountWidthCm,frameDepthCm:m.frame.frameDepthCm,mouldingColour:m.frame.mouldingColour,mountColour:m.frame.mountColour};
}

export function validatePackManifest(m:PackManifest):PackIssue[]{
  const out:PackIssue[]=[];const add=(code:string,detail?:string)=>out.push({code,detail});
  if(!m||m.schemaVersion!==1) return [{code:"PACK_SCHEMA_VERSION"}];
  if(!/^[a-z0-9][a-z0-9-]{2,60}$/.test(m.id ?? "")) add("PACK_ID_INVALID");
  if(!imageName(m.roomImage)) add("PACK_FILE_NAME_INVALID","roomImage");
  if(!imageName(m.artworkImage)) add("PACK_FILE_NAME_INVALID","artworkImage");
  if(m.roomImage&&m.roomImage===m.artworkImage) add("PACK_FILE_NAME_INVALID","room and artwork must be different files");
  const p=m.provenance;
  if(!p||(p.kind!=="ai-generated"&&p.kind!=="synthetic-test")) add("PACK_PROVENANCE_MISSING");
  else{
    if(p.rightsCleared!==true||!p.licence?.trim()) add("PACK_RIGHTS_NOT_CLEARED");
    if(p.emptyWallConfirmed!==true) add("PACK_EMPTY_WALL_NOT_CONFIRMED");
    if(p.kind==="ai-generated"&&(!p.generator?.trim()||!p.generatedOn?.trim())) add("PACK_PROVENANCE_INCOMPLETE","an AI room needs the generator and the generation date");
    if(p.kind==="ai-generated"&&m.room?.image?.origin!=="ai-generated") add("PACK_ROOM_ORIGIN_MISMATCH","room.image.origin must be ai-generated");
  }
  const a=m.artwork;
  if(!a||a.customer!==false||(a.origin!=="sample"&&a.origin!=="synthetic-test")||!a.licence?.trim()) add("PACK_ARTWORK_NOT_NON_CUSTOMER","the artwork must be a non-customer sample with a licence note");
  if(!m.room) add("PACK_ROOM_MISSING");
  else for(const i of validateRoomIssues(m.room)) add("PACK_ROOM_"+i.code,i.detail);
  if(m.room?.shadowMask?.wallPolygons?.length!==undefined&&!m.room.shadowMask.wallPolygons.length) add("PACK_WALL_MASK_MISSING");
  if(!m.room?.shadowMask?.wallPolygons?.length) add("PACK_WALL_MASK_MISSING","a wall-only mask is required: the shadow band is only allowed on the wall");
  if(!m.frame||!m.frame.description?.trim()) add("PACK_FRAME_SPEC_INVALID","frame description missing");
  else for(const z of PACK_SIZES){const e=validateFrameSpec(frameSpecFor(m,z));if(e) add("PACK_FRAME_SPEC_INVALID",`${z.width}x${z.height}: ${e}`);}
  return out;
}

/** Only an AI-generated pack whose rights are cleared and whose wall is confirmed empty may be sent to a paid model. */
export function paidEligible(m:PackManifest):{eligible:boolean;reasons:string[]}{
  const reasons:string[]=[];
  if(m.provenance?.kind!=="ai-generated") reasons.push("pack is not an AI-generated room (synthetic test packs are dry-run only)");
  if(m.provenance?.rightsCleared!==true) reasons.push("room rights are not cleared");
  if(m.provenance?.emptyWallConfirmed!==true) reasons.push("empty wall not confirmed");
  if(m.artwork?.origin!=="sample") reasons.push("artwork is not a licensed non-customer sample");
  return {eligible:reasons.length===0,reasons};
}

/** Words for the prompt from the calibrated light (shadow direction is image-space degrees, 0 = right, 90 = down). */
export function describeLight(l:RoomDefinition["light"]):string{
  const d=((l.shadowDirectionDeg%360)+360)%360;
  const horiz=Math.cos(d*Math.PI/180),vert=Math.sin(d*Math.PI/180);
  const fall=[vert>0.3?"down":vert<-0.3?"up":"",horiz>0.3?"to the right":horiz<-0.3?"to the left":""].filter(Boolean).join(" and ");
  const from=[vert>0.3?"above":vert<-0.3?"below":"",horiz>0.3?"the left":horiz<-0.3?"the right":""].filter(Boolean).join(" and ");
  const soft=l.softnessCm<1?"hard-edged":l.softnessCm<3?"softly defined":"very soft";
  const warm=l.colourTempK<4000?"warm":l.colourTempK>5800?"cool daylight":"neutral";
  const strength=l.intensity<0.15?"faint":l.intensity<0.35?"gentle":"pronounced";
  return `${warm} light from ${from||"the front"}, ${strength} ${soft} shadows falling ${fall||"straight back"}`;
}
