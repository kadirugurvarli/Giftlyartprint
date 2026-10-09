import type {Pt,Quad,RawImage} from "../types";
import {gaussianBlurPlane,sampleGray,toGray,blurGray} from "../vision/gray";
import {rasterizePolygons} from "../vision/mask";
import {linearToSrgb8,SRGB_TO_LINEAR} from "./color";

/**
 * Photographic-realism effects. They only run at realism level "photographic": they act ON the
 * product pixels (bounded, hue-neutral, deterministic), so they are opt-in and always measured.
 */

export type CameraTexture={
  /** Standard deviation of fine noise in the reference (8-bit levels, luma). */
  grainSigma:number;
  /** Optical/processing softness of the reference (gaussian sigma in px). */
  blurSigma:number;
  grainSource:"measured"|"default";
  blurSource:"edge"|"default";
  samples:number;
};

function mulberry(seed:number){
  let a=seed>>>0;
  return ()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
function gauss(r:()=>number){return (r()+r()+r()+r()-2)*1.7320508;}

/** Edge spread of the reference along a straight edge: 10-90% rise width -> gaussian sigma. */
export function estimateEdgeBlur(img:RawImage,p0:Pt,p1:Pt):number|null{
  const g=toGray(img);
  const ex=p1.x-p0.x,ey=p1.y-p0.y,len=Math.hypot(ex,ey);
  if(len<30) return null;
  const nx=-ey/len,ny=ex/len;
  const R=7,step=0.25,n=Math.round(2*R/step)+1;
  const acc=new Float64Array(n);
  let used=0;
  for(let k=0;k<48;k++){
    const t=0.1+0.8*(k+0.5)/48;
    const bx=p0.x+ex*t,by=p0.y+ey*t;
    if(bx<R||by<R||bx>img.width-R||by>img.height-R) continue;
    const prof=new Float64Array(n);
    for(let i=0;i<n;i++) prof[i]=sampleGray(g,bx+nx*(-R+i*step),by+ny*(-R+i*step));
    // align at the steepest point
    let bi=0,bg=-1;
    for(let i=1;i<n-1;i++){const d=Math.abs(prof[i+1]-prof[i-1]);if(d>bg){bg=d;bi=i;}}
    if(bg<2) continue;
    const sign=prof[Math.min(n-1,bi+8)]>prof[Math.max(0,bi-8)]?1:-1;
    for(let i=0;i<n;i++){
      const j=i+(bi-Math.floor(n/2));
      acc[i]+=sign*(prof[Math.min(n-1,Math.max(0,j))]);
    }
    used++;
  }
  if(used<8) return null;
  const p=Array.from(acc,(v)=>v/used);
  const lo=Math.min(...p),hi=Math.max(...p);
  if(hi-lo<6) return null;
  const norm=p.map((v)=>(v-lo)/(hi-lo));
  const cross=(lvl:number)=>{for(let i=1;i<n;i++) if(norm[i-1]<lvl && norm[i]>=lvl) return (i-1+(lvl-norm[i-1])/(norm[i]-norm[i-1]))*step;return null;};
  const a=cross(0.1),b=cross(0.9);
  if(a===null||b===null||b<=a) return null;
  return Math.max(0.3,Math.min(3,(b-a)/2.563));
}

/** Fine-noise level measured on flat, unoccluded surfaces of the reference. */
export function estimateGrain(img:RawImage,exclude?:Uint8Array):{sigma:number;samples:number}{
  const g=toGray(img);
  const w=g.width,h=g.height;
  const soft=gaussianBlurPlane(g.data,w,h,1.6);
  const wide=gaussianBlurPlane(g.data,w,h,3.0);
  const res:number[]=[];
  for(let y=4;y<h-4;y+=2){
    for(let x=4;x<w-4;x+=2){
      const i=y*w+x;
      if(exclude && exclude[i]) continue;
      // flat: smooth low-frequency luminance (no edges nearby)
      const gx=wide[i+1]-wide[i-1],gy=wide[i+w]-wide[i-w];
      if(Math.hypot(gx,gy)>0.9) continue;
      res.push(Math.abs(g.data[i]-soft[i]));
    }
  }
  if(res.length<200) return {sigma:0,samples:res.length};
  res.sort((a,b)=>a-b);
  const med=res[res.length>>1];
  // calibrated on known gaussian noise: within ~12% for sigma >= 1.5 levels; below ~1 level the
  // estimate is quantisation-limited (absolute error < 0.5 level, visually irrelevant)
  return {sigma:Math.min(8,1.4826*med/0.97),samples:res.length};
}

export function estimateCameraTexture(reference:RawImage,o:{exclude?:Uint8Array;edge?:[Pt,Pt]|null}={}):CameraTexture{
  const grain=estimateGrain(reference,o.exclude);
  const blur=o.edge?estimateEdgeBlur(reference,o.edge[0],o.edge[1]):null;
  return {
    grainSigma:grain.samples>=200?grain.sigma:1.0,
    blurSigma:blur ?? 0.7,
    grainSource:grain.samples>=200?"measured":"default",
    blurSource:blur!==null?"edge":"default",
    samples:grain.samples
  };
}

/** Gaussian-blur the colour of a layer (premultiplied, so the matte edge does not darken). */
export function softenLayer(layer:RawImage,sigma:number):RawImage{
  if(sigma<0.25) return layer;
  const n=layer.width*layer.height;
  const ch=[0,1,2].map(()=>new Float32Array(n));
  const al=new Float32Array(n);
  for(let i=0;i<n;i++){
    const a=layer.data[i*4+3]/255;al[i]=a;
    for(let c=0;c<3;c++) ch[c][i]=SRGB_TO_LINEAR[layer.data[i*4+c]]*a;
  }
  const bc=ch.map((p)=>gaussianBlurPlane(p,layer.width,layer.height,sigma));
  const ba=gaussianBlurPlane(al,layer.width,layer.height,sigma);
  const out=new Uint8ClampedArray(layer.data);
  for(let i=0;i<n;i++){
    const a0=layer.data[i*4+3];
    if(a0===0) continue;
    const a=Math.max(1e-4,ba[i]);
    for(let c=0;c<3;c++) out[i*4+c]=linearToSrgb8(bc[c][i]/a);
  }
  return {width:layer.width,height:layer.height,data:out};
}

/** Add fine luma-correlated noise matching the reference's grain; deterministic for a given seed. */
export function addGrain(layer:RawImage,sigma:number,seed:number):RawImage{
  if(sigma<0.2) return layer;
  const r=mulberry(seed);
  const out=new Uint8ClampedArray(layer.data);
  for(let i=0;i<layer.width*layer.height;i++){
    const a=layer.data[i*4+3];
    if(a===0) continue;
    const wgt=a/255;
    const nl=gauss(r)*sigma,n0=gauss(r)*sigma*0.35,n1=gauss(r)*sigma*0.35;
    out[i*4]=Math.max(0,Math.min(255,out[i*4]+(nl+n0)*wgt));
    out[i*4+1]=Math.max(0,Math.min(255,out[i*4+1]+(nl)*wgt));
    out[i*4+2]=Math.max(0,Math.min(255,out[i*4+2]+(nl+n1)*wgt));
  }
  return {width:layer.width,height:layer.height,data:out};
}

/**
 * Soft glass sheen over the glazed area: a broad, faint diagonal highlight, oriented away from the
 * light direction and blended with "screen" in linear light (it can only lighten, hue-neutral).
 * This is a stylised reflection, NOT the room's real reflection.
 */
export function glassSheen(layer:RawImage,glazed:Quad,lightFrom:Pt,strength:number):RawImage{
  if(strength<=0) return layer;
  const {width:W,height:H}=layer;
  const cov=rasterizePolygons([glazed.map((p)=>({x:p.x,y:p.y}))],W,H,2);
  const cx=(glazed[0].x+glazed[1].x+glazed[2].x+glazed[3].x)/4,cy=(glazed[0].y+glazed[1].y+glazed[2].y+glazed[3].y)/4;
  const size=Math.hypot(glazed[2].x-glazed[0].x,glazed[2].y-glazed[0].y)/2||1;
  // sheen travels along the light's direction across the glass
  const l=Math.hypot(lightFrom.x,lightFrom.y)||1;
  const dx=-lightFrom.x/l,dy=-lightFrom.y/l; // from the light side
  const px=-dy,py=dx;
  const out=new Uint8ClampedArray(layer.data);
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const i=y*W+x;
      if(!cov[i]||layer.data[i*4+3]===0) continue;
      const u=((x-cx)*dx+(y-cy)*dy)/size;      // along light axis, -1..1
      const v=((x-cx)*px+(y-cy)*py)/size;
      const band=Math.exp(-(((u+0.35)/0.28)**2))*0.9+0.12*Math.exp(-(((u-0.15)/0.9)**2));
      const taper=Math.exp(-(v*v)/1.6);
      const s=strength*band*taper*(cov[i]/255);
      if(s<1e-4) continue;
      for(let c=0;c<3;c++){
        const lin=SRGB_TO_LINEAR[out[i*4+c]];
        out[i*4+c]=linearToSrgb8(1-(1-lin)*(1-s));
      }
    }
  }
  return {width:W,height:H,data:out};
}

void blurGray;
