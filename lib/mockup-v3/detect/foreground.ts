import type {RawImage} from "../types";
import {solveLinear} from "../geometry/homography";
import {srgbToLab} from "../qa/metrics";
import {closeMask,openMask} from "../vision/mask";
import {downscaleToMax,type Mask} from "../vision/gray";

export type ForegroundResult={
  mask:Mask;
  /** Colour distance (Lab dE76) from the fitted background surface, at analysis resolution. */
  deltaE:Float32Array;
  width:number;
  height:number;
  /** analysis px per source px */
  scale:number;
  threshold:number;
  /** Analysis-resolution mask of ignored (unknown) pixels, 1 = ignored. */
  ignored:Uint8Array;
  /** Robust noise level of the background fit (dE). */
  noise:number;
  /** Fraction of pixels explained by the background model. */
  backgroundFraction:number;
};

export type ForegroundOptions={
  maxDim?:number;
  /** Minimum dE for foreground (default 6). */
  minDeltaE?:number;
  /** Multiples of the robust noise level (default 6). */
  noiseMultiple?:number;
  /** Override the final threshold. */
  threshold?:number;
  /** Pixels (full-res alpha, 255 = unknown, e.g. a manual occlusion mask) excluded from the fit and never foreground. */
  ignore?:{width:number;height:number;alpha:Uint8Array};
};

const TERMS=6;
const basis=(x:number,y:number)=>[1,x,y,x*x,x*y,y*y];

/**
 * Model the dominant smooth surface (wall, table, backdrop) as a quadratic in each Lab channel,
 * fitted robustly (Tukey biweight, so objects are outliers) and flag pixels that deviate from it.
 * Handles lighting gradients and vignetting that defeat a single "border colour".
 */
export function foregroundMask(img:RawImage,opts:ForegroundOptions={}):ForegroundResult{
  const {image,scale}=downscaleToMax(img,opts.maxDim ?? 480);
  const w=image.width,h=image.height,n=w*h;
  const L=new Float32Array(n),A=new Float32Array(n),B=new Float32Array(n);
  for(let i=0;i<n;i++){
    const lab=srgbToLab(image.data[i*4],image.data[i*4+1],image.data[i*4+2]);
    L[i]=lab[0];A[i]=lab[1];B[i]=lab[2];
  }
  const ch=[L,A,B];
  const coef=[0,1,2].map(()=>new Array<number>(TERMS).fill(0));
  const weights=new Float32Array(n).fill(1);
  const resid=new Float32Array(n);
  const norm=(i:number)=>{const x=i%w,y=(i-x)/w;return [(x+0.5)/w*2-1,(y+0.5)/h*2-1] as const;};
  const stride=2;
  const ignored=new Uint8Array(n);
  if(opts.ignore){
    const ig=opts.ignore;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const sx=Math.min(ig.width-1,Math.floor((x+0.5)/scale)),sy=Math.min(ig.height-1,Math.floor((y+0.5)/scale));
      if(ig.alpha[sy*ig.width+sx]>32) ignored[y*w+x]=1;
    }
    // grow slightly: feathered mask edges and sub-pixel misalignment
    const g=new Uint8Array(ignored);
    for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++) if(ignored[y*w+x]) for(let j=-2;j<=2;j++) for(let i=-2;i<=2;i++){const yy=y+j,xx=x+i;if(yy>=0&&xx>=0&&yy<h&&xx<w) g[yy*w+xx]=1;}
    ignored.set(g);
  }
  weights.set(ignored.map((v)=>v?0:1));

  let sigma=1;
  for(let iter=0;iter<10;iter++){
    for(let c=0;c<3;c++){
      const M=Array.from({length:TERMS},()=>new Array<number>(TERMS).fill(0));
      const V=new Array<number>(TERMS).fill(0);
      for(let y=0;y<h;y+=stride){
        for(let x=0;x<w;x+=stride){
          const i=y*w+x;
          const wt=weights[i];
          if(wt<=0) continue;
          const [nx,ny]=norm(i);
          const b=basis(nx,ny);
          for(let r=0;r<TERMS;r++){
            V[r]+=wt*b[r]*ch[c][i];
            for(let k=0;k<TERMS;k++) M[r][k]+=wt*b[r]*b[k];
          }
        }
      }
      for(let r=0;r<TERMS;r++) M[r][r]+=1e-6;
      const sol=solveLinear(M,V);
      if(sol) coef[c]=sol;
    }
    for(let i=0;i<n;i++){
      const [nx,ny]=norm(i);
      const b=basis(nx,ny);
      let s=0;
      for(let c=0;c<3;c++){
        let p=0;
        for(let r=0;r<TERMS;r++) p+=coef[c][r]*b[r];
        const d=ch[c][i]-p;
        s+=d*d;
      }
      resid[i]=Math.sqrt(s);
    }
    const sorted=Float32Array.from(resid).sort();
    const med=sorted[Math.floor(n/2)];
    sigma=Math.max(0.6,1.4826*med);
    const cut=3.2*sigma;
    for(let i=0;i<n;i++){
      const u=resid[i]/cut;
      weights[i]=ignored[i]?0:(u<1?(1-u*u)**2:0);
    }
  }

  // Cap the automatic threshold: in rooms with several differently lit surfaces the global fit is
  // poor, the noise estimate balloons, and pale objects would shatter into fragments.
  const threshold=opts.threshold ?? Math.min(18,Math.max(opts.minDeltaE ?? 6,(opts.noiseMultiple ?? 6)*sigma));
  const raw:Mask={width:w,height:h,data:new Uint8Array(n)};
  let inl=0;
  for(let i=0;i<n;i++){
    raw.data[i]=(!ignored[i] && resid[i]>threshold)?1:0;
    if(!raw.data[i]) inl++;
  }
  const mask=closeMask(openMask(raw,1),1);
  return {mask,deltaE:resid,width:w,height:h,scale,threshold,ignored,noise:sigma,backgroundFraction:inl/n};
}
