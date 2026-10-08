import sharp from "sharp";
import { BRAND, PLATFORM_PRESETS, type PlatformPreset } from "@/lib/giftly-content-policy";
import type { ProductAnalysis } from "@/lib/giftly-v2-director";

export type V2DefectCode=
  | "PRODUCT_TOO_SMALL"
  | "PRODUCT_TOO_LARGE"
  | "SAFE_ZONE_VIOLATION"
  | "TEXT_OVERFLOW"
  | "LOW_CONTRAST"
  | "SOURCE_FALLBACK";

function escapeXml(value:string){
  return value
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&apos;");
}

function clamp(n:number,min:number,max:number){
  return Math.max(min,Math.min(max,n));
}

export async function extractProtectedProduct(source:Buffer,analysis:ProductAnalysis){
  const rotated=sharp(source).rotate();
  const meta=await rotated.metadata();
  const width=meta.width || 1;
  const height=meta.height || 1;

  if(!analysis.rectangular || analysis.confidence<0.68){
    return {
      mode:"source-card" as const,
      buffer:await rotated.png().toBuffer(),
      sourceWidth:width,
      sourceHeight:height
    };
  }

  const b=analysis.bbox;
  const x=clamp(Math.round((b.x/1000)*width),0,width-1);
  const y=clamp(Math.round((b.y/1000)*height),0,height-1);
  const right=clamp(Math.round(((b.x+b.width)/1000)*width),x+1,width);
  const bottom=clamp(Math.round(((b.y+b.height)/1000)*height),y+1,height);

  const padX=Math.round((right-x)*0.025);
  const padY=Math.round((bottom-y)*0.025);
  const left=clamp(x-padX,0,width-1);
  const top=clamp(y-padY,0,height-1);
  const r=clamp(right+padX,left+1,width);
  const bot=clamp(bottom+padY,top+1,height);

  const crop=await sharp(source)
    .rotate()
    .extract({
      left,
      top,
      width:r-left,
      height:bot-top
    })
    .png()
    .toBuffer();

  return {
    mode:"protected-crop" as const,
    buffer:crop,
    sourceWidth:r-left,
    sourceHeight:bot-top
  };
}

async function makeBrandOverlay(args:{
  preset:PlatformPreset;
  headline:string;
  cta:string;
  logo:Buffer;
}){
  const {preset}=args;
  const width=preset.width;
  const height=preset.height;
  const margin=Math.round(width*preset.outerMarginRatio);
  const safeTop=Math.max(margin,Math.round(height*preset.topSafeRatio));
  const safeBottom=Math.max(margin,Math.round(height*preset.bottomSafeRatio));

  const headlineSize=Math.round(width*(preset.key==="story_9x16"?0.045:0.048));
  const ctaSize=Math.round(width*0.024);
  const webSize=Math.round(width*0.021);

  const maxHeadlineChars=preset.key==="story_9x16"?24:28;
  const headline=args.headline.slice(0,maxHeadlineChars);
  const cta=args.cta.slice(0,24);

  const textBgW=Math.round(width*0.68);
  const textBgH=Math.round(height*(preset.key==="story_9x16"?0.11:0.13));

  const svg=Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${margin}" y="${safeTop}" width="${textBgW}" height="${textBgH}" fill="rgba(255,255,255,0.90)"/>
    <text x="${margin+Math.round(width*0.018)}" y="${safeTop+Math.round(textBgH*0.42)}"
      font-family="Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="700"
      fill="#171717">${escapeXml(headline)}</text>
    <rect x="${margin}" y="${safeTop+textBgH+Math.round(height*0.012)}"
      width="${Math.round(width*0.26)}" height="${Math.round(height*0.043)}" fill="#171717"/>
    <text x="${margin+Math.round(width*0.014)}" y="${safeTop+textBgH+Math.round(height*0.041)}"
      font-family="Arial, Helvetica, sans-serif" font-size="${ctaSize}" font-weight="700"
      fill="#ffffff">${escapeXml(cta)}</text>
    <text x="${margin}" y="${height-safeBottom-Math.round(height*0.018)}"
      font-family="Arial, Helvetica, sans-serif" font-size="${webSize}" fill="#ffffff">
      ${BRAND.website}
    </text>
  </svg>`);

  const logoWidth=Math.round(width*preset.logoWidthRatio);
  const logo=await sharp(args.logo)
    .resize({width:logoWidth,withoutEnlargement:true})
    .png()
    .toBuffer();
  const lm=await sharp(logo).metadata();
  const logoH=lm.height || Math.round(logoWidth*0.25);

  return {
    svg,
    logo,
    logoLeft:width-logoWidth-margin,
    logoTop:height-logoH-safeBottom
  };
}

export async function renderVariant(args:{
  background:Buffer;
  product:Buffer;
  productMode:"protected-crop"|"source-card";
  preset:PlatformPreset;
  logo:Buffer;
  headline:string;
  cta:string;
}){
  const p=args.preset;
  const width=p.width;
  const height=p.height;
  const margin=Math.round(width*p.outerMarginRatio);
  const topReserve=Math.max(
    Math.round(height*p.topSafeRatio),
    Math.round(height*(p.key==="story_9x16"?0.20:0.18))
  );
  const bottomReserve=Math.max(
    Math.round(height*p.bottomSafeRatio),
    Math.round(height*0.11)
  );

  const bg=await sharp(args.background)
    .resize(width,height,{fit:"cover",position:"centre"})
    .modulate({brightness:0.96,saturation:0.92})
    .png()
    .toBuffer();

  const maxW=Math.round(width*p.subjectMaxWidth);
  const maxH=Math.round((height-topReserve-bottomReserve)*0.82);

  const product=await sharp(args.product)
    .resize(maxW,maxH,{
      fit:"inside",
      withoutEnlargement:false
    })
    .png()
    .toBuffer();

  const pm=await sharp(product).metadata();
  const pw=pm.width || maxW;
  const ph=pm.height || maxH;

  const left=Math.round((width-pw)/2);
  const availableTop=topReserve;
  const availableBottom=height-bottomReserve;
  const top=Math.round(availableTop+(availableBottom-availableTop-ph)/2);

  const shadowPad=Math.max(16,Math.round(width*0.025));
  const shadow=await sharp({
    create:{
      width:pw+shadowPad*2,
      height:ph+shadowPad*2,
      channels:4,
      background:{r:0,g:0,b:0,alpha:0}
    }
  })
    .composite([{
      input:Buffer.from(`<svg width="${pw}" height="${ph}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgba(0,0,0,0.34)"/></svg>`),
      left:shadowPad,
      top:shadowPad
    }])
    .blur(Math.max(8,Math.round(width*0.012)))
    .png()
    .toBuffer();

  const brand=await makeBrandOverlay({
    preset:p,
    headline:args.headline,
    cta:args.cta,
    logo:args.logo
  });

  const final=await sharp(bg)
    .composite([
      {
        input:shadow,
        left:Math.max(0,left-shadowPad+Math.round(width*0.012)),
        top:Math.max(0,top-shadowPad+Math.round(height*0.008))
      },
      {input:product,left,top},
      {input:brand.svg,left:0,top:0},
      {input:brand.logo,left:brand.logoLeft,top:brand.logoTop}
    ])
    .png()
    .toBuffer();

  const productArea=(pw*ph)/(width*height);
  const defects:V2DefectCode[]=[];
  if(productArea<0.18) defects.push("PRODUCT_TOO_SMALL");
  if(productArea>0.72) defects.push("PRODUCT_TOO_LARGE");
  if(args.productMode==="source-card") defects.push("SOURCE_FALLBACK");

  return {
    buffer:final,
    placement:{left,top,width:pw,height:ph},
    defects
  };
}

export function getPreset(key:string){
  const found=PLATFORM_PRESETS.find((x)=>x.key===key);
  if(!found) throw new Error("Unknown platform preset: "+key);
  return found;
}
