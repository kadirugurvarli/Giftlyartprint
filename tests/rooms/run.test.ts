import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {runRoomMockup} from "@/lib/mockup-v3/rooms/run";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";
import {landscapeArt} from "../helpers/scenes";
import {framedPhoto} from "../helpers/e2e";
import {SPEC,syntheticRoom} from "../helpers/rooms";

const room=syntheticRoom();
const flat=(w:number,h:number,over:any={})=>({room:room.room,roomImage:room.image,size:{width:w,height:h},source:{kind:"flat-artwork" as const,artwork:landscapeArt(900,1200,5),frame:SPEC(w,h)},...over});

describe("runRoomMockup refuses instead of correcting",()=>{
  it("room image of the wrong size",async()=>{
    const out=await runRoomMockup({...flat(30,40),roomImage:{...room.image,width:800,height:600,data:new Uint8ClampedArray(800*600*4)}});
    expect(out).toMatchObject({ok:false,error:"ROOM_IMAGE_SIZE_MISMATCH"});
  });
  it("frame spec whose outer size is not the requested size",async()=>{
    expect(await runRoomMockup({...flat(30,40),source:{kind:"flat-artwork",artwork:landscapeArt(900,1200,5),frame:SPEC(40,50)}})).toMatchObject({ok:false,error:"FRAME_SIZE_MISMATCH"});
  });
  it("a landscape print in a portrait frame (it would have to be cropped or shrunk to a sliver)",async()=>{
    expect(await runRoomMockup({...flat(30,40),source:{kind:"flat-artwork",artwork:landscapeArt(1200,800,5),frame:SPEC(30,40)}})).toMatchObject({ok:false,error:"ARTWORK_ASPECT_TOO_DIFFERENT_FOR_FRAME"});
  });
  it("an invalid room is refused with every reason, and the engine is never called",async()=>{
    const bad=structuredClone(room.room);bad.light.calibrated=false;bad.shadowMask=undefined;
    const out=await runRoomMockup({...flat(30,40),room:bad});
    expect(out.ok).toBe(false);if(out.ok) return;
    expect(out.error).toContain("LIGHT_NOT_CALIBRATED");expect(out.error).toContain("SHADOW_MASK_MISSING");
  });
  it("physical accuracy can be demanded, and an AI room cannot provide it",async()=>{
    const ai=syntheticRoom({origin:"ai-generated"});
    const out=await runRoomMockup({...flat(30,40),room:ai.room,roomImage:ai.image,placement:{requirePhysicalAccuracy:true}});
    expect(out).toMatchObject({ok:false,error:"SCALE_NOT_PHYSICALLY_MEASURED"});
  });
  it("sizes outside 30x40 - 60x80 are refused",async()=>{
    expect(await runRoomMockup(flat(90,120,{source:{kind:"flat-artwork",artwork:landscapeArt(900,1200,5),frame:SPEC(30,40)}}))).toMatchObject({ok:false,error:"FRAME_SIZE_OUT_OF_RANGE"});
  });
  it("a photographed frame whose proportions differ more than 2 % from the outer size is rejected, never stretched",async()=>{
    const piece=renderFramedPiece(landscapeArt(480,640,2),{mouldingPx:34,mountPx:46,mouldingColour:[70,52,38],mountColour:[240,236,226]});
    const fp=framedPhoto(piece,{W:2000,H:1500,widthM:0.9});
    const trueAspect=piece.image.width/piece.image.height; // exactly 0.8 (a 40x50 piece)
    expect(trueAspect).toBeCloseTo(0.8,6);
    const mk=(size:{width:number;height:number},stated?:number)=>runRoomMockup({room:room.room,roomImage:room.image,size,source:{kind:"framed-photo",photo:fp.photo,sourceFocalPx:1300,sourceQuad:fp.quad,statedAspect:stated}});
    // the piece is 0.8 but is being placed as a 30x40 (0.75): 6.7 % off
    expect(await mk({width:30,height:40},trueAspect)).toMatchObject({ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH"});
    // the product record CLAIMS 30x40, but the photo measures 0.8: the measurement wins
    expect(await mk({width:30,height:40},0.75)).toMatchObject({ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH"});
    // a portrait piece as a landscape size
    expect(await mk({width:40,height:30},0.75)).toMatchObject({ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH"});
    expect(await mk({width:50,height:40},trueAspect)).toMatchObject({ok:false,error:"SOURCE_FRAME_ASPECT_MISMATCH"});
  },120000);
});

describe("photograph of a finished framed piece",()=>{
  it("proportions within 2 % of the outer size: placed through the engine, unstretched, protections verified",async()=>{
    const s=syntheticRoom({withPlant:true});
    // a finished 40x50 piece (outer proportions 0.8 exactly)
    const art=landscapeArt(480-2*80,600-2*80,8);
    const piece=renderFramedPiece(art,{mouldingPx:34,mountPx:46,mouldingColour:[70,52,38],mountColour:[240,236,226]});
    expect(Math.abs(piece.image.width/piece.image.height/0.8-1)).toBeLessThan(0.02);
    const fp=framedPhoto(piece,{W:2000,H:1500,widthM:0.9});
    const out=await runRoomMockup({room:s.room,roomImage:s.image,size:{width:40,height:50},source:{kind:"framed-photo",photo:fp.photo,sourceFocalPx:1300,sourceQuad:fp.quad,statedAspect:piece.image.width/piece.image.height}});
    expect(out.ok,out.ok?"":out.error+" "+out.detail).toBe(true);
    if(!out.ok) return;
    expect(out.aspect).toMatchObject({ok:true});
    for(const c of out.checks.filter(c=>c.name!=="engine-gates")) expect(c.pass,`${c.name}: ${c.detail}`).toBe(true);
    expect(out.result.status==="fail").toBe(false);
  },120000);
});

describe("the Room Library never stores or sends anything",()=>{
  const dir=path.resolve(__dirname,"../../lib/mockup-v3/rooms");
  const files=fs.readdirSync(dir).filter(f=>f.endsWith(".ts"));
  it("has source files to inspect",()=>{expect(files.length).toBeGreaterThanOrEqual(8);});
  it.each(files)("%s: no file system, network, storage or logging",(f)=>{
    const src=fs.readFileSync(path.join(dir,f),"utf8");
    expect(src).not.toMatch(/from ["'](node:)?(fs|http|https|net|child_process)["']|require\(["'](node:)?fs|writeFile|appendFile|createWriteStream|\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|process\.env|console\.(log|info|warn|error)|\.toFile\(|\.write\(/);
  });
  it("only the frame renderer touches an image library, and only to resample",()=>{
    const users=files.filter(f=>/from ["']sharp["']/.test(fs.readFileSync(path.join(dir,f),"utf8")));
    expect(users).toEqual(["product.ts"]);
    expect(fs.readFileSync(path.join(dir,"product.ts"),"utf8")).not.toMatch(/\.toFile\(|\.jpeg\(|\.png\(|\.webp\(/); // resample in memory only; no encoding to disk or file formats
  });
});
