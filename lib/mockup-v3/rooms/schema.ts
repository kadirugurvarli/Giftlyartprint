import type {Quad} from "../types";

/** Room backgrounds contain no pre-existing artwork, frames, people or identifying details. */
export type RoomDefinition = {
  id:string;
  image:{key:string;width:number;height:number;origin:"ai-generated"|"owned-photo"|"licensed-photo"};
  rights:{approved:boolean;commercialUse:boolean;notes:string};
  /** A physical wall rectangle. TL,TR,BR,BL in pixel-edge coordinates. */
  wall:{quad:Quad;widthCm:number;heightCm:number;scaleVerified:boolean};
  /** Safe placement box in wall coordinates, measured in cm from the wall's upper-left. */
  region:{id:string;leftCm:number;topCm:number;widthCm:number;heightCm:number};
  /** Optional calibrated centre; defaults to centre of the region. */
  centre?:{xCm:number;yCm:number};
  /** Approximate room lighting. Metadata only until the engine supports an override. */
  light:{direction:"left"|"right"|"frontal";temperature:"warm"|"neutral"|"cool";notes?:string};
};

export type FrameSizeCm={width:number;height:number};
export const PILOT_FRAME_SIZES:readonly FrameSizeCm[]=[
  {width:30,height:40},{width:40,height:30},
  {width:40,height:50},{width:50,height:40},
  {width:50,height:70},{width:70,height:50},
  {width:60,height:80},{width:80,height:60}
];

/** Dimensions are OUTER frame dimensions, not print opening dimensions. */
export function allowedFrameSize(size:FrameSizeCm):boolean{
  return PILOT_FRAME_SIZES.some(s=>s.width===size.width&&s.height===size.height);
}

export function validateRoom(room:RoomDefinition):string[]{
  const errors:string[]=[];
  if(!/^[a-z0-9][a-z0-9-]*$/.test(room.id)) errors.push("INVALID_ROOM_ID");
  if(!room.image.key || !Number.isInteger(room.image.width)||!Number.isInteger(room.image.height)||room.image.width<800||room.image.height<600) errors.push("INVALID_IMAGE");
  if(!room.rights.approved||!room.rights.commercialUse) errors.push("ROOM_RIGHTS_NOT_APPROVED");
  const w=room.wall,r=room.region;
  if(![w.widthCm,w.heightCm,r.leftCm,r.topCm,r.widthCm,r.heightCm].every(Number.isFinite)||w.widthCm<=0||w.heightCm<=0||r.widthCm<=0||r.heightCm<=0||r.leftCm<0||r.topCm<0||r.leftCm+r.widthCm>w.widthCm||r.topCm+r.heightCm>w.heightCm) errors.push("INVALID_REGION");
  if(!w.quad.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=room.image.width&&p.y<=room.image.height)) errors.push("INVALID_WALL_QUAD");
  if(!w.scaleVerified) errors.push("WALL_SCALE_UNVERIFIED");
  if(room.centre && (![room.centre.xCm,room.centre.yCm].every(Number.isFinite)||room.centre.xCm<r.leftCm||room.centre.xCm>r.leftCm+r.widthCm||room.centre.yCm<r.topCm||room.centre.yCm>r.topCm+r.heightCm)) errors.push("CENTRE_OUTSIDE_REGION");
  return errors;
}
