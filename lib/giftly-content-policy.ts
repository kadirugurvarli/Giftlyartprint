export type ContentCategory =
  | "Bespoke Framing"
  | "Fine Art Printing"
  | "Iris Photography"
  | "Photo Gifts"
  | "Business Printing";

export type PlatformPreset = {
  key:"feed_4x5"|"story_9x16"|"google_business_1x1";
  label:string;
  width:number;
  height:number;
  apiSize:"1024x1536"|"1024x1024";
  subjectMaxWidth:number;
  subjectMaxHeight:number;
  logoWidthRatio:number;
  outerMarginRatio:number;
  topSafeRatio:number;
  bottomSafeRatio:number;
};

export const PLATFORM_PRESETS:PlatformPreset[]=[
  {
    key:"feed_4x5",
    label:"Feed 4:5",
    width:1080,
    height:1350,
    apiSize:"1024x1536",
    subjectMaxWidth:0.90,
    subjectMaxHeight:0.68,
    logoWidthRatio:0.22,
    outerMarginRatio:0.045,
    topSafeRatio:0.05,
    bottomSafeRatio:0.05
  },
  {
    key:"story_9x16",
    label:"Story 9:16",
    width:1080,
    height:1920,
    apiSize:"1024x1536",
    subjectMaxWidth:0.88,
    subjectMaxHeight:0.62,
    logoWidthRatio:0.24,
    outerMarginRatio:0.055,
    topSafeRatio:0.11,
    bottomSafeRatio:0.14
  },
  {
    key:"google_business_1x1",
    label:"Google Business 1:1",
    width:720,
    height:720,
    apiSize:"1024x1024",
    subjectMaxWidth:0.90,
    subjectMaxHeight:0.66,
    logoWidthRatio:0.20,
    outerMarginRatio:0.045,
    topSafeRatio:0.05,
    bottomSafeRatio:0.05
  }
];

export const BRAND={
  name:"GiftlyArtPrint",
  website:"giftlyartprint.co.uk",
  tone:["minimal","premium","warm","trustworthy","clean","not loud","not salesy"],
  maxHeadlineWords:5,
  maxCtaWords:4,
  maxCaptionSentences:3
};

export const HARD_FAIL_RULES=[
  "Wrong, invented, redrawn or distorted logo",
  "Invented, duplicated or replaced product/artwork/iris/frame/object",
  "Critical subject crop or product edge cut",
  "Unreadable, corrupted or placeholder text",
  "Wrong aspect ratio or output dimensions",
  "Text or logo outside platform safe zones",
  "Material colour/proportion changes to the real product",
  "Dense paragraph copy on the image",
  "Obvious visual artefacts that make the post look synthetic or broken"
];

export const GLOBAL_CONTENT_RULES=[
  "Use only the uploaded source image(s) as the real product/project subject.",
  "Never invent, add, duplicate or replace physical products, irises, frames, artworks, mounts, prints, props or decorative objects unless the user explicitly asks for them.",
  "Do not create extra iris discs, extra framed copies, fake products or foreground product props.",
  "Preserve the real subject's shape, proportions, colours, artwork, frame moulding, mount and visible details faithfully.",
  "Default mode is source-first: real source image, intelligent fit, safe background treatment, deterministic branding.",
  "Creative AI scene generation is allowed only when the user supplies an explicit visual idea or reference image.",
  "Allowed source-first improvements: straighten, perspective correction, lighting, white balance, contrast, cleanup, background simplification and careful reframing.",
  "Never crop a critical product edge merely to fill the canvas. Scale down and add controlled negative space/background instead.",
  "For panorama or awkward source ratios, contain the complete subject first, then extend background or use a clean neutral field.",
  "Do not render any logo or wordmark inside an AI-generated scene. The real GiftlyArtPrint logo is always applied later by the production engine.",
  "Final on-image copy is limited to one short headline, one short CTA and the website.",
  "No paragraph text, no long supporting copy, no extra labels.",
  "Maintain generous whitespace and platform-specific safe zones.",
  "Each platform gets its own composition; do not blindly crop one master into all ratios."
];

export const CATEGORY_RULES:Record<ContentCategory,string[]>={
  "Bespoke Framing":[
    "Frame, mount and artwork are protected assets.",
    "Never change frame moulding, mount width, artwork or object inside the frame.",
    "Prioritise craftsmanship, presentation and trust.",
    "Preferred concepts: finished piece showcase, detail/craft, quote request."
  ],
  "Fine Art Printing":[
    "Artwork colour and proportions are protected.",
    "Prioritise print quality, paper/detail and gallery presentation.",
    "Never invent texture or alter artwork content."
  ],
  "Iris Photography":[
    "Iris artwork is protected and must never be duplicated or replaced.",
    "No extra iris discs, floating eyes or invented eye products.",
    "Prioritise colour/detail, art presentation and booking CTA."
  ],
  "Photo Gifts":[
    "Printed product and customer image are protected.",
    "Keep the product believable and gift-focused.",
    "Do not invent variants not present in the source."
  ],
  "Business Printing":[
    "Printed text/logos on customer materials are protected.",
    "Prioritise legibility, professional finish and local service trust.",
    "Do not rewrite customer artwork."
  ]
};

export function normaliseCategory(value:string):ContentCategory{
  if(value==="Fine Art Printing") return value;
  if(value==="Iris Photography") return value;
  if(value==="Photo Gifts") return value;
  if(value==="Business Printing") return value;
  return "Bespoke Framing";
}

export function wordLimit(value:string,max:number){
  return value.trim().split(/\s+/).filter(Boolean).slice(0,max).join(" ");
}
