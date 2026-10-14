import {describe,expect,it} from "vitest";
import {auditRealism} from "@/lib/mockup-v3/validation/realism-audit";
import {runMockup} from "@/lib/mockup-v3/pipeline";
import {landscapeArt} from "../helpers/scenes";
import {printPhoto,referenceWithFramedPicture,framedPhoto,emptyRoom,DEFAULT_STYLE} from "../helpers/e2e";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";

const codes=(a:{findings:{code:string}[]})=>a.findings.map((f)=>f.code);

describe("realism audit",()=>{
  it("a clean workflow-A result raises no warnings; a crafted composite that leaves the old picture is flagged",async()=>{
    const ref=referenceWithFramedPicture();
    const print=printPhoto(landscapeArt(640,480,21));
    const r=await runMockup({mode:"artwork-in-frame",source:print.photo,reference:ref.image,options:{artworkAspect:640/480}});
    expect(r.status).toBe("pass");
    const a=auditRealism({result:r,reference:ref.image});
    expect(a.findings.filter((f)=>f.severity==="warn")).toEqual([]);
    expect(a.calibrated).toBe(false);
    // crafted: put the reference back inside the opening strip => "old picture leak"
    const bad={...r,image:{...r.image!,data:new Uint8ClampedArray(ref.image.data)}};
    expect(codes(auditRealism({result:bad,reference:ref.image}))).toContain("OLD_PICTURE_LEAK");
  },60000);
  it("wall workflow: shadows off is reported; shadows on is not",async()=>{
    const piece=renderFramedPiece(landscapeArt(480,360,31),DEFAULT_STYLE);
    const fp=framedPhoto(piece);
    const room=emptyRoom();
    const opts={pieceAspect:piece.image.width/piece.image.height,physicalWidthM:0.62,ceilingHeightM:2.6,skirtingM:0.12};
    const on=await runMockup({mode:"framed-on-wall",source:fp.photo,reference:room.image,options:opts});
    expect(codes(auditRealism({result:on,reference:room.image}))).not.toContain("SHADOW_ABSENT");
    const off=await runMockup({mode:"framed-on-wall",source:fp.photo,reference:room.image,options:{...opts,realism:{dropShadowStrength:0,contactShadowStrength:0}} as any});
    expect(codes(auditRealism({result:off,reference:room.image}))).toContain("SHADOW_ABSENT");
  },120000);
  it("no mockup => measurement unavailable, never a crash",()=>{
    const ref=emptyRoom().image;
    const a=auditRealism({result:{image:null,targetQuad:null} as any,reference:ref});
    expect(codes(a)).toEqual(["MEASUREMENT_UNAVAILABLE"]);
  });
});
