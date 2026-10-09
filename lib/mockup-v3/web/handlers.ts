import sharp from "sharp";
import {checkEnvironment,type Env} from "./guard";
import {clearCookieHeader,cookieHeader,issueSession,loginLimiter,passwordMatches,readCookie,verifySession} from "./auth";
import {MAX_PIXELS,MAX_SIDE,REQUEST_LIMIT_BYTES} from "./limits";
import {HintError,parseHint} from "./hint";
import {runWeb} from "./run";
import {packFrame} from "./frame";

export const SECURITY_HEADERS={
  "Cache-Control":"no-store, private, max-age=0",
  "X-Robots-Tag":"noindex, nofollow, noarchive",
  "X-Content-Type-Options":"nosniff",
  "X-Frame-Options":"DENY",
  "Referrer-Policy":"no-referrer",
  "Cross-Origin-Resource-Policy":"same-origin"
} as const;

const json=(status:number,body:unknown,extra:Record<string,string>={})=>
  new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json",...SECURITY_HEADERS,...extra}});

function guardResponse(env:Env):Response|null{
  const g=checkEnvironment(env);
  if(g.ok) return null;
  // 404 hides the interface entirely when disabled / not a preview; 503 explains misconfiguration to the owner
  return g.status===404?new Response("Not found",{status:404,headers:SECURITY_HEADERS}):json(503,{error:g.reason,code:g.code});
}

/** CSRF: browsers always send Origin on POST; it must match the host the request was made to. */
function sameOrigin(req:Request):boolean{
  const origin=req.headers.get("origin");
  if(!origin) return false;
  try{return new URL(origin).host===(req.headers.get("x-forwarded-host") ?? req.headers.get("host"));}catch{return false;}
}

export function isAuthenticated(req:Request,env:Env):boolean{
  return verifySession(readCookie(req.headers.get("cookie")),env);
}

const clientKey=(req:Request)=>(req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();

export async function handleLogin(req:Request,env:Env=process.env):Promise<Response>{
  const g=guardResponse(env);if(g) return g;
  if(!sameOrigin(req)) return json(403,{error:"Cross-site request refused."});
  const key=clientKey(req);
  if(loginLimiter.blocked(key)) return json(429,{error:"Too many attempts. Try again later."});
  let pw="";
  try{const b=await req.json();pw=typeof b?.password==="string"?b.password.slice(0,200):"";}catch{/* empty */}
  if(!passwordMatches(pw,env)){loginLimiter.fail(key);return json(401,{error:"Wrong password."});}
  loginLimiter.ok(key);
  return json(200,{ok:true},{"Set-Cookie":cookieHeader(issueSession(env))});
}

export async function handleLogout(req:Request,env:Env=process.env):Promise<Response>{
  const g=guardResponse(env);if(g) return g;
  if(!sameOrigin(req)) return json(403,{error:"Cross-site request refused."});
  return json(200,{ok:true},{"Set-Cookie":clearCookieHeader()});
}

let busy=0;
const JPEG_MAGIC=[0xff,0xd8,0xff];
const isJpeg=(b:Buffer)=>JPEG_MAGIC.every((v,i)=>b[i]===v);

async function readImage(v:FormDataEntryValue|null,what:string){
  if(!(v instanceof File)) throw new HintError(`${what} image is missing`);
  const buf=Buffer.from(await v.arrayBuffer());
  if(!isJpeg(buf)) throw new HintError(`${what} must be a JPEG (the page converts photos automatically)`);
  const m=await sharp(buf).metadata();
  if(!m.width||!m.height||m.width*m.height>MAX_PIXELS||Math.max(m.width,m.height)>MAX_SIDE) throw new HintError(`${what} image is too large in pixels`);
  return buf;
}

export async function handleRun(req:Request,env:Env=process.env):Promise<Response>{
  const g=guardResponse(env);if(g) return g;
  if(!sameOrigin(req)) return json(403,{error:"Cross-site request refused."});
  if(!isAuthenticated(req,env)) return json(401,{error:"Please sign in."});
  const len=Number(req.headers.get("content-length"));
  if(!Number.isFinite(len)||len<=0) return json(411,{error:"Content-Length required."});
  if(len>REQUEST_LIMIT_BYTES) return json(413,{error:"The upload is too large for the preview's request limit. The page should have shrunk it; refresh and try again."});
  if(!(req.headers.get("content-type")??"").startsWith("multipart/form-data")) return json(415,{error:"multipart/form-data expected."});
  if(busy>=1) return json(429,{error:"A mockup is already being generated. Wait for it to finish."});
  busy++;
  try{
    const form=await req.formData();
    const mode=form.get("mode"),level=form.get("level");
    if(mode!=="artwork-in-frame"&&mode!=="framed-on-wall") throw new HintError("mode must be artwork-in-frame or framed-on-wall");
    if(level!=="strict"&&level!=="environment"&&level!=="photographic") throw new HintError("unknown realism level");
    const source=await readImage(form.get("source"),"Source");
    const reference=await readImage(form.get("reference"),"Reference");
    const parseMeta=(k:string)=>{
      const raw=form.get(k);if(typeof raw!=="string"||raw.length>2000) throw new HintError(`${k} missing`);
      let o:unknown;try{o=JSON.parse(raw);}catch{throw new HintError(`${k} is not valid JSON`);}
      return parseHint(o);
    };
    const sourceHint=parseMeta("sourceMeta"),referenceHint=parseMeta("referenceMeta");
    const optNum=(k:string,min:number,max:number)=>{
      const v=form.get(k);if(v===null||v==="") return undefined;
      const n=Number(v);if(!Number.isFinite(n)||n<min||n>max) throw new HintError(`${k} is out of range`);return n;
    };
    const pieceWidthCm=optNum("pieceWidthCm",5,400),ceilingHeightCm=optNum("ceilingHeightCm",150,600);
    const r=await runWeb({mode,level,source,reference,sourceHint,referenceHint,pieceWidthCm,ceilingHeightCm});
    if(!r.mockup) return json(422,{error:"No mockup could be produced.",report:r.report});
    const body=packFrame({report:r.report},{bytes:r.mockup,type:"image/jpeg"},r.overlay?{bytes:r.overlay,type:"image/jpeg"}:null);
    return new Response(new Uint8Array(body),{status:200,headers:{"Content-Type":"application/octet-stream",...SECURITY_HEADERS}});
  }catch(e){
    if(e instanceof HintError) return json(400,{error:e.message});
    // never log messages or inputs: only the error class
    console.error("validation-run failed:",(e as Error)?.name ?? "Error");
    return json(500,{error:"The engine could not process these images."});
  }finally{busy--;}
}
