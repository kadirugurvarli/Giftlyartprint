/**
 * Content Studio V4 test interface (LOCAL ONLY, http://127.0.0.1:<port>).
 *   npx tsx scripts/v4-studio.ts --demo                      synthetic demo room (engine demo, NOT a visual approval)
 *   npx tsx scripts/v4-studio.ts --pack private-fixtures/v4-room-pack [--pack ...]
 * Paid AI frame edits stay OFF unless you also pass: --execute --authorize-paid --max-spend-usd N --price-per-image-usd P
 * (and OPENAI_API_KEY is set). Google Drive push stays OFF unless you pass --allow-drive-push and CONTENT_FEED_URL/TOKEN are set.
 */
import path from "node:path";
import {loadPack} from "./v4-pack";
import {assertOutputIgnored} from "../lib/mockup-v3/validation/runner";
import {SpendGuard} from "../lib/mockup-v4/spend";
import {createStudioServer,type StudioRoom} from "./v4-studio-server";
import {syntheticRoom} from "../tests/helpers/rooms";
import type {PackManifest} from "../lib/mockup-v4/pack";

const argv=process.argv.slice(2);
const flag=(n:string)=>argv.includes(`--${n}`);
const vals=(n:string)=>argv.flatMap((a,i)=>a===`--${n}`?[argv[i+1]]:[]);
const val=(n:string)=>vals(n)[0];

(async()=>{
  const rooms:StudioRoom[]=[];
  for(const p of vals("pack")){
    const l=await loadPack(p);
    if(l.issues.length){console.error(`Pack ${p} has issues: ${l.issues.map(i=>i.code).join(", ")}`);process.exit(5);}
    rooms.push({id:l.manifest.id,label:`${l.manifest.id} (${l.manifest.provenance.kind})`,handle:{manifest:l.manifest,roomImage:l.roomImage}});
  }
  if(flag("demo")||!rooms.length){
    const s=syntheticRoom({withPlant:true,scale:2});
    const manifest:PackManifest={schemaVersion:1,id:"synthetic-demo",roomImage:"room.png",artworkImage:"art.png",room:s.room,
      provenance:{kind:"synthetic-test",rightsCleared:true,licence:"generated in-process",emptyWallConfirmed:true},artwork:{origin:"synthetic-test",customer:false,licence:"generated in-process"},
      frame:{mouldingWidthCm:2.4,mountWidthCm:3.5,frameDepthCm:3,mouldingColour:[66,48,34],mountColour:[238,233,222],description:"walnut"}};
    rooms.push({id:"synthetic-demo",label:"Synthetic demo room (engine demo only)",handle:{manifest,roomImage:s.image}});
  }
  const outDir=path.resolve(val("out") ?? "v4-output");assertOutputIgnored(outDir);
  const price=val("price-per-image-usd")?Number(val("price-per-image-usd")):null,cap=val("max-spend-usd")?Number(val("max-spend-usd")):0;
  const paidOk=flag("execute")&&flag("authorize-paid")&&price!==null&&cap>=price&&!!process.env.OPENAI_API_KEY;
  const port=Number(val("port") ?? 4180);
  const s=createStudioServer({rooms,outDir,port,
    paid:paidOk?{guard:new SpendGuard({authorized:true,capUsd:cap,pricePerCallUsd:price,maxCalls:Number(val("max-paid-calls") ?? 1)}),apiKey:()=>process.env.OPENAI_API_KEY}:undefined,
    drive:{allow:flag("allow-drive-push"),feedUrl:process.env.CONTENT_FEED_URL,feedToken:process.env.CONTENT_FEED_TOKEN}});
  s.listen(port,"127.0.0.1",()=>{
    console.log(`Content Studio V4 (local): http://127.0.0.1:${port}`);
    console.log(`rooms: ${rooms.map(r=>r.id).join(", ")}; exports -> ${outDir}`);
    console.log(`paid AI edits: ${paidOk?`ENABLED (cap $${cap}, price $${price}, max ${val("max-paid-calls") ?? 1} call)`:"off"}; drive push: ${flag("allow-drive-push")?"allowed":"off"}`);
  });
})().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exit(1);});
