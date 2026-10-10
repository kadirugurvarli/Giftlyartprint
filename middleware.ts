import {NextResponse} from "next/server";
import type {NextRequest} from "next/server";
import {allowedHosts,normaliseHost} from "./lib/mockup-v3/web/guard";
import {buildCsp,STATIC_SECURITY_HEADERS} from "./lib/mockup-v3/web/headers";

/**
 * Applies ONLY to the validation interface (see matcher). Everything else in the app, including all
 * V2 routes, is untouched. First gate: hidden (404) unless this is an enabled Preview and the visitor used
 * a hostname that was explicitly confirmed to be behind Vercel Authentication. The route handlers and the
 * page repeat every check.
 */
export function middleware(req:NextRequest){
  const e=process.env;
  const on=e.VALIDATION_UI_ENABLED==="1" && (e.VERCEL_ENV==="preview" || (e.VALIDATION_ALLOW_LOCAL==="1" && !e.VERCEL_ENV && !e.VERCEL));
  const hosts=allowedHosts(e);
  // when the allowlist is empty the page itself explains the misconfiguration (it still serves nothing sensitive)
  const hostOk=hosts.length===0 || hosts.includes(normaliseHost(req.headers.get("host")));
  if(!on || !hostOk) return new NextResponse("Not found",{status:404,headers:{"Cache-Control":"no-store"}});
  const nonce=btoa(crypto.randomUUID());
  const csp=buildCsp(nonce);
  const reqHeaders=new Headers(req.headers);
  reqHeaders.set("x-nonce",nonce);
  reqHeaders.set("Content-Security-Policy",csp);
  const res=NextResponse.next({request:{headers:reqHeaders}});
  res.headers.set("Content-Security-Policy",csp);
  for(const [k,v] of Object.entries(STATIC_SECURITY_HEADERS)) res.headers.set(k,v);
  return res;
}

export const config={matcher:[
  {source:"/validation",missing:[{type:"header",key:"next-router-prefetch"},{type:"header",key:"purpose",value:"prefetch"}]},
  "/validation/:path*","/api/validation/:path*"
]};
