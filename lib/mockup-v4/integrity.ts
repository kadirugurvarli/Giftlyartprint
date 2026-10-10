import type {RawImage} from "../mockup-v3/types";
import {srgbToLab} from "../mockup-v3/qa/metrics";

export type RegionDelta={count:number;changed:number;meanDE:number;p95DE:number;maxDE:number;bigFraction:number};

const labCache=new Map<number,[number,number,number]>();
function lab(r:number,g:number,b:number){
  const k=(r<<16)|(g<<8)|b;
  let v=labCache.get(k);
  if(!v){v=srgbToLab(r,g,b);if(labCache.size<400000) labCache.set(k,v);}
  return v;
}

/**
 * Colour difference (CIE76 ΔE) between two same-size images over the pixels where `select(i)` is true.
 * `changed` counts pixels whose RGB bytes differ at all; `bigFraction` is the share with ΔE > `big`.
 */
export function regionDelta(a:RawImage,b:RawImage,select:(i:number)=>boolean,big=10):RegionDelta{
  if(a.width!==b.width||a.height!==b.height) throw new Error("regionDelta requires equal image sizes.");
  const n=a.width*a.height;
  const hist=new Uint32Array(2000);
  let count=0,changed=0,sum=0,max=0,bigN=0;
  for(let i=0;i<n;i++){
    if(!select(i)) continue;
    count++;
    const o=i*4;
    if(a.data[o]===b.data[o]&&a.data[o+1]===b.data[o+1]&&a.data[o+2]===b.data[o+2]){hist[0]++;continue;}
    changed++;
    const p=lab(a.data[o],a.data[o+1],a.data[o+2]),q=lab(b.data[o],b.data[o+1],b.data[o+2]);
    const de=Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
    sum+=de;if(de>max) max=de;if(de>big) bigN++;
    hist[Math.min(1999,Math.round(de*10))]++;
  }
  let p95=0;
  if(count){const target=0.95*count;let acc=0;for(let k=0;k<hist.length;k++){acc+=hist[k];if(acc>=target){p95=k/10;break;}}}
  return {count,changed,meanDE:count?sum/count:0,p95DE:p95,maxDE:max,bigFraction:count?bigN/count:0};
}

export function cropImage(img:RawImage,r:{x:number;y:number;width:number;height:number}):RawImage{
  const out=new Uint8ClampedArray(r.width*r.height*4);
  for(let y=0;y<r.height;y++){
    const so=((r.y+y)*img.width+r.x)*4;
    out.set(img.data.subarray(so,so+r.width*4),y*r.width*4);
  }
  return {width:r.width,height:r.height,data:out};
}

export function pasteImage(base:RawImage,patch:RawImage,at:{x:number;y:number}):RawImage{
  const out=new Uint8ClampedArray(base.data);
  for(let y=0;y<patch.height;y++){
    out.set(patch.data.subarray(y*patch.width*4,(y+1)*patch.width*4),((at.y+y)*base.width+at.x)*4);
  }
  return {width:base.width,height:base.height,data:out};
}
