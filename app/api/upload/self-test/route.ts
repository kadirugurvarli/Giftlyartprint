export async function GET() {
  const feedUrl = process.env.CONTENT_FEED_URL;
  const feedToken = process.env.CONTENT_FEED_TOKEN;

  if (!feedUrl || !feedToken) {
    return Response.json(
      { ok: false, stage: "config", message: "CONTENT_FEED_URL or CONTENT_FEED_TOKEN is missing." },
      { status: 503 }
    );
  }

  try {
    const url = new URL(feedUrl);
    url.searchParams.set("token", feedToken);

    // 1x1 transparent PNG
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "upload",
        projectId: "UPLOAD-SELF-TEST",
        category: "Diagnostics",
        fileName: "giftly-upload-self-test.png",
        mimeType: "image/png",
        base64,
      }),
      redirect: "follow",
      cache: "no-store",
    });

    const raw = await response.text();
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {}

    return Response.json({
      ok: response.ok && typeof data === "object" && data !== null && (data as any).ok !== false,
      stage: "apps-script",
      upstreamStatus: response.status,
      upstreamUrl: response.url,
      upstream: data,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        stage: "network",
        message: error instanceof Error ? error.message : "Self-test failed.",
      },
      { status: 500 }
    );
  }
}
