import {describe,expect,it} from "vitest";
import {clipPolygonToRect,convexHull,fitHomography,fitWall,perspectiveReport,pxPerCmAt} from "@/lib/mockup-v3/rooms/calibration";
import {applyHomography,homographyFromPoints} from "@/lib/mockup-v3/geometry/homography";
import {roomPlacement} from "@/lib/mockup-v3/rooms/placement";
import {ALL_SIZES,ROOM_FOCAL,ROOM_H,ROOM_W,syntheticRoom} from "../helpers/rooms";

describe("calibrated control points (cropped / partially visible walls)",()=>{
  it("the visible wall extends far outside the picture, yet nine visible points pin it down",()=>{
    const s=syntheticRoom();
    // true wall corners lie outside the image: the old 'four corners inside the image' model could not describe this
    const far=s.truth(520,400);
    expect(far.x>ROOM_W||far.y>ROOM_H||far.x<0||far.y<0).toBe(true);
    const fit=fitWall(s.room.wall.controlPoints)!;
    expect(fit.rmsPx).toBeLessThan(1e-6);
    // the fitted plane reproduces a point that was NOT a control point, to well under a pixel
    const probe=applyHomography(fit.H,{x:60,y:40})!,tr=s.truth(60,40);
    expect(Math.hypot(probe.x-tr.x,probe.y-tr.y)).toBeLessThan(0.01);
  });
  it("least-squares fit with N>4 agrees with the exact four-point solution on clean data, and tolerates annotation noise",()=>{
    const s=syntheticRoom();
    const pts=s.room.wall.controlPoints;
    const four=[0,2,8,6].map(i=>pts[i]);
    const H4=homographyFromPoints(four.map(p=>p.wallCm),four.map(p=>p.image))!,Hn=fitHomography(pts.map(p=>p.wallCm),pts.map(p=>p.image))!;
    for(const q of [{x:30,y:20},{x:150,y:120}]){
      const a=applyHomography(H4,q)!,b=applyHomography(Hn,q)!;
      expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(1e-3);
    }
    const noisy=syntheticRoom({jitterPx:0.6});
    const f=fitWall(noisy.room.wall.controlPoints)!;
    expect(f.rmsPx).toBeLessThan(1);expect(f.rmsPx).toBeGreaterThan(0.05);
    const t=applyHomography(f.H,{x:105,y:85})!,tr=noisy.truth(105,85);
    expect(Math.hypot(t.x-tr.x,t.y-tr.y)).toBeLessThan(1.5);
  });
  it("fitHomography rejects too few or degenerate points",()=>{
    expect(fitHomography([{x:0,y:0},{x:1,y:0},{x:1,y:1}],[{x:0,y:0},{x:1,y:0},{x:1,y:1}])).toBeNull();
    const line=[0,1,2,3,4].map(i=>({x:i,y:i}));
    expect(fitHomography(line,line)).toBeNull();
  });
  it("the stated focal length and the wall plane are consistent (axes orthogonal, isotropic) for a true camera",()=>{
    const s=syntheticRoom();
    const fit=fitWall(s.room.wall.controlPoints)!;
    const rep=perspectiveReport(fit.H,s.room.camera,s.room.image)!;
    expect(Math.abs(rep.axesAngleDeg-90)).toBeLessThan(0.3);
    expect(Math.abs(rep.axesNormRatio-1)).toBeLessThan(0.01);
    expect(rep.wallTiltDeg).toBeGreaterThan(8);
    // level camera: the vertical vanishing point is at infinity, so the focal length is unobservable and not claimed
    expect(rep.impliedFocalPx).toBeNull();
  });
  it("with a pitched camera the wall itself implies the focal length, and it matches the stated one",()=>{
    const s=syntheticRoom({pitchDeg:7});
    const fit=fitWall(s.room.wall.controlPoints)!;
    const rep=perspectiveReport(fit.H,s.room.camera,s.room.image)!;
    expect(rep.impliedFocalPx).not.toBeNull();
    expect(Math.abs(rep.impliedFocalPx!/ROOM_FOCAL-1)).toBeLessThan(0.03);
    expect(Math.abs(rep.axesAngleDeg-90)).toBeLessThan(0.3);
  });
  it("polygon helpers: hull, clip",()=>{
    expect(convexHull([{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2},{x:1,y:1}]).length).toBe(4);
    const c=clipPolygonToRect([{x:-10,y:-10},{x:50,y:-10},{x:50,y:50},{x:-10,y:50}],20,20);
    expect(c.every(p=>p.x>=0&&p.x<=20&&p.y>=0&&p.y<=20)).toBe(true);
  });
});

describe("all eight outer frame sizes (30x40 ... 60x80 and their landscape rotations)",()=>{
  const s=syntheticRoom();
  it.each(ALL_SIZES.map(z=>[`${z.width}x${z.height}`,z]))("%s: exact physical size, centred, perspective-correct",(_n,z:any)=>{
    const p=roomPlacement(s.room,z);
    expect(p.ok).toBe(true);if(!p.ok) return;
    const c=p.centreCm;
    const want=[{x:c.x-z.width/2,y:c.y-z.height/2},{x:c.x+z.width/2,y:c.y-z.height/2},{x:c.x+z.width/2,y:c.y+z.height/2},{x:c.x-z.width/2,y:c.y+z.height/2}].map(q=>s.truth(q.x,q.y));
    p.targetQuad.forEach((q,i)=>expect(Math.hypot(q.x-want[i].x,q.y-want[i].y)).toBeLessThan(0.01));
    // invert through the calibrated plane: the quad measures exactly the requested centimetres
    const fit=fitWall(s.room.wall.controlPoints)!;
    const back=p.targetQuad.map(q=>applyHomography(fit.Hinv,q)!);
    expect(Math.hypot(back[1].x-back[0].x,back[1].y-back[0].y)).toBeCloseTo(z.width,3);
    expect(Math.hypot(back[3].x-back[0].x,back[3].y-back[0].y)).toBeCloseTo(z.height,3);
    expect(p.targetQuad.every(q=>q.x>=0&&q.y>=0&&q.x<=ROOM_W&&q.y<=ROOM_H)).toBe(true);
    // perspective: the wall recedes to the right (yaw), so the right edge is shorter than the left
    const left=Math.hypot(p.targetQuad[3].x-p.targetQuad[0].x,p.targetQuad[3].y-p.targetQuad[0].y);
    const right=Math.hypot(p.targetQuad[2].x-p.targetQuad[1].x,p.targetQuad[2].y-p.targetQuad[1].y);
    expect(Math.abs(left-right)/left).toBeGreaterThan(0.01);
  });
  it("larger frames are larger on screen in proportion to their centimetres",()=>{
    const a=roomPlacement(s.room,{width:30,height:40}),b=roomPlacement(s.room,{width:60,height:80});
    if(!a.ok||!b.ok) throw new Error("placement");
    const w=(q:typeof a.targetQuad)=>Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y);
    expect(w(b.targetQuad)/w(a.targetQuad)).toBeGreaterThan(1.9);expect(w(b.targetQuad)/w(a.targetQuad)).toBeLessThan(2.1);
    expect(pxPerCmAt(fitWall(s.room.wall.controlPoints)!.H,{x:105,y:85})).toBeGreaterThan(2);
  });
});
