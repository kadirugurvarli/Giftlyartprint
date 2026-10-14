import type {Pt,Quad} from "../types";

/**
 * Room Library schema v2 (pilot).
 *
 * A room is a background photo (or an AI-generated image) plus the evidence needed to place a framed
 * piece in it believably: calibrated control points on the wall plane, camera focal length, an
 * ESTIMATED scale with an explicit confidence, a calibrated light and a wall-only shadow mask.
 * Rooms never contain customer artwork; the image is loaded by the caller and never stored here.
 */
export const ROOM_SCHEMA_VERSION=2 as const;

export type RoomOrigin="ai-generated"|"owned-photo"|"licensed-photo";

export type ControlPoint={
  /** Pixel-edge coordinates in the room image. Must be visible (inside the image). */
  image:Pt;
  /** The same point on the wall plane in centimetres (any origin; right = +x, down = +y). */
  wallCm:Pt;
  label?:string;
};

export type ScaleMethod="measured-reference"|"known-object"|"assumed-object"|"ai-estimate";
export type ScaleConfidence="measured"|"high"|"medium"|"low";

/** How the physical scale of the wall was obtained, and how far it can be trusted. */
export type RoomScale={
  method:ScaleMethod;
  /** Human-readable basis, e.g. "sofa seat width assumed 200 cm" or "door leaf 1981 x 762 mm measured". */
  basis:string;
  confidence:ScaleConfidence;
  /** Relative 1-sigma uncertainty of the cm values (0.1 = +/-10 %). */
  relativeUncertainty:number;
  verifiedBy?:string;
  verifiedAt?:string;
};

export type RoomCamera={
  focalPx:number;
  /** Defaults to the image centre. */
  principalPoint?:Pt;
  source:"exif"|"solved"|"estimated";
};

/** Straight lines annotated in the image that must agree with the wall plane. */
export type PerspectiveLine={kind:"horizontal"|"vertical";a:Pt;b:Pt;label?:string};

/** Calibrated key light. Direction is where SHADOWS fall, in image space. */
export type RoomLight={
  calibrated:boolean;
  /** 0 = shadows fall to the right, 90 = straight down (image y grows downwards). */
  shadowDirectionDeg:number;
  /** Peak darkening of the drop shadow next to a frame, 0-0.6. */
  intensity:number;
  /** Penumbra softness (sigma of the shadow blur) in cm on the wall plane. */
  softnessCm:number;
  colourTempK:number;
  notes?:string;
};

/** Where a frame's shadow may fall: only on the wall, never on furniture, floor or windows. */
export type ShadowMaskSpec={
  wallPolygons:Pt[][];
  excludePolygons?:Pt[][];
};

export type RoomDefinition={
  schemaVersion:typeof ROOM_SCHEMA_VERSION;
  id:string;
  image:{key:string;width:number;height:number;origin:RoomOrigin};
  rights:{approved:boolean;commercialUse:boolean;notes:string};
  wall:{controlPoints:ControlPoint[]};
  scale:RoomScale;
  camera:RoomCamera;
  perspective?:{lines?:PerspectiveLine[]};
  /** Safe placement box on the wall plane (cm, same coordinates as the control points). */
  region:{id:string;leftCm:number;topCm:number;widthCm:number;heightCm:number};
  /** Optional calibrated centre of the piece; defaults to the centre of the region. */
  centre?:{xCm:number;yCm:number};
  light:RoomLight;
  shadowMask?:ShadowMaskSpec;
};

export type FrameSizeCm={width:number;height:number};

/** OUTER frame dimensions (moulding included) with their landscape rotations. */
export const PILOT_FRAME_SIZES:readonly FrameSizeCm[]=[
  {width:30,height:40},{width:40,height:30},
  {width:40,height:50},{width:50,height:40},
  {width:50,height:70},{width:70,height:50},
  {width:60,height:80},{width:80,height:60}
];

export function allowedFrameSize(size:FrameSizeCm):boolean{
  return PILOT_FRAME_SIZES.some(s=>s.width===size.width&&s.height===size.height);
}

export type {Pt,Quad};

/** Largest relative difference between a source frame's proportions and the chosen outer size. */
export const MAX_SOURCE_ASPECT_MISMATCH=0.02;
