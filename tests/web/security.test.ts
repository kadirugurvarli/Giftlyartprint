import {describe,expect,it,vi,afterEach} from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {allowedHosts,checkEnvironment,normaliseHost,PRODUCTION_SECRET_NAMES} from "@/lib/mockup-v3/web/guard";
import {buildCsp,PERMISSIONS_POLICY} from "@/lib/mockup-v3/web/headers";
import {HintError,parseHint} from "@/lib/mockup-v3/web/hint";
import {extractHint,findExifSegment,resizeCandidates} from "@/lib/mockup-v3/web/client/jpeg-exif";
import {handleRun} from "@/lib/mockup-v3/web/handlers";
import {unpackFrame} from "@/lib/mockup-v3/web/frame";
import {buildFeedback} from "@/lib/mockup-v3/web/client/feedback";
import {middleware,config} from "@/middleware";
import {NextRequest} from "next/server";
import {GOOD_ENV,HOST,ORIGIN,postForm,sampleUpload} from "./helpers";

const hint=(w:number,h:number)=>JSON.stringify({originalWidth:w,originalHeight:h,focalLength35mm:26});

describe("environment guard (fail closed)",()=>{
  it("runs only on an enabled Preview, on an allowed host, with no production credentials",()=>{
    expect(checkEnvironment(GOOD_ENV,HOST).ok).toBe(true);
  });
  it.each([
    ["not enabled",{...GOOD_ENV,VALIDATION_UI_ENABLED:undefined},404],
    ["production",{...GOOD_ENV,VERCEL_ENV:"production"},404],
    ["development deployment",{...GOOD_ENV,VERCEL_ENV:"development"},404],
    ["no VERCEL_ENV at all",{...GOOD_ENV,VERCEL_ENV:undefined},404],
    ["no allowed hosts configured",{...GOOD_ENV,VALIDATION_ALLOWED_HOSTS:undefined},503],
    ["blank allowed hosts",{...GOOD_ENV,VALIDATION_ALLOWED_HOSTS:" , "},503]
  ])("refuses: %s",(_n,env,status)=>{
    const g=checkEnvironment(env as any,HOST);
    expect(g.ok).toBe(false);if(!g.ok) expect(g.status).toBe(status);
  });
  it("only hostnames that were explicitly confirmed protected can serve the tool (other aliases are hidden)",()=>{
    for(const h of ["giftly-content-studio.vercel.app","giftly-content-studio-abc123-team.vercel.app","evil.example","","giftly-test-preview.vercel.app.evil.example","sub.giftly-test-preview.vercel.app"]){
      const g=checkEnvironment(GOOD_ENV,h);
      expect(g.ok,h).toBe(false);if(!g.ok){expect(g.status).toBe(404);expect(g.code).toBe("HOST_NOT_ALLOWED");}
    }
    expect(checkEnvironment(GOOD_ENV,"GIFTLY-TEST-PREVIEW.vercel.app:443").ok).toBe(true); // case and port are ignored
    expect(checkEnvironment({...GOOD_ENV,VALIDATION_ALLOWED_HOSTS:`a.vercel.app, ${HOST}`},HOST).ok).toBe(true);
    expect(allowedHosts({VALIDATION_ALLOWED_HOSTS:" A.vercel.app:80 ,b.vercel.app,,"})).toEqual(["a.vercel.app","b.vercel.app"]);
    expect(normaliseHost(null)).toBe("");
  });
  it("refuses to run next to any production credential, naming the variable but never its value",()=>{
    for(const name of PRODUCTION_SECRET_NAMES){
      const g=checkEnvironment({...GOOD_ENV,[name]:"super-secret-value-123"},HOST);
      expect(g.ok,name).toBe(false);
      if(!g.ok){expect(g.code).toBe("PRODUCTION_SECRETS_VISIBLE");expect(g.reason).toContain(name);expect(g.reason).not.toContain("super-secret");}
    }
  });
  it("also refuses by prefix (SHOPIFY_*, GOOGLE_*, METRICOOL_*, OPENAI_*, CONTENT_FEED_*) for variables nobody listed",()=>{
    for(const name of ["SHOPIFY_API_SECRET","GOOGLE_CLIENT_SECRET","GOOGLE_PRIVATE_KEY","METRICOOL_FOO","OPENAI_ORG_ID","CONTENT_FEED_X"]){
      const g=checkEnvironment({...GOOD_ENV,[name]:"x"},HOST);
      expect(g.ok,name).toBe(false);
    }
    expect(checkEnvironment({...GOOD_ENV,VERCEL_URL:"x.vercel.app",NEXT_PUBLIC_APP_NAME:"Giftly"},HOST).ok).toBe(true); // ordinary variables are fine
    expect(checkEnvironment({...GOOD_ENV,GOOGLE_SHEET_ID:""},HOST).ok).toBe(true); // empty value = not visible
  });
  it("needs no application password or session secret any more",()=>{
    expect(checkEnvironment({...GOOD_ENV,VALIDATION_PASSWORD:undefined,VALIDATION_SESSION_SECRET:undefined},HOST).ok).toBe(true);
  });
  it("the local-development escape hatch never works on Vercel",()=>{
    const local={...GOOD_ENV,VERCEL_ENV:undefined,VALIDATION_ALLOW_LOCAL:"1",VALIDATION_ALLOWED_HOSTS:"localhost"};
    expect(checkEnvironment(local as any,"localhost:3000").ok).toBe(true);
    expect(checkEnvironment({...local,VERCEL:"1"} as any,"localhost").ok).toBe(false);
    expect(checkEnvironment({...local,VERCEL_ENV:"production"} as any,"localhost").ok).toBe(false);
  });
});

describe("security headers",()=>{
  it("CSP is strict: nothing allowed by default, scripts only by nonce, no unsafe-inline/eval, no wildcards or remote hosts",()=>{
    const csp=buildCsp("NONCE123");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-NONCE123' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");expect(csp).toContain("form-action 'none'");expect(csp).toContain("base-uri 'none'");expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");expect(csp).toContain("img-src 'self' blob: data:");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:/);
    expect(buildCsp("A")).not.toBe(buildCsp("B"));
  });
  it("Permissions-Policy denies camera, microphone, location and the rest; only clipboard-write for self",()=>{
    for(const f of ["camera","microphone","geolocation","payment","usb","serial","hid","display-capture","clipboard-read"]) expect(PERMISSIONS_POLICY).toContain(`${f}=()`);
    expect(PERMISSIONS_POLICY).toContain("clipboard-write=(self)");
    expect(PERMISSIONS_POLICY).not.toMatch(/=\(\*\)/);
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
  it("hidden entirely when disabled, not Preview, or reached through any other alias; explains misconfiguration only to the owner",async()=>{
    const f=await postForm(url,{mode:"artwork-in-frame"});
    for(const env of [{...GOOD_ENV,VERCEL_ENV:"production"},{...GOOD_ENV,VALIDATION_UI_ENABLED:undefined},{...GOOD_ENV,VALIDATION_ALLOWED_HOSTS:"other.vercel.app"}]) expect((await handleRun(f.clone(),env as any)).status).toBe(404);
    expect((await handleRun(f.clone(),{...GOOD_ENV,CONTENT_FEED_TOKEN:"x"})).status).toBe(503);
    expect((await handleRun(f.clone(),{...GOOD_ENV,VALIDATION_ALLOWED_HOSTS:undefined})).status).toBe(503);
    const wrongHost=await postForm(url,{mode:"artwork-in-frame"},{host:"giftly-content-studio.vercel.app",origin:"https://giftly-content-studio.vercel.app"});
    expect((await handleRun(wrongHost,GOOD_ENV)).status).toBe(404);
  });
  it("a spoofed X-Forwarded-Host never opens an unlisted alias; 403 cross-site; 411/413/415 on bad framing",async()=>{
    const base={mode:"artwork-in-frame"};
    const spoof=await postForm(url,base,{host:"unprotected.vercel.app",origin:"https://unprotected.vercel.app","x-forwarded-host":HOST});
    expect((await handleRun(spoof,GOOD_ENV)).status).toBe(404);
    expect((await handleRun(await postForm(url,base,{origin:"https://evil.example"}),GOOD_ENV)).status).toBe(403);
    const noOrigin=new Request(url,{method:"POST",body:"x",headers:{host:HOST,"content-length":"1","content-type":"multipart/form-data; boundary=x"}});
    expect((await handleRun(noOrigin,GOOD_ENV)).status).toBe(403);
    expect((await handleRun(await postForm(url,base,{"content-length":"99999999"}),GOOD_ENV)).status).toBe(413);
    const noLen=new Request(url,{method:"POST",body:"x",headers:{origin:ORIGIN,host:HOST}});
    expect((await handleRun(noLen,GOOD_ENV)).status).toBe(411);
    const wrongType=new Request(url,{method:"POST",body:"{}",headers:{origin:ORIGIN,host:HOST,"content-length":"2","content-type":"application/json"}});
    expect((await handleRun(wrongType,GOOD_ENV)).status).toBe(415);
  });
  it("400 on non-JPEG, GPS in metadata, bad mode/level, absurd sizes",async()=>{
    const {source,reference}=await sampleUpload();
    const ok={mode:"artwork-in-frame",level:"environment",source,reference,sourceMeta:hint(640,480),referenceMeta:hint(1600,1200)};
    const go=async(over:Record<string,any>)=>handleRun(await postForm(url,{...ok,...over}),GOOD_ENV);
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
    },{},SECRET_NAME);
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
    const mk=async()=>handleRun(await postForm(`${ORIGIN}/api/validation/run`,{mode:"artwork-in-frame",level:"strict",source,reference,sourceMeta:hint(srcDims[0],srcDims[1]),referenceMeta:hint(refDims[0],refDims[1])}),GOOD_ENV);
    const [a,b]=await Promise.all([mk(),mk()]);
    expect([a.status,b.status].sort()).toEqual([200,429]);
  },120000);

});

describe("middleware scope and headers",()=>{
  const saved={...process.env};
  const reset=()=>{for(const k of Object.keys(process.env)) if(!(k in saved)) delete process.env[k];Object.assign(process.env,saved);};
  const req=(host=HOST)=>new NextRequest(`https://${host}/validation`,{headers:{host}});
  it("covers only the validation interface, never V2 routes",()=>{
    const flat=config.matcher.map((m:any)=>typeof m==="string"?m:m.source);
    expect(flat).toEqual(["/validation","/validation/:path*","/api/validation/:path*"]);
    for(const m of flat) expect(m).not.toMatch(/api\/(content|media|upload|sync|metricool|health)/);
  });
  it("404 unless an enabled Preview reached through an allowed host",()=>{
    try{
      for(const k of ["VERCEL_ENV","VALIDATION_UI_ENABLED","VALIDATION_ALLOW_LOCAL","VERCEL","VALIDATION_ALLOWED_HOSTS"]) delete process.env[k];
      expect(middleware(req()).status).toBe(404);
      process.env.VALIDATION_UI_ENABLED="1";process.env.VERCEL_ENV="production";process.env.VALIDATION_ALLOWED_HOSTS=HOST;
      expect(middleware(req()).status).toBe(404);
      process.env.VERCEL_ENV="preview";
      expect(middleware(req()).status).toBe(200);
      expect(middleware(req("giftly-content-studio.vercel.app")).status).toBe(404);      // any other alias is hidden
      expect(middleware(req("evil.example")).status).toBe(404);
    }finally{reset();}
  });
  it("sets a fresh-nonce CSP, Permissions-Policy and the other headers, and forwards the nonce to the page",()=>{
    try{
      process.env.VALIDATION_UI_ENABLED="1";process.env.VERCEL_ENV="preview";process.env.VALIDATION_ALLOWED_HOSTS=HOST;
      const a=middleware(req()),b=middleware(req());
      const ca=a.headers.get("content-security-policy")!,cb=b.headers.get("content-security-policy")!;
      expect(ca).toMatch(/script-src 'nonce-[A-Za-z0-9+\/=]{20,}' 'strict-dynamic'/);
      expect(ca).not.toBe(cb);
      expect(ca).not.toMatch(/unsafe-inline|unsafe-eval/);
      expect(a.headers.get("permissions-policy")).toContain("camera=()");
      for(const [k,v] of Object.entries({"x-robots-tag":"noindex","x-frame-options":"DENY","referrer-policy":"no-referrer","x-content-type-options":"nosniff","cross-origin-opener-policy":"same-origin","cache-control":"no-store"})) expect(a.headers.get(k),k).toContain(v);
      expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(ca); // Next reads the nonce from the forwarded request header
    }finally{reset();}
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
  it("there is no password form, password input, cookie auth or session code anywhere in the interface",()=>{
    for(const f of files){
      const s=src(f);
      expect(s,f).not.toMatch(/type=["']password["']|<form\b|autoComplete=["']current-password|VALIDATION_PASSWORD|VALIDATION_SESSION_SECRET|Set-Cookie|document\.cookie|jsonwebtoken/i);
    }
    expect(fs.existsSync(path.resolve(__dirname,"../../app/api/validation/login"))).toBe(false);
    expect(fs.existsSync(path.resolve(__dirname,"../../app/validation/Login.tsx"))).toBe(false);
  });
  it("no inline style attributes or inline scripts, so the strict CSP can stay free of unsafe-inline",()=>{
    for(const f of files.filter((x)=>/\.tsx$/.test(x))){
      expect(src(f),f).not.toMatch(/style=\{\{|dangerouslySetInnerHTML|<script\b/);
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
