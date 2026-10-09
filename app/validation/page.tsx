import {cookies,headers} from "next/headers";
import {notFound} from "next/navigation";
import {checkEnvironment} from "@/lib/mockup-v3/web/guard";
import {COOKIE_NAME,verifySession} from "@/lib/mockup-v3/web/auth";
import Login from "./Login";
import Studio from "./Studio";

export const dynamic="force-dynamic";
export const metadata={title:"Validation studio",robots:{index:false,follow:false,nocache:true}};

export default async function Page(){
  await headers();
  const g=checkEnvironment();
  if(!g.ok){
    if(g.status===404) notFound();
    return <main style={{font:"16px system-ui",padding:24,maxWidth:640}}><h1>Validation studio is not configured</h1><p>{g.reason}</p></main>;
  }
  const token=(await cookies()).get(COOKIE_NAME)?.value;
  return verifySession(token)?<Studio/>:<Login/>;
}
