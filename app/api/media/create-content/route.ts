import { NextRequest } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 60;

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
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
                text:"You are the social content strategist for Giftly Art Print, a Maidstone, UK framing, fine-art printing, iris photography, photo-gift and business-printing studio. Research current successful visual/copy patterns for this service category when useful, but do not copy any brand or post. Return only valid JSON with keys concept, headline, supporting, cta, instagramCaption, facebookCaption, googleCaption. Keep claims factual and local. Captions must be ready to publish, natural UK English, not spammy, and include a concise CTA. Do not mention your research."
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

    const sourceUrl = new URL(feedUrl);
    sourceUrl.searchParams.set("token", feedToken);
    sourceUrl.searchParams.set("action", "file");
    sourceUrl.searchParams.set("fileId", fileId);

    const sourceResponse = await fetch(sourceUrl, { cache:"no-store" });
    const source = await sourceResponse.json();

    if (!sourceResponse.ok || source?.ok === false || !source?.base64) {
      return Response.json({
        ok:false,
        message:source?.error || source?.message || "Could not read the source image from Drive."
      }, { status:502 });
    }

    const sourceBytes = Buffer.from(source.base64, "base64");
    const sourceBlob = new Blob([sourceBytes], { type: source.mimeType || "image/jpeg" });

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
    const baseName = stripExt(source.fileName || "image") + "_content_" + stamp;

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

    for (const variant of variants) {
      const imageForm = new FormData();
      imageForm.append("model", "gpt-image-2.5-sunburst");
      imageForm.append("image[]", sourceBlob, source.fileName || "source.jpg");

      if (reference instanceof File && reference.size > 0) {
        imageForm.append("image[]", reference, reference.name || "reference.jpg");
      }

      const prompt = [
        "Create a polished marketing/content visual for Giftly Art Print.",
        "Image 1 is the primary source/product/customer project and must remain visually faithful.",
        reference instanceof File && reference.size > 0
          ? "Image 2 is reference only. Use it for layout, mood, styling, background treatment or composition. Do not replace the subject from image 1."
          : "",
        "Preserve the real subject accurately: artwork, iris artwork, framed object, print, frame moulding, mount, colours, text and proportions should not be invented or materially changed.",
        "Improve presentation only as needed: perspective, lighting, cleanliness, natural shadows, believable background, premium commercial finish.",
        variant.layout,
        "Create a finished, share-ready promotional visual. Text must be legible and visually integrated into the design, not added as an afterthought.",
        "Campaign concept:",
        campaign.concept,
        "Use these exact marketing words where text is appropriate:",
        "Headline: " + campaign.headline,
        "Supporting line: " + campaign.supporting,
        "CTA: " + campaign.cta,
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

      if (!aiResponse.ok || !aiData?.data?.[0]?.b64_json) {
        return Response.json({
          ok:false,
          message:aiData?.error?.message || `Content image generation failed for ${variant.key}.`
        }, { status:502 });
      }

      const generated = Buffer.from(aiData.data[0].b64_json, "base64");

      const processed = await sharp(generated)
        .resize(variant.width, variant.height, {
          fit:"cover",
          position:"centre"
        })
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
      message:"Platform pack created and ready for approval.",
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
