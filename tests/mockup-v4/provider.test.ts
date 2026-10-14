import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import sharp from "sharp";
import {describe,expect,it,vi} from "vitest";
import {OpenAIImageEditor,buildOpenAIEditRequest,OPENAI_EDITS_URL} from "../../lib/mockup-v4/openai";
import {SpendGuard,SpendGuardError,describeSpend} from "../../lib/mockup-v4/spend";
import type {EditRequest,RawImage} from "../../lib/mockup-v4/types";

const img=(w:number,h:number,v=120):RawImage=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(v)});
const req=(w=320,h=384,over:Partial<EditRequest>={}):EditRequest=>{
  const mask=new Uint8Array(w*h);for(let y=10;y<60;y++)for(let x=10;x<100;x++)mask[y*w+x]=255;
  return {image:img(w,h),mask,prompt:"restyle the frame",...over};
};
const okResponse=async(w=320,h=384)=>{
  const b=await sharp(Buffer.from(img(w,h,200).data),{raw:{width:w,height:h,channels:4}}).png().toBuffer();
  return new Response(JSON.stringify({data:[{b64_json:b.toString("base64")}],usage:{total_tokens:1}}),{status:200});
};
const GOOD={authorized:true,capUsd:0.5,pricePerCallUsd:0.2};

describe("OpenAI edit request schema (verified against the official OpenAPI spec 2.3.0)",()=>{
  it("sends only documented fields; no input_fidelity for gpt-image-2; no response_format",async()=>{
    const b=await buildOpenAIEditRequest(req());
    expect(b.url).toBe("https://api.openai.com/v1/images/edits");
    expect(Object.keys(b.fields).sort()).toEqual(["model","n","output_format","prompt","quality","size"]);
    expect(b.fields).toMatchObject({model:"gpt-image-2",size:"320x384",quality:"medium",n:"1",output_format:"png"});
    expect(b.files.map(f=>f.field)).toEqual(["image[]","mask"]);
  });
  it("the mask is a PNG of the same size with alpha 0 exactly where editing is allowed",async()=>{
    const r=req(),b=await buildOpenAIEditRequest(r);
    const m=b.files.find(f=>f.field==="mask")!;
    const raw=await sharp(m.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    expect(raw.info.width).toBe(320);expect(raw.info.height).toBe(384);
    let bad=0;for(let i=0;i<320*384;i++) if((raw.data[i*4+3]===0)!==(r.mask[i]>0)) bad++;
    expect(bad).toBe(0);
    expect(m.bytes.length).toBeLessThan(4*1024*1024);
  });
  it("rejects what the documented schema would reject",async()=>{
    await expect(buildOpenAIEditRequest(req(300,384))).rejects.toThrow("SIZE_NOT_DIVISIBLE_BY_16");
    await expect(buildOpenAIEditRequest(req(1024,256))).rejects.toThrow("SIZE_ASPECT_OUT_OF_RANGE");
    await expect(buildOpenAIEditRequest(req(3856,2160))).rejects.toThrow("SIZE_ABOVE_MAXIMUM");
    await expect(buildOpenAIEditRequest(req(320,384,{mask:new Uint8Array(10)}))).rejects.toThrow("MASK_SIZE_MISMATCH");
    await expect(buildOpenAIEditRequest(req(320,384,{prompt:""}))).rejects.toThrow("PROMPT_INVALID");
    await expect(buildOpenAIEditRequest(req(320,384,{prompt:"x".repeat(32001)}))).rejects.toThrow("PROMPT_INVALID");
    await expect(buildOpenAIEditRequest(req(320,384,{references:Array.from({length:16},()=>img(16,16))}))).rejects.toThrow("TOO_MANY_IMAGES");
    await expect(buildOpenAIEditRequest(req(),{model:"gpt-image-9"})).rejects.toThrow("MODEL_NOT_VERIFIED");
    await expect(buildOpenAIEditRequest(req(),{model:"gpt-image-1.5"})).rejects.toThrow("MODEL_NOT_VERIFIED"); // documented but not implemented: not assumed
    await expect(buildOpenAIEditRequest(req(),{quality:"ultra" as never})).rejects.toThrow("INVALID_QUALITY");
  });
  it("references go after the scene image and the mask applies to the first image",async()=>{
    const b=await buildOpenAIEditRequest(req(320,384,{references:[img(64,64),img(64,64)]}));
    expect(b.files.map(f=>f.field)).toEqual(["image[]","image[]","image[]","mask"]);
    expect(b.files[0].filename).toBe("scene.png");
  });
});

describe("spend guard",()=>{
  it("refuses unless authorised, capped, priced and within limits",()=>{
    const code=(c:object)=>{try{new SpendGuard(c as never).reserve();return "ok";}catch(e){return (e as SpendGuardError).code;}};
    expect(code({authorized:false,capUsd:1,pricePerCallUsd:0.1})).toBe("NOT_AUTHORIZED");
    expect(code({authorized:true,capUsd:0,pricePerCallUsd:0.1})).toBe("NO_SPEND_CAP");
    expect(code({authorized:true,capUsd:1,pricePerCallUsd:null})).toBe("PRICE_UNKNOWN");
    expect(code({authorized:true,capUsd:0.05,pricePerCallUsd:0.1})).toBe("CAP_EXCEEDED");
    expect(code({authorized:true,capUsd:1,pricePerCallUsd:0.1})).toBe("ok");
    const g=new SpendGuard({authorized:true,capUsd:1,pricePerCallUsd:0.1});g.reserve();
    expect(()=>g.reserve()).toThrow(SpendGuardError); // default one call
    expect(describeSpend({authorized:false,capUsd:0,pricePerCallUsd:null}).wouldRun).toBe(false);
  });
});

describe("OpenAI editor makes no call unless every condition holds",()=>{
  const mk=(cfg:object,fetchImpl:typeof fetch,key:string|null="sk-test")=>new OpenAIImageEditor({guard:new SpendGuard(cfg as never),fetchImpl,apiKey:()=>key??undefined});
  it("dry-run, no cap, no price, over cap: fetch is never called",async()=>{
    const f=vi.fn(async()=>okResponse());
    for(const cfg of [{authorized:false,capUsd:1,pricePerCallUsd:0.1},{authorized:true,capUsd:0,pricePerCallUsd:0.1},{authorized:true,capUsd:1,pricePerCallUsd:null},{authorized:true,capUsd:0.01,pricePerCallUsd:0.1}]){
      await expect(mk(cfg,f as never).edit(req())).rejects.toBeInstanceOf(SpendGuardError);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("an invalid request is rejected before the guard is even consulted (nothing reserved)",async()=>{
    const f=vi.fn(async()=>okResponse()),g=new SpendGuard(GOOD);
    const ed=new OpenAIImageEditor({guard:g,fetchImpl:f as never,apiKey:()=>"sk-test"});
    await expect(ed.edit(req(300,384))).rejects.toThrow("SIZE_NOT_DIVISIBLE_BY_16");
    expect(g.callsMade).toBe(0);expect(f).not.toHaveBeenCalled();
  });
  it("missing key: no call",async()=>{
    const f=vi.fn(async()=>okResponse());
    await expect(mk(GOOD,f as never,null).edit(req())).rejects.toThrow("OPENAI_API_KEY_MISSING");
    expect(f).not.toHaveBeenCalled();
  });
  it("authorised: exactly one call to the documented endpoint with a bearer header and multipart body; second call blocked",async()=>{
    const calls:{url:string;init:RequestInit}[]=[];
    const f=vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,init});return okResponse();});
    const ed=mk(GOOD,f as never);
    const r=await ed.edit(req());
    expect(f).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe(OPENAI_EDITS_URL);
    expect((calls[0].init.headers as Record<string,string>).Authorization).toBe("Bearer sk-test");
    const form=calls[0].init.body as FormData;
    expect(form.get("model")).toBe("gpt-image-2");expect(form.has("input_fidelity")).toBe(false);expect(form.has("response_format")).toBe(false);
    expect(form.getAll("image[]").length).toBe(1);expect(form.has("mask")).toBe(true);
    expect(r.image.width).toBe(320);expect(r.meta.estimatedCostUsd).toBe(0.2);
    expect(JSON.stringify(r.meta)).not.toContain("sk-test");
    await expect(ed.edit(req())).rejects.toBeInstanceOf(SpendGuardError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("API errors surface without echoing the key",async()=>{
    const f=vi.fn(async()=>new Response(JSON.stringify({error:{message:"bad mask"}}),{status:400}));
    await expect(mk(GOOD,f as never).edit(req())).rejects.toThrow(/OPENAI_EDIT_FAILED: HTTP 400 bad mask/);
  });
});

describe("privacy and isolation of the V4 sources",()=>{
  const dir=path.resolve("lib/mockup-v4");
  const src=(f:string)=>fs.readFileSync(path.join(dir,f),"utf8");
  const all=fs.readdirSync(dir).filter(f=>f.endsWith(".ts"));
  it("no fs, no logging, no storage; process.env only inside the OpenAI adapter's default key reader",()=>{
    for(const f of all){
      const t=src(f);
      expect(t,f).not.toMatch(/from "node:fs"|require\("fs"\)|console\.|localStorage|sessionStorage|\.toFile\(/);
      if(f!=="openai.ts"&&f!=="roomgen.ts") expect(t,f).not.toMatch(/process\.env/);
    }
    for(const f of ["openai.ts","roomgen.ts"]) expect(src(f).match(/process\.env\.[A-Z_]+/g)).toEqual(["process.env.OPENAI_API_KEY"]);
  });
  it("does not import V2 code",()=>{
    for(const f of all) expect(src(f),f).not.toMatch(/giftly-v2|app\/api|giftly-art-director/);
  });
});

describe("experiment script is a dry run by default",()=>{
  const run=(args:string[])=>spawnSync("npx",["tsx","scripts/v4-experiment.ts","--synthetic","--out",path.join(os.tmpdir(),"v4-exp-test-provider"),...args],{encoding:"utf8",env:{...process.env,OPENAI_API_KEY:""},timeout:120000});
  it("prints DRY RUN and exits 0 without any flag; --execute alone and even full authorisation without an API key are refused",()=>{
    const d=run([]);
    expect(d.status,d.stdout+d.stderr).toBe(0);expect(d.stdout).toContain("DRY RUN: no network call was made");
    for(const args of [["--execute"],["--execute","--authorize-paid","--max-spend-usd","1","--price-per-image-usd","0.1"]]){
      const r=run(args);
      expect(r.status,args.join(" ")+"\n"+r.stdout.slice(-600)+r.stderr.slice(-600)).toBe(3);expect(r.stderr).toContain("REFUSED");
    }
  },240000);
});
