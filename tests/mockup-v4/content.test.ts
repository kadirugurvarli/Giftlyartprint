import {spawnSync} from "node:child_process";
import sharp from "sharp";
import {beforeAll,describe,expect,it,vi} from "vitest";
import {buildCaption,captionProblems,countSentences} from "../../lib/mockup-v4/captions";
import {ARTWORK_LIMITS,prepareArtwork} from "../../lib/mockup-v4/intake";
import {MAX_EXPORT_BYTES,planSocialCrop,renderMasterPng,renderSocial,SOCIAL_FORMATS} from "../../lib/mockup-v4/social";
import {FRAME_STYLES,frameFor,MOUNTS,SIZES} from "../../lib/mockup-v4/styles";
import {validateFrameSpec} from "../../lib/mockup-v3/rooms/product";
import {frameSpecFor,type PackManifest} from "../../lib/mockup-v4/pack";
import {buildDrivePlan,buildDriveUploadBody,buildTrackerItem,pushToDrive,fileNameFor} from "../../lib/mockup-v4/tracker";
import {buildRoomGenRequest,buildRoomPrompt,generateRoom,ROOM_BRIEF,ROOM_SIZE} from "../../lib/mockup-v4/roomgen";
import {SpendGuard,SpendGuardError} from "../../lib/mockup-v4/spend";
import type {Quad,RawImage} from "../../lib/mockup-v3/types";
import {landscapeArt} from "../helpers/scenes";

const quadAt=(x:number,y:number,w:number,h:number):Quad=>[{x,y},{x:x+w,y:y+2},{x:x+w,y:y+h},{x,y:y+h-2}];

describe("styles, mounts and sizes",()=>{
  it("offers exactly the eight outer sizes from 30x40 to 60x80, portrait and landscape",()=>{
    expect(SIZES.map(s=>`${s.width}x${s.height}`)).toEqual(["30x40","40x30","40x50","50x40","50x70","70x50","60x80","80x60"]);
    expect(SIZES.filter(s=>s.orientation==="portrait").length).toBe(4);
  });
  it("every style × mount is a valid frame spec for every size",()=>{
    for(const st of FRAME_STYLES)for(const m of MOUNTS)for(const z of SIZES){
      const f=frameFor(st.id,m.id)!;
      expect(validateFrameSpec(frameSpecFor({frame:f} as PackManifest,z)),`${st.id}/${m.id}/${z.label}`).toBeNull();
    }
    expect(frameFor("nope","classic")).toBeNull();
  });
});

describe("artwork intake (in memory, fail closed)",()=>{
  const png=(w:number,h:number,ch:3|4=3,bg={r:120,g:90,b:60,alpha:1})=>sharp({create:{width:w,height:h,channels:ch,background:bg}}).png().toBuffer();
  it("accepts a normal image and applies EXIF orientation",async()=>{
    const j=await sharp({create:{width:1200,height:900,channels:3,background:"#445566"}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const r=await prepareArtwork(j);
    expect(r.ok&&[r.image.width,r.image.height]).toEqual([900,1200]);
  });
  it("flattens transparency onto white and says so",async()=>{
    const r=await prepareArtwork(await png(1000,1000,4,{r:0,g:0,b:0,alpha:0}));
    expect(r.ok).toBe(true);if(!r.ok) return;
    expect(Array.from(r.image.data.slice(0,4))).toEqual([255,255,255,255]);expect(r.note).toContain("flattened");
  });
  it("rejects empty, unreadable, tiny, huge, extreme-aspect and unsupported files",async()=>{
    expect(await prepareArtwork(Buffer.alloc(0))).toEqual({ok:false,error:"ARTWORK_EMPTY"});
    expect(await prepareArtwork(Buffer.from("not an image at all"))).toEqual({ok:false,error:"ARTWORK_UNREADABLE"});
    expect(await prepareArtwork(await png(300,300))).toEqual({ok:false,error:"ARTWORK_TOO_SMALL"});
    expect(await prepareArtwork(await png(5000,1000))).toEqual({ok:false,error:"ARTWORK_ASPECT_EXTREME"});
    expect(await prepareArtwork(await sharp({create:{width:1200,height:900,channels:3,background:"#000"}}).gif().toBuffer())).toEqual({ok:false,error:"ARTWORK_FORMAT_UNSUPPORTED"});
    expect(ARTWORK_LIMITS.maxSide).toBe(8000);
  });
});

describe("social crops never cut the product",()=>{
  const W=2560,H=1440;
  it("keeps the whole frame inside the window, the margins and the safe zones for every format",()=>{
    const frames=[quadAt(1100,500,200,260),quadAt(1000,450,330,440),quadAt(1400,600,300,220),quadAt(700,420,440,330)];
    for(const q of frames)for(const f of SOCIAL_FORMATS){
      const p=planSocialCrop(W,H,q,f);expect(p.ok,`${f.key}`).toBe(true);if(!p.ok) continue;
      const c=p.crop,x0=Math.min(...q.map(a=>a.x)),x1=Math.max(...q.map(a=>a.x)),y0=Math.min(...q.map(a=>a.y)),y1=Math.max(...q.map(a=>a.y));
      expect(c.left).toBeGreaterThanOrEqual(0);expect(c.top).toBeGreaterThanOrEqual(0);expect(c.left+c.width).toBeLessThanOrEqual(W);expect(c.top+c.height).toBeLessThanOrEqual(H);
      expect(Math.abs(c.width/c.height-f.width/f.height)).toBeLessThan(0.01);
      expect(x0).toBeGreaterThanOrEqual(c.left+c.width*0.06-1);expect(x1).toBeLessThanOrEqual(c.left+c.width*0.94+1);
      expect(y0).toBeGreaterThanOrEqual(c.top+c.height*(f.safeTop+0.06)-1);expect(y1).toBeLessThanOrEqual(c.top+c.height*(1-f.safeBottom-0.06)+1);
    }
  });
  it("refuses instead of cropping when the frame cannot fit or sits at the image edge",()=>{
    const story=SOCIAL_FORMATS.find(f=>f.key==="story_9x16")!;
    expect(planSocialCrop(W,H,quadAt(100,100,2000,1200),story)).toEqual({ok:false,error:"FRAME_TOO_LARGE_FOR_FORMAT"});
    const r=planSocialCrop(W,H,quadAt(2400,500,150,200),SOCIAL_FORMATS[0]);
    expect(r.ok).toBe(false);
  });
});

describe("social files",()=>{
  let master:RawImage;let q:Quad;
  beforeAll(()=>{master=landscapeArt(2560,1440,5);q=quadAt(1100,450,260,340);});
  it("renders exact sizes as small sRGB JPEGs without metadata",async()=>{
    for(const f of SOCIAL_FORMATS){
      const r=await renderSocial(master,q,f);expect(r.ok,f.key).toBe(true);if(!r.ok) continue;
      expect(r.file.bytes.length).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
      const m=await sharp(r.file.bytes).metadata();
      expect([m.format,m.width,m.height]).toEqual(["jpeg",f.width,f.height]);
      expect(m.exif).toBeUndefined();expect(m.icc).toBeUndefined();expect(m.space).toBe("srgb");
    }
  });
  it("the lossless master is a PNG of the same size",async()=>{
    const b=await renderMasterPng(master);const m=await sharp(b).metadata();expect([m.format,m.width,m.height]).toEqual(["png",2560,1440]);
  });
  it("refuses an export whose frame cannot be placed",async()=>{
    expect(await renderSocial(master,quadAt(0,0,2500,1400),SOCIAL_FORMATS[2])).toEqual({ok:false,error:"FRAME_TOO_LARGE_FOR_FORMAT"});
  });
});

describe("captions",()=>{
  const size=SIZES[6];
  it("every variant for both platforms is ≤ 3 sentences, free of prices/offers/claims and within hashtag limits",()=>{
    for(const platform of ["Instagram","Facebook"] as const)for(let v=0;v<6;v++)for(const m of MOUNTS){
      const c=buildCaption({platform,size,styleLabel:"Walnut",mountLabel:m.label,variant:v});
      expect(c.problems,`${platform} v${v} ${m.id}`).toEqual([]);
      expect(c.text).toContain("60×80 cm");
      expect(c.hashtags.length).toBe(platform==="Instagram"?8:3);
      expect(c.altText).toContain("visualisation");
    }
  });
  it("reads naturally about the mount",()=>{
    const t=(m:string,v:number)=>buildCaption({platform:"Instagram",size,styleLabel:"Oak",mountLabel:m,variant:v}).text;
    expect(t("Classic mount (4 cm)",0)).toContain("oak frame with a classic mount.");
    expect(t("No mount",0)).toContain("oak frame.");expect(t("No mount",1)).not.toContain("with a");
    expect(t("Narrow mount (2.5 cm)",1)).toContain(", with a narrow mount.");
  });
  it("regeneration changes the wording",()=>{
    const a=buildCaption({platform:"Instagram",size,styleLabel:"Oak",mountLabel:"Classic mount (4 cm)",variant:0}).text,b=buildCaption({platform:"Instagram",size,styleLabel:"Oak",mountLabel:"Classic mount (4 cm)",variant:1}).text;
    expect(a).not.toBe(b);
  });
  it("the checker catches prices, offers, long copy and hashtag spam",()=>{
    const bad=(t:string,tags:string[]=[],p:"Instagram"|"Facebook"="Instagram")=>captionProblems({text:t,tags,platform:p});
    expect(bad("Only £25 today.").some(x=>x.startsWith("FORBIDDEN"))).toBe(true);
    expect(bad("Free delivery on all frames.").some(x=>x.startsWith("FORBIDDEN"))).toBe(true);
    expect(bad("One. Two. Three. Four.")).toContain("MORE_THAN_THREE_SENTENCES");
    expect(bad("ok",Array(11).fill("#a"))).toContain("TOO_MANY_HASHTAGS");
    expect(bad("ok",Array(4).fill("#a"),"Facebook")).toContain("TOO_MANY_HASHTAGS");
    expect(countSentences("A. B! C?")).toBe(3);
  });
});

describe("Content Tracker and Google Drive hand-off",()=>{
  const file=(format:"feed_4x5"|"landscape_191x100")=>({format,width:1080,height:1350,bytes:Buffer.from("jpegbytes"),quality:90,upscale:1,crop:{left:0,top:0,width:1,height:1},mime:"image/jpeg" as const});
  const cap=(p:"Instagram"|"Facebook")=>buildCaption({platform:p,size:SIZES[0],styleLabel:"Oak",mountLabel:"Narrow mount (2.5 cm)"});
  const hand=(files=[file("feed_4x5"),file("landscape_191x100")])=>({id:"V4-20261013-0001",title:"Framed print 30×40 cm",files,captions:{Instagram:cap("Instagram"),Facebook:cap("Facebook")},sizeLabel:"30×40 cm",styleLabel:"Oak",roomIllustrative:true,provenance:"Deterministic V3 render."});
  it("builds a tracker item with the fields the existing feed uses",()=>{
    const t=buildTrackerItem(hand());
    expect(Object.keys(t).sort()).toEqual(["caption","category","files","format","id","notes","platforms","source","status","title","website"]);
    expect(t.status).toBe("New");expect(t.platforms).toEqual(["Instagram","Facebook"]);expect(t.website).toBe(false);expect(t.notes).toContain("illustration");
    const fbOnly=buildTrackerItem(hand([file("landscape_191x100")]));expect(fbOnly.platforms).toEqual(["Facebook"]);
  });
  it("uses the exact Apps Script upload body the V2 routes send",()=>{
    const b=buildDriveUploadBody(file("feed_4x5"),"V4-1","Bespoke Framing");
    expect(Object.keys(b).sort()).toEqual(["action","base64","category","fileName","mimeType"]);
    expect(b).toMatchObject({action:"upload",category:"Bespoke Framing",fileName:"V4-1_feed_4x5.jpg",mimeType:"image/jpeg"});
    expect(Buffer.from(b.base64,"base64").toString()).toBe("jpegbytes");
    expect(buildDrivePlan(hand()).map(p=>p.fileName)).toEqual([fileNameFor("V4-20261013-0001","feed_4x5"),fileNameFor("V4-20261013-0001","landscape_191x100")]);
  });
  it("never pushes without confirmation, a feed URL and a token; reports failures per file",async()=>{
    const f=vi.fn(async()=>new Response(JSON.stringify({ok:true}),{status:200}));
    await expect(pushToDrive({confirm:false,feedUrl:"https://x.test/exec",feedToken:"t",files:[file("feed_4x5")],id:"V4-1",category:"Bespoke Framing",fetchImpl:f as never})).rejects.toThrow("DRIVE_PUSH_NOT_CONFIRMED");
    await expect(pushToDrive({confirm:true,files:[file("feed_4x5")],id:"V4-1",category:"Bespoke Framing",fetchImpl:f as never})).rejects.toThrow("DRIVE_FEED_NOT_CONFIGURED");
    expect(f).not.toHaveBeenCalled();
    const ok=await pushToDrive({confirm:true,feedUrl:"https://x.test/exec",feedToken:"tok",files:[file("feed_4x5")],id:"V4-1",category:"Bespoke Framing",fetchImpl:f as never});
    expect(ok).toEqual([{fileName:"V4-1_feed_4x5.jpg",ok:true,error:undefined}]);
    const call=(f.mock.calls[0] as unknown as [URL,RequestInit]);expect(String(call[0])).toBe("https://x.test/exec?token=tok");expect(call[1].method).toBe("POST");
    const bad=vi.fn(async()=>new Response(JSON.stringify({ok:false,error:"quota"}),{status:200}));
    expect((await pushToDrive({confirm:true,feedUrl:"https://x.test/exec",feedToken:"t",files:[file("feed_4x5")],id:"V4-1",category:"Bespoke Framing",fetchImpl:bad as never}))[0]).toMatchObject({ok:false,error:"quota"});
  });
});

describe("AI room generation request (never run here)",()=>{
  it("the brief asks for the required scene and forbids art, text and people",()=>{
    const p=buildRoomPrompt();
    for(const w of ["English living room","sofa","plants","books","natural daylight","EMPTY","door frame or window frame"]) expect(p.toLowerCase()).toContain(w.toLowerCase().replace("english living room","english living room"));
    for(const w of ["frame","poster","text","people"]) expect(p.toLowerCase()).toContain(w);
    expect(ROOM_BRIEF.must.length).toBeGreaterThanOrEqual(6);
  });
  it("builds a schema-valid request: documented fields only, 16-divisible size, no response_format",()=>{
    const r=buildRoomGenRequest();
    expect(Object.keys(r.body).sort()).toEqual(["model","n","output_format","prompt","quality","size"]);
    expect(r.body.size).toBe(ROOM_SIZE);const [w,h]=r.body.size.split("x").map(Number);expect(w%16).toBe(0);expect(h%16).toBe(0);
    expect(r.url).toBe("https://api.openai.com/v1/images/generations");
    expect(()=>buildRoomGenRequest({size:"2500x1400"})).toThrow("SIZE_NOT_DIVISIBLE_BY_16");
    expect(()=>buildRoomGenRequest({size:"4096x2304"})).toThrow("SIZE_ABOVE_MAXIMUM");
    expect(()=>buildRoomGenRequest({size:"3840x1008"})).toThrow("SIZE_ASPECT_OUT_OF_RANGE");
    expect(()=>buildRoomGenRequest({model:"dall-e-3"})).toThrow("MODEL_NOT_VERIFIED");
  });
  it("no network without authorisation, cap, price and key; exactly one call when allowed",async()=>{
    const png=await sharp({create:{width:16,height:16,channels:3,background:"#888"}}).png().toBuffer();
    const f=vi.fn(async()=>new Response(JSON.stringify({data:[{b64_json:png.toString("base64")}]}),{status:200}));
    const req=buildRoomGenRequest();
    for(const cfg of [{authorized:false,capUsd:1,pricePerCallUsd:0.2},{authorized:true,capUsd:0,pricePerCallUsd:0.2},{authorized:true,capUsd:1,pricePerCallUsd:null},{authorized:true,capUsd:0.1,pricePerCallUsd:0.2}])
      await expect(generateRoom(req,{guard:new SpendGuard(cfg as never),apiKey:()=>"sk",fetchImpl:f as never})).rejects.toBeInstanceOf(SpendGuardError);
    await expect(generateRoom(req,{guard:new SpendGuard({authorized:true,capUsd:1,pricePerCallUsd:0.2}),apiKey:()=>undefined,fetchImpl:f as never})).rejects.toThrow("OPENAI_API_KEY_MISSING");
    expect(f).not.toHaveBeenCalled();
    const g=new SpendGuard({authorized:true,capUsd:1,pricePerCallUsd:0.2});
    const buf=await generateRoom(req,{guard:g,apiKey:()=>"sk-test",fetchImpl:f as never});
    expect(buf.length).toBeGreaterThan(10);expect(f).toHaveBeenCalledTimes(1);
    const [url,init]=f.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/generations");expect((init.headers as Record<string,string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string).model).toBe("gpt-image-2");
    await expect(generateRoom(req,{guard:g,apiKey:()=>"sk-test",fetchImpl:f as never})).rejects.toBeInstanceOf(SpendGuardError);
  });
});

describe("room generation script is a dry run unless fully authorised",()=>{
  const run=(args:string[])=>spawnSync("npx",["tsx","scripts/v4-generate-room.ts",...args],{encoding:"utf8",env:{...process.env,OPENAI_API_KEY:""},timeout:120000});
  it("dry run exits 0 and prints the request; every incomplete authorisation is refused",()=>{
    const d=run([]);expect(d.status,d.stderr).toBe(0);expect(d.stdout).toContain("DRY RUN: no network call was made");expect(d.stdout).toContain('"size": "2560x1440"');expect(d.stdout).toContain("EMPTY");
    for(const a of [["--execute"],["--execute","--authorize-paid"],["--execute","--authorize-paid","--max-spend-usd","1"],["--execute","--authorize-paid","--max-spend-usd","1","--price-per-image-usd","0.3"]]){
      const r=run(a);expect(r.status,a.join(" ")+r.stdout.slice(-300)).toBe(3);expect(r.stderr).toContain("REFUSED");
    }
  },240000);
});
