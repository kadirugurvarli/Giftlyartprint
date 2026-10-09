import type {RawImage} from "../types";
import {defect,type Defect} from "./defects";

export type GlareReport={
  /** Fraction of the inspected area that is blown-out (all channels >= 248). */
  blownFraction:number;
  /** Fraction of the inspected area in the largest connected blown-out blob. */
  largestBlobFraction:number;
  /** Reduction of local contrast inside the blown region's surroundings (veiling glare), 0-1. */
  detected:boolean;
};

/**
 * Detect glare/reflections baked into the SOURCE photo (glass over a framed piece). They would be
 * carried into the mockup and look wrong in the new environment. Detection only: removing them
 * would alter the customer's pixels, so we report and recommend a re-shoot.
 */
export function analyseGlare(upright:RawImage,inspect?:{x:number;y:number;width:number;height:number}):{report:GlareReport;defects:Defect[]}{
  const r=inspect ?? {x:0,y:0,width:upright.width,height:upright.height};
  const w=upright.width;
  const blown=new Uint8Array(r.width*r.height);
  let count=0;
  for(let y=0;y<r.height;y++) for(let x=0;x<r.width;x++){
    const o=((r.y+y)*w+(r.x+x))*4;
    if(upright.data[o]>=248&&upright.data[o+1]>=248&&upright.data[o+2]>=248){blown[y*r.width+x]=1;count++;}
  }
  // largest 4-connected blob
  const seen=new Uint8Array(blown.length);
  let largest=0;
  const stack:number[]=[];
  for(let i=0;i<blown.length;i++){
    if(!blown[i]||seen[i]) continue;
    let size=0;stack.push(i);seen[i]=1;
    while(stack.length){
      const k=stack.pop()!;size++;
      const x=k%r.width,y=(k-x)/r.width;
      if(x>0&&blown[k-1]&&!seen[k-1]){seen[k-1]=1;stack.push(k-1);}
      if(x<r.width-1&&blown[k+1]&&!seen[k+1]){seen[k+1]=1;stack.push(k+1);}
      if(y>0&&blown[k-r.width]&&!seen[k-r.width]){seen[k-r.width]=1;stack.push(k-r.width);}
      if(y<r.height-1&&blown[k+r.width]&&!seen[k+r.width]){seen[k+r.width]=1;stack.push(k+r.width);}
    }
    largest=Math.max(largest,size);
  }
  const total=r.width*r.height;
  const report:GlareReport={blownFraction:count/total,largestBlobFraction:largest/total,detected:false};
  const defects:Defect[]=[];
  // a compact blown-out patch of meaningful size is a specular highlight; scattered white (a white mount, sky) is not
  if(report.largestBlobFraction>0.004 && report.largestBlobFraction/Math.max(1e-9,report.blownFraction)>0.5){
    report.detected=true;
    defects.push(defect("SOURCE_GLARE_DETECTED","warn",
      "A large blown-out highlight ("+(report.largestBlobFraction*100).toFixed(1)+"% of the piece) suggests glass glare in the source photo. It will be carried into the mockup; reshoot at an angle or with the glass cleaned/polarised if possible.",
      {largestBlobFraction:report.largestBlobFraction,blownFraction:report.blownFraction}));
  }
  return {report,defects};
}
