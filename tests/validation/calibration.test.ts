import {afterEach,describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {buildApproval,calibrate} from "@/lib/mockup-v3/validation/calibration";
import {ToleranceApprovalError,getTolerances,validateApproved} from "@/lib/mockup-v3/qa/tolerance-registry";
import {FORWARD_TOLERANCES,RECTIFIED_TOLERANCES} from "@/lib/mockup-v3/qa/metrics";
import {numbersOnly} from "@/lib/mockup-v3/validation/bundle";

const rep=(id:string,mean:number,p95:number,ssim:number,probeMean:number[]):any=>({
  id,level:"environment",qa:{crossCheck:{meanDeltaE:mean,p95DeltaE:p95,ssim}},
  probes:probeMean.map((m,i)=>({name:"p"+i,detected:true,meanDeltaE:m,p95DeltaE:m*2,ssim:0.9})),
  inputs:{source:{name:"secret-name.jpg",width:1,height:1,exif:{make:"M",model:"X"}},reference:{name:"ref.jpg",width:1,height:1,exif:{}}},defects:[],automation:{},notes:"customer note"
});
const rev=(id:string,v:string):any=>({id,level:"environment",verdict:v});
const many=(n:number,mean:number)=>Array.from({length:n},(_,i)=>rep("c"+i,mean,mean*2.5,0.97,[3,4,5]));

describe("calibration",()=>{
  it("refuses to propose anything with too few reviewed cases",()=>{
    const r=many(4,0.5);const c=calibrate(r,r.map((x)=>rev(x.id,"good")));
    expect(c.insufficient).toBeTruthy();
    expect(c.metrics.every((m)=>m.proposal==="keep"&&m.proposedValue===null)).toBe(true);
  });
  it("keeps limits when no good case is rejected",()=>{
    const r=many(12,0.6);const c=calibrate(r,r.map((x)=>rev(x.id,"good")));
    expect(c.metrics.find((m)=>m.metric==="crossMeanDeltaE")!.proposal).not.toBe("loosen");
    expect(()=>buildApproval(c,"rectified","me","because")).toThrow(/Nothing to approve/);
  });
  it("will NOT loosen when the looser limit would let probes through",()=>{
    const r=many(12,2.5); // good cases exceed the 2.0 limit
    for(const x of r) x.probes=[{name:"a",detected:true,meanDeltaE:2.6,p95DeltaE:6,ssim:0.9}]; // damage looks like good
    const c=calibrate(r,r.map((x)=>rev(x.id,"good")));
    const m=c.metrics.find((m)=>m.metric==="crossMeanDeltaE")!;
    expect(m.proposal).toBe("cannot-separate");expect(m.proposedValue).toBeNull();
  });
  it("proposes a loosening only when probes stay caught, and approval still demands strong evidence",()=>{
    const r=many(12,2.3);
    for(const x of r) x.probes=[3.5,4,5].map((m,i)=>({name:"p"+i,detected:true,meanDeltaE:m,p95DeltaE:9,ssim:0.8}));
    const c=calibrate(r,r.map((x)=>rev(x.id,"good")));
    const m=c.metrics.find((m)=>m.metric==="crossMeanDeltaE")!;
    expect(m.proposal).toBe("loosen");expect(m.proposedValue!).toBeLessThanOrEqual(3);
    expect(()=>buildApproval(c,"rectified","me","r")).toThrow(ToleranceApprovalError); // 12 good < 20
  });
  it("bad-reviewed cases never count as good",()=>{
    const r=many(12,0.5);const c=calibrate(r,r.map((x)=>rev(x.id,"bad")));
    expect(c.goodCases).toBe(0);
  });
});

describe("tolerance registry guard",()=>{
  const base={version:1 as const,approvedBy:"me",approvedAt:"2026-01-01",reason:"r"};
  const strong={goodCases:30,probeCases:30,probeDetectionRate:0.97};
  it("rejects weak-evidence loosening, >50% loosening, tightening is fine",()=>{
    expect(()=>validateApproved({...base,evidence:{goodCases:5,probeCases:5,probeDetectionRate:1},tolerances:{rectified:{maxMeanDeltaE:2.5}}})).toThrow(/without strong evidence/);
    expect(()=>validateApproved({...base,evidence:strong,tolerances:{rectified:{maxMeanDeltaE:RECTIFIED_TOLERANCES.maxMeanDeltaE*2}}})).toThrow(/more than 50%/);
    expect(()=>validateApproved({...base,evidence:{goodCases:0,probeCases:0,probeDetectionRate:0},tolerances:{rectified:{maxMeanDeltaE:1.5}}})).not.toThrow();
    expect(()=>validateApproved({...base,evidence:strong,tolerances:{rectified:{maxMeanDeltaE:2.5}}})).not.toThrow();
  });
  const f=path.resolve(__dirname,"..","output","tol-test.json");
  afterEach(()=>{delete process.env.GIFTLY_TOLERANCES_FILE;});
  it("env override is honoured; defaults otherwise; an invalid file throws instead of silently loosening",()=>{
    expect(getTolerances("forward")).toEqual(FORWARD_TOLERANCES);
    fs.mkdirSync(path.dirname(f),{recursive:true});
    fs.writeFileSync(f,JSON.stringify({...base,evidence:strong,tolerances:{rectified:{maxMeanDeltaE:1.5}}}));
    process.env.GIFTLY_TOLERANCES_FILE=f;
    expect(getTolerances("rectified").maxMeanDeltaE).toBe(1.5);
    expect(getTolerances("rectified").minSsim).toBe(RECTIFIED_TOLERANCES.minSsim);
    fs.writeFileSync(f,JSON.stringify({...base,evidence:{goodCases:1,probeCases:1,probeDetectionRate:1},tolerances:{rectified:{maxMeanDeltaE:9}}}));
    process.env.GIFTLY_TOLERANCES_FILE=f+"x";fs.copyFileSync(f,f+"x");
    expect(()=>getTolerances("rectified")).toThrow(ToleranceApprovalError);
    fs.rmSync(f+"x",{force:true});fs.rmSync(f,{force:true});
  });
});

describe("share bundle",()=>{
  it("contains numbers only: no file names or notes",()=>{
    const s=JSON.stringify(numbersOnly([rep("c1",1,2,0.9,[1])]));
    expect(s).not.toContain("secret-name");expect(s).not.toContain("customer note");
  });
});
