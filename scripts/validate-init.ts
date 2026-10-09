/** npm run validate:init -- <folder> [--force]   Builds manifest.json from the A-01_source.jpg / A-01_reference.jpg naming convention. */
import fs from "node:fs";
import path from "node:path";
import {buildManifestFromFolder} from "../lib/mockup-v3/validation/intake";
const dir=path.resolve(process.argv[2] ?? "validation-input");
const out=path.join(dir,"manifest.json");
const r=buildManifestFromFolder(dir);
r.problems.forEach((p)=>console.error("PROBLEM:",p));
r.unmatched.forEach((f)=>console.warn("ignored (does not match the naming convention):",f));
if(!r.cases){console.error("No complete cases found.");process.exit(1);}
if(fs.existsSync(out)&&!process.argv.includes("--force")){console.error("manifest.json already exists; use --force to overwrite.");process.exit(1);}
fs.writeFileSync(out,JSON.stringify(r.manifest,null,2));
console.log(`Wrote ${out} with ${r.cases} case(s):`);
r.manifest.cases.forEach((c)=>console.log(`  ${c.id}  ${c.mode}  ${c.source} + ${c.reference}${c.manual?.occlusionMask?" + mask":""}`));
