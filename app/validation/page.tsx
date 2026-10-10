import {headers} from "next/headers";
import {notFound} from "next/navigation";
import {decidePage} from "@/lib/mockup-v3/web/page-guard";
import Studio from "./Studio";

export const dynamic="force-dynamic";
export const metadata={title:"Validation studio",description:"Private image-placement test tool",robots:{index:false,follow:false,nocache:true},icons:{icon:"data:,"}};

/** No application password: Vercel Authentication is the gate; this page repeats the Preview/host/credential checks. */
export default async function Page(){
  const h=await headers();
  const d=decidePage(process.env,h.get("host"));
  if(d.kind==="notFound") notFound();
  if(d.kind==="message") return <main className="v3-msg"><h1>Validation studio is not configured</h1><p>{d.text}</p></main>;
  return <Studio/>;
}
