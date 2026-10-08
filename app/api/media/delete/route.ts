import { NextRequest } from "next/server";

function extractDriveId(url: string) {
  const m1 = url.match(/[?&]id=([^&]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/\/d\/([^/]+)/);
  if (m2) return m2[1];
  return "";
}

export async function POST(req: NextRequest) {
  const feedUrl = process.env.CONTENT_FEED_URL;
  const feedToken = process.env.CONTENT_FEED_TOKEN;

  if (!feedUrl || !feedToken) {
    return Response.json({ ok: false, message: "Google content feed is not configured." }, { status: 503 });
  }

  try {
    const body = await req.json();
    const url = String(body.url || "");
    const fileId = String(body.fileId || extractDriveId(url)).trim();
    const projectId = String(body.projectId || "").trim();

    if (!fileId) {
      return Response.json({ ok: false, message: "Could not determine the Google Drive file ID." }, { status: 400 });
    }

    const endpoint = new URL(feedUrl);
    endpoint.searchParams.set("token", feedToken);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "delete",
        fileId,
        projectId,
      }),
      cache: "no-store",
    });

    const raw = await response.text();
    let data: any = raw;
    try { data = JSON.parse(raw); } catch {}

    if (!response.ok || data?.ok === false) {
      return Response.json(
        { ok: false, message: data?.error || data?.message || "Delete failed.", details: data },
        { status: 502 }
      );
    }

    return Response.json({ ok: true, message: "Image moved to Google Drive Trash.", data });
  } catch (error) {
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "Delete failed." },
      { status: 500 }
    );
  }
}
