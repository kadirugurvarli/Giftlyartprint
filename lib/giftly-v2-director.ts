import sharp from "sharp";

export type ProductAnalysis={
  rectangular:boolean;
  confidence:number;
  bbox:{x:number;y:number;width:number;height:number};
  notes:string;
};

export type StyleSpec={
  backgroundTone:string;
  materials:string[];
  lightDirection:string;
  lightQuality:string;
  palette:string[];
  composition:string;
  mood:string;
  propsAllowed:boolean;
};

export type CreativeBrief={
  backgroundDescription:string;
  mood:string;
  headline:string;
  cta:string;
  styleSpec:StyleSpec;
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

async function structuredVision(args:{
  apiKey:string;
  name:string;
  schema:any;
  text:string;
  images:string[];
}){
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
          {type:"input_text",text:args.text},
          ...args.images.map((image_url)=>({
            type:"input_image",
            image_url,
            detail:"high"
          }))
        ]
      }],
      text:{
        format:{
          type:"json_schema",
          name:args.name,
          strict:true,
          schema:args.schema
        }
      }
    })
  });

  const data=await response.json();
  if(!response.ok) throw new Error(data?.error?.message || "Vision analysis failed.");
  const raw=outputText(data);
  if(!raw) throw new Error("Vision analysis returned no structured output.");
  return JSON.parse(raw);
}

export async function analyseProduct(apiKey:string,source:Buffer,category:string):Promise<ProductAnalysis>{
  const image=await sharp(source).rotate().jpeg({quality:86}).toBuffer();
  const url=`data:image/jpeg;base64,${image.toString("base64")}`;

  const schema={
    type:"object",
    additionalProperties:false,
    properties:{
      rectangular:{type:"boolean"},
      confidence:{type:"number",minimum:0,maximum:1},
      bbox:{
        type:"object",
        additionalProperties:false,
        properties:{
          x:{type:"integer",minimum:0,maximum:1000},
          y:{type:"integer",minimum:0,maximum:1000},
          width:{type:"integer",minimum:1,maximum:1000},
          height:{type:"integer",minimum:1,maximum:1000}
        },
        required:["x","y","width","height"]
      },
      notes:{type:"string"}
    },
    required:["rectangular","confidence","bbox","notes"]
  };

  return structuredVision({
    apiKey,
    name:"giftly_product_bounds",
    schema,
    text:[
      "Identify the single real customer product/project that should be preserved for a marketing composition.",
      `Category: ${category}.`,
      "Return a tight bounding box around the complete physical product, including every outer frame edge if framed.",
      "Coordinates use a 0-1000 normalized image coordinate system.",
      "Do not crop artwork, mount, frame moulding or product edges.",
      "Set rectangular=true only when the protected object can safely be represented by a rectangular crop without removing meaningful product pixels.",
      "Ignore surrounding room/background.",
    ].join("\n"),
    images:[url]
  });
}

export async function analyseReference(apiKey:string,reference:File|null):Promise<StyleSpec>{
  const fallback:StyleSpec={
    backgroundTone:"warm neutral",
    materials:["soft plaster","natural oak"],
    lightDirection:"upper left",
    lightQuality:"soft natural daylight",
    palette:["#F4F1EA","#D8D0C2","#3C3933"],
    composition:"premium editorial with generous negative space",
    mood:"warm, minimal, refined",
    propsAllowed:false
  };

  if(!reference || reference.size===0) return fallback;

  const bytes=Buffer.from(await reference.arrayBuffer());
  const image=await sharp(bytes).rotate().jpeg({quality:84}).toBuffer();
  const url=`data:image/jpeg;base64,${image.toString("base64")}`;

  const schema={
    type:"object",
    additionalProperties:false,
    properties:{
      backgroundTone:{type:"string"},
      materials:{type:"array",items:{type:"string"},maxItems:5},
      lightDirection:{type:"string"},
      lightQuality:{type:"string"},
      palette:{type:"array",items:{type:"string"},maxItems:6},
      composition:{type:"string"},
      mood:{type:"string"},
      propsAllowed:{type:"boolean"}
    },
    required:["backgroundTone","materials","lightDirection","lightQuality","palette","composition","mood","propsAllowed"]
  };

  try{
    return await structuredVision({
      apiKey,
      name:"giftly_reference_style",
      schema,
      text:[
        "Analyse this image ONLY as a style/layout reference.",
        "Do not describe or copy any identifiable artwork, product, person, logo, words or branded object.",
        "Extract only transferable visual properties: background tone, materials, light direction, light quality, palette, composition and mood.",
        "Set propsAllowed=false unless sparse generic props are essential to the visual style.",
      ].join("\n"),
      images:[url]
    });
  }catch{
    return fallback;
  }
}

export async function buildCreativeBrief(args:{
  apiKey:string;
  category:string;
  userInstruction:string;
  styleSpec:StyleSpec;
}):Promise<CreativeBrief>{
  const schema={
    type:"object",
    additionalProperties:false,
    properties:{
      backgroundDescription:{type:"string"},
      mood:{type:"string"},
      headline:{type:"string"},
      cta:{type:"string"}
    },
    required:["backgroundDescription","mood","headline","cta"]
  };

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
        content:[{
          type:"input_text",
          text:[
            "Create a concise Giftly Art Print creative brief.",
            `Category: ${args.category}.`,
            `User direction: ${args.userInstruction || "No explicit direction; choose a premium minimal presentation."}`,
            "Reference StyleSpec:",
            JSON.stringify(args.styleSpec),
            "IMPORTANT: backgroundDescription describes an EMPTY scene only.",
            "Do not mention or request frames, artwork, prints, irises, eyes, products, people, text, logos, posters or wall art in backgroundDescription.",
            "The physical customer product will be composited later from immutable source pixels.",
            "Headline max 5 words. CTA max 4 words.",
            "Use natural UK English and a premium, calm, trustworthy tone.",
          ].join("\n")
        }]
      }],
      text:{
        format:{
          type:"json_schema",
          name:"giftly_v2_brief",
          strict:true,
          schema
        }
      }
    })
  });

  const data=await response.json();
  if(!response.ok) throw new Error(data?.error?.message || "Creative brief generation failed.");
  const raw=outputText(data);
  if(!raw) throw new Error("Creative brief returned no structured output.");
  const parsed=JSON.parse(raw);

  return {
    ...parsed,
    styleSpec:args.styleSpec
  };
}

export async function generateEmptyBackground(apiKey:string,brief:CreativeBrief){
  const prompt=[
    "Create an EMPTY premium commercial interior/background plate for a social media composition.",
    "There must be NO framed art, NO paintings, NO prints, NO posters, NO photographs, NO eyes, NO irises, NO people, NO hands, NO products, NO signage, NO letters, NO typography, NO logos and NO readable text anywhere.",
    "The central and upper-middle area must remain visually calm and available for a product to be composited later.",
    `Scene direction: ${brief.backgroundDescription}`,
    `Mood: ${brief.mood}`,
    `Background tone: ${brief.styleSpec.backgroundTone}`,
    `Materials: ${brief.styleSpec.materials.join(", ")}`,
    `Lighting: ${brief.styleSpec.lightQuality}, from ${brief.styleSpec.lightDirection}`,
    `Palette: ${brief.styleSpec.palette.join(", ")}`,
    "Photorealistic, restrained, premium, believable natural lighting. No decorative focal object in the centre.",
  ].join("\n");

  const response=await fetch("https://api.openai.com/v1/images/generations",{
    method:"POST",
    headers:{
      Authorization:`Bearer ${apiKey}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:"gpt-image-2",
      prompt,
      size:"1088x1920",
      quality:"medium",
      output_format:"png"
    }),
    signal:AbortSignal.timeout(70000)
  });

  const data=await response.json();
  if(!response.ok || !data?.data?.[0]?.b64_json){
    throw new Error(data?.error?.message || "Background generation failed.");
  }

  return Buffer.from(data.data[0].b64_json,"base64");
}

export async function qaBackground(apiKey:string,background:Buffer){
  const jpg=await sharp(background).jpeg({quality:82}).toBuffer();
  const url=`data:image/jpeg;base64,${jpg.toString("base64")}`;
  const schema={
    type:"object",
    additionalProperties:false,
    properties:{
      extraArtwork:{type:"boolean"},
      personOrHands:{type:"boolean"},
      readableText:{type:"boolean"},
      centralObstruction:{type:"boolean"},
      issues:{type:"array",items:{type:"string"},maxItems:6}
    },
    required:["extraArtwork","personOrHands","readableText","centralObstruction","issues"]
  };

  return structuredVision({
    apiKey,
    name:"giftly_background_qa",
    schema,
    text:[
      "Review ONLY this empty background plate.",
      "Check for accidental framed art, paintings, prints, posters, photographs, people, hands, products, readable text or a large object blocking the central placement area.",
      "Return booleans only according to what is visibly present.",
    ].join("\n"),
    images:[url]
  });
}

export function backgroundHasHardDefect(qa:any){
  return Boolean(
    qa?.extraArtwork ||
    qa?.personOrHands ||
    qa?.readableText ||
    qa?.centralObstruction
  );
}
