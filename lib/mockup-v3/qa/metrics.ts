import type {RawImage} from "../types";

export type ImageMetrics={
  pixelCount:number;
  /** Mean absolute error over RGB, 0-255. */
  mae:number;
  psnr:number;
  /** CIE76 colour difference (Lab). */
  meanDeltaE:number;
  p95DeltaE:number;
  /** Mean signed Lab shift (b minus a): detects global tints/brightness shifts that MAE can hide. */
  labBias:{L:number;a:number;b:number};
  /** Mean structural similarity on luma, 0-1. */
  ssim:number;
  /** Gradient energy of b relative to a: <1 means b is softer, >1 sharper/noisier. */
  sharpnessRatio:number;
};

export type CompareOptions={
  /** Ignore this many pixels along every edge (anti-aliased borders). */
  margin?:number;
  /** Full-size mask (1 = compare, 0 = ignore), e.g. quad interior or "not occluded". */
  mask?:Uint8Array;
};

/** Shrink a binary mask by `r` pixels (square structuring element, separable). */
export function erodeMask(mask:Uint8Array,width:number,height:number,r:number):Uint8Array{
  if(r<=0) return mask;
  const tmp=new Uint8Array(mask.length);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      let ok=1;
      for(let i=-r;i<=r && ok;i++){
        const xx=x+i;
        if(xx<0 || xx>=width || !mask[y*width+xx]) ok=0;
      }
      tmp[y*width+x]=ok;
    }
  }
  const out=new Uint8Array(mask.length);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      let ok=1;
      for(let j=-r;j<=r && ok;j++){
        const yy=y+j;
        if(yy<0 || yy>=height || !tmp[yy*width+x]) ok=0;
      }
      out[y*width+x]=ok;
    }
  }
  return out;
}

const SRGB_TO_LINEAR=(()=>{
  const t=new Float64Array(256);
  for(let i=0;i<256;i++){
    const c=i/255;
    t[i]=c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
  }
  return t;
})();

function labF(t:number){
  return t>216/24389?Math.cbrt(t):(24389/27*t+16)/116;
}

/** sRGB (0-255) to CIE Lab, D65. */
export function srgbToLab(r:number,g:number,b:number):[number,number,number]{
  const lr=SRGB_TO_LINEAR[r];
  const lg=SRGB_TO_LINEAR[g];
  const lb=SRGB_TO_LINEAR[b];
  const X=(0.4124564*lr+0.3575761*lg+0.1804375*lb)/0.95047;
  const Y=0.2126729*lr+0.7151522*lg+0.0721750*lb;
  const Z=(0.0193339*lr+0.1191920*lg+0.9503041*lb)/1.08883;
  const fx=labF(X);
  const fy=labF(Y);
  const fz=labF(Z);
  return [116*fy-16,500*(fx-fy),200*(fy-fz)];
}

function luma(img:RawImage,x:number,y:number){
  const o=(y*img.width+x)*4;
  return 0.2126*img.data[o]+0.7152*img.data[o+1]+0.0722*img.data[o+2];
}

function gradientEnergy(img:RawImage,x0:number,y0:number,x1:number,y1:number,mask?:Uint8Array){
  let sum=0;
  let n=0;
  const w=img.width;
  for(let y=y0;y<y1-1;y++){
    for(let x=x0;x<x1-1;x++){
      if(mask && !(mask[y*w+x] && mask[y*w+x+1] && mask[(y+1)*w+x])) continue;
      const l=luma(img,x,y);
      const gx=luma(img,x+1,y)-l;
      const gy=luma(img,x,y+1)-l;
      sum+=Math.sqrt(gx*gx+gy*gy);
      n++;
    }
  }
  return n?sum/n:0;
}

function ssimLuma(a:RawImage,b:RawImage,x0:number,y0:number,x1:number,y1:number,mask?:Uint8Array){
  const C1=(0.01*255)**2;
  const C2=(0.03*255)**2;
  const win=8;
  const stride=4;
  let total=0;
  let count=0;
  for(let y=y0;y+win<=y1;y+=stride){
    for(let x=x0;x+win<=x1;x+=stride){
      if(mask){
        let all=true;
        for(let j=0;j<win && all;j++) for(let i=0;i<win;i++){
          if(!mask[(y+j)*a.width+x+i]){all=false;break;}
        }
        if(!all) continue;
      }
      let ma=0,mb=0;
      for(let j=0;j<win;j++) for(let i=0;i<win;i++){
        ma+=luma(a,x+i,y+j);
        mb+=luma(b,x+i,y+j);
      }
      const n=win*win;
      ma/=n;mb/=n;
      let va=0,vb=0,cv=0;
      for(let j=0;j<win;j++) for(let i=0;i<win;i++){
        const da=luma(a,x+i,y+j)-ma;
        const db=luma(b,x+i,y+j)-mb;
        va+=da*da;vb+=db*db;cv+=da*db;
      }
      va/=n-1;vb/=n-1;cv/=n-1;
      total+=((2*ma*mb+C1)*(2*cv+C2))/((ma*ma+mb*mb+C1)*(va+vb+C2));
      count++;
    }
  }
  return count?total/count:1;
}

/** Compare two equally sized images. `a` is the reference, `b` the candidate. Alpha is ignored. */
export function compareImages(a:RawImage,b:RawImage,opts:CompareOptions={}):ImageMetrics{
  if(a.width!==b.width || a.height!==b.height){
    throw new Error(`compareImages size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const m=opts.margin ?? 0;
  const x0=m,y0=m,x1=a.width-m,y1=a.height-m;
  if(x1-x0<8 || y1-y0<8) throw new Error("compareImages region too small after margin.");

  let absSum=0,sqSum=0,n=0;
  let dL=0,dA=0,dB=0;
  const de:number[]=[];
  for(let y=y0;y<y1;y++){
    for(let x=x0;x<x1;x++){
      if(opts.mask && !opts.mask[y*a.width+x]) continue;
      const o=(y*a.width+x)*4;
      for(let c=0;c<3;c++){
        const d=b.data[o+c]-a.data[o+c];
        absSum+=Math.abs(d);
        sqSum+=d*d;
      }
      const la=srgbToLab(a.data[o],a.data[o+1],a.data[o+2]);
      const lb=srgbToLab(b.data[o],b.data[o+1],b.data[o+2]);
      dL+=lb[0]-la[0];dA+=lb[1]-la[1];dB+=lb[2]-la[2];
      de.push(Math.hypot(lb[0]-la[0],lb[1]-la[1],lb[2]-la[2]));
      n++;
    }
  }
  if(n<64) throw new Error("compareImages: fewer than 64 comparable pixels.");
  const mse=sqSum/(n*3);
  de.sort((p,q)=>p-q);
  const ga=gradientEnergy(a,x0,y0,x1,y1,opts.mask);
  const gb=gradientEnergy(b,x0,y0,x1,y1,opts.mask);

  return {
    pixelCount:n,
    mae:absSum/(n*3),
    psnr:mse===0?Infinity:10*Math.log10(255*255/mse),
    meanDeltaE:de.reduce((s,v)=>s+v,0)/n,
    p95DeltaE:de[Math.min(n-1,Math.floor(n*0.95))],
    labBias:{L:dL/n,a:dA/n,b:dB/n},
    ssim:ssimLuma(a,b,x0,y0,x1,y1,opts.mask),
    sharpnessRatio:ga<1e-9?(gb<1e-9?1:Infinity):gb/ga
  };
}

export type FidelityTolerances={
  maxMeanDeltaE:number;
  maxP95DeltaE:number;
  maxAbsLabBias:number;
  minSsim:number;
  minSharpnessRatio:number;
  maxSharpnessRatio:number;
  /** Relative error allowed between the placed aspect ratio and the source aspect ratio. */
  maxAspectError:number;
  /** Optional split of the bias limit: luminance (L) and chroma (a,b) are judged separately when set. */
  maxAbsLBias?:number;
  maxAbsChromaBias?:number;
};

/**
 * Forward check: the reference is re-rendered with the same warp straight onto the composite's
 * canvas, so there is no second resample and legitimate output matches almost exactly. Tight.
 * Calibrated on synthetic fixtures; expected to be re-tuned on real photographs (JPEG, lighting match).
 */
export const FORWARD_TOLERANCES:FidelityTolerances={
  maxMeanDeltaE:1.0,
  maxP95DeltaE:3.0,
  maxAbsLabBias:0.4,
  minSsim:0.97,
  minSharpnessRatio:0.85,
  maxSharpnessRatio:1.15,
  maxAspectError:0.03
};

/**
 * Forward check against a LOSSY export (JPEG/WebP) of the composite. Allows codec noise but is
 * still far tighter than the rectified check. Use FORWARD_TOLERANCES on the lossless PNG master.
 */
export const LOSSY_FORWARD_TOLERANCES:FidelityTolerances={
  maxMeanDeltaE:2.0,
  maxP95DeltaE:5.0,
  maxAbsLabBias:0.5,
  minSsim:0.95,
  minSharpnessRatio:0.8,
  maxSharpnessRatio:1.4,
  maxAspectError:0.03
};

/**
 * Forward check for output that includes bounded, colour-neutral LIGHTING INTEGRATION (a smooth
 * illumination gain of at most a few percent). Luminance may move a little; chroma must not.
 */
export const LIGHTING_FORWARD_TOLERANCES:FidelityTolerances={
  maxMeanDeltaE:2.5,
  maxP95DeltaE:6.0,
  maxAbsLabBias:1.6,
  maxAbsLBias:1.8,
  maxAbsChromaBias:0.5,
  minSsim:0.95,
  minSharpnessRatio:0.9,
  maxSharpnessRatio:1.12,
  maxAspectError:0.03
};

/** Rectified cross-check for lighting-integrated output: independent path, so looser, chroma still tight. */
export const LIGHTING_RECTIFIED_TOLERANCES:FidelityTolerances={
  maxMeanDeltaE:3.0,
  maxP95DeltaE:8.0,
  maxAbsLabBias:1.8,
  maxAbsLBias:2.0,
  maxAbsChromaBias:0.7,
  minSsim:0.9,
  minSharpnessRatio:0.55,
  maxSharpnessRatio:1.3,
  maxAspectError:0.03
};

/**
 * Rectified check: the composite is warped back and compared with the source. Independent of the
 * compositor's own warp, but every output pays for a second resample, so tolerances are looser.
 */
export const RECTIFIED_TOLERANCES:FidelityTolerances={
  maxMeanDeltaE:2.0,
  maxP95DeltaE:6.0,
  maxAbsLabBias:0.8,
  minSsim:0.92,
  minSharpnessRatio:0.55,
  maxSharpnessRatio:1.3,
  maxAspectError:0.03
};

export type FidelityFailureCode=
  | "COLOUR_DRIFT"
  | "COLOUR_BIAS"
  | "STRUCTURE_LOSS"
  | "SOFTENED"
  | "OVER_SHARPENED"
  | "PROPORTION_CHANGED";

export function evaluateFidelity(m:ImageMetrics,tol:FidelityTolerances=FORWARD_TOLERANCES){
  const failures:{code:FidelityFailureCode;detail:string}[]=[];
  if(m.meanDeltaE>tol.maxMeanDeltaE || m.p95DeltaE>tol.maxP95DeltaE){
    failures.push({code:"COLOUR_DRIFT",detail:`mean dE ${m.meanDeltaE.toFixed(2)}, p95 dE ${m.p95DeltaE.toFixed(2)}`});
  }
  const lLimit=tol.maxAbsLBias ?? tol.maxAbsLabBias;
  const cLimit=tol.maxAbsChromaBias ?? tol.maxAbsLabBias;
  const biasBreach=Math.abs(m.labBias.L)>lLimit || Math.abs(m.labBias.a)>cLimit || Math.abs(m.labBias.b)>cLimit;
  if(biasBreach){
    failures.push({code:"COLOUR_BIAS",detail:`Lab bias L ${m.labBias.L.toFixed(2)}, a ${m.labBias.a.toFixed(2)}, b ${m.labBias.b.toFixed(2)}`});
  }
  if(m.ssim<tol.minSsim){
    failures.push({code:"STRUCTURE_LOSS",detail:`SSIM ${m.ssim.toFixed(3)}`});
  }
  if(m.sharpnessRatio<tol.minSharpnessRatio){
    failures.push({code:"SOFTENED",detail:`sharpness ratio ${m.sharpnessRatio.toFixed(2)}`});
  }
  if(m.sharpnessRatio>tol.maxSharpnessRatio){
    failures.push({code:"OVER_SHARPENED",detail:`sharpness ratio ${m.sharpnessRatio.toFixed(2)}`});
  }
  return {pass:failures.length===0,failures};
}
