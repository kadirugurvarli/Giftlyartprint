import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {beforeAll,describe,expect,it} from "vitest";
import {analyseAnnotation,annotationToRoom,buildPackManifest,controlPointsFrom,suggestFocal,validateAnnotationShape,type RoomAnnotation} from "../../lib/mockup-v4/annotation";
import {paidEligible,validatePackManifest} from "../../lib/mockup-v4/pack";
import {landscapeArt} from "../helpers/scenes";
import {syntheticRoom,type SyntheticRoom} from "../helpers/rooms";
import {loadPack} from "../../scripts/v4-pack";
import {createAnnotateServer,importPack} from "../../scripts/v4-annotate-server";

let S:SyntheticRoom;
beforeAll(()=>{S=syntheticRoom({withPlant:true,scale:2});},120000);

/** Marks two known rectangles on the synthetic wall the way a person would click them. */
function annotation(over:Partial<RoomAnnotation>={}):RoomAnnotation{
  const rect=(x:number,y:number,w:number,h:number)=>[S.truth(x,y),S.truth(x+w,y),S.truth(x+w,y+h),S.truth(x,y+h)] as RoomAnnotation["references"][0]["corners"];
  return {
    schemaVersion:1,image:{width:S.image.width,height:S.image.height},
    references:[{label:"door",widthCm:80,heightCm:70,corners:rect(0,0,80,70)},{label:"window",widthCm:80,heightCm:70,corners:rect(110,0,80,70),offsetCm:{x:110,y:0}},{label:"shelf",widthCm:80,heightCm:70,corners:rect(0,90,80,70),offsetCm:{x:0,y:90}},{label:"panel",widthCm:80,heightCm:70,corners:rect(110,90,80,70),offsetCm:{x:110,y:90}}],
    wallPolygons:S.room.shadowMask!.wallPolygons,excludePolygons:S.room.shadowMask!.excludePolygons ?? [],
    region:{leftCm:20,topCm:10,widthCm:170,heightCm:150},
    light:{shadowDirectionDeg:63,intensity:0.25,softnessCm:2,colourTempK:5200},
    scale:{basis:"door leaf assumed 80 x 70 cm",confidence:"medium",relativeUncertainty:0.1},
    ...over
  };
}
const meta=(over={})=>({generator:"gpt-image-2",generatedOn:"2026-10-12",licence:"owner generated, commercial use allowed",rightsCleared:true,emptyWallConfirmed:true,artworkLicence:"public domain sample",
  frame:{mouldingWidthCm:2.4,mountWidthCm:3.5,frameDepthCm:3,mouldingColour:[66,48,34] as [number,number,number],mountColour:[238,233,222] as [number,number,number],description:"walnut"},...over});

describe("annotation → calibrated room",()=>{
  it("two marked rectangles give a valid calibration (rms ≈ 0) and a projected safe region",()=>{
    const a=analyseAnnotation(annotation());
    expect(a.shape).toEqual([]);expect(a.issues).toEqual([]);
    expect(a.rmsPx!).toBeLessThan(0.5);expect(a.regionPx.length).toBe(4);
    expect(controlPointsFrom(annotation()).length).toBe(16);
  });
  it("converts to an AI room with estimated (illustrative) scale only",()=>{
    const r=annotationToRoom(annotation({scale:{basis:"x",confidence:"medium",relativeUncertainty:0.01}}),{id:"r",imageKey:"room.png",commercialUse:true,rightsNotes:"n"});
    expect(r.image.origin).toBe("ai-generated");expect(r.scale.method).toBe("ai-estimate");expect(r.scale.relativeUncertainty).toBeGreaterThanOrEqual(0.05);expect(r.camera.source).toBe("estimated");
  });
  it("suggests a focal length and falls back to a flagged default",()=>{
    const f=suggestFocal(annotation());expect(f.focalPx).toBeGreaterThan(0.3*3200);
    expect(suggestFocal(annotation({references:[]})).basis).toBe("assumed-default");
  });
  it("fails closed with specific codes",()=>{
    const code=(a:RoomAnnotation)=>validateAnnotationShape(a).map(i=>i.code);
    expect(code(annotation({references:[]}))).toContain("ANNOTATION_NO_REFERENCE");
    expect(code(annotation({wallPolygons:[]}))).toContain("ANNOTATION_NO_WALL_POLYGON");
    expect(code(annotation({region:{leftCm:0,topCm:0,widthCm:40,heightCm:40}}))).toContain("ANNOTATION_REGION_TOO_SMALL");
    expect(code(annotation({scale:{basis:" ",confidence:"low",relativeUncertainty:0.2}}))).toContain("ANNOTATION_SCALE_BASIS_MISSING");
    const a=annotation();a.references[0].corners[2]={x:-5,y:10};expect(code(a)).toContain("ANNOTATION_REFERENCE_CORNERS");
    expect(code(annotation({wallPolygons:[[{x:1,y:1},{x:2,y:2}]]}))).toContain("ANNOTATION_POLYGON_INVALID");
    const b=annotation();b.references[0].widthCm=2;expect(code(b)).toContain("ANNOTATION_REFERENCE_SIZE");
  });
  it("a mis-clicked corner is caught by the real room validator",()=>{
    const a=annotation();a.references[3].corners[2]={x:a.references[3].corners[2].x+60,y:a.references[3].corners[2].y-40};
    const r=analyseAnnotation(a);
    expect(r.issues.length).toBeGreaterThan(0);
  });
  it("a region outside the calibrated area is rejected",()=>{
    const r=analyseAnnotation(annotation({region:{leftCm:600,topCm:600,widthCm:170,heightCm:150}}));
    expect(r.issues.map(i=>i.code)).toContain("REGION_OUTSIDE_CALIBRATED_AREA");
  });
});

describe("pack import",()=>{
  const png=(i:{width:number;height:number;data:Uint8ClampedArray})=>sharp(Buffer.from(i.data.buffer,i.data.byteOffset,i.data.byteLength),{raw:{width:i.width,height:i.height,channels:4}}).removeAlpha().png().toBuffer();
  const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),"v4import-"));
  it("writes a valid, paid-eligible AI pack that the loader accepts",async()=>{
    const out=tmp();
    const r=await importPack(out,{annotation:annotation(),roomImageBase64:(await png(S.image)).toString("base64"),roomImageName:"room.png",artworkBase64:(await png(landscapeArt(1500,2000,2))).toString("base64"),artworkName:"art.png",packName:"english-living-room",meta:meta()});
    expect(r.ok,JSON.stringify(r)).toBe(true);
    const l=await loadPack(path.join(out,"english-living-room"));
    expect(l.issues).toEqual([]);expect(l.manifest.provenance.kind).toBe("ai-generated");
    expect(paidEligible(l.manifest).eligible).toBe(true);expect(validatePackManifest(l.manifest)).toEqual([]);
    expect(l.roomImage.width).toBe(3200);
  },180000);
  it("refuses without rights, empty-wall confirmation, generator, or with a small / mismatched image",async()=>{
    const out=tmp(),room=(await png(S.image)).toString("base64"),art=(await png(landscapeArt(1500,2000,2))).toString("base64");
    const base={annotation:annotation(),roomImageBase64:room,roomImageName:"room.png",artworkBase64:art,artworkName:"art.png",packName:"p-one"};
    const codes=async(b:object)=>{const r=await importPack(out,b as never);return r.ok?[]:r.issues.map(i=>i.code);};
    expect(await codes({...base,meta:meta({rightsCleared:false})})).toContain("PACK_RIGHTS_NOT_CLEARED");
    expect(await codes({...base,meta:meta({emptyWallConfirmed:false})})).toContain("PACK_EMPTY_WALL_NOT_CONFIRMED");
    expect(await codes({...base,meta:meta({generator:""})})).toContain("PACK_PROVENANCE_INCOMPLETE");
    expect(await codes({...base,packName:"../evil"})).toEqual(["PACK_NAME_INVALID"]);
    expect(await codes({...base,roomImageBase64:"",meta:meta()})).toEqual(["IMAGE_MISSING"]);
    expect(await codes({...base,roomImageBase64:"AAAA",meta:meta()})).toEqual(["IMAGE_UNREADABLE"]);
    const small=(await sharp({create:{width:1000,height:750,channels:3,background:"#888"}}).png().toBuffer()).toString("base64");
    const c=await codes({...base,roomImageBase64:small,meta:meta()});expect(c).toContain("ANNOTATION_IMAGE_SIZE_MISMATCH");expect(c).toContain("ROOM_TOO_SMALL_FOR_DETAIL");
    expect(fs.readdirSync(out)).toEqual([]); // nothing written on failure
  },180000);
  it("the manifest records AI provenance and a non-customer artwork",()=>{
    const m=buildPackManifest(annotation(),{...meta(),id:"x-room-pack",roomImage:"room.png",artworkImage:"art.png"});
    expect(m.provenance.kind).toBe("ai-generated");expect(m.artwork).toMatchObject({origin:"sample",customer:false});
  });
});

describe("annotation server is local and strict",()=>{
  const req=(port:number,o:{method?:string;path?:string;headers?:Record<string,string>;body?:string})=>new Promise<{status:number;body:string}>((resolve,reject)=>{
    const r=http.request({host:"127.0.0.1",port,path:o.path ?? "/",method:o.method ?? "GET",headers:o.headers},res=>{let b="";res.on("data",d=>b+=d);res.on("end",()=>resolve({status:res.statusCode!,body:b}));});
    r.on("error",reject);if(o.body)r.write(o.body);r.end();
  });
  it("serves the page, analyses annotations, rejects foreign hosts/origins and unknown routes",async()=>{
    const s=createAnnotateServer({outRoot:fs.mkdtempSync(path.join(os.tmpdir(),"v4ann-"))});
    await new Promise<void>(r=>s.listen(0,"127.0.0.1",r));const port=(s.address() as {port:number}).port;
    try{
      const page=await req(port,{});expect(page.status).toBe(200);expect(page.body).toContain("V4 room annotation");
      const ok=await req(port,{method:"POST",path:"/api/analyse",body:JSON.stringify(annotation())});expect(ok.status).toBe(200);expect(JSON.parse(ok.body).issues).toEqual([]);
      expect((await req(port,{headers:{Host:"evil.example"}})).status).toBe(403);
      expect((await req(port,{method:"POST",path:"/api/analyse",headers:{Origin:"https://evil.example"},body:"{}"})).status).toBe(403);
      expect((await req(port,{method:"POST",path:"/api/analyse",body:"not json"})).status).toBe(400);
      expect((await req(port,{path:"/nope"})).status).toBe(404);
      const h=await new Promise<http.IncomingHttpHeaders>(r=>http.get({host:"127.0.0.1",port,path:"/"},res=>{res.resume();r(res.headers);}));
      expect(h["content-security-policy"]).toContain("default-src 'self'");expect(h["x-frame-options"]).toBe("DENY");expect(h["cache-control"]).toBe("no-store");
    }finally{s.close();}
  },60000);
  it("binds to the loopback interface only in the CLI",()=>{
    const t=fs.readFileSync("scripts/v4-annotate.ts","utf8");expect(t).toContain('"127.0.0.1"');
    expect(fs.readFileSync("scripts/v4-studio.ts","utf8")).toContain('"127.0.0.1"');
  });
});
