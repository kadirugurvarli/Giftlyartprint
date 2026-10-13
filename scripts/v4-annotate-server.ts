import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import sharp from "sharp";
import {analyseAnnotation,buildPackManifest,validateAnnotationShape,type ImportMeta,type RoomAnnotation} from "../lib/mockup-v4/annotation";
import {validatePackManifest} from "../lib/mockup-v4/pack";
import {assertPackIgnored,MIN_ART_SIDE,MIN_ROOM_SIDE} from "./v4-pack";
import {BodyTooLarge,gate,readBody,send,sendJson} from "./v4-http";

export type AnnotateOptions={outRoot:string;port?:number};

/** Local room annotation tool: validates annotations with the real V3 room validator and writes a pack to a git-ignored folder. */
export function createAnnotateServer(o:AnnotateOptions){
  let port=o.port ?? 0;
  const html=fs.readFileSync(path.resolve(__dirname,"../tools/v4-annotate/index.html"));
  const server=http.createServer(async(req,res)=>{
    try{
      port=(server.address() as {port:number}).port;
      if(!gate(req,res,port)) return;
      const url=new URL(req.url ?? "/",`http://127.0.0.1:${port}`);
      if(req.method==="GET"&&url.pathname==="/") return send(res,200,html,"text/html; charset=utf-8");
      if(req.method==="GET"&&url.pathname==="/favicon.ico") return send(res,204,"");
      if(req.method==="POST"&&url.pathname==="/api/analyse"){
        const a=JSON.parse((await readBody(req,5_000_000)).toString("utf8")) as RoomAnnotation;
        return sendJson(res,200,{ok:true,...analyseAnnotation(a)});
      }
      if(req.method==="POST"&&url.pathname==="/api/import"){
        const b=JSON.parse((await readBody(req,120_000_000)).toString("utf8")) as {annotation:RoomAnnotation;roomImageBase64:string;roomImageName:string;artworkBase64:string;artworkName:string;packName:string;meta:Omit<ImportMeta,"roomImage"|"artworkImage"|"id">&{id?:string}};
        const r=await importPack(o.outRoot,b);
        return sendJson(res,r.ok?200:422,r);
      }
      sendJson(res,404,{ok:false,error:"NOT_FOUND"});
    }catch(e){
      if(e instanceof BodyTooLarge) return sendJson(res,413,{ok:false,error:"BODY_TOO_LARGE"});
      sendJson(res,400,{ok:false,error:"BAD_REQUEST"});
    }
  });
  return server;
}

const ext=(n:string)=>/\.(png|jpe?g|webp)$/i.exec(n)?.[0].toLowerCase() ?? ".png";

export async function importPack(outRoot:string,b:{annotation:RoomAnnotation;roomImageBase64:string;roomImageName:string;artworkBase64:string;artworkName:string;packName:string;meta:Omit<ImportMeta,"roomImage"|"artworkImage"|"id">&{id?:string}}){
  const issues:{code:string;detail?:string}[]=[];
  if(!/^[a-z0-9][a-z0-9-]{2,60}$/.test(b.packName ?? "")) return {ok:false as const,issues:[{code:"PACK_NAME_INVALID"}]};
  const room=Buffer.from(b.roomImageBase64 ?? "","base64"),art=Buffer.from(b.artworkBase64 ?? "","base64");
  if(!room.length||!art.length) return {ok:false as const,issues:[{code:"IMAGE_MISSING"}]};
  const rm=await sharp(room).rotate().metadata().catch(()=>null),am=await sharp(art).metadata().catch(()=>null);
  if(!rm?.width||!rm.height||!am?.width) return {ok:false as const,issues:[{code:"IMAGE_UNREADABLE"}]};
  // metadata after EXIF rotation
  const rotated=await sharp(room).rotate().toBuffer({resolveWithObject:true});
  if(rotated.info.width!==b.annotation.image.width||rotated.info.height!==b.annotation.image.height) issues.push({code:"ANNOTATION_IMAGE_SIZE_MISMATCH",detail:`${rotated.info.width}x${rotated.info.height} vs annotated ${b.annotation.image.width}x${b.annotation.image.height}`});
  if(Math.max(rotated.info.width,rotated.info.height)<MIN_ROOM_SIDE) issues.push({code:"ROOM_TOO_SMALL_FOR_DETAIL"});
  if(Math.max(am.width,am.height ?? 0)<MIN_ART_SIDE) issues.push({code:"ARTWORK_TOO_SMALL"});
  issues.push(...validateAnnotationShape(b.annotation));
  const manifest=buildPackManifest(b.annotation,{...b.meta,id:b.packName,roomImage:`room${ext(b.roomImageName)}`,artworkImage:`artwork${ext(b.artworkName)}`} as ImportMeta);
  issues.push(...validatePackManifest(manifest));
  if(issues.length) return {ok:false as const,issues};
  const dir=path.resolve(outRoot,b.packName);
  fs.mkdirSync(dir,{recursive:true});
  assertPackIgnored(dir);
  // re-encode the room with orientation applied so the stored pixels match the annotation (EXIF is dropped)
  fs.writeFileSync(path.join(dir,manifest.roomImage),await sharp(room).rotate().toFormat(ext(manifest.roomImage)==".jpg"?"jpeg":(ext(manifest.roomImage).slice(1) as "png"|"webp")).toBuffer());
  fs.writeFileSync(path.join(dir,manifest.artworkImage),art);
  fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify(manifest,null,2));
  return {ok:true as const,dir,manifest:manifest.id,issues:[]};
}
