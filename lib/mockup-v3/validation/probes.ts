import type {Quad,RawImage} from "../types";
import {crossCheckFromSource} from "../pipeline/common";
import {getTolerances} from "../qa/tolerance-registry";
import {rasterizePolygons} from "../vision/mask";
import type {MockupResult} from "../pipeline";

/**
 * Sensitivity probes. Known damage is applied to a REAL result's product region and the same
 * independent cross-check is asked to catch it. A threshold is only meaningful if the check
 * rejects these: calibration may never loosen a limit that stops them being detected.
 */
export type ProbeName="colour-shift-a3"|"colour-shift-L5"|"blur-1.2px"|"shift-1.5px"|"noise-6";
export type ProbeOutcome={name:ProbeName;detected:boolean;meanDeltaE?:number;p95DeltaE?:number;ssim?:number};

export const PROBES:ProbeName[]=["colour-shift-a3","colour-shift-L5","blur-1.2px","shift-1.5px","noise-6"];

function rng(seed:number){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}

function damage(img:RawImage,region:Quad,name:ProbeName):RawImage{
  const {width:W,height:H}=img;
  const m=rasterizePolygons([region.map((p)=>({x:p.x,y:p.y}))],W,H,1);
  const out:RawImage={width:W,height:H,data:new Uint8ClampedArray(img.data)};
  const d=out.data,s=img.data;
  const inside=(i:number)=>m[i]>250;
  if(name==="colour-shift-a3"){
    // push red up / green down: ~+3 a* equivalent
    for(let i=0;i<W*H;i++) if(inside(i)){d[i*4]=Math.min(255,s[i*4]+4);d[i*4+1]=Math.max(0,s[i*4+1]-3);}
  }else if(name==="colour-shift-L5"){
    for(let i=0;i<W*H;i++) if(inside(i)){for(let c=0;c<3;c++) d[i*4+c]=Math.min(255,s[i*4+c]+10);}
  }else if(name==="noise-6"){
    const r=rng(7);
    for(let i=0;i<W*H;i++) if(inside(i)){const n=(r()+r()+r()-1.5)*2*6;for(let c=0;c<3;c++) d[i*4+c]=Math.max(0,Math.min(255,s[i*4+c]+n));}
  }else if(name==="shift-1.5px"){
    // sample 1.5 px to the right with linear interpolation
    for(let y=0;y<H;y++)for(let x=0;x<W-2;x++){
      const i=y*W+x;if(!inside(i)) continue;
      for(let c=0;c<3;c++) d[i*4+c]=(s[(i+1)*4+c]+s[(i+2)*4+c])*0.5;
    }
  }else{
    // 3x3 binomial blur applied twice ~ sigma 1.2
    let cur=s;
    for(let pass=0;pass<2;pass++){
      const nxt=new Uint8ClampedArray(cur);
      for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
        const i=y*W+x;if(!inside(i)) continue;
        for(let c=0;c<3;c++){
          let a=0;
          for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) a+=cur[((y+dy)*W+x+dx)*4+c]*((dx===0?2:1)*(dy===0?2:1));
          nxt[i*4+c]=a/16;
        }
      }
      cur=nxt;
    }
    d.set(cur);
  }
  return out;
}

export function runProbes(args:{result:MockupResult;source:RawImage;occlusion?:Parameters<typeof crossCheckFromSource>[0]["occlusion"]}):ProbeOutcome[]{
  const {result}=args;
  const reg=result.qa.crossRegions;
  if(!result.image||!reg) return [];
  const photographic=result.qa.productPixels?.level==="photographic";
  const tol=getTolerances(photographic?"lightingRectified":"rectified");
  return PROBES.map((name)=>{
    const damaged=damage(result.image!,reg.target,name);
    const x=crossCheckFromSource({source:args.source,sourceQuad:reg.source,composite:damaged,targetQuad:reg.target,marginPx:4,tol,occlusion:args.occlusion});
    return {name,detected:!x.pass,meanDeltaE:x.metrics?.meanDeltaE,p95DeltaE:x.metrics?.p95DeltaE,ssim:x.metrics?.ssim};
  });
}
