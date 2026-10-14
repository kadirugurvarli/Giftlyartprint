/**
 * Local loader for a V4 experiment pack (room image + calibration + non-customer sample artwork).
 * Reads files from a git-ignored folder, decodes in memory (metadata/EXIF dropped, orientation applied) and never stores anything.
 */
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import sharp from "sharp";
import type {RawImage} from "../lib/mockup-v3/types";
import {inputsTrackedByGit} from "../lib/mockup-v3/validation/runner";
import {validatePackManifest,type PackIssue,type PackManifest} from "../lib/mockup-v4/pack";

export const MAX_FILE_BYTES=40*1024*1024,MAX_SIDE=8000,MIN_ROOM_SIDE=2400,MIN_ART_SIDE=1200;

export type LoadedPack={dir:string;manifest:PackManifest;roomImage:RawImage;artwork:RawImage;issues:PackIssue[]};

/** A pack folder inside a git repository must be git-ignored (room and artwork files must never be committable). */
export function assertPackIgnored(dir:string){
  let repo:string;
  try{repo=execFileSync("git",["-C",dir,"rev-parse","--show-toplevel"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();}
  catch{return;} // outside any repository
  try{execFileSync("git",["-C",repo,"check-ignore","-q",path.resolve(dir)],{stdio:"ignore"});}
  catch{throw new Error(`Refusing to read pack "${dir}": it is inside a git repository and NOT ignored. Use private-fixtures/ or validation-output/ (ignored) or a folder outside the repository.`);}
}

async function decode(file:string,what:string):Promise<RawImage>{
  const st=fs.statSync(file);
  if(st.size>MAX_FILE_BYTES) throw new Error(`${what}_FILE_TOO_LARGE`);
  const r=await sharp(fs.readFileSync(file),{failOn:"error"}).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(Math.max(r.info.width,r.info.height)>MAX_SIDE) throw new Error(`${what}_TOO_LARGE_PIXELS`);
  return {width:r.info.width,height:r.info.height,data:new Uint8ClampedArray(r.data.buffer,r.data.byteOffset,r.data.byteLength)};
}

export async function loadPack(dirIn:string):Promise<LoadedPack>{
  const dir=path.resolve(dirIn);
  assertPackIgnored(dir);
  const mf=path.join(dir,"manifest.json");
  if(!fs.existsSync(mf)) throw new Error(`PACK_MANIFEST_MISSING: ${mf}`);
  const manifest=JSON.parse(fs.readFileSync(mf,"utf8")) as PackManifest;
  const issues=validatePackManifest(manifest);
  const fatal=issues.filter(i=>i.code.startsWith("PACK_FILE_NAME")||i.code==="PACK_SCHEMA_VERSION");
  if(fatal.length) return {dir,manifest,roomImage:{width:0,height:0,data:new Uint8ClampedArray(0)},artwork:{width:0,height:0,data:new Uint8ClampedArray(0)},issues};
  const files=[path.join(dir,manifest.roomImage),path.join(dir,manifest.artworkImage)];
  for(const f of files) if(!fs.existsSync(f)) throw new Error(`PACK_FILE_MISSING: ${path.basename(f)}`);
  const tracked=inputsTrackedByGit(files);
  if(tracked.length) throw new Error(`PACK_FILES_TRACKED_BY_GIT: ${tracked.map(t=>path.basename(t)).join(", ")}`);
  const roomImage=await decode(files[0],"ROOM"),artwork=await decode(files[1],"ARTWORK");
  if(roomImage.width!==manifest.room.image.width||roomImage.height!==manifest.room.image.height) issues.push({code:"PACK_ROOM_IMAGE_SIZE_MISMATCH",detail:`${roomImage.width}x${roomImage.height} vs calibrated ${manifest.room.image.width}x${manifest.room.image.height}`});
  if(Math.max(roomImage.width,roomImage.height)<MIN_ROOM_SIDE) issues.push({code:"PACK_ROOM_TOO_SMALL_FOR_DETAIL",detail:`long side ${Math.max(roomImage.width,roomImage.height)} px < ${MIN_ROOM_SIDE}`});
  if(Math.max(artwork.width,artwork.height)<MIN_ART_SIDE) issues.push({code:"PACK_ARTWORK_TOO_SMALL",detail:`long side ${Math.max(artwork.width,artwork.height)} px < ${MIN_ART_SIDE}`});
  for(let i=3;i<artwork.data.length;i+=4) if(artwork.data[i]!==255){issues.push({code:"PACK_ARTWORK_HAS_TRANSPARENCY"});break;}
  return {dir,manifest,roomImage,artwork,issues};
}
