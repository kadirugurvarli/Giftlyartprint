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
    return Response.json(
      { ok: false, message: "Google content feed is not configured." },
      { status: 503 }
    );
  }

  if (!apiKey) {
    return Response.json(
      {
        ok: false,
        code: "OPENAI_NOT_CONFIGURED",
        message: "OpenAI image enhancement is not configured yet.",
      },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const fileId = String(body.fileId || "").trim();
    const category = String(body.category || "").trim();
    const customPrompt = String(body.prompt || "").trim();
    const perspective = Boolean(body.perspective);
    const lighting = Boolean(body.lighting);
    const background = Boolean(body.background);
    const straighten = Boolean(body.straighten);

    if (!fileId || !category) {
      return Response.json(
        { ok: false, message: "Missing source image or category." },
        { status: 400 }
      );
    }

    const sourceUrl = new URL(feedUrl);
    sourceUrl.searchParams.set("token", feedToken);
    sourceUrl.searchParams.set("action", "file");
    sourceUrl.searchParams.set("fileId", fileId);

    const sourceResponse = await fetch(sourceUrl, { cache: "no-store" });
    const source = await sourceResponse.json();

    if (!sourceResponse.ok || source?.ok === false || !source?.base64) {
      return Response.json(
        {
          ok: false,
          message: source?.error || source?.message || "Could not read the original image from Drive.",
        },
        { status: 502 }
      );
    }

    const instructions = [
      "Enhance this real customer/project photograph for professional business and social media use.",
      "Preserve the subject faithfully. Do not invent, replace, redesign, remove, or materially alter the framed artwork, iris artwork, printed product, object, text, logos, colours, proportions, frame moulding, mount, or product details.",
      perspective ? "Correct perspective and keystone distortion naturally." : "",
      straighten ? "Straighten the camera angle and horizon if needed." : "",
      lighting ? "Improve exposure, white balance, local contrast, shadows and highlights while keeping natural realistic colour." : "",
      background ? "Clean and simplify distracting background elements only when necessary, keeping the result realistic and believable." : "",
      "Improve clarity gently. Avoid over-sharpening, HDR look, fake reflections, fake depth of field, or artificial product changes.",
      "Keep the original composition and aspect ratio unless a small crop is needed only to correct alignment.",
      customPrompt ? "Additional instruction: " + customPrompt : "",
    ].filter(Boolean).join("\n");

    const sourceBytes = Buffer.from(source.base64, "base64");
    const sourceBlob = new Blob([sourceBytes], {
      type: source.mimeType || "image/jpeg",
    });

    const form = new FormData();
    form.append("model", "gpt-image-2");
    form.append("image[]", sourceBlob, source.fileName || "source.jpg");
    form.append("prompt", instructions);
    form.append("quality", "medium");
    form.append("size", "auto");

    const aiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const aiData = await aiResponse.json();

    if (!aiResponse.ok || !aiData?.data?.[0]?.b64_json) {
      return Response.json(
        {
          ok: false,
          message:
            aiData?.error?.message ||
            "OpenAI image enhancement failed.",
        },
        { status: 502 }
      );
    }

    const enhancedBase64 = aiData.data[0].b64_json;
    const enhancedName = stripExt(source.fileName || "image") + "_enhanced.png";

    const uploadUrl = new URL(feedUrl);
    uploadUrl.searchParams.set("token", feedToken);

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "upload",
        category,
        fileName: enhancedName,
        mimeType: "image/png",
        base64: enhancedBase64,
      }),
      cache: "no-store",
    });

    const uploadData = await uploadResponse.json();

    if (!uploadResponse.ok || uploadData?.ok === false) {
      return Response.json(
        {
          ok: false,
          message:
            uploadData?.error ||
            uploadData?.message ||
            "Enhanced image was created but could not be saved to Drive.",
        },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,
      message: "Enhanced version created. Original preserved.",
      enhanced: uploadData,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Image enhancement failed.",
      },
      { status: 500 }
    );
  }
}
