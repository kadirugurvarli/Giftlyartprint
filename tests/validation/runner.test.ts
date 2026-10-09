import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {assertOutputIgnored,runValidation} from "@/lib/mockup-v3/validation/runner";
import {landscapeArt,addPlant} from "../helpers/scenes";
import {printPhoto,referenceWithFramedPicture,framedPhoto,emptyRoom,DEFAULT_STYLE} from "../helpers/e2e";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";
import type {RawImage} from "@/lib/mockup-v3/types";

const root=path.resolve(__dirname,"..","output","validation-selftest");
const toJpeg=(img:RawImage,exif:Record<string,Record<string,string>>)=>
  sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}})
    .removeAlpha().withExif(exif as any).jpeg({quality:94}).toBuffer();

describe("real-photo validation runner (self-test on synthetic JPEGs with EXIF)",()=>{
  it("reads EXIF focal, runs both workflows at two levels, measures accuracy, writes sanitised reports",async()=>{
    fs.rmSync(root,{recursive:true,force:true});
    const inDir=path.join(root,"in"),outDir=path.join(root,"out");
    fs.mkdirSync(inDir,{recursive:true});
    const exifPhone={IFD0:{Make:"TestCam",Model:"Phone 1"},IFD2:{FocalLengthIn35mmFilm:"28"},IFD3:{GPSLatitudeRef:"N",GPSLatitude:"51/1 16/1 30/1",GPSLongitudeRef:"E",GPSLongitude:"0/1 31/1 12/1"}};

    const ref=referenceWithFramedPicture();
    const print=printPhoto(landscapeArt(640,480,21));
    fs.writeFileSync(path.join(inDir,"print.jpg"),await toJpeg(print.photo,exifPhone));
    fs.writeFileSync(path.join(inDir,"ref-framed.jpg"),await toJpeg(ref.image,{IFD2:{FocalLengthIn35mmFilm:"26"}}));

    const piece=renderFramedPiece(landscapeArt(480,360,31),DEFAULT_STYLE);
    const fp=framedPhoto(piece);
    fs.writeFileSync(path.join(inDir,"framed.jpg"),await toJpeg(fp.photo,exifPhone));
    const room=emptyRoom();
    fs.writeFileSync(path.join(inDir,"ref-wall.jpg"),await toJpeg(room.image,{IFD2:{FocalLengthIn35mmFilm:"26"}}));
    // a foreground plant mask for case B2
    const plant=addPlant(room.image,room.image.width*0.55,room.image.height*0.62,200,6);
    fs.writeFileSync(path.join(inDir,"ref-wall-plant.jpg"),await toJpeg(plant.image,{IFD2:{FocalLengthIn35mmFilm:"26"}}));
    await sharp(Buffer.from(plant.alpha),{raw:{width:plant.image.width,height:plant.image.height,channels:1}}).png().toFile(path.join(inDir,"plant-mask.png"));

    const q=(a:{x:number;y:number}[])=>a.map((p)=>[p.x,p.y]) as any;
    const manifest={version:1,levels:["environment","photographic"],cases:[
      {id:"A-01",mode:"artwork-in-frame",source:"print.jpg",reference:"ref-framed.jpg",options:{artworkAspect:640/480},
        groundTruth:{sourceQuad:q(print.quad),targetQuad:q(ref.apertureQuad)},notes:"synthetic self-test"},
      {id:"B-01",mode:"framed-on-wall",source:"framed.jpg",reference:"ref-wall.jpg",options:{pieceAspect:piece.image.width/piece.image.height,physicalWidthM:0.62,ceilingHeightM:2.6,skirtingM:0.12},
        groundTruth:{sourceQuad:q(fp.quad)}},
      {id:"B-02",mode:"framed-on-wall",source:"framed.jpg",reference:"ref-wall-plant.jpg",options:{pieceAspect:piece.image.width/piece.image.height,physicalWidthM:0.62,ceilingHeightM:2.6,skirtingM:0.12},
        manual:{occlusionMask:"plant-mask.png"}}
    ]};
    fs.writeFileSync(path.join(inDir,"manifest.json"),JSON.stringify(manifest));

    const logs:string[]=[];
    const {reports,summary}=await runValidation(path.join(inDir,"manifest.json"),outDir,{log:(m)=>logs.push(m)});
    expect(reports.length).toBe(6);

    const a=reports.find((r)=>r.id==="A-01"&&r.level==="environment")!;
    expect(a.status).toBe("pass");
    expect(a.inputs.sourceFocalUsed?.from).toBe("exif");
    expect(a.inputs.sourceFocalUsed!.px).toBeGreaterThan(1250);expect(a.inputs.sourceFocalUsed!.px).toBeLessThan(1340); // true 1300
    expect(a.inputs.referenceFocalUsed?.from).toBe("exif");
    expect(a.accuracy!.sourceQuadErrorPx!).toBeLessThan(1.5);
    expect(a.accuracy!.targetQuadErrorPx!).toBeLessThan(2);
    expect(a.qa.productPixelsModified).toBe(false);
    expect(reports.find((r)=>r.id==="A-01"&&r.level==="photographic")!.qa.productPixelsModified).toBe(true);

    const b2=reports.find((r)=>r.id==="B-02"&&r.level==="environment")!;
    expect(b2.automation.occlusion).toBe("manual");

    // outputs
    for(const f of ["index.html","summary.json","A-01/environment/mockup.png","A-01/environment/sheet.jpg","A-01/environment/overlay.jpg","A-01/environment/report.json","B-01/photographic/report.json"]){
      expect(fs.existsSync(path.join(outDir,f)),f).toBe(true);
    }
    // privacy: reports carry no GPS coordinates or absolute input paths; outputs carry no EXIF
    const all=fs.readFileSync(path.join(outDir,"summary.json"),"utf8");
    expect(all).not.toMatch(/51\/1|GPSLatitude|0\/1 31/);
    expect(all).not.toContain(inDir);
    expect(a.inputs.source.exif.hasGps).toBeTypeOf("boolean");
    const outMeta=await sharp(fs.readFileSync(path.join(outDir,"A-01/environment/mockup.png"))).metadata();
    expect(outMeta.exif).toBeUndefined();
    expect(summary.cases).toBe(6);
    expect(summary.accuracy.targetQuadErrorPx.n).toBeGreaterThanOrEqual(2);
  });

  it("refuses to write customer output into a git-tracked (non-ignored) location",()=>{
    const bad=path.resolve(__dirname,"..","..","docs","would-be-leak");
    expect(()=>assertOutputIgnored(bad)).toThrow(/NOT ignored/);
    fs.rmSync(bad,{recursive:true,force:true});
    expect(()=>assertOutputIgnored(path.resolve(__dirname,"..","..","validation-output","selftest"))).not.toThrow();
    fs.rmSync(path.resolve(__dirname,"..","..","validation-output"),{recursive:true,force:true});
  });

  it("reports an unreadable input as a blocker with an HEIC hint instead of crashing the batch",async()=>{
    const dir=path.join(root,"bad");fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,"x.heic"),Buffer.from("not an image"));
    fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify({version:1,cases:[{id:"X",mode:"artwork-in-frame",source:"x.heic",reference:"x.heic"}]}));
    const {reports}=await runValidation(path.join(dir,"manifest.json"),path.join(root,"bad-out"),{levels:["environment"]});
    expect(reports[0].status).toBe("fail");
    expect(reports[0].defects[0].message).toMatch(/HEIC|JPEG/);
  });
});
