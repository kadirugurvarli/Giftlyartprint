import {describe,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type {Quad,RawImage} from "@/lib/mockup-v3/types";
import {runMockup,type MockupResult} from "@/lib/mockup-v3/pipeline";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";
import {sideBySide} from "@/lib/mockup-v3/debug/overlay";
import {DEFAULT_STYLE,emptyRoom,framedPhoto,hangPiece,makeRoom,oldPicture,printPhoto,referenceWithFramedPicture} from "../helpers/e2e";
import {addPlant,landscapeArt} from "../helpers/scenes";
import {crop} from "../helpers/fixtures";

/**
 * Regenerates the committed before/after preview sheets (synthetic content only):
 *   PREVIEWS=1 npx vitest run tests/previews
 * Skipped otherwise so the normal suite stays fast and does not rewrite docs.
 */
const OUT=path.resolve(__dirname,"..","..","docs","phase3-previews");
const run=process.env.PREVIEWS==="1";

async function save(name:string,img:RawImage){
  fs.mkdirSync(OUT,{recursive:true});
  await sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}})
    .jpeg({quality:90}).toFile(path.join(OUT,name+".jpg"));
}
function bbox(q:Quad,pad:number,W:number,H:number){
  const x0=Math.max(0,Math.floor(Math.min(...q.map((p)=>p.x))-pad)),y0=Math.max(0,Math.floor(Math.min(...q.map((p)=>p.y))-pad));
  const x1=Math.min(W,Math.ceil(Math.max(...q.map((p)=>p.x))+pad)),y1=Math.min(H,Math.ceil(Math.max(...q.map((p)=>p.y))+pad));
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}
function closeup(before:RawImage,after:RawImage,q:Quad){
  const b=bbox(q,40,before.width,before.height);
  return sideBySide([crop(before,b.x,b.y,b.w,b.h),crop(after,b.x,b.y,b.w,b.h)],520);
}
const summary:string[]=[];
function note(title:string,r:MockupResult){
  const f=r.qa.forward,c=r.qa.crossCheck,i=r.qa.sceneIntegrity;
  summary.push(`### ${title}\n- status: **${r.status}**, needs manual: ${r.needsManual}\n- defects: ${r.defects.length?r.defects.map((d)=>`${d.severity}:${d.code}`).join(", "):"none"}\n- forward fidelity: dE ${f?.metrics.meanDeltaE.toFixed(2)}, SSIM ${f?.metrics.ssim.toFixed(3)}, pass ${f?.pass}\n- cross-check vs original photo: dE ${c?.metrics?.meanDeltaE.toFixed(2)}, SSIM ${c?.metrics?.ssim.toFixed(3)}, pass ${c?.pass}\n- scene pixels changed outside placement: ${i?.changedOutsideAllowed}\n`);
}

describe.skipIf(!run)("preview sheets",()=>{
  const customer=landscapeArt(640,480,21);
  const ref=referenceWithFramedPicture();
  const photo=printPhoto(customer);
  const baseA={sourceFocalPx:photo.focalPx,referenceFocalPx:1080,artworkAspect:640/480};
  const lvl=(level:"strict"|"environment"|"photographic")=>({realism:{level}});

  it("A1 artwork into reference frame (default level) + realism levels compared",async()=>{
    const r=await runMockup({mode:"artwork-in-frame",source:photo.photo,reference:ref.image,options:baseA});
    await save("A1-artwork-in-frame",sideBySide([photo.photo,ref.image,r.image!],520));
    await save("A1-closeup-before-after",closeup(ref.image,r.image!,ref.outerQuad));
    await save("A1-diagnostics",sideBySide([r.diagnostics.overlay!,r.diagnostics.extracted!],520));
    note("A1: bare print -> existing frame in reference (default level: environment)",r);
    const strict=await runMockup({mode:"artwork-in-frame",source:photo.photo,reference:ref.image,options:{...baseA,...lvl("strict")}});
    const pho=await runMockup({mode:"artwork-in-frame",source:photo.photo,reference:ref.image,options:{...baseA,...lvl("photographic")}});
    const b=bbox(ref.outerQuad,40,ref.image.width,ref.image.height);
    await save("A1-levels-strict-environment-photographic",sideBySide([crop(strict.image!,b.x,b.y,b.w,b.h),crop(r.image!,b.x,b.y,b.w,b.h),crop(pho.image!,b.x,b.y,b.w,b.h)],480));
    note("A1 photographic (opt-in: edge shadow, sheen, matched grain/softness)",pho);
  });
  it("A2 print with different proportions: whole print + mount border by default; approved crop only on request",async()=>{
    const s=printPhoto(landscapeArt(720,480,22));
    const o={...baseA,artworkAspect:720/480};
    const r=await runMockup({mode:"artwork-in-frame",source:s.photo,reference:ref.image,options:o});
    const c=await runMockup({mode:"artwork-in-frame",source:s.photo,reference:ref.image,options:{...o,fit:"cover",approvedCrop:{maxFraction:0.15}}});
    await save("A2-default-whole-print-with-border",sideBySide([s.photo,ref.image,r.image!],520));
    await save("A2-closeup-default-vs-approved-crop",closeup(r.image!,c.image!,ref.outerQuad));
    note("A2: 3:2 print into a 4:3 opening (default: whole print + border, proposed crop "+((r.adjustments.proposedCropFraction as number)*100).toFixed(1)+"%)",r);
    note("A2b: same, crop explicitly approved",c);
  });
  it("A3 plant in front of the frame (manual mask)",async()=>{
    const [,tr,br]=ref.apertureQuad;
    const plant=addPlant(ref.image,tr.x-14,br.y+34,150,5);
    const mask={width:plant.image.width,height:plant.image.height,alpha:plant.alpha};
    const r=await runMockup({mode:"artwork-in-frame",source:photo.photo,reference:plant.image,options:baseA,manual:{occlusion:mask}});
    await save("A3-occlusion-manual-mask",sideBySide([photo.photo,plant.image,r.image!],520));
    await save("A3-closeup-before-after",closeup(plant.image,r.image!,ref.outerQuad));
    note("A3: foreground plant, manual mask",r);
  });
  it("A4 pale frame on a grey wall",async()=>{
    const style={mouldingPx:20,mouldingColour:[238,236,232] as [number,number,number],mountPx:30,mountColour:[210,212,214] as [number,number,number]};
    const hung=hangPiece(makeRoom({wallColour:[150,146,138]}),renderFramedPiece(oldPicture(480,360),style),-0.1,-0.2,0.7);
    const r=await runMockup({mode:"artwork-in-frame",source:photo.photo,reference:hung.image,options:baseA});
    await save("A4-pale-frame",sideBySide([photo.photo,hung.image,r.image!],520));
    note("A4: pale moulding, grey wall",r);
  });

  const piece=renderFramedPiece(landscapeArt(480,360,31),DEFAULT_STYLE);
  const fphoto=framedPhoto(piece);
  const room=emptyRoom();
  const baseB={sourceFocalPx:fphoto.focalPx,referenceFocalPx:1080,pieceAspect:piece.image.width/piece.image.height,physicalWidthM:0.62,ceilingHeightM:2.6,skirtingM:0.12};
  it("B1 framed piece onto empty wall (default) + levels compared",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:room.image,options:baseB});
    await save("B1-framed-on-wall",sideBySide([fphoto.photo,room.image,r.image!],520));
    await save("B1-closeup-before-after",closeup(room.image,r.image!,r.targetQuad!));
    await save("B1-diagnostics",sideBySide([r.diagnostics.overlay!,r.diagnostics.extracted!],520));
    note("B1: framed piece -> empty wall (oblique room, default level: wall shadows + synthesised frame depth)",r);
    const strict=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:room.image,options:{...baseB,...lvl("strict")}});
    const pho=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:room.image,options:{...baseB,...lvl("photographic")}});
    const b=bbox(r.targetQuad!,36,room.image.width,room.image.height);
    await save("B1-levels-strict-environment-photographic",sideBySide([crop(strict.image!,b.x,b.y,b.w,b.h),crop(r.image!,b.x,b.y,b.w,b.h),crop(pho.image!,b.x,b.y,b.w,b.h)],480));
    note("B1 photographic (opt-in)",pho);
  });
  it("B2 plant in front of the placed piece (manual mask)",async()=>{
    const probe=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:room.image,options:baseB});
    const q=probe.targetQuad!;
    const plant=addPlant(room.image,q[1].x-8,q[2].y+14,120,6);
    const mask={width:plant.image.width,height:plant.image.height,alpha:plant.alpha};
    const r=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:plant.image,options:baseB,manual:{targetQuad:q,occlusion:mask}});
    await save("B2-occlusion-manual-mask",sideBySide([fphoto.photo,plant.image,r.image!],520));
    await save("B2-closeup-before-after",closeup(plant.image,r.image!,q));
    note("B2: foreground plant over the placed piece, manual mask",r);
  });
  it("B3 frontal room",async()=>{
    const fr=makeRoom({yawDeg:0,camX:0});
    const r=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:fr.image,options:baseB});
    await save("B3-frontal-room",sideBySide([fphoto.photo,fr.image,r.image!],520));
    note("B3: frontal room (no frame depth visible, as expected)",r);
  });
  it("B4 the reference already has a framed picture: replaced in place",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:ref.image,options:{sourceFocalPx:fphoto.focalPx,referenceFocalPx:1080,pieceAspect:piece.image.width/piece.image.height}});
    await save("B4-replace-existing-picture",sideBySide([fphoto.photo,ref.image,r.image!],520));
    await save("B4-closeup-before-after",closeup(ref.image,r.image!,r.targetQuad!));
    note("B4: replace the framed picture hanging in the reference (placement "+r.adjustments.placement+")",r);
    const tall=renderFramedPiece(landscapeArt(400,500,41),DEFAULT_STYLE);
    const tp=framedPhoto(tall);
    const t=await runMockup({mode:"framed-on-wall",source:tp.photo,reference:ref.image,options:{sourceFocalPx:tp.focalPx,referenceFocalPx:1080,pieceAspect:tall.image.width/tall.image.height}});
    await save("B4b-replace-with-different-proportions",sideBySide([tp.photo,ref.image,t.image!],520));
    note("B4b: replace with a taller piece (must cover the old frame; size mismatch flagged)",t);
  });
  it("write summary",()=>{
    fs.writeFileSync(path.join(OUT,"RESULTS.md"),"# Phase 3 preview results (synthetic scenes)\n\nGenerated by `npm run previews`. Synthetic content only; this is NOT evidence of photorealism on real photographs.\nRealism levels: strict (nothing on the product), environment (default; shadows and frame depth AROUND the product), photographic (opt-in; bounded effects ON the product).\n\n"+summary.join("\n"));
  });
});
