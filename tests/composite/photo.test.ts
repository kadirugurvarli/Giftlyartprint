import {describe,expect,it} from "vitest";
import type {Quad} from "@/lib/mockup-v3/types";
import {addGrain,estimateCameraTexture,estimateEdgeBlur,estimateGrain,glassSheen,softenLayer} from "@/lib/mockup-v3/composite/photo";
import {compareImages} from "@/lib/mockup-v3/qa/metrics";
import {solidImage,pixelAt} from "@/lib/mockup-v3/geometry/warp";
import {gaussianBlurPlane} from "@/lib/mockup-v3/vision/gray";
import {addSensorNoise,plainBackground} from "../helpers/scenes";
import {artworkPattern} from "../helpers/fixtures";

describe("camera texture estimation (from the reference photo)",()=>{
  it("measures fine noise level accurately (within 15% above 1.5 levels, within 0.5 level below)",()=>{
    const lumaStd=(img:ReturnType<typeof solidImage>)=>{
      let m=0;const n=img.width*img.height;const L=new Float64Array(n);
      for(let i=0;i<n;i++){L[i]=0.2126*img.data[i*4]+0.7152*img.data[i*4+1]+0.0722*img.data[i*4+2];m+=L[i];}
      m/=n;let v=0;for(let i=0;i<n;i++) v+=(L[i]-m)**2;
      return Math.sqrt(v/n);
    };
    for(const sigma of [1.0,2.0,3.5]){
      const wall=addSensorNoise(solidImage(800,600,[200,196,188,255]),sigma,11);
      const est=estimateGrain(wall);
      const truth=lumaStd(wall);
      console.log(`[grain] luma std ${truth.toFixed(2)} -> estimated ${est.sigma.toFixed(2)} (${est.samples} samples)`);
      if(truth>=1.5) expect(Math.abs(est.sigma-truth)/truth).toBeLessThan(0.15);
      else expect(Math.abs(est.sigma-truth)).toBeLessThan(0.5);
    }
  });
  it("ignores edges and excluded (occluded) pixels",()=>{
    const wall=addSensorNoise(solidImage(600,400,[200,196,188,255]),1.5,3);
    for(let y=100;y<300;y++) for(let x=200;x<400;x++) wall.data.set([20,20,20,255],(y*600+x)*4);
    const clean=estimateGrain(wall).sigma;
    expect(clean).toBeLessThan(2.6);
  });
  it("reports a default (flagged) when there is no flat surface",()=>{
    const busy=artworkPattern(300,200,5);
    const t=estimateCameraTexture(busy);
    expect(["measured","default"]).toContain(t.grainSource);
  });
  it("estimates edge softness: a sharp edge and a blurred edge are told apart",()=>{
    const mk=(sigma:number)=>{
      const w=400,h=300,f=new Float32Array(w*h);
      for(let y=0;y<h;y++) for(let x=0;x<w;x++) f[y*w+x]=x<200?60:200;
      const b=sigma>0?gaussianBlurPlane(f,w,h,sigma):f;
      const img=solidImage(w,h,[0,0,0,255]);
      for(let i=0;i<w*h;i++){img.data[i*4]=b[i];img.data[i*4+1]=b[i];img.data[i*4+2]=b[i];}
      return img;
    };
    const sharp=estimateEdgeBlur(mk(0),{x:200,y:20},{x:200,y:280})!;
    const soft=estimateEdgeBlur(mk(1.8),{x:200,y:20},{x:200,y:280})!;
    console.log(`[blur] sharp edge -> ${sharp.toFixed(2)}px, sigma 1.8 edge -> ${soft.toFixed(2)}px`);
    expect(soft).toBeGreaterThan(1.3);expect(soft).toBeLessThan(2.4);
    expect(sharp).toBeLessThan(0.7);
  });
});

describe("texture/sheen effects are bounded, deterministic and hue-neutral",()=>{
  const layer=(()=>{const l=artworkPattern(300,200,9);return l;})();
  it("grain: deterministic, zero-mean, matches the requested sigma, leaves transparent pixels alone",()=>{
    const flat=solidImage(300,200,[128,128,128,255]);
    flat.data[3]=0; // one transparent pixel
    const a=addGrain(flat,3,42),b=addGrain(flat,3,42),c=addGrain(flat,3,43);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false);
    let s=0,s2=0,n=0;
    for(let i=1;i<300*200;i++){const d=a.data[i*4+1]-128;s+=d;s2+=d*d;n++;}
    expect(Math.abs(s/n)).toBeLessThan(0.1);
    expect(Math.sqrt(s2/n)).toBeGreaterThan(2.6);expect(Math.sqrt(s2/n)).toBeLessThan(3.4);
    expect(a.data[3]).toBe(0);
  });
  it("grain keeps mean colour (chroma shift ~0)",()=>{
    const m=compareImages(layer,addGrain(layer,2.5,1),{margin:2});
    expect(Math.abs(m.labBias.a)).toBeLessThan(0.15);
    expect(Math.abs(m.labBias.b)).toBeLessThan(0.15);
    expect(Math.abs(m.labBias.L)).toBeLessThan(0.2);
  });
  it("softening lowers sharpness by a bounded amount and never shifts colour",()=>{
    const soft=softenLayer(layer,0.9);
    const m=compareImages(layer,soft,{margin:3});
    expect(m.sharpnessRatio).toBeLessThan(1);
    expect(m.sharpnessRatio).toBeGreaterThan(0.4);
    expect(Math.abs(m.labBias.a)).toBeLessThan(0.2);
    expect(softenLayer(layer,0.1)).toBe(layer);
  });
  it("softening does not darken the matte edge (premultiplied blur)",()=>{
    const l=solidImage(60,60,[0,0,0,0]);
    for(let y=15;y<45;y++) for(let x=15;x<45;x++) l.data.set([220,220,220,255],(y*60+x)*4);
    const s=softenLayer(l,1.2);
    for(let y=14;y<46;y++) for(let x=14;x<46;x++){const p=pixelAt(s,x,y);if(p[3]>0) expect(p[0]).toBeGreaterThan(205);}
  });
  it("glass sheen only lightens, is hue-neutral, bounded by its strength, and confined to the glazing",()=>{
    const q:Quad=[{x:60,y:40},{x:240,y:40},{x:240,y:160},{x:60,y:160}];
    const base=solidImage(300,200,[90,110,140,255]);
    const out=glassSheen(base,q,{x:-0.6,y:-0.8},0.05);
    let maxLift=0,darker=0;
    for(let y=0;y<200;y++) for(let x=0;x<300;x++){
      const a=pixelAt(base,x,y),b=pixelAt(out,x,y);
      const inside=x>=60&&x<240&&y>=40&&y<160;
      if(!inside) expect(b).toEqual(a);
      for(let c=0;c<3;c++){if(b[c]<a[c]) darker++;maxLift=Math.max(maxLift,b[c]-a[c]);}
    }
    expect(darker).toBe(0);
    expect(maxLift).toBeGreaterThan(3);expect(maxLift).toBeLessThan(20);
    const m=compareImages(base,out,{margin:0});
    void m;
    expect(glassSheen(base,q,{x:1,y:1},0)).toBe(base);
  });
});
void plainBackground;
