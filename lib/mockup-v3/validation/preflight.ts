import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {readExif} from "../exif";

/**
 * Checks an input photo BEFORE a validation run, so a bad file (HEIC, screenshot, messenger copy,
 * cropped, no EXIF) is reported with a fix instead of silently producing a poor result.
 */
export type PreflightIssue={level:"error"|"warn"|"info";code:string;message:string};

export type PreflightInfo={
  file:string;
  bytes:number;
  format?:string;
  width?:number;
  height?:number;
  exif?:{make?:string;model?:string;orientation?:number;focalPx?:number;focalSource:string;hasExif:boolean;hasGps:boolean};
  issues:PreflightIssue[];
  /** No error-level issue. */
  usable:boolean;
};

const SCREEN_WIDTHS=new Set([750,828,1080,1125,1170,1179,1242,1284,1290,1440,1536,1920,2048,2160,2532,2556,2560,2688,2778,2796,2880,3024,3456]);
const MESSENGER_LONG_SIDES=new Set([1280,1600,2048]);

function sniff(buf:Buffer):string{
  if(buf.length>=12 && buf.slice(4,8).toString("latin1")==="ftyp"){
    const brand=buf.slice(8,12).toString("latin1");
    if(/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(brand)) return "heic";
    if(brand==="avif"||brand==="avis") return "avif";
  }
  if(buf[0]===0xff&&buf[1]===0xd8) return "jpeg";
  if(buf.slice(0,8).toString("latin1")==="\x89PNG\r\n\x1a\n") return "png";
  if(buf.slice(0,4).toString("latin1")==="RIFF"&&buf.slice(8,12).toString("latin1")==="WEBP") return "webp";
  if(buf.slice(0,4).toString("latin1")==="%PDF") return "pdf";
  if((buf[0]===0x49&&buf[1]===0x49&&buf[2]===0x2a)||(buf[0]===0x4d&&buf[1]===0x4d&&buf[3]===0x2a)) return "tiff";
  return "unknown";
}

export async function preflightFile(file:string,role:"source"|"reference"|"mask"="source"):Promise<PreflightInfo>{
  const name=path.basename(file);
  const issues:PreflightIssue[]=[];
  const info:PreflightInfo={file:name,bytes:0,issues,usable:true};
  let buf:Buffer;
  try{buf=fs.readFileSync(file);}catch{
    issues.push({level:"error",code:"NOT_FOUND",message:"File could not be read."});
    info.usable=false;return info;
  }
  info.bytes=buf.length;
  if(!buf.length){issues.push({level:"error",code:"EMPTY",message:"File is empty (the upload may have failed)."});info.usable=false;return info;}
  const kind=sniff(buf);info.format=kind;
  if(kind==="heic"||kind==="avif"){
    issues.push({level:"error",code:"HEIC_UNSUPPORTED",message:"HEIC/AVIF photos cannot be decoded here. On iPhone: Settings > Camera > Formats > Most Compatible (for new photos), or Share > Options > Format: Most Compatible; or AirDrop to a Mac with 'Most Compatible'. This keeps the EXIF data."});
    info.usable=false;return info;
  }
  if(kind==="pdf"){issues.push({level:"error",code:"NOT_AN_IMAGE",message:"This is a PDF, not a photo."});info.usable=false;return info;}
  let meta:Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try{meta=await sharp(buf).metadata();}catch(e){
    issues.push({level:"error",code:"UNREADABLE",message:"The image could not be decoded: "+String((e as Error).message).slice(0,120)});
    info.usable=false;return info;
  }
  const exif=await readExif(buf);
  info.width=exif.width;info.height=exif.height;
  info.exif={make:exif.make,model:exif.model,orientation:exif.orientation,focalPx:exif.focalPx,focalSource:exif.focalSource,hasExif:exif.hasExif,hasGps:exif.hasGps};
  const long=Math.max(exif.width,exif.height),short=Math.min(exif.width,exif.height);

  if(role==="mask"){
    if(meta.width!==undefined && short<100) issues.push({level:"warn",code:"MASK_TINY",message:"The mask is very small; it will be resized to the reference."});
    info.usable=!issues.some((i)=>i.level==="error");
    return info;
  }

  if(long<800) issues.push({level:"error",code:"LOW_RESOLUTION",message:`Only ${long}px on the long side; at least 1600px is needed for a meaningful test (originals are usually 3000-4000px).`});
  else if(long<1600) issues.push({level:"warn",code:"LOW_RESOLUTION",message:`${long}px on the long side is low; fine detail and edge accuracy will be limited. Send the original.`});

  if(!exif.hasExif){
    issues.push({level:"warn",code:"NO_EXIF",message:"No EXIF data: focal length is unknown, so proportions on angled photos cannot be verified. Send the original file from the camera (not a screenshot, download or messenger copy)."});
    if(kind==="png"||SCREEN_WIDTHS.has(short)||SCREEN_WIDTHS.has(long)) issues.push({level:"warn",code:"LOOKS_LIKE_SCREENSHOT",message:"The size/format looks like a screenshot or export, not an original photo."});
    if(MESSENGER_LONG_SIDES.has(long) && kind==="jpeg") issues.push({level:"warn",code:"LIKELY_MESSENGER_COPY",message:`A JPEG with no metadata and exactly ${long}px on the long side is typical of a WhatsApp/Messenger copy (recompressed, metadata stripped).`});
  }else{
    if(exif.focalSource==="none") issues.push({level:"info",code:"FOCAL_UNKNOWN",message:"EXIF is present but has no usable focal length; proportions on angled views may be flagged as unverified."});
    if(exif.focalCaution) issues.push({level:"warn",code:"CROPPED_SINCE_CAPTURE",message:exif.focalCaution});
    if((exif.orientation ?? 1)!==1) issues.push({level:"info",code:"ORIENTATION_APPLIED",message:`Camera orientation tag ${exif.orientation} will be applied (corner coordinates must be given in the rotated, as-viewed image).`});
    if(exif.hasGps) issues.push({level:"info",code:"GPS_PRESENT",message:"The file contains GPS data. It is never copied into reports or outputs."});
  }
  if(buf.length<150_000 && long>=1600) issues.push({level:"warn",code:"HEAVY_COMPRESSION",message:"A very small file for this resolution suggests heavy JPEG compression; colour accuracy and edges may suffer."});
  info.usable=!issues.some((i)=>i.level==="error");
  return info;
}

const IMG=/\.(jpe?g|png|webp|tiff?|heic|heif|avif)$/i;
export async function preflightFolder(dir:string){
  const results:PreflightInfo[]=[];
  for(const f of fs.readdirSync(dir).sort()){
    if(!IMG.test(f)) continue;
    const role=/_mask\./i.test(f)?"mask":/_reference\./i.test(f)?"reference":"source";
    results.push(await preflightFile(path.join(dir,f),role));
  }
  return results;
}

export function formatPreflight(results:PreflightInfo[]):string{
  const icon={error:"ERROR",warn:"warn ",info:"info "};
  return results.map((r)=>{
    const head=`${r.usable?"OK  ":"FAIL"} ${r.file}  ${r.width??"?"}x${r.height??"?"}  ${(r.bytes/1e6).toFixed(1)}MB  ${r.exif?.make??""} ${r.exif?.model??""}${r.exif?.focalPx?`  focal~${Math.round(r.exif.focalPx)}px`:""}`;
    return [head,...r.issues.map((i)=>`      ${icon[i.level]} ${i.code}: ${i.message}`)].join("\n");
  }).join("\n");
}
