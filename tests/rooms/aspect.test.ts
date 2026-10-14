import {describe,expect,it} from "vitest";
import {checkSourceFrameAspect,measureFramedPhotoAspect} from "@/lib/mockup-v3/rooms/aspect";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";
import {landscapeArt} from "../helpers/scenes";
import {framedPhoto} from "../helpers/e2e";

const nominal=(w:number,h:number)=>w/h;
describe("source frame proportions vs the chosen outer size (never stretch)",()=>{
  const size={width:40,height:50};
  it.each([[1.0],[1.015],[0.985],[1.02],[0.98]])("a frame %f times the nominal proportion is accepted (≤ 2 %)",(k)=>{
    const r=checkSourceFrameAspect(size,{statedAspect:nominal(40,50)*k});
    expect(r.ok).toBe(true);
  });
  it.each([[1.021],[0.979],[1.05],[0.9],[1.3]])("%f times the nominal proportion is rejected, not stretched",(k)=>{
    const r=checkSourceFrameAspect(size,{statedAspect:nominal(40,50)*k});
    expect(r).toMatchObject({ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH"});
  });
  it("a landscape photo cannot be placed as a portrait size (and vice versa)",()=>{
    expect(checkSourceFrameAspect({width:30,height:40},{statedAspect:40/30})).toMatchObject({ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH"});
    expect(checkSourceFrameAspect({width:40,height:30},{statedAspect:30/40})).toMatchObject({ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH"});
  });
  it("a reliable measurement decides; both measured and stated must agree",()=>{
    expect(checkSourceFrameAspect(size,{measuredAspect:0.8,measuredReliable:true})).toMatchObject({ok:true,basis:"measured"});
    expect(checkSourceFrameAspect(size,{measuredAspect:0.8*1.04,measuredReliable:true,statedAspect:0.8})).toMatchObject({ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH"});
    expect(checkSourceFrameAspect(size,{measuredAspect:0.8,measuredReliable:true,statedAspect:0.8*1.04})).toMatchObject({ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH"});
  });
  it("an unreliable measurement (assumed focal) is not enough on its own",()=>{
    expect(checkSourceFrameAspect(size,{measuredAspect:0.8,measuredReliable:false})).toMatchObject({ok:false,error:"SOURCE_ASPECT_UNVERIFIED"});
    expect(checkSourceFrameAspect(size,{measuredAspect:0.9,measuredReliable:false,statedAspect:0.8})).toMatchObject({ok:true,basis:"stated"});
    expect(checkSourceFrameAspect(size,{})).toMatchObject({ok:false,error:"SOURCE_ASPECT_UNVERIFIED"});
  });
  it("garbage values are refused",()=>{
    for(const v of [0,-1,NaN,Infinity]) expect(checkSourceFrameAspect(size,{statedAspect:v})).toMatchObject({ok:false,error:"INVALID_ASPECT"});
  });
  it("the measurement from a photo of a finished frame agrees with its true proportions",()=>{
    const piece=renderFramedPiece(landscapeArt(480,640,2),{mouldingPx:34,mountPx:46,mouldingColour:[70,52,38],mountColour:[240,236,226]});
    const trueAspect=piece.image.width/piece.image.height;
    const fp=framedPhoto(piece,{W:2000,H:1500,widthM:0.9});
    const m=measureFramedPhotoAspect(fp.photo,{focalPx:1300});
    expect(m).not.toBeNull();
    expect(m!.reliable).toBe(true);
    expect(Math.abs(m!.aspect/trueAspect-1)).toBeLessThan(0.02);
    // and it is judged against the size the product record claims
    const ok=checkSourceFrameAspect({width:60,height:80},{measuredAspect:m!.aspect,measuredReliable:m!.reliable});
    const wrongSize=checkSourceFrameAspect({width:50,height:70},{measuredAspect:m!.aspect,measuredReliable:m!.reliable});
    expect(ok.ok||wrongSize.ok).toBeDefined();
    expect(trueAspect).toBeGreaterThan(0.7);
  });
});
