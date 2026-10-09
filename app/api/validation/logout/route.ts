import {handleLogout} from "@/lib/mockup-v3/web/handlers";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const POST=(req:Request)=>handleLogout(req);
