/**
 * V4 hybrid experiment runner. DRY-RUN BY DEFAULT: builds the baseline, the bounded edit mask and the exact request that
 * would be sent, writes previews to a git-ignored folder and makes NO network call.
 *
 *   npx tsx scripts/v4-experiment.ts [--out dir] [--size 50x70]
 *
 * A paid call needs ALL of: --execute --authorize-paid --max-spend-usd <cap> --price-per-image-usd <owner-verified price>
 * plus OPENAI_API_KEY in the environment. Without all of them the run stays a dry run and says why.
 * Only the SYNTHETIC room is wired in (no real room asset exists yet).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type {RawImage} from "../lib/mockup-v3/types";
import {assertOutputIgnored} from "../lib/mockup-v3/validation/runner";
import {cropImage} from "../lib/mockup-v4/integrity";
import {buildEditMask,chooseCrop,cropMask} from "../lib/mockup-v4/mask";
import {buildFrameEditPrompt} from "../lib/mockup-v4/prompt";
import {buildOpenAIEditRequest,OpenAIImageEditor,OPENAI_MODEL_RULES} from "../lib/mockup-v4/openai";
import {runHybridEdit} from "../lib/mockup-v4/run";
import {describeSpend,SpendGuard} from "../lib/mockup-v4/spend";
import {hybridScenario} from "../tests/helpers/hybrid";

const argv=process.argv.slice(2);
const flag=(n:string)=>argv.includes(`--${n}`);
const val=(n:string)=>{const i=argv.indexOf(`--${n}`);return i>=0?argv[i+1]:undefined;};
const num=(n:string)=>{const v=val(n);return v===undefined?null:Number(v);};

(async()=>{
  const out=path.resolve(val("out") ?? "validation-output/v4-experiment");
  assertOutputIgnored(out);fs.mkdirSync(out,{recursive:true});
  const [w,h]=(val("size") ?? "50x70").split("x").map(Number);
  const model=val("model") ?? "gpt-image-2";
  if(!OPENAI_MODEL_RULES[model]){console.error(`Model ${model} has no verified parameter rules; refusing.`);process.exit(2);}
  const S=await hybridScenario({width:w,height:h});
  const {baseline,outerQuad,artQuad}=S;
  const mask=buildEditMask({width:baseline.width,height:baseline.height,outerQuad,artQuad,shadowDir:{x:0.45,y:0.89},shadowBandPx:26,wallAlpha:S.wallAlpha,protect:[S.plantPolygon]});
  const constraints=OPENAI_MODEL_RULES[model].constraints;
  const cropped=chooseCrop(mask,constraints,48);
  if(!cropped.ok){console.error("Crop failed:",cropped.error);process.exit(2);}
  const crop=cropped.crop;
  const prompt=buildFrameEditPrompt({frameDescription:"a dark walnut-brown wooden moulding with a cream mount",lightDescription:"soft warm light from the upper left, shadows falling down and to the right"});
  const request={image:cropImage(baseline,crop),mask:cropMask(mask,crop),prompt};
  const built=await buildOpenAIEditRequest(request,{model,quality:"medium"});

  const price=num("price-per-image-usd"),cap=num("max-spend-usd")??0;
  const spendCfg={authorized:flag("execute")&&flag("authorize-paid"),capUsd:cap,pricePerCallUsd:price,maxCalls:1};
  const decision=describeSpend(spendCfg);
  const keyPresent=!!process.env.OPENAI_API_KEY;
  const paid=flag("execute")&&decision.wouldRun&&keyPresent;

  const toJpg=(img:RawImage,f:string)=>sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}}).removeAlpha().jpeg({quality:92}).toFile(path.join(out,f));
  await toJpg(baseline,"01_v3_baseline.jpg");
  await toJpg(request.image,"02_request_crop.jpg");
  const overlay:RawImage={width:crop.width,height:crop.height,data:new Uint8ClampedArray(request.image.data)};
  for(let i=0;i<request.mask.length;i++) if(request.mask[i]){overlay.data[i*4]=Math.round(overlay.data[i*4]*0.4+255*0.6);overlay.data[i*4+1]*=0.4;overlay.data[i*4+2]*=0.4;}
  await toJpg(overlay,"03_edit_mask_overlay.jpg");
  const summary={mode:paid?"PAID":"DRY RUN",provider:"openai /v1/images/edits",request:built.summary,editablePixels:mask.stats.editablePixels,shadowBand:mask.stats.shadowBand,crop,
    estimatedCostUsd:price,spendCapUsd:cap,spendDecision:decision,apiKeyPresent:keyPresent,
    notes:["Price per image is NOT in OpenAI's API spec; supply the owner-verified price with --price-per-image-usd.","Synthetic room only; no real asset wired in."]};
  fs.writeFileSync(path.join(out,"request_summary.json"),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary,null,2));

  if(!flag("execute")){console.log("\nDRY RUN: no network call was made. Files in",out);return;}
  if(!paid){console.error("\nREFUSED: paid call not allowed ->",decision.wouldRun?"OPENAI_API_KEY is not set":decision.reason);process.exit(3);}
  const editor=new OpenAIImageEditor({guard:new SpendGuard(spendCfg),model,quality:"medium"});
  const r=await runHybridEdit({...S.base(),prompt,editor});
  if(!r.ok){console.error("Hybrid run failed:",r.error,r.detail??"");process.exit(4);}
  await toJpg(r.image,"04_v4_candidate_final.jpg");await toJpg(r.candidateFull,"05_raw_model_output_pasted.jpg");
  fs.writeFileSync(path.join(out,"result.json"),JSON.stringify({verdict:r.verdict,rejectReasons:r.rejectReasons,checks:r.checks,meta:{...r.meta,usage:r.meta.usage},metrics:r.metrics},null,2));
  console.log("verdict:",r.verdict,r.rejectReasons.join(","));
})().catch((e)=>{console.error(e instanceof Error?e.message:String(e));process.exit(1);});
