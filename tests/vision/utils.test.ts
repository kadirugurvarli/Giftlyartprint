import {describe,expect,it} from "vitest";
import type {Pt,Quad} from "@/lib/mockup-v3/types";
import {gaussianBlurPlane,sobel,toGray,type Mask} from "@/lib/mockup-v3/vision/gray";
import {connectedComponents,dilate,erode,fillHoles,maskArea,newMask,rasterizePolygons,featherAlpha} from "@/lib/mockup-v3/vision/mask";
import {convexHull,hullToQuad,lineIntersection,lineThrough,polygonArea,robustLineFit,distanceToLine} from "@/lib/mockup-v3/vision/lines";
import {solidImage} from "@/lib/mockup-v3/geometry/warp";
import {mulberry32} from "../helpers/fixtures";

describe("gaussian blur / sobel",()=>{
  it("preserves the mean and spreads an impulse symmetrically",()=>{
    const w=21,h=21,src=new Float32Array(w*h);
    src[10*w+10]=100;
    const out=gaussianBlurPlane(src,w,h,2);
    expect(out.reduce((s,v)=>s+v,0)).toBeCloseTo(100,2);
    expect(out[10*w+9]).toBeCloseTo(out[10*w+11],5);
    expect(out[9*w+10]).toBeCloseTo(out[11*w+10],5);
    expect(out[10*w+10]).toBeGreaterThan(out[10*w+12]);
  });
  it("sobel responds to a vertical step edge only at the edge",()=>{
    const img=solidImage(20,10,[0,0,0,255]);
    for(let y=0;y<10;y++) for(let x=10;x<20;x++) img.data.set([200,200,200,255],(y*20+x)*4);
    const {mag,gx,gy}=sobel(toGray(img));
    expect(mag[5*20+10]).toBeGreaterThan(40);
    expect(mag[5*20+3]).toBe(0);
    expect(Math.abs(gy[5*20+10])).toBeLessThan(1e-6);
    expect(gx[5*20+10]).toBeGreaterThan(0);
  });
});

describe("mask operations",()=>{
  const mk=(rows:string[]):Mask=>{
    const m=newMask(rows[0].length,rows.length);
    rows.forEach((r,y)=>[...r].forEach((c,x)=>{m.data[y*m.width+x]=c==="#"?1:0;}));
    return m;
  };
  it("labels 4-connected components and flags border contact",()=>{
    const m=mk(["##....#","##....#","......#","..##...","..##..."]);
    const {components}=connectedComponents(m);
    expect(components.length).toBe(3);
    expect(components.map((c)=>c.area).sort()).toEqual([3,4,4]);
    expect(components.filter((c)=>c.touchesBorder).length).toBe(3);
  });
  it("diagonal-only contact is NOT connected (4-connectivity)",()=>{
    expect(connectedComponents(mk(["#.",".#"])).components.length).toBe(2);
  });
  it("fills enclosed holes but not notches open to the border",()=>{
    const m=mk(["#####","#...#","#.#.#","#...#","#####"]);
    expect(maskArea(fillHoles(m))).toBe(25);
    const open=mk(["#####","#...#","#.#.#","#...#","##.##"]);
    expect(maskArea(fillHoles(open))).toBe(maskArea(open));
  });
  it("erode/dilate with r=1 on a 5x5 block",()=>{
    const m=newMask(9,9);
    for(let y=2;y<7;y++) for(let x=2;x<7;x++) m.data[y*9+x]=1;
    expect(maskArea(erode(m,1))).toBe(9);
    expect(maskArea(dilate(m,1))).toBe(49);
  });
});

describe("rasterizePolygons",()=>{
  const sum=(a:Uint8Array)=>a.reduce((s,v)=>s+v/255,0);
  it("coverage sums to polygon area (convex quad, fractional vertices)",()=>{
    const q:Pt[]=[{x:10.3,y:8.7},{x:70.6,y:12.2},{x:64.1,y:50.9},{x:6.8,y:44.4}];
    const cov=sum(rasterizePolygons([q],80,60,16));
    expect(Math.abs(cov-polygonArea(q))/polygonArea(q)).toBeLessThan(0.004);
  });
  it("handles concave polygons; separate polygons are a UNION (hand-drawn mask strokes add up)",()=>{
    const L:Pt[]=[{x:5,y:5},{x:35,y:5},{x:35,y:15},{x:15,y:15},{x:15,y:35},{x:5,y:35}];
    expect(sum(rasterizePolygons([L],40,40))).toBeCloseTo(polygonArea(L),0);
    const outer:Pt[]=[{x:2,y:2},{x:38,y:2},{x:38,y:38},{x:2,y:38}];
    const inner:Pt[]=[{x:12,y:12},{x:28,y:12},{x:28,y:28},{x:12,y:28}];
    expect(sum(rasterizePolygons([outer,inner],40,40))).toBeCloseTo(36*36,0);
    const apart:Pt[]=[{x:60,y:2},{x:70,y:2},{x:70,y:12},{x:60,y:12}];
    expect(sum(rasterizePolygons([outer,apart],80,40))).toBeCloseTo(36*36+100,0);
  });
  it("feathering keeps total mass and softens the edge",()=>{
    const a=rasterizePolygons([[{x:10,y:10},{x:30,y:10},{x:30,y:30},{x:10,y:30}]],40,40);
    const f=featherAlpha(a,40,40,2);
    expect(Math.abs(sum(f)-sum(a))).toBeLessThan(2);
    expect(f[20*40+10]).toBeGreaterThan(40);
    expect(f[20*40+10]).toBeLessThan(215);
  });
});

describe("hull / lines",()=>{
  it("hull contains all points and quad simplification finds noisy rectangle corners",()=>{
    const rnd=mulberry32(4);
    const pts:Pt[]=[];
    for(let i=0;i<600;i++){
      const t=rnd()*4;
      const jx=(rnd()-0.5)*1.2,jy=(rnd()-0.5)*1.2;
      if(t<1) pts.push({x:20+t*100+jx,y:30+jy});
      else if(t<2) pts.push({x:120+jx,y:30+(t-1)*60+jy});
      else if(t<3) pts.push({x:120-(t-2)*100+jx,y:90+jy});
      else pts.push({x:20+jx,y:90-(t-3)*60+jy});
    }
    const hull=convexHull(pts);
    const q=hullToQuad(hull)!;
    const want:Quad=[{x:20,y:30},{x:120,y:30},{x:120,y:90},{x:20,y:90}];
    q.forEach((p,i)=>expect(Math.hypot(p.x-want[i].x,p.y-want[i].y)).toBeLessThan(2.5));
  });
  it("robust line fit ignores 25% outliers; intersection is exact",()=>{
    const rnd=mulberry32(8);
    const pts:Pt[]=[];
    for(let i=0;i<80;i++) pts.push({x:i*2,y:0.5*i*2+10+(rnd()-0.5)*0.6});
    for(let i=0;i<27;i++) pts.push({x:rnd()*160,y:rnd()*200});
    const fit=robustLineFit(pts,{maxResidual:1})!;
    expect(Math.abs(fit.line.a*50+fit.line.b*35+fit.line.c)).toBeLessThan(0.5);
    const l1=lineThrough({x:0,y:0},{x:10,y:10})!;
    const l2=lineThrough({x:0,y:10},{x:10,y:0})!;
    const p=lineIntersection(l1,l2)!;
    expect(p.x).toBeCloseTo(5,9);expect(p.y).toBeCloseTo(5,9);
    expect(lineIntersection(l1,lineThrough({x:0,y:1},{x:10,y:11})!)).toBeNull();
    expect(distanceToLine(l1,{x:0,y:10})).toBeCloseTo(Math.SQRT1_2*10,9);
  });
});
