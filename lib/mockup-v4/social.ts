import sharp from "sharp";
import type {Quad,RawImage} from "../mockup-v3/types";

export type SocialFormat={
  key:"feed_4x5"|"square_1x1"|"story_9x16"|"landscape_191x100";
  label:string;width:number;height:number;
  platforms:("Instagram"|"Facebook")[];
  /** target share of the crop height the frame should take (room context vs. product presence) */
  frameFraction:number;
  /** parts of the height that apps cover with UI (story), as ratios */
  safeTop:number;safeBottom:number;
};

/** Same pixel sizes as the existing V2 presets for 4:5 and 9:16; 1:1 and 1.91:1 are new for Facebook/Instagram. */
export const SOCIAL_FORMATS:SocialFormat[]=[
  {key:"feed_4x5",label:"Feed 4:5 (1080×1350)",width:1080,height:1350,platforms:["Instagram","Facebook"],frameFraction:0.40,safeTop:0.04,safeBottom:0.04},
  {key:"square_1x1",label:"Square 1:1 (1080×1080)",width:1080,height:1080,platforms:["Instagram","Facebook"],frameFraction:0.46,safeTop:0.05,safeBottom:0.05},
  {key:"story_9x16",label:"Story / Reel cover 9:16 (1080×1920)",width:1080,height:1920,platforms:["Instagram","Facebook"],frameFraction:0.30,safeTop:0.13,safeBottom:0.20},
  {key:"landscape_191x100",label:"Facebook landscape 1.91:1 (1200×630)",width:1200,height:630,platforms:["Facebook"],frameFraction:0.56,safeTop:0.05,safeBottom:0.05}
];

export const MAX_EXPORT_BYTES=900*1024; // the existing Drive upload route refuses larger files

export type CropPlan={ok:true;crop:{left:number;top:number;width:number;height:number};upscale:number;frameFractionUsed:number}|{ok:false;error:string};

const bbox=(q:Quad)=>({x0:Math.min(...q.map(p=>p.x)),y0:Math.min(...q.map(p=>p.y)),x1:Math.max(...q.map(p=>p.x)),y1:Math.max(...q.map(p=>p.y))});

/**
 * Pick the room window for a format. The whole frame (and so the whole print) always stays inside the window with a margin and
 * inside the platform's safe zones; if that is impossible the export is refused rather than cropping the product.
 */
export function planSocialCrop(W:number,H:number,outerQuad:Quad,f:SocialFormat):CropPlan{
  const b=bbox(outerQuad),fw=b.x1-b.x0,fh=b.y1-b.y0,A=f.width/f.height;
  // ideal window from the frame fraction, then limited to what the image can hold
  let h=fh/f.frameFraction,w=h*A;
  const maxH=Math.min(H,W/A);
  if(h>maxH){h=maxH;w=h*A;}
  // at least the frame plus the safe zones and a 6 % margin
  const needH=fh/(1-f.safeTop-f.safeBottom-0.12),needW=fw/0.88;
  h=Math.max(h,needH,needW/A);w=h*A;
  if(h>H+1e-6||w>W+1e-6) return {ok:false,error:"FRAME_TOO_LARGE_FOR_FORMAT"};
  // centre the frame horizontally, a little above the vertical centre; keep inside the image
  const cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2;
  let left=cx-w/2,top=cy-h*0.47;
  left=Math.max(0,Math.min(W-w,left));top=Math.max(0,Math.min(H-h,top));
  // the frame must clear the safe zones and the side margins after clamping
  const topLimit=top+h*(f.safeTop+0.06),bottomLimit=top+h*(1-f.safeBottom-0.06);
  if(b.y0<topLimit-1e-6||b.y1>bottomLimit+1e-6||b.x0<left+w*0.06-1e-6||b.x1>left+w*0.94+1e-6) return {ok:false,error:"FRAME_OUTSIDE_SAFE_ZONE"};
  const crop={left:Math.round(left),top:Math.round(top),width:Math.min(W-Math.round(left),Math.round(w)),height:Math.min(H-Math.round(top),Math.round(h))};
  return {ok:true,crop,upscale:f.width/crop.width,frameFractionUsed:fh/crop.height};
}

const toSharp=(img:RawImage)=>sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}});

export type SocialFile={format:SocialFormat["key"];width:number;height:number;bytes:Buffer;quality:number;upscale:number;crop:{left:number;top:number;width:number;height:number};mime:"image/jpeg"};
export type SocialResult={ok:true;file:SocialFile}|{ok:false;error:string};

/** Render one format as sRGB JPEG with no metadata, lowering quality only as far as needed to stay under the upload limit. */
export async function renderSocial(master:RawImage,outerQuad:Quad,f:SocialFormat):Promise<SocialResult>{
  const plan=planSocialCrop(master.width,master.height,outerQuad,f);
  if(!plan.ok) return plan;
  const base=toSharp(master).extract(plan.crop).resize(f.width,f.height,{fit:"fill",kernel:"lanczos3"}).removeAlpha().toColourspace("srgb");
  const buf=await base.clone().raw().toBuffer(); // one resample, reused for each quality
  for(const q of [92,88,84,80,76,72]){
    const bytes=await sharp(buf,{raw:{width:f.width,height:f.height,channels:3}}).jpeg({quality:q,chromaSubsampling:"4:4:4",mozjpeg:true}).toBuffer();
    if(bytes.length<=MAX_EXPORT_BYTES) return {ok:true,file:{format:f.key,width:f.width,height:f.height,bytes,quality:q,upscale:plan.upscale,crop:plan.crop,mime:"image/jpeg"}};
  }
  return {ok:false,error:"EXPORT_TOO_LARGE_AT_MIN_QUALITY"};
}

/** Lossless master for archive/re-export (PNG, sRGB, no metadata). */
export async function renderMasterPng(master:RawImage):Promise<Buffer>{
  return toSharp(master).removeAlpha().toColourspace("srgb").png({compressionLevel:9}).toBuffer();
}
