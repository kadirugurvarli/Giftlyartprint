import {describe,expect,it} from "vitest";
import type {Quad,RawImage} from "@/lib/mockup-v3/types";
import {compositeOver,pixelAt,solidImage,warpToQuad} from "@/lib/mockup-v3/geometry/warp";
import {verifyProtectedContent,type ProtectedContentReport} from "@/lib/mockup-v3/qa/protected-content";
import {LOSSY_FORWARD_TOLERANCES} from "@/lib/mockup-v3/qa/metrics";
import {artworkPattern,mulberry32,projectRect,tint,wallScene} from "../helpers/fixtures";

const W=1600,H=1200,F=1400;
const source=artworkPattern(400,300,13);          // 4:3 artwork
const wall=wallScene(W,H);

function place(art:RawImage,quad:Quad){
  return compositeOver(wall,warpToQuad(art,quad,W,H));
}
function noisyCopy(img:RawImage,amp:number,seed:number):RawImage{
  const rnd=mulberry32(seed);
  const d=new Uint8ClampedArray(img.data);
  for(let i=0;i<img.width*img.height;i++) for(let c=0;c<3;c++) d[i*4+c]+=(rnd()-0.5)*2*amp;
  return {...img,data:d};
}
const log=(label:string,r:ProtectedContentReport)=>{
  const m=r.metrics;
  console.log(`[protected/${r.mode}] ${label}: pass=${r.pass} n=${r.comparedPixels} dE=${m.meanDeltaE.toFixed(2)} p95=${m.p95DeltaE.toFixed(2)} ssim=${m.ssim.toFixed(3)} sharp=${m.sharpnessRatio.toFixed(2)} bias(L,a,b)=${m.labBias.L.toFixed(2)},${m.labBias.a.toFixed(2)},${m.labBias.b.toFixed(2)} aspectErr=${r.proportion.relativeError===null?"n/a":(r.proportion.relativeError*100).toFixed(2)+"%"} [${r.proportion.method}] failures=${r.failures.map((f)=>f.code).join(",")||"none"}`);
};
const codes=(r:ProtectedContentReport)=>r.failures.map((f)=>f.code);

// Ground-truth camera geometry for a 4:3 print.
const goodQuad=projectRect({worldW:1.3333,worldH:1,yawDeg:22,pitchDeg:12,distance:3,focalPx:F,imgW:W,imgH:H});
const frontQuad=projectRect({worldW:1.3333,worldH:1,yawDeg:0,pitchDeg:0,rollDeg:3,distance:3,focalPx:F,imgW:W,imgH:H});
const yawOnlyQuad=projectRect({worldW:1.3333,worldH:1,yawDeg:30,pitchDeg:0,distance:3,focalPx:F,imgW:W,imgH:H});
const stretchedQuad=projectRect({worldW:1.7,worldH:1,yawDeg:22,pitchDeg:12,distance:3,focalPx:F,imgW:W,imgH:H});

describe.each(["forward","rectified"] as const)("verifyProtectedContent [%s]",(mode)=>{
  const v=(art:RawImage,comp:RawImage,q:Quad,extra={})=>verifyProtectedContent(art,comp,q,{mode,...extra});

  describe("correct placements pass",()=>{
    it("perspective placement (two vanishing points)",()=>{
      const r=v(source,place(source,goodQuad),goodQuad);
      log("perspective good",r);
      expect(r.failures).toEqual([]);
      expect(r.pass).toBe(true);
      expect(r.proportion.method).toBe("zhang-he");
      expect(r.proportion.relativeError!).toBeLessThan(0.01);
      expect(r.comparedPixels).toBeGreaterThan(100000);
    });
    it("near fronto-parallel placement",()=>{
      const r=v(source,place(source,frontQuad),frontQuad);
      log("fronto-parallel good",r);
      expect(r.pass).toBe(true);
    });
    it("level-camera yaw with a known focal length",()=>{
      const r=v(source,place(source,yawOnlyQuad),yawOnlyQuad,{focalPx:F});
      log("yaw-only, focal given",r);
      expect(r.proportion.reliable).toBe(true);
      expect(r.pass).toBe(true);
    });
    it("tolerates compression-like noise (+/-2.5) with the lossy-export tolerances (forward) / defaults (rectified)",()=>{
      const extra=mode==="forward"?{tolerances:LOSSY_FORWARD_TOLERANCES}:{};
      const r=v(source,noisyCopy(place(source,goodQuad),2.5,4),goodQuad,extra);
      log("noisy composite",r);
      expect(r.pass).toBe(true);
    });
  });

  describe("damage must be caught",()=>{
    it("colour tint on the artwork",()=>{
      const r=v(source,place(tint(source,10,0,-8),goodQuad),goodQuad);
      log("tinted",r);
      expect(r.pass).toBe(false);
      expect(codes(r)).toContain("COLOUR_DRIFT");
    });
    it("subtle brightness drift (+3 on every channel)",()=>{
      const r=v(source,place(tint(source,3,3,3),goodQuad),goodQuad);
      log("brightness +3",r);
      expect(r.pass).toBe(false);
      expect(codes(r)).toContain("COLOUR_BIAS");
    });
    it("artwork that was softened before placement",()=>{
      const tiny=warpToQuad(source,[{x:0,y:0},{x:100,y:0},{x:100,y:75},{x:0,y:75}],100,75);
      const soft=warpToQuad(tiny,[{x:0,y:0},{x:400,y:0},{x:400,y:300},{x:0,y:300}],400,300);
      const r=v(source,place(soft,goodQuad),goodQuad);
      log("pre-softened",r);
      expect(r.pass).toBe(false);
    });
    it("placed into a quad with the wrong proportions (stretched)",()=>{
      const r=v(source,place(source,stretchedQuad),stretchedQuad);
      log("stretched to 1.7:1",r);
      expect(r.pass).toBe(false);
      expect(codes(r)).toContain("PROPORTION_CHANGED");
    });
    it("quad corners drifted 6px from where the artwork was drawn",()=>{
      const placed=place(source,goodQuad);
      const off=goodQuad.map((p)=>({x:p.x+6,y:p.y-4})) as Quad;
      const r=v(source,placed,off);
      log("corner drift 6px",r);
      expect(r.pass).toBe(false);
    });
    it("different artwork in the frame",()=>{
      const r=v(source,place(artworkPattern(400,300,999),goodQuad),goodQuad);
      log("different art",r);
      expect(r.pass).toBe(false);
    });
  });

  describe("honesty about unreliable proportion checks",()=>{
    it("level-camera yaw WITHOUT a known focal is flagged unreliable and not enforced",()=>{
      const wrong=projectRect({worldW:1.7,worldH:1,yawDeg:30,pitchDeg:0,distance:3,focalPx:F,imgW:W,imgH:H});
      const r=v(source,place(source,wrong),wrong);
      log("yaw-only, no focal, wrong aspect",r);
      expect(r.proportion.method).toBe("assumed-focal");
      expect(r.proportion.reliable).toBe(false);
      expect(codes(r)).not.toContain("PROPORTION_CHANGED");
    });
    it("...but the same wrong aspect IS caught once the focal is known",()=>{
      const wrong=projectRect({worldW:1.7,worldH:1,yawDeg:30,pitchDeg:0,distance:3,focalPx:F,imgW:W,imgH:H});
      const r=v(source,place(source,wrong),wrong,{focalPx:F});
      expect(codes(r)).toContain("PROPORTION_CHANGED");
    });
  });
});

describe("forward mode is tight (this is why it exists)",()=>{
  it("a faithful composite matches almost exactly",()=>{
    const r=verifyProtectedContent(source,place(source,goodQuad),goodQuad,{mode:"forward"});
    log("exact",r);
    expect(r.metrics.meanDeltaE).toBeLessThan(0.05);
    expect(r.metrics.ssim).toBeGreaterThan(0.999);
    expect(Math.abs(r.metrics.sharpnessRatio-1)).toBeLessThan(0.01);
  });
  it("the strict lossless tolerances reject codec-like noise (use LOSSY_FORWARD_TOLERANCES for JPEG exports)",()=>{
    const r=verifyProtectedContent(source,noisyCopy(place(source,goodQuad),2.5,4),goodQuad,{mode:"forward"});
    expect(r.pass).toBe(false);
  });
  it("detects a +2 brightness drift that is invisible to the eye",()=>{
    const r=verifyProtectedContent(source,place(tint(source,2,2,2),goodQuad),goodQuad,{mode:"forward"});
    log("brightness +2",r);
    expect(r.pass).toBe(false);
  });
  it("detects a faint overlay across the artwork (e.g. a stray watermark)",()=>{
    const comp=place(source,goodQuad);
    const banner=solidImage(W,H,[0,0,0,0]);
    for(let y=560;y<600;y++) for(let x=520;x<860;x++) banner.data.set([255,255,255,200],(y*W+x)*4);
    const dirty=compositeOver(comp,banner);
    const r=verifyProtectedContent(source,dirty,goodQuad,{mode:"forward"});
    log("overlay",r);
    expect(r.pass).toBe(false);
    expect(pixelAt(dirty,600,580)[0]).toBeGreaterThan(200);
  });
  it("an occluder is fine when it is excluded via includeMask, and still flagged without it",()=>{
    const comp=place(source,goodQuad);
    const occ=solidImage(W,H,[0,0,0,0]);
    const mask=new Uint8Array(W*H).fill(1);
    for(let y=500;y<700;y++) for(let x=600;x<700;x++){
      occ.data.set([40,30,25,255],(y*W+x)*4);
      mask[y*W+x]=0;
    }
    const withOcc=compositeOver(comp,occ);
    const flagged=verifyProtectedContent(source,withOcc,goodQuad,{mode:"forward"});
    const excluded=verifyProtectedContent(source,withOcc,goodQuad,{mode:"forward",includeMask:mask});
    log("occluder, no mask",flagged);
    log("occluder, masked",excluded);
    expect(flagged.pass).toBe(false);
    expect(excluded.pass).toBe(true);
  });
});
