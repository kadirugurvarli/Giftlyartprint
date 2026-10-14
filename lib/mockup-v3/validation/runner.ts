import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import sharp from "sharp";
import type {Pt,Quad,RawImage} from "../types";
import {decodeImage,encodePng} from "../io";
import {readExif,type ExifSummary} from "../exif";
import {runMockup,type ManualInputs,type MockupMode,type MockupOptions,type MockupResult,type RealismLevel} from "../pipeline";
import {sideBySide} from "../debug/overlay";
import type {OcclusionMask} from "../composite/occlusion";
import {auditRealism,type RealismFinding} from "./realism-audit";
import {recommendCorrections,type Correction} from "./corrections";
import {runProbes,type ProbeOutcome} from "./probes";

/**
 * Real-photo validation. Reads originals (EXIF intact), runs the pipeline, measures it, and writes
 * sanitised reports. Customer material never enters git: outputs must land in a git-ignored folder.
 */

export type Quad4=[[number,number],[number,number],[number,number],[number,number]];

export type ValidationCase={
  id:string;
  mode:MockupMode;
  source:string;
  reference:string;
  options?:MockupOptions;
  manual?:{
    /** Corners in ORIENTED original pixels: TL,TR,BR,BL. */
    sourceQuad?:Quad4;targetQuad?:Quad4;wallHint?:[number,number];
    apertureLayers?:{top:number;right:number;bottom:number;left:number};
    /** PNG/JPEG, white = foreground object that stays in front (resized to the reference if needed). */
    occlusionMask?:string;
  };
  /** Hand-marked truth for accuracy measurement; never fed to the pipeline. */
  groundTruth?:{sourceQuad?:Quad4;targetQuad?:Quad4};
  notes?:string;
};

export type ValidationManifest={version:1;levels?:RealismLevel[];cases:ValidationCase[]};

export type CaseReport={
  id:string;mode:MockupMode;level:RealismLevel;
  status:MockupResult["status"];needsManual:boolean;
  automation:MockupResult["automation"];
  defects:{code:string;severity:string;message:string}[];
  adjustments:Record<string,number|string|boolean>;
  qa:{
    forward?:{pass:boolean;meanDeltaE:number;p95DeltaE:number;ssim:number;sharpness:number;bias:{L:number;a:number;b:number};pixels:number};
    crossCheck?:{pass:boolean;meanDeltaE?:number;p95DeltaE?:number;ssim?:number;bias?:{L:number;a:number;b:number}};
    integrity?:{pass:boolean;changedOutsideAllowed:number};
    productPixelsModified?:boolean;
  };
  accuracy?:{sourceQuadErrorPx?:number;targetQuadErrorPx?:number;sourceQuadErrorRel?:number;targetQuadErrorRel?:number};
  inputs:{
    source:{name:string;sha256:string;width:number;height:number;exif:Omit<ExifSummary,"width"|"height">};
    reference:{name:string;sha256:string;width:number;height:number;exif:Omit<ExifSummary,"width"|"height">};
    sourceFocalUsed?:{px:number;from:"manifest"|"exif"};
    referenceFocalUsed?:{px:number;from:"manifest"|"exif"};
  };
  timingMs:number;
  files:{source?:string;reference?:string;mockup?:string;overlay?:string;sheet?:string;caseReport?:string;reviewTemplate?:string};
  realism?:{findings:RealismFinding[];measurements:Record<string,number|string>;calibrated:false};
  corrections?:Correction[];
  /** known damage applied to this result: did the independent cross-check catch it? */
  probes?:ProbeOutcome[];
  notes?:string;
};

export type Review={
  id:string;level:RealismLevel;
  /** fill in by eye: good = usable as is, acceptable = usable with small changes, bad = not usable */
  verdict:"good"|"acceptable"|"bad"|"";
  ratings:{placement:number|null;perspective:number|null;lighting:number|null;shadow:number|null;edges:number|null;colourFidelity:number|null};
  defectsSeen:string[];
  notes:string;
};

const toQuad=(q:Quad4):Quad=>q.map(([x,y])=>({x,y})) as Quad;
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex").slice(0,16);

function gitInfo(dir:string):{repo:string|null}{
  try{
    const top=execFileSync("git",["-C",dir,"rev-parse","--show-toplevel"],{stdio:["ignore","pipe","ignore"]}).toString().trim();
    return {repo:top};
  }catch{return {repo:null};}
}

/** Refuse to write outside git-ignored space when inside a repository. */
export function assertOutputIgnored(outDir:string){
  fs.mkdirSync(outDir,{recursive:true});
  const {repo}=gitInfo(outDir);
  if(!repo) return;
  try{
    execFileSync("git",["-C",repo,"check-ignore","-q",path.resolve(outDir)],{stdio:"ignore"});
  }catch{
    throw new Error(`Refusing to write validation output to "${outDir}": it is inside a git repository and NOT ignored, so customer images could be committed. Use validation-output/ (ignored) or a folder outside the repository.`);
  }
}

export function inputsTrackedByGit(files:string[]):string[]{
  const tracked:string[]=[];
  for(const f of files){
    const {repo}=gitInfo(path.dirname(f));
    if(!repo) continue;
    try{execFileSync("git",["-C",repo,"ls-files","--error-unmatch",path.resolve(f)],{stdio:"ignore"});tracked.push(f);}catch{/* untracked: good */}
  }
  return tracked;
}

async function loadInput(file:string){
  const buf=fs.readFileSync(file);
  let img:RawImage;
  try{img=await decodeImage(buf);}
  catch(e){
    const msg=String((e as Error).message);
    throw new Error(`Could not read "${path.basename(file)}": ${msg}. If this is an iPhone HEIC photo, export it as JPEG (Photos: File > Export > Export Unmodified Original is HEIC; use "Export as JPEG" or AirDrop to a Mac with "Most Compatible") keeping the metadata.`);
  }
  const exif=await readExif(buf);
  return {buf,img,exif};
}

async function loadMask(file:string,w:number,h:number):Promise<OcclusionMask>{
  const {data}=await sharp(fs.readFileSync(file)).resize(w,h,{fit:"fill"}).greyscale().raw().toBuffer({resolveWithObject:true});
  return {width:w,height:h,alpha:new Uint8Array(data)};
}

const cornerErr=(a:Quad,b:Quad)=>Math.max(...a.map((p,i)=>Math.hypot(p.x-b[i].x,p.y-b[i].y)));
const quadSize=(q:Quad)=>Math.sqrt(Math.abs((q[2].x-q[0].x)*(q[3].y-q[1].y)-(q[3].x-q[1].x)*(q[2].y-q[0].y))/2);

const stripExif=({width,height,...rest}:ExifSummary)=>{void width;void height;return rest;};

export async function runCase(c:ValidationCase,baseDir:string,level:RealismLevel,outDir:string):Promise<CaseReport>{
  const t0=Date.now();
  const src=await loadInput(path.resolve(baseDir,c.source));
  const ref=await loadInput(path.resolve(baseDir,c.reference));
  const options:MockupOptions={...c.options,realism:{...(c.options?.realism),level}};
  let sourceFocalUsed:CaseReport["inputs"]["sourceFocalUsed"],referenceFocalUsed:CaseReport["inputs"]["referenceFocalUsed"];
  if(options.sourceFocalPx) sourceFocalUsed={px:options.sourceFocalPx,from:"manifest"};
  else if(src.exif.focalPx && !src.exif.focalCaution){options.sourceFocalPx=src.exif.focalPx;sourceFocalUsed={px:src.exif.focalPx,from:"exif"};}
  if(options.referenceFocalPx) referenceFocalUsed={px:options.referenceFocalPx,from:"manifest"};
  else if(ref.exif.focalPx && !ref.exif.focalCaution){options.referenceFocalPx=ref.exif.focalPx;referenceFocalUsed={px:ref.exif.focalPx,from:"exif"};}

  const manual:ManualInputs={};
  const m=c.manual;
  if(m?.sourceQuad) manual.sourceQuad=toQuad(m.sourceQuad);
  if(m?.targetQuad) manual.targetQuad=toQuad(m.targetQuad);
  if(m?.wallHint) manual.wallHint={x:m.wallHint[0],y:m.wallHint[1]} as Pt;
  if(m?.apertureLayers) manual.apertureLayers=m.apertureLayers;
  if(m?.occlusionMask) manual.occlusion=await loadMask(path.resolve(baseDir,m.occlusionMask),ref.img.width,ref.img.height);

  const r=await runMockup({mode:c.mode,source:src.img,reference:ref.img,options,manual});

  const dir=path.join(outDir,c.id,level);
  fs.mkdirSync(dir,{recursive:true});
  const files:CaseReport["files"]={};
  if(r.image){
    fs.writeFileSync(path.join(dir,"mockup.png"),await encodePng(r.image));files.mockup=`${c.id}/${level}/mockup.png`;
    const sheet=sideBySide([src.img,ref.img,r.image],520);
    await sharp(Buffer.from(sheet.data.buffer,sheet.data.byteOffset,sheet.data.byteLength),{raw:{width:sheet.width,height:sheet.height,channels:4}}).jpeg({quality:88}).toFile(path.join(dir,"sheet.jpg"));
    files.sheet=`${c.id}/${level}/sheet.jpg`;
  }
  if(r.diagnostics.overlay){
    const o=r.diagnostics.overlay;
    await sharp(Buffer.from(o.data.buffer,o.data.byteOffset,o.data.byteLength),{raw:{width:o.width,height:o.height,channels:4}}).jpeg({quality:86}).toFile(path.join(dir,"overlay.jpg"));
    files.overlay=`${c.id}/${level}/overlay.jpg`;
  }

  for(const [name,im] of [["source",src.img],["reference",ref.img]] as const){
    const s=Math.min(1,1600/Math.max(im.width,im.height));
    await sharp(Buffer.from(im.data.buffer,im.data.byteOffset,im.data.byteLength),{raw:{width:im.width,height:im.height,channels:4}})
      .resize(Math.round(im.width*s),Math.round(im.height*s)).jpeg({quality:88}).toFile(path.join(dir,`${name}.jpg`));
    files[name]=`${c.id}/${level}/${name}.jpg`;
  }
  const audit=auditRealism({result:r,reference:ref.img,maxReferenceSide:options.maxReferenceSide});
  const corrections=recommendCorrections(r.defects,audit.findings);
  let probes:ProbeOutcome[]|undefined;
  try{probes=runProbes({result:r,source:src.img});}catch{probes=undefined;}
  const f=r.qa.forward,x=r.qa.crossCheck;
  const report:CaseReport={
    id:c.id,mode:c.mode,level,status:r.status,needsManual:r.needsManual,automation:r.automation,
    defects:r.defects.map((d)=>({code:d.code,severity:d.severity,message:d.message})),
    adjustments:r.adjustments,
    qa:{
      forward:f?{pass:f.pass,meanDeltaE:f.metrics.meanDeltaE,p95DeltaE:f.metrics.p95DeltaE,ssim:f.metrics.ssim,sharpness:f.metrics.sharpnessRatio,bias:f.metrics.labBias,pixels:f.comparedPixels}:undefined,
      crossCheck:x?{pass:x.pass,meanDeltaE:x.metrics?.meanDeltaE,p95DeltaE:x.metrics?.p95DeltaE,ssim:x.metrics?.ssim,bias:x.metrics?.labBias}:undefined,
      integrity:r.qa.sceneIntegrity?{pass:r.qa.sceneIntegrity.pass,changedOutsideAllowed:r.qa.sceneIntegrity.changedOutsideAllowed}:undefined,
      productPixelsModified:r.qa.productPixels?.modified
    },
    inputs:{
      source:{name:path.basename(c.source),sha256:sha(src.buf),width:src.img.width,height:src.img.height,exif:stripExif(src.exif)},
      reference:{name:path.basename(c.reference),sha256:sha(ref.buf),width:ref.img.width,height:ref.img.height,exif:stripExif(ref.exif)},
      sourceFocalUsed,referenceFocalUsed
    },
    realism:audit,corrections,probes,
    timingMs:Date.now()-t0,files,notes:c.notes
  };
  // accuracy against hand-marked truth (GT is never given to the pipeline)
  const gt=c.groundTruth;
  if(gt && r){
    const acc:NonNullable<CaseReport["accuracy"]>={};
    if(gt.sourceQuad && r.sourceQuad){const g=toQuad(gt.sourceQuad);acc.sourceQuadErrorPx=cornerErr(r.sourceQuad,g);acc.sourceQuadErrorRel=acc.sourceQuadErrorPx/quadSize(g);}
    if(gt.targetQuad && r.targetQuad){
      // r.targetQuad is in (possibly downscaled) scene pixels; bring it back to original reference pixels
      const s=Math.min(1,(options.maxReferenceSide ?? 2400)/Math.max(ref.img.width,ref.img.height));
      const back=r.targetQuad.map((p)=>({x:p.x/s,y:p.y/s})) as Quad;
      const g=toQuad(gt.targetQuad);acc.targetQuadErrorPx=cornerErr(back,g);acc.targetQuadErrorRel=acc.targetQuadErrorPx/quadSize(g);
    }
    report.accuracy=acc;
  }
  fs.writeFileSync(path.join(dir,"report.json"),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(dir,"case-report.md"),caseReportMd(report));files.caseReport=`${c.id}/${level}/case-report.md`;
  const tpl:Review={id:c.id,level,verdict:"",ratings:{placement:null,perspective:null,lighting:null,shadow:null,edges:null,colourFidelity:null},defectsSeen:[],notes:""};
  fs.writeFileSync(path.join(dir,"review-template.json"),JSON.stringify(tpl,null,2));files.reviewTemplate=`${c.id}/${level}/review-template.json`;
  fs.writeFileSync(path.join(dir,"report.json"),JSON.stringify(report,null,2));
  return report;
}

const f2=(v:number|undefined)=>typeof v==="number"&&Number.isFinite(v)?v.toFixed(2):"n/a";

/** The seven items for one real test, in plain language. */
export function caseReportMd(r:CaseReport):string{
  const L:string[]=[];
  L.push(`# ${r.id} — ${r.mode} — level ${r.level}`,"",`**Status: ${r.status}**${r.needsManual?" (a person should confirm corners/mask)":""}`,"");
  L.push("## 1–4. Pictures","",`1. Original source: \`source.jpg\``,`2. Reference: \`reference.jpg\``,`3. Final clean mockup: \`mockup.png\``,`4. Detection and placement overlay: \`overlay.jpg\``,"");
  L.push("## 5. Fidelity and geometry checks","");
  const q=r.qa;
  if(q.forward) L.push(`- Forward fidelity: ${q.forward.pass?"PASS":"FAIL"} (mean ΔE ${f2(q.forward.meanDeltaE)}, p95 ${f2(q.forward.p95DeltaE)}, SSIM ${f2(q.forward.ssim)}, sharpness ${f2(q.forward.sharpness)})`);
  if(q.crossCheck) L.push(`- Independent cross-check (original photo vs final mockup): ${q.crossCheck.pass?"PASS":"FAIL"} (mean ΔE ${f2(q.crossCheck.meanDeltaE)}, p95 ${f2(q.crossCheck.p95DeltaE)}, SSIM ${f2(q.crossCheck.ssim)})`);
  if(q.integrity) L.push(`- Scene untouched outside product and shadow: ${q.integrity.pass?"PASS":"FAIL"} (${q.integrity.changedOutsideAllowed} stray pixels)`);
  if(r.accuracy) L.push(`- Corner error against your marked truth: source ${f2(r.accuracy.sourceQuadErrorPx)} px, target ${f2(r.accuracy.targetQuadErrorPx)} px`);
  L.push(`- Product pixels modified beyond resampling: ${q.productPixelsModified?"yes (photographic level)":"no"}`);
  if(r.probes?.length) L.push(`- Sensitivity probes (known damage the check must catch): ${r.probes.map((p)=>`${p.name} ${p.detected?"caught":"MISSED"}`).join(", ")}`);
  L.push("","## 6. Visible realism defects","");
  const dd=r.defects;
  if(!dd.length&&!(r.realism?.findings.length)) L.push("None detected automatically. **Please still look at the mockup at 100%.**");
  for(const d of dd) L.push(`- [${d.severity}] ${d.code}: ${d.message}`);
  for(const x of r.realism?.findings ?? []) L.push(`- [${x.severity}] ${x.code} (measured ${f2(x.value)}${x.limit!==undefined?`, provisional limit ${x.limit}`:""}): ${x.message}`);
  L.push("","_Automatic realism checks use provisional, uncalibrated limits; your own review (review-template.json) is the reference._","","## 7. Recommended targeted corrections","");
  if(!r.corrections?.length) L.push("None suggested.");
  for(const c of r.corrections ?? []) L.push(`- **${c.kind}** — ${c.code}: ${c.action}`);
  L.push("","Thresholds are never loosened to make a case pass.","");
  return L.join("\n");
}

const pct=(v:number[],p:number)=>{if(!v.length) return NaN;const s=[...v].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(p*s.length))];};

export function summarise(reports:CaseReport[]){
  const by=(k:keyof CaseReport["qa"])=>reports.filter((r)=>r.qa[k]);
  void by;
  const col=(f:(r:CaseReport)=>number|undefined)=>reports.map(f).filter((v):v is number=>typeof v==="number"&&Number.isFinite(v));
  const stat=(v:number[])=>({n:v.length,p50:pct(v,0.5),p90:pct(v,0.9),max:v.length?Math.max(...v):NaN});
  const strictish=reports.filter((r)=>!r.qa.productPixelsModified);
  return {
    cases:reports.length,
    byStatus:reports.reduce<Record<string,number>>((a,r)=>{a[r.status]=(a[r.status]||0)+1;return a;},{}),
    needsManual:reports.filter((r)=>r.needsManual).length,
    automaticAll:reports.filter((r)=>r.automation.source==="auto"&&r.automation.target==="auto").length,
    defectCodes:reports.flatMap((r)=>r.defects).reduce<Record<string,number>>((a,d)=>{a[d.code]=(a[d.code]||0)+1;return a;},{}),
    accuracy:{
      sourceQuadErrorPx:stat(col((r)=>r.accuracy?.sourceQuadErrorPx)),
      targetQuadErrorPx:stat(col((r)=>r.accuracy?.targetQuadErrorPx)),
      sourceQuadErrorRel:stat(col((r)=>r.accuracy?.sourceQuadErrorRel)),
      targetQuadErrorRel:stat(col((r)=>r.accuracy?.targetQuadErrorRel))
    },
    /** distributions on real photos: use these to set tolerances, instead of the synthetic-data defaults */
    calibration:{
      forwardMeanDeltaE_nonPhotographic:stat(strictish.map((r)=>r.qa.forward?.meanDeltaE).filter((v):v is number=>typeof v==="number")),
      crossMeanDeltaE:stat(col((r)=>r.qa.crossCheck?.meanDeltaE)),
      crossP95DeltaE:stat(col((r)=>r.qa.crossCheck?.p95DeltaE)),
      crossSsim:stat(col((r)=>r.qa.crossCheck?.ssim)),
      crossChromaBiasA:stat(col((r)=>r.qa.crossCheck?.bias?Math.abs(r.qa.crossCheck.bias.a):undefined)),
      crossChromaBiasB:stat(col((r)=>r.qa.crossCheck?.bias?Math.abs(r.qa.crossCheck.bias.b):undefined))
    }
  };
}

function html(reports:CaseReport[],summary:ReturnType<typeof summarise>){
  const esc=(s:string)=>s.replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]!));
  const rows=reports.map((r)=>`<section><h3>${esc(r.id)} &middot; ${esc(r.level)} &middot; <span class="s ${r.status}">${r.status}</span>${r.needsManual?" &middot; needs manual":""}</h3>
${r.files.sheet?`<img loading="lazy" src="${r.files.sheet}">`:""}${r.files.overlay?`<img loading="lazy" src="${r.files.overlay}">`:""}
<p>${r.defects.map((d)=>`<code class="${d.severity}">${esc(d.code)}</code>`).join(" ")||"no defects"}</p>
<pre>${esc(JSON.stringify({qa:r.qa,accuracy:r.accuracy,adjustments:r.adjustments,focal:{source:r.inputs.sourceFocalUsed,reference:r.inputs.referenceFocalUsed}},null,1))}</pre>
${r.notes?`<p><em>${esc(r.notes)}</em></p>`:""}</section>`).join("\n");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validation</title>
<style>body{font:14px system-ui;margin:16px;max-width:1500px;background:#fafafa;color:#222}img{max-width:100%;border:1px solid #ddd;margin:4px 0}section{margin:24px 0;padding:12px;background:#fff;border:1px solid #e3e3e3}pre{overflow:auto;background:#f4f4f2;padding:8px;font-size:12px}.s.pass{color:#0a7a2f}.s.review{color:#b26a00}.s.fail{color:#b00020}code{padding:1px 5px;background:#eee}code.blocker{background:#fcd}code.warn{background:#ffe9b8}</style>
<h1>Real-photo validation</h1><pre>${esc(JSON.stringify(summary,null,1))}</pre>${rows}`;
}

export async function runValidation(manifestPath:string,outDir:string,o:{levels?:RealismLevel[];only?:string[];log?:(m:string)=>void}={}){
  const log=o.log ?? (()=>{});
  assertOutputIgnored(outDir);
  const baseDir=path.dirname(path.resolve(manifestPath));
  const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8")) as ValidationManifest;
  if(manifest.version!==1) throw new Error("Unsupported manifest version.");
  const tracked=inputsTrackedByGit(manifest.cases.flatMap((c)=>[c.source,c.reference].map((p)=>path.resolve(baseDir,p))));
  if(tracked.length) log(`WARNING: these inputs are tracked by git (customer images must not be committed): ${tracked.map((t)=>path.basename(t)).join(", ")}`);
  const levels=o.levels ?? manifest.levels ?? ["environment","photographic"];
  const reports:CaseReport[]=[];
  for(const c of manifest.cases){
    if(o.only && !o.only.includes(c.id)) continue;
    for(const level of levels){
      log(`${c.id} [${level}] ...`);
      try{
        const rep=await runCase(c,baseDir,level,outDir);
        reports.push(rep);
        log(`  ${rep.status}${rep.needsManual?" (needs manual)":""}  defects: ${rep.defects.map((d)=>d.code).join(", ")||"none"}`);
      }catch(e){
        log(`  ERROR: ${(e as Error).message}`);
        reports.push({
          id:c.id,mode:c.mode,level,status:"fail",needsManual:true,automation:{source:"auto",target:"auto",occlusion:"none"},
          defects:[{code:"INPUT_ERROR",severity:"blocker",message:(e as Error).message}],adjustments:{},qa:{},
          inputs:{source:{name:path.basename(c.source),sha256:"",width:0,height:0,exif:{focalSource:"none",hasGps:false,hasExif:false}},reference:{name:path.basename(c.reference),sha256:"",width:0,height:0,exif:{focalSource:"none",hasGps:false,hasExif:false}}},
          timingMs:0,files:{},notes:c.notes
        });
      }
    }
  }
  const summary=summarise(reports);
  fs.writeFileSync(path.join(outDir,"summary.json"),JSON.stringify({summary,reports},null,2));
  fs.writeFileSync(path.join(outDir,"index.html"),html(reports,summary));
  return {reports,summary};
}
