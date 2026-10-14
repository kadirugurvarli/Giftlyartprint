import sharp from "sharp";
import type {EditorConstraints,EditRequest,EditResult,HybridImageEditor,RawImage} from "./types";
import {SpendGuard} from "./spend";

/**
 * OpenAI `POST /v1/images/edits` adapter.
 * Request schema verified against OpenAI's published OpenAPI spec (github.com/openai/openai-openapi, `CreateImageEditRequest`,
 * spec version 2.3.0, read 2026-10-10). Only parameters documented there are sent. Model-specific rules:
 *  - gpt-image-2: arbitrary WxH (both divisible by 16, aspect within 1:3..3:1, max 3840x2160); `input_fidelity` must be OMITTED.
 * gpt-image-1.5 and others are documented too (fixed sizes, input_fidelity) but deliberately NOT implemented: their crops would need resizing.
 * Common: `image` up to 16 files (png/webp/jpg, <50 MB each); `mask` = PNG <4 MB, same size as the FIRST image, fully
 * transparent pixels = edit area; prompt <= 32000 chars; response is base64 (`data[0].b64_json`).
 * NOT verified (so not assumed): price per image (not in the spec), latency, how strictly any model keeps unmasked pixels.
 */
export const OPENAI_EDITS_URL="https://api.openai.com/v1/images/edits";

type ModelRule={sizes:"arbitrary"|string[];constraints:EditorConstraints};
export const OPENAI_MODEL_RULES:Record<string,ModelRule>={
  "gpt-image-2":{sizes:"arbitrary",constraints:{alignPx:16,maxAspect:3,maxSide:3840,maxPixels:3840*2160,minSide:256}}
};
export const OPENAI_QUALITIES=["low","medium","high","auto"] as const;
export type OpenAIQuality=typeof OPENAI_QUALITIES[number];

export type BuiltRequest={
  url:string;
  fields:Record<string,string>;
  files:{field:string;filename:string;mime:string;bytes:Buffer}[];
  summary:{model:string;size:string;quality:string;imageBytes:number;maskBytes:number;references:number;promptChars:number};
};

const MAX_MASK_BYTES=4*1024*1024,MAX_IMAGE_BYTES=50*1024*1024,MAX_PROMPT=32000,MAX_IMAGES=16;

async function png(img:RawImage){
  return sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}}).png().toBuffer();
}

/** Pure request builder (no network, no credentials). Throws on anything the documented schema would reject. */
export async function buildOpenAIEditRequest(req:EditRequest,o:{model?:string;quality?:OpenAIQuality}={}):Promise<BuiltRequest>{
  const model=o.model ?? "gpt-image-2";
  const rule=OPENAI_MODEL_RULES[model];
  if(!rule) throw new Error(`MODEL_NOT_VERIFIED: ${model} has no verified parameter rules in this adapter`);
  const quality=o.quality ?? "medium";
  if(!OPENAI_QUALITIES.includes(quality)) throw new Error("INVALID_QUALITY");
  const {width:w,height:h}=req.image;
  const size=`${w}x${h}`;
  if(rule.sizes==="arbitrary"){
    const c=rule.constraints;
    if(w%c.alignPx||h%c.alignPx) throw new Error("SIZE_NOT_DIVISIBLE_BY_16");
    if(Math.max(w/h,h/w)>c.maxAspect) throw new Error("SIZE_ASPECT_OUT_OF_RANGE");
    if(Math.max(w,h)>c.maxSide||w*h>c.maxPixels) throw new Error("SIZE_ABOVE_MAXIMUM");
  }else if(!rule.sizes.includes(size)) throw new Error(`SIZE_NOT_SUPPORTED_BY_MODEL: ${size}`);
  if(req.mask.length!==w*h) throw new Error("MASK_SIZE_MISMATCH");
  if(!req.prompt||req.prompt.length>MAX_PROMPT) throw new Error("PROMPT_INVALID");
  const refs=req.references ?? [];
  if(1+refs.length>MAX_IMAGES) throw new Error("TOO_MANY_IMAGES");
  // mask: PNG with alpha 0 where the model may edit, 255 where it must keep the pixel
  const maskRgba=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++){const a=req.mask[i]?0:255;maskRgba[i*4]=0;maskRgba[i*4+1]=0;maskRgba[i*4+2]=0;maskRgba[i*4+3]=a;}
  const maskPng=await png({width:w,height:h,data:maskRgba});
  if(maskPng.length>=MAX_MASK_BYTES) throw new Error("MASK_TOO_LARGE");
  const files:BuiltRequest["files"]=[];
  const imgPng=await png(req.image);
  if(imgPng.length>=MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");
  files.push({field:"image[]",filename:"scene.png",mime:"image/png",bytes:imgPng});
  for(let k=0;k<refs.length;k++){const b=await png(refs[k]);if(b.length>=MAX_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");files.push({field:"image[]",filename:`ref${k}.png`,mime:"image/png",bytes:b});}
  files.push({field:"mask",filename:"mask.png",mime:"image/png",bytes:maskPng});
  // NOTE: no input_fidelity (gpt-image-2 must omit it), no response_format (unsupported for GPT image models)
  const fields={model,prompt:req.prompt,size,quality,n:"1",output_format:"png"};
  return {url:OPENAI_EDITS_URL,fields,files,summary:{model,size,quality,imageBytes:imgPng.length,maskBytes:maskPng.length,references:refs.length,promptChars:req.prompt.length}};
}

export type OpenAIEditorOptions={
  guard:SpendGuard;
  model?:string;quality?:OpenAIQuality;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?:typeof fetch;
  /** Read at call time only; never stored, logged or returned. */
  apiKey?:()=>string|undefined;
  timeoutMs?:number;
};

export class OpenAIImageEditor implements HybridImageEditor{
  readonly id="openai-images-edits";
  readonly constraints:EditorConstraints;
  constructor(private readonly o:OpenAIEditorOptions){
    const rule=OPENAI_MODEL_RULES[o.model ?? "gpt-image-2"];
    if(!rule) throw new Error("MODEL_NOT_VERIFIED");
    this.constraints=rule.constraints;
  }
  async edit(req:EditRequest):Promise<EditResult>{
    const model=this.o.model ?? "gpt-image-2";
    const built=await buildOpenAIEditRequest(req,{model,quality:this.o.quality});
    this.o.guard.reserve(); // throws unless authorised, capped, priced and within the call limit
    const key=(this.o.apiKey ?? (()=>process.env.OPENAI_API_KEY))();
    if(!key) throw new Error("OPENAI_API_KEY_MISSING");
    const form=new FormData();
    for(const [k,v] of Object.entries(built.fields)) form.append(k,v);
    for(const f of built.files) form.append(f.field,new Blob([new Uint8Array(f.bytes)],{type:f.mime}),f.filename);
    const res=await (this.o.fetchImpl ?? fetch)(built.url,{method:"POST",headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(this.o.timeoutMs ?? 180000)});
    const data=await res.json().catch(()=>null) as {data?:{b64_json?:string}[];usage?:unknown;error?:{message?:string}}|null;
    if(!res.ok||!data?.data?.[0]?.b64_json) throw new Error(`OPENAI_EDIT_FAILED: HTTP ${res.status}${data?.error?.message?" "+data.error.message.slice(0,200):""}`);
    const raw=await sharp(Buffer.from(data.data[0].b64_json,"base64")).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const image:RawImage={width:raw.info.width,height:raw.info.height,data:new Uint8ClampedArray(raw.data.buffer,raw.data.byteOffset,raw.data.byteLength)};
    return {image,meta:{provider:"openai",model,requestSize:built.summary.size,estimatedCostUsd:this.o.guard.pricePerCallUsd,usage:data.usage}};
  }
}
