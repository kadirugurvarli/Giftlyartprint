import {describe,expect,it} from "vitest";
import {roomManualPlacement,roomPlacement} from "@/lib/mockup-v3/rooms/placement";
import {analyseRoom,validateRoom} from "@/lib/mockup-v3/rooms/validate";
import {allowedFrameSize,type RoomDefinition} from "@/lib/mockup-v3/rooms/schema";
import {ROOM_FOCAL,ROOM_H,ROOM_W,syntheticRoom} from "../helpers/rooms";

const base=()=>syntheticRoom().room;
const edit=(f:(r:RoomDefinition)=>void,room=base())=>{const r=structuredClone(room);f(r);return r;};
const codes=(r:RoomDefinition)=>validateRoom(r);

describe("a calibrated room passes",()=>{
  it("synthetic measured room and annotation noise up to ~0.6 px",()=>{
    expect(codes(base())).toEqual([]);
    expect(codes(syntheticRoom({jitterPx:0.6}).room)).toEqual([]);
  });
  it("uniform annotation noise whose RMS (not max) exceeds 1.5 px is rejected",()=>{
    expect(codes(syntheticRoom({jitterPx:3}).room)).toContain("CALIBRATION_RESIDUAL_TOO_HIGH");
  });
  it("an AI-generated room is accepted ONLY as an estimate, and is labelled illustrative",()=>{
    const ai=syntheticRoom({origin:"ai-generated"}).room;
    expect(codes(ai)).toEqual([]);
    const p=roomPlacement(ai,{width:40,height:50});
    expect(p.ok).toBe(true);if(!p.ok) return;
    expect(p.physicalAccuracy).toBe("illustrative");
    expect(p.scaleDisclosure).toMatch(/Illustrative scale/);expect(p.scaleDisclosure).toMatch(/Not a physical measurement/);
    expect(p.widthRangeCm[0]).toBeCloseTo(36,5);expect(p.widthRangeCm[1]).toBeCloseTo(44,5);
    expect(roomPlacement(ai,{width:40,height:50},{requirePhysicalAccuracy:true})).toEqual({ok:false,error:"SCALE_NOT_PHYSICALLY_MEASURED"});
    const m=roomPlacement(base(),{width:40,height:50},{requirePhysicalAccuracy:true});
    expect(m.ok&&m.physicalAccuracy).toBe("measured");
  });
});

describe("failure conditions are rejected, not corrected",()=>{
  it.each([
    ["wrong schema version",(r:any)=>{r.schemaVersion=1;},"UNSUPPORTED_SCHEMA_VERSION"],
    ["bad room id",(r:any)=>{r.id="Bad ID!";},"INVALID_ROOM_ID"],
    ["image too small",(r:any)=>{r.image.width=640;r.image.height=480;},"INVALID_IMAGE"],
    ["rights not approved",(r:any)=>{r.rights.approved=false;},"ROOM_RIGHTS_NOT_APPROVED"],
    ["no commercial clearance",(r:any)=>{r.rights.commercialUse=false;},"ROOM_RIGHTS_NOT_APPROVED"],
    ["scale basis missing",(r:any)=>{r.scale.basis="";},"INVALID_SCALE"],
    ["scale uncertainty absent",(r:any)=>{r.scale.relativeUncertainty=NaN;},"INVALID_SCALE"],
    ["confidence claims more than the uncertainty allows",(r:any)=>{r.scale.confidence="high";r.scale.relativeUncertainty=0.2;},"SCALE_CONFIDENCE_INCONSISTENT"],
    ["measured but never verified",(r:any)=>{r.scale.verifiedBy=undefined;},"SCALE_VERIFICATION_MISSING"],
    ["focal length absurd (tiny)",(r:any)=>{r.camera.focalPx=100;},"INVALID_CAMERA_FOCAL"],
    ["focal length absurd (huge)",(r:any)=>{r.camera.focalPx=20000;},"INVALID_CAMERA_FOCAL"],
    ["focal length missing",(r:any)=>{r.camera.focalPx=undefined;},"INVALID_CAMERA_FOCAL"],
    ["principal point far off centre",(r:any)=>{r.camera.principalPoint={x:100,y:100};},"INVALID_PRINCIPAL_POINT"],
    ["only three control points",(r:any)=>{r.wall.controlPoints=r.wall.controlPoints.slice(0,3);},"CONTROL_POINTS_INSUFFICIENT"],
    ["control point outside the picture",(r:any)=>{r.wall.controlPoints[0].image.x=-5;},"CONTROL_POINT_OUTSIDE_IMAGE"],
    ["non-finite control point",(r:any)=>{r.wall.controlPoints[2].wallCm.x=NaN;},"CONTROL_POINTS_INVALID"],
    ["collinear control points",(r:any)=>{r.wall.controlPoints=[0,1,2,3,4].map((i:number)=>({image:{x:100+i*200,y:300+i*100},wallCm:{x:i*40,y:i*20}}));},"CONTROL_POINTS_COLLINEAR"],
    ["control points huddled in a corner",(r:any)=>{r.wall.controlPoints=r.wall.controlPoints.map((p:any)=>({...p,image:{x:300+(p.image.x-300)*0.02,y:300+(p.image.y-300)*0.02}}));},"CONTROL_POINTS_CLUSTERED"],
    ["one control point mis-clicked by 9 px",(r:any)=>{r.wall.controlPoints[4].image.x+=9;},"CALIBRATION_RESIDUAL_TOO_HIGH"],
    ["wall cm anisotropic (x stretched 30 %)",(r:any)=>{for(const p of r.wall.controlPoints) p.wallCm.x*=1.3;},"PERSPECTIVE_INCONSISTENT"],
    ["region outside the calibrated area",(r:any)=>{r.region={id:"x",leftCm:150,topCm:10,widthCm:170,heightCm:150};},"REGION_OUTSIDE_CALIBRATED_AREA"],
    ["region of zero size",(r:any)=>{r.region.widthCm=0;},"INVALID_REGION"],
    ["centre outside the region",(r:any)=>{r.centre={xCm:5,yCm:5};},"CENTRE_OUTSIDE_REGION"],
    ["light not calibrated",(r:any)=>{r.light.calibrated=false;},"LIGHT_NOT_CALIBRATED"],
    ["light intensity absurd",(r:any)=>{r.light.intensity=0.9;},"INVALID_LIGHT"],
    ["light temperature absurd",(r:any)=>{r.light.colourTempK=500;},"INVALID_LIGHT"],
    ["softness absurd",(r:any)=>{r.light.softnessCm=50;},"INVALID_LIGHT"],
    ["shadow mask missing",(r:any)=>{r.shadowMask=undefined;},"SHADOW_MASK_MISSING"],
    ["shadow mask polygon degenerate",(r:any)=>{r.shadowMask.wallPolygons=[[{x:1,y:1},{x:2,y:2}]];},"INVALID_SHADOW_MASK"],
    ["shadow mask polygon outside the picture",(r:any)=>{r.shadowMask.wallPolygons[0][0]={x:-50,y:-50};},"INVALID_SHADOW_MASK"]
  ])("%s -> %s",(_n,mut,code)=>{
    expect(codes(edit(mut as any))).toContain(code);
    const p=roomPlacement(edit(mut as any),{width:40,height:50});
    expect(p.ok).toBe(false);if(!p.ok) expect(p.error).toContain(code);
  });
  it("an AI room cannot claim a measured, high-confidence or tight scale",()=>{
    const ai=syntheticRoom({origin:"ai-generated"}).room;
    for(const mut of [
      (r:RoomDefinition)=>{r.scale={...r.scale,method:"measured-reference",confidence:"measured",relativeUncertainty:0.02,verifiedBy:"x",verifiedAt:"y"};},
      (r:RoomDefinition)=>{r.scale={...r.scale,method:"known-object",confidence:"high",relativeUncertainty:0.05};},
      (r:RoomDefinition)=>{r.scale={...r.scale,confidence:"medium",relativeUncertainty:0.03};}
    ]) expect(codes(edit(mut,ai))).toContain("AI_ROOM_SCALE_CANNOT_BE_MEASURED");
  });
  it("a wrong focal length is caught from the wall itself when the camera is pitched",()=>{
    const s=syntheticRoom({pitchDeg:7});
    expect(codes(s.room)).toEqual([]);
    const wrong=edit(r=>{r.camera.focalPx=ROOM_FOCAL*1.5;},s.room);
    const c=codes(wrong);
    expect(c.some(x=>x==="FOCAL_INCONSISTENT_WITH_WALL"||x==="PERSPECTIVE_INCONSISTENT")).toBe(true);
  });
  it("annotated lines must agree with the wall plane (skirting / ceiling / door-frame verticals)",()=>{
    const s=syntheticRoom();
    const horizontal=(a:number,b:number,yCm:number)=>({kind:"horizontal" as const,a:s.truth(a,yCm),b:s.truth(b,yCm),label:"skirting"});
    const vertical=(x:number,a:number,b:number)=>({kind:"vertical" as const,a:s.truth(x,a),b:s.truth(x,b),label:"door frame"});
    expect(codes(edit(r=>{r.perspective={lines:[horizontal(0,210,170),vertical(105,0,170)]};},s.room))).toEqual([]);
    const a=s.truth(0,170),b=s.truth(210,170);
    const tilted={kind:"horizontal" as const,a,b:{x:b.x,y:b.y+Math.tan(5*Math.PI/180)*(b.x-a.x)},label:"AI skirting"};
    expect(codes(edit(r=>{r.perspective={lines:[tilted]};},s.room))).toContain("ANNOTATED_LINE_INCONSISTENT");
  });
});

describe("placement failures",()=>{
  const s=syntheticRoom();
  it.each([
    [{width:90,height:120}],[{width:31,height:41}],[{width:25,height:35}],[{width:70,height:90}],[{width:30,height:30}],[{width:60,height:81}],[{width:0,height:0}]
  ])("%j is outside the approved 30x40 - 60x80 set",(size)=>{
    expect(allowedFrameSize(size)).toBe(false);
    expect(roomPlacement(s.room,size)).toEqual({ok:false,error:"FRAME_SIZE_OUT_OF_RANGE"});
  });
  it("a frame larger than the placement region is refused",()=>{
    const r=edit(x=>{x.region={id:"narrow",leftCm:80,topCm:30,widthCm:50,heightCm:70};},s.room);
    expect(roomPlacement(r,{width:60,height:80})).toEqual({ok:false,error:"ART_TOO_LARGE_FOR_REGION"});
    expect(roomPlacement(r,{width:30,height:40}).ok).toBe(true);
  });
  it("a frame that would hang over furniture (outside the wall mask) is refused",()=>{
    const c=s.truth(105,85);
    const r=edit(x=>{x.shadowMask!.excludePolygons=[[{x:c.x-40,y:c.y-40},{x:c.x+40,y:c.y-40},{x:c.x+40,y:c.y+40},{x:c.x-40,y:c.y+40}]];},s.room);
    expect(roomPlacement(r,{width:40,height:50})).toEqual({ok:false,error:"FRAME_NOT_ON_WALL_MASK"});
  });
  it("a frame running out of the picture is refused",()=>{
    // control points reach the right-hand image edge; the region may extend 15 % beyond them
    let lo=100,hi=400;for(let i=0;i<40;i++){const m=(lo+hi)/2;(s.truth(m,85).x<ROOM_W-8?lo=m:hi=m);}
    const xm=lo;
    const pts=[] as RoomDefinition["wall"]["controlPoints"];
    for(const yCm of [0,85,170]) for(const xCm of [0,xm/2,xm]) pts.push({image:s.truth(xCm,yCm),wallCm:{x:xCm,y:yCm}});
    const r=edit(x=>{x.wall.controlPoints=pts;x.region={id:"edge",leftCm:xm-60,topCm:10,widthCm:xm*0.1+60,heightCm:150};x.centre={xCm:xm+xm*0.08-20,yCm:85};
      x.shadowMask!.wallPolygons=[[{x:0,y:0},{x:ROOM_W,y:0},{x:ROOM_W,y:ROOM_H},{x:0,y:ROOM_H}]];x.shadowMask!.excludePolygons=undefined;},s.room);
    const p=roomPlacement(r,{width:60,height:80});
    expect(p.ok).toBe(false);
    if(!p.ok) expect(["FRAME_OUTSIDE_IMAGE","REGION_OUTSIDE_CALIBRATED_AREA","ART_TOO_LARGE_FOR_REGION"]).toContain(p.error.split(",")[0]);
  });
  it("roomManualPlacement hands the engine the quad, focal length, light, exact width and aspect",()=>{
    const p=roomManualPlacement(s.room,{width:30,height:40},{frameDepthCm:3});
    expect(p.ok).toBe(true);if(!p.ok) return;
    expect(p.options.physicalWidthM).toBe(0.3);expect(p.options.pieceAspect).toBe(0.75);
    expect(p.options.referenceFocalPx).toBe(ROOM_FOCAL);
    expect(p.options.realism.frameDepthM).toBeCloseTo(0.03,10);
    const lo=p.options.realism.lightOverride!;
    expect(Math.hypot(lo.shadowDir.x,lo.shadowDir.y)).toBeCloseTo(1,10);
    expect(lo.intensity).toBe(0.28);expect(lo.colourTempK).toBe(3200);
    expect(lo.softnessPx).toBeCloseTo(1.2*p.placement.pxPerCm,6);
    expect(p.manual.targetQuad).toHaveLength(4);
  });
  it("analyseRoom exposes the evidence (residual, perspective, hull) for review",()=>{
    const a=analyseRoom(s.room);
    expect(a.fit!.rmsPx).toBeLessThan(0.01);expect(a.report!.axesNormRatio).toBeCloseTo(1,2);expect(a.calibratedHullCm.length).toBeGreaterThanOrEqual(4);
  });
});
