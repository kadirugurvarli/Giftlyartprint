import fs from "node:fs";
import path from "node:path";
import {buildApproval,calibrate} from "../lib/mockup-v3/validation/calibration";
import type {CaseReport,Review} from "../lib/mockup-v3/validation/runner";
import {approvedFilePath} from "../lib/mockup-v3/qa/tolerance-registry";

const a=process.argv.slice(2);
const arg=(n:string)=>{const i=a.indexOf(n);return i>=0?a[i+1]:undefined;};
const summary=arg("--summary"),reviewDir=arg("--review");
if(!summary||!reviewDir){console.error("usage: npm run calibrate -- --summary validation-output/summary.json --review <folder of filled review-*.json> [--approve --by NAME --reason TEXT]");process.exit(2);}
const reports=(JSON.parse(fs.readFileSync(summary,"utf8")).reports) as CaseReport[];
const reviews:Review[]=[];
const walk=(d:string)=>{for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory()) walk(p);else if(f.endsWith(".json")){try{const j=JSON.parse(fs.readFileSync(p,"utf8"));if(j&&j.id&&j.level&&"verdict" in j) reviews.push(j);}catch{/* skip */}}}};
walk(reviewDir);
const rep=calibrate(reports,reviews);
console.log(`Reviewed good: ${rep.goodCases}  bad: ${rep.badCases}  cases with probes: ${rep.probeCases}`);
if(rep.insufficient) console.log(rep.insufficient);
for(const m of rep.metrics) console.log(`- ${m.metric}: current ${m.current}, good p95 ${m.goodP95?.toFixed(2)??"n/a"}, false rejects ${m.falseRejects}, => ${m.proposal}${m.proposedValue!==null?` ${m.proposedValue}`:""}. ${m.reason}`);
if(a.includes("--approve")){
  const by=arg("--by"),reason=arg("--reason");
  if(!by||!reason){console.error("--approve needs --by and --reason");process.exit(2);}
  try{
    const doc=buildApproval(rep,"rectified",by,reason);
    const f=approvedFilePath();fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(doc,null,2));
    console.log(`Written ${f}. Review it in git before committing; it contains only numbers.`);
  }catch(e){console.error(`NOT APPROVED: ${(e as Error).message}`);process.exit(1);}
}
