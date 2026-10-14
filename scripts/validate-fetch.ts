/**
 * npm run validate:fetch -- <links.txt> [--out validation-input] [--delete-list]
 * links.txt: one "<file name> <https expiring link>" per line. Links are secrets: never printed or stored.
 */
import fs from "node:fs";
import path from "node:path";
import {fetchPrivateFiles,parseUrlList} from "../lib/mockup-v3/validation/fetch";
(async()=>{
  const list=process.argv[2];
  if(!list){console.error("usage: validate:fetch <links.txt> [--out dir] [--delete-list]");process.exit(2);}
  const i=process.argv.indexOf("--out");
  const out=path.resolve(i>=0?process.argv[i+1]:"validation-input");
  const entries=parseUrlList(fs.readFileSync(list,"utf8"));
  console.log(`Downloading ${entries.length} file(s) into ${out}`);
  const r=await fetchPrivateFiles(entries,out,{log:console.log});
  if(process.argv.includes("--delete-list")){fs.rmSync(list);console.log("Deleted the link list.");}
  process.exit(r.every((x)=>x.ok)?0:1);
})();
