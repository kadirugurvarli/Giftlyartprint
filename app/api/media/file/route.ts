import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req:NextRequest){
  const feedUrl=process.env.CONTENT_FEED_URL;
  const feedToken=process.env.CONTENT_FEED_TOKEN;
  const fileId=String(req.nextUrl.searchParams.get("fileId") || "").trim();

  if(!feedUrl || !feedToken){
    return new Response("Media feed is not configured.",{status:503});
  }

  if(!fileId){
    return new Response("fileId is required.",{status:400});
  }

  try{
    const url=new URL(feedUrl);
    url.searchParams.set("token",feedToken);
    url.searchParams.set("action","file");
    url.searchParams.set("fileId",fileId);

    const response=await fetch(url,{cache:"no-store"});
    const text=await response.text();

    let data:any={};
    try{
      data=text ? JSON.parse(text) : {};
    }catch{
      return new Response("Invalid media response.",{status:502});
    }

    if(!response.ok || data?.ok===false || !data?.base64){
      return new Response(
        data?.error || data?.message || "Media could not be loaded.",
        {status:response.ok ? 404 : response.status}
      );
    }

    const bytes=Buffer.from(data.base64,"base64");
    const mimeType=String(data.mimeType || "image/jpeg");

    return new Response(bytes,{
      status:200,
      headers:{
        "Content-Type":mimeType,
        "Content-Length":String(bytes.length),
        "Cache-Control":"private, max-age=300",
        "X-Content-Type-Options":"nosniff"
      }
    });
  }catch(error){
    return new Response(
      error instanceof Error ? error.message : "Media could not be loaded.",
      {status:500}
    );
  }
}
