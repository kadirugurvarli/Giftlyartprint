import { NextRequest } from "next/server";
import sharp from "sharp";
import { BRAND, CATEGORY_RULES, PLATFORM_PRESETS, normaliseCategory, wordLimit, type PlatformPreset } from "@/lib/giftly-content-policy";
import { reviewFinalAsset } from "@/lib/giftly-art-director";

export const runtime = "nodejs";
export const maxDuration = 300;

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

const BRAND_LOGO_FILE_ID = "1viQoWbX4hakq03aCEi88hRvJsGA5GtqX";


const GLOBAL_CONTENT_RULES = [
  "Use only the uploaded source image(s) as the real product/project subject.",
  "Never invent, add, duplicate or replace physical products, irises, frames, artworks, mounts, prints, props or decorative objects unless the user explicitly asks for them.",
  "Do not create extra iris discs, extra framed copies, fake products or foreground product props.",
  "Preserve the real subject's shape, proportions, colours, artwork, frame moulding, mount and visible details faithfully.",
  "Allowed improvements: straighten, perspective correction, lighting, white balance, contrast, cleanup, background simplification and careful reframing.",
  "Background edits must remain realistic and must not imply a different product.",
  "Do not render any logo or wordmark inside the AI-generated scene. The real GiftlyArtPrint logo is applied later by the system.",
  "Do not render paragraphs or dense marketing copy inside the AI-generated scene.",
  "The final branded layout is minimal: one short headline, one short CTA and giftlyartprint.co.uk only.",
  "Headline should normally be 2-5 words. CTA should normally be 1-4 words.",
  "Overall tone: minimal, premium, warm, trustworthy, clean and not loud or salesy.",
  "Keep generous negative space for the system-applied headline, CTA, website and real logo.",
  "Platform outputs are fixed to Feed 4:5, Story 9:16 and Google Business 1:1."
].join("\n");

async function fetchDriveImage(feedUrl:string, feedToken:string, fileId:string) {
  const url = new URL(feedUrl);
  url.searchParams.set("token", feedToken);
  url.searchParams.set("action", "file");
  url.searchParams.set("fileId", fileId);

  const response = await fetch(url, { cache:"no-store" });
  const data = await response.json();

  if (!response.ok || data?.ok === false || !data?.base64) {
    throw new Error(data?.error || data?.message || "Could not read image asset from Drive.");
  }

  return {
    buffer: Buffer.from(data.base64, "base64"),
    fileName: data.fileName || "image.png",
    mimeType: data.mimeType || "image/png",
  };
}

function escapeXml(value:string) {
  return value
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&apos;");
}

function textOverlaySvg(
  width:number,
  height:number,
  headline:string,
  cta:string,
  contact:string,
  dark:boolean
) {
  const fg=dark ? "#FFFFFF" : "#171717";
  const panel=dark ? "rgba(0,0,0,0.46)" : "rgba(255,255,255,0.80)";
  const ctaBg=dark ? "#FFFFFF" : "#171717";
  const ctaFg=dark ? "#171717" : "#FFFFFF";

  const pad=Math.round(width*0.055);
  const panelW=Math.min(Math.round(width*0.78), width-pad*2);
  const headlineSize=Math.round(width*0.050);
  const smallSize=Math.round(width*0.024);
  const ctaSize=Math.round(width*0.026);
  const panelH=Math.round(height*0.18);
  const y=pad;

  return Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${pad}" y="${y}" width="${panelW}" height="${Math.round(panelH*0.58)}" fill="${panel}"/>
    <text x="${pad*1.28}" y="${y+headlineSize*1.15}"
      font-family="DejaVu Sans, sans-serif"
      font-size="${headlineSize}" font-weight="700"
      fill="${fg}">${escapeXml(headline)}</text>

    <rect x="${pad}" y="${y+Math.round(panelH*0.68)}"
      width="${Math.round(width*0.24)}" height="${Math.round(height*0.043)}"
      fill="${ctaBg}"/>
    <text x="${pad+Math.round(width*0.016)}"
      y="${y+Math.round(panelH*0.68)+Math.round(height*0.030)}"
      font-family="DejaVu Sans, sans-serif"
      font-size="${ctaSize}" font-weight="700" fill="${ctaFg}">
      ${escapeXml(cta)}
    </text>

    <text x="${pad}" y="${y+Math.round(panelH*0.68)+Math.round(height*0.070)}"
      font-family="DejaVu Sans, sans-serif"
      font-size="${smallSize}" fill="${fg}">
      ${escapeXml(contact)}
    </text>
  </svg>`);
}

async function textOverlayPng(
  width:number,
  height:number,
  headline:string,
  cta:string,
  contact:string,
  dark:boolean
){
  try{
    const fg=dark ? "#FFFFFF" : "#171717";
    const panel=dark ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.92)";
    const ctaBg=dark ? "#FFFFFF" : "#171717";
    const ctaFg=dark ? "#171717" : "#FFFFFF";

    const pad=Math.round(width*0.055);
    const maxW=Math.round(width*0.62);
    const headlineH=Math.round(height*0.060);
    const ctaH=Math.round(height*0.040);
    const webH=Math.round(height*0.032);
    const gap=Math.round(height*0.008);

    const headlineImg=await sharp({
      text:{
        text:`<span foreground="${fg}" font_weight="700">${escapeXml(headline)}</span>`,
        font:"sans",
        width:maxW,
        height:headlineH,
        align:"left",
        rgba:true,
        wrap:"word"
      }
    }).png().toBuffer();

    const ctaImg=await sharp({
      text:{
        text:`<span foreground="${ctaFg}" font_weight="700">${escapeXml(cta)}</span>`,
        font:"sans",
        width:Math.round(maxW*0.52),
        height:ctaH,
        align:"left",
        rgba:true,
        wrap:"word"
      }
    }).png().toBuffer();

    const webImg=await sharp({
      text:{
        text:`<span foreground="${fg}">${escapeXml(contact)}</span>`,
        font:"sans",
        width:Math.round(maxW*0.58),
        height:webH,
        align:"left",
        rgba:true,
        wrap:"none"
      }
    }).png().toBuffer();

    const headlineMeta=await sharp(headlineImg).metadata();
    const ctaMeta=await sharp(ctaImg).metadata();
    const webMeta=await sharp(webImg).metadata();

    const hW=Math.max(1,headlineMeta.width||maxW);
    const hH=Math.max(1,headlineMeta.height||headlineH);
    const cW=Math.max(1,ctaMeta.width||Math.round(maxW*0.52));
    const cH=Math.max(1,ctaMeta.height||ctaH);
    const wW=Math.max(1,webMeta.width||Math.round(maxW*0.58));
    const wH=Math.max(1,webMeta.height||webH);

    const headBg=Buffer.from(`<svg width="${hW+Math.round(width*0.03)}" height="${hH+Math.round(height*0.012)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${panel}"/></svg>`);
    const ctaBgSvg=Buffer.from(`<svg width="${cW+Math.round(width*0.03)}" height="${cH+Math.round(height*0.010)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${ctaBg}"/></svg>`);
    const webBg=Buffer.from(`<svg width="${wW+Math.round(width*0.024)}" height="${wH+Math.round(height*0.008)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${panel}"/></svg>`);

    const canvas=sharp({
      create:{
        width,
        height,
        channels:4,
        background:{r:0,g:0,b:0,alpha:0}
      }
    });

    const y1=pad;
    const y2=y1+hH+Math.round(height*0.012)+gap;
    const y3=y2+cH+Math.round(height*0.010)+gap;

    return canvas.composite([
      {input:headBg,left:pad,top:y1},
      {input:headlineImg,left:pad+Math.round(width*0.015),top:y1+Math.round(height*0.006)},
      {input:ctaBgSvg,left:pad,top:y2},
      {input:ctaImg,left:pad+Math.round(width*0.015),top:y2+Math.round(height*0.005)},
      {input:webBg,left:pad,top:y3},
      {input:webImg,left:pad+Math.round(width*0.012),top:y3+Math.round(height*0.004)}
    ]).png().toBuffer();
  }catch{
    return textOverlaySvg(width,height,headline,cta,contact,dark);
  }
}

async function buildOriginalSafeBase(
  source:Buffer,
  preset:PlatformPreset,
  strict=false
) {
  const width=preset.width;
  const height=preset.height;

  const topSafe=Math.round(
    height * Math.max(preset.topSafeRatio, strict ? 0.20 : 0.18)
  );
  const bottomSafe=Math.round(
    height * Math.max(preset.bottomSafeRatio, strict ? 0.12 : 0.09)
  );
  const sideMargin=Math.round(
    width * (preset.outerMarginRatio + (strict ? 0.02 : 0))
  );

  const maxSubjectWidth=Math.round(
    width * Math.max(0.68, preset.subjectMaxWidth - (strict ? 0.08 : 0.03))
  );
  const maxSubjectHeight=Math.round(
    height * Math.max(0.50, preset.subjectMaxHeight - (strict ? 0.08 : 0.03))
  );

  const background=await sharp(source)
    .rotate()
    .resize(width,height,{fit:"cover",position:"centre"})
    .blur(strict ? 40 : 30)
    .modulate({brightness:0.62,saturation:0.72})
    .png()
    .toBuffer();

  const foreground=await sharp(source)
    .rotate()
    .resize(maxSubjectWidth,maxSubjectHeight,{
      fit:"contain",
      withoutEnlargement:false,
      background:{r:247,g:245,b:240,alpha:1}
    })
    .png()
    .toBuffer();

  const meta=await sharp(foreground).metadata();
  const fgW=meta.width || maxSubjectWidth;
  const fgH=meta.height || maxSubjectHeight;

  const availableTop=topSafe;
  const availableBottom=height-bottomSafe;
  const availableHeight=Math.max(1,availableBottom-availableTop);

  const left=Math.max(sideMargin,Math.round((width-fgW)/2));
  const top=availableTop+Math.max(0,Math.round((availableHeight-fgH)/2));

  return sharp(background)
    .composite([{
      input:foreground,
      left:Math.min(left,Math.max(sideMargin,width-fgW-sideMargin)),
      top:Math.min(top,Math.max(availableTop,availableBottom-fgH))
    }])
    .png()
    .toBuffer();
}

async function applyBranding(
  generated:Buffer,
  variant:{key:string;width:number;height:number},
  logoSource:Buffer,
  campaign:{headline:string;cta:string},
  strict=false
) {
  const base=sharp(generated).resize(variant.width,variant.height,{
    fit:"cover",
    position:"centre"
  });

  const cornerW=Math.max(1,Math.round(variant.width*0.42));
  const cornerH=Math.max(1,Math.round(variant.height*0.18));
  const stats=await base.clone().extract({
    left:variant.width-cornerW,
    top:variant.height-cornerH,
    width:cornerW,
    height:cornerH
  }).stats();

  const brightness=(
    stats.channels[0].mean+
    stats.channels[1].mean+
    stats.channels[2].mean
  )/3;
  const darkBackground=brightness<145;

  const defaultScale=
    variant.key==="story_9x16" ? 0.22 :
    variant.key==="google_business_1x1" ? 0.19 :
    0.20;
  const logoScale=Math.max(0.15,defaultScale-(strict?0.025:0));
  const logoWidth=Math.round(variant.width*logoScale);

  const logo=await sharp(logoSource)
    .resize({width:logoWidth,withoutEnlargement:true})
    .png()
    .toBuffer();

  const logoMeta=await sharp(logo).metadata();
  const logoHeight=logoMeta.height || Math.round(logoWidth*0.28);
  const margin=Math.round(
    variant.width * (variant.key==="story_9x16" ? 0.055 : 0.045)
  );
  const backingPad=Math.round(variant.width*0.012);

  return base.composite([
    {
      input:await textOverlayPng(
        variant.width,
        variant.height,
        campaign.headline,
        campaign.cta,
        "giftlyartprint.co.uk",
        darkBackground
      ),
      top:0,
      left:0
    },
    {
      input:Buffer.from(`<svg width="${logoWidth+backingPad*2}" height="${logoHeight+backingPad*2}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgba(70,70,70,0.92)"/></svg>`),
      left:variant.width-logoWidth-margin-backingPad,
      top:variant.height-logoHeight-margin-backingPad
    },
    {
      input:logo,
      left:variant.width-logoWidth-margin,
      top:variant.height-logoHeight-margin
    }
  ]).png().toBuffer();
}

export async function POST(req: NextRequest) {
  const feedUrl = process.env.CONTENT_FEED_URL;
  const feedToken = process.env.CONTENT_FEED_TOKEN;
  const apiKey = process.env.OPENAI_API_KEY;

  if (!feedUrl || !feedToken) {
    return Response.json({ ok:false, message:"Google content feed is not configured." }, { status:503 });
  }

  if (!apiKey) {
    return Response.json({
      ok:false,
      code:"OPENAI_NOT_CONFIGURED",
      message:"OpenAI image generation is not configured yet."
    }, { status:503 });
  }

  try {
    const formData = await req.formData();
    const fileId = String(formData.get("fileId") || "").trim();
    const category = String(formData.get("category") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const reference = formData.get("reference");
    const creativeMode =
      Boolean(description.trim()) ||
      (reference instanceof File && reference.size > 0);


    if (!fileId || !category) {
      return Response.json({ ok:false, message:"Source image and category are required." }, { status:400 });
    }

    let campaign = {
      concept: description || "Create a polished premium social media campaign from this real customer/project image.",
      headline: category === "Iris Photography" ? "Your Iris as Art" :
        category === "Fine Art Printing" ? "Fine Art, Beautifully Printed" :
        category === "Photo Gifts" ? "Make It Personal" :
        category === "Business Printing" ? "Professional Print, Made Local" :
        "Bespoke Framing",
      supporting: "",
      cta: category === "Iris Photography" ? "Book your session" : "Get a quote",
      instagramCaption: "",
      facebookCaption: "",
      googleCaption: ""
    };

    let marketIntelligence = {
      dominantPatterns: [] as string[],
      compositionPattern: "",
      hookPattern: "",
      trustPattern: "",
      ctaPattern: "",
      adaptationBrief: "",
      avoidCopying: ""
    };

    try {
      const strategyResponse = await fetch("https://api.openai.com/v1/responses", {
        method:"POST",
        headers:{
          Authorization:`Bearer ${apiKey}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          model:"gpt-5.6-luna",
          tools:[{type:"web_search"}],
          input:[
            {
              role:"system",
              content:[{
                type:"input_text",
                text:[
                  "You are the Market Intelligence Lead and Creative Director for Giftly Art Print in Maidstone, UK.",
                  "Before proposing creative, research current public real-world examples in the same service category, prioritising 2025-2026 social posts, reels, studio websites, campaign examples and public trend/engagement evidence.",
                  "Study successful examples for their transferable mechanics only: subject scale, crop, visual hierarchy, process/reveal structure, craftsmanship proof, background treatment, human presence, emotional hook, trust cue, CTA style, text density and platform composition.",
                  "Do not copy a competitor's exact layout, wording, logo, colours, artwork, photograph or distinctive trade dress.",
                  "Do not name competitors in the final customer-facing copy.",
                  "The goal is pattern imitation: reproduce the successful mechanism with Giftly's own real source image and brand system.",
                  "Treat the uploaded source/product as protected. Never suggest inventing extra products, eyes, frames, artwork or customer objects.",
                  "Brand tone: minimal, premium, warm, trustworthy, clean, local, not loud or salesy.",
                  `Headline maximum: ${BRAND.maxHeadlineWords} words. CTA maximum: ${BRAND.maxCtaWords} words.`,
                  "On-image copy must remain only headline + CTA + website.",
                  "Permanent production rules:",
                  GLOBAL_CONTENT_RULES
                ].join("\n")
              }]
            },
            {
              role:"user",
              content:[{
                type:"input_text",
                text:[
                  `Category: ${category}`,
                  "Category rules:",
                  ...CATEGORY_RULES[normaliseCategory(category)],
                  `User idea (optional): ${description || "None. Choose the strongest current market pattern for this source."}`,
                  "Research several current examples first. Prefer evidence of real engagement/performance where available.",
                  "Distil recurring patterns rather than following a single post.",
                  "Then create one original Giftly campaign that uses the strongest transferable pattern.",
                  "The campaign must work as Feed 4:5, Story 9:16 and Google Business 1:1."
                ].join("\n")
              }]
            }
          ],
          text:{
            format:{
              type:"json_schema",
              name:"giftly_market_led_campaign",
              strict:true,
              schema:{
                type:"object",
                additionalProperties:false,
                properties:{
                  dominantPatterns:{
                    type:"array",
                    items:{type:"string"},
                    minItems:3,
                    maxItems:5
                  },
                  compositionPattern:{type:"string"},
                  hookPattern:{type:"string"},
                  trustPattern:{type:"string"},
                  ctaPattern:{type:"string"},
                  adaptationBrief:{type:"string"},
                  avoidCopying:{type:"string"},
                  campaign:{
                    type:"object",
                    additionalProperties:false,
                    properties:{
                      concept:{type:"string"},
                      headline:{type:"string"},
                      supporting:{type:"string"},
                      cta:{type:"string"},
                      instagramCaption:{type:"string"},
                      facebookCaption:{type:"string"},
                      googleCaption:{type:"string"}
                    },
                    required:["concept","headline","supporting","cta","instagramCaption","facebookCaption","googleCaption"]
                  }
                },
                required:[
                  "dominantPatterns",
                  "compositionPattern",
                  "hookPattern",
                  "trustPattern",
                  "ctaPattern",
                  "adaptationBrief",
                  "avoidCopying",
                  "campaign"
                ]
              }
            }
          }
        })
      });

      const strategyData = await strategyResponse.json();
      const outputText = Array.isArray(strategyData?.output)
        ? strategyData.output.flatMap((o:any)=>Array.isArray(o?.content)?o.content:[])
            .find((x:any)=>x?.type==="output_text")?.text
        : "";

      if (outputText) {
        const cleaned = outputText.replace(/^```json\s*/i,"").replace(/```$/,"").trim();
        const parsed=JSON.parse(cleaned);

        marketIntelligence = {
          dominantPatterns:Array.isArray(parsed.dominantPatterns) ? parsed.dominantPatterns.slice(0,5) : [],
          compositionPattern:String(parsed.compositionPattern || ""),
          hookPattern:String(parsed.hookPattern || ""),
          trustPattern:String(parsed.trustPattern || ""),
          ctaPattern:String(parsed.ctaPattern || ""),
          adaptationBrief:String(parsed.adaptationBrief || ""),
          avoidCopying:String(parsed.avoidCopying || "")
        };

        const p=parsed.campaign || {};
        campaign = {
          ...campaign,
          ...p,
          headline:wordLimit(String(p.headline || campaign.headline),BRAND.maxHeadlineWords),
          cta:wordLimit(String(p.cta || campaign.cta),BRAND.maxCtaWords)
        };
      }
    } catch {
      // Fallback campaign keeps content production working if market research is unavailable.
    }

    const source = await fetchDriveImage(feedUrl, feedToken, fileId);
    const logoSource = await fetchDriveImage(feedUrl, feedToken, BRAND_LOGO_FILE_ID);

    const sourceBlob = new Blob([source.buffer], { type: source.mimeType || "image/jpeg" });

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
    const baseName = "generated_content_" + stripExt(source.fileName || "image") + "_" + stamp;

    const variants = [
      {
        key:"feed_4x5",
        width:1080,
        height:1350,
        suffix:"feed_4x5",
        apiSize:"1024x1536",
        layout:"Design specifically for a 4:5 social feed post. Keep headline, supporting copy, CTA and the main subject comfortably inside the 4:5 safe area with balanced top and bottom breathing room."
      },
      {
        key:"story_9x16",
        width:1080,
        height:1920,
        suffix:"story_9x16",
        apiSize:"1024x1536",
        layout:"Design specifically for a vertical 9:16 Story. Use a taller composition, keep all important text away from the extreme top and bottom UI zones, and make the subject visually strong in the centre."
      },
      {
        key:"google_business_1x1",
        width:720,
        height:720,
        suffix:"google_business_1x1",
        apiSize:"1024x1024",
        layout:"Design specifically for a square 1:1 Google Business post. Use a compact square composition with readable text, a prominent subject and a clear CTA without crowding."
      }
    ];

    const uploadUrl = new URL(feedUrl);
    uploadUrl.searchParams.set("token", feedToken);

    const outputs:any[] = [];
    let usedOriginalSafeFallback = false;

    const generatedVariants = await Promise.all(
      variants.map(async (variant) => {
        const preset=PLATFORM_PRESETS.find((x)=>x.key===variant.key);
        if(!preset) throw new Error("Unknown platform preset: "+variant.key);

        const imageForm = new FormData();
        imageForm.append("model", "gpt-image-2.5-sunburst");
        imageForm.append("image[]", sourceBlob, source.fileName || "source.jpg");

        if (reference instanceof File && reference.size > 0) {
          imageForm.append("image[]", reference, reference.name || "reference.jpg");
        }

        const prompt = [
          "Create a polished marketing/content visual for Giftly Art Print.",
          "Permanent production rules:",
          GLOBAL_CONTENT_RULES,
          "Category-specific rules:",
          ...CATEGORY_RULES[normaliseCategory(category)],
          "Image 1 is the primary source/product/customer project and must remain visually faithful.",
          reference instanceof File && reference.size > 0
            ? "Image 2 is reference only. Use it for layout, mood, styling, background treatment or composition. Do not replace the subject from image 1."
            : "",
          "Preserve the real subject accurately: artwork, iris artwork, framed object, print, frame moulding, mount, colours, text and proportions should not be invented or materially changed.",
          "Improve presentation only as needed: perspective, lighting, cleanliness, natural shadows, believable background, premium commercial finish.",
          variant.layout,
          "Create only the photographic/design scene. Do not render any text, captions, labels, CTA buttons, website text, logos or wordmarks in the image. Leave clean negative space for the system to add brand elements afterwards.",
          "Keep the design clean, premium, warm and trustworthy with generous whitespace.",
          "Campaign concept:",
          campaign.concept,
          "Market-intelligence creative pattern to adapt:",
          marketIntelligence.adaptationBrief || marketIntelligence.compositionPattern || "Use a source-first premium product showcase.",
          "Transferable successful patterns:",
          ...(marketIntelligence.dominantPatterns || []),
          "Do not copy exact competitor layout/wording/branding:",
          marketIntelligence.avoidCopying || "Create an original Giftly composition.",
          "Reserve clean negative space suitable for a short headline, CTA and website added later by the system.",
          "User direction (optional):",
          description || "No extra direction — use the campaign concept above."
        ].filter(Boolean).join("\n");

        imageForm.append("prompt", prompt);
        imageForm.append("quality", "medium");
        imageForm.append("size", variant.apiSize);

        let generated:Buffer;
        let originalSafe=!creativeMode;

        if (!creativeMode) {
          usedOriginalSafeFallback=true;
          generated=await buildOriginalSafeBase(
            source.buffer,
            preset,
            false
          );
        } else {
          try {
            const aiResponse = await fetch("https://api.openai.com/v1/images/edits", {
              method:"POST",
              headers:{ Authorization:`Bearer ${apiKey}` },
              body:imageForm,
              signal:AbortSignal.timeout(42000)
            });

            const aiData = await aiResponse.json();

            if (!aiResponse.ok || !aiData?.data?.[0]?.b64_json) {
              throw new Error(aiData?.error?.message || "Image generation failed");
            }

            generated=Buffer.from(aiData.data[0].b64_json, "base64");
          } catch {
            originalSafe=true;
            usedOriginalSafeFallback=true;
            generated=await buildOriginalSafeBase(
              source.buffer,
              preset,
              false
            );
          }
        }

        let processed=await applyBranding(
          generated,
          variant,
          logoSource.buffer,
          campaign,
          false
        );

        const protectedSource=await sharp(source.buffer).rotate().png().toBuffer();
        let qa;
        let revisionCount=0;

        try {
          qa = await reviewFinalAsset({
            apiKey,
            sourceImage: protectedSource,
            finalImage: processed,
            preset,
            category,
            headline: campaign.headline,
            cta: campaign.cta,
          });
        } catch {
          qa = {
            decision: "REVISE" as const,
            score: 0,
            hardFail: false,
            issues: ["Art Director review could not be completed."],
            strengths: [],
            revisionInstruction: "Run strict source-first revision.",
          };
        }

        if (qa.decision!=="PASS" || qa.hardFail || qa.score<85) {
          revisionCount=1;
          const safeBase=await buildOriginalSafeBase(source.buffer,preset,true);
          processed=await applyBranding(
            safeBase,
            variant,
            logoSource.buffer,
            campaign,
            true
          );

          try {
            qa=await reviewFinalAsset({
              apiKey,
              sourceImage:protectedSource,
              finalImage:processed,
              preset,
              category,
              headline:campaign.headline,
              cta:campaign.cta,
            });
          } catch {
            qa={
              decision:"REJECT" as const,
              score:0,
              hardFail:true,
              issues:["Art Director could not verify the revised asset."],
              strengths:[],
              revisionInstruction:"Do not publish automatically."
            };
          }
        }

        return { variant, processed, qa, revisionCount };
      })
    );

    const rejected = generatedVariants.filter(
      ({qa}) => qa.hardFail || qa.decision !== "PASS" || qa.score < 85
    );

    if (rejected.length) {
      return Response.json({
        ok:false,
        code:"ART_DIRECTOR_REJECTED",
        message:"Art Director rejected one or more platform assets. Nothing was sent to Approval.",
        reviews:rejected.map(({variant,qa})=>({
          preset:variant.key,
          qa
        }))
      }, { status:422 });
    }

    const uploaded = await Promise.all(
      generatedVariants.map(async ({variant,processed,qa,revisionCount}) => {
        const uploadResponse = await fetch(uploadUrl, {
          method:"POST",
          headers:{ "Content-Type":"text/plain;charset=utf-8" },
          body:JSON.stringify({
            action:"upload",
            category,
            fileName:`${baseName}_${variant.suffix}.png`,
            mimeType:"image/png",
            base64:processed.toString("base64")
          }),
          cache:"no-store"
        });

        const uploadData = await uploadResponse.json();

        if (!uploadResponse.ok || uploadData?.ok === false) {
          throw new Error(uploadData?.error || uploadData?.message || `Could not save ${variant.key} output to Drive.`);
        }

        return {
          ...uploadData,
          preset:variant.key,
          width:variant.width,
          height:variant.height,
          qa,
          revisionCount
        };
      })
    );

    outputs.push(...uploaded);

    return Response.json({
      ok:true,
      message:usedOriginalSafeFallback
        ? "Platform pack created in Original-safe mode. The real source image was preserved and no AI-added objects were used."
        : "Platform pack created and ready for approval.",
      mode:creativeMode && !usedOriginalSafeFallback ? "creative-ai" : "original-safe",
      campaign,
      marketIntelligence,
      outputs
    });
  } catch (error) {
    return Response.json({
      ok:false,
      message:error instanceof Error ? error.message : "Content generation failed."
    }, { status:500 });
  }
}
