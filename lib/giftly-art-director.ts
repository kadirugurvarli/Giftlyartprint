import { BRAND, HARD_FAIL_RULES, PlatformPreset } from "@/lib/giftly-content-policy";

export type ArtDirectorReview={
  decision:"PASS"|"REVISE"|"REJECT";
  score:number;
  hardFail:boolean;
  issues:string[];
  strengths:string[];
  revisionInstruction:string;
};

const REVIEW_SCHEMA={
  type:"object",
  additionalProperties:false,
  properties:{
    decision:{type:"string",enum:["PASS","REVISE","REJECT"]},
    score:{type:"integer",minimum:0,maximum:100},
    hardFail:{type:"boolean"},
    issues:{type:"array",items:{type:"string"},maxItems:8},
    strengths:{type:"array",items:{type:"string"},maxItems:5},
    revisionInstruction:{type:"string"}
  },
  required:["decision","score","hardFail","issues","strengths","revisionInstruction"]
};

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

export async function reviewFinalAsset(args:{
  apiKey:string;
  image:Buffer;
  preset:PlatformPreset;
  category:string;
  headline:string;
  cta:string;
}):Promise<ArtDirectorReview>{
  const imageUrl=`data:image/png;base64,${args.image.toString("base64")}`;

  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{
      Authorization:`Bearer ${args.apiKey}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:"gpt-5.6-luna",
      input:[{
        role:"user",
        content:[
          {
            type:"input_text",
            text:[
              "Act as the senior Art Director and final visual QA gate for Giftly Art Print.",
              `Review this final ${args.preset.label} social asset for category: ${args.category}.`,
              `Expected exact dimensions: ${args.preset.width}x${args.preset.height}.`,
              `Intended headline: ${args.headline}`,
              `Intended CTA: ${args.cta}`,
              `Brand website: ${BRAND.website}`,
              "Judge composition, subject fidelity, crop safety, whitespace, hierarchy, logo integrity, typography, readability, platform safe areas, realism, polish and brand fit.",
              "Hard-fail if any of the following is visible:",
              ...HARD_FAIL_RULES.map((x)=>"- "+x),
              "PASS requires score >= 85, no hard fail, readable copy, professional balance and no invented product/object.",
              "REVISE means fixable layout/scale/spacing issue.",
              "REJECT means a hard fail or fundamentally unusable creative."
            ].join("\n")
          },
          {
            type:"input_image",
            image_url:imageUrl,
            detail:"high"
          }
        ]
      }],
      text:{
        format:{
          type:"json_schema",
          name:"giftly_art_director_review",
          strict:true,
          schema:REVIEW_SCHEMA
        }
      }
    })
  });

  const data=await response.json();

  if(!response.ok){
    throw new Error(data?.error?.message || "Art Director review failed.");
  }

  const raw=outputText(data);
  if(!raw) throw new Error("Art Director returned no structured review.");

  return JSON.parse(raw) as ArtDirectorReview;
}
