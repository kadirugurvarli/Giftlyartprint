import {describe,expect,it} from "vitest";
import {
  applyHomography,hasCollinearTriple,homographyFromPoints,invertMat3,mulMat3,IDENTITY,solveLinear
} from "@/lib/mockup-v3/geometry/homography";
import type {Pt} from "@/lib/mockup-v3/types";
import {mulberry32} from "../helpers/fixtures";

const unit:Pt[]=[{x:0,y:0},{x:100,y:0},{x:100,y:60},{x:0,y:60}];

describe("solveLinear",()=>{
  it("solves a known system",()=>{
    const x=solveLinear([[2,1,-1],[-3,-1,2],[-2,1,2]],[8,-11,-3]);
    expect(x![0]).toBeCloseTo(2,10);
    expect(x![1]).toBeCloseTo(3,10);
    expect(x![2]).toBeCloseTo(-1,10);
  });
  it("returns null for a singular system",()=>{
    expect(solveLinear([[1,2],[2,4]],[1,2])).toBeNull();
  });
});

describe("homographyFromPoints",()=>{
  it("returns identity for identical quads",()=>{
    const H=homographyFromPoints(unit,unit)!;
    H.forEach((v,i)=>expect(v).toBeCloseTo(IDENTITY[i],9));
  });

  it("maps all four source points exactly onto the destination points",()=>{
    const dst:Pt[]=[{x:120,y:80},{x:430,y:120},{x:400,y:380},{x:90,y:300}];
    const H=homographyFromPoints(unit,dst)!;
    unit.forEach((p,i)=>{
      const q=applyHomography(H,p)!;
      expect(q.x).toBeCloseTo(dst[i].x,6);
      expect(q.y).toBeCloseTo(dst[i].y,6);
    });
  });

  it("recovers a pure translation+scale",()=>{
    const dst:Pt[]=unit.map((p)=>({x:p.x*2+10,y:p.y*2-5}));
    const H=homographyFromPoints(unit,dst)!;
    const q=applyHomography(H,{x:50,y:30})!;
    expect(q.x).toBeCloseTo(110,8);
    expect(q.y).toBeCloseTo(55,8);
  });

  it("matches an independently known perspective map at interior points",()=>{
    // Ground truth H (row-major), built independently of the solver.
    const truth=[1.2,0.1,30, -0.05,0.9,20, 0.0008,0.0004,1] as const;
    const f=(p:Pt):Pt=>{
      const w=truth[6]*p.x+truth[7]*p.y+truth[8];
      return {x:(truth[0]*p.x+truth[1]*p.y+truth[2])/w,y:(truth[3]*p.x+truth[4]*p.y+truth[5])/w};
    };
    const H=homographyFromPoints(unit,unit.map(f))!;
    for(const p of [{x:50,y:30},{x:10,y:55},{x:90,y:5},{x:33,y:17}]){
      const got=applyHomography(H,p)!;
      const want=f(p);
      expect(got.x).toBeCloseTo(want.x,6);
      expect(got.y).toBeCloseTo(want.y,6);
    }
  });

  it("is numerically stable at large pixel coordinates (4000px image)",()=>{
    const src:Pt[]=[{x:0,y:0},{x:4000,y:0},{x:4000,y:3000},{x:0,y:3000}];
    const dst:Pt[]=[{x:812,y:640},{x:3321,y:512},{x:3544,y:2410},{x:700,y:2630}];
    const H=homographyFromPoints(src,dst)!;
    src.forEach((p,i)=>{
      const q=applyHomography(H,p)!;
      expect(Math.hypot(q.x-dst[i].x,q.y-dst[i].y)).toBeLessThan(1e-6);
    });
  });

  it("rejects collinear / degenerate input",()=>{
    const line:Pt[]=[{x:0,y:0},{x:1,y:1},{x:2,y:2},{x:3,y:3}];
    expect(homographyFromPoints(line,unit)).toBeNull();
    expect(homographyFromPoints(unit,line)).toBeNull();
    const coincident:Pt[]=[{x:5,y:5},{x:5,y:5},{x:5,y:5},{x:5,y:5}];
    expect(homographyFromPoints(unit,coincident)).toBeNull();
    expect(hasCollinearTriple(unit)).toBe(false);
  });
});

describe("matrix helpers",()=>{
  it("H * inverse(H) = identity for random valid homographies",()=>{
    const rnd=mulberry32(11);
    for(let n=0;n<50;n++){
      const dst:Pt[]=[
        {x:rnd()*100,y:rnd()*100},
        {x:300+rnd()*100,y:rnd()*100},
        {x:300+rnd()*100,y:200+rnd()*100},
        {x:rnd()*100,y:200+rnd()*100}
      ];
      const H=homographyFromPoints(unit,dst)!;
      const I=mulMat3(H,invertMat3(H)!);
      I.forEach((v,i)=>expect(v).toBeCloseTo(IDENTITY[i],7));
    }
  });
  it("inverse maps points back",()=>{
    const dst:Pt[]=[{x:20,y:10},{x:200,y:40},{x:180,y:150},{x:5,y:120}];
    const H=homographyFromPoints(unit,dst)!;
    const Hi=invertMat3(H)!;
    const p={x:41,y:22};
    const back=applyHomography(Hi,applyHomography(H,p)!)!;
    expect(back.x).toBeCloseTo(p.x,8);
    expect(back.y).toBeCloseTo(p.y,8);
  });
  it("singular matrix has no inverse",()=>{
    expect(invertMat3([1,2,3,2,4,6,0,0,1])).toBeNull();
  });
});
