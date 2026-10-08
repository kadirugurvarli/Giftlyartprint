import { NextRequest } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  const headlineSize=Math.round(width*0.062);
  const smallSize=Math.round(width*0.028);
  const ctaSize=Math.round(width*0.031);
  const panelH=Math.round(height*0.22);
  const y=pad;

  return Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${pad}" y="${y}" width="${panelW}" height="${panelH}" rx="0" fill="${panel}"/>
    <text x="${pad*1.35}" y="${y+headlineSize*1.35}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${headlineSize}" font-weight="700"
      fill="${fg}">${escapeXml(headline)}</text>
    <rect x="${pad*1.35}" y="${y+panelH-Math.round(height*0.068)}"
      width="${Math.round(width*0.28)}" height="${Math.round(height*0.047)}"
      rx="0" fill="${ctaBg}"/>
    <text x="${pad*1.35+Math.round(width*0.018)}"
      y="${y+panelH-Math.round(height*0.037)}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${ctaSize}" font-weight="700" fill="${ctaFg}">
      ${escapeXml(cta)}
    </text>
    <text x="${pad*1.35}" y="${y+panelH-Math.round(height*0.012)}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${smallSize}" fill="${fg}">
      ${escapeXml(contact)}
    </text>
  </svg>`);
}

async function buildOriginalSafeBase(
  source:Buffer,
  width:number,
  height:number
) {
  const topSpace=Math.round(height*0.24);
  const sideMargin=Math.round(width*0.055);
  const bottomMargin=Math.round(height*0.055);
  const usableHeight=height-topSpace-bottomMargin;
  const usableWidth=width-sideMargin*2;

  const foreground=await sharp(source)
    .rotate()
    .resize(usableWidth,usableHeight,{
      fit:"contain",
      background:{r:244,g:242,b:237,alpha:1}
    })
    .png()
    .toBuffer();

  const meta=await sharp(foreground).metadata();
  const fgW=meta.width || usableWidth;
  const fgH=meta.height || usableHeight;

  return sharp({
    create:{
      width,
      height,
      channels:4,
      background:{r:244,g:242,b:237,alpha:1}
    }
  })
    .composite([{
      input:foreground,
      left:Math.max(0,Math.round((width-fgW)/2)),
      top:topSpace+Math.max(0,Math.round((usableHeight-fgH)/2))
    }])
    .png()
    .toBuffer();
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

    if (!fileId || !category) {
      return Response.json({ ok:false, message:"Source image and category are required." }, { status:400 });
    }

    let campaign = {
      concept: description || "Create a polished premium social media campaign from this real customer/project image.",
      headline: category === "Iris Photography" ? "Your Iris, Reimagined as Art" :
        category === "Fine Art Printing" ? "Fine Art Printing, Made Beautifully" :
        category === "Photo Gifts" ? "Turn a Favourite Photo into Something Special" :
        category === "Business Printing" ? "Professional Print, Made Locally" :
        "Bespoke Framing",
      supporting: category === "Bespoke Framing" ? "Made to showcase what matters to you" : "Made with care by Giftly Art Print",
      cta: "Send us a photo for a quote",
      instagramCaption: "",
      facebookCaption: "",
      googleCaption: ""
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
                text:"You are the social content strategist for Giftly Art Print, a Maidstone, UK framing, fine-art printing, iris photography, photo-gift and business-printing studio. Research current successful visual/copy patterns for this service category when useful, but do not copy any brand or post. Return only valid JSON with keys concept, headline, supporting, cta, instagramCaption, facebookCaption, googleCaption. Keep claims factual and local. Brand style is minimal, premium, warm, trustworthy and never loud or salesy. Headline must be 2-5 words. supporting must be empty or at most 6 words. CTA must be 1-4 words. Captions must be short, natural UK English, no long paragraphs, no filler, and normally 1-3 short sentences. Do not mention your research. Permanent production rules:\n"+GLOBAL_CONTENT_RULES
              }]
            },
            {
              role:"user",
              content:[{
                type:"input_text",
                text:`Category: ${category}\nUser idea (optional): ${description || "No idea supplied — choose the strongest concept yourself."}\nCreate one cohesive campaign concept suitable for Feed 4:5, Story 9:16 and Google Business 1:1.`
              }]
            }
          ]
        })
      });

      const strategyData = await strategyResponse.json();
      const outputText = Array.isArray(strategyData?.output)
        ? strategyData.output.flatMap((o:any)=>Array.isArray(o?.content)?o.content:[])
            .find((x:any)=>x?.type==="output_text")?.text
        : "";

      if (outputText) {
        const cleaned = outputText.replace(/^```json\s*/i,"").replace(/```$/,"").trim();
        campaign = { ...campaign, ...JSON.parse(cleaned) };
      }
    } catch {
      // Safe fallback copy above keeps generation working if research/copy generation fails.
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

    for (const variant of variants) {
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
        "Reserve clean negative space suitable for a short headline, CTA and website added later by the system.",
        "User direction (optional):",
        description || "No extra direction — use the campaign concept above."
      ].filter(Boolean).join("\n");

      imageForm.append("prompt", prompt);
      imageForm.append("quality", "medium");
      imageForm.append("size", variant.apiSize);

      const aiResponse = await fetch("https://api.openai.com/v1/images/edits", {
        method:"POST",
        headers:{ Authorization:`Bearer ${apiKey}` },
        body:imageForm
      });

      const aiData = await aiResponse.json();

      let generated:Buffer;
      let originalSafe=false;

      if (!aiResponse.ok || !aiData?.data?.[0]?.b64_json) {
        originalSafe=true;
        usedOriginalSafeFallback=true;
        generated=await buildOriginalSafeBase(
          source.buffer,
          variant.width,
          variant.height
        );
      } else {
        generated=Buffer.from(aiData.data[0].b64_json, "base64");
      }

      const base = originalSafe
        ? sharp(generated)
        : sharp(generated).resize(variant.width, variant.height, {
            fit:"cover",
            position:"centre"
          });

      const cornerW=Math.max(1,Math.round(variant.width*0.42));
      const cornerH=Math.max(1,Math.round(variant.height*0.18));
      const stats=await base
        .clone()
        .extract({
          left:variant.width-cornerW,
          top:variant.height-cornerH,
          width:cornerW,
          height:cornerH
        })
        .stats();

      const brightness=(stats.channels[0].mean+stats.channels[1].mean+stats.channels[2].mean)/3;
      const darkBackground=brightness<145;

      const logoBase=logoSource.buffer;
      const logoWidth=Math.round(variant.width*0.28);
      const logo=await sharp(logoBase)
        .resize({width:logoWidth,withoutEnlargement:true})
        .png()
        .toBuffer();

      const logoMeta=await sharp(logo).metadata();
      const logoHeight=logoMeta.height || Math.round(logoWidth*0.28);
      const margin=Math.round(variant.width*0.045);

      const processed = await base
        .composite([
          {
            input:textOverlaySvg(
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
            input:Buffer.from(`<svg width="${logoWidth+Math.round(margin*0.7)}" height="${logoHeight+Math.round(margin*0.5)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgba(70,70,70,0.92)"/></svg>`),
            left:variant.width-logoWidth-margin-Math.round(margin*0.35),
            top:variant.height-logoHeight-margin-Math.round(margin*0.25)
          },
          {
            input:logo,
            left:variant.width-logoWidth-margin,
            top:variant.height-logoHeight-margin
          }
        ])
        .png()
        .toBuffer();

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
        return Response.json({
          ok:false,
          message:uploadData?.error || uploadData?.message || `Could not save ${variant.key} output to Drive.`
        }, { status:502 });
      }

      outputs.push({
        ...uploadData,
        preset:variant.key,
        width:variant.width,
        height:variant.height
      });
    }

    return Response.json({
      ok:true,
      message:usedOriginalSafeFallback
        ? "Platform pack created in Original-safe mode. The real source image was preserved and no AI-added objects were used."
        : "Platform pack created and ready for approval.",
      mode:usedOriginalSafeFallback ? "original-safe" : "ai-assisted",
      campaign,
      outputs
    });
  } catch (error) {
    return Response.json({
      ok:false,
      message:error instanceof Error ? error.message : "Content generation failed."
    }, { status:500 });
  }
}
