import {describe,expect,it} from "vitest";
import {castWallShadows,shadowTintForKelvin} from "@/lib/mockup-v3/composite/shadow";
import {buildShadowMask,lightOverrideFor,shadowDirFromDeg} from "@/lib/mockup-v3/rooms/light";
import type {Quad,RawImage} from "@/lib/mockup-v3/types";
import {syntheticRoom} from "../helpers/rooms";

const W=600,H=450;
const wall=(g=200):RawImage=>{const d=new Uint8ClampedArray(W*H*4);for(let i=0;i<W*H;i++){d[i*4]=g;d[i*4+1]=g;d[i*4+2]=g;d[i*4+3]=255;}return {width:W,height:H,data:d};};
const quad:Quad=[{x:240,y:160},{x:360,y:160},{x:360,y:290},{x:240,y:290}];
const centre={x:300,y:225};
const base={depthPx:12,dropStrength:0.4,contactStrength:0};
const darkening=(a:RawImage,b:RawImage,ch=0)=>{const o=new Float32Array(W*H);for(let i=0;i<W*H;i++) o[i]=Math.max(0,(a.data[i*4+ch]-b.data[i*4+ch])/Math.max(1,a.data[i*4+ch]));return o;};
const maxOf=(a:Float32Array)=>{let m=0;for(let i=0;i<a.length;i++) if(a[i]>m) m=a[i];return m;};
const centroid=(d:Float32Array)=>{let sx=0,sy=0,s=0;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const v=d[y*W+x];if(v>0){sx+=x*v;sy+=y*v;s+=v;}}return {x:sx/s-centre.x,y:sy/s-centre.y};};

describe("calibrated light override (shadow direction, intensity, softness, colour temperature)",()=>{
  it.each([0,45,63,90,135,180,270])("direction %d°: the shadow falls where the calibration says (within 12°)",(deg)=>{
    const dir=shadowDirFromDeg(deg);
    const out=castWallShadows(wall(),quad,{width:120,height:130},{...base,dir,softnessPx:3}).image;
    const c=centroid(darkening(wall(),out));
    const got=Math.atan2(c.y,c.x)*180/Math.PI;
    const diff=Math.abs(((got-deg)%360+540)%360-180);
    expect(diff).toBeLessThan(12);
  });
  it("intensity scales the darkness monotonically and linearly, and 0 draws nothing",()=>{
    const peak=(k:number)=>maxOf(darkening(wall(),castWallShadows(wall(),quad,{width:120,height:130},{...base,dir:shadowDirFromDeg(63),dropStrength:k,softnessPx:3}).image));
    const a=peak(0.1),b=peak(0.3),c=peak(0.5);
    expect(a).toBeLessThan(b);expect(b).toBeLessThan(c);
    expect(b/a).toBeGreaterThan(2.4);expect(b/a).toBeLessThan(3.6);
    expect(peak(0)).toBe(0);
  });
  it("softness widens the penumbra without changing where the shadow falls",()=>{
    const width=(s:number)=>{
      const out=castWallShadows(wall(),quad,{width:120,height:130},{...base,dir:{x:1,y:0},softnessPx:s}).image;
      const d=darkening(wall(),out);let n=0;
      for(let x=0;x<W;x++){const v=d[225*W+x];if(v>0.004&&v<0.9*0.4) n++;} // pixels in the fading part of the shadow along a row
      return {n,c:centroid(d)};
    };
    const sharp=width(1),soft=width(8);
    expect(soft.n).toBeGreaterThan(sharp.n+6);
    expect(Math.abs(Math.atan2(soft.c.y,soft.c.x)-Math.atan2(sharp.c.y,sharp.c.x))).toBeLessThan(0.15);
  });
  it("colour temperature tints the shadow: warm light leaves cooler shadows, neutral is neutral, cool the reverse",()=>{
    const ratio=(k:number)=>{
      const out=castWallShadows(wall(),quad,{width:120,height:130},{...base,dir:{x:1,y:0},softnessPx:3,tint:shadowTintForKelvin(k)}).image;
      const dr=darkening(wall(),out,0),db=darkening(wall(),out,2);
      let sr=0,sb=0;for(let i=0;i<dr.length;i++){sr+=dr[i];sb+=db[i];}
      return sr/sb;
    };
    expect(ratio(3000)).toBeGreaterThan(1.08);
    expect(Math.abs(ratio(6500)-1)).toBeLessThan(0.04);
    expect(ratio(10000)).toBeLessThan(0.97);
    for(const k of [2000,3200,6500,9000,12000]){const t=shadowTintForKelvin(k);expect((t[0]+t[1]+t[2])/3).toBeCloseTo(1,6);}
    expect(ratio(3000)).toBeGreaterThan(ratio(4500));expect(ratio(4500)).toBeGreaterThan(ratio(6500));
  });
  it("without an override the old behaviour is unchanged (no tint, same blur rule)",()=>{
    const a=castWallShadows(wall(),quad,{width:120,height:130},{...base,dir:{x:0.5,y:0.87},softness:0.7}).image;
    const b=castWallShadows(wall(),quad,{width:120,height:130},{...base,dir:{x:0.5,y:0.87},softness:0.7,tint:undefined,allow:undefined,softnessPx:undefined}).image;
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });
});

describe("wall-only shadow mask",()=>{
  it("shadow never darkens a pixel outside the mask, and is scaled by soft mask edges",()=>{
    const allow=new Uint8Array(W*H);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++) allow[y*W+x]=x<330?255:(x<345?128:0); // 'furniture' begins at x=330
    const none=castWallShadows(wall(),quad,{width:120,height:130},{...base,dir:{x:1,y:0},softnessPx:6}).image;
    const out=castWallShadows(wall(),quad,{width:120,height:130},{...base,dir:{x:1,y:0},softnessPx:6,allow}).image;
    const w0=wall();
    let changedOutside=0,reducedInside=0;
    for(let i=0;i<W*H;i++){
      const x=i%W;
      if(allow[i]===0&&out.data[i*4]!==w0.data[i*4]) changedOutside++;
      if(allow[i]===255&&out.data[i*4]!==none.data[i*4]) reducedInside++;
      if(allow[i]===128){const dn=200-none.data[i*4],dm=200-out.data[i*4];expect(dm).toBeLessThanOrEqual(dn);}
      void x;
    }
    expect(changedOutside).toBe(0);expect(reducedInside).toBe(0);
    expect(maxOf(darkening(wall(),none))).toBeGreaterThan(0.05);
  });
  it("buildShadowMask: wall polygons minus furniture, at the room image's resolution, no stored image",()=>{
    const s=syntheticRoom({withPlant:true});
    const m=buildShadowMask(s.room)!;
    expect(m.width).toBe(s.room.image.width);expect(m.height).toBe(s.room.image.height);
    // on the wall: 255; far outside the wall: 0; on the plant polygon: 0
    const c=s.truth(105,85);
    expect(m.alpha[Math.round(c.y)*m.width+Math.round(c.x)]).toBe(255);
    expect(m.alpha[2*m.width+2]).toBe(0);
    const poly=s.plant!.polygon;const px=Math.round(poly.reduce((a,p)=>a+p.x,0)/poly.length),py=Math.round(poly.reduce((a,p)=>a+p.y,0)/poly.length);
    expect(m.alpha[py*m.width+px]).toBe(0);
  });
  it("buildShadowMask returns null when no wall polygon is stored",()=>{
    const s=syntheticRoom();s.room.shadowMask=undefined;
    expect(buildShadowMask(s.room)).toBeNull();
  });
  it("lightOverrideFor converts the room's calibrated light (degrees, cm) to engine units",()=>{
    const s=syntheticRoom({light:{shadowDirectionDeg:90,softnessCm:2,intensity:0.4,colourTempK:5000}});
    const lo=lightOverrideFor(s.room,3.5);
    expect(lo.shadowDir.x).toBeCloseTo(0,10);expect(lo.shadowDir.y).toBeCloseTo(1,10);
    expect(lo.softnessPx).toBeCloseTo(7,10);expect(lo.intensity).toBe(0.4);expect(lo.colourTempK).toBe(5000);
  });
});
