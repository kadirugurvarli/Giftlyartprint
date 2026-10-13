import type {Pt} from "../mockup-v3/types";
import type {ControlPoint,RoomDefinition} from "../mockup-v3/rooms/schema";
import {ROOM_SCHEMA_VERSION} from "../mockup-v3/rooms/schema";
import {fitWall,perspectiveReport} from "../mockup-v3/rooms/calibration";
import {analyseRoom} from "../mockup-v3/rooms/validate";
import type {PackManifest} from "./pack";

/**
 * What a person marks on a room image (in the annotation tool): rectangles of KNOWN size that lie on the wall plane
 * (a door, a window frame, a skirting run ...), the wall outline, furniture outlines, the safe placement box and the light.
 * Wall-plane coordinates: origin = top-left corner of the FIRST reference rectangle, x to the right, y down, centimetres.
 */
export type RoomAnnotation={
  schemaVersion:1;
  image:{width:number;height:number};
  references:{label:string;widthCm:number;heightCm:number;/** image px, TL,TR,BR,BL */corners:[Pt,Pt,Pt,Pt];/** wall-plane position of this rectangle's TL corner (first one: 0,0) */offsetCm?:{x:number;y:number}}[];
  extraPoints?:ControlPoint[];
  wallPolygons:Pt[][];
  excludePolygons:Pt[][];
  region:{leftCm:number;topCm:number;widthCm:number;heightCm:number};
  light:{shadowDirectionDeg:number;intensity:number;softnessCm:number;colourTempK:number;notes?:string};
  scale:{basis:string;confidence:"medium"|"low";relativeUncertainty:number};
  /** Leave out to let the tool suggest one from the geometry. */
  focalPx?:number;
};

export type AnnotationIssue={code:string;detail?:string};

export function controlPointsFrom(a:RoomAnnotation):ControlPoint[]{
  const pts:ControlPoint[]=[];
  a.references.forEach((r,i)=>{
    const o=i===0?{x:0,y:0}:(r.offsetCm ?? {x:0,y:0});
    const cm:Pt[]=[{x:o.x,y:o.y},{x:o.x+r.widthCm,y:o.y},{x:o.x+r.widthCm,y:o.y+r.heightCm},{x:o.x,y:o.y+r.heightCm}];
    r.corners.forEach((c,k)=>pts.push({image:{x:c.x,y:c.y},wallCm:cm[k],label:`${r.label}-${["tl","tr","br","bl"][k]}`}));
  });
  return [...pts,...(a.extraPoints ?? [])];
}

/** Focal length (px) the geometry implies when it is observable; otherwise a conventional wide-ish guess flagged as an estimate. */
export function suggestFocal(a:RoomAnnotation):{focalPx:number;basis:"implied-by-geometry"|"assumed-default"}{
  const fit=fitWall(controlPointsFrom(a));
  const guess=0.85*Math.max(a.image.width,a.image.height);
  if(!fit) return {focalPx:guess,basis:"assumed-default"};
  // implied focal needs a guess to evaluate against; perspectiveReport reports it when the vanishing points are finite
  const rep=perspectiveReport(fit.H,{focalPx:guess,source:"estimated"},a.image);
  const f=rep?.impliedFocalPx;
  if(f&&f>0.35*Math.max(a.image.width,a.image.height)&&f<4*Math.max(a.image.width,a.image.height)) return {focalPx:f,basis:"implied-by-geometry"};
  return {focalPx:guess,basis:"assumed-default"};
}

export function validateAnnotationShape(a:RoomAnnotation):AnnotationIssue[]{
  const out:AnnotationIssue[]=[];const add=(code:string,detail?:string)=>out.push({code,detail});
  if(!a||a.schemaVersion!==1) return [{code:"ANNOTATION_SCHEMA_VERSION"}];
  if(!(a.image?.width>0&&a.image?.height>0)) add("ANNOTATION_IMAGE_SIZE");
  if(!a.references?.length) add("ANNOTATION_NO_REFERENCE","mark at least one rectangle of known size on the wall plane");
  const inImg=(p:Pt)=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&p.x>=0&&p.y>=0&&p.x<=a.image.width&&p.y<=a.image.height;
  for(const r of a.references ?? []){
    if(!(r.widthCm>=5&&r.widthCm<=600&&r.heightCm>=5&&r.heightCm<=600)) add("ANNOTATION_REFERENCE_SIZE",r.label);
    if(!Array.isArray(r.corners)||r.corners.length!==4||!r.corners.every(inImg)) add("ANNOTATION_REFERENCE_CORNERS",r.label);
  }
  for(const q of [...(a.wallPolygons ?? []),...(a.excludePolygons ?? [])]) if(q.length<3||!q.every(inImg)) add("ANNOTATION_POLYGON_INVALID");
  if(!a.wallPolygons?.length) add("ANNOTATION_NO_WALL_POLYGON");
  const g=a.region;
  if(!g||!(g.widthCm>=60&&g.heightCm>=80)) add("ANNOTATION_REGION_TOO_SMALL","the safe region must fit an 80x60 cm frame");
  if(!a.scale?.basis?.trim()) add("ANNOTATION_SCALE_BASIS_MISSING");
  return out;
}

/** Convert an annotation into a V3 room definition. AI rooms can only ever be "estimated" scale. */
export function annotationToRoom(a:RoomAnnotation,o:{id:string;imageKey:string;commercialUse:boolean;rightsNotes:string}):RoomDefinition{
  const f=a.focalPx ?? suggestFocal(a).focalPx;
  return {
    schemaVersion:ROOM_SCHEMA_VERSION,id:o.id,
    image:{key:o.imageKey,width:a.image.width,height:a.image.height,origin:"ai-generated"},
    rights:{approved:true,commercialUse:o.commercialUse,notes:o.rightsNotes},
    wall:{controlPoints:controlPointsFrom(a)},
    scale:{method:"ai-estimate",basis:a.scale.basis,confidence:a.scale.confidence,relativeUncertainty:Math.max(0.05,a.scale.relativeUncertainty)},
    camera:{focalPx:f,source:"estimated"},
    region:{id:"main",...a.region},
    light:{calibrated:true,...a.light},
    shadowMask:{wallPolygons:a.wallPolygons,excludePolygons:a.excludePolygons.length?a.excludePolygons:undefined}
  };
}

export type ImportMeta={
  id:string;
  roomImage:string;artworkImage:string;
  generator:string;generatedOn:string;licence:string;
  rightsCleared:boolean;emptyWallConfirmed:boolean;
  artworkLicence:string;
  frame:PackManifest["frame"];
};

export function buildPackManifest(a:RoomAnnotation,m:ImportMeta):PackManifest{
  return {
    schemaVersion:1,id:m.id,roomImage:m.roomImage,artworkImage:m.artworkImage,
    room:annotationToRoom(a,{id:m.id+"-room",imageKey:m.roomImage,commercialUse:m.rightsCleared,rightsNotes:m.licence}),
    provenance:{kind:"ai-generated",generator:m.generator,generatedOn:m.generatedOn,rightsCleared:m.rightsCleared,licence:m.licence,emptyWallConfirmed:m.emptyWallConfirmed},
    artwork:{origin:"sample",customer:false,licence:m.artworkLicence},
    frame:m.frame
  };
}

/** Live feedback for the tool: room validation issues plus the calibration numbers and the projected safe region. */
export function analyseAnnotation(a:RoomAnnotation){
  const shape=validateAnnotationShape(a);
  if(shape.length) return {shape,issues:[] as {code:string;detail?:string}[],rmsPx:null as number|null,maxPx:null as number|null,focal:null as ReturnType<typeof suggestFocal>|null,regionPx:[] as Pt[]};
  const room=annotationToRoom(a,{id:"annotation-check",imageKey:"check.png",commercialUse:true,rightsNotes:"check"});
  const an=analyseRoom(room);
  const H=an.fit?.H;
  const regionPx=H?[[a.region.leftCm,a.region.topCm],[a.region.leftCm+a.region.widthCm,a.region.topCm],[a.region.leftCm+a.region.widthCm,a.region.topCm+a.region.heightCm],[a.region.leftCm,a.region.topCm+a.region.heightCm]].map(([x,y])=>{const w=H[6]*x+H[7]*y+H[8];return {x:(H[0]*x+H[1]*y+H[2])/w,y:(H[3]*x+H[4]*y+H[5])/w};}):[];
  return {shape,issues:an.issues,rmsPx:an.fit?.rmsPx ?? null,maxPx:an.fit?.maxPx ?? null,focal:suggestFocal(a),regionPx};
}
