/**
 * Example images from the V4 engine on the SYNTHETIC room (engine demo only: this is NOT evidence of photographic quality).
 *   npx tsx scripts/v4-examples.ts [outDir]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type {RawImage} from "../lib/mockup-v3/types";
import {assertOutputIgnored} from "../lib/mockup-v3/validation/runner";
import {buildCaption} from "../lib/mockup-v4/captions";
import {renderMockup} from "../lib/mockup-v4/engine";
import type {PackManifest} from "../lib/mockup-v4/pack";
import {renderSocial,SOCIAL_FORMATS} from "../lib/mockup-v4/social";
import {FRAME_STYLES,MOUNTS,SIZES} from "../lib/mockup-v4/styles";
import {landscapeArt} from "../tests/helpers/scenes";
import {syntheticRoom} from "../tests/helpers/rooms";

const out=path.resolve(process.argv[2] ?? "v4-output/examples");
assertOutputIgnored(out);
for(const d of ["sizes","social"]) fs.mkdirSync(path.join(out,d),{recursive:true});
const raw=(i:RawImage)=>sharp(Buffer.from(i.data.buffer,i.data.byteOffset,i.data.byteLength),{raw:{width:i.width,height:i.height,channels:4}}).removeAlpha();
const label=(w:number,t:string)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28"><rect width="100%" height="100%" fill="#000" opacity="0.6"/><text x="8" y="19" font-family="sans-serif" font-size="14" fill="#fff">${t}</text></svg>`);

(async()=>{
  const s=syntheticRoom({withPlant:true,scale:2});
  const manifest:PackManifest={schemaVersion:1,id:"synthetic-demo",roomImage:"r.png",artworkImage:"a.png",room:s.room,provenance:{kind:"synthetic-test",rightsCleared:true,licence:"in-process",emptyWallConfirmed:true},artwork:{origin:"synthetic-test",customer:false,licence:"in-process"},
    frame:{mouldingWidthCm:2.4,mountWidthCm:3.5,frameDepthCm:3,mouldingColour:[66,48,34],mountColour:[238,233,222],description:"walnut"}};
  const room={manifest,roomImage:s.image};
  const tiles:{input:Buffer;left:number;top:number}[]=[];const pw=620,ph=520;
  let i=0,hero:Awaited<ReturnType<typeof renderMockup>>|null=null;
  for(const z of SIZES){
    const style=FRAME_STYLES[i%FRAME_STYLES.length],mount=MOUNTS[(i+1)%MOUNTS.length];
    const art=z.orientation==="portrait"?landscapeArt(1500,2000,i+3):landscapeArt(2000,1500,i+3);
    const r=await renderMockup({room,artwork:art,size:z,style:style.id,mount:mount.id,mode:"baseline"});
    if(!r.ok){console.log(z.label,"FAILED",r.error,r.detail);i++;continue;}
    const name=`${z.width}x${z.height}_${style.id}_${mount.id}`;
    await raw(r.master).jpeg({quality:92}).toFile(path.join(out,"sizes",name+".jpg"));
    const xs=r.outerQuad.map(p=>p.x),ys=r.outerQuad.map(p=>p.y),pad=260;
    const box={left:Math.max(0,Math.floor(Math.min(...xs)-pad)),top:Math.max(0,Math.floor(Math.min(...ys)-pad))};
    const w=Math.min(r.master.width,Math.ceil(Math.max(...xs)+pad))-box.left,h=Math.min(r.master.height,Math.ceil(Math.max(...ys)+pad))-box.top;
    const crop=await raw(r.master).extract({...box,width:w,height:h}).resize(pw,ph,{fit:"contain",background:"#f4f2ee"}).jpeg({quality:90}).toBuffer();
    tiles.push({input:crop,left:(i%4)*(pw+10),top:Math.floor(i/4)*(ph+10)},{input:label(pw,`${z.label} · ${style.label} · ${mount.label}`),left:(i%4)*(pw+10),top:Math.floor(i/4)*(ph+10)});
    if(z.width===50&&z.height===70) hero=r;
    i++;
  }
  await sharp({create:{width:4*pw+30,height:2*ph+10,channels:3,background:"#fff"}}).composite(tiles).jpeg({quality:88}).toFile(path.join(out,"all_eight_sizes_contact_sheet.jpg"));
  if(hero&&hero.ok){
    const size=SIZES.find(z=>z.width===50&&z.height===70)!,st=FRAME_STYLES[4],mt=MOUNTS[1];
    const t:{input:Buffer;left:number;top:number}[]=[];let x=0;
    for(const f of SOCIAL_FORMATS){
      const o=await renderSocial(hero.master,hero.outerQuad,f);
      if(!o.ok){console.log(f.key,"FAILED",o.error);continue;}
      fs.writeFileSync(path.join(out,"social",`${f.key}.jpg`),o.file.bytes);
      const thumb=await sharp(o.file.bytes).resize({height:640}).jpeg({quality:88}).toBuffer(),m=await sharp(thumb).metadata();
      t.push({input:thumb,left:x,top:0},{input:label(m.width!,`${f.label} · ${(o.file.bytes.length/1024).toFixed(0)} KB`),left:x,top:0});x+=m.width!+10;
    }
    await sharp({create:{width:x-10,height:640,channels:3,background:"#fff"}}).composite(t).jpeg({quality:88}).toFile(path.join(out,"social_formats_sheet.jpg"));
    const ig=buildCaption({platform:"Instagram",size,styleLabel:st.label,mountLabel:mt.label}),fb=buildCaption({platform:"Facebook",size,styleLabel:st.label,mountLabel:mt.label});
    fs.writeFileSync(path.join(out,"captions.md"),`# Instagram\n\n${ig.text}\n\nAlt text: ${ig.altText}\n\n# Facebook\n\n${fb.text}\n\nAlt text: ${fb.altText}\n`);
  }
  console.log("examples written to",out);
})();
