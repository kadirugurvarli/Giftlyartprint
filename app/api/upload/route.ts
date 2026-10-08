import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const feedUrl = process.env.CONTENT_FEED_URL;
  const feedToken = process.env.CONTENT_FEED_TOKEN;

  if (!feedUrl || !feedToken) {
    return Response.json(
      { ok: false, message: "Google content feed is not configured." },
      { status: 503 }
    );
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    const projectId = String(form.get("projectId") || "").trim();
    const category = String(form.get("category") || "").trim();

    if (!(file instanceof File)) {
      return Response.json({ ok: false, message: "Choose an image first." }, { status: 400 });
    }

    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || "")) {
      return Response.json({ ok: false, message: "Supported formats: JPG, PNG, WEBP, HEIC, HEIF." }, { status: 400 });
    }

    if (file.size > 900 * 1024) {
      return Response.json({ ok: false, message: "Image is too large after preparation. Maximum upload size is 900 KB." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    const base64 = btoa(binary);

    const url = new URL(feedUrl);
    url.searchParams.set("token", feedToken);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "upload",
        projectId,
        category,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const raw = await response.text();
    let data: any = raw;
    try { data = JSON.parse(raw); } catch {}

    if (!response.ok || data?.ok === false) {
      return Response.json(
        { ok: false, message: data?.error || data?.message || "Upload failed.", details: data },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, message: "Image uploaded to Google Drive.", data });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Google Apps Script upload timed out after 20 seconds."
        : error instanceof Error
          ? error.message
          : "Upload failed.";

    return Response.json(
      { ok: false, message },
      { status: 500 }
    );
  }
}
