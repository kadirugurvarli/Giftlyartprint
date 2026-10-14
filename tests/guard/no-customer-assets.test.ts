import {describe,expect,it} from "vitest";
import {execFileSync} from "node:child_process";
import {findForbiddenTracked} from "@/lib/mockup-v3/validation/asset-guard";

describe("no customer assets in git",()=>{
  it("flags images outside the allowlist, accepts the synthetic goldens",()=>{
    expect(findForbiddenTracked(["a.jpg","private-inputs/x.PNG","tests/goldens/a.png","docs/phase3-previews/p.jpg","lib/x.ts","validation-input/IMG.HEIC"]))
      .toEqual(["a.jpg","private-inputs/x.PNG","validation-input/IMG.HEIC"]);
  });
  it("nothing tracked in this repository violates the allowlist",()=>{
    const files=execFileSync("git",["ls-files","-z"]).toString().split("\0").filter(Boolean);
    expect(findForbiddenTracked(files)).toEqual([]);
  });
  it(".gitignore covers the private folders",async()=>{
    const fs=await import("node:fs");
    const gi=fs.readFileSync(".gitignore","utf8");
    for(const p of ["validation-output/","validation-input/","private-inputs/","fixtures/private/"]) expect(gi).toContain(p);
  });
});
