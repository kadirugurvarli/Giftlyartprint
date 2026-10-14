import {describe,expect,it} from "vitest";
import type {Quad} from "@/lib/mockup-v3/types";
import {runMockup} from "@/lib/mockup-v3/pipeline";
import {crossCheckFromSource} from "@/lib/mockup-v3/pipeline/common";
import {LIGHTING_RECTIFIED_TOLERANCES} from "@/lib/mockup-v3/qa/metrics";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";
import {DEFAULT_STYLE,emptyRoom,framedPhoto} from "../helpers/e2e";
import {landscapeArt} from "../helpers/scenes";
import {tint} from "../helpers/fixtures";

describe("independent cross-check (original photo vs final composite)",()=>{
  const piece=renderFramedPiece(landscapeArt(480,360,31),DEFAULT_STYLE);
  const src=framedPhoto(piece);
  const room=emptyRoom();
  const opts={sourceFocalPx:src.focalPx,referenceFocalPx:1080,pieceAspect:piece.image.width/piece.image.height,physicalWidthM:0.62,ceilingHeightM:2.6,skirtingM:0.12,edgeInsetPx:0};

  it("passes on a faithful result and fails when the claimed source region is wrong, tinted or mirrored",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:opts});
    const base={source:src.photo,composite:r.image!,targetQuad:r.targetQuad!,marginPx:4,tol:LIGHTING_RECTIFIED_TOLERANCES};
    const good=crossCheckFromSource({...base,sourceQuad:r.sourceQuad!});
    expect(good.pass).toBe(true);

    const shifted=r.sourceQuad!.map((p)=>({x:p.x+14,y:p.y+9})) as Quad;
    expect(crossCheckFromSource({...base,sourceQuad:shifted}).pass).toBe(false);

    const tinted=crossCheckFromSource({...base,sourceQuad:r.sourceQuad!,composite:tint(r.image!,9,0,-7)});
    expect(tinted.pass).toBe(false);

    // a mirrored corner order is refused outright rather than silently flipping the artwork
    const q=r.sourceQuad!;
    const mirrored=[q[1],q[0],q[3],q[2]] as Quad;
    expect(()=>crossCheckFromSource({...base,sourceQuad:mirrored})).toThrow(/WRONG_WINDING/);
  });

  it("the pipeline's own cross-check compares against the original photo and is tight on correct output",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:src.photo,reference:room.image,options:opts});
    expect(r.qa.crossCheck!.pass).toBe(true);
    expect(r.qa.crossCheck!.metrics!.meanDeltaE).toBeLessThan(1.8);
    expect(r.qa.crossCheck!.metrics!.ssim).toBeGreaterThan(0.95);
    // chroma (colour accuracy) is the tightest: no colour cast relative to the original photo
    expect(Math.abs(r.qa.crossCheck!.metrics!.labBias.a)).toBeLessThan(0.5);
    expect(Math.abs(r.qa.crossCheck!.metrics!.labBias.b)).toBeLessThan(0.5);
  });
});
