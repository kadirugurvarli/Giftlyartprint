import type {Pt,RawImage} from "../types";
import {rectQuad} from "../geometry/quad";
import {rectifyQuad} from "../geometry/warp";

/** Single-channel float image (luma 0-255 unless stated). */
export type GrayImage={width:number;height:number;data:Float32Array};

/** Binary mask, 1 = set. */
export type Mask={width:number;height:number;data:Uint8Array};

export function toGray(img:RawImage):GrayImage{
  const n=img.width*img.height;
  const out=new Float32Array(n);
  for(let i=0;i<n;i++){
    out[i]=0.2126*img.data[i*4]+0.7152*img.data[i*4+1]+0.0722*img.data[i*4+2];
  }
  return {width:img.width,height:img.height,data:out};
}

/** Downscale so the longer side is at most `maxDim` (area-aware via the mip-mapped warp). */
export function downscaleToMax(img:RawImage,maxDim:number):{image:RawImage;scale:number}{
  const longest=Math.max(img.width,img.height);
  if(longest<=maxDim) return {image:img,scale:1};
  const scale=maxDim/longest;
  const w=Math.max(8,Math.round(img.width*scale));
  const h=Math.max(8,Math.round(img.height*scale));
  return {image:rectifyQuad(img,rectQuad(img.width,img.height),w,h),scale:w/img.width};
}

function gaussianKernel(sigma:number){
  const r=Math.max(1,Math.ceil(sigma*3));
  const k=new Float32Array(2*r+1);
  let s=0;
  for(let i=-r;i<=r;i++){
    k[i+r]=Math.exp(-(i*i)/(2*sigma*sigma));
    s+=k[i+r];
  }
  for(let i=0;i<k.length;i++) k[i]/=s;
  return {k,r};
}

/** Separable Gaussian blur of a float plane with edge clamping. */
export function gaussianBlurPlane(src:Float32Array,width:number,height:number,sigma:number):Float32Array{
  if(sigma<=0) return new Float32Array(src);
  const {k,r}=gaussianKernel(sigma);
  const tmp=new Float32Array(src.length);
  for(let y=0;y<height;y++){
    const row=y*width;
    for(let x=0;x<width;x++){
      let s=0;
      for(let i=-r;i<=r;i++){
        const xx=Math.min(width-1,Math.max(0,x+i));
        s+=src[row+xx]*k[i+r];
      }
      tmp[row+x]=s;
    }
  }
  const out=new Float32Array(src.length);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      let s=0;
      for(let i=-r;i<=r;i++){
        const yy=Math.min(height-1,Math.max(0,y+i));
        s+=tmp[yy*width+x]*k[i+r];
      }
      out[y*width+x]=s;
    }
  }
  return out;
}

export function blurGray(g:GrayImage,sigma:number):GrayImage{
  return {width:g.width,height:g.height,data:gaussianBlurPlane(g.data,g.width,g.height,sigma)};
}

/** Sobel gradients (per-pixel, edge clamped). */
export function sobel(g:GrayImage){
  const {width:w,height:h,data:d}=g;
  const gx=new Float32Array(w*h);
  const gy=new Float32Array(w*h);
  const mag=new Float32Array(w*h);
  const at=(x:number,y:number)=>d[Math.min(h-1,Math.max(0,y))*w+Math.min(w-1,Math.max(0,x))];
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const a=at(x-1,y-1),b=at(x,y-1),c=at(x+1,y-1);
      const dd=at(x-1,y),f=at(x+1,y);
      const gg=at(x-1,y+1),hh=at(x,y+1),ii=at(x+1,y+1);
      const sx=(c+2*f+ii)-(a+2*dd+gg);
      const sy=(gg+2*hh+ii)-(a+2*b+c);
      gx[y*w+x]=sx/8;
      gy[y*w+x]=sy/8;
      mag[y*w+x]=Math.hypot(sx,sy)/8;
    }
  }
  return {gx,gy,mag};
}

/** Bilinear sample of a float plane at pixel-edge coords (u,v); clamps at the border. */
export function sampleGray(g:GrayImage,u:number,v:number):number{
  const x=u-0.5,y=v-0.5;
  const x0=Math.floor(x),y0=Math.floor(y);
  const fx=x-x0,fy=y-y0;
  const cx=(i:number)=>Math.min(g.width-1,Math.max(0,i));
  const cy=(j:number)=>Math.min(g.height-1,Math.max(0,j));
  const d=g.data,w=g.width;
  return (
    d[cy(y0)*w+cx(x0)]*(1-fx)*(1-fy)+
    d[cy(y0)*w+cx(x0+1)]*fx*(1-fy)+
    d[cy(y0+1)*w+cx(x0)]*(1-fx)*fy+
    d[cy(y0+1)*w+cx(x0+1)]*fx*fy
  );
}

export const pt=(x:number,y:number):Pt=>({x,y});
