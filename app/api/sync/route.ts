import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const feedUrl = process.env.CONTENT_FEED_URL;
  const feedToken = process.env.CONTENT_FEED_TOKEN;

  if (!feedUrl) {
    return Response.json({ok:false,configured:false,message:"Google content feed is not configured yet."},{status:503});
  }

  try {
    const url = new URL(feedUrl);
    url.searchParams.set("action","sync");
    if (feedToken) url.searchParams.set("token", feedToken);
    const response = await fetch(url, { cache:"no-store" });
    const text = await response.text();
    return Response.json({ok:response.ok,status:response.status,message:response.ok?"Sync completed.":text || "Sync failed."},{status:response.ok?200:502});
  } catch (error) {
    return Response.json({ok:false,message:error instanceof Error?error.message:"Sync failed."},{status:500});
  }
}
