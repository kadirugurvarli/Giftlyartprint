import type {SizeOption} from "./styles";

export type CaptionInput={
  platform:"Instagram"|"Facebook";
  size:SizeOption;
  styleLabel:string;
  mountLabel:string;
  /** 0,1,2.. different wording for regeneration */
  variant?:number;
};
export type Caption={text:string;hashtags:string[];altText:string;problems:string[]};

const BRAND_TAGS=["giftlyartprint","framedprint","wallart","homedecor","gallerywall","maidstone","kentlife","bespokeframing"];

const OPENERS=[
  "A calm wall, soft daylight and a favourite print given the frame it deserves.",
  "Some pictures simply belong on a wall you love living with.",
  "Good light, a quiet corner and a print framed to last."
];
const MIDDLES=[
  (s:string,st:string,m:string)=>`Shown here as a ${s} ${st.toLowerCase()} frame${m?` ${m}`:""}.`,
  (s:string,st:string,m:string)=>`This is our ${st.toLowerCase()} frame at ${s}${m?`, ${m}`:""}.`,
  (s:string,st:string,m:string)=>`${s} in ${st.toLowerCase()}${m?`, ${m}`:""}, ready to hang.`
];
const CTAS={
  Instagram:["Tell us the size you have in mind and we'll help you choose the finish.","Send us your print and we'll suggest the perfect frame.","Message us to start your own."],
  Facebook:["Message us with the size you have in mind and we'll help you choose the finish.","Send us a photo of your print and we'll suggest the right frame.","Get in touch to start your own."]
};

const FORBIDDEN=[/£/,/\b\d+\s?%/,/\bfree\b/i,/\bsale\b/i,/\bdiscount/i,/\bguarantee/i,/\bbest\b/i,/\bcheapest\b/i,/\bdelivery\b/i,/\bnext[- ]day\b/i,/\bpersonal(i[sz]ed)? your\b/i];

export function countSentences(t:string){return t.split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean).length;}

/** Warm, premium, not salesy; max three sentences; no prices, offers or delivery claims. The room is described as an illustration in the alt text. */
export function buildCaption(i:CaptionInput):Caption{
  const v=Math.max(0,i.variant ?? 0);
  const mountName=i.mountLabel.replace(/\s*\(.*\)/,"").toLowerCase();
  const mount=mountName==="no mount"?"":`with a ${mountName}`;
  const sizeText=`${i.size.width}×${i.size.height} cm`;
  const body=[OPENERS[v%OPENERS.length],MIDDLES[v%MIDDLES.length](sizeText,i.styleLabel,mount),CTAS[i.platform][v%CTAS[i.platform].length]].join(" ");
  const tags=(i.platform==="Instagram"?BRAND_TAGS.slice(0,8):BRAND_TAGS.slice(0,3)).map(t=>"#"+t);
  const text=i.platform==="Instagram"?`${body}\n\n${tags.join(" ")}`:`${body}\n\n${tags.join(" ")}`;
  const altText=`Illustration of a ${i.size.orientation} ${sizeText} ${i.styleLabel.toLowerCase()} framed print hanging on the wall of a cosy living room with a sofa and plants. The room is a visualisation, not a photograph of a real home.`;
  const problems=captionProblems({text:body,tags,platform:i.platform});
  return {text,hashtags:tags,altText,problems};
}

export function captionProblems(c:{text:string;tags:string[];platform:"Instagram"|"Facebook"}):string[]{
  const out:string[]=[];
  if(countSentences(c.text)>3) out.push("MORE_THAN_THREE_SENTENCES");
  for(const f of FORBIDDEN) if(f.test(c.text)) out.push("FORBIDDEN_CLAIM:"+f.source);
  if(c.platform==="Instagram"&&c.tags.length>10) out.push("TOO_MANY_HASHTAGS");
  if(c.platform==="Facebook"&&c.tags.length>3) out.push("TOO_MANY_HASHTAGS");
  if(c.text.length>2000) out.push("TOO_LONG");
  return out;
}
