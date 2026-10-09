import {NextResponse} from "next/server";
import type {NextRequest} from "next/server";

/**
 * Applies ONLY to the validation interface (see matcher). Everything else in the app, including all
 * V2 routes, is untouched. This is a cheap first gate; the route handlers repeat every check.
 */
export function middleware(req:NextRequest){
  const e=process.env;
  const on=e.VALIDATION_UI_ENABLED==="1" && (e.VERCEL_ENV==="preview" || (e.VALIDATION_ALLOW_LOCAL==="1" && !e.VERCEL_ENV && !e.VERCEL));
  if(!on) return new NextResponse("Not found",{status:404,headers:{"Cache-Control":"no-store"}});
  const res=NextResponse.next();
  res.headers.set("X-Robots-Tag","noindex, nofollow, noarchive");
  res.headers.set("Cache-Control","no-store, private");
  res.headers.set("X-Frame-Options","DENY");
  res.headers.set("Referrer-Policy","no-referrer");
  res.headers.set("X-Content-Type-Options","nosniff");
  void req;
  return res;
}
export const config={matcher:["/validation","/validation/:path*","/api/validation/:path*"]};
