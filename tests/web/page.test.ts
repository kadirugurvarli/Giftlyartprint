import {describe,expect,it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import {decidePage} from "@/lib/mockup-v3/web/page-guard";
import {GOOD_ENV,HOST} from "./helpers";

describe("validation page decision (the page repeats the guard)",()=>{
  it("serves the studio only on an allowed Preview host",()=>{
    expect(decidePage(GOOD_ENV,HOST)).toEqual({kind:"ok"});
  });
  it("is a 404 on any other host, in production, or when disabled",()=>{
    expect(decidePage(GOOD_ENV,"giftly-content-studio.vercel.app")).toEqual({kind:"notFound"});
    expect(decidePage(GOOD_ENV,null)).toEqual({kind:"notFound"});
    expect(decidePage({...GOOD_ENV,VERCEL_ENV:"production"},HOST)).toEqual({kind:"notFound"});
    expect(decidePage({...GOOD_ENV,VALIDATION_UI_ENABLED:undefined},HOST)).toEqual({kind:"notFound"});
  });
  it("explains a misconfiguration to the owner without serving the tool or leaking a value",()=>{
    expect(decidePage({...GOOD_ENV,VALIDATION_ALLOWED_HOSTS:undefined},HOST).kind).toBe("message");
    const d=decidePage({...GOOD_ENV,CONTENT_FEED_TOKEN:"secret-value-xyz"},HOST);
    expect(d.kind).toBe("message");
    const text=JSON.stringify(d);expect(text).toContain("CONTENT_FEED_TOKEN");expect(text).not.toContain("secret-value-xyz");
  });
  it("the page component really asks decidePage with the request's Host header",()=>{
    const src=fs.readFileSync(path.resolve(__dirname,"../../app/validation/page.tsx"),"utf8");
    expect(src).toContain('decidePage(process.env,h.get("host"))');
    expect(src).toContain("notFound()");
  });
});
