import {describe,expect,it,vi,afterEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {checkEnvironment,PRODUCTION_SECRET_NAMES} from "@/lib/mockup-v3/web/guard";
import {AttemptLimiter,COOKIE_NAME,cookieHeader,issueSession,passwordMatches,readCookie,verifySession} from "@/lib/mockup-v3/web/auth";
import {HintError,parseHint} from "@/lib/mockup-v3/web/hint";
import {extractHint,findExifSegment,resizeCandidates} from "@/lib/mockup-v3/web/client/jpeg-exif";
import {handleLogin,handleLogout,handleRun,isAuthenticated} from "@/lib/mockup-v3/web/handlers";
import {unpackFrame} from "@/lib/mockup-v3/web/frame";
import {buildFeedback} from "@/lib/mockup-v3/web/client/feedback";
import {middleware,config} from "@/middleware";
import {NextRequest} from "next/server";
import {GOOD_ENV,ORIGIN,jpegOf,postForm,sampleUpload} from "./helpers";

const hint=(w:number,h:number)=>JSON.stringify({originalWidth:w,originalHeight:h,focalLength35mm:26});
const cookieFor=(env=GOOD_ENV)=>`${COOKIE_NAME}=${issueSession(env)}`;

describe("environment guard (fail closed)",()=>{
  it("runs only on an enabled Preview with both secrets",()=>{
    expect(checkEnvironment(GOOD_ENV).ok).toBe(true);
  });
  it.each([
    ["not enabled",{...GOOD_ENV,VALIDATION_UI_ENABLED:undefined},404],
    ["production",{...GOOD_ENV,VERCEL_ENV:"production"},404],
    ["development deployment",{...GOOD_ENV,VERCEL_ENV:"development"},404],
    ["no VERCEL_ENV at all",{...GOOD_ENV,VERCEL_ENV:undefined},404],
    ["short password",{...GOOD_ENV,VALIDATION_PASSWORD:"short"},503],
    ["no session secret",{...GOOD_ENV,VALIDATION_SESSION_SECRET:undefined},503],
    ["weak session secret",{...GOOD_ENV,VALIDATION_SESSION_SECRET:"x".repeat(10)},503]
  ])("refuses: %s",(_n,env,status)=>{
    const g=checkEnvironment(env as any);
    expect(g.ok).toBe(false);if(!g.ok) expect(g.status).toBe(status);
  });
  it("refuses to run next to any production credential, naming the variable but never its value",()=>{
    for(const name of PRODUCTION_SECRET_NAMES){
      const g=checkEnvironment({...GOOD_ENV,[name]:"super-secret-value-123"});
      expect(g.ok,name).toBe(false);
      if(!g.ok){expect(g.code).toBe("PRODUCTION_SECRETS_VISIBLE");expect(g.reason).toContain(name);expect(g.reason).not.toContain("super-secret");}
    }
  });
  it("the local-development escape hatch never works on Vercel",()=>{
    const local={...GOOD_ENV,VERCEL_ENV:undefined,VALIDATION_ALLOW_LOCAL:"1"};
    expect(checkEnvironment(local as any).ok).toBe(true);
    expect(checkEnvironment({...local,VERCEL:"1"} as any).ok).toBe(false);
    expect(checkEnvironment({...local,VERCEL_ENV:"production"} as any).ok).toBe(false);
  });
});

describe("password and session",()=>{
  it("compares passwords in constant time and rejects wrong/empty",()=>{
    expect(passwordMatches("correct horse battery",GOOD_ENV)).toBe(true);
    expect(passwordMatches("correct horse batterY",GOOD_ENV)).toBe(false);
    expect(passwordMatches("",GOOD_ENV)).toBe(false);
    expect(passwordMatches("x",{})).toBe(false);
  });
  it("sessions: valid, tampered, expired, wrong secret, malformed all handled",()=>{
    const t=issueSession(GOOD_ENV,1_000_000);
    expect(verifySession(t,GOOD_ENV,1_000_000+1000)).toBe(true);
    expect(verifySession(t,GOOD_ENV,1_000_000+13*3600*1000)).toBe(false); // 12h expiry
    const [exp,n,s]=t.split(".");
    expect(verifySession(`${Number(exp)+99999}.${n}.${s}`,GOOD_ENV,1_000_000)).toBe(false);
    expect(verifySession(`${exp}.${n}.${s.slice(0,-2)}AA`,GOOD_ENV,1_000_000)).toBe(false);
    expect(verifySession(t,{...GOOD_ENV,VALIDATION_SESSION_SECRET:"z".repeat(40)},1_000_000)).toBe(false);
    for(const bad of ["","a.b","a.b.c.d",undefined,null,"..."]) expect(verifySession(bad as any,GOOD_ENV)).toBe(false);
    expect(()=>issueSession({})).toThrow();
  });
  it("cookie is host-locked, HttpOnly, Secure, SameSite=Strict",()=>{
    const c=cookieHeader("tok");
    expect(c).toMatch(/^__Host-/);for(const a of ["HttpOnly","Secure","SameSite=Strict","Path=/"]) expect(c).toContain(a);
    expect(c).not.toMatch(/Domain=/i);
    expect(readCookie("a=1; __Host-giftly-validation=abc; b=2")).toBe("abc");
  });
  it("lockout after repeated failures, reset on success",()=>{
    const l=new AttemptLimiter(3,60_000,120_000);
    l.fail("ip",0);l.fail("ip",1);expect(l.blocked("ip",2)).toBe(false);
    l.fail("ip",3);expect(l.blocked("ip",4)).toBe(true);expect(l.blocked("ip",130_000)).toBe(false);
    l.fail("o",0);l.ok("o");l.fail("o",1);l.fail("o",2);expect(l.blocked("o",3)).toBe(false);
  });
});

describe("login/logout endpoints",()=>{
  const login=(body:unknown,headers:Record<string,string>={})=>handleLogin(new Request(`${ORIGIN}/api/validation/login`,{method:"POST",body:JSON.stringify(body),headers:{origin:ORIGIN,host:new URL(ORIGIN).host,"x-forwarded-for":"9.9.9.9",...headers}}),GOOD_ENV);
  it("wrong password 401 without cookie; right password sets a verifiable cookie",async()=>{
    const bad=await login({password:"nope nope nope"});
    expect(bad.status).toBe(401);expect(bad.headers.get("set-cookie")).toBeNull();
    const ok=await login({password:GOOD_ENV.VALIDATION_PASSWORD},{"x-forwarded-for":"8.8.8.8"});
    expect(ok.status).toBe(200);
    const c=ok.headers.get("set-cookie")!;
    expect(verifySession(readCookie(c.split(";")[0]),GOOD_ENV)).toBe(true);
    expect(ok.headers.get("cache-control")).toContain("no-store");
  });
  it("cross-site login/logout is refused; a disabled deployment returns 404",async()=>{
    expect((await login({password:GOOD_ENV.VALIDATION_PASSWORD},{origin:"https://evil.example"})).status).toBe(403);
    const r=new Request(`${ORIGIN}/api/validation/login`,{method:"POST",body:"{}",headers:{host:new URL(ORIGIN).host}}); // no Origin header
    expect((await handleLogin(r,GOOD_ENV)).status).toBe(403);
    expect((await handleLogin(r,{...GOOD_ENV,VERCEL_ENV:"production"})).status).toBe(404);
    expect((await handleLogout(new Request(`${ORIGIN}/x`,{method:"POST",headers:{origin:"https://evil.example",host:new URL(ORIGIN).host}}),GOOD_ENV)).status).toBe(403);
  });
  it("brute force is throttled",async()=>{
    for(let i=0;i<5;i++) await login({password:"wrong wrong wrong"},{"x-forwarded-for":"7.7.7.7"});
    expect((await login({password:GOOD_ENV.VALIDATION_PASSWORD},{"x-forwarded-for":"7.7.7.7"})).status).toBe(429);
  });
});

describe("hint (camera metadata) is whitelisted; GPS can never pass",()=>{
  it("accepts camera facts only",()=>{
    expect(parseHint({originalWidth:4000,originalHeight:3000,focalLength35mm:26,make:"Apple",model:"iPhone 15"})).toMatchObject({focalLength35mm:26});
  });
  it.each([
    [{originalWidth:4000,originalHeight:3000,GPSLatitude:51.2}],
    [{originalWidth:4000,originalHeight:3000,gps:{lat:1}}],
    [{originalWidth:4000,originalHeight:3000,latitude:51}],
    [{originalWidth:4000,originalHeight:3000,dateTimeOriginal:"2025:01:01"}],
    [{originalWidth:4000,originalHeight:3000,make:"A".repeat(200)}],
    [{originalWidth:4000,originalHeight:3000,make:"café \u{1F4CD}"}],
    [{originalWidth:"4000",originalHeight:3000}],[{originalHeight:3000}],[null],[[]],["x"]
  ])("rejects %j",(raw)=>{expect(()=>parseHint(raw)).toThrow(HintError);});
  it("the browser-side extractor reads camera facts and never GPS or dates",async()=>{
    const img=await sharp({create:{width:64,height:48,channels:3,background:"#888"}})
      .withExif({IFD0:{Make:"TestCam",Model:"P1"},IFD2:{FocalLengthIn35mmFilm:"26",FocalLength:"6/1",DateTimeOriginal:"2025:03:01 10:00:00"},
        IFD3:{GPSLatitudeRef:"N",GPSLatitude:"51/1 16/1 30/1",GPSLongitudeRef:"E",GPSLongitude:"0/1 31/1 12/1"}}).jpeg().toBuffer();
    const bytes=new Uint8Array(img);
    expect(findExifSegment(bytes)).not.toBeNull();
    const h=extractHint(bytes,{width:64,height:48});
    expect(h).toMatchObject({make:"TestCam",model:"P1",focalLength35mm:26,focalLengthMm:6,originalWidth:64,originalHeight:48});
    const s=JSON.stringify(h);
    expect(s).not.toMatch(/gps|latitude|longitude|51|2025|DateTime/i);
    expect(()=>parseHint(h)).not.toThrow();
    expect(extractHint(new Uint8Array([1,2,3]),{width:5,height:5})).toEqual({originalWidth:5,originalHeight:5}); // not a JPEG
  });
  it("survives corrupted/truncated EXIF without throwing, and the result still passes the server whitelist",async()=>{
    const img=await sharp({create:{width:64,height:48,channels:3,background:"#888"}}).withExif({IFD0:{Make:"TestCam"},IFD2:{FocalLengthIn35mmFilm:"26"},IFD3:{GPSLatitudeRef:"N",GPSLatitude:"51/1 16/1 30/1"}}).jpeg().toBuffer();
    let seed=5;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let n=0;n<300;n++){
      const b=new Uint8Array(img);
      const k=1+Math.floor(rnd()*6);
      for(let j=0;j<k;j++) b[2+Math.floor(rnd()*Math.min(b.length-2,320))]=Math.floor(rnd()*256);
      const cut=rnd()<0.2?b.subarray(0,Math.floor(rnd()*b.length)):b;
      const h=extractHint(cut,{width:64,height:48});
      expect(()=>parseHint(h)).not.toThrow();
      expect(JSON.stringify(h)).not.toMatch(/gps|latitude/i);
    }
  });
  it("resize candidates keep proportions, never upscale, and only get smaller",()=>{
    const c=resizeCandidates(4032,3024,3600);
    expect(c[0].width).toBeLessThanOrEqual(3600);
    for(const x of c) expect(Math.abs(x.width/x.height-4032/3024)).toBeLessThan(0.01);
    expect(resizeCandidates(1000,500,3600)[0].width).toBe(1000);
    for(let i=4;i<c.length;i++) expect(c[i].width).toBeLessThanOrEqual(c[i-4].width);
  });
});

describe("run endpoint",()=>{
  const url=`${ORIGIN}/api/validation/run`;
  it("hidden entirely when disabled or not Preview; explains misconfiguration only to the owner",async()=>{
    const f=await postForm(url,{mode:"artwork-in-frame"});
    for(const env of [{...GOOD_ENV,VERCEL_ENV:"production"},{...GOOD_ENV,VALIDATION_UI_ENABLED:undefined}]) expect((await handleRun(f.clone(),env as any)).status).toBe(404);
    expect((await handleRun(f.clone(),{...GOOD_ENV,CONTENT_FEED_TOKEN:"x"})).status).toBe(503);
  });
  it("401 without a valid session, 403 cross-site, 411/413/415 on bad framing",async()=>{
    const base={mode:"artwork-in-frame"};
    expect((await handleRun(await postForm(url,base),GOOD_ENV)).status).toBe(401);
    expect((await handleRun(await postForm(url,base,{cookie:`${COOKIE_NAME}=forged.token.sig`}),GOOD_ENV)).status).toBe(401);
    expect((await handleRun(await postForm(url,base,{cookie:cookieFor(),origin:"https://evil.example"}),GOOD_ENV)).status).toBe(403);
    expect((await handleRun(await postForm(url,base,{cookie:cookieFor(),"content-length":"99999999"}),GOOD_ENV)).status).toBe(413);
    const noLen=new Request(url,{method:"POST",body:"x",headers:{cookie:cookieFor(),origin:ORIGIN,host:new URL(ORIGIN).host}});
    expect((await handleRun(noLen,GOOD_ENV)).status).toBe(411);
    const wrongType=new Request(url,{method:"POST",body:"{}",headers:{cookie:cookieFor(),origin:ORIGIN,host:new URL(ORIGIN).host,"content-length":"2","content-type":"application/json"}});
    expect((await handleRun(wrongType,GOOD_ENV)).status).toBe(415);
  });
  it("400 on non-JPEG, GPS in metadata, bad mode/level, absurd sizes",async()=>{
    const {source,reference}=await sampleUpload();
    const ok={mode:"artwork-in-frame",level:"environment",source,reference,sourceMeta:hint(640,480),referenceMeta:hint(1600,1200)};
    const go=async(over:Record<string,any>)=>handleRun(await postForm(url,{...ok,...over},{cookie:cookieFor()}),GOOD_ENV);
    expect((await go({source:Buffer.from("<html>not an image</html>")})).status).toBe(400);
    expect((await go({source:await sharp(source).png().toBuffer()})).status).toBe(400);
    const gps=await go({sourceMeta:JSON.stringify({originalWidth:640,originalHeight:480,GPSLatitude:51.2})});
    expect(gps.status).toBe(400);expect(JSON.stringify(await gps.json())).not.toContain("51.2");
    expect((await go({mode:"rm -rf"})).status).toBe(400);
    expect((await go({level:"ultra"})).status).toBe(400);
    expect((await go({sourceMeta:"{not json"})).status).toBe(400);
    expect((await go({mode:"framed-on-wall",pieceWidthCm:"99999"})).status).toBe(400);
    const huge=await sharp({create:{width:5000,height:5000,channels:3,background:"#999"}}).jpeg({quality:1}).toBuffer();
    expect((await go({source:huge})).status).toBe(400);
  },60000);
});

describe("end to end through the web layer (stateless, clean outputs, no leakage)",()=>{
  afterEach(()=>vi.restoreAllMocks());
  it("produces a mockup with no metadata, writes nothing to disk, logs nothing sensitive",async()=>{
    const {source,reference,srcDims,refDims}=await sampleUpload();
    const SECRET_NAME="IMG_SECRET_CUSTOMER_NAME.jpg";
    const writes:string[]=[];
    const spies=[
      vi.spyOn(fs,"writeFileSync").mockImplementation((...a:any[])=>{writes.push(String(a[0]));}),
      vi.spyOn(fs,"appendFileSync").mockImplementation((...a:any[])=>{writes.push(String(a[0]));}),
      vi.spyOn(fs,"createWriteStream").mockImplementation(((...a:any[])=>{writes.push(String(a[0]));throw new Error("no writes");}) as any),
      vi.spyOn(fs,"mkdirSync").mockImplementation((...a:any[])=>{writes.push(String(a[0]));return undefined as any;}),
      vi.spyOn(fs.promises,"writeFile").mockImplementation(async(...a:any[])=>{writes.push(String(a[0]));}),
      vi.spyOn(fs.promises,"appendFile").mockImplementation(async(...a:any[])=>{writes.push(String(a[0]));}),
      vi.spyOn(fs.promises,"mkdir").mockImplementation(async(...a:any[])=>{writes.push(String(a[0]));return undefined;})
    ];
    const logs:string[]=[];
    for(const m of ["log","info","warn","error","debug"] as const) vi.spyOn(console,m).mockImplementation((...a:any[])=>{logs.push(a.map(String).join(" "));});

    const req=await postForm(`${ORIGIN}/api/validation/run`,{
      mode:"artwork-in-frame",level:"environment",source,reference,
      sourceMeta:JSON.stringify({originalWidth:srcDims[0],originalHeight:srcDims[1],focalLength35mm:28,make:"TestCam",model:"P1"}),
      referenceMeta:JSON.stringify({originalWidth:refDims[0],originalHeight:refDims[1],focalLength35mm:26})
    },{cookie:cookieFor()},SECRET_NAME);
    const res=await handleRun(req,GOOD_ENV);
    spies.forEach((s)=>s.mockRestore());
    expect(res.status).toBe(200);
    for(const [k,v] of Object.entries({"cache-control":"no-store","x-robots-tag":"noindex","x-frame-options":"DENY"})) expect(res.headers.get(k)).toContain(v);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const buf=new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBeLessThan(4_300_000+4096);
    const {header,mockup,overlay}=unpackFrame(buf);
    const rep:any=header.report;
    expect(rep.status).toBe("pass");
    expect(rep.level).toBe("environment");
    expect(rep.qa.productPixelsModified).toBe(false);
    expect(rep.input.sourceFocal.from).toBe("35mm-equivalent");
    // outputs are clean JPEGs with no metadata of any kind
    for(const img of [mockup,overlay!]){
      const m=await sharp(Buffer.from(img)).metadata();
      expect(m.format).toBe("jpeg");expect(m.exif).toBeUndefined();expect(m.xmp).toBeUndefined();expect(m.iptc).toBeUndefined();
    }
    const raw=Buffer.from(mockup).toString("latin1");
    expect(raw).not.toMatch(/Exif|GPS|TestCam/);
    // the report never carries file names or location
    const json=JSON.stringify(header);
    expect(json).not.toContain(SECRET_NAME);expect(json).not.toMatch(/GPS|latitude|longitude/i);
    // stateless: nothing written anywhere, nothing logged
    expect(writes).toEqual([]);
    expect(logs.join("\n")).not.toContain(SECRET_NAME);
    expect(logs.length).toBe(0);
    // feedback export carries numbers only
    const fb=buildFeedback({mode:"artwork-in-frame",level:"environment",verdict:"good",ratings:{placement:5},defectsSeen:[],notes:"fine"},rep,"abc12345");
    const fbj=JSON.stringify(fb);
    expect(fbj).not.toContain(SECRET_NAME);expect(fbj).not.toMatch(/data:image|base64/);
    expect(fb.ratings.placement).toBe(5);expect(fb.ratings.shadow).toBeNull();
  },120000);

  it("only one generation at a time (protects memory on a small instance)",async()=>{
    const {source,reference,srcDims,refDims}=await sampleUpload();
    const mk=async()=>handleRun(await postForm(`${ORIGIN}/api/validation/run`,{mode:"artwork-in-frame",level:"strict",source,reference,sourceMeta:hint(srcDims[0],srcDims[1]),referenceMeta:hint(refDims[0],refDims[1])},{cookie:cookieFor()}),GOOD_ENV);
    const [a,b]=await Promise.all([mk(),mk()]);
    expect([a.status,b.status].sort()).toEqual([200,429]);
  },120000);

  it("isAuthenticated reflects the cookie",()=>{
    expect(isAuthenticated(new Request(ORIGIN,{headers:{cookie:cookieFor()}}),GOOD_ENV)).toBe(true);
    expect(isAuthenticated(new Request(ORIGIN),GOOD_ENV)).toBe(false);
  });
});

describe("middleware scope",()=>{
  it("covers only the validation interface, never V2 routes",()=>{
    expect(config.matcher).toEqual(["/validation","/validation/:path*","/api/validation/:path*"]);
    for(const m of config.matcher) expect(m).not.toMatch(/api\/(content|media|upload|sync|metricool|health)/);
  });
  it("404 unless Preview+enabled; adds noindex headers when on",()=>{
    const saved={...process.env};
    try{
      for(const k of ["VERCEL_ENV","VALIDATION_UI_ENABLED","VALIDATION_ALLOW_LOCAL","VERCEL"]) delete process.env[k];
      const req=()=>new NextRequest("https://x.vercel.app/validation");
      expect(middleware(req()).status).toBe(404);
      process.env.VALIDATION_UI_ENABLED="1";process.env.VERCEL_ENV="production";
      expect(middleware(req()).status).toBe(404);
      process.env.VERCEL_ENV="preview";
      const r=middleware(req());expect(r.status).toBe(200);
      expect(r.headers.get("x-robots-tag")).toContain("noindex");expect(r.headers.get("x-frame-options")).toBe("DENY");
    }finally{for(const k of Object.keys(process.env)) if(!(k in saved)) delete process.env[k];Object.assign(process.env,saved);}
  });
});

describe("static guarantees about the validation code",()=>{
  const roots=["lib/mockup-v3/web","app/validation","app/api/validation","middleware.ts"].map((p)=>path.resolve(__dirname,"../..",p));
  const files:string[]=[];
  const walk=(p:string)=>{if(fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach((f)=>walk(path.join(p,f)));else if(/\.(ts|tsx)$/.test(p)) files.push(p);};
  roots.forEach(walk);
  const src=(f:string)=>fs.readFileSync(f,"utf8");
  it("finds the files",()=>{expect(files.length).toBeGreaterThan(10);});
  it("never touches production credentials or the V2 code",()=>{
    for(const f of files){
      if(f.endsWith(path.join("web","guard.ts"))) continue; // the guard lists the names to REFUSE them
      const s=src(f);
      for(const n of PRODUCTION_SECRET_NAMES) expect(s,`${f} reads ${n}`).not.toContain(n);
      expect(s,f).not.toMatch(/giftly-v2|from ["']@\/app\/(?!validation)/);
    }
  });
  it("is stateless: no storage SDKs, no file writes, no fetch to other hosts, no analytics",()=>{
    for(const f of files){
      const s=src(f);
      expect(s,f).not.toMatch(/@vercel\/(blob|kv)|googleapis|writeFile|appendFile|createWriteStream|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon/);
      expect(s,f).not.toMatch(/https?:\/\/(?!giftly-test)[a-z0-9.-]+\.(com|net|io|app)/i);
    }
    for(const f of files.filter((x)=>!x.includes("/client/")&&!x.includes("app/validation"))){
      expect(src(f),f).not.toMatch(/\bfetch\(/);
    }
  });
  it("browser code only calls this app's own validation API",()=>{
    const calls=files.flatMap((f)=>[...src(f).matchAll(/fetch\(\s*["'`]([^"'`]+)/g)].map((m)=>m[1]));
    expect(calls.length).toBeGreaterThan(0);
    for(const c of calls) expect(c).toMatch(/^\/api\/validation\//);
  });
  it("never logs request data, file names or metadata",()=>{
    for(const f of files){
      const logs=[...src(f).matchAll(/console\.[a-z]+\(([^)]*)\)/g)].map((m)=>m[1]);
      for(const l of logs) expect(l,f).not.toMatch(/\.name\b(?!\s*\?\?)|formData|req\b|body|hint|meta|exif/i);
    }
  });
  it("browser-side code never imports server-only modules (sharp, node:*, the engine)",()=>{
    const clientFiles=files.filter((f)=>f.includes(path.join("web","client"))||/app\/validation\/(Studio|Login)\.tsx$/.test(f)||f.endsWith(path.join("web","hint.ts"))||f.endsWith(path.join("web","frame.ts"))||f.endsWith(path.join("web","limits.ts")));
    expect(clientFiles.length).toBeGreaterThanOrEqual(7);
    for(const f of clientFiles){
      for(const m of src(f).matchAll(/from\s+["']([^"']+)["']/g)){
        expect(m[1],`${f} imports ${m[1]}`).not.toMatch(/^(node:|sharp|exif-reader|fs|path|crypto)|\.\.\/(exif|io|pipeline)|web\/(run|handlers|auth|guard|focal)$|^\.\/(run|handlers|auth|guard|focal)$/);
      }
    }
  });
  it("the page never ships a long-lived public URL to an image (blob: object URLs only)",()=>{
    const studio=src(path.resolve(__dirname,"../../app/validation/Studio.tsx"));
    expect(studio).not.toMatch(/src=\{["'`]https?:/);
    expect(studio).toContain("URL.createObjectURL");
  });
});
