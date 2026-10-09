import {describe,expect,it} from "vitest";
import {AUDIT_CORRECTIONS,DEFECT_CORRECTIONS,recommendCorrections} from "@/lib/mockup-v3/validation/corrections";
import fs from "node:fs";
import path from "node:path";

describe("corrections table",()=>{
  it("covers every DefectCode declared in defects.ts",()=>{
    const src=fs.readFileSync(path.resolve(__dirname,"../../lib/mockup-v3/detect/defects.ts"),"utf8");
    const codes=[...src.matchAll(/\|\s*"([A-Z_]+)"/g)].map((m)=>m[1]);
    expect(codes.length).toBeGreaterThan(30);
    for(const c of codes) expect(DEFECT_CORRECTIONS, c).toHaveProperty(c);
  });
  it("never recommends loosening a threshold, and engine failures route to triage",()=>{
    const all=[...Object.values(DEFECT_CORRECTIONS),...Object.values(AUDIT_CORRECTIONS)];
    for(const r of all) expect(r.action.replace(/do NOT relax thresholds/gi,"")).not.toMatch(/relax|loosen|widen|raise the tol/i);
    for(const k of ["SCENE_ALTERED","FRAME_ALTERED","COLOUR_DRIFT"] as const) expect(DEFECT_CORRECTIONS[k].kind).toBe("engine");
  });
  it("dedupes and tolerates unknown codes",()=>{
    const c=recommendCorrections([{code:"FOCAL_ASSUMED"},{code:"FOCAL_ASSUMED"},{code:"WHATEVER"}],[{code:"SEAM_TOO_SHARP"}]);
    expect(c.map((x)=>x.code)).toEqual(["FOCAL_ASSUMED","WHATEVER","SEAM_TOO_SHARP"]);
    expect(c[1].kind).toBe("engine");
  });
});
