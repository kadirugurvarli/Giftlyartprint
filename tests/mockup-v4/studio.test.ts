import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import type {PackManifest} from "../../lib/mockup-v4/pack";
import {SpendGuard} from "../../lib/mockup-v4/spend";
import {createStudioServer,type StudioRoom} from "../../scripts/v4-studio-server";
import {landscapeArt} from "../helpers/scenes";
import {syntheticRoom} from "../helpers/rooms";

const frame={mouldingWidthCm:2.4,mountWidthCm:3.5,frameDepthCm:3,mouldingColour:[66,48,34] as [number,number,number],mountColour:[238,233,222] as [number,number,number],description:"walnut"};
function room(id:string,kind:"synthetic-test"|"ai-generated"):StudioRoom{
  const s=syntheticRoom({withPlant:true,origin:kind==="ai-generated"?"ai-generated":"owned-photo"});
  const manifest:PackManifest={schemaVersion:1,id,roomImage:"room.png",artworkImage:"art.png",room:s.room,
    provenance:{kind,generator:kind==="ai-generated"?"gpt-image-2":undefined,generatedOn:kind==="ai-generated"?"2026-10-12":undefined,rightsCleared:true,licence:"test",emptyWallConfirmed:true},
    artwork:{origin:kind==="ai-generated"?"sample":"synthetic-test",customer:false,licence:"test"},frame};
  return {id,label:id,handle:{manifest,roomImage:s.image}};
}
const jpg=async(w:number,h:number,seed=1)=>{const a=landscapeArt(w,h,seed);return sharp(Buffer.from(a.data.buffer),{raw:{width:w,height:h,channels:4}}).removeAlpha().jpeg({quality:90}).toBuffer();};
const call=(port:number,o:{method?:string;path:string;headers?:Record<string,string>;body?:Buffer|string})=>new Promise<{status:number;json:any}>((resolve,reject)=>{
  const r=http.request({host:"127.0.0.1",port,path:o.path,method:o.method ?? "GET",headers:o.headers},res=>{const c:Buffer[]=[];res.on("data",d=>c.push(d));res.on("end",()=>{const t=Buffer.concat(c).toString();let j:any=null;try{j=JSON.parse(t);}catch{j=t;}resolve({status:res.statusCode!,json:j});});});
  r.on("error",reject);if(o.body)r.write(o.body);r.end();
});

describe("Content Studio V4 server (local test interface)",()=>{
  const outDir=fs.mkdtempSync(path.join(os.tmpdir(),"v4studio-"));
  let server:http.Server,port=0,portrait:Buffer,landscape:Buffer;
  const fakeFetch=vi.fn();
  let paidServer:http.Server,paidPort=0,driveServer:http.Server,drivePort=0;
  const driveFetch=vi.fn(async()=>new Response(JSON.stringify({ok:true}),{status:200}));
  const start=async(s:http.Server)=>{await new Promise<void>(r=>s.listen(0,"127.0.0.1",r));return (s.address() as {port:number}).port;};
  beforeAll(async()=>{
    portrait=await jpg(1200,1600,3);landscape=await jpg(1600,1200,4);
    server=createStudioServer({rooms:[room("synthetic-demo","synthetic-test"),room("ai-room","ai-generated")],outDir});port=await start(server);
    // an identity "model": returns the scene image it was given (a perfectly faithful AI)
    fakeFetch.mockImplementation(async(_u:string,init:RequestInit)=>{const f=(init.body as FormData).getAll("image[]")[0] as Blob;const b=Buffer.from(await f.arrayBuffer());return new Response(JSON.stringify({data:[{b64_json:b.toString("base64")}],usage:{}}),{status:200});});
    paidServer=createStudioServer({rooms:[room("synthetic-demo","synthetic-test"),room("ai-room","ai-generated")],outDir,paid:{guard:new SpendGuard({authorized:true,capUsd:1,pricePerCallUsd:0.3,maxCalls:1}),apiKey:()=>"sk-test",fetchImpl:fakeFetch as never}});paidPort=await start(paidServer);
    driveServer=createStudioServer({rooms:[room("synthetic-demo","synthetic-test")],outDir,drive:{allow:true,feedUrl:"https://feed.test/exec",feedToken:"tok",fetchImpl:driveFetch as never}});drivePort=await start(driveServer);
  },300000);
  afterAll(()=>{server.close();paidServer.close();driveServer.close();});

  it("lists rooms, the eight sizes, styles, mounts, formats and engine modes; paid mode is off by default",async()=>{
    const r=await call(port,{path:"/api/options"});expect(r.status).toBe(200);
    expect(r.json.sizes.length).toBe(8);expect(r.json.styles.length).toBe(5);expect(r.json.mounts.length).toBe(4);expect(r.json.formats.map((f:{key:string})=>f.key)).toEqual(["feed_4x5","square_1x1","story_9x16","landscape_191x100"]);
    expect(r.json.modes.find((m:{id:string})=>m.id==="openai").enabled).toBe(false);
    expect(r.json.rooms.find((x:{id:string})=>x.id==="synthetic-demo")).toMatchObject({provenance:"synthetic-test",paidEligible:false});
    expect(r.json.rooms.find((x:{id:string})=>x.id==="ai-room").paidEligible).toBe(true);
    expect(r.json.driveEnabled).toBe(false);
    const page=await call(port,{path:"/"});expect(String(page.json)).toContain("Content Studio V4");
  });
  it("reports which sizes suit the artwork (print never cropped or stretched)",async()=>{
    const r=await call(port,{method:"POST",path:"/api/fit?style=oak&mount=wide",body:landscape});
    expect(r.json.ok).toBe(true);expect(r.json.sizes.length).toBe(8);
    expect(r.json.sizes.filter((s:{fits:boolean})=>s.fits).length).toBeGreaterThan(3);
    const bad=await call(port,{method:"POST",path:"/api/fit?style=oak&mount=wide",body:Buffer.from("junk")});expect(bad.status).toBe(422);
  });
  it("renders a baseline preview with all V3 checks passing and warns that the room is synthetic",async()=>{
    const r=await call(port,{method:"POST",path:"/api/render?room=synthetic-demo&size=60x80&style=walnut&mount=classic&mode=baseline",body:portrait});
    expect(r.status,JSON.stringify(r.json).slice(0,300)).toBe(200);
    expect(r.json).toMatchObject({ok:true,mode:"baseline",verdict:"baseline"});
    expect(r.json.checks.every((c:{pass:boolean})=>c.pass)).toBe(true);
    expect(r.json.warnings).toContain("SYNTHETIC_ROOM_NOT_A_VISUAL_APPROVAL");
    expect(r.json.scaleDisclosure.length).toBeGreaterThan(10);
    const m=await sharp(Buffer.from(r.json.preview,"base64")).metadata();expect(m.format).toBe("jpeg");expect(m.width).toBe(1600);
    expect(fs.readdirSync(outDir)).toEqual([]); // nothing is written by a preview (artwork is never stored)
  });
  it("mock editor mode is labelled as not AI; regeneration changes the prompt wording",async()=>{
    const a=await call(port,{method:"POST",path:"/api/render?room=synthetic-demo&size=30x40&style=oak&mount=narrow&mode=mock&variant=0",body:portrait});
    const b=await call(port,{method:"POST",path:"/api/render?room=synthetic-demo&size=30x40&style=oak&mount=narrow&mode=mock&variant=1",body:portrait});
    expect(a.json.warnings).toContain("MOCK_EDITOR_NOT_AI");expect(a.json.verdict).toBe("accept");expect(a.json.baselinePreview).toBeTruthy();
    expect(b.json.renderId).not.toBe(a.json.renderId);
  },120000);
  it("landscape size with landscape art works; unsuitable combinations and bad input fail closed",async()=>{
    const ok=await call(port,{method:"POST",path:"/api/render?room=synthetic-demo&size=70x50&style=black&mount=none&mode=baseline",body:landscape});expect(ok.json.ok).toBe(true);
    expect((await call(port,{method:"POST",path:"/api/render?room=synthetic-demo&size=70x50&style=black&mount=none&mode=baseline",body:portrait})).json.ok).toBe(false); // portrait art in a landscape frame
    expect((await call(port,{method:"POST",path:"/api/render?room=synthetic-demo&size=20x30&style=black&mount=none&mode=baseline",body:landscape})).json.error).toBe("SIZE_NOT_SUPPORTED");
    expect((await call(port,{method:"POST",path:"/api/render?room=nope&size=60x80&mode=baseline",body:portrait})).status).toBe(404);
    expect((await call(port,{method:"POST",path:"/api/render?room=synthetic-demo&size=60x80&mode=laser",body:portrait})).json.error).toBe("MODE_INVALID");
    expect((await call(port,{method:"POST",path:"/api/render?room=synthetic-demo&size=60x80&style=zebra&mount=classic&mode=baseline",body:portrait})).json.error).toBe("UNKNOWN_STYLE_OR_MOUNT");
  },120000);
  it("paid AI mode is refused when the server was not started with the paid flags, and never calls out",async()=>{
    const r=await call(port,{method:"POST",path:"/api/render?room=ai-room&size=60x80&mode=openai",body:portrait});
    expect(r.status).toBe(403);expect(r.json.error).toBe("PAID_MODE_DISABLED");expect(fakeFetch).not.toHaveBeenCalled();
  });
  it("paid mode only for an eligible AI room; the spend guard allows exactly one call",async()=>{
    const synth=await call(paidPort,{method:"POST",path:"/api/render?room=synthetic-demo&size=60x80&mode=openai",body:portrait});
    expect(synth.status).toBe(403);expect(synth.json.error).toBe("ROOM_NOT_PAID_ELIGIBLE");expect(fakeFetch).not.toHaveBeenCalled();
    const one=await call(paidPort,{method:"POST",path:"/api/render?room=ai-room&size=60x80&mode=openai",body:portrait});
    expect(one.status,JSON.stringify(one.json).slice(0,300)).toBe(200);expect(one.json.verdict).toBe("accept");expect(one.json.editor.model).toBe("gpt-image-2");expect(one.json.editor.estimatedCostUsd).toBe(0.3);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const two=await call(paidPort,{method:"POST",path:"/api/render?room=ai-room&size=60x80&mode=openai&variant=1",body:portrait});
    expect(two.status).toBe(402);expect(fakeFetch).toHaveBeenCalledTimes(1);
  },180000);
  it("exports the Facebook + Instagram pack with captions, tracker row and drive plan",async()=>{
    const r=await call(port,{method:"POST",path:"/api/render?room=synthetic-demo&size=50x70&style=gold&mount=classic&mode=baseline",body:portrait});
    const e=await call(port,{method:"POST",path:"/api/export",body:JSON.stringify({renderId:r.json.renderId,category:"Fine Art Printing",title:"Test export"})});
    expect(e.status,JSON.stringify(e.json).slice(0,300)).toBe(200);
    expect(e.json.files.map((f:{format:string})=>f.format)).toEqual(["feed_4x5","square_1x1","story_9x16","landscape_191x100"]);
    const dir=e.json.folder as string,names=fs.readdirSync(dir).sort();
    expect(names).toContain("captions.md");expect(names).toContain("tracker_row.json");expect(names).toContain("drive_upload_plan.json");expect(names.filter(n=>n.endsWith("_master.png")).length).toBe(1);
    for(const f of e.json.files){const m=await sharp(path.join(dir,f.fileName)).metadata();expect([m.width,m.height]).toEqual([f.width,f.height]);expect(fs.statSync(path.join(dir,f.fileName)).size).toBeLessThanOrEqual(900*1024);}
    expect(e.json.captionProblems).toEqual([]);expect(e.json.tracker).toMatchObject({status:"New",category:"Fine Art Printing",source:"v4-mockup"});
    expect(e.json.drivePlan.length).toBe(4);
    expect((await call(port,{method:"POST",path:"/api/export",body:JSON.stringify({renderId:"nope"})})).status).toBe(404);
    expect((await call(port,{method:"POST",path:"/api/export",body:JSON.stringify({renderId:r.json.renderId,formats:["tiktok"]})})).json.error).toBe("NO_FORMATS");
    const only=await call(port,{method:"POST",path:"/api/export",body:JSON.stringify({renderId:r.json.renderId,formats:["square_1x1"]})});expect(only.json.files.length).toBe(1);
    // drive push is off on this server
    expect((await call(port,{method:"POST",path:"/api/drive-push",body:JSON.stringify({exportId:e.json.exportId,confirm:true})})).status).toBe(403);
  },180000);
  it("Drive push needs the opt-in flag, a confirmation, and sends the existing upload body",async()=>{
    const r=await call(drivePort,{method:"POST",path:"/api/render?room=synthetic-demo&size=40x50&style=oak&mount=classic&mode=baseline",body:portrait});
    const e=await call(drivePort,{method:"POST",path:"/api/export",body:JSON.stringify({renderId:r.json.renderId,formats:["feed_4x5","landscape_191x100"]})});
    const no=await call(drivePort,{method:"POST",path:"/api/drive-push",body:JSON.stringify({exportId:e.json.exportId,confirm:false})});
    expect(no.status).toBe(400);expect(driveFetch).not.toHaveBeenCalled();
    const yes=await call(drivePort,{method:"POST",path:"/api/drive-push",body:JSON.stringify({exportId:e.json.exportId,confirm:true})});
    expect(yes.json.ok).toBe(true);expect(driveFetch).toHaveBeenCalledTimes(2);
    const body=JSON.parse((driveFetch.mock.calls[0] as unknown as [URL,RequestInit])[1].body as string);expect(Object.keys(body).sort()).toEqual(["action","base64","category","fileName","mimeType"]);expect(body.action).toBe("upload");
  },180000);
  it("rejects foreign hosts and origins, keeps strict headers",async()=>{
    expect((await call(port,{path:"/api/options",headers:{Host:"evil.example"}})).status).toBe(403);
    expect((await call(port,{method:"POST",path:"/api/fit",headers:{Origin:"https://evil.example"},body:portrait})).status).toBe(403);
    const h=await new Promise<http.IncomingHttpHeaders>(r=>http.get({host:"127.0.0.1",port,path:"/"},res=>{res.resume();r(res.headers);}));
    expect(h["content-security-policy"]).toContain("object-src 'none'");expect(h["x-content-type-options"]).toBe("nosniff");expect(h["referrer-policy"]).toBe("no-referrer");
    expect((await call(port,{path:"/missing"})).status).toBe(404);
  });
});
