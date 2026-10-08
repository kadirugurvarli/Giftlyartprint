import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const fallback = [{
  id: "GAP-0003",
  title: "Decorative Plate & Object Framing",
  category: "Bespoke Framing",
  status: "Ready",
  platforms: ["Instagram","Facebook","Google Business"],
  website: true,
  format: "Square / Carousel-ready",
  caption: "A recent bespoke framing project completed in our Maidstone studio.\n\nThis decorative plate was presented in a black wooden box frame, giving the piece enough depth to sit securely while keeping the focus on its colour, texture and character.\n\nHave something unusual or special that you would like framed? Send us a photo for a quote.",
  source: "fallback"
}];

export async function GET(req: NextRequest) {
  const feedUrl = process.env.CONTENT_FEED_URL;
  const feedToken = process.env.CONTENT_FEED_TOKEN;

  if (!feedUrl) {
    return Response.json({
      configured: false,
      source: "fallback",
      items: fallback,
      message: "Google content feed is not configured yet."
    });
  }

  try {
    const url = new URL(feedUrl);
    if (feedToken) url.searchParams.set("token", feedToken);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const data = await response.json();

    const mediaUrl = new URL(feedUrl);
    if (feedToken) mediaUrl.searchParams.set("token", feedToken);
    mediaUrl.searchParams.set("action", "media");

    let mediaByProject: Record<string, string[]> = {};
    let mediaLibrary: any[] = [];
    try {
      const mediaResponse = await fetch(mediaUrl, { cache: "no-store" });
      if (mediaResponse.ok) {
        const mediaData = await mediaResponse.json();
        mediaByProject = mediaData?.mediaByProject ?? {};
        mediaLibrary = Array.isArray(mediaData?.media)
          ? mediaData.media.map((entry:any)=>({
              ...entry,
              url:entry?.fileId
                ? `/api/media/file?fileId=${encodeURIComponent(entry.fileId)}`
                : (entry?.url || entry?.thumbnailUrl || "")
            }))
          : [];
      }
    } catch {}

    const rawItems = Array.isArray(data) ? data : (data.items ?? []);
    const items = rawItems.map((item: any) => {
      const rawMedia = Array.isArray(mediaByProject[item.id])
        ? mediaByProject[item.id]
        : (item.media ?? []);

      const media = rawMedia
        .map((entry: any) =>
          typeof entry === "string"
            ? entry
            : entry?.url || entry?.thumbnailUrl || ""
        )
        .filter(Boolean);

      return {
        ...item,
        media,
      };
    });

    return Response.json({
      configured: true,
      source: "google-drive",
      items,
      mediaLibrary,
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    return Response.json({
      configured: true,
      source: "fallback",
      items: fallback,
      warning: error instanceof Error ? error.message : "Unable to sync content feed"
    }, { status: 200 });
  }
}
