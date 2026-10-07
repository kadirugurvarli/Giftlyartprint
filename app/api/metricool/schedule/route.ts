import {NextRequest} from "next/server";

const BLOG_ID=process.env.METRICOOL_BLOG_ID || "6192580";
const USER_ID=process.env.METRICOOL_USER_ID || "4775284";
const TIMEZONE="Europe/London";

export async function POST(req:NextRequest){
  const token=process.env.METRICOOL_USER_TOKEN;
  if(!token){
    return Response.json({
      ok:false,
      configured:false,
      message:"Metricool API connection required. Add METRICOOL_USER_TOKEN in Vercel."
    },{status:503});
  }

  try{
    const body=await req.json();
    const text=String(body.text||"").trim();
    const providers=Array.isArray(body.providers)?body.providers:[];
    const publicationDate=body.publicationDate;

    if(!text || providers.length===0 || !publicationDate){
      return Response.json({ok:false,message:"Text, publication date and at least one provider are required."},{status:400});
    }

    const payload={
      publicationDate:{
        dateTime:publicationDate,
        timezone:TIMEZONE
      },
      text,
      providers:providers.map((network:string)=>({network})),
      autoPublish:true
    };

    const url=new URL("https://app.metricool.com/api/v2/scheduler/posts");
    url.searchParams.set("blogId",BLOG_ID);
    url.searchParams.set("userId",USER_ID);

    const response=await fetch(url,{
      method:"POST",
      headers:{
        "X-Mc-Auth":token,
        "Content-Type":"application/json"
      },
      body:JSON.stringify(payload),
      cache:"no-store"
    });

    const raw=await response.text();
    let data:any=raw;
    try{data=JSON.parse(raw)}catch{}

    if(!response.ok){
      return Response.json({ok:false,message:"Metricool rejected the post.",details:data},{status:response.status});
    }

    return Response.json({ok:true,message:"Post scheduled in Metricool.",data});
  }catch(error){
    return Response.json({ok:false,message:error instanceof Error?error.message:"Metricool scheduling failed."},{status:500});
  }
}
