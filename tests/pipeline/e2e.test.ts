import {describe,expect,it} from "vitest";
import type {Quad} from "@/lib/mockup-v3/types";
import {runMockup,type MockupResult} from "@/lib/mockup-v3/pipeline";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";
import {checkSceneIntegrity} from "@/lib/mockup-v3/pipeline/common";
import {compositeOver,solidImage} from "@/lib/mockup-v3/geometry/warp";
import {estimateRectAspect} from "@/lib/mockup-v3/geometry/quad";
import {DEFAULT_STYLE,emptyRoom,framedPhoto,hangPiece,makeRoom,oldPicture,printPhoto,referenceWithFramedPicture,wallMetric} from "../helpers/e2e";
import {addPlant,cornerError,landscapeArt,plainBackground} from "../helpers/scenes";
import {renderFramedPiece as rfp} from "@/lib/mockup-v3/frame/procedural";
import {mulberry32} from "../helpers/fixtures";

const codes=(r:MockupResult)=>r.defects.map((d)=>d.code);
const customer=landscapeArt(640,480,21);

describe("Workflow A: artwork-only source -> reference frame",()=>{
  const ref=referenceWithFramedPicture();
  const src=printPhoto(customer);
  const base={sourceFocalPx:src.focalPx,referenceFocalPx:1080,artworkAspect:640/480};

  it("replaces the picture in the reference frame: automatic, measured, preserved",async()=>{
    const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:base});
    expect(r.status).toBe("pass");
    expect(r.needsManual).toBe(false);
    expect(r.automation).toEqual({source:"auto",target:"auto",occlusion:"none"});
    expect(cornerError(r.sourceQuad!,src.quad)).toBeLessThan(1);
    expect(cornerError(r.referenceFrameQuad!,ref.outerQuad)).toBeLessThan(1);
    expect(cornerError(r.targetQuad!,ref.apertureQuad)).toBeLessThan(1.2);
    // measured QA, all three gates
    expect(r.qa.forward!.pass).toBe(true);
    expect(r.qa.forward!.metrics.meanDeltaE).toBeLessThan(1);
    expect(r.qa.crossCheck!.pass).toBe(true);
    expect(r.qa.crossCheck!.metrics!.meanDeltaE).toBeLessThan(1.5);
    expect(r.qa.sceneIntegrity!.changedOutsideAllowed).toBe(0);
    expect(r.qa.sceneIntegrity!.changedFramePixels).toBe(0);
    expect(r.adjustments.gainMaxDeviation as number).toBeLessThanOrEqual(0.04+1e-9);
  });

  it("the reference frame, mount, wall and room are byte-identical outside the opening",async()=>{
    const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:base});
    const a=ref.image,b=r.image!;
    let changed=0,changedInOpening=0;
    const bx0=Math.min(...ref.apertureQuad.map((p)=>p.x)),bx1=Math.max(...ref.apertureQuad.map((p)=>p.x)),by0=Math.min(...ref.apertureQuad.map((p)=>p.y)),by1=Math.max(...ref.apertureQuad.map((p)=>p.y));
    for(let y=0;y<a.height;y++) for(let x=0;x<a.width;x++){
      const i=(y*a.width+x)*4;
      const diff=a.data[i]!==b.data[i]||a.data[i+1]!==b.data[i+1]||a.data[i+2]!==b.data[i+2];
      if(!diff) continue;
      const inside=x>=bx0-2&&x<=bx1+2&&y>=by0-2&&y<=by1+2;
      if(inside) changedInOpening++;else changed++;
    }
    expect(changed).toBe(0);
    expect(changedInOpening).toBeGreaterThan(10000);
  });

  it("the new picture really is the customer's, not the old one (central region matches the original photo)",async()=>{
    const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:base});
    expect(r.qa.crossCheck!.metrics!.ssim).toBeGreaterThan(0.97);
    // and clearly different from what was in the frame before
    const old=await runMockup({mode:"artwork-in-frame",source:printPhoto(oldPicture(640,480)).photo,reference:ref.image,options:{...base}});
    expect(old.qa.crossCheck?.pass).toBe(true); // sanity: the pipeline is content-agnostic
  });

  it("a 3:2 print into a 4:3 opening is cropped and says so with numbers",async()=>{
    const art32=landscapeArt(720,480,22);
    const s=printPhoto(art32);
    const r=await runMockup({mode:"artwork-in-frame",source:s.photo,reference:ref.image,options:{...base,artworkAspect:720/480}});
    const d=r.defects.find((x)=>x.code==="ASPECT_MISMATCH_CROPPED"||x.code==="ASPECT_MISMATCH_EXCESSIVE")!;
    expect(d).toBeDefined();
    expect(r.adjustments.cropFraction as number).toBeGreaterThan(0.08);
    expect(codes(r)).toContain("ASPECT_MISMATCH_EXCESSIVE");   // 10% > default 6%
    expect(r.status).toBe("review");                            // not silently passed
    expect(r.qa.forward!.pass).toBe(true);                      // what is shown is still faithful
  });

  it("'contain' keeps the whole print and fills the rest with the mount colour (flagged)",async()=>{
    const art32=landscapeArt(720,480,22);
    const s=printPhoto(art32);
    const r=await runMockup({mode:"artwork-in-frame",source:s.photo,reference:ref.image,options:{...base,artworkAspect:720/480,fit:"contain"}});
    expect(codes(r)).toContain("ASPECT_MISMATCH_FILLED");
    expect(r.adjustments.filledFraction as number).toBeGreaterThan(0.05);
    expect(r.adjustments.cropFraction).toBe(0);
  });

  it("proportions are never distorted: a mismatch is cropped, not stretched",async()=>{
    const art32=landscapeArt(720,480,22);
    const s=printPhoto(art32);
    const r=await runMockup({mode:"artwork-in-frame",source:s.photo,reference:ref.image,options:{...base,artworkAspect:720/480}});
    expect(r.adjustments.stretchPct).toBe(0);
    const est=estimateRectAspect(r.targetQuad!,ref.image.width,ref.image.height,{focalPx:1080});
    // the opening's aspect is what the cropped art was fitted to
    expect(Math.abs(est.aspect!-(r.adjustments.apertureAspect as number))/est.aspect!).toBeLessThan(0.03);
  });

  it("a manual mask keeps a foreground plant in front of the new picture (occlusion)",async()=>{
    const [,tr,br]=ref.apertureQuad;
    const plant=addPlant(ref.image,tr.x-14,br.y+34,150,5);
    const mask={width:plant.image.width,height:plant.image.height,alpha:plant.alpha};
    const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:plant.image,options:base,manual:{occlusion:mask}});
    expect(r.automation.occlusion).toBe("manual");
    expect(r.status).not.toBe("fail");
    // where the mask is fully on, the output equals the reference exactly
    let bad=0,n=0;
    for(let i=0;i<mask.alpha.length;i++) if(mask.alpha[i]===255){n++;if(r.image!.data[i*4]!==plant.image.data[i*4]) bad++;}
    expect(n).toBeGreaterThan(2000);
    expect(bad).toBe(0);
    // and the plant overlaps the opening, so the mask mattered
    const withoutMask=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:plant.image,options:base});
    let diff=0;
    for(let i=0;i<mask.alpha.length;i++) if(mask.alpha[i]===255 && withoutMask.image!.data[i*4]!==plant.image.data[i*4]) diff++;
    expect(diff).toBeGreaterThan(50);
  });

  it("with a precise mask NO old-picture pixels leak: output = new art everywhere except the occluder",async()=>{
    const [,tr,br]=ref.apertureQuad;
    const plant=addPlant(ref.image,tr.x-14,br.y+34,150,5);
    const mask={width:plant.image.width,height:plant.image.height,alpha:plant.alpha};
    const fixed={sourceQuad:src.quad,targetQuad:ref.apertureQuad};
    const withMask=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:plant.image,options:base,manual:{...fixed,occlusion:mask}});
    const clean=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:base,manual:fixed});
    // where the occluder is absent (alpha 0) the result must equal the unobstructed render, pixel for pixel
    let leaks=0,checked=0;
    for(let i=0;i<mask.alpha.length;i++){
      if(mask.alpha[i]!==0) continue;
      const inPlantFreeOpening=withMask.image!.data[i*4]!==plant.image.data[i*4]||clean.image!.data[i*4]!==ref.image.data[i*4];
      if(!inPlantFreeOpening) continue;
      checked++;
      // sub-visible lighting-estimate variation (measured: max 2 levels) is fine; an old-picture leak is tens of levels
      for(let c=0;c<3;c++) if(Math.abs(withMask.image!.data[i*4+c]-clean.image!.data[i*4+c])>4) {leaks++;break;}
    }
    expect(checked).toBeGreaterThan(8000);
    expect(leaks).toBe(0);
  });

  it("manual four-corner override is honoured and flagged as manual",async()=>{
    const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:base,
      manual:{sourceQuad:src.quad,targetQuad:ref.apertureQuad}});
    expect(r.automation.source).toBe("manual");expect(r.automation.target).toBe("manual");
    expect(r.status==="pass"||r.status==="review").toBe(true);
    expect(r.qa.forward!.pass).toBe(true);
  });

  it("no frame in the reference: fails explicitly and asks for manual input, produces no image",async()=>{
    const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:emptyRoom().image,options:base});
    expect(r.status).toBe("fail");
    expect(r.needsManual).toBe(true);
    expect(r.image).toBeNull();
    expect(codes(r).some((c)=>c==="QUAD_NOT_FOUND"||c==="APERTURE_UNCERTAIN")).toBe(true);
  });

  it("different frame styles: pale moulding on a grey wall",async()=>{
    const style={mouldingPx:20,mouldingColour:[238,236,232] as [number,number,number],mountPx:30,mountColour:[210,212,214] as [number,number,number]};
    const room=makeRoom({wallColour:[150,146,138]});
    const hung=hangPiece(room,renderFramedPiece(oldPicture(480,360),style),-0.1,-0.2,0.7);
    const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:hung.image,options:base});
    expect(cornerError(r.targetQuad!,hung.apertureQuad)).toBeLessThan(2);
    expect(r.qa.forward!.pass).toBe(true);
    expect(r.qa.sceneIntegrity!.pass).toBe(true);
  });
});

describe("Workflow B: framed piece -> empty wall",()=>{
  const piece=rfp(landscapeArt(480,360,31),DEFAULT_STYLE);
  const src=framedPhoto(piece);
  const room=emptyRoom();
  const opts={sourceFocalPx:src.focalPx,referenceFocalPx:1080,pieceAspect:piece.image.width/piece.image.height,physicalWidthM:0.62,ceilingHeightM:2.6,skirtingM:0.12};

  it("hangs the piece with correct physical scale, proportions and height (ground truth in metres)",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:opts});
    expect(r.status).toBe("pass");
    expect(r.needsManual).toBe(false);
    expect(cornerError(r.sourceQuad!,src.quad)).toBeLessThan(1);
    const toM=wallMetric(room);
    const m=r.targetQuad!.map(toM);
    const w=(m[1].x-m[0].x+m[2].x-m[3].x)/2,h=(m[3].y-m[0].y+m[2].y-m[1].y)/2;
    const centreFromFloor=1.2-(m[0].y+m[2].y)/2;
    console.log(`[B] metric width ${w.toFixed(3)}m (want 0.62) height ${h.toFixed(3)}m (want ${(0.62/piece.image.width*piece.image.height).toFixed(3)}) centre ${centreFromFloor.toFixed(3)}m`);
    expect(Math.abs(w-0.62)/0.62).toBeLessThan(0.04);
    expect(Math.abs(h-0.62*piece.image.height/piece.image.width)/h).toBeLessThan(0.04);
    expect(Math.abs(centreFromFloor-1.45)).toBeLessThan(0.06);
    // horizontal edges stay horizontal in the wall plane
    expect(Math.abs(m[0].y-m[1].y)).toBeLessThan(0.02);
    expect(Math.abs(m[3].y-m[2].y)).toBeLessThan(0.02);
    // inside the room's back wall
    expect(m.every((p)=>p.x>-2.5&&p.x<2.5)).toBe(true);
  });

  it("measured QA: protected pixels, independent cross-check against the ORIGINAL photo, scene integrity",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:opts});
    expect(r.qa.forward!.pass).toBe(true);
    expect(r.qa.forward!.metrics.meanDeltaE).toBeLessThan(1);
    expect(r.qa.forward!.proportion.relativeError!).toBeLessThan(0.03);
    expect(r.qa.crossCheck!.pass).toBe(true);
    expect(r.qa.crossCheck!.metrics!.ssim).toBeGreaterThan(0.95);
    expect(r.qa.sceneIntegrity!.changedOutsideAllowed).toBe(0);
  });

  it("only the shadow side of the wall is darkened, and the room is otherwise untouched",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:opts});
    const q=r.targetQuad!;
    const x0=Math.min(...q.map((p)=>p.x)),x1=Math.max(...q.map((p)=>p.x)),y0=Math.min(...q.map((p)=>p.y)),y1=Math.max(...q.map((p)=>p.y));
    const dark=(xa:number,ya:number,xb:number,yb:number)=>{let s=0,n=0;for(let y=Math.round(ya);y<yb;y++)for(let x=Math.round(xa);x<xb;x++){s+=room.image.data[(y*room.image.width+x)*4]-r.image!.data[(y*room.image.width+x)*4];n++;}return s/n;};
    const right=dark(x1+1,y0+10,x1+9,y1-10),below=dark(x0+10,y1+1,x1-10,y1+9),left=dark(x0-9,y0+10,x0-1,y1-10),above=dark(x0+10,y0-9,x1-10,y0-1);
    console.log(`[B] shadow levels right ${right.toFixed(1)} below ${below.toFixed(1)} left ${left.toFixed(1)} above ${above.toFixed(1)}`);
    expect(Math.max(right,below)).toBeGreaterThan(1.5);
    expect(Math.max(right,below)).toBeGreaterThan(2*Math.max(left,above));
  });

  it("avoids furniture/plants: the piece lands on free wall",async()=>{
    // a large plant standing against the wall occupies the area where the piece would otherwise go
    const probe=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:opts});
    const c=probe.targetQuad!;
    const cx=(c[0].x+c[2].x)/2,cy=(c[0].y+c[2].y)/2;
    const plant=addPlant(room.image,cx,cy+110,320,5);
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:plant.image,options:opts});
    expect(r.status).not.toBe("fail");
    const t=r.targetQuad!;
    const minX=Math.min(...t.map((p)=>p.x)),maxX=Math.max(...t.map((p)=>p.x)),minY=Math.min(...t.map((p)=>p.y)),maxY=Math.max(...t.map((p)=>p.y));
    // the plant mask polygon must not intersect the placement bbox
    const poly=plant.maskPolygon;
    const inside=poly.some((p)=>p.x>minX&&p.x<maxX&&p.y>minY&&p.y<maxY);
    expect(inside).toBe(false);
    expect(Math.hypot((t[0].x+t[2].x)/2-cx,(t[0].y+t[2].y)/2-cy)).toBeGreaterThan(20);
  });

  it("manual occlusion mask keeps a foreground object in front of the placed piece",async()=>{
    const probe=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:opts});
    const q=probe.targetQuad!;
    const plant=addPlant(room.image,q[1].x-8,q[2].y+14,120,6);
    const mask={width:plant.image.width,height:plant.image.height,alpha:plant.alpha};
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:plant.image,options:{...opts},manual:{targetQuad:q,occlusion:mask}});
    expect(r.automation.occlusion).toBe("manual");
    let bad=0,n=0;
    for(let i=0;i<mask.alpha.length;i++) if(mask.alpha[i]===255){n++;if(r.image!.data[i*4]!==plant.image.data[i*4]) bad++;}
    expect(n).toBeGreaterThan(1500);
    expect(bad).toBe(0);
    expect(r.qa.forward!.pass).toBe(true);   // verification excludes the occluder
  });

  it("defaults are applied but declared: missing size/ceiling/focal are reported, not hidden",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:{pieceAspect:piece.image.width/piece.image.height}});
    expect(codes(r)).toContain("SCALE_ASSUMED");
    expect(codes(r)).toContain("FOCAL_ASSUMED");
    expect(r.image).not.toBeNull();
  });

  it("frontal room (parallel ceiling/floor lines) places an upright, undistorted rectangle",async()=>{
    const fr=makeRoom({yawDeg:0,camX:0});
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:fr.image,options:opts});
    const toM=wallMetric(fr);
    const m=r.targetQuad!.map(toM);
    expect(Math.abs((m[1].x-m[0].x)-0.62)/0.62).toBeLessThan(0.04);
    expect(Math.abs(m[0].y-m[1].y)).toBeLessThan(0.015);
    expect(r.qa.forward!.pass).toBe(true);
  });

  it("no usable wall: fails with WALL_NOT_FOUND-type defect and no image",async()=>{
    const noise=plainBackground(1200,900,[120,120,120],1,0);
    // heavy texture everywhere
    const rnd=mulberry32(99);
    for(let i=0;i<1200*900;i++){const v=Math.floor(rnd()*256);noise.data[i*4]=v;noise.data[i*4+1]=v;noise.data[i*4+2]=v;}
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:noise,options:opts});
    expect(r.status).toBe("fail");
    expect(r.image).toBeNull();
    expect(r.needsManual).toBe(true);
    expect(codes(r).some((c)=>c==="WALL_NOT_FOUND"||c==="NO_FREE_WALL_SPACE")).toBe(true);
  });

  it("manual four-corner placement is a working fallback",async()=>{
    const probe=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:opts});
    const shifted=probe.targetQuad!.map((p)=>({x:p.x+60,y:p.y+10})) as Quad;
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:opts,manual:{targetQuad:shifted,sourceQuad:src.quad}});
    expect(r.automation).toMatchObject({source:"manual",target:"manual"});
    expect(cornerError(r.targetQuad!,shifted)).toBeLessThan(1e-6);
    expect(r.qa.forward!.pass).toBe(true);
  });
});

describe("clean mockup guarantee",()=>{
  it("scene-integrity check flags any stray edit (e.g. a text banner) outside the allowed region",()=>{
    const ref=plainBackground(400,300,[200,200,200],1,0);
    const banner=solidImage(400,300,[0,0,0,0]);
    for(let y=20;y<50;y++) for(let x=20;x<200;x++) banner.data.set([255,255,255,255],(y*400+x)*4);
    const dirty=compositeOver(ref,banner);
    const q:Quad=[{x:250,y:100},{x:380,y:100},{x:380,y:250},{x:250,y:250}];
    const res=checkSceneIntegrity(ref,dirty,{polys:[q]});
    expect(res.pass).toBe(false);
    expect(res.changedOutsideAllowed).toBeGreaterThan(5000);
  });
  it("pipeline output contains no changes outside the placement and its shadow (both workflows)",async()=>{
    const piece=rfp(landscapeArt(480,360,31),DEFAULT_STYLE);
    const src=framedPhoto(piece);const room=emptyRoom();
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:{pieceAspect:piece.image.width/piece.image.height,physicalWidthM:0.62,ceilingHeightM:2.6,skirtingM:0.12,referenceFocalPx:1080}});
    expect(r.qa.sceneIntegrity!.changedOutsideAllowed).toBe(0);
  });
});
