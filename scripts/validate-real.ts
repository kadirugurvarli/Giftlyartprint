/**
 * Real-photo validation CLI.
 *   npx tsx scripts/validate-real.ts --manifest validation-input/manifest.json --out validation-output
 *   options: --levels environment,photographic   --only A-01,B-02
 * Inputs and outputs contain customer material: keep them in git-ignored folders (the tool refuses otherwise).
 */
import path from "node:path";
import {runValidation} from "../lib/mockup-v3/validation/runner";
import type {RealismLevel} from "../lib/mockup-v3/pipeline";

function arg(name:string){const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;}

(async()=>{
  const manifest=arg("manifest");
  if(!manifest){console.error("usage: validate-real --manifest <manifest.json> [--out validation-output] [--levels strict,environment,photographic] [--only id1,id2]");process.exit(2);}
  const out=path.resolve(arg("out") ?? "validation-output");
  const levels=arg("levels")?.split(",") as RealismLevel[]|undefined;
  const only=arg("only")?.split(",");
  const {summary}=await runValidation(manifest,out,{levels,only,log:(m)=>console.log(m)});
  console.log("\nSummary:",JSON.stringify(summary,null,1));
  console.log("\nOpen:",path.join(out,"index.html"));
})().catch((e)=>{console.error("ERROR:",e.message);process.exit(1);});
