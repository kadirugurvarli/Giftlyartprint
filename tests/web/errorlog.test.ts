import {describe,expect,it,vi} from "vitest";
import {issueSession,COOKIE_NAME} from "@/lib/mockup-v3/web/auth";
import {GOOD_ENV,ORIGIN,postForm,sampleUpload} from "./helpers";

vi.mock("@/lib/mockup-v3/web/run",()=>({runWeb:async()=>{throw new Error("IMG_SECRET_CUSTOMER.jpg exploded at /home/x/secret");}}));
import {handleRun} from "@/lib/mockup-v3/web/handlers";

describe("engine failure",()=>{
  it("returns a generic 500 and logs only the error class, never its message or inputs",async()=>{
    const {source,reference}=await sampleUpload();
    const logs:string[]=[];
    for(const m of ["log","info","warn","error"] as const) vi.spyOn(console,m).mockImplementation((...a:any[])=>{logs.push(a.map(String).join(" "));});
    const h=JSON.stringify({originalWidth:640,originalHeight:480});
    const res=await handleRun(await postForm(`${ORIGIN}/api/validation/run`,{mode:"artwork-in-frame",level:"environment",source,reference,sourceMeta:h,referenceMeta:h},{cookie:`${COOKIE_NAME}=${issueSession(GOOD_ENV)}`}),GOOD_ENV);
    expect(res.status).toBe(500);
    const body=await res.text();
    expect(body).not.toContain("SECRET");expect(logs.join("\n")).not.toMatch(/SECRET|secret|exploded/);
    expect(logs.length).toBe(1);
  });
});
