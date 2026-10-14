import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import sharp from "sharp";
import {beforeAll,describe,expect,it} from "vitest";
import {describeLight,paidEligible,validatePackManifest,type PackManifest} from "../../lib/mockup-v4/pack";
import {planRequest} from "../../lib/mockup-v4/request";
import {resizeMask,resizeRaw} from "../../lib/mockup-v4/resample";
import {buildEditMask} from "../../lib/mockup-v4/mask";
import {runHybridEdit} from "../../lib/mockup-v4/run";
import {AdversarialMockEditor,FaithfulMockEditor} from "../../lib/mockup-v4/mock";
import {landscapeArt} from "../helpers/scenes";
import {syntheticRoom} from "../helpers/rooms";
import {hybridScenario,type HybridScenario} from "../helpers/hybrid";
import {loadPack} from "../../scripts/v4-pack";

const manifest=(over:Partial<PackManifest>={},roomOver:Record<string,unknown>={}):PackManifest=>{
  const s=syntheticRoom({origin:"ai-generated",withPlant:true});
  return {
    schemaVersion:1,id:"test-ai-pack",roomImage:"room.png",artworkImage:"art.png",
    room:{...s.room,...roomOver} as never,
    provenance:{kind:"ai-generated",generator:"some-image-model",generatedOn:"2026-10-01",rightsCleared:true,licence:"owner generated, commercial use allowed",emptyWallConfirmed:true},
    artwork:{origin:"sample",customer:false,licence:"public domain sample"},
    frame:{mouldingWidthCm:2.4,mountWidthCm:3.5,frameDepthCm:3,mouldingColour:[66,48,34],mountColour:[238,233,222],description:"walnut moulding, cream mount"},
    ...over
  };
};
const codes=(m:PackManifest)=>validatePackManifest(m).map(i=>i.code);

describe("pack manifest validation (fail closed)",()=>{
  it("a complete AI-room pack is valid and paid-eligible",()=>{
    expect(codes(manifest())).toEqual([]);
    expect(paidEligible(manifest()).eligible).toBe(true);
  });
  it("rejects every missing right, provenance and customer-data field",()=>{
    const p=manifest();
    expect(codes({...p,provenance:{...p.provenance,rightsCleared:false}})).toContain("PACK_RIGHTS_NOT_CLEARED");
    expect(codes({...p,provenance:{...p.provenance,licence:" "}})).toContain("PACK_RIGHTS_NOT_CLEARED");
    expect(codes({...p,provenance:{...p.provenance,emptyWallConfirmed:false}})).toContain("PACK_EMPTY_WALL_NOT_CONFIRMED");
    expect(codes({...p,provenance:{...p.provenance,generator:undefined}})).toContain("PACK_PROVENANCE_INCOMPLETE");
    expect(codes({...p,provenance:undefined as never})).toContain("PACK_PROVENANCE_MISSING");
    expect(codes({...p,artwork:{...p.artwork,customer:true as never}})).toContain("PACK_ARTWORK_NOT_NON_CUSTOMER");
    expect(codes({...p,artwork:{origin:"customer" as never,customer:false,licence:"x"}})).toContain("PACK_ARTWORK_NOT_NON_CUSTOMER");
    expect(codes({...p,artwork:{...p.artwork,licence:""}})).toContain("PACK_ARTWORK_NOT_NON_CUSTOMER");
  });
  it("AI room must be declared AI and uncalibrated rooms are rejected with the room codes",()=>{
    const p=manifest();
    expect(codes({...p,room:{...p.room,image:{...p.room.image,origin:"owned-photo"}}})).toContain("PACK_ROOM_ORIGIN_MISMATCH");
    const pts=p.room.wall.controlPoints.slice(0,3);
    expect(codes({...p,room:{...p.room,wall:{controlPoints:pts}}}).some(c=>c.startsWith("PACK_ROOM_"))).toBe(true);
    expect(codes({...p,room:{...p.room,shadowMask:undefined}})).toContain("PACK_WALL_MASK_MISSING");
  });
  it("file names must be plain image names; frame spec must be valid for both sizes",()=>{
    const p=manifest();
    for(const bad of ["../room.png","/etc/passwd","a/b.png",".hidden.png","room.exe","room"]) expect(codes({...p,roomImage:bad}),bad).toContain("PACK_FILE_NAME_INVALID");
    expect(codes({...p,artworkImage:p.roomImage})).toContain("PACK_FILE_NAME_INVALID");
    expect(codes({...p,frame:{...p.frame,mouldingWidthCm:20}})).toContain("PACK_FRAME_SPEC_INVALID");
    expect(codes({...p,frame:{...p.frame,mountWidthCm:9}}).includes("PACK_FRAME_SPEC_INVALID")).toBe(true); // 9 cm mount leaves < 8 cm window on 30x40
    expect(codes({...p,schemaVersion:2 as never})).toEqual(["PACK_SCHEMA_VERSION"]);
  });
  it("a synthetic-test pack is never paid-eligible",()=>{
    const p=manifest();
    const syn={...p,provenance:{...p.provenance,kind:"synthetic-test" as const},artwork:{...p.artwork,origin:"synthetic-test" as const}};
    const e=paidEligible(syn);expect(e.eligible).toBe(false);expect(e.reasons.length).toBeGreaterThanOrEqual(2);
  });
  it("describes the calibrated light in words",()=>{
    const l=syntheticRoom().room.light;
    expect(describeLight(l)).toBe("warm light from above and the left, gentle softly defined shadows falling down and to the right");
    expect(describeLight({...l,shadowDirectionDeg:117,colourTempK:6500,softnessCm:5,intensity:0.45})).toContain("down and to the left");
  });
});

describe("request planning for realistic frame detail",()=>{
  let S:HybridScenario;
  beforeAll(async()=>{S=await hybridScenario();},120000);
  const mask=()=>buildEditMask({width:1600,height:1200,outerQuad:S.outerQuad,artQuad:S.artQuad,shadowDir:{x:0.45,y:0.89},shadowBandPx:26,wallAlpha:S.wallAlpha,protect:[S.plantPolygon]});
  const C={alignPx:16,maxAspect:3,maxSide:3840,maxPixels:3840*2160,minSide:64};
  it("upscales by the smallest integer that gives ≥ 28 px of moulding, keeping 16-alignment",()=>{
    const m=mask();
    const a=planRequest({mask:m,constraints:C,contextPx:48,mouldingPx:30});
    expect(a.ok&&a.scale).toBe(1);
    const b=planRequest({mask:m,constraints:C,contextPx:48,mouldingPx:14});
    expect(b.ok&&b.scale).toBe(2);expect(b.ok&&b.mouldingPxInRequest).toBe(28);
    if(b.ok){expect(b.requestWidth%16).toBe(0);expect(b.requestHeight%16).toBe(0);}
  });
  it("fails closed when the moulding is too thin or the request would exceed provider limits",()=>{
    const m=mask();
    expect(planRequest({mask:m,constraints:C,contextPx:48,mouldingPx:5})).toEqual({ok:false,error:"MOULDING_TOO_THIN_FOR_DETAIL"});
    expect(planRequest({mask:m,constraints:{...C,maxSide:300},contextPx:48,mouldingPx:14})).toEqual({ok:false,error:"REQUEST_EXCEEDS_EDITOR_LIMITS"});
  });
});

describe("resampling helpers",()=>{
  it("an upscaled mask stays aligned with the original (±1 px at edges) and is strictly 0/255",async()=>{
    const w=40,h=30,m=new Uint8Array(w*h);for(let y=5;y<20;y++)for(let x=8;x<30;x++)m[y*w+x]=255;
    const up=await resizeMask(m,w,h,w*3,h*3);
    expect(up.length).toBe(w*h*9);
    let bad=0;for(let y=0;y<h*3;y++)for(let x=0;x<w*3;x++){const v=up[y*w*3+x];if(v!==0&&v!==255)bad++;const s=m[Math.floor(y/3)*w+Math.floor(x/3)];
      const edge=[-1,0,1].some(dx=>[-1,0,1].some(dy=>{const xx=Math.floor((x+dx)/3),yy=Math.floor((y+dy)/3);return xx>=0&&yy>=0&&xx<w&&yy<h&&m[yy*w+xx]!==s;}));
      if(!edge&&v!==s) bad++;}
    expect(bad).toBe(0);
  });
  it("Lanczos resize keeps size, alpha and a flat colour",async()=>{
    const f={width:20,height:20,data:new Uint8ClampedArray(20*20*4).fill(200)};for(let i=3;i<f.data.length;i+=4)f.data[i]=255;
    const u=await resizeRaw(f,50,60);
    expect([u.width,u.height]).toEqual([50,60]);
    expect(Array.from(u.data.slice(0,4))).toEqual([200,200,200,255]);
  });
});

describe("hybrid edit with an upscaled request",()=>{
  let S:HybridScenario;
  beforeAll(async()=>{S=await hybridScenario();},120000);
  it("a faithful editor is accepted at ×2 (the resampling round trip is not mistaken for drift) and protected pixels stay identical",async()=>{
    const r=await runHybridEdit(S.base({mouldingPx:14}));
    expect(r.ok).toBe(true);if(!r.ok) return;
    expect(r.scale).toBe(2);expect(r.verdict).toBe("accept");
    expect(r.metrics.finalOutside.changed).toBe(0);expect(r.metrics.finalArtVsWarp.changed).toBe(0);
    // only resampling bleed at the mask edge is left; it is tiny
    expect(r.metrics.candidateOutsideDrift.meanDE).toBeLessThan(0.5);
  });
  it("adversaries are still rejected at ×2",async()=>{
    const t=await runHybridEdit(S.base({mouldingPx:14,editor:new AdversarialMockEditor("global-tint")}));
    expect(t.ok&&t.verdict).toBe("reject");
    const w=await runHybridEdit(S.base({mouldingPx:14,editor:new AdversarialMockEditor("wrong-size")}));
    expect(w.ok).toBe(false);if(!w.ok) expect(w.error).toBe("CANDIDATE_SIZE_MISMATCH");
  });
  it("the mock sees the scaled request size",async()=>{
    let size="";const e=new FaithfulMockEditor();const o=e.edit.bind(e);e.edit=async(q)=>{size=`${q.image.width}x${q.image.height}`;expect(q.mask.length).toBe(q.image.width*q.image.height);return o(q);};
    const r=await runHybridEdit(S.base({mouldingPx:14,editor:e}));
    expect(r.ok&&r.crop.width*2+"x"+r.crop.height*2).toBe(size);
  });
});

// outputs go to the OS temp dir: tests/validation/runner.test.ts deletes the whole validation-output/ folder
const OUT1=path.join(os.tmpdir(),"v4-pack-test");
describe("local pack loader and the dry-run script",()=>{
  const png=(i:{width:number;height:number;data:Uint8ClampedArray})=>sharp(Buffer.from(i.data.buffer,i.data.byteOffset,i.data.byteLength),{raw:{width:i.width,height:i.height,channels:4}}).removeAlpha().png().toBuffer();
  async function writePack(scale:number,over:(m:PackManifest)=>void=()=>{}){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"v4pack-"));
    const s=syntheticRoom({withPlant:true,scale});
    fs.writeFileSync(path.join(dir,"room.png"),await png(s.image));
    fs.writeFileSync(path.join(dir,"art.png"),await png(landscapeArt(1500,2000,3)));
    const m:PackManifest={schemaVersion:1,id:"tmp-synthetic-pack",roomImage:"room.png",artworkImage:"art.png",room:s.room,
      provenance:{kind:"synthetic-test",rightsCleared:true,licence:"test render",emptyWallConfirmed:true},
      artwork:{origin:"synthetic-test",customer:false,licence:"test"},
      frame:{mouldingWidthCm:2.4,mountWidthCm:3.5,frameDepthCm:3,mouldingColour:[66,48,34],mountColour:[238,233,222],description:"walnut"}};
    over(m);fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify(m));
    return dir;
  }
  it("loads a valid pack in memory and flags a room that is too small for detail",async()=>{
    const small=await loadPack(await writePack(1));
    expect(small.roomImage.width).toBe(1600);
    expect(small.issues.map(i=>i.code)).toContain("PACK_ROOM_TOO_SMALL_FOR_DETAIL");
    const big=await loadPack(await writePack(2));
    expect(big.roomImage.width).toBe(3200);expect(big.issues).toEqual([]);
    expect(big.artwork.width).toBe(1500);
  },180000);
  it("refuses missing files, mismatched calibration size, tracked/unsafe names and transparent artwork",async()=>{
    const d1=await writePack(2);fs.rmSync(path.join(d1,"art.png"));
    await expect(loadPack(d1)).rejects.toThrow("PACK_FILE_MISSING");
    const d2=await writePack(2,m=>{m.room.image.width=3000;});
    expect((await loadPack(d2)).issues.map(i=>i.code)).toContain("PACK_ROOM_IMAGE_SIZE_MISMATCH");
    const d3=await writePack(2,m=>{m.roomImage="../room.png";});
    expect((await loadPack(d3)).issues.map(i=>i.code)).toContain("PACK_FILE_NAME_INVALID");
    const d4=await writePack(2);
    const rgba=await sharp({create:{width:1400,height:1400,channels:4,background:{r:10,g:10,b:10,alpha:0.5}}}).png().toBuffer();
    fs.writeFileSync(path.join(d4,"art.png"),rgba);
    expect((await loadPack(d4)).issues.map(i=>i.code)).toContain("PACK_ARTWORK_HAS_TRANSPARENCY");
    await expect(loadPack(path.join(d4,"nope"))).rejects.toThrow();
  },240000);
  it("refuses a pack folder that is inside this repository but not git-ignored",async()=>{
    const dir=path.resolve("tests/mockup-v4/__not_ignored_pack");fs.mkdirSync(dir,{recursive:true});
    try{await expect(loadPack(dir)).rejects.toThrow(/NOT ignored/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
  it("dry run on a valid pack: exit 0, contact sheet written, every validation passes, nothing paid",async()=>{
    const dir=await writePack(2);
    const r=spawnSync("npx",["tsx","scripts/v4-experiment.ts","--pack",dir,"--sizes","60x80","--out",OUT1],{encoding:"utf8",env:{...process.env,OPENAI_API_KEY:""},timeout:240000});
    expect(r.status,r.stdout+r.stderr).toBe(0);
    expect(r.stdout).toContain("DRY RUN: no network call was made");
    const rep=JSON.parse(fs.readFileSync(path.join(OUT1,"dry_run_report.json"),"utf8"));
    expect(rep.mode).toBe("DRY RUN");
    expect(rep.checks.every((c:{pass:boolean})=>c.pass)).toBe(true);
    expect(rep.readiness.some((x:{ok:boolean})=>!x.ok)).toBe(true); // synthetic pack, no price, no authorisation ...
    const meta=await sharp(path.join(OUT1,"contact_sheet.jpg")).metadata();
    expect(meta.width).toBe(4*700+3*10);expect(meta.height).toBe(2*520+10);
    // even with every flag a synthetic pack is refused
    const x=spawnSync("npx",["tsx","scripts/v4-experiment.ts","--pack",dir,"--sizes","60x80","--size","60x80","--execute","--authorize-paid","--approve-dry-run-sheet","--max-spend-usd","1","--price-per-image-usd","0.1","--out",OUT1],{encoding:"utf8",env:{...process.env,OPENAI_API_KEY:"sk-not-real"},timeout:240000});
    expect(x.status).toBe(3);expect(x.stderr).toContain("REFUSED");expect(x.stderr).toContain("AI-generated");
  },600000);
  it("a pack with a too-small room fails validation (exit 5), still a dry run",async()=>{
    const dir=await writePack(1);
    const r=spawnSync("npx",["tsx","scripts/v4-experiment.ts","--pack",dir,"--sizes","30x40","--out",path.join(os.tmpdir(),"v4-pack-test-small")],{encoding:"utf8",env:{...process.env,OPENAI_API_KEY:""},timeout:240000});
    expect(r.status).toBe(5);expect(r.stdout).toContain("PACK_ROOM_TOO_SMALL_FOR_DETAIL");
  },300000);
});
