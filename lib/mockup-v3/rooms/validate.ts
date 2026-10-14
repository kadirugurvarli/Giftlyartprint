import type {Pt} from "../types";
import {convexHull,expandPolygon,fitWall,perspectiveReport,pointInPolygon,polygonArea,lineDeviationDeg,type WallFit} from "./calibration";
import type {RoomDefinition,ScaleConfidence} from "./schema";
import {ROOM_SCHEMA_VERSION} from "./schema";

export type RoomIssue={code:string;detail?:string};

/** Limits are deliberately strict and not meant to be loosened to make a room pass: re-annotate instead. */
export const ROOM_LIMITS={
  minImageSide:800,
  minControlPoints:4,
  maxReprojectionRmsPx:1.5,
  maxReprojectionMaxPx:3,
  /** control-point hull must cover this fraction of the image so the plane is well conditioned */
  minHullAreaFraction:0.04,
  maxAxesAngleDeviationDeg:2.5,
  maxAxesNormDeviation:0.05,
  maxFocalDisagreement:0.15,
  /** implied focal is only trusted when the wall is clearly tilted away from fronto-parallel */
  minTiltForImpliedFocalDeg:8,
  maxAnnotatedLineDeviationDeg:1.5,
  /** the calibrated area is the control-point hull grown by this factor */
  calibratedAreaGrowth:1.15,
  focalRangeOfImageSide:[0.35,4] as [number,number],
  principalPointMaxOffset:0.2,
  confidenceMaxUncertainty:{measured:0.03,high:0.06,medium:0.15,low:0.35} as Record<ScaleConfidence,number>
};

export type RoomAnalysis={
  issues:RoomIssue[];
  fit:WallFit|null;
  /** convex hull of the control points on the wall plane, cm */
  calibratedHullCm:Pt[];
  report:ReturnType<typeof perspectiveReport>;
};

const finitePt=(p:Pt)=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);

export function analyseRoom(room:RoomDefinition):RoomAnalysis{
  const L=ROOM_LIMITS;
  const issues:RoomIssue[]=[];
  const add=(code:string,detail?:string)=>issues.push({code,detail});
  const none:RoomAnalysis={issues,fit:null,calibratedHullCm:[],report:null};

  if(room.schemaVersion!==ROOM_SCHEMA_VERSION) add("UNSUPPORTED_SCHEMA_VERSION",String(room.schemaVersion));
  if(!/^[a-z0-9][a-z0-9-]*$/.test(room.id)) add("INVALID_ROOM_ID");
  const {width:W,height:H}=room.image;
  if(!room.image.key||!Number.isInteger(W)||!Number.isInteger(H)||W<L.minImageSide||H<L.minImageSide*0.75) add("INVALID_IMAGE");
  if(!room.rights.approved||!room.rights.commercialUse) add("ROOM_RIGHTS_NOT_APPROVED");
  if(issues.some(i=>i.code==="INVALID_IMAGE")) return none;

  // ---- scale: an estimate with a confidence, never a claim of physical measurement for AI rooms
  const s=room.scale;
  if(!s||!s.basis?.trim()||!["measured-reference","known-object","assumed-object","ai-estimate"].includes(s.method)||!["measured","high","medium","low"].includes(s.confidence)||!Number.isFinite(s.relativeUncertainty)||s.relativeUncertainty<=0||s.relativeUncertainty>0.5) add("INVALID_SCALE");
  else{
    if(s.relativeUncertainty>L.confidenceMaxUncertainty[s.confidence]) add("SCALE_CONFIDENCE_INCONSISTENT",`${s.confidence} allows at most ±${L.confidenceMaxUncertainty[s.confidence]*100}%`);
    if(room.image.origin==="ai-generated"&&(s.method==="measured-reference"||s.method==="known-object"||s.confidence==="measured"||s.confidence==="high"||s.relativeUncertainty<0.05)) add("AI_ROOM_SCALE_CANNOT_BE_MEASURED","an AI-generated room has no true geometry; record an estimate (medium/low, at least ±5 %)");
    if((s.method==="measured-reference"||s.confidence==="measured")&&(!s.verifiedBy||!s.verifiedAt)) add("SCALE_VERIFICATION_MISSING");
  }

  // ---- camera
  const c=room.camera;
  const side=Math.max(W,H);
  if(!c||!Number.isFinite(c.focalPx)||c.focalPx<L.focalRangeOfImageSide[0]*side||c.focalPx>L.focalRangeOfImageSide[1]*side||!["exif","solved","estimated"].includes(c.source)) add("INVALID_CAMERA_FOCAL");
  if(c?.principalPoint&&(!finitePt(c.principalPoint)||Math.abs(c.principalPoint.x-W/2)>L.principalPointMaxOffset*W||Math.abs(c.principalPoint.y-H/2)>L.principalPointMaxOffset*H)) add("INVALID_PRINCIPAL_POINT");

  // ---- control points (cropped or partially visible walls are fine: any visible, measured points will do)
  const cps=room.wall?.controlPoints ?? [];
  if(cps.length<L.minControlPoints) add("CONTROL_POINTS_INSUFFICIENT");
  else if(!cps.every(p=>finitePt(p.image)&&finitePt(p.wallCm))) add("CONTROL_POINTS_INVALID");
  else{
    if(cps.some(p=>p.image.x<0||p.image.y<0||p.image.x>W||p.image.y>H)) add("CONTROL_POINT_OUTSIDE_IMAGE");
    const hullImg=convexHull(cps.map(p=>p.image)),hullCm=convexHull(cps.map(p=>p.wallCm));
    if(hullImg.length<3||polygonArea(hullImg)<1||hullCm.length<3||polygonArea(hullCm)<1) add("CONTROL_POINTS_COLLINEAR");
    else if(polygonArea(hullImg)<L.minHullAreaFraction*W*H) add("CONTROL_POINTS_CLUSTERED");
  }
  const blocking=issues.filter(i=>["CONTROL_POINTS_INSUFFICIENT","CONTROL_POINTS_INVALID","CONTROL_POINTS_COLLINEAR","INVALID_CAMERA_FOCAL"].includes(i.code));
  if(blocking.length) return {...none};

  const fit=fitWall(cps);
  if(!fit){add("INVALID_WALL_GEOMETRY");return none;}
  if(fit.rmsPx>L.maxReprojectionRmsPx||fit.maxPx>L.maxReprojectionMaxPx) add("CALIBRATION_RESIDUAL_TOO_HIGH",`rms ${fit.rmsPx.toFixed(2)} px, max ${fit.maxPx.toFixed(2)} px`);
  const hullCm=convexHull(cps.map(p=>p.wallCm));

  // ---- perspective consistency: focal length, wall plane and annotated lines must agree
  const rep=perspectiveReport(fit.H,c,room.image);
  if(!rep) add("INVALID_WALL_GEOMETRY");
  else{
    if(Math.abs(rep.axesAngleDeg-90)>L.maxAxesAngleDeviationDeg||Math.abs(rep.axesNormRatio-1)>L.maxAxesNormDeviation)
      add("PERSPECTIVE_INCONSISTENT",`axes ${rep.axesAngleDeg.toFixed(1)}° (want 90°), isotropy ${rep.axesNormRatio.toFixed(3)} (want 1)`);
    if(rep.impliedFocalPx!==null&&rep.wallTiltDeg>=L.minTiltForImpliedFocalDeg&&Math.abs(rep.impliedFocalPx/c.focalPx-1)>L.maxFocalDisagreement)
      add("FOCAL_INCONSISTENT_WITH_WALL",`stated ${c.focalPx.toFixed(0)} px, the wall implies ${rep.impliedFocalPx.toFixed(0)} px`);
  }
  for(const ln of room.perspective?.lines ?? []){
    const d=lineDeviationDeg(fit,ln.kind,ln.a,ln.b);
    if(d===null||d>L.maxAnnotatedLineDeviationDeg) add("ANNOTATED_LINE_INCONSISTENT",`${ln.label ?? ln.kind}: ${d===null?"n/a":d.toFixed(2)}°`);
  }

  // ---- region must lie in the calibrated area (extrapolating far beyond the control points amplifies error)
  const r=room.region;
  if(![r.leftCm,r.topCm,r.widthCm,r.heightCm].every(Number.isFinite)||r.widthCm<=0||r.heightCm<=0) add("INVALID_REGION");
  else{
    const area=expandPolygon(hullCm,L.calibratedAreaGrowth);
    const corners=[{x:r.leftCm,y:r.topCm},{x:r.leftCm+r.widthCm,y:r.topCm},{x:r.leftCm+r.widthCm,y:r.topCm+r.heightCm},{x:r.leftCm,y:r.topCm+r.heightCm}];
    if(!corners.every(p=>pointInPolygon(p,area))) add("REGION_OUTSIDE_CALIBRATED_AREA");
    const ce=room.centre;
    if(ce&&(!Number.isFinite(ce.xCm)||!Number.isFinite(ce.yCm)||ce.xCm<r.leftCm||ce.xCm>r.leftCm+r.widthCm||ce.yCm<r.topCm||ce.yCm>r.topCm+r.heightCm)) add("CENTRE_OUTSIDE_REGION");
  }

  // ---- light and shadow mask
  const l=room.light;
  if(!l||!l.calibrated) add("LIGHT_NOT_CALIBRATED");
  else if(![l.shadowDirectionDeg,l.intensity,l.softnessCm,l.colourTempK].every(Number.isFinite)||l.intensity<0||l.intensity>0.6||l.softnessCm<0.1||l.softnessCm>10||l.colourTempK<2000||l.colourTempK>12000) add("INVALID_LIGHT");
  const sm=room.shadowMask;
  if(!sm||!sm.wallPolygons?.length) add("SHADOW_MASK_MISSING");
  else{
    const polys=[...sm.wallPolygons,...(sm.excludePolygons ?? [])];
    if(polys.some(poly=>poly.length<3||!poly.every(p=>finitePt(p)&&p.x>=0&&p.y>=0&&p.x<=W&&p.y<=H))) add("INVALID_SHADOW_MASK");
  }
  return {issues,fit,calibratedHullCm:hullCm,report:rep};
}

export function validateRoomIssues(room:RoomDefinition):RoomIssue[]{return analyseRoom(room).issues;}
/** Error codes only (stable strings for callers and tests). */
export function validateRoom(room:RoomDefinition):string[]{return [...new Set(analyseRoom(room).issues.map(i=>i.code))];}
