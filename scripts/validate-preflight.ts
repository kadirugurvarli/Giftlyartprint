/** npm run validate:preflight -- <folder>   Checks every photo in a folder and says what to fix. */
import path from "node:path";
import {formatPreflight,preflightFolder} from "../lib/mockup-v3/validation/preflight";
(async()=>{
  const dir=path.resolve(process.argv[2] ?? "validation-input");
  const r=await preflightFolder(dir);
  if(!r.length){console.error("No photos found in",dir);process.exit(1);}
  console.log(formatPreflight(r));
  const bad=r.filter((x)=>!x.usable).length,warn=r.filter((x)=>x.issues.some((i)=>i.level==="warn")).length;
  console.log(`\n${r.length} files: ${r.length-bad} usable, ${bad} must be fixed, ${warn} with warnings.`);
  process.exit(bad?1:0);
})();
