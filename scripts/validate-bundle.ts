import fs from "node:fs";
import path from "node:path";
import {numbersOnly} from "../lib/mockup-v3/validation/bundle";
import {assertOutputIgnored} from "../lib/mockup-v3/validation/runner";

const a=process.argv.slice(2);
const dir=a.find((x)=>!x.startsWith("--")) ?? "validation-output";
const sum=path.join(dir,"summary.json");
if(!fs.existsSync(sum)){console.error(`No ${sum}. Run npm run validate:real first.`);process.exit(2);}
assertOutputIgnored(dir);
const j=JSON.parse(fs.readFileSync(sum,"utf8"));
const out=path.join(dir,"share-bundle");fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,"numbers.json"),JSON.stringify({summary:j.summary,cases:numbersOnly(j.reports)},null,1));
if(a.includes("--include-images")){
  for(const r of j.reports) for(const f of [r.files?.sheet,r.files?.overlay]) if(f){
    const dst=path.join(out,f.replace(/\//g,"_"));fs.copyFileSync(path.join(dir,f),dst);
  }
  console.log("Images included (review sheets and overlays only; they show customer artwork).");
}
console.log(`Wrote ${path.join(out,"numbers.json")} - contains numbers and defect codes only.`);
