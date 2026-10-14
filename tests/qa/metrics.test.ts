import {describe,expect,it} from "vitest";
import type {RawImage} from "@/lib/mockup-v3/types";
import {compareImages,evaluateFidelity,srgbToLab} from "@/lib/mockup-v3/qa/metrics";
import {solidImage} from "@/lib/mockup-v3/geometry/warp";
import {artworkPattern,mulberry32,tint} from "../helpers/fixtures";

function boxBlur(img:RawImage,r:number):RawImage{
  const out=new Uint8ClampedArray(img.data);
  for(let y=0;y<img.height;y++) for(let x=0;x<img.width;x++){
    for(let c=0;c<3;c++){
      let s=0,n=0;
      for(let j=-r;j<=r;j++) for(let i=-r;i<=r;i++){
        const xx=Math.min(img.width-1,Math.max(0,x+i));
        const yy=Math.min(img.height-1,Math.max(0,y+j));
        s+=img.data[(yy*img.width+xx)*4+c];n++;
      }
      out[(y*img.width+x)*4+c]=s/n;
    }
  }
  return {width:img.width,height:img.height,data:out};
}

function noisy(img:RawImage,sigma:number,seed:number):RawImage{
  const rnd=mulberry32(seed);
  const out=new Uint8ClampedArray(img.data);
  for(let i=0;i<img.width*img.height;i++) for(let c=0;c<3;c++){
    const g=(rnd()+rnd()+rnd()+rnd()-2)*Math.sqrt(3)*sigma;
    out[i*4+c]+=g;
  }
  return {width:img.width,height:img.height,data:out};
}

function shifted(img:RawImage,dx:number,dy:number):RawImage{
  const out=new Uint8ClampedArray(img.data.length);
  for(let y=0;y<img.height;y++) for(let x=0;x<img.width;x++){
    const sx=Math.min(img.width-1,Math.max(0,x-dx));
    const sy=Math.min(img.height-1,Math.max(0,y-dy));
    out.set(img.data.subarray((sy*img.width+sx)*4,(sy*img.width+sx)*4+4),(y*img.width+x)*4);
  }
  return {width:img.width,height:img.height,data:out};
}

describe("srgbToLab (reference values)",()=>{
  const near=(v:[number,number,number],e:[number,number,number],tol=0.15)=>{
    expect(Math.abs(v[0]-e[0])).toBeLessThan(tol);
    expect(Math.abs(v[1]-e[1])).toBeLessThan(tol);
    expect(Math.abs(v[2]-e[2])).toBeLessThan(tol);
  };
  it("matches published D65 values for white, black and primaries",()=>{
    near(srgbToLab(255,255,255),[100,0,0]);
    near(srgbToLab(0,0,0),[0,0,0]);
    near(srgbToLab(255,0,0),[53.24,80.09,67.20]);
    near(srgbToLab(0,255,0),[87.73,-86.18,83.18]);
    near(srgbToLab(0,0,255),[32.30,79.19,-107.86]);
  });
});

describe("compareImages",()=>{
  const a=artworkPattern(240,180,5);

  it("identical images are perfect",()=>{
    const m=compareImages(a,a);
    expect(m.mae).toBe(0);
    expect(m.meanDeltaE).toBe(0);
    expect(m.psnr).toBe(Infinity);
    expect(m.ssim).toBeCloseTo(1,6);
    expect(m.sharpnessRatio).toBeCloseTo(1,6);
    expect(evaluateFidelity(m).pass).toBe(true);
  });

  it("throws on size mismatch and tiny regions",()=>{
    expect(()=>compareImages(a,artworkPattern(100,100))).toThrow(/mismatch/);
    expect(()=>compareImages(solidImage(10,10,[0,0,0,255]),solidImage(10,10,[0,0,0,255]),{margin:4})).toThrow();
  });

  it("detects a colour cast and names it",()=>{
    const m=compareImages(a,tint(a,12,0,0));
    const r=evaluateFidelity(m);
    expect(r.pass).toBe(false);
    expect(r.failures.map((f)=>f.code)).toContain("COLOUR_DRIFT");
    expect(m.labBias.a).toBeGreaterThan(2);
  });

  it("detects a subtle global brightness shift via Lab bias even though MAE is tiny",()=>{
    const m=compareImages(a,tint(a,3,3,3));
    expect(m.mae).toBeLessThan(3.1);
    const r=evaluateFidelity(m);
    expect(r.failures.map((f)=>f.code)).toContain("COLOUR_BIAS");
  });

  it("detects blur",()=>{
    const m=compareImages(a,boxBlur(a,2));
    const r=evaluateFidelity(m);
    expect(m.sharpnessRatio).toBeLessThan(0.6);
    expect(r.pass).toBe(false);
    expect(r.failures.map((f)=>f.code)).toContain("SOFTENED");
  });

  it("detects a small misregistration (3px shift)",()=>{
    const m=compareImages(a,shifted(a,3,2));
    expect(evaluateFidelity(m).pass).toBe(false);
  });

  it("tolerates mild sensor-like noise (sigma 1.5) without false alarm",()=>{
    const m=compareImages(a,noisy(a,1.5,99));
    console.log("[metrics] sigma=1.5 noise:",JSON.stringify({dE:+m.meanDeltaE.toFixed(3),p95:+m.p95DeltaE.toFixed(3),ssim:+m.ssim.toFixed(4),sharp:+m.sharpnessRatio.toFixed(3)}));
    expect(m.meanDeltaE).toBeLessThan(2);
  });

  it("margin excludes the border region",()=>{
    const bad=new Uint8ClampedArray(a.data);
    for(let x=0;x<a.width;x++){bad[x*4]=0;bad[x*4+1]=0;bad[x*4+2]=0;}
    const noisyTop:RawImage={width:a.width,height:a.height,data:bad};
    expect(compareImages(a,noisyTop).meanDeltaE).toBeGreaterThan(0);
    expect(compareImages(a,noisyTop,{margin:3}).meanDeltaE).toBe(0);
  });
});
