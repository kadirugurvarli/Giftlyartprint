import {handleRun} from "@/lib/mockup-v3/web/handlers";
export const runtime="nodejs";
export const dynamic="force-dynamic";
/** Hobby-safe on both legacy (60 s) and Fluid compute (300 s) limits. */
export const maxDuration=60;
export const POST=(req:Request)=>handleRun(req);
