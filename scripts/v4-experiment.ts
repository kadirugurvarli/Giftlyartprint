/**
 * V4 hybrid experiment runner. DRY-RUN BY DEFAULT: loads a local pack, builds the V3 baseline, the bounded edit mask and the exact
 * request that WOULD be sent, validates geometry and protected regions offline (mock editor), writes a contact sheet to a
 * git-ignored folder and makes NO network call.
 *
 *   npx tsx scripts/v4-experiment.ts --pack <dir> [--sizes 30x40,60x80] [--out dir]
 *   npx tsx scripts/v4-experiment.ts --synthetic             (built-in synthetic scene, for tests)
 *
 * A paid call needs ALL of: --execute --authorize-paid --approve-dry-run-sheet --size WxH --max-spend-usd <cap>
 * --price-per-image-usd <owner-verified price>, an AI-generated pack with cleared rights, every offline validation passing,
 * and OPENAI_API_KEY in the environment. Otherwise it stays a dry run and says why.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type {Pt,Quad,RawImage} from "../lib/mockup-v3/types";
import {assertOutputIgnored} from "../lib/mockup-v3/validation/runner";
import {analyseRoom} from "../lib/mockup-v3/rooms/validate";
import {rasterizePolygons} from "../lib/mockup-v3/vision/mask";
import {cropImage} from "../lib/mockup-v4/integrity";
import {buildEditMask,cropMask} from "../lib/mockup-v4/mask";
import {describeLight,frameSpecFor,PACK_SIZES,paidEligible,validatePackManifest,type PackManifest} from "../lib/mockup-v4/pack";
import {buildFrameEditPrompt} from "../lib/mockup-v4/prompt";
import {buildOpenAIEditRequest,OpenAIImageEditor,OPENAI_MODEL_RULES} from "../lib/mockup-v4/openai";
import {planRequest,DEFAULT_MIN_MOULDING_PX} from "../lib/mockup-v4/request";
import {resizeMask,resizeRaw} from "../lib/mockup-v4/resample";
import {runHybridEdit} from "../lib/mockup-v4/run";
import {buildScenario} from "../lib/mockup-v4/scenario";
import {FaithfulMockEditor} from "../lib/mockup-v4/mock";
import {describeSpend,SpendGuard} from "../lib/mockup-v4/spend";
import {loadPack} from "./v4-pack";
import {landscapeArt} from "../tests/helpers/scenes";
import {syntheticRoom} from "../tests/helpers/rooms";

const argv=process.argv.slice(2);
const flag=(n:string)=>argv.includes(`--${n}`);
const val=(n:string)=>{const i=argv.indexOf(`--${n}`);return i>=0?argv[i+1]:undefined;};
const num=(n:string)=>{const v=val(n);return v===undefined?null:Number(v);};

type Sharp=ReturnType<typeof sharp>;
const raw=(img:RawImage)=>sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}}).removeAlpha();
const svg=(w:number,h:number,body:string)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const poly=(pts:Pt[],stroke:string,fill="none",sw=3,op=1)=>`<polygon points="${pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}" fill-opacity="${op}"/>`;

async function panel(img:Sharp,label:string,w=700,h=520){
  const buf=await img.resize(w,h,{fit:"contain",background:"#f4f2ee"}).jpeg({quality:90}).toBuffer();
  const tag=svg(w,28,`<rect width="100%" height="100%" fill="#000" opacity="0.6"/><text x="8" y="19" font-family="sans-serif" font-size="14" fill="#fff">${label.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</text>`);
  return sharp(buf).composite([{input:tag,left:0,top:0}]).jpeg({quality:90}).toBuffer();
}
const bboxOf=(pts:Pt[],pad:number,W:number,H:number)=>{const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);const x0=Math.max(0,Math.floor(Math.min(...xs)-pad)),y0=Math.max(0,Math.floor(Math.min(...ys)-pad));return {left:x0,top:y0,width:Math.min(W,Math.ceil(Math.max(...xs)+pad))-x0,height:Math.min(H,Math.ceil(Math.max(...ys)+pad))-y0};};

type Check={name:string;pass:boolean;detail:string};
const bandFor=(q:Quad)=>Math.round(Math.max(18,0.08*Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y)));

(async()=>{
  const out=path.resolve(val("out") ?? "validation-output/v4-experiment");
  assertOutputIgnored(out);fs.mkdirSync(out,{recursive:true});
  const model=val("model") ?? "gpt-image-2";
  if(!OPENAI_MODEL_RULES[model]){console.error(`Model ${model} has no verified parameter rules; refusing.`);process.exit(2);}

  // ---- load the pack (or the built-in synthetic scene)
  let manifest:PackManifest,roomImage:RawImage,artwork:RawImage,packIssues:{code:string;detail?:string}[];
  if(val("pack")){
    const p=await loadPack(val("pack")!);
    manifest=p.manifest;roomImage=p.roomImage;artwork=p.artwork;packIssues=p.issues;
  }else if(flag("synthetic")){
    const s=syntheticRoom({withPlant:true});
    roomImage=s.image;artwork=landscapeArt(900,1260,61);
    manifest={schemaVersion:1,id:"synthetic-inline",roomImage:"room.png",artworkImage:"art.png",room:s.room,
      provenance:{kind:"synthetic-test",rightsCleared:true,licence:"generated in-process",emptyWallConfirmed:true},
      artwork:{origin:"synthetic-test",customer:false,licence:"generated in-process"},
      frame:{mouldingWidthCm:2.4,mountWidthCm:3.5,frameDepthCm:3,mouldingColour:[66,48,34],mountColour:[238,233,222],description:"a dark walnut-brown wooden moulding with a cream mount"}};
    packIssues=validatePackManifest(manifest);
  }else{console.error("Give --pack <dir> or --synthetic.");process.exit(2);}

  const sizes=(val("sizes") ?? "30x40,60x80").split(",").map(s=>{const [w,h]=s.split("x").map(Number);return {width:w,height:h};});
  for(const z of sizes) if(!PACK_SIZES.some(p=>p.width===z.width&&p.height===z.height)){console.error(`Size ${z.width}x${z.height} is not enabled for this experiment (30x40, 60x80).`);process.exit(2);}

  const lightText=manifest.lightDescription ?? describeLight(manifest.room.light);
  const prompt=buildFrameEditPrompt({frameDescription:manifest.frame.description,lightDescription:lightText});
  const eligibility=paidEligible(manifest);
  const W=roomImage.width,H=roomImage.height;
  const room=manifest.room,an=analyseRoom(room);

  // ---- calibration overlay on the room
  const hull=an.fit?an.calibratedHullCm.map(c=>{const p=an.fit!.H;const w=p[6]*c.x+p[7]*c.y+p[8];return {x:(p[0]*c.x+p[1]*c.y+p[2])/w,y:(p[3]*c.x+p[4]*c.y+p[5])/w};}):[];
  const r=room.region;
  const regionPx=an.fit?[[r.leftCm,r.topCm],[r.leftCm+r.widthCm,r.topCm],[r.leftCm+r.widthCm,r.topCm+r.heightCm],[r.leftCm,r.topCm+r.heightCm]].map(([x,y])=>{const p=an.fit!.H;const w=p[6]*x+p[7]*y+p[8];return {x:(p[0]*x+p[1]*y+p[2])/w,y:(p[3]*x+p[4]*y+p[5])/w};}):[];
  const calSvg=svg(W,H,
    (room.shadowMask?.wallPolygons ?? []).map(q=>poly(q,"#2b7fff","#2b7fff",3,0.12)).join("")+
    (room.shadowMask?.excludePolygons ?? []).map(q=>poly(q,"#ff3b30","#ff3b30",3,0.25)).join("")+
    (hull.length?poly(hull,"#ffd60a","none",4):"")+(regionPx.length?poly(regionPx,"#32ade6","none",4):"")+
    room.wall.controlPoints.map(c=>`<circle cx="${c.image.x}" cy="${c.image.y}" r="${Math.max(6,W/260)}" fill="#34c759" stroke="#000" stroke-width="2"/>`).join(""));
  const calibrationPanel=await panel(sharp(await raw(roomImage).composite([{input:calSvg,left:0,top:0}]).jpeg({quality:90}).toBuffer()),"calibration: control points, wall mask (blue), furniture (red), hull (yellow), safe region (cyan)");
  const roomPanel=await panel(raw(roomImage),`room ${W}x${H}px (${manifest.provenance.kind})`);
  const artPanel=await panel(raw(artwork),`sample artwork ${artwork.width}x${artwork.height}px (non-customer: ${manifest.artwork.origin})`);

  const sizeReports:Record<string,unknown>[]=[];
  const rowPanels:Buffer[][]=[];
  const allChecks:Check[]=[];
  const gen=(c:Check[],name:string,pass:boolean,detail:string)=>c.push({name,pass,detail});
  let firstRequest:{size:string;maskBytes:number;imageBytes:number}|null=null;
  const requests:Record<string,Awaited<ReturnType<typeof buildOpenAIEditRequest>>>={};
  const requestInputs:Record<string,{image:RawImage;mask:Uint8Array}>={};

  const sharedChecks:Check[]=[];
  gen(sharedChecks,"pack-manifest",packIssues.length===0,packIssues.length?packIssues.map(i=>i.code+(i.detail?` (${i.detail})`:"")).join("; "):"valid");
  gen(sharedChecks,"room-calibration",an.issues.length===0,an.issues.length?an.issues.map(i=>i.code).join(","):`reprojection rms ${an.fit?.rmsPx.toFixed(2)} px, max ${an.fit?.maxPx.toFixed(2)} px`);
  allChecks.push(...sharedChecks);

  for(const z of sizes){
    const tag=`${z.width}x${z.height}`;
    const checks:Check[]=[];
    const sc=await buildScenario({room,roomImage,artwork,frame:frameSpecFor(manifest,z),size:z});
    if(!sc.ok){gen(checks,"v3-baseline",false,`${sc.error} ${sc.detail??""}`);sizeReports.push({size:tag,checks});allChecks.push(...checks.map(c=>({...c,name:`${tag}:${c.name}`})));continue;}
    gen(checks,"v3-baseline-checks",sc.v3Checks.every(c=>c.pass)&&sc.v3Status!=="fail",sc.v3Checks.map(c=>`${c.name}:${c.pass?"ok":"FAIL"}`).join(" ")+` status ${sc.v3Status}`);
    const inImg=(q:Quad)=>q.every(p=>p.x>=0&&p.y>=0&&p.x<=W&&p.y<=H);
    gen(checks,"quads-inside-image",inImg(sc.outerQuad)&&inImg(sc.artQuad),"outer frame and print corners lie inside the room image");
    const outerPoly=rasterizePolygons([sc.outerQuad],W,H),artPoly=rasterizePolygons([sc.artQuad],W,H);
    let outerN=0,artN=0,artOut=0;for(let k=0;k<W*H;k++){if(outerPoly[k]>=128)outerN++;if(artPoly[k]>=128){artN++;if(outerPoly[k]<128)artOut++;}}
    gen(checks,"print-inside-frame",artN>0&&artOut<=0.01*artN&&artN<outerN,`print ${artN}px inside frame ${outerN}px`);
    // furniture must not overlap the frame (else the frame would be in front of / behind it ambiguously)
    const prot=sc.protect.length?rasterizePolygons(sc.protect,W,H):null;
    let overlap=0;if(prot)for(let k=0;k<W*H;k++) if(prot[k]>=128&&outerPoly[k]>=128) overlap++;
    gen(checks,"frame-clear-of-furniture",overlap===0,`${overlap} px of overlap between the frame and furniture polygons`);

    const mask=buildEditMask({width:W,height:H,outerQuad:sc.outerQuad,artQuad:sc.artQuad,shadowDir:sc.shadowDir,shadowBandPx:bandFor(sc.outerQuad),wallAlpha:sc.wallAlpha,protect:sc.protect});
    let onArt=0,onFurn=0,offWall=0;
    for(let k=0;k<W*H;k++){if(!mask.editable[k])continue;if(artPoly[k]>0)onArt++;if(prot&&prot[k]>0)onFurn++;if(sc.wallAlpha&&outerPoly[k]===0&&sc.wallAlpha[k]<250)offWall++;}
    gen(checks,"mask-protects-art-furniture-wall",onArt===0&&onFurn===0&&offWall===0&&mask.stats.shadowBand,`mask on print ${onArt}px, on furniture ${onFurn}px, shadow band off the wall ${offWall}px (band ${mask.stats.shadowBand?"on":"OFF"})`);
    gen(checks,"mask-share",mask.stats.share>0.001&&mask.stats.share<0.2,`${mask.stats.editablePixels}px = ${(mask.stats.share*100).toFixed(2)}% of the scene`);

    const plan=planRequest({mask,constraints:OPENAI_MODEL_RULES[model].constraints,contextPx:Math.round(Math.max(48,sc.wallPxPerCm*6)),mouldingPx:sc.mouldingPx});
    gen(checks,"request-plan",plan.ok,plan.ok?`crop ${plan.crop.width}x${plan.crop.height} at ${plan.crop.x},${plan.crop.y}; ×${plan.scale} -> request ${plan.requestWidth}x${plan.requestHeight}px; moulding ${plan.mouldingPxInRequest.toFixed(0)}px (needs ≥ ${DEFAULT_MIN_MOULDING_PX})`:plan.error);
    let built:Awaited<ReturnType<typeof buildOpenAIEditRequest>>|null=null;
    if(plan.ok){
      const crop=plan.crop,baseCrop=cropImage(sc.baseline,crop);
      const reqImg=await resizeRaw(baseCrop,plan.requestWidth,plan.requestHeight);
      const reqMask=await resizeMask(cropMask(mask,crop),crop.width,crop.height,plan.requestWidth,plan.requestHeight);
      try{built=await buildOpenAIEditRequest({image:reqImg,mask:reqMask,prompt},{model,quality:"medium"});gen(checks,"request-schema",true,`size ${built.summary.size}, image ${(built.summary.imageBytes/1024).toFixed(0)} KB, mask ${(built.summary.maskBytes/1024).toFixed(0)} KB (<4 MB), prompt ${built.summary.promptChars} chars`);}
      catch(e){gen(checks,"request-schema",false,e instanceof Error?e.message:String(e));}
      if(built){requests[tag]=built;requestInputs[tag]={image:reqImg,mask:reqMask};firstRequest??={size:built.summary.size,maskBytes:built.summary.maskBytes,imageBytes:built.summary.imageBytes};}
      // offline end-to-end with a faithful mock: protected regions must be byte-identical, art must be the exact re-warp
      const rr=await runHybridEdit({baseline:sc.baseline,art:artwork,outerQuad:sc.outerQuad,artQuad:sc.artQuad,shadowDir:sc.shadowDir,shadowBandPx:bandFor(sc.outerQuad),wallAlpha:sc.wallAlpha,protect:sc.protect,prompt,editor:new FaithfulMockEditor(),contextPx:Math.round(Math.max(48,sc.wallPxPerCm*6)),mouldingPx:sc.mouldingPx});
      if(!rr.ok) gen(checks,"offline-composite",false,rr.error+" "+(rr.detail??""));
      else{
        gen(checks,"outside-mask-byte-identical",rr.metrics.finalOutside.changed===0,`${rr.metrics.finalOutside.changed} of ${rr.metrics.finalOutside.count} protected pixels differ`);
        gen(checks,"art-is-exact-warp",rr.metrics.finalArtVsWarp.changed===0&&rr.metrics.baselineArtVsWarp.meanDE<=2.5,`${rr.metrics.finalArtVsWarp.changed} px differ from the re-warp; V3 art vs re-warp mean ΔE ${rr.metrics.baselineArtVsWarp.meanDE.toFixed(2)}`);
        let furn=0;if(prot)for(let k=0;k<W*H;k++) if(prot[k]>=250&&(rr.image.data[k*4]!==sc.baseline.data[k*4]||rr.image.data[k*4+1]!==sc.baseline.data[k*4+1]||rr.image.data[k*4+2]!==sc.baseline.data[k*4+2])) furn++;
        gen(checks,"furniture-byte-identical",furn===0,`${furn} furniture pixels changed`);
        gen(checks,"mock-verdict",rr.verdict==="accept",rr.verdict);
      }
    }

    // ---- panels for this size
    const box=bboxOf(sc.outerQuad,Math.max(120,sc.wallPxPerCm*14),W,H);
    const placeSvg=svg(W,H,poly(sc.outerQuad,"#ff9500","none",3)+poly(sc.artQuad,"#00c7be","none",3));
    const placement=await panel(sharp(await raw(roomImage).composite([{input:placeSvg,left:0,top:0}]).jpeg({quality:92}).toBuffer()).extract(box),`${tag} cm placement: outer frame (orange), print (teal); ${sc.physicalAccuracy}`);
    const baselinePanel=await panel(raw(sc.baseline).extract(box),`${tag} V3 baseline (what V4 starts from)`);
    let maskPanel:Buffer,reqPanel:Buffer;
    if(plan.ok){
      const crop=plan.crop,ov={width:crop.width,height:crop.height,data:new Uint8ClampedArray(cropImage(sc.baseline,crop).data)};
      const cm=cropMask(mask,crop);
      for(let i=0;i<cm.length;i++) if(cm[i]){ov.data[i*4]=Math.round(ov.data[i*4]*0.35+255*0.65);ov.data[i*4+1]=Math.round(ov.data[i*4+1]*0.35);ov.data[i*4+2]=Math.round(ov.data[i*4+2]*0.35);}
      maskPanel=await panel(raw(ov),`${tag} edit mask (red = model may edit; everything else frozen)`);
      reqPanel=await panel(raw(requestInputs[tag]?.image ?? cropImage(sc.baseline,crop)),`${tag} request image ${plan.requestWidth}x${plan.requestHeight}px (×${plan.scale})`);
    }else{
      maskPanel=await panel(raw(sc.baseline).extract(box),`${tag} edit mask: NO REQUEST (${plan.error})`);
      reqPanel=maskPanel;
    }
    rowPanels.push([placement,baselinePanel,maskPanel,reqPanel]);
    sizeReports.push({size:tag,wallPxPerCm:sc.wallPxPerCm,mouldingPx:sc.mouldingPx,physicalAccuracy:sc.physicalAccuracy,scaleDisclosure:sc.scaleDisclosure,editablePixels:mask.stats.editablePixels,request:built?.summary ?? null,checks});
    allChecks.push(...checks.map(c=>({...c,name:`${tag}:${c.name}`})));
  }

  // ---- contact sheet
  const pw=700,ph=520,gap=10;
  const cols=4,rows=1+rowPanels.length;
  const comp:{input:Buffer;left:number;top:number}[]=[
    {input:roomPanel,left:0,top:0},{input:artPanel,left:pw+gap,top:0},{input:calibrationPanel,left:2*(pw+gap),top:0}
  ];
  rowPanels.forEach((row,ri)=>row.forEach((b,ci)=>comp.push({input:b,left:ci*(pw+gap),top:(ri+1)*(ph+gap)})));
  const sheet=path.join(out,"contact_sheet.jpg");
  await sharp({create:{width:cols*pw+(cols-1)*gap,height:rows*ph+(rows-1)*gap,channels:3,background:"#ffffff"}}).composite(comp).jpeg({quality:88}).toFile(sheet);

  // ---- paid readiness
  const price=num("price-per-image-usd"),cap=num("max-spend-usd")??0;
  const single=sizes.length===1&&!!val("size")&&val("size")===`${sizes[0].width}x${sizes[0].height}`;
  const spendCfg={authorized:flag("execute")&&flag("authorize-paid"),capUsd:cap,pricePerCallUsd:price,maxCalls:1};
  const spend=describeSpend(spendCfg);
  const keyPresent=!!process.env.OPENAI_API_KEY;
  const validationsPass=allChecks.every(c=>c.pass);
  const readiness=[
    {item:"AI-generated, rights-cleared, empty-wall room pack (not a synthetic test pack)",ok:eligibility.eligible,detail:eligibility.reasons.join("; ")||"ok"},
    {item:"all offline geometry / protected-region validations pass",ok:validationsPass,detail:allChecks.filter(c=>!c.pass).map(c=>c.name).join(", ")||"ok"},
    {item:"room image ≥ 2400 px long side and moulding ≥ 28 px in the request",ok:Math.max(W,H)>=2400&&!allChecks.some(c=>c.name.endsWith("request-plan")&&!c.pass),detail:`${W}x${H}`},
    {item:"owner-verified price per image supplied (--price-per-image-usd)",ok:price!==null&&price>0,detail:price===null?"missing":String(price)},
    {item:"spend cap supplied and ≥ price (--max-spend-usd)",ok:cap>0&&price!==null&&price<=cap,detail:`cap ${cap}`},
    {item:"explicit paid authorisation (--execute --authorize-paid)",ok:spendCfg.authorized,detail:spendCfg.authorized?"given":"not given"},
    {item:"dry-run contact sheet reviewed and approved (--approve-dry-run-sheet)",ok:flag("approve-dry-run-sheet"),detail:flag("approve-dry-run-sheet")?"acknowledged":"not acknowledged"},
    {item:"exactly one size selected for the paid call (--size WxH)",ok:single,detail:single?`${sizes[0].width}x${sizes[0].height}`:"not selected"},
    {item:"OPENAI_API_KEY present in the environment (never in the repo)",ok:keyPresent,detail:keyPresent?"present":"absent"}
  ];
  const paid=flag("execute")&&readiness.every(r=>r.ok)&&spend.wouldRun;

  const summary={mode:paid?"PAID":"DRY RUN",pack:{id:manifest.id,provenance:manifest.provenance.kind,roomPx:`${W}x${H}`,artPx:`${artwork.width}x${artwork.height}`},provider:`openai /v1/images/edits (${model})`,lightDescription:lightText,sizes:sizeReports,checks:allChecks,readiness,contactSheet:sheet,
    notes:["Price per image is NOT in OpenAI's API spec; supply the owner-verified price.","The dry run sends nothing anywhere; the mock editor is offline."]};
  fs.writeFileSync(path.join(out,"dry_run_report.json"),JSON.stringify(summary,null,2));
  for(const tag of Object.keys(requestInputs)){await raw(requestInputs[tag].image).png().toFile(path.join(out,`request_${tag}.png`));}
  console.log(`pack ${manifest.id} (${manifest.provenance.kind}) room ${W}x${H}`);
  for(const c of allChecks) console.log(`${c.pass?"PASS":"FAIL"}  ${c.name}: ${c.detail}`);
  console.log("\npaid-readiness:");for(const r of readiness) console.log(`${r.ok?"[x]":"[ ]"} ${r.item}${r.ok?"":"  -> "+r.detail}`);
  console.log("\ncontact sheet:",sheet);

  if(!flag("execute")){console.log("DRY RUN: no network call was made.");process.exit(validationsPass?0:5);}
  if(!paid){console.error("\nREFUSED: paid call not allowed ->",readiness.filter(r=>!r.ok).map(r=>r.item).join(" | ")||spend.reason);process.exit(3);}
  // ---- the one paid call (never reached in dry runs)
  const z=sizes[0],tag=`${z.width}x${z.height}`;
  const sc=await buildScenario({room,roomImage,artwork,frame:frameSpecFor(manifest,z),size:z});
  if(!sc.ok){console.error("scenario failed",sc.error);process.exit(4);}
  const editor=new OpenAIImageEditor({guard:new SpendGuard(spendCfg),model,quality:"medium"});
  const res=await runHybridEdit({baseline:sc.baseline,art:artwork,outerQuad:sc.outerQuad,artQuad:sc.artQuad,shadowDir:sc.shadowDir,shadowBandPx:bandFor(sc.outerQuad),wallAlpha:sc.wallAlpha,protect:sc.protect,prompt,editor,contextPx:Math.round(Math.max(48,sc.wallPxPerCm*6)),mouldingPx:sc.mouldingPx});
  if(!res.ok){console.error("Hybrid run failed:",res.error,res.detail??"");process.exit(4);}
  await raw(sc.baseline).jpeg({quality:95}).toFile(path.join(out,`${tag}_01_v3_baseline.jpg`));
  await raw(res.image).jpeg({quality:95}).toFile(path.join(out,`${tag}_02_v4_candidate_final.jpg`));
  await raw(res.candidateFull).jpeg({quality:95}).toFile(path.join(out,`${tag}_03_raw_model_output_pasted.jpg`));
  fs.writeFileSync(path.join(out,`${tag}_result.json`),JSON.stringify({verdict:res.verdict,rejectReasons:res.rejectReasons,checks:res.checks,meta:res.meta,metrics:res.metrics,scale:res.scale},null,2));
  console.log("verdict:",res.verdict,res.rejectReasons.join(","));
})().catch((e)=>{console.error(e instanceof Error?(process.env.V4_DEBUG?e.stack:e.message):String(e));process.exit(1);});
