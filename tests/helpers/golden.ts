import fs from "node:fs";
import path from "node:path";
import {expect} from "vitest";
import {compareImages} from "@/lib/mockup-v3/qa/metrics";
import {decodeImage,encodePng} from "@/lib/mockup-v3/io";
import type {RawImage} from "@/lib/mockup-v3/types";

const GOLDEN_DIR=path.resolve(__dirname,"..","goldens");
const OUTPUT_DIR=path.resolve(__dirname,"..","output");

export type GoldenTolerance={maxMeanDeltaE:number;minSsim:number};

/** Read-only comparison against a stored golden; never writes (safe in UPDATE_GOLDENS mode). */
export async function goldenDiff(name:string,actual:RawImage){
  const file=path.join(GOLDEN_DIR,name+".png");
  if(!fs.existsSync(file)) throw new Error(`Missing golden ${name}.png.`);
  const golden=await decodeImage(fs.readFileSync(file));
  if(golden.width!==actual.width || golden.height!==actual.height){
    throw new Error(`golden ${name}: size ${actual.width}x${actual.height} != ${golden.width}x${golden.height}`);
  }
  return compareImages(golden,actual);
}

/**
 * Visual regression: candidate must match tests/goldens/<name>.png within tolerance.
 * Regenerate deliberately with `npm run test:update-goldens` and review the diff by eye.
 * Goldens only ever contain synthetic content.
 */
export async function expectMatchesGolden(name:string,actual:RawImage,tol:GoldenTolerance={maxMeanDeltaE:0.5,minSsim:0.99}){
  const file=path.join(GOLDEN_DIR,name+".png");
  if(process.env.UPDATE_GOLDENS==="1"){
    fs.mkdirSync(GOLDEN_DIR,{recursive:true});
    fs.writeFileSync(file,await encodePng(actual));
    return;
  }
  if(!fs.existsSync(file)){
    throw new Error(`Missing golden ${name}.png. Run "npm run test:update-goldens" and review it.`);
  }
  const golden=await decodeImage(fs.readFileSync(file));
  expect(`${actual.width}x${actual.height}`).toBe(`${golden.width}x${golden.height}`);
  const m=compareImages(golden,actual);
  if(m.meanDeltaE>tol.maxMeanDeltaE || m.ssim<tol.minSsim){
    fs.mkdirSync(OUTPUT_DIR,{recursive:true});
    fs.writeFileSync(path.join(OUTPUT_DIR,name+".actual.png"),await encodePng(actual));
  }
  expect(m.meanDeltaE,`golden ${name}: mean dE`).toBeLessThanOrEqual(tol.maxMeanDeltaE);
  expect(m.ssim,`golden ${name}: SSIM`).toBeGreaterThanOrEqual(tol.minSsim);
}
