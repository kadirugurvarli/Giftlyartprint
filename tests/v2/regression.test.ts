import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {extractProtectedProduct,renderVariant,getPreset} from "@/lib/giftly-v2-compositor";
import {PLATFORM_PRESETS} from "@/lib/giftly-content-policy";
import {backgroundHasHardDefect} from "@/lib/giftly-v2-director";

/**
 * V2 regression suite (characterisation). V2 had no tests; this pins the behaviour of its
 * sharp-dependent code so a sharp upgrade can be proven safe. It exercises V2's REAL compositor
 * functions plus every distinct sharp feature the V2 routes use, on deterministic synthetic
 * inputs, and compares against fingerprints recorded under the previous sharp version.
 *
 *   UPDATE_V2_GOLDENS=1 npx vitest run tests/v2     (re-record; review the diff)
 */
const FILE=path.resolve(__dirname,"fingerprints.json");
const update=process.env.UPDATE_V2_GOLDENS==="1";
const store:Record<string,any>=fs.existsSync(FILE)?JSON.parse(fs.readFileSync(FILE,"utf8")):{};
const recorded:Record<string,any>={...store};

type Fp={w:number;h:number;grid:number[]};
async function fingerprint(buf:Buffer,cells=24):Promise<Fp>{
  const {data,info}=await sharp(buf).ensureAlpha().resize(cells,cells,{fit:"fill",kernel:"nearest"}).raw().toBuffer({resolveWithObject:true});
  const meta=await sharp(buf).metadata();
  void info;
  return {w:meta.width!,h:meta.height!,grid:Array.from(data)};
}
/** area-average fingerprint independent of resize kernel changes: manual block means */
async function blockFingerprint(buf:Buffer,cells=24):Promise<Fp>{
  const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const grid:number[]=[];
  for(let cy=0;cy<cells;cy++) for(let cx=0;cx<cells;cx++){
    const x0=Math.floor(cx*info.width/cells),x1=Math.max(x0+1,Math.floor((cx+1)*info.width/cells));
    const y0=Math.floor(cy*info.height/cells),y1=Math.max(y0+1,Math.floor((cy+1)*info.height/cells));
    const s=[0,0,0,0];let n=0;
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){for(let c=0;c<4;c++) s[c]+=data[(y*info.width+x)*4+c];n++;}
    for(let c=0;c<4;c++) grid.push(Math.round(s[c]/n));
  }
  return {w:info.width,h:info.height,grid};
}
async function check(name:string,buf:Buffer,tol:number){
  const fp=await blockFingerprint(buf);
  recorded[name]=fp;
  if(update) return;
  const want:Fp|undefined=store[name];
  expect(want,`no recorded fingerprint for ${name}; run with UPDATE_V2_GOLDENS=1 on the known-good version`).toBeDefined();
  expect({w:fp.w,h:fp.h}).toEqual({w:want!.w,h:want!.h});
  let max=0;
  for(let i=0;i<fp.grid.length;i++) max=Math.max(max,Math.abs(fp.grid[i]-want!.grid[i]));
  expect(max,`${name}: max block difference`).toBeLessThanOrEqual(tol);
}
void fingerprint;

// deterministic synthetic inputs ------------------------------------------------------------
function raw(w:number,h:number,f:(x:number,y:number)=>[number,number,number,number]){
  const b=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){const [r,g,bl,a]=f(x,y);const o=(y*w+x)*4;b[o]=r;b[o+1]=g;b[o+2]=bl;b[o+3]=a;}
  return sharp(b,{raw:{width:w,height:h,channels:4}});
}
const scene=()=>raw(900,1200,(x,y)=>[Math.round(200-60*y/1200),Math.round(190-40*x/900),Math.round(170+30*y/1200),255]).png().toBuffer();
const art=()=>raw(600,400,(x,y)=>{
  const inFrame=x<14||y<14||x>585||y>385;
  if(inFrame) return [58,42,30,255];
  return [Math.round(40+200*x/600),Math.round(60+150*y/400),Math.round(200-120*x/600),255];
}).png().toBuffer();
const logo=()=>raw(400,100,(x,y)=>(x>20&&x<380&&y>20&&y<80)?[20,20,20,255]:[0,0,0,0]).png().toBuffer();

describe("V2 compositor (real functions)",()=>{
  it("extractProtectedProduct: protected crop honours the AI bounding box with padding",async()=>{
    const src=await art();
    const r=await extractProtectedProduct(src,{rectangular:true,confidence:0.9,bbox:{x:100,y:100,width:800,height:800},notes:""});
    expect(r.mode).toBe("protected-crop");
    expect(r.sourceWidth).toBeGreaterThan(450);expect(r.sourceWidth).toBeLessThan(540);
    await check("v2.extract.crop",r.buffer,2);
  });
  it("extractProtectedProduct: low-confidence analysis falls back to the whole (rotated) source",async()=>{
    const src=await art();
    const r=await extractProtectedProduct(src,{rectangular:true,confidence:0.5,bbox:{x:0,y:0,width:1000,height:1000},notes:""});
    expect(r.mode).toBe("source-card");
    expect(r.sourceWidth).toBe(600);expect(r.sourceHeight).toBe(400);
  });
  it("EXIF orientation is applied (phone photos): orientation 6 swaps dimensions",async()=>{
    const jpeg=await sharp(await art()).withMetadata({orientation:6}).jpeg({quality:92}).toBuffer();
    expect((await sharp(jpeg).metadata()).orientation).toBe(6);
    const r=await extractProtectedProduct(jpeg,{rectangular:false,confidence:0,bbox:{x:0,y:0,width:1000,height:1000},notes:""});
    expect(r.sourceWidth).toBe(400);expect(r.sourceHeight).toBe(600);
    await check("v2.extract.exif6",r.buffer,8);
  });
  for(const preset of PLATFORM_PRESETS){
    it(`renderVariant ${preset.key}: size, placement, defects and pixels are stable`,async()=>{
      const src=await art();
      const prod=await extractProtectedProduct(src,{rectangular:true,confidence:0.9,bbox:{x:0,y:0,width:1000,height:1000},notes:""});
      const out=await renderVariant({background:await scene(),product:prod.buffer,productMode:prod.mode,preset,logo:await logo(),headline:"Handmade framing",cta:"Get a quote"});
      const meta=await sharp(out.buffer).metadata();
      expect({w:meta.width,h:meta.height}).toEqual({w:preset.width,h:preset.height});
      expect(out.placement.width).toBeGreaterThan(100);
      expect(out.placement.left).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(out.defects)).toBe(true);
      await check(`v2.render.${preset.key}`,out.buffer,4);
    });
  }
  it("getPreset resolves and rejects unknown keys",()=>{
    expect(getPreset("feed_4x5").width).toBe(1080);
    expect(()=>getPreset("nope")).toThrow(/Unknown platform preset/);
  });
  it("background QA decision logic is unchanged",()=>{
    expect(backgroundHasHardDefect({extraArtwork:false,personOrHands:false,readableText:false,centralObstruction:false})).toBe(false);
    expect(backgroundHasHardDefect({extraArtwork:true})).toBe(true);
    expect(backgroundHasHardDefect({centralObstruction:true})).toBe(true);
    expect(backgroundHasHardDefect(null)).toBe(false);
  });
});

describe("V2 route sharp features (same calls the routes make)",()=>{
  it("resize cover + blur + modulate (background plate)",async()=>{
    const out=await sharp(await art()).rotate().resize(400,500,{fit:"cover",position:"centre"}).blur(30).modulate({brightness:0.62,saturation:0.72}).png().toBuffer();
    await check("v2.feat.bg-plate",out,6);
  });
  it("resize contain with transparent background (foreground)",async()=>{
    const out=await sharp(await art()).resize(300,300,{fit:"contain",background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
    await check("v2.feat.contain",out,3);
  });
  it("composite with offsets over a solid canvas + metadata",async()=>{
    const base=sharp({create:{width:500,height:400,channels:4,background:{r:230,g:225,b:215,alpha:1}}});
    const out=await base.composite([{input:await logo(),left:40,top:30},{input:await sharp(await art()).resize(300,200).png().toBuffer(),left:120,top:140}]).png().toBuffer();
    expect((await sharp(out).metadata()).channels).toBe(4);
    await check("v2.feat.composite",out,3);
  });
  it("extract with clamped region",async()=>{
    const out=await sharp(await art()).extract({left:40,top:30,width:300,height:200}).png().toBuffer();
    await check("v2.feat.extract",out,1);
  });
  it("SVG overlay rasterisation (librsvg) as used for headline/CTA panels",async()=>{
    const svg=Buffer.from(`<svg width="320" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgba(255,255,255,0.9)"/><rect x="10" y="10" width="100" height="40" fill="#171717"/></svg>`);
    const out=await sharp({create:{width:400,height:200,channels:4,background:{r:90,g:120,b:150,alpha:1}}}).composite([{input:svg,left:20,top:20}]).png().toBuffer();
    await check("v2.feat.svg",out,3);
  });
  it("Pango text rendering works (glyph shapes are font-dependent, so structural checks only)",async()=>{
    const t=await sharp({text:{text:'<span foreground="#171717" font_weight="700">Bespoke framing</span>',font:"sans",width:500,height:60,align:"left",rgba:true,wrap:"word"}}).png().toBuffer();
    const m=await sharp(t).metadata();
    expect(m.width).toBeGreaterThan(20);expect(m.height).toBeGreaterThan(5);expect(m.hasAlpha).toBe(true);
    const {data}=await sharp(t).raw().toBuffer({resolveWithObject:true});
    let ink=0;for(let i=3;i<data.length;i+=4) if(data[i]>128) ink++;
    expect(ink).toBeGreaterThan(50);
  });
  it("JPEG encode/decode round trip stays within codec tolerance",async()=>{
    const png=await art();
    const jpg=await sharp(png).jpeg({quality:86}).toBuffer();
    const back=await sharp(jpg).png().toBuffer();
    await check("v2.feat.jpeg86",back,10);
  });
  it("png encode is lossless",async()=>{
    const png=await art();
    const a=await sharp(png).raw().toBuffer();
    const b=await sharp(await sharp(png).png().toBuffer()).raw().toBuffer();
    expect(a.equals(b)).toBe(true);
  });
});

it("(update mode) write fingerprints",()=>{
  if(update){
    fs.writeFileSync(FILE,JSON.stringify(recorded));
    console.log("[v2] recorded",Object.keys(recorded).length,"fingerprints with sharp",sharp.versions.sharp);
  }
});
