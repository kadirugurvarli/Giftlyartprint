import {describe,expect,it} from "vitest";
import type {Quad} from "@/lib/mockup-v3/types";
import {compositeOver,warpToQuad} from "@/lib/mockup-v3/geometry/warp";
import {artworkPattern,checkerboard,projectRect,wallScene} from "../helpers/fixtures";
import {expectMatchesGolden,goldenDiff} from "../helpers/golden";

const W=800,H=600,F=700;

describe("visual golden fixtures (synthetic content only)",()=>{
  it("artwork in perspective on a wall",async()=>{
    const art=artworkPattern(400,300,13);
    const q=projectRect({worldW:1.3333,worldH:1,yawDeg:24,pitchDeg:10,distance:2.6,focalPx:F,imgW:W,imgH:H});
    const out=compositeOver(wallScene(W,H),warpToQuad(art,q,W,H));
    await expectMatchesGolden("art-on-wall-perspective",out);
  });

  it("checkerboard under strong perspective (alignment and edge anti-aliasing)",async()=>{
    const q:Quad=[{x:260,y:60},{x:560,y:90},{x:700,y:520},{x:90,y:470}];
    const out=compositeOver(wallScene(W,H),warpToQuad(checkerboard(480,360,30,[235,235,235],[40,40,40]),q,W,H));
    await expectMatchesGolden("checker-strong-perspective",out);
  });

  it("clockwise 90 degree rotation",async()=>{
    const art=artworkPattern(300,200,21);
    const q:Quad=[{x:560,y:100},{x:560,y:400},{x:360,y:400},{x:360,y:100}];
    const out=compositeOver(wallScene(W,H),warpToQuad(art,q,W,H));
    await expectMatchesGolden("art-rotated-90",out);
  });

  it("the golden comparison itself rejects a perturbed render (guards against a vacuous test)",async()=>{
    const art=artworkPattern(400,300,13);
    const q=projectRect({worldW:1.3333,worldH:1,yawDeg:24,pitchDeg:10,distance:2.6,focalPx:F,imgW:W,imgH:H});
    const shifted=q.map((p)=>({x:p.x+4,y:p.y+3})) as Quad;
    const bad=compositeOver(wallScene(W,H),warpToQuad(art,shifted,W,H));
    const m=await goldenDiff("art-on-wall-perspective",bad);
    console.log(`[golden] 4px/3px corner shift vs golden: dE=${m.meanDeltaE.toFixed(3)} ssim=${m.ssim.toFixed(4)}`);
    // Same thresholds expectMatchesGolden applies by default (dE<=0.5, SSIM>=0.99).
    expect(m.meanDeltaE>0.5 || m.ssim<0.99).toBe(true);
  });
});
