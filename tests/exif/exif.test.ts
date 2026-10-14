import {describe,expect,it} from "vitest";
import sharp from "sharp";
import {cropCaution,focalPxFromExif,readExif} from "@/lib/mockup-v3/exif";
import {decodeImage} from "@/lib/mockup-v3/io";

const jpeg=(w:number,h:number,exif:Record<string,Record<string,string>>,orientation?:number)=>{
  let s=sharp({create:{width:w,height:h,channels:3,background:"#8a7f70"}}).withExif(exif as any);
  if(orientation) s=s.withMetadata({orientation});
  return s.jpeg({quality:90}).toBuffer();
};

describe("focalPxFromExif",()=>{
  it("35mm-equivalent: 26mm on a 4000x3000 image is ~3004px (diagonal rule)",()=>{
    const r=focalPxFromExif({width:4000,height:3000,f35:26});
    expect(r.source).toBe("35mm-equivalent");
    expect(r.focalPx!).toBeCloseTo(26*5000/43.27,1);
  });
  it("is aspect-ratio aware: the same lens on a 3:2 sensor gives a different pixel focal for the same width",()=>{
    const a=focalPxFromExif({width:3000,height:2000,f35:35}).focalPx!,b=focalPxFromExif({width:3000,height:2250,f35:35}).focalPx!;
    expect(b).toBeGreaterThan(a);
  });
  it("falls back to focal-plane resolution and rescales for resized images",()=>{
    // 6mm lens, 1000 px/mm sensor => 6000px at native 4000px wide; at 2000px wide => 3000px
    expect(focalPxFromExif({width:4000,height:3000,focalMm:6,fpXRes:25400,fpUnit:2,exifWidth:4000}).focalPx!).toBeCloseTo(6000,0);
    expect(focalPxFromExif({width:2000,height:1500,focalMm:6,fpXRes:25400,fpUnit:2,exifWidth:4000}).focalPx!).toBeCloseTo(3000,0);
  });
  it("returns nothing rather than guessing",()=>{
    expect(focalPxFromExif({width:100,height:100}).source).toBe("none");
    expect(focalPxFromExif({width:100,height:100,focalMm:6}).focalPx).toBeUndefined();
  });
});

describe("readExif",()=>{
  it("reads camera, focal lengths and derives focalPx from a real JPEG",async()=>{
    const buf=await jpeg(1600,1200,{IFD0:{Make:"TestCam",Model:"Phone 1"},IFD2:{FocalLength:"6/1",FocalLengthIn35mmFilm:"28"}});
    const e=await readExif(buf);
    expect(e.make).toBe("TestCam");expect(e.model).toBe("Phone 1");
    expect(e.focalLength35mm).toBe(28);
    expect(e.focalSource).toBe("35mm-equivalent");
    expect(e.focalPx!).toBeCloseTo(28*2000/43.27,0);
    expect(e.hasExif).toBe(true);
  });
  it("applies EXIF orientation to the reported size (portrait phone shots)",async()=>{
    const buf=await jpeg(1600,1200,{IFD2:{FocalLengthIn35mmFilm:"28"}},6);
    const e=await readExif(buf);
    expect({w:e.width,h:e.height}).toEqual({w:1200,h:1600});
    const raw=await decodeImage(buf);
    expect({w:raw.width,h:raw.height}).toEqual({w:1200,h:1600});
  });
  it("never exposes GPS coordinates, only that GPS exists",async()=>{
    const buf=await jpeg(800,600,{IFD3:{GPSLatitudeRef:"N",GPSLatitude:"51/1 16/1 30/1",GPSLongitudeRef:"E",GPSLongitude:"0/1 31/1 12/1"}});
    const e=await readExif(buf);
    const text=JSON.stringify(e);
    expect(text).not.toMatch(/51/);
    expect(text.toLowerCase()).not.toContain("latitude");
    expect(typeof e.hasGps).toBe("boolean");
  });
  it("handles images without EXIF",async()=>{
    const buf=await sharp({create:{width:200,height:100,channels:3,background:"#fff"}}).png().toBuffer();
    const e=await readExif(buf);
    expect(e.hasExif).toBe(false);expect(e.focalSource).toBe("none");expect(e.focalPx).toBeUndefined();
  });
  it("warns when the image has been cropped since capture (focal estimate unreliable)",()=>{
    expect(cropCaution(4000,3000,1600,900)).toMatch(/cropped/);
    expect(cropCaution(4000,3000,2000,1500)).toBeUndefined();   // resized, not cropped
    expect(cropCaution(4000,3000,1500,2000)).toBeUndefined();   // rotated, not cropped
    expect(cropCaution(undefined,undefined,100,100)).toBeUndefined();
  });
});
