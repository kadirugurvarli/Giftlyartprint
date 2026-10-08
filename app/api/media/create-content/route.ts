import { NextRequest } from "next/server";

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
    const format = String(formData.get("format") || "portrait").trim();
    const reference = formData.get("reference");

    if (!fileId || !category || !description) {
      return Response.json({ ok:false, message:"Source image, category and description are required." }, { status:400 });
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

    const imageForm = new FormData();
    imageForm.append("model", "gpt-image-2.5-sunburst");
    imageForm.append("image[]", sourceBlob, source.fileName || "source.jpg");

    if (reference instanceof File && reference.size > 0) {
      imageForm.append("image[]", reference, reference.name || "reference.jpg");
    }

    const size =
      format === "square" ? "1024x1024" :
      format === "landscape" ? "1536x1024" :
      "1024x1536";

    const prompt = [
      "Create a polished marketing/content visual for Giftly Art Print.",
      "Image 1 is the primary source/product/customer project and must remain visually faithful.",
      reference instanceof File && reference.size > 0
        ? "Image 2 is reference only. Use it for layout, mood, styling, background treatment or composition. Do not replace the subject from image 1."
        : "",
      "Preserve the real subject accurately: artwork, iris artwork, framed object, print, frame moulding, mount, colours, text and proportions should not be invented or materially changed.",
      "Improve presentation only as needed: perspective, lighting, cleanliness, natural shadows, believable background, premium commercial finish.",
      "Do not add logos or marketing text unless explicitly requested.",
      "User brief:",
      description
    ].filter(Boolean).join("\n");

    imageForm.append("prompt", prompt);
    imageForm.append("quality", "medium");
    imageForm.append("size", size);

    const aiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method:"POST",
      headers:{ Authorization:`Bearer ${apiKey}` },
      body:imageForm
    });

    const aiData = await aiResponse.json();

    if (!aiResponse.ok || !aiData?.data?.[0]?.b64_json) {
      return Response.json({
        ok:false,
        message:aiData?.error?.message || "Content image generation failed."
      }, { status:502 });
    }

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14);
    const outputName = stripExt(source.fileName || "image") + "_content_" + stamp + ".png";

    const uploadUrl = new URL(feedUrl);
    uploadUrl.searchParams.set("token", feedToken);

    const uploadResponse = await fetch(uploadUrl, {
      method:"POST",
      headers:{ "Content-Type":"text/plain;charset=utf-8" },
      body:JSON.stringify({
        action:"upload",
        category,
        fileName:outputName,
        mimeType:"image/png",
        base64:aiData.data[0].b64_json
      }),
      cache:"no-store"
    });

    const uploadData = await uploadResponse.json();

    if (!uploadResponse.ok || uploadData?.ok === false) {
      return Response.json({
        ok:false,
        message:uploadData?.error || uploadData?.message || "Visual was created but could not be saved to Drive."
      }, { status:502 });
    }

    return Response.json({
      ok:true,
      message:"Content visual created and saved. Original source preserved.",
      output:uploadData
    });
  } catch (error) {
    return Response.json({
      ok:false,
      message:error instanceof Error ? error.message : "Content generation failed."
    }, { status:500 });
  }
}
