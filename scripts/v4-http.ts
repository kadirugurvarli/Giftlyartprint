import http from "node:http";

/** Shared hardening for the two LOCAL tools (annotation, studio). They bind to 127.0.0.1 only and are never deployed. */
export const CSP="default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export function securityHeaders():Record<string,string>{
  return {"Content-Security-Policy":CSP,"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Cache-Control":"no-store","Permissions-Policy":"camera=(), microphone=(), geolocation=()","Cross-Origin-Resource-Policy":"same-origin"};
}

export function hostAllowed(req:http.IncomingMessage,port:number):boolean{
  const h=(req.headers.host ?? "").toLowerCase();
  return h===`127.0.0.1:${port}`||h===`localhost:${port}`;
}
/** State-changing requests must come from the tool's own page (blocks cross-site and DNS-rebinding attempts). */
export function originAllowed(req:http.IncomingMessage,port:number):boolean{
  const o=req.headers.origin;
  if(o===undefined) return true; // same-origin fetches from the page or curl
  return o===`http://127.0.0.1:${port}`||o===`http://localhost:${port}`;
}

export function send(res:http.ServerResponse,status:number,body:string|Buffer,type="application/json; charset=utf-8",extra:Record<string,string>={}){
  res.writeHead(status,{"Content-Type":type,...securityHeaders(),...extra});
  res.end(body);
}
export const sendJson=(res:http.ServerResponse,status:number,obj:unknown)=>send(res,status,JSON.stringify(obj));

export class BodyTooLarge extends Error{}
export function readBody(req:http.IncomingMessage,limit:number):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const chunks:Buffer[]=[];let n=0;
    req.on("data",(c:Buffer)=>{n+=c.length;if(n>limit){reject(new BodyTooLarge());req.destroy();return;}chunks.push(c);});
    req.on("end",()=>resolve(Buffer.concat(chunks)));
    req.on("error",reject);
  });
}

/** Common front gate; returns false when it already answered. */
export function gate(req:http.IncomingMessage,res:http.ServerResponse,port:number):boolean{
  if(!hostAllowed(req,port)){sendJson(res,403,{ok:false,error:"HOST_NOT_ALLOWED"});return false;}
  if(req.method!=="GET"&&req.method!=="HEAD"&&!originAllowed(req,port)){sendJson(res,403,{ok:false,error:"ORIGIN_NOT_ALLOWED"});return false;}
  return true;
}
