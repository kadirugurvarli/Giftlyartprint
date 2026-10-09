import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import type {Env} from "./guard";

export const COOKIE_NAME="__Host-giftly-validation";
export const SESSION_SECONDS=12*3600;

const sha=(s:string)=>createHash("sha256").update(s).digest();

/** Constant-time password comparison (hash both sides so lengths never leak). */
export function passwordMatches(given:string,env:Env=process.env):boolean{
  const want=env.VALIDATION_PASSWORD;
  if(!want||typeof given!=="string") return false;
  return timingSafeEqual(sha(given),sha(want));
}

const b64=(b:Buffer)=>b.toString("base64url");

export function issueSession(env:Env=process.env,now=Date.now()):string{
  const secret=env.VALIDATION_SESSION_SECRET;
  if(!secret||secret.length<32) throw new Error("session secret not configured");
  const body=`${Math.floor(now/1000)+SESSION_SECONDS}.${b64(randomBytes(12))}`;
  const sig=b64(createHmac("sha256",secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token:string|undefined|null,env:Env=process.env,now=Date.now()):boolean{
  const secret=env.VALIDATION_SESSION_SECRET;
  if(!token||!secret||secret.length<32) return false;
  const parts=token.split(".");
  if(parts.length!==3) return false;
  const [exp,nonce,sig]=parts;
  const want=createHmac("sha256",secret).update(`${exp}.${nonce}`).digest();
  let got:Buffer;
  try{got=Buffer.from(sig,"base64url");}catch{return false;}
  if(got.length!==want.length||!timingSafeEqual(got,want)) return false;
  const e=Number(exp);
  return Number.isFinite(e)&&e*1000>now;
}

export function cookieHeader(token:string):string{
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}
export const clearCookieHeader=()=>`${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function readCookie(header:string|null|undefined,name=COOKIE_NAME):string|undefined{
  if(!header) return undefined;
  for(const part of header.split(";")){
    const i=part.indexOf("=");
    if(i>0&&part.slice(0,i).trim()===name) return part.slice(i+1).trim();
  }
  return undefined;
}

/**
 * Best-effort throttle for password attempts. State is per server instance (serverless instances do
 * not share memory), so this slows guessing but is NOT the primary protection: Vercel Authentication is.
 */
export class AttemptLimiter{
  private fails=new Map<string,{n:number;until:number;first:number}>();
  constructor(private max=5,private windowMs=10*60_000,private lockMs=15*60_000){}
  blocked(key:string,now=Date.now()){const f=this.fails.get(key);return !!f&&f.until>now;}
  fail(key:string,now=Date.now()){
    const f=this.fails.get(key);
    if(!f||now-f.first>this.windowMs){this.fails.set(key,{n:1,first:now,until:0});return;}
    f.n++;if(f.n>=this.max) f.until=now+this.lockMs;
  }
  ok(key:string){this.fails.delete(key);}
}
export const loginLimiter=new AttemptLimiter();
