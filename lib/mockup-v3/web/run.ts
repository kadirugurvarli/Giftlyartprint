import sharp from "sharp";
import {decodeImage} from "../io";
import {runMockup,type MockupMode,type MockupOptions,type RealismLevel} from "../pipeline";
import {auditRealism} from "../validation/realism-audit";
import {recommendCorrections} from "../validation/corrections";
import type {ExifHint} from "./hint";
import {focalFromHint} from "./focal";
import {RESPONSE_LIMIT_BYTES,REFERENCE_MAX_SIDE} from "./limits";

export type WebRunInput={
  mode:MockupMode;level:RealismLevel;
  source:Buffer;reference:Buffer;
  sourceHint:ExifHint;referenceHint:ExifHint;
  /** optional real size of the finished framed piece (cm), mode framed-on-wall */
  pieceWidthCm?:number;ceilingHeightCm?:number;
};

const f=(v:number|undefined)=>typeof v==="number"&&Number.isFinite(v)?Number(v.toFixed(3)):null;

/** Smallest JPEG of `img` that fits `budget` bytes: lower quality first (down to 82), then dimensions. Never EXIF. */
async function fitJpeg(raw:{data:Uint8ClampedArray;width:number;height:number},budget:number){
  let w=raw.width,h=raw.height;
  const mk=(w:number,h:number,q:number)=>sharp(Buffer.from(raw.data.buffer,raw.data.byteOffset,raw.data.byteLength),{raw:{width:raw.width,height:raw.height,channels:4}})
    .removeAlpha().resize(w,h,{kernel:"lanczos3"}).jpeg({quality:q,chromaSubsampling:"4:4:4",mozjpeg:true}).toBuffer(); // no withMetadata: output carries no EXIF/GPS
  for(let step=0;step<12;step++){
    for(const q of [95,92,88,84,82]){
      const b=await mk(w,h,q);
      if(b.length<=budget) return {bytes:b,width:w,height:h,quality:q,scaled:w!==raw.width};
    }
    w=Math.round(w*0.9);h=Math.round(h*0.9);
  }
  const b=await mk(w,h,80);
  return {bytes:b,width:w,height:h,quality:80,scaled:true};
}

export async function runWeb(inp:WebRunInput){
  const t0=Date.now();
  const src=await decodeImage(inp.source);
  const ref=await decodeImage(inp.reference);
  const sf=focalFromHint(inp.sourceHint,src.width,src.height);
  const rf=focalFromHint(inp.referenceHint,ref.width,ref.height);
  const options:MockupOptions={realism:{level:inp.level},maxReferenceSide:REFERENCE_MAX_SIDE};
  if(sf.focalPx) options.sourceFocalPx=sf.focalPx;
  if(rf.focalPx) options.referenceFocalPx=rf.focalPx;
  if(inp.mode==="framed-on-wall"){
    if(inp.pieceWidthCm) options.physicalWidthM=inp.pieceWidthCm/100;
    if(inp.ceilingHeightCm) options.ceilingHeightM=inp.ceilingHeightCm/100;
  }
  const r=await runMockup({mode:inp.mode,source:src,reference:ref,options,manual:{}});
  const audit=auditRealism({result:r,reference:ref,maxReferenceSide:REFERENCE_MAX_SIDE});
  const corrections=recommendCorrections(r.defects,audit.findings);

  let mockup:{bytes:Buffer;width:number;height:number;quality:number;scaled:boolean}|null=null,overlay:Buffer|null=null;
  if(r.image) mockup=await fitJpeg(r.image,RESPONSE_LIMIT_BYTES-420_000-40_000);
  if(r.diagnostics.overlay&&mockup){
    const o=r.diagnostics.overlay;
    const room=Math.max(60_000,RESPONSE_LIMIT_BYTES-mockup.bytes.length-60_000);
    const b=await fitJpeg(o,Math.min(420_000,room));
    overlay=b.bytes;
  }
  const q=r.qa;
  const report={
    mode:r.mode,level:inp.level,status:r.status,needsManual:r.needsManual,automation:r.automation,
    defects:r.defects.map((d)=>({code:d.code,severity:d.severity,message:d.message})),
    realism:{findings:audit.findings.map((x)=>({code:x.code,severity:x.severity,value:f(x.value),limit:x.limit??null,message:x.message})),measurements:audit.measurements,calibrated:false},
    corrections,
    qa:{
      forward:q.forward?{pass:q.forward.pass,meanDeltaE:f(q.forward.metrics.meanDeltaE),p95DeltaE:f(q.forward.metrics.p95DeltaE),ssim:f(q.forward.metrics.ssim),sharpness:f(q.forward.metrics.sharpnessRatio)}:null,
      crossCheck:q.crossCheck?{pass:q.crossCheck.pass,meanDeltaE:f(q.crossCheck.metrics?.meanDeltaE),p95DeltaE:f(q.crossCheck.metrics?.p95DeltaE),ssim:f(q.crossCheck.metrics?.ssim)}:null,
      integrity:q.sceneIntegrity?{pass:q.sceneIntegrity.pass,changedOutsideAllowed:q.sceneIntegrity.changedOutsideAllowed}:null,
      productPixelsModified:q.productPixels?.modified ?? null
    },
    adjustments:r.adjustments,
    input:{
      sourcePx:[src.width,src.height],referencePx:[ref.width,ref.height],
      sourceOriginalPx:[inp.sourceHint.originalWidth,inp.sourceHint.originalHeight],
      sourceDownscaleFactor:f(Math.max(src.width,src.height)/Math.max(inp.sourceHint.originalWidth,inp.sourceHint.originalHeight)),
      sourceFocal:sf.focalPx?{px:f(sf.focalPx),from:sf.source}:null,referenceFocal:rf.focalPx?{px:f(rf.focalPx),from:rf.source}:null,
      focalCaution:[sf.caution,rf.caution].filter(Boolean),
      camera:{source:[inp.sourceHint.make,inp.sourceHint.model].filter(Boolean).join(" ")||null,reference:[inp.referenceHint.make,inp.referenceHint.model].filter(Boolean).join(" ")||null}
    },
    output:mockup?{px:[mockup.width,mockup.height],jpegQuality:mockup.quality,shrunkToFit:mockup.scaled,note:"Download is a JPEG export sized for the preview's transfer limit. The lossless full-size render needs the local run."}:null,
    notes:["Checks ran on the shrunken upload, so sharpness is judged at that size.","Realism checks use provisional, uncalibrated limits; your own eye is the reference."],
    timingMs:Date.now()-t0
  };
  return {report,mockup:mockup?.bytes ?? null,overlay};
}
