import type {Mat3,Pt,Quad,RawImage} from "../types";
import {homographyFromPoints,invertMat3} from "./homography";
import {rectQuad,signedArea,validateQuad} from "./quad";

/**
 * Perspective warping of raw RGBA images.
 *
 * - Sampling is done in LINEAR LIGHT on premultiplied alpha (no dark fringes, no gamma shift).
 * - A mip pyramid with per-pixel level selection prevents aliasing when shrinking.
 * - Quad edges are anti-aliased by supersampled coverage; colour at edges is edge-clamped, so
 *   the artwork's own border colours never bleed with transparent black.
 * Recommended maximum source size is about 4096x4096 (float pyramid memory).
 */

export type WarpOptions={
  /** Coverage subsamples per axis at quad edges (default 4 => 16 samples). */
  supersample?:number;
  /** Allow mirrored corner order (default false: mirroring artwork is almost always a bug). */
  allowMirrored?:boolean;
};

type LinearImage={width:number;height:number;data:Float32Array};

const SRGB_TO_LINEAR=(()=>{
  const t=new Float32Array(256);
  for(let i=0;i<256;i++){
    const c=i/255;
    t[i]=c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
  }
  return t;
})();

function linearToSrgb8(v:number){
  if(!(v>0)) return 0;
  if(v>=1) return 255;
  const c=v<=0.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-0.055;
  return Math.round(c*255);
}

function toLinearPremultiplied(img:RawImage):LinearImage{
  const n=img.width*img.height;
  const out=new Float32Array(n*4);
  for(let i=0;i<n;i++){
    const a=img.data[i*4+3]/255;
    out[i*4]=SRGB_TO_LINEAR[img.data[i*4]]*a;
    out[i*4+1]=SRGB_TO_LINEAR[img.data[i*4+1]]*a;
    out[i*4+2]=SRGB_TO_LINEAR[img.data[i*4+2]]*a;
    out[i*4+3]=a;
  }
  return {width:img.width,height:img.height,data:out};
}

function halve(src:LinearImage):LinearImage{
  const w=Math.max(1,src.width>>1);
  const h=Math.max(1,src.height>>1);
  const out=new Float32Array(w*h*4);
  for(let y=0;y<h;y++){
    const y0=Math.min(src.height-1,y*2);
    const y1=Math.min(src.height-1,y*2+1);
    for(let x=0;x<w;x++){
      const x0=Math.min(src.width-1,x*2);
      const x1=Math.min(src.width-1,x*2+1);
      for(let c=0;c<4;c++){
        out[(y*w+x)*4+c]=(
          src.data[(y0*src.width+x0)*4+c]+
          src.data[(y0*src.width+x1)*4+c]+
          src.data[(y1*src.width+x0)*4+c]+
          src.data[(y1*src.width+x1)*4+c]
        )/4;
      }
    }
  }
  return {width:w,height:h,data:out};
}

function buildPyramid(img:RawImage):LinearImage[]{
  const levels=[toLinearPremultiplied(img)];
  while(levels.length<13){
    const last=levels[levels.length-1];
    if(last.width<=1 && last.height<=1) break;
    levels.push(halve(last));
  }
  return levels;
}

/** Bilinear sample at pixel-edge coords (u,v) with edge clamping; accumulates weight*value into out. */
function sampleInto(level:LinearImage,u:number,v:number,weight:number,out:Float64Array){
  const x=u-0.5;
  const y=v-0.5;
  const x0=Math.floor(x);
  const y0=Math.floor(y);
  const fx=x-x0;
  const fy=y-y0;
  const xa=Math.min(level.width-1,Math.max(0,x0));
  const xb=Math.min(level.width-1,Math.max(0,x0+1));
  const ya=Math.min(level.height-1,Math.max(0,y0));
  const yb=Math.min(level.height-1,Math.max(0,y0+1));
  const w00=(1-fx)*(1-fy)*weight;
  const w10=fx*(1-fy)*weight;
  const w01=(1-fx)*fy*weight;
  const w11=fx*fy*weight;
  const d=level.data;
  const i00=(ya*level.width+xa)*4;
  const i10=(ya*level.width+xb)*4;
  const i01=(yb*level.width+xa)*4;
  const i11=(yb*level.width+xb)*4;
  for(let c=0;c<4;c++){
    out[c]+=d[i00+c]*w00+d[i10+c]*w10+d[i01+c]*w01+d[i11+c]*w11;
  }
}

type EdgeTest=(x:number,y:number)=>boolean;

function makeInsideTest(q:Quad):EdgeTest{
  const sign=signedArea(q)>=0?1:-1;
  const edges=[0,1,2,3].map((i)=>{
    const a=q[i];
    const b=q[(i+1)%4];
    return {ax:a.x,ay:a.y,dx:b.x-a.x,dy:b.y-a.y};
  });
  return (x,y)=>{
    for(const e of edges){
      if(sign*(e.dx*(y-e.ay)-e.dy*(x-e.ax))<0) return false;
    }
    return true;
  };
}

function warpCore(
  src:RawImage,
  sampleMap:Mat3,
  coverageQuad:Quad|null,
  outW:number,
  outH:number,
  ss:number
):RawImage{
  const out=new Uint8ClampedArray(outW*outH*4);
  const pyramid=buildPyramid(src);
  const maxLevel=pyramid.length-1;
  const inside=coverageQuad?makeInsideTest(coverageQuad):null;
  const vertexPixels=new Set<number>();
  if(coverageQuad){
    for(const p of coverageQuad){
      const px=Math.floor(p.x);
      const py=Math.floor(p.y);
      if(px>=0 && py>=0 && px<outW && py<outH) vertexPixels.add(py*outW+px);
    }
  }
  const [h0,h1,h2,h3,h4,h5,h6,h7,h8]=sampleMap;
  const acc=new Float64Array(4);

  for(let y=0;y<outH;y++){
    for(let x=0;x<outW;x++){
      let cov=1;
      if(inside){
        const cx=x+0.5;
        const cy=y+0.5;
        const n=(inside(x,y)?1:0)+(inside(x+1,y)?1:0)+(inside(x,y+1)?1:0)+(inside(x+1,y+1)?1:0)+(inside(cx,cy)?1:0);
        if(n===5){
          cov=1;
        }else if(n===0 && !vertexPixels.has(y*outW+x)){
          continue;
        }else{
          let hit=0;
          for(let sy=0;sy<ss;sy++){
            for(let sx=0;sx<ss;sx++){
              if(inside(x+(sx+0.5)/ss,y+(sy+0.5)/ss)) hit++;
            }
          }
          cov=hit/(ss*ss);
          if(cov===0) continue;
        }
      }

      const px=x+0.5;
      const py=y+0.5;
      const a=h0*px+h1*py+h2;
      const b=h3*px+h4*py+h5;
      const w=h6*px+h7*py+h8;
      if(!Number.isFinite(w) || Math.abs(w)<1e-12) continue;
      const u=a/w;
      const v=b/w;

      const w2=w*w;
      const dudx=(h0*w-a*h6)/w2;
      const dudy=(h1*w-a*h7)/w2;
      const dvdx=(h3*w-b*h6)/w2;
      const dvdy=(h4*w-b*h7)/w2;
      const scale=Math.sqrt(Math.abs(dudx*dvdy-dudy*dvdx));
      const L=Math.min(maxLevel,Math.max(0,Math.log2(Math.max(scale,1))));
      const l0=Math.floor(L);
      const t=L-l0;

      acc[0]=acc[1]=acc[2]=acc[3]=0;
      sampleInto(pyramid[l0],u/(1<<l0),v/(1<<l0),1-t,acc);
      if(t>1e-6 && l0<maxLevel){
        sampleInto(pyramid[l0+1],u/(1<<(l0+1)),v/(1<<(l0+1)),t,acc);
      }

      const alpha=acc[3];
      const o=(y*outW+x)*4;
      if(alpha<=1e-6) continue;
      out[o]=linearToSrgb8(acc[0]/alpha);
      out[o+1]=linearToSrgb8(acc[1]/alpha);
      out[o+2]=linearToSrgb8(acc[2]/alpha);
      out[o+3]=Math.round(Math.min(1,alpha)*cov*255);
    }
  }
  return {width:outW,height:outH,data:out};
}

/**
 * Project the whole source image onto `dstQuad` inside a transparent outW x outH canvas.
 * Corner mapping: source TL,TR,BR,BL -> dstQuad[0..3].
 */
export function warpToQuad(src:RawImage,dstQuad:Quad,outW:number,outH:number,opts:WarpOptions={}):RawImage{
  const v=validateQuad(dstQuad,{minAreaPx:1,minEdgePx:1,minInteriorAngleDeg:1,allowMirrored:opts.allowMirrored});
  if(!v.ok) throw new Error("Invalid destination quad: "+v.issues.map((i)=>i.code).join(", "));
  const H=homographyFromPoints(rectQuad(src.width,src.height),dstQuad);
  const inv=H && invertMat3(H);
  if(!inv) throw new Error("Degenerate destination quad: homography is singular.");
  return warpCore(src,inv,dstQuad,outW,outH,Math.max(1,opts.supersample ?? 4));
}

/**
 * Rectify the region `srcQuad` of `src` into an upright outW x outH image
 * (srcQuad TL,TR,BR,BL -> output corners). Samples outside the source are edge-clamped.
 */
export function rectifyQuad(src:RawImage,srcQuad:Quad,outW:number,outH:number,opts:WarpOptions={}):RawImage{
  const v=validateQuad(srcQuad,{minAreaPx:1,minEdgePx:1,minInteriorAngleDeg:1,allowMirrored:opts.allowMirrored});
  if(!v.ok) throw new Error("Invalid source quad: "+v.issues.map((i)=>i.code).join(", "));
  const map=homographyFromPoints(rectQuad(outW,outH),srcQuad);
  if(!map) throw new Error("Degenerate source quad: homography is singular.");
  return warpCore(src,map,null,outW,outH,1);
}

export function solidImage(width:number,height:number,rgba:[number,number,number,number]):RawImage{
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){
    data[i*4]=rgba[0];
    data[i*4+1]=rgba[1];
    data[i*4+2]=rgba[2];
    data[i*4+3]=rgba[3];
  }
  return {width,height,data};
}

/**
 * Alpha-composite `layer` over `base` (same size), blending in linear light.
 * Pixels with layer alpha 0 or 255 are copied exactly (no round-trip drift).
 */
export function compositeOver(base:RawImage,layer:RawImage):RawImage{
  if(base.width!==layer.width || base.height!==layer.height){
    throw new Error("compositeOver requires equal image sizes.");
  }
  const out=new Uint8ClampedArray(base.data);
  const n=base.width*base.height;
  for(let i=0;i<n;i++){
    const o=i*4;
    const la=layer.data[o+3];
    if(la===0) continue;
    if(la===255){
      out[o]=layer.data[o];
      out[o+1]=layer.data[o+1];
      out[o+2]=layer.data[o+2];
      out[o+3]=255;
      continue;
    }
    const a=la/255;
    const ba=base.data[o+3]/255;
    const oa=a+ba*(1-a);
    for(let c=0;c<3;c++){
      const lc=SRGB_TO_LINEAR[layer.data[o+c]]*a;
      const bc=SRGB_TO_LINEAR[base.data[o+c]]*ba*(1-a);
      out[o+c]=linearToSrgb8((lc+bc)/oa);
    }
    out[o+3]=Math.round(oa*255);
  }
  return {width:base.width,height:base.height,data:out};
}

export function pixelAt(img:RawImage,x:number,y:number):[number,number,number,number]{
  const o=(y*img.width+x)*4;
  return [img.data[o],img.data[o+1],img.data[o+2],img.data[o+3]];
}

export type {Pt};
