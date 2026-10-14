import {describe,expect,it} from "vitest";
import type {Quad} from "@/lib/mockup-v3/types";
import {compositeOver,pixelAt,rectifyQuad,solidImage,warpToQuad} from "@/lib/mockup-v3/geometry/warp";
import {applyHomography,homographyFromPoints,invertMat3} from "@/lib/mockup-v3/geometry/homography";
import {quadArea,rectQuad} from "@/lib/mockup-v3/geometry/quad";
import {compareImages} from "@/lib/mockup-v3/qa/metrics";
import {artworkPattern,checkerboard,mulberry32} from "../helpers/fixtures";

const maxAbsDiff=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>{
  let m=0;
  for(let i=0;i<a.length;i++) m=Math.max(m,Math.abs(a[i]-b[i]));
  return m;
};

describe("warpToQuad: exactness cases",()=>{
  const src=artworkPattern(120,90,3);

  it("identity quad reproduces the source exactly",()=>{
    const out=warpToQuad(src,rectQuad(120,90),120,90);
    expect(maxAbsDiff(out.data,src.data)).toBe(0);
  });

  it("integer translation is exact; everything outside is fully transparent",()=>{
    const q:Quad=[{x:10,y:7},{x:130,y:7},{x:130,y:97},{x:10,y:97}];
    const out=warpToQuad(src,q,160,120);
    for(let y=0;y<120;y++){
      for(let x=0;x<160;x++){
        const o=pixelAt(out,x,y);
        const inside=x>=10 && x<130 && y>=7 && y<97;
        if(inside){
          const s=pixelAt(src,x-10,y-7);
          expect(o).toEqual(s);
        }else{
          expect(o[3]).toBe(0);
        }
      }
    }
  });

  it("90-degree rotation (corner relabelling) is exact",()=>{
    // source TL,TR,BR,BL -> destination TR,BR,BL,TL : clockwise 90deg, output is 90x120
    const q:Quad=[{x:90,y:0},{x:90,y:120},{x:0,y:120},{x:0,y:0}];
    const out=warpToQuad(src,q,90,120);
    for(let y=0;y<120;y++){
      for(let x=0;x<90;x++){
        // clockwise rotation: out(x,y) = src(y, 89-x)
        expect(pixelAt(out,x,y)).toEqual(pixelAt(src,y,89-x));
      }
    }
  });

  it("rejects mirrored, bow-tie and degenerate quads instead of silently flipping artwork",()=>{
    const r=rectQuad(120,90);
    const mirrored:Quad=[r[1],r[0],r[3],r[2]];
    expect(()=>warpToQuad(src,mirrored,200,200)).toThrow(/WRONG_WINDING/);
    const bow:Quad=[r[0],r[2],r[1],r[3]];
    expect(()=>warpToQuad(src,bow,200,200)).toThrow(/NOT_CONVEX/);
    const flat:Quad=[{x:0,y:0},{x:50,y:0},{x:100,y:0},{x:150,y:0}];
    expect(()=>warpToQuad(src,flat,200,200)).toThrow();
    // explicit opt-in works and really mirrors
    const out=warpToQuad(src,mirrored,120,90,{allowMirrored:true});
    expect(pixelAt(out,0,10)).toEqual(pixelAt(src,119,10));
  });

  it("is deterministic",()=>{
    const q:Quad=[{x:20,y:15},{x:170,y:30},{x:150,y:130},{x:10,y:110}];
    const a=warpToQuad(src,q,200,150);
    const b=warpToQuad(src,q,200,150);
    expect(maxAbsDiff(a.data,b.data)).toBe(0);
  });
});

describe("warpToQuad: analytic ground truth",()=>{
  it("every pixel away from cell edges matches the colour predicted by the inverse homography",()=>{
    const cell=20,cols=10,rows=8;
    const src=checkerboard(cell*cols,cell*rows,cell,[240,30,30],[20,40,220]);
    const q:Quad=[{x:60,y:40},{x:540,y:90},{x:500,y:420},{x:30,y:340}];
    const out=warpToQuad(src,q,600,480);
    const H=homographyFromPoints(rectQuad(src.width,src.height),q)!;
    const Hi=invertMat3(H)!;

    let checked=0,bad=0;
    for(let y=0;y<480;y++){
      for(let x=0;x<600;x++){
        const o=pixelAt(out,x,y);
        const p=applyHomography(Hi,{x:x+0.5,y:y+0.5})!;
        const inside=p.x>=0 && p.y>=0 && p.x<src.width && p.y<src.height;
        const fx=p.x%cell, fy=p.y%cell;
        // keep clear of cell boundaries by 1.5 output pixels (~ local scale) and of the quad edge
        const margin=2.5;
        const nearEdge=[fx,cell-fx,fy,cell-fy].some((d)=>d<margin) ||
          p.x<margin || p.y<margin || p.x>src.width-margin || p.y>src.height-margin;
        if(!inside){
          if(p.x<-3 || p.y<-3 || p.x>src.width+3 || p.y>src.height+3) expect(o[3]).toBe(0);
          continue;
        }
        if(nearEdge) continue;
        const cx=Math.floor(p.x/cell), cy=Math.floor(p.y/cell);
        const want=((cx+cy)%2===0)?[240,30,30]:[20,40,220];
        checked++;
        if(o[3]!==255 || Math.abs(o[0]-want[0])>2 || Math.abs(o[1]-want[1])>2 || Math.abs(o[2]-want[2])>2) bad++;
      }
    }
    expect(checked).toBeGreaterThan(50000);
    expect(bad).toBe(0);
  });

  it("colour never bleeds at the quad edge: a solid source stays exactly that colour wherever alpha>0",()=>{
    const src=solidImage(80,60,[200,50,50,255]);
    const q:Quad=[{x:10.3,y:12.7},{x:90.2,y:5.1},{x:77.7,y:70.9},{x:4.4,y:55.5}];
    const out=warpToQuad(src,q,100,80);
    let partial=0;
    for(let i=0;i<100*80;i++){
      const a=out.data[i*4+3];
      if(a>0){
        expect(out.data[i*4]).toBe(200);
        expect(out.data[i*4+1]).toBe(50);
        expect(out.data[i*4+2]).toBe(50);
        if(a<255) partial++;
      }
    }
    expect(partial).toBeGreaterThan(20);
  });

  it("covered area equals the quad area (random convex quads, within 0.6%)",()=>{
    const rnd=mulberry32(21);
    const src=solidImage(64,48,[128,128,128,255]);
    for(let n=0;n<30;n++){
      const q:Quad=[
        {x:20+rnd()*40,y:20+rnd()*40},{x:260+rnd()*60,y:20+rnd()*40},
        {x:260+rnd()*60,y:200+rnd()*60},{x:20+rnd()*40,y:200+rnd()*60}
      ];
      const out=warpToQuad(src,q,400,320);
      let cov=0;
      for(let i=0;i<400*320;i++) cov+=out.data[i*4+3]/255;
      expect(Math.abs(cov-quadArea(q))/quadArea(q)).toBeLessThan(0.006);
    }
  });
});

describe("warpToQuad: minification does not alias",()=>{
  const stats=(vals:number[])=>{
    const mean=vals.reduce((s,v)=>s+v,0)/vals.length;
    const sd=Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length);
    return {mean,sd};
  };

  it("a 1px checkerboard shrunk by a NON-integer factor (7.2x) lands at mid grey with low variance",()=>{
    // Non-integer scale on purpose: an exact 8x shrink samples the same phase everywhere and
    // would pass even without anti-aliasing (found by mutation testing).
    const src=checkerboard(512,512,1);
    const q:Quad=[{x:8,y:8},{x:79.1,y:8},{x:79.1,y:79.1},{x:8,y:79.1}];
    const out=warpToQuad(src,q,90,90);
    const vals:number[]=[];
    for(let y=14;y<73;y++) for(let x=14;x<73;x++) vals.push(pixelAt(out,x,y)[0]);
    const {mean,sd}=stats(vals);
    // 50% linear-light mix of black and white = sRGB 188 (not 128: gamma-correct averaging)
    expect(mean).toBeGreaterThan(184);
    expect(mean).toBeLessThan(192);
    expect(sd).toBeLessThan(6);
  });

  it("same holds in the far, strongly minified part of a perspective quad",()=>{
    const src=checkerboard(512,512,1);
    const q:Quad=[{x:150,y:20},{x:250,y:20},{x:380,y:380},{x:20,y:380}];
    const out=warpToQuad(src,q,400,400);
    const vals:number[]=[];
    // rows 30-90: quad is only ~100-140px wide here for 512 source px (>= 3.6x), and far more vertically
    for(let y=30;y<90;y++){
      const t=(y-20)/360;
      const left=150+(20-150)*t, right=250+(380-250)*t;
      for(let x=Math.ceil(left+6);x<right-6;x++) vals.push(pixelAt(out,x,y)[0]);
    }
    const {mean,sd}=stats(vals);
    expect(vals.length).toBeGreaterThan(5000);
    expect(mean).toBeGreaterThan(182);
    expect(mean).toBeLessThan(194);
    expect(sd).toBeLessThan(10);
  });
});

describe("rectify / round trip",()=>{
  it("rectifying the warped quad returns the original within fidelity limits",()=>{
    const src=artworkPattern(400,300,9);
    const q:Quad=[{x:90,y:70},{x:700,y:50},{x:660,y:520},{x:60,y:470}];
    const placed=warpToQuad(src,q,800,600);
    const back=rectifyQuad(placed,q,400,300);
    const m=compareImages(src,back,{margin:3});
    console.log("[roundtrip] 400x300 -> perspective quad -> back:",JSON.stringify({
      meanDeltaE:+m.meanDeltaE.toFixed(3),p95:+m.p95DeltaE.toFixed(3),ssim:+m.ssim.toFixed(4),
      psnr:+m.psnr.toFixed(2),sharp:+m.sharpnessRatio.toFixed(3),bias:m.labBias
    }));
    expect(m.meanDeltaE).toBeLessThan(2.5);
    expect(m.ssim).toBeGreaterThan(0.9);
  });

  it("rectify of an axis-aligned crop at integer offsets is exact",()=>{
    const src=artworkPattern(200,150,2);
    const q:Quad=[{x:20,y:10},{x:120,y:10},{x:120,y:90},{x:20,y:90}];
    const out=rectifyQuad(src,q,100,80);
    for(let y=0;y<80;y++) for(let x=0;x<100;x++){
      expect(pixelAt(out,x,y)).toEqual(pixelAt(src,x+20,y+10));
    }
  });
});

describe("compositeOver",()=>{
  it("opaque layer pixels replace exactly; transparent pixels leave the base untouched",()=>{
    const base=artworkPattern(60,40,1);
    const layer=solidImage(60,40,[0,0,0,0]);
    for(let y=10;y<20;y++) for(let x=10;x<30;x++){
      const o=(y*60+x)*4;
      layer.data.set([12,34,56,255],o);
    }
    const out=compositeOver(base,layer);
    expect(pixelAt(out,15,15)).toEqual([12,34,56,255]);
    expect(pixelAt(out,45,30)).toEqual(pixelAt(base,45,30));
  });
  it("50% white over black blends in linear light (sRGB ~188, not 128)",()=>{
    const out=compositeOver(solidImage(4,4,[0,0,0,255]),solidImage(4,4,[255,255,255,128]));
    const v=pixelAt(out,1,1)[0];
    expect(v).toBeGreaterThan(184);
    expect(v).toBeLessThan(192);
    expect(pixelAt(out,1,1)[3]).toBe(255);
  });
  it("throws on size mismatch",()=>{
    expect(()=>compositeOver(solidImage(4,4,[0,0,0,255]),solidImage(5,4,[0,0,0,255]))).toThrow();
  });
});
