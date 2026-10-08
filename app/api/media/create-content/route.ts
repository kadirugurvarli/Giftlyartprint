import { NextRequest } from "next/server";
import sharp from "sharp";
import React from "react";
import satori from "satori";
import { readFile } from "fs/promises";
import { createRequire } from "module";
import {
  BRAND,
  CATEGORY_RULES,
  GLOBAL_CONTENT_RULES,
  PLATFORM_PRESETS,
  PlatformPreset,
  normaliseCategory,
  wordLimit,
} from "@/lib/giftly-content-policy";
import {
  ArtDirectorReview,
  reviewFinalAsset,
} from "@/lib/giftly-art-director";

export const runtime = "nodejs";
export const maxDuration = 300;

const BRAND_LOGO_FILE_ID = "1viQoWbX4hakq03aCEi88hRvJsGA5GtqX";
const require = createRequire(import.meta.url);

function stripExt(name:string){
  return name.replace(/\.[^.]+$/,"");
}

async function fetchDriveImage(feedUrl:string,feedToken:string,fileId:string){
  const url=new URL(feedUrl);
  url.searchParams.set("token",feedToken);
  url.searchParams.set("action","file");
  url.searchParams.set("fileId",fileId);

  const response=await fetch(url,{cache:"no-store"});
  const text=await response.text();
  let data:any={};

  try{ data=text ? JSON.parse(text) : {}; }
  catch{ throw new Error(text || "Drive returned an invalid response."); }

  if(!response.ok || data?.ok===false || !data?.base64){
    throw new Error(data?.error || data?.message || "Could not read image asset from Drive.");
  }

  return {
    buffer:Buffer.from(data.base64,"base64"),
    fileName:data.fileName || "image.png",
    mimeType:data.mimeType || "image/png",
  };
}

let fontPromise:Promise<[Buffer,Buffer]>|null=null;

async function loadFonts(){
  if(!fontPromise){
    fontPromise=Promise.all([
      readFile(require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff2")),
      readFile(require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff2")),
    ]);
  }
  return fontPromise;
}

function outputText(data:any){
  if(typeof data?.output_text==="string") return data.output_text;
  if(!Array.isArray(data?.output)) return "";
  for(const item of data.output){
    if(!Array.isArray(item?.content)) continue;
    for(const part of item.content){
      if(part?.type==="output_text" && typeof part?.text==="string") return part.text;
    }
  }
  return "";
}

async function generateCampaign(args:{
  apiKey:string;
  category:string;
  description:string;
}){
  const category=normaliseCategory(args.category);

  const fallback={
    concept:args.description || "Source-first premium showcase",
    headline:
      category==="Iris Photography" ? "Your Iris as Art" :
      category==="Fine Art Printing" ? "Fine Art, Beautifully Printed" :
      category==="Photo Gifts" ? "Make It Personal" :
      category==="Business Printing" ? "Professional Print, Made Local" :
      "Bespoke Framing",
    cta:
      category==="Iris Photography" ? "Book your session" :
      category==="Photo Gifts" ? "Order yours" :
      "Get a quote",
    instagramCaption:"",
    facebookCaption:"",
    googleCaption:"",
  };

  const schema={
    type:"object",
    additionalProperties:false,
    properties:{
      concept:{type:"string"},
      headline:{type:"string"},
      cta:{type:"string"},
      instagramCaption:{type:"string"},
      facebookCaption:{type:"string"},
      googleCaption:{type:"string"},
    },
    required:["concept","headline","cta","instagramCaption","facebookCaption","googleCaption"],
  };

  try{
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        Authorization:`Bearer ${args.apiKey}`,
        "Content-Type":"application/json",
      },
      body:JSON.stringify({
        model:"gpt-5.6-luna",
        tools:[{type:"web_search"}],
        input:[{
          role:"user",
          content:[{
            type:"input_text",
            text:[
              "You are Giftly Art Print's senior Creative Director.",
              "Create a concise social campaign strategy, not a finished visual.",
              "Use current successful social design/copy patterns as inspiration when useful, but never copy a competitor, brand, caption or campaign.",
              `Category: ${category}`,
              `Optional user direction: ${args.description || "None. Choose the strongest concept yourself."}`,
              "Permanent production rules:",
              ...GLOBAL_CONTENT_RULES,
              "Category rules:",
              ...CATEGORY_RULES[category],
              `Brand tone: ${BRAND.tone.join(", ")}.`,
              `Headline maximum: ${BRAND.maxHeadlineWords} words.`,
              `CTA maximum: ${BRAND.maxCtaWords} words.`,
              `Captions maximum: ${BRAND.maxCaptionSentences} short sentences.`,
              "Do not mention research or competitors in the output.",
            ].join("\n")
          }]
        }],
        text:{
          format:{
            type:"json_schema",
            name:"giftly_campaign_strategy",
            strict:true,
            schema,
          }
        }
      })
    });

    const data=await response.json();
    if(!response.ok) throw new Error(data?.error?.message || "Creative Director failed.");

    const raw=outputText(data);
    if(!raw) return fallback;

    const parsed=JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
      headline:wordLimit(String(parsed.headline || fallback.headline),BRAND.maxHeadlineWords),
      cta:wordLimit(String(parsed.cta || fallback.cta),BRAND.maxCtaWords),
    };
  }catch{
    return fallback;
  }
}

async function buildSourceFirstCanvas(
  source:Buffer,
  preset:PlatformPreset,
  strict=false
){
  const width=preset.width;
  const height=preset.height;

  const topSafe=Math.round(height*(preset.topSafeRatio + (strict?0.035:0)));
  const bottomSafe=Math.round(height*(preset.bottomSafeRatio + (strict?0.025:0)));
  const side=Math.round(width*(preset.outerMarginRatio + (strict?0.018:0)));

  const subjectMaxWidth=Math.round(width*(preset.subjectMaxWidth-(strict?0.07:0)));
  const subjectMaxHeight=Math.round(height*(preset.subjectMaxHeight-(strict?0.07:0)));

  const background=await sharp(source)
    .rotate()
    .resize(width,height,{fit:"cover",position:"centre"})
    .blur(32)
    .modulate({brightness:0.62,saturation:0.72})
    .png()
    .toBuffer();

  const foreground=await sharp(source)
    .rotate()
    .resize(subjectMaxWidth,subjectMaxHeight,{
      fit:"contain",
      withoutEnlargement:false,
      background:{r:247,g:245,b:240,alpha:1}
    })
    .png()
    .toBuffer();

  const meta=await sharp(foreground).metadata();
  const fgW=meta.width || subjectMaxWidth;
  const fgH=meta.height || subjectMaxHeight;

  const usableTop=Math.max(
    topSafe,
    Math.round(height*0.19)
  );
  const usableBottom=height-bottomSafe-Math.round(height*0.06);
  const usableH=Math.max(1,usableBottom-usableTop);

  const left=Math.max(side,Math.round((width-fgW)/2));
  const top=usableTop+Math.max(0,Math.round((usableH-fgH)/2));

  return sharp(background)
    .composite([{
      input:foreground,
      left:Math.min(left,width-fgW-side),
      top:Math.min(top,height-fgH-bottomSafe),
    }])
    .png()
    .toBuffer();
}

async function makeTextOverlay(
  preset:PlatformPreset,
  headline:string,
  cta:string,
  strict=false
){
  const [regular,bold]=await loadFonts();
  const width=preset.width;
  const height=preset.height;
  const pad=Math.round(width*(preset.outerMarginRatio+(strict?0.018:0)));

  const fontScale=strict ? 0.038 : 0.044;
  const headlineSize=Math.round(width*fontScale);
  const smallSize=Math.round(width*(strict?0.019:0.021));
  const ctaSize=Math.round(width*(strict?0.022:0.024));
  const maxW=Math.round(width*(strict?0.58:0.66));

  const node=React.createElement(
    "div",
    {
      style:{
        width:"100%",
        height:"100%",
        display:"flex",
        alignItems:"flex-start",
        justifyContent:"flex-start",
        padding:`${pad}px`,
        boxSizing:"border-box",
        fontFamily:"Inter",
      }
    },
    React.createElement(
      "div",
      {
        style:{
          display:"flex",
          flexDirection:"column",
          alignItems:"flex-start",
          gap:Math.round(height*0.009),
          maxWidth:maxW,
        }
      },
      React.createElement(
        "div",
        {
          style:{
            display:"flex",
            background:"rgba(255,255,255,0.92)",
            color:"#171717",
            padding:`${Math.round(height*0.009)}px ${Math.round(width*0.015)}px`,
            fontSize:headlineSize,
            fontWeight:700,
            lineHeight:1.08,
          }
        },
        headline
      ),
      React.createElement(
        "div",
        {
          style:{
            display:"flex",
            background:"#171717",
            color:"#ffffff",
            padding:`${Math.round(height*0.008)}px ${Math.round(width*0.015)}px`,
            fontSize:ctaSize,
            fontWeight:700,
            lineHeight:1,
          }
        },
        cta
      ),
      React.createElement(
        "div",
        {
          style:{
            display:"flex",
            background:"rgba(255,255,255,0.92)",
            color:"#171717",
            padding:`${Math.round(height*0.006)}px ${Math.round(width*0.012)}px`,
            fontSize:smallSize,
            fontWeight:400,
            lineHeight:1,
          }
        },
        BRAND.website
      )
    )
  );

  const svg=await satori(node,{
    width,
    height,
    fonts:[
      {name:"Inter",data:regular,weight:400,style:"normal"},
      {name:"Inter",data:bold,weight:700,style:"normal"},
    ]
  });

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function applyBranding(args:{
  base:Buffer;
  logo:Buffer;
  preset:PlatformPreset;
  headline:string;
  cta:string;
  strict?:boolean;
}){
  const strict=Boolean(args.strict);
  const width=args.preset.width;
  const height=args.preset.height;

  const textLayer=await makeTextOverlay(
    args.preset,
    args.headline,
    args.cta,
    strict
  );

  const logoRatio=Math.max(
    0.15,
    args.preset.logoWidthRatio-(strict?0.045:0)
  );
  const logoWidth=Math.round(width*logoRatio);
  const logo=await sharp(args.logo)
    .resize({width:logoWidth,withoutEnlargement:true})
    .png()
    .toBuffer();

  const logoMeta=await sharp(logo).metadata();
  const logoHeight=logoMeta.height || Math.round(logoWidth*0.28);
  const margin=Math.round(width*(args.preset.outerMarginRatio+(strict?0.015:0)));
  const backingPad=Math.round(width*0.012);

  const backing=Buffer.from(
    `<svg width="${logoWidth+backingPad*2}" height="${logoHeight+backingPad*2}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgba(70,70,70,0.94)"/></svg>`
  );

  return sharp(args.base)
    .resize(width,height,{fit:"fill"})
    .composite([
      {input:textLayer,left:0,top:0},
      {
        input:backing,
        left:width-logoWidth-margin-backingPad,
        top:height-logoHeight-margin-backingPad,
      },
      {
        input:logo,
        left:width-logoWidth-margin,
        top:height-logoHeight-margin,
      }
    ])
    .png()
    .toBuffer();
}

async function buildCreativeScene(args:{
  apiKey:string;
  source:Buffer;
  sourceName:string;
  sourceMime:string;
  reference:File|null;
  preset:PlatformPreset;
  category:string;
  concept:string;
  userDirection:string;
}){
  const form=new FormData();
  form.append("model","gpt-image-2.5-sunburst");
  form.append(
    "image[]",
    new Blob([args.source],{type:args.sourceMime || "image/jpeg"}),
    args.sourceName || "source.jpg"
  );

  if(args.reference && args.reference.size>0){
    form.append("image[]",args.reference,args.reference.name || "reference.jpg");
  }

  const category=normaliseCategory(args.category);
  const prompt=[
    "Create only the visual scene for a Giftly Art Print social asset.",
    "Do not render any logo, words, captions, CTA, website, labels or typography.",
    "Permanent rules:",
    ...GLOBAL_CONTENT_RULES,
    "Category rules:",
    ...CATEGORY_RULES[category],
    `Platform: ${args.preset.label}, exact final ratio ${args.preset.width}:${args.preset.height}.`,
    "Leave protected negative space near the top-left for later branding and near the bottom-right for the real logo.",
    `Campaign concept: ${args.concept}`,
    `Explicit user direction: ${args.userDirection || "None"}`,
  ].join("\n");

  form.append("prompt",prompt);
  form.append("quality","medium");
  form.append("size",args.preset.apiSize);

  const response=await fetch("https://api.openai.com/v1/images/edits",{
    method:"POST",
    headers:{Authorization:`Bearer ${args.apiKey}`},
    body:form,
    signal:AbortSignal.timeout(45000),
  });

  const data=await response.json();
  if(!response.ok || !data?.data?.[0]?.b64_json){
    throw new Error(data?.error?.message || "Creative scene generation failed.");
  }

  return Buffer.from(data.data[0].b64_json,"base64");
}

async function uploadAsset(args:{
  uploadUrl:URL;
  category:string;
  fileName:string;
  image:Buffer;
}){
  const response=await fetch(args.uploadUrl,{
    method:"POST",
    headers:{"Content-Type":"text/plain;charset=utf-8"},
    body:JSON.stringify({
      action:"upload",
      category:args.category,
      fileName:args.fileName,
      mimeType:"image/png",
      base64:args.image.toString("base64"),
    }),
    cache:"no-store",
  });

  const text=await response.text();
  let data:any={};
  try{ data=text ? JSON.parse(text) : {}; }
  catch{ throw new Error(text || "Drive upload returned an invalid response."); }

  if(!response.ok || data?.ok===false){
    throw new Error(data?.error || data?.message || "Could not save generated asset.");
  }

  return data;
}

export async function POST(req:NextRequest){
  const feedUrl=process.env.CONTENT_FEED_URL;
  const feedToken=process.env.CONTENT_FEED_TOKEN;
  const apiKey=process.env.OPENAI_API_KEY;

  if(!feedUrl || !feedToken){
    return Response.json(
      {ok:false,message:"Google content feed is not configured."},
      {status:503}
    );
  }

  if(!apiKey){
    return Response.json(
      {ok:false,code:"OPENAI_NOT_CONFIGURED",message:"OpenAI content director is not configured yet."},
      {status:503}
    );
  }

  try{
    const formData=await req.formData();
    const fileId=String(formData.get("fileId") || "").trim();
    const category=String(formData.get("category") || "").trim();
    const description=String(formData.get("description") || "").trim();
    const referenceValue=formData.get("reference");
    const reference=referenceValue instanceof File && referenceValue.size>0
      ? referenceValue
      : null;

    if(!fileId || !category){
      return Response.json(
        {ok:false,message:"Source image and category are required."},
        {status:400}
      );
    }

    const creativeMode=Boolean(description) || Boolean(reference);

    const [source,logo,campaign]=await Promise.all([
      fetchDriveImage(feedUrl,feedToken,fileId),
      fetchDriveImage(feedUrl,feedToken,BRAND_LOGO_FILE_ID),
      generateCampaign({apiKey,category,description}),
    ]);

    const protectedSource=await sharp(source.buffer)
      .rotate()
      .png()
      .toBuffer();

    const produced=await Promise.all(
      PLATFORM_PRESETS.map(async(preset)=>{
        let productionMode:"source-first"|"creative-ai"="source-first";
        let base:Buffer;

        if(creativeMode){
          try{
            base=await buildCreativeScene({
              apiKey,
              source:source.buffer,
              sourceName:source.fileName,
              sourceMime:source.mimeType,
              reference,
              preset,
              category,
              concept:campaign.concept,
              userDirection:description,
            });
            base=await sharp(base)
              .resize(preset.width,preset.height,{fit:"cover",position:"centre"})
              .png()
              .toBuffer();
            productionMode="creative-ai";
          }catch{
            base=await buildSourceFirstCanvas(source.buffer,preset,false);
          }
        }else{
          base=await buildSourceFirstCanvas(source.buffer,preset,false);
        }

        let finalImage=await applyBranding({
          base,
          logo:logo.buffer,
          preset,
          headline:campaign.headline,
          cta:campaign.cta,
        });

        let qa:ArtDirectorReview;

        try{
          qa=await reviewFinalAsset({
            apiKey,
            sourceImage:protectedSource,
            finalImage,
            preset,
            category,
            headline:campaign.headline,
            cta:campaign.cta,
          });
        }catch{
          qa={
            decision:"REVISE",
            score:0,
            hardFail:false,
            issues:["Art Director review was unavailable on the first pass."],
            strengths:[],
            revisionInstruction:"Use the strict source-first layout.",
          };
        }

        if(qa.decision!=="PASS" || qa.hardFail || qa.score<85){
          productionMode="source-first";
          const strictBase=await buildSourceFirstCanvas(source.buffer,preset,true);
          finalImage=await applyBranding({
            base:strictBase,
            logo:logo.buffer,
            preset,
            headline:campaign.headline,
            cta:campaign.cta,
            strict:true,
          });

          try{
            qa=await reviewFinalAsset({
              apiKey,
              sourceImage:protectedSource,
              finalImage,
              preset,
              category,
              headline:campaign.headline,
              cta:campaign.cta,
            });
          }catch{
            qa={
              decision:"REVISE",
              score:70,
              hardFail:false,
              issues:["Art Director could not complete the second automated review."],
              strengths:["Strict source-first layout was used."],
              revisionInstruction:"Human review required.",
            };
          }
        }

        return {preset,finalImage,qa,productionMode};
      })
    );

    const failed=produced.filter(
      x=>x.qa.hardFail || x.qa.decision==="REJECT" || x.qa.score<70
    );

    if(failed.length){
      return Response.json({
        ok:false,
        code:"ART_DIRECTOR_REJECTED",
        message:"Art Director rejected one or more platform assets. Nothing was sent to Approval.",
        reviews:failed.map(x=>({
          preset:x.preset.key,
          qa:x.qa,
        })),
      },{status:422});
    }

    const uploadUrl=new URL(feedUrl);
    uploadUrl.searchParams.set("token",feedToken);

    const stamp=new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
    const baseName="generated_content_"+stripExt(source.fileName)+"_"+stamp;

    const outputs=await Promise.all(
      produced.map(async(item)=>{
        const fileName=`${baseName}_${item.preset.key}.png`;
        const uploaded=await uploadAsset({
          uploadUrl,
          category,
          fileName,
          image:item.finalImage,
        });

        return {
          ...uploaded,
          preset:item.preset.key,
          width:item.preset.width,
          height:item.preset.height,
          productionMode:item.productionMode,
          qa:item.qa,
        };
      })
    );

    return Response.json({
      ok:true,
      message:"Creative Director produced the platform pack and Art Director completed QA.",
      mode:creativeMode ? "directed" : "source-first",
      campaign,
      outputs,
    });
  }catch(error){
    return Response.json({
      ok:false,
      message:error instanceof Error ? error.message : "Content production failed.",
    },{status:500});
  }
}
