import {execFileSync} from "node:child_process";
import {findForbiddenTracked} from "../lib/mockup-v3/validation/asset-guard";
const files=execFileSync("git",["ls-files","-z"]).toString().split("\0").filter(Boolean);
const bad=findForbiddenTracked(files);
if(bad.length){console.error("Image/customer files tracked by git outside the allowlist:\n"+bad.join("\n"));process.exit(1);}
console.log("OK: no customer-style image files are tracked.");
