import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {runMockup} from "@/lib/mockup-v3/pipeline";
import {ApprovalError,approveMockup,fingerprintImage,requireApprovedMockup} from "@/lib/mockup-v3/approval";
import {landscapeArt} from "../helpers/scenes";
import {printPhoto,referenceWithFramedPicture} from "../helpers/e2e";

describe("approval gate: the clean mockup comes before any marketing graphics",()=>{
  const ref=referenceWithFramedPicture();
  const src=printPhoto(landscapeArt(640,480,21));
  const job=()=>runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:{sourceFocalPx:1300,referenceFocalPx:1080,artworkAspect:640/480}});

  it("marketing code cannot run without approval, and approval is bound to the exact pixels",async()=>{
    const r=await job();
    expect(()=>requireApprovedMockup(r.image!,undefined)).toThrow(ApprovalError);
    const ap=approveMockup(r,"Kadir","looks right",new Date("2026-01-02T03:04:05Z"));
    expect(ap.approvedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(()=>requireApprovedMockup(r.image!,ap)).not.toThrow();
    const tweaked={...r.image!,data:new Uint8ClampedArray(r.image!.data)};
    tweaked.data[1234]^=1;
    expect(()=>requireApprovedMockup(tweaked,ap)).toThrow(/differs from the approved/);
  });
  it("a failed mockup cannot be approved, nor an empty one, nor anonymously",async()=>{
    const r=await job();
    expect(()=>approveMockup({...r,status:"fail"},"x")).toThrow(/failed/);
    expect(()=>approveMockup({...r,image:null},"x")).toThrow(/no mockup image/);
    expect(()=>approveMockup(r,"  ")).toThrow(/approver/);
  });
  it("fingerprints are deterministic and size-sensitive",async()=>{
    const r=await job();
    expect(fingerprintImage(r.image!)).toBe(fingerprintImage(r.image!));
    const a=fingerprintImage({width:2,height:1,data:new Uint8ClampedArray(8)}),b=fingerprintImage({width:1,height:2,data:new Uint8ClampedArray(8)});
    expect(a).not.toBe(b);
  });
});

describe("structural guard: the mockup engine draws no text or branding",()=>{
  const root=path.resolve(__dirname,"..","..","lib","mockup-v3");
  const files:string[]=[];
  const walk=(d:string)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()) walk(p);else if(p.endsWith(".ts")) files.push(p);}};
  walk(root);
  it("no module renders text, SVG text, or references headline/CTA/logo/social production",()=>{
    const offenders:string[]=[];
    for(const f of files){
      const code=fs.readFileSync(f,"utf8").replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/.*$/gm,"");
      if(/<text[\s>]/.test(code)||/\btext\s*:\s*\{/.test(code)||/fillText|font-family|headline|\bCTA\b|giftlyartprint\.co\.uk|social/i.test(code)) offenders.push(path.relative(root,f));
    }
    expect(offenders).toEqual([]);
  });
});
