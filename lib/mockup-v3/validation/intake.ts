import fs from "node:fs";
import path from "node:path";
import type {ValidationCase,ValidationManifest} from "./runner";
import type {MockupMode} from "../pipeline";

/**
 * Folder convention (no JSON needed to start):
 *   A-01_source.jpg  A-01_reference.jpg  [A-01_mask.png]  [A-01.json]
 *   B-02_source.jpg  B-02_reference.jpg  ...
 * "A..." ids = bare print into a frame (artwork-in-frame); "B..." = framed piece onto a wall (framed-on-wall).
 * The optional sidecar A-01.json may hold: mode, options, groundTruth, manual, notes.
 */
export type IntakeResult={manifest:ValidationManifest;problems:string[];unmatched:string[];cases:number};

const FILE=/^([A-Za-z0-9][A-Za-z0-9-]*)_(source|reference|mask)\.(jpe?g|png|webp|tiff?)$/i;

export function buildManifestFromFolder(dir:string):IntakeResult{
  const files=fs.readdirSync(dir).filter((f)=>!f.startsWith(".")&&f!=="manifest.json");
  const byId=new Map<string,{source?:string;reference?:string;mask?:string;sidecar?:string}>();
  const unmatched:string[]=[];
  for(const f of files){
    const m=FILE.exec(f);
    if(m){
      const e=byId.get(m[1]) ?? {};
      (e as any)[m[2].toLowerCase()]=f;
      byId.set(m[1],e);
    }else if(/^[A-Za-z0-9][A-Za-z0-9-]*\.json$/.test(f)){
      const id=f.replace(/\.json$/,"");
      const e=byId.get(id) ?? {};e.sidecar=f;byId.set(id,e);
    }else unmatched.push(f);
  }
  const problems:string[]=[];
  const cases:ValidationCase[]=[];
  for(const [id,e] of [...byId.entries()].sort((a,b)=>a[0].localeCompare(b[0],undefined,{numeric:true}))){
    let side:Record<string,any>={};
    if(e.sidecar){
      try{side=JSON.parse(fs.readFileSync(path.join(dir,e.sidecar),"utf8"));}
      catch(err){problems.push(`${e.sidecar}: not valid JSON (${(err as Error).message})`);continue;}
    }
    if(!e.source||!e.reference){problems.push(`${id}: needs both ${id}_source.<jpg|png> and ${id}_reference.<jpg|png>${!e.source&&!e.reference?" (only a sidecar was found)":""}`);continue;}
    let mode:MockupMode|undefined=side.mode;
    if(!mode) mode=/^A/i.test(id)?"artwork-in-frame":/^B/i.test(id)?"framed-on-wall":undefined;
    if(!mode){problems.push(`${id}: cannot tell the workflow. Start the id with A (bare print into a frame) or B (framed piece onto a wall), or set "mode" in ${id}.json`);continue;}
    if(mode!=="artwork-in-frame"&&mode!=="framed-on-wall"){problems.push(`${id}: unknown mode "${mode}"`);continue;}
    const c:ValidationCase={id,mode,source:e.source,reference:e.reference,options:side.options,groundTruth:side.groundTruth,notes:side.notes,manual:side.manual};
    if(e.mask){c.manual={...(c.manual??{}),occlusionMask:e.mask};}
    cases.push(c);
  }
  return {manifest:{version:1,cases},problems,unmatched,cases:cases.length};
}
