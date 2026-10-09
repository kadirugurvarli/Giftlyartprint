import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {formatPreflight,preflightFile,preflightFolder} from "@/lib/mockup-v3/validation/preflight";
import {buildManifestFromFolder} from "@/lib/mockup-v3/validation/intake";
import {fetchPrivateFiles,parseUrlList} from "@/lib/mockup-v3/validation/fetch";

const root=path.resolve(__dirname,"..","output","intake-selftest");
const fresh=(n:string)=>{const d=path.join(root,n);fs.rmSync(d,{recursive:true,force:true});fs.mkdirSync(d,{recursive:true});return d;};
const jpg=(w:number,h:number,exif?:Record<string,Record<string,string>>)=>{
  let s=sharp({create:{width:w,height:h,channels:3,background:"#9a8f80"}});
  if(exif) s=s.withExif(exif as any);
  return s.jpeg({quality:92}).toBuffer();
};
const codes=(r:{issues:{code:string}[]})=>r.issues.map((i)=>i.code);

describe("preflight",()=>{
  it("a good original passes with camera info and the derived focal length",async()=>{
    const d=fresh("good");
    fs.writeFileSync(path.join(d,"a.jpg"),await jpg(3200,2400,{IFD0:{Make:"TestCam",Model:"P1"},IFD2:{FocalLengthIn35mmFilm:"26"}}));
    const r=await preflightFile(path.join(d,"a.jpg"));
    expect(r.usable).toBe(true);
    expect(r.exif!.focalPx!).toBeGreaterThan(2000);
    expect(codes(r)).not.toContain("NO_EXIF");
  });
  it("HEIC is rejected with the iPhone fix, not a cryptic decode error",async()=>{
    const d=fresh("heic");
    const heic=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftypheic"),Buffer.alloc(200)]);
    fs.writeFileSync(path.join(d,"x.jpg"),heic); // even misnamed
    const r=await preflightFile(path.join(d,"x.jpg"));
    expect(r.usable).toBe(false);
    expect(codes(r)).toContain("HEIC_UNSUPPORTED");
    expect(r.issues[0].message).toMatch(/Most Compatible/);
  });
  it("flags screenshots, messenger copies, missing EXIF, low resolution and cropping hints",async()=>{
    const d=fresh("bad");
    fs.writeFileSync(path.join(d,"shot.png"),await sharp({create:{width:1170,height:2532,channels:3,background:"#fff"}}).png().toBuffer());
    fs.writeFileSync(path.join(d,"chat.jpg"),await jpg(1600,1200));
    fs.writeFileSync(path.join(d,"tiny.jpg"),await jpg(600,400));
    const s=await preflightFile(path.join(d,"shot.png")),c=await preflightFile(path.join(d,"chat.jpg")),t=await preflightFile(path.join(d,"tiny.jpg"));
    expect(codes(s)).toEqual(expect.arrayContaining(["NO_EXIF","LOOKS_LIKE_SCREENSHOT"]));
    expect(codes(c)).toEqual(expect.arrayContaining(["NO_EXIF","LIKELY_MESSENGER_COPY"]));
    expect(t.usable).toBe(false);expect(codes(t)).toContain("LOW_RESOLUTION");
  });
  it("garbage and empty files are errors, and GPS is reported only as a fact",async()=>{
    const d=fresh("junk");
    fs.writeFileSync(path.join(d,"e.jpg"),Buffer.alloc(0));
    fs.writeFileSync(path.join(d,"g.jpg"),Buffer.from("not an image at all"));
    fs.writeFileSync(path.join(d,"p.jpg"),await jpg(2400,1800,{IFD2:{FocalLengthIn35mmFilm:"28"},IFD3:{GPSLatitudeRef:"N",GPSLatitude:"51/1 16/1 30/1",GPSLongitudeRef:"E",GPSLongitude:"0/1 31/1 12/1"}}));
    expect(codes(await preflightFile(path.join(d,"e.jpg")))).toContain("EMPTY");
    expect((await preflightFile(path.join(d,"g.jpg"))).usable).toBe(false);
    const p=await preflightFile(path.join(d,"p.jpg"));
    const text=JSON.stringify(p)+formatPreflight([p]);
    expect(text).not.toMatch(/51\/1|latitude/i);
  });
  it("folder preflight treats *_mask files as masks (no resolution complaints)",async()=>{
    const d=fresh("mask");
    fs.writeFileSync(path.join(d,"A-01_mask.png"),await sharp(Buffer.alloc(900*700),{raw:{width:900,height:700,channels:1}}).png().toBuffer());
    const r=await preflightFolder(d);
    expect(r[0].usable).toBe(true);
    expect(codes(r[0])).not.toContain("LOW_RESOLUTION");
  });
});

describe("folder convention -> manifest",()=>{
  it("pairs files by id, infers the workflow from A/B, reads sidecars and masks",()=>{
    const d=fresh("conv");
    for(const f of ["A-01_source.jpg","A-01_reference.jpg","A-01_mask.png","B-02_source.JPG","B-02_reference.png","B-03_source.jpg","B-03_reference.jpg","notes.txt","stray.jpg"]) fs.writeFileSync(path.join(d,f),"x");
    fs.writeFileSync(path.join(d,"B-03.json"),JSON.stringify({options:{physicalWidthM:0.5},notes:"oak frame",groundTruth:{sourceQuad:[[1,1],[2,1],[2,2],[1,2]]}}));
    fs.writeFileSync(path.join(d,"A-01.json"),JSON.stringify({options:{artworkAspect:1.4142}}));
    const r=buildManifestFromFolder(d);
    expect(r.problems).toEqual([]);
    expect(r.cases).toBe(3);
    const a=r.manifest.cases.find((c)=>c.id==="A-01")!;
    expect(a.mode).toBe("artwork-in-frame");expect(a.manual?.occlusionMask).toBe("A-01_mask.png");expect(a.options?.artworkAspect).toBe(1.4142);
    const b=r.manifest.cases.find((c)=>c.id==="B-03")!;
    expect(b.mode).toBe("framed-on-wall");expect(b.notes).toBe("oak frame");expect(b.groundTruth?.sourceQuad).toBeDefined();
    expect(r.unmatched.sort()).toEqual(["notes.txt","stray.jpg"]);
  });
  it("reports incomplete pairs, unknown workflow and bad sidecars instead of guessing",()=>{
    const d=fresh("conv-bad");
    for(const f of ["A-01_source.jpg","C-09_source.jpg","C-09_reference.jpg","B-04_source.jpg","B-04_reference.jpg"]) fs.writeFileSync(path.join(d,f),"x");
    fs.writeFileSync(path.join(d,"B-04.json"),"{ not json");
    const r=buildManifestFromFolder(d);
    expect(r.cases).toBe(0);
    expect(r.problems.join("\n")).toMatch(/A-01: needs both/);
    expect(r.problems.join("\n")).toMatch(/C-09: cannot tell the workflow/);
    expect(r.problems.join("\n")).toMatch(/B-04\.json: not valid JSON/);
  });
});

describe("secure fetch (expiring links)",()=>{
  const ok=(body:Buffer,type="image/jpeg",extra:Record<string,string>={})=>async()=>new Response(new Uint8Array(body),{status:200,headers:{"content-type":type,...extra}});
  it("downloads to a private folder and never prints or stores the link",async()=>{
    const d=fresh("fetch");const logs:string[]=[];
    const secret="https://storage.example.com/obj?X-Signature=SECRETTOKEN123";
    const r=await fetchPrivateFiles([{name:"A-01_source.jpg",url:secret}],d,{fetchImpl:ok(Buffer.from("imagebytes")) as any,log:(m)=>logs.push(m)});
    expect(r[0].ok).toBe(true);
    expect(fs.readFileSync(path.join(d,"A-01_source.jpg")).toString()).toBe("imagebytes");
    expect(logs.join("\n")+JSON.stringify(r)).not.toContain("SECRETTOKEN123");
  });
  it("refuses http, unsafe names, share pages, expired links, oversize files; errors are scrubbed",async()=>{
    const d=fresh("fetch-bad");
    const f404=(async()=>new Response("",{status:403})) as any;
    const r=await fetchPrivateFiles([
      {name:"a.jpg",url:"http://example.com/a?sig=SECRETTOKEN123"},
      {name:"../evil.jpg",url:"https://example.com/a"},
      {name:"page.jpg",url:"https://example.com/share"},
      {name:"exp.jpg",url:"https://example.com/exp?sig=SECRETTOKEN123"},
      {name:"big.jpg",url:"https://example.com/big"}
    ],d,{fetchImpl:(async(u:string)=>{
      if(u.includes("share")) return new Response("<html>",{status:200,headers:{"content-type":"text/html"}});
      if(u.includes("exp")) return f404();
      if(u.includes("big")) return new Response("x",{status:200,headers:{"content-type":"image/jpeg","content-length":String(500*1024*1024)}});
      return new Response("x");
    }) as any,maxBytes:10*1024*1024});
    expect(r.map((x)=>x.ok)).toEqual([false,false,false,false,false]);
    expect(r[0].error).toMatch(/https/);expect(r[1].error).toMatch(/unsafe/);expect(r[2].error).toMatch(/content type/);
    expect(r[3].error).toMatch(/expired/);expect(r[4].error).toMatch(/size limit/);
    expect(JSON.stringify(r)).not.toContain("SECRETTOKEN123");
    expect(fs.existsSync(path.join(d,"a.jpg"))).toBe(false);
  });
  it("parses the link list and rejects malformed lines",()=>{
    expect(parseUrlList("# c\n\nA-01_source.jpg https://x.test/a\nB-01_source.jpg\thttps://x.test/b\n")).toHaveLength(2);
    expect(()=>parseUrlList("only-one-token")).toThrow();
  });
});
