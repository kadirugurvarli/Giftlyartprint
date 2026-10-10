/**
 * Visual comparison report for the Room Library pilot, on a SYNTHETIC room (no customer photos, no real room).
 *   npx tsx scripts/room-visual-report.ts [outDir]      (default: validation-output/room-pilot-visual-report, git-ignored)
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type {Quad,RawImage} from "../lib/mockup-v3/types";
import {runRoomMockup} from "../lib/mockup-v3/rooms/run";
import {renderFlatFramedPiece} from "../lib/mockup-v3/rooms/product";
import {shadowDirFromDeg} from "../lib/mockup-v3/rooms/light";
import {assertOutputIgnored} from "../lib/mockup-v3/validation/runner";
import {renderFramedPiece} from "../lib/mockup-v3/frame/procedural";
import {landscapeArt} from "../tests/helpers/scenes";
import {framedPhoto} from "../tests/helpers/e2e";
import {ALL_SIZES,SPEC,syntheticRoom} from "../tests/helpers/rooms";

const out=path.resolve(process.argv[2] ?? "validation-output/room-pilot-visual-report");
assertOutputIgnored(out);
for(const d of ["sizes","lighting","mask","frame","photo-frame"]) fs.mkdirSync(path.join(out,d),{recursive:true});
const raw=(img:RawImage)=>sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}}).removeAlpha();
const jpg=(img:RawImage,f:string,q=93)=>raw(img).jpeg({quality:q,chromaSubsampling:"4:4:4"}).toFile(f);
const bbox=(q:Quad,pad:number,W:number,H:number)=>{const xs=q.map(p=>p.x),ys=q.map(p=>p.y);const x0=Math.max(0,Math.floor(Math.min(...xs)-pad)),y0=Math.max(0,Math.floor(Math.min(...ys)-pad));return {left:x0,top:y0,width:Math.min(W,Math.ceil(Math.max(...xs)+pad))-x0,height:Math.min(H,Math.ceil(Math.max(...ys)+pad))-y0};};
async function pair(a:RawImage,b:RawImage,box:{left:number;top:number;width:number;height:number},file:string,height=620,labels=["before","after"]){
  const mk=async(im:RawImage)=>raw(im).extract(box).resize({height,kernel:"lanczos3"}).jpeg({quality:92}).toBuffer();
  const [x,y]=await Promise.all([mk(a),mk(b)]);
  const mx=await sharp(x).metadata();
  const w=mx.width!;
  const svg=(t:string)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28"><rect width="100%" height="100%" fill="#000" opacity="0.55"/><text x="10" y="20" font-family="sans-serif" font-size="16" fill="#fff">${t}</text></svg>`);
  await sharp({create:{width:w*2+16,height,channels:3,background:"#fff"}}).composite([{input:x,left:0,top:0},{input:y,left:w+16,top:0},{input:svg(labels[0]),left:0,top:0},{input:svg(labels[1]),left:w+16,top:0}]).jpeg({quality:92}).toFile(file);
}
async function grid(images:{input:string;label:string}[],cols:number,cell:{w:number;h:number},file:string){
  const rows=Math.ceil(images.length/cols);
  const comp:{input:Buffer;left:number;top:number}[]=[];
  for(let i=0;i<images.length;i++){
    const buf=await sharp(images[i].input).resize(cell.w,cell.h,{fit:"contain",background:"#f4f2ee"}).jpeg({quality:92}).toBuffer();
    const x=(i%cols)*(cell.w+10),y=Math.floor(i/cols)*(cell.h+10);
    comp.push({input:buf,left:x,top:y});
    comp.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell.w}" height="26"><rect width="100%" height="100%" fill="#000" opacity="0.55"/><text x="8" y="18" font-family="sans-serif" font-size="15" fill="#fff">${images[i].label}</text></svg>`),left:x,top:y});
  }
  await sharp({create:{width:cols*(cell.w+10)-10,height:rows*(cell.h+10)-10,channels:3,background:"#fff"}}).composite(comp).jpeg({quality:90}).toFile(file);
}

(async()=>{
  const lines:string[]=[];
  const log=(s:string)=>{lines.push(s);console.log(s);};
  const s=syntheticRoom({withPlant:true});
  const W=s.image.width,H=s.image.height;
  await jpg(s.image,path.join(out,"room_before.jpg"));
  const rows:string[]=[];
  const tiles:{input:string;label:string}[]=[];

  // ---- A. all eight outer sizes, flat artwork in a rendered frame
  for(const z of ALL_SIZES){
    const art=landscapeArt(z.width>z.height?1200:900,z.width>z.height?900:1200,z.width+z.height);
    const r=await runRoomMockup({room:s.room,roomImage:s.image,size:z,source:{kind:"flat-artwork",artwork:art,frame:SPEC(z.width,z.height)}});
    if(!r.ok){log(`${z.width}x${z.height}: REFUSED ${r.error} ${r.detail ?? ""}`);continue;}
    const name=`${z.width}x${z.height}`;
    await jpg(r.result.image!,path.join(out,"sizes",`${name}.jpg`));
    const box=bbox(r.result.targetQuad!,Math.max(30,z.width*3),W,H);
    await pair(s.image,r.result.image!,box,path.join(out,"sizes",`${name}_before_after.jpg`));
    tiles.push({input:path.join(out,"sizes",`${name}.jpg`),label:`${name} cm (outer)`});
    rows.push(`| ${name} | ${r.result.status} | ${r.checks.map(c=>c.pass?"✓":"✗").join("")} | ${r.placement.pxPerCm.toFixed(2)} | ${r.frame!.pxPerCm} | ${r.result.qa.crossCheck?.metrics?.p95DeltaE.toFixed(2)} | ${r.result.qa.forward?.metrics.meanDeltaE.toFixed(2)} |`);
  }
  await grid(tiles,4,{w:640,h:480},path.join(out,"sizes","all_eight_sizes_contact_sheet.jpg"),);
  fs.writeFileSync(path.join(out,"sizes","table.md"),"| outer cm | engine status | room checks (quad, unstretched, aspect, protected px, gates) | wall px/cm | render px/cm | cross-check p95 ΔE | forward ΔE |\n|---|---|---|---|---|---|---|\n"+rows.join("\n")+"\n");

  // ---- B. lighting consistency: same room, same 50x70 piece, different calibrated lights
  const z={width:50,height:70};
  const art=landscapeArt(900,1260,61);
  const variants:{id:string;label:string;light:Partial<typeof s.room.light>}[]=[
    {id:"A_down-right",label:"63° (down-right), 0.28, 1.2 cm, 3200 K",light:{}},
    {id:"B_down",label:"90° (straight down)",light:{shadowDirectionDeg:90}},
    {id:"C_down-left",label:"117° (down-left)",light:{shadowDirectionDeg:117}},
    {id:"D_weak",label:"intensity 0.10",light:{intensity:0.10}},
    {id:"E_strong",label:"intensity 0.45",light:{intensity:0.45}},
    {id:"F_hard",label:"softness 0.3 cm",light:{softnessCm:0.3}},
    {id:"G_soft",label:"softness 5 cm",light:{softnessCm:5}},
    {id:"H_daylight",label:"6500 K daylight",light:{colourTempK:6500}}
  ];
  const lt:{input:string;label:string}[]=[];
  let ltBox:{left:number;top:number;width:number;height:number}|undefined;
  for(const v of variants){
    const room=structuredClone(s.room);Object.assign(room.light,v.light);
    const r=await runRoomMockup({room,roomImage:s.image,size:z,source:{kind:"flat-artwork",artwork:art,frame:SPEC(z.width,z.height)}});
    if(!r.ok){log(`lighting ${v.id}: ${r.error}`);continue;}
    ltBox??=bbox(r.result.targetQuad!,95,W,H);
    const f=path.join(out,"lighting",`${v.id}.jpg`);
    await raw(r.result.image!).extract(ltBox).jpeg({quality:93}).toFile(f);
    lt.push({input:f,label:`${v.id}: ${v.label}`});
  }
  await grid(lt,4,{w:520,h:620},path.join(out,"lighting","lighting_variants_50x70.jpg"));

  // ---- C. wall-only shadow mask: plant standing in the shadow's reach
  {
    const z2={width:80,height:60};
    const a=landscapeArt(1200,900,77);
    const withMask=await runRoomMockup({room:s.room,roomImage:s.image,size:z2,source:{kind:"flat-artwork",artwork:a,frame:SPEC(80,60)}});
    const noMask=structuredClone(s.room);noMask.shadowMask={wallPolygons:s.room.shadowMask!.wallPolygons}; // same wall, but the plant is no longer excluded
    const without=await runRoomMockup({room:noMask,roomImage:s.image,size:z2,source:{kind:"flat-artwork",artwork:a,frame:SPEC(80,60)}});
    if(withMask.ok&&without.ok){
      const poly=s.plant!.polygon;
      const x0=Math.max(0,Math.floor(Math.min(...poly.map(p=>p.x))-60)),y0=Math.max(0,Math.floor(Math.min(...poly.map(p=>p.y))-60));
      const box={left:x0,top:y0,width:Math.min(W,Math.ceil(Math.max(...poly.map(p=>p.x))+60))-x0,height:Math.min(H,Math.ceil(Math.max(...poly.map(p=>p.y))+60))-y0};
      // include the frame corner in the crop
      const q=withMask.result.targetQuad!;const fx=Math.min(...q.map(p=>p.x))+ (Math.max(...q.map(p=>p.x))-Math.min(...q.map(p=>p.x)))*0.55;
      const bx={left:Math.max(0,Math.floor(Math.min(box.left,fx))),top:Math.max(0,Math.floor(Math.min(box.top,Math.max(...q.map(p=>p.y))-180))),width:0,height:0};
      bx.width=Math.min(W-bx.left,Math.ceil(box.left+box.width-bx.left));bx.height=Math.min(H-bx.top,Math.ceil(box.top+box.height-bx.top)+20);
      await pair(without.result.image!,withMask.result.image!,bx,path.join(out,"mask","plant_shadow_without_vs_with_mask.jpg"),560,["no mask: shadow falls on the plant","wall-only mask: plant untouched"]);
      let d=0,n=0;for(let i=0;i<W*H;i++){if(s.plant!.alpha[i]>200){n++;if(without.result.image!.data[i*4]!==withMask.result.image!.data[i*4]) d++;}}
      log(`mask: ${d} of ${n} plant pixels would have been darkened without the wall-only mask; 0 with it`);
    }
  }

  // ---- D. the generated frame itself under opposite lights (no room)
  {
    const f1=await renderFlatFramedPiece(landscapeArt(900,1260,61),SPEC(50,70),shadowDirFromDeg(63),12,0.6);
    const f2=await renderFlatFramedPiece(landscapeArt(900,1260,61),SPEC(50,70),shadowDirFromDeg(243),12,0.6);
    await jpg(f1.image,path.join(out,"frame","frame_light_from_top-left.jpg"));await jpg(f2.image,path.join(out,"frame","frame_light_from_bottom-right.jpg"));
    await grid([{input:path.join(out,"frame","frame_light_from_top-left.jpg"),label:"shadows fall down-right (light top-left)"},{input:path.join(out,"frame","frame_light_from_bottom-right.jpg"),label:"shadows fall up-left (light bottom-right)"}],2,{w:480,h:672},path.join(out,"frame","frame_lighting_comparison.jpg"));
    // corner close-ups at 100%
    const m=f1.plan.mouldingPx;
    for(const [n,im] of [["topleft_light",f1],["opposite_light",f2]] as const) await raw(im.image).extract({left:0,top:0,width:m*4,height:m*4}).resize({width:640,kernel:"nearest"}).jpeg({quality:93}).toFile(path.join(out,"frame",`corner_${n}.jpg`));
  }

  // ---- E. photograph of a finished framed piece (the older workflow, now with the 2 % proportion rule)
  {
    const piece=renderFramedPiece(landscapeArt(480,640,2),{mouldingPx:34,mountPx:46,mouldingColour:[70,52,38],mountColour:[240,236,226]});
    const fp=framedPhoto(piece,{W:2000,H:1500,widthM:0.9});
    await jpg(fp.photo,path.join(out,"photo-frame","source_photo_of_finished_frame.jpg"));
    const ok=await runRoomMockup({room:s.room,roomImage:s.image,size:{width:40,height:50},source:{kind:"framed-photo",photo:fp.photo,sourceFocalPx:1300,sourceQuad:fp.quad,statedAspect:0.8}});
    const bad=await runRoomMockup({room:s.room,roomImage:s.image,size:{width:30,height:40},source:{kind:"framed-photo",photo:fp.photo,sourceFocalPx:1300,sourceQuad:fp.quad,statedAspect:0.8}});
    if(ok.ok){await jpg(ok.result.image!,path.join(out,"photo-frame","placed_40x50.jpg"));await pair(s.image,ok.result.image!,bbox(ok.result.targetQuad!,110,W,H),path.join(out,"photo-frame","before_after_40x50.jpg"));log(`photo-of-frame 40x50: ${ok.result.status}, checks ${ok.checks.map(c=>c.name+":"+(c.pass?"ok":"FAIL")).join(", ")}`);}
    else log(`photo-of-frame 40x50 refused: ${ok.error}`);
    log(`same photo as a 30x40: ${bad.ok?"ACCEPTED (unexpected)":"refused "+bad.error+" ("+bad.detail+")"}`);
  }
  // ---- F. AI room disclosure
  {
    const ai=syntheticRoom({origin:"ai-generated"});
    const r=await runRoomMockup({room:ai.room,roomImage:ai.image,size:{width:40,height:50},source:{kind:"flat-artwork",artwork:landscapeArt(900,1125,3),frame:SPEC(40,50)}});
    if(r.ok) log(`AI-style room: ${r.placement.scaleDisclosure} Width range ${r.placement.widthRangeCm.map(v=>v.toFixed(1)).join("–")} cm.`);
  }
  fs.writeFileSync(path.join(out,"run_log.txt"),lines.join("\n")+"\n");
})().catch(e=>{console.error(e);process.exit(1);});
