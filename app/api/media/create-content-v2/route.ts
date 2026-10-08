import { NextRequest } from "next/server";
import sharp from "sharp";
import {
  analyseProduct,
  analyseReference,
  buildCreativeBrief,
  generateEmptyBackground,
  qaBackground,
  backgroundHasHardDefect,
} from "@/lib/giftly-v2-director";
import {
  extractProtectedProduct,
  renderVariant,
} from "@/lib/giftly-v2-compositor";
import { PLATFORM_PRESETS } from "@/lib/giftly-content-policy";

export const runtime="nodejs";
export const maxDuration=300;

const BRAND_LOGO_FILE_ID="1viQoWbX4hakq03aCEi88hRvJsGA5GtqX";

async function fetchDriveImage(feedUrl:string,feedToken:string,fileId:string){
  const url=new URL(feedUrl);
  url.searchParams.set("token",feedToken);
  url.searchParams.set("action","file");
  url.searchParams.set("fileId",fileId);

  const response=await fetch(url,{cache:"no-store"});
  const text=await response.text();
  let data:any={};
  try{data=text?JSON.parse(text):{};}catch{
    throw new Error("Drive returned an invalid media response.");
  }

  if(!response.ok || data?.ok===false || !data?.base64){
    throw new Error(data?.error || data?.message || "Could not read source image.");
  }

  return {
    buffer:Buffer.from(data.base64,"base64"),
    fileName:String(data.fileName || "image.png"),
    mimeType:String(data.mimeType || "image/png"),
  };
}

async function uploadDrive(args:{
  feedUrl:string;
  feedToken:string;
  category:string;
  fileName:string;
  buffer:Buffer;
}){
  const url=new URL(args.feedUrl);
  url.searchParams.set("token",args.feedToken);

  const response=await fetch(url,{
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({
      action:"upload",
      category:args.category,
      fileName:args.fileName,
      mimeType:"image/png",
      base64:args.buffer.toString("base64")
    }),
    cache:"no-store"
  });

  const text=await response.text();
  let data:any={};
  try{data=text?JSON.parse(text):{};}catch{
    throw new Error("Drive upload returned an invalid response.");
  }

  if(!response.ok || data?.ok===false){
    throw new Error(data?.error || data?.message || "Could not save generated image.");
  }

  return data;
}

function cleanName(name:string){
  return name.replace(/\.[^.]+$/,"").replace(/[^a-zA-Z0-9_-]+/g,"_");
}

export async function POST(req:NextRequest){
  const feedUrl=process.env.CONTENT_FEED_URL;
  const feedToken=process.env.CONTENT_FEED_TOKEN;
  const apiKey=process.env.OPENAI_API_KEY;

  if(!feedUrl || !feedToken || !apiKey){
    return Response.json({
      ok:false,
      message:"Content Studio V2 is not fully configured."
    },{status:503});
  }

  try{
    const form=await req.formData();
    const fileId=String(form.get("fileId") || "").trim();
    const category=String(form.get("category") || "").trim();
    const description=String(form.get("description") || "").trim();
    const refValue=form.get("reference");
    const reference=refValue instanceof File && refValue.size>0 ? refValue : null;

    if(!fileId || !category){
      return Response.json({
        ok:false,
        message:"Source image and category are required."
      },{status:400});
    }

    const [source,logo,styleSpec,productAnalysis]=await Promise.all([
      fetchDriveImage(feedUrl,feedToken,fileId),
      fetchDriveImage(feedUrl,feedToken,BRAND_LOGO_FILE_ID),
      analyseReference(apiKey,reference),
      (async()=>{
        const src=await fetchDriveImage(feedUrl,feedToken,fileId);
        return analyseProduct(apiKey,src.buffer,category);
      })()
    ]);

    const brief=await buildCreativeBrief({
      apiKey,
      category,
      userInstruction:description,
      styleSpec
    });

    let background:Buffer;
    let backgroundQA:any={
      extraArtwork:false,
      personOrHands:false,
      readableText:false,
      centralObstruction:false,
      issues:[]
    };
    let backgroundAttempts=0;

    const useGeneratedBackground=Boolean(description || reference);

    if(useGeneratedBackground){
      backgroundAttempts=1;
      background=await generateEmptyBackground(apiKey,brief);
      backgroundQA=await qaBackground(apiKey,background);

      if(backgroundHasHardDefect(backgroundQA)){
        backgroundAttempts=2;
        background=await generateEmptyBackground(apiKey,{
          ...brief,
          backgroundDescription:
            brief.backgroundDescription+
            " Absolutely empty central presentation area. Remove all wall decoration, frames, pictures, signs, text, people and focal props."
        });
        backgroundQA=await qaBackground(apiKey,background);
      }
    }else{
      background=await sharp({
        create:{
          width:1088,
          height:1920,
          channels:3,
          background:{r:239,g:235,b:226}
        }
      }).png().toBuffer();
    }

    if(backgroundHasHardDefect(backgroundQA)){
      return Response.json({
        ok:false,
        code:"BACKGROUND_QA_FAILED",
        message:"V2 stopped because the generated background still contained unwanted visual elements.",
        defects:backgroundQA
      },{status:422});
    }

    const product=await extractProtectedProduct(source.buffer,productAnalysis);

    const rendered=await Promise.all(
      PLATFORM_PRESETS.map(async(preset)=>{
        const result=await renderVariant({
          background,
          product:product.buffer,
          productMode:product.mode,
          preset,
          logo:logo.buffer,
          headline:brief.headline,
          cta:brief.cta
        });

        const meta=await sharp(result.buffer).metadata();
        const techDefects=[...result.defects];

        if(meta.width!==preset.width || meta.height!==preset.height){
          techDefects.push("SAFE_ZONE_VIOLATION");
        }

        return {
          preset,
          buffer:result.buffer,
          placement:result.placement,
          defects:techDefects
        };
      })
    );

    const stamp=new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
    const base="generated_content_v2_"+cleanName(source.fileName)+"_"+stamp;

    const outputs=await Promise.all(
      rendered.map(async(item)=>{
        const uploaded=await uploadDrive({
          feedUrl,
          feedToken,
          category,
          fileName:`${base}_${item.preset.key}.png`,
          buffer:item.buffer
        });

        return {
          ...uploaded,
          url:uploaded?.fileId
            ? `/api/media/file?fileId=${encodeURIComponent(uploaded.fileId)}`
            : uploaded?.url,
          preset:item.preset.key,
          width:item.preset.width,
          height:item.preset.height,
          qaStatus:item.defects.length ? "WARN" : "PASS",
          defectCodes:item.defects,
          productMode:product.mode,
          backgroundAttempts,
          placement:item.placement
        };
      })
    );

    const warningCount=outputs.reduce(
      (n:number,x:any)=>n+(Array.isArray(x.defectCodes)?x.defectCodes.length:0),
      0
    );

    const campaign={
      concept:brief.backgroundDescription,
      headline:brief.headline,
      supporting:"",
      cta:brief.cta,
      instagramCaption:"",
      facebookCaption:"",
      googleCaption:""
    };

    return Response.json({
      ok:true,
      version:"v2-layered-compositor",
      message:warningCount
        ? `V2 created the platform pack with ${warningCount} review warning(s). Product pixels were preserved.`
        : "V2 created the platform pack. Product pixels were preserved and AI generated only the empty background.",
      campaign,
      styleSpec,
      productAnalysis,
      backgroundQA,
      outputs
    });

  }catch(error){
    return Response.json({
      ok:false,
      code:"V2_CONTENT_FAILED",
      message:error instanceof Error ? error.message : "V2 content creation failed."
    },{status:500});
  }
}
