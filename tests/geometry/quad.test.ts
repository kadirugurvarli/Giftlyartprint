import {describe,expect,it} from "vitest";
import type {Pt,Quad} from "@/lib/mockup-v3/types";
import {
  estimateRectAspect,interiorAngles,isConvex,orderQuad,quadArea,rectQuad,signedArea,validateQuad
} from "@/lib/mockup-v3/geometry/quad";
import {mulberry32,projectRect} from "../helpers/fixtures";

const q:Quad=[{x:100,y:100},{x:400,y:110},{x:390,y:300},{x:90,y:290}];

describe("quad basics",()=>{
  it("area and winding of the unit rect",()=>{
    const r=rectQuad(200,100);
    expect(quadArea(r)).toBe(20000);
    expect(signedArea(r)).toBeGreaterThan(0);
  });
  it("convexity: accepts convex, rejects bow-tie and reflex",()=>{
    expect(isConvex(q)).toBe(true);
    const bow:Quad=[q[0],q[2],q[1],q[3]];
    expect(isConvex(bow)).toBe(false);
    const reflex:Quad=[{x:0,y:0},{x:100,y:0},{x:40,y:40},{x:0,y:100}];
    expect(isConvex(reflex)).toBe(false);
  });
  it("interior angles of a rectangle are 90",()=>{
    interiorAngles(rectQuad(10,20)).forEach((a)=>expect(a).toBeCloseTo(90,8));
  });
});

describe("orderQuad",()=>{
  it("orders any permutation of an upright quad as TL,TR,BR,BL",()=>{
    const perms:Pt[][]=[
      [q[0],q[1],q[2],q[3]],[q[3],q[2],q[1],q[0]],[q[2],q[0],q[3],q[1]],[q[1],q[3],q[0],q[2]]
    ];
    for(const p of perms){
      const o=orderQuad(p);
      expect(o).toEqual(q);
      expect(signedArea(o)).toBeGreaterThan(0);
    }
  });
  it("is stable under random shuffles of random convex quads",()=>{
    const rnd=mulberry32(5);
    for(let n=0;n<200;n++){
      const base:Quad=[
        {x:rnd()*80,y:rnd()*80},{x:220+rnd()*80,y:rnd()*80},
        {x:220+rnd()*80,y:220+rnd()*80},{x:rnd()*80,y:220+rnd()*80}
      ];
      const shuffled=[...base].sort(()=>rnd()-0.5);
      expect(orderQuad(shuffled)).toEqual(base);
    }
  });
});

describe("validateQuad",()=>{
  it("accepts a sane quad inside the image",()=>{
    expect(validateQuad(q,{bounds:{width:500,height:400}}).ok).toBe(true);
  });
  it("flags each failure mode with a specific code",()=>{
    const codes=(x:Quad,o={})=>validateQuad(x,o).issues.map((i)=>i.code);
    expect(codes([q[0],q[2],q[1],q[3]])).toContain("NOT_CONVEX");
    expect(codes([q[3],q[2],q[1],q[0]])).toContain("WRONG_WINDING");
    expect(codes([{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}])).toContain("DEGENERATE_AREA");
    expect(codes(q,{bounds:{width:300,height:300}})).toContain("OUT_OF_BOUNDS");
    const thin:Quad=[{x:0,y:0},{x:300,y:0},{x:300,y:20},{x:0,y:20}];
    expect(codes(thin,{minInteriorAngleDeg:15})).not.toContain("TOO_SKEWED");
    const skew:Quad=[{x:0,y:0},{x:300,y:0},{x:400,y:20},{x:100,y:20}];
    expect(codes(skew,{minInteriorAngleDeg:15})).toContain("TOO_SKEWED");
  });
  it("rejects non-finite coordinates",()=>{
    expect(validateQuad([{x:NaN,y:0},q[1],q[2],q[3]]).ok).toBe(false);
  });
});

describe("estimateRectAspect (ground truth from a simulated pinhole camera)",()=>{
  const W=1600,H=1200,f=1400;
  const cases=[
    {name:"landscape 3:2, yaw 25 pitch 15",w:1.5,h:1,yaw:25,pitch:15},
    {name:"portrait 4:5, yaw -30 pitch 8",w:0.8,h:1,yaw:-30,pitch:8},
    {name:"square, yaw 35 pitch -20",w:1,h:1,yaw:35,pitch:-20},
    {name:"wide 2:1, yaw 15 pitch 25",w:2,h:1,yaw:15,pitch:25},
    {name:"landscape 3:2, yaw 40, pitch 18, rolled 7deg",w:1.5,h:1,yaw:40,pitch:18,roll:7}
  ];
  for(const c of cases){
    it(`recovers true aspect: ${c.name}`,()=>{
      const quad=projectRect({worldW:c.w,worldH:c.h,yawDeg:c.yaw,pitchDeg:c.pitch,rollDeg:c.roll,distance:3,focalPx:f,imgW:W,imgH:H});
      const est=estimateRectAspect(quad,W,H);
      expect(est.method).toBe("zhang-he");
      expect(est.aspect!/(c.w/c.h)).toBeGreaterThan(0.995);
      expect(est.aspect!/(c.w/c.h)).toBeLessThan(1.005);
      expect(est.focalPx!/f).toBeGreaterThan(0.97);
      expect(est.focalPx!/f).toBeLessThan(1.03);
    });
  }

  it("level camera (pure yaw): focal is unobservable; known focal gives an accurate aspect",()=>{
    const quad=projectRect({worldW:1.5,worldH:1,yawDeg:40,pitchDeg:0,distance:3,focalPx:f,imgW:W,imgH:H});
    const given=estimateRectAspect(quad,W,H,{focalPx:f});
    expect(given.method).toBe("given-focal");
    expect(given.reliable).toBe(true);
    expect(Math.abs(given.aspect!-1.5)/1.5).toBeLessThan(0.005);

    const assumed=estimateRectAspect(quad,W,H);
    expect(assumed.method).toBe("assumed-focal");
    expect(assumed.reliable).toBe(false);
  });

  it("measures how a wrong focal assumption degrades the aspect (informational, bounded)",()=>{
    const rows:string[]=[];
    let worstUpTo40=0;
    const at10:Record<number,number>={};
    for(const yaw of [20,40,55]){
      const quad=projectRect({worldW:1.5,worldH:1,yawDeg:yaw,pitchDeg:0,distance:3,focalPx:f,imgW:W,imgH:H});
      for(const err of [-0.2,-0.1,0.1,0.2]){
        const est=estimateRectAspect(quad,W,H,{focalPx:f*(1+err)});
        const rel=Math.abs(est.aspect!-1.5)/1.5;
        rows.push(`yaw ${yaw} focal ${err>0?"+":""}${err*100}% -> aspect error ${(rel*100).toFixed(2)}%`);
        if(Math.abs(err)<=0.1){
          at10[yaw]=Math.max(at10[yaw] ?? 0,rel);
          if(yaw<=40) worstUpTo40=Math.max(worstUpTo40,rel);
        }
      }
    }
    console.log("[aspect] focal-misestimate sensitivity\n  "+rows.join("\n  "));
    // Measured: +/-10% focal error => ~1.2% (20deg), ~4.3% (40deg), ~6.8% (55deg) aspect error.
    expect(worstUpTo40).toBeLessThan(0.05);
    expect(at10[55]).toBeGreaterThan(at10[40]);
    expect(at10[40]).toBeGreaterThan(at10[20]);
  });

  it("a naive edge-length ratio is measurably wrong on the same quads (so the estimator earns its keep)",()=>{
    const quad=projectRect({worldW:1.5,worldH:1,yawDeg:40,pitchDeg:15,distance:3,focalPx:f,imgW:W,imgH:H});
    const e=(a:Pt,b:Pt)=>Math.hypot(a.x-b.x,a.y-b.y);
    const naive=((e(quad[0],quad[1])+e(quad[3],quad[2]))/2)/((e(quad[1],quad[2])+e(quad[0],quad[3]))/2);
    expect(Math.abs(naive-1.5)/1.5).toBeGreaterThan(0.05);
  });

  it("fronto-parallel quads use exact edge lengths",()=>{
    const quad=projectRect({worldW:1.5,worldH:1,yawDeg:0,pitchDeg:0,distance:3,focalPx:f,imgW:W,imgH:H});
    const est=estimateRectAspect(quad,W,H);
    expect(est.method).toBe("fronto-parallel");
    expect(est.reliable).toBe(true);
    expect(est.aspect).toBeCloseTo(1.5,6);
  });

  it("in-plane rotation of a fronto-parallel rectangle keeps its aspect",()=>{
    const quad=projectRect({worldW:1.5,worldH:1,yawDeg:0,pitchDeg:0,rollDeg:33,distance:3,focalPx:f,imgW:W,imgH:H});
    expect(estimateRectAspect(quad,W,H).aspect).toBeCloseTo(1.5,6);
  });

  it("reports honest error under 0.5px corner jitter (reported, bounded at 4%)",()=>{
    const rnd=mulberry32(3);
    const truth=1.5;
    let worst=0;
    for(let n=0;n<200;n++){
      const base=projectRect({worldW:1.5,worldH:1,yawDeg:28,pitchDeg:12,distance:3,focalPx:f,imgW:W,imgH:H});
      const jit=base.map((p)=>({x:p.x+(rnd()-0.5),y:p.y+(rnd()-0.5)})) as Quad;
      const est=estimateRectAspect(jit,W,H);
      worst=Math.max(worst,Math.abs(est.aspect!-truth)/truth);
    }
    console.log(`[aspect] worst relative error with +/-0.5px jitter over 200 trials: ${(worst*100).toFixed(2)}%`);
    expect(worst).toBeLessThan(0.04);
  });
});
