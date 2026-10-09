import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";

/**
 * Downloads private files from short-lived signed links into a git-ignored folder. Links are
 * secrets: they are never printed, logged or stored (errors are scrubbed of URLs).
 * List file format, one per line:  <file name><whitespace><https url>   ('#' starts a comment)
 */
export type FetchResult={name:string;ok:boolean;bytes?:number;sha256?:string;error?:string};

const SAFE_NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
export const MAX_BYTES=80*1024*1024;

export function parseUrlList(text:string):{name:string;url:string}[]{
  const out:{name:string;url:string}[]=[];
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith("#")) continue;
    const m=/^(\S+)\s+(\S+)$/.exec(line);
    if(!m) throw new Error("Each line must be: <file name> <https link>");
    out.push({name:m[1],url:m[2]});
  }
  return out;
}

const scrub=(msg:string)=>msg.replace(/https?:\/\/\S+/gi,"[link removed]");

export async function fetchPrivateFiles(
  entries:{name:string;url:string}[],outDir:string,
  o:{fetchImpl?:typeof fetch;maxBytes?:number;log?:(m:string)=>void}={}
):Promise<FetchResult[]>{
  const f=o.fetchImpl ?? fetch;
  const max=o.maxBytes ?? MAX_BYTES;
  fs.mkdirSync(outDir,{recursive:true});
  const results:FetchResult[]=[];
  for(const e of entries){
    try{
      if(!SAFE_NAME.test(e.name)) throw new Error("unsafe file name");
      const u=new URL(e.url);
      if(u.protocol!=="https:") throw new Error("only https links are accepted");
      const res=await f(e.url,{redirect:"follow"});
      if(!res.ok) throw new Error(`download failed (HTTP ${res.status}); the link may have expired`);
      const len=Number(res.headers.get("content-length") ?? 0);
      if(len>max) throw new Error("file is larger than the size limit");
      const type=(res.headers.get("content-type") ?? "").toLowerCase();
      if(type && !/^(image\/|application\/octet-stream|binary\/octet-stream)/.test(type)) throw new Error(`unexpected content type "${type.split(";")[0]}" (a share-page link instead of a direct file link?)`);
      const buf=Buffer.from(await res.arrayBuffer());
      if(buf.length>max) throw new Error("file is larger than the size limit");
      if(!buf.length) throw new Error("empty download");
      const dest=path.join(outDir,e.name);
      fs.writeFileSync(dest,buf,{mode:0o600});
      const sha=createHash("sha256").update(buf).digest("hex").slice(0,16);
      results.push({name:e.name,ok:true,bytes:buf.length,sha256:sha});
      o.log?.(`  ${e.name}  ${(buf.length/1e6).toFixed(1)} MB  ${sha}`);
    }catch(err){
      const msg=scrub((err as Error).message);
      results.push({name:e.name,ok:false,error:msg});
      o.log?.(`  ${e.name}  FAILED: ${msg}`);
    }
  }
  return results;
}
