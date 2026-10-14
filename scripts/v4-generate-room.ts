/**
 * The ONE AI room generation. DRY RUN BY DEFAULT: prints the exact request (model, size, quality, prompt) and the paid-readiness
 * checklist, and makes no network call.
 *   npx tsx scripts/v4-generate-room.ts [--quality high] [--out private-fixtures/v4-generated]
 * A paid call needs ALL of: --execute --authorize-paid --max-spend-usd <cap> --price-per-image-usd <owner-verified price> and OPENAI_API_KEY.
 * The result is written ONLY to a git-ignored folder; then annotate it with scripts/v4-annotate.ts.
 */
import fs from "node:fs";
import path from "node:path";
import {assertOutputIgnored} from "../lib/mockup-v3/validation/runner";
import {buildRoomGenRequest,generateRoom} from "../lib/mockup-v4/roomgen";
import {describeSpend,SpendGuard} from "../lib/mockup-v4/spend";

const argv=process.argv.slice(2);
const flag=(n:string)=>argv.includes(`--${n}`);
const val=(n:string)=>{const i=argv.indexOf(`--${n}`);return i>=0?argv[i+1]:undefined;};

(async()=>{
  const q=(val("quality") ?? "high") as "low"|"medium"|"high";
  const req=buildRoomGenRequest({quality:q,size:val("size")});
  const price=val("price-per-image-usd")?Number(val("price-per-image-usd")):null,cap=val("max-spend-usd")?Number(val("max-spend-usd")):0;
  const cfg={authorized:flag("execute")&&flag("authorize-paid"),capUsd:cap,pricePerCallUsd:price,maxCalls:1};
  const spend=describeSpend(cfg),key=!!process.env.OPENAI_API_KEY;
  console.log(JSON.stringify({mode:flag("execute")?"EXECUTE REQUESTED":"DRY RUN",endpoint:req.url,...req.summary,priceUsd:price,capUsd:cap,spendDecision:spend,apiKeyPresent:key},null,2));
  console.log("\nprompt:\n"+req.body.prompt+"\n");
  if(!flag("execute")){console.log("DRY RUN: no network call was made.");return;}
  if(!spend.wouldRun||!key){console.error("REFUSED:",spend.wouldRun?"OPENAI_API_KEY is not set":spend.reason);process.exit(3);}
  const out=path.resolve(val("out") ?? "private-fixtures/v4-generated");assertOutputIgnored(out);
  const png=await generateRoom(req,{guard:new SpendGuard(cfg)});
  const f=path.join(out,`room_${new Date().toISOString().replace(/[-:T]/g,"").slice(0,12)}.png`);
  fs.writeFileSync(f,png);console.log("room written to",f,"(git-ignored). Next: npx tsx scripts/v4-annotate.ts");
})().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exit(1);});
