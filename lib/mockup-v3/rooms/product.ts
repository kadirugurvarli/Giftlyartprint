import sharp from "sharp";
import type {Pt,RawImage} from "../types";
import {gaussianBlurPlane} from "../vision/gray";
import {allowedFrameSize,type FrameSizeCm} from "./schema";

/**
 * A frame described in real units. The artwork is only ever scaled UNIFORMLY (never stretched or
 * cropped); any proportion difference between print and window goes into a wider mount.
 */
export type FrameSpec={
  outerCm:FrameSizeCm;
  /** Visible face of the moulding, cm. */
  mouldingWidthCm:number;
  /** How far the frame stands off the wall, cm (shadow standoff and visible side face). */
  frameDepthCm:number;
  /** Minimum mount border around the print, cm (0 = print touches the moulding rebate). */
  mountWidthCm:number;
  mouldingColour:[number,number,number];
  mountColour:[number,number,number];
  /** 0-1 strength of the moulding's bevel shading (default 0.6). */
  bevel?:number;
  /** Fine wood/paper grain in 8-bit levels (default 2.5). */
  grain?:number;
  /**
   * Shade the print edge next to the mount (0-0.3). Default 0: the customer's pixels are not touched.
   * Anything above 0 modifies print pixels and must only be used at the opt-in photographic level.
   */
  printEdgeShadow?:number;
};

export type Rect={x:number;y:number;width:number;height:number};

export type FramePlan={
  pxPerCm:number;
  outer:{width:number;height:number};
  mouldingPx:number;
  /** Window inside the moulding. */
  opening:Rect;
  /** Where the print shows (uniformly scaled, centred in the window). */
  print:Rect;
  /** Share of the window the print fills in its limiting / other dimension. */
  fill:{limiting:number;other:number};
  /** Extra mount (beyond the minimum) added to make the shapes agree, as a fraction of the window. */
  extraMountFraction:{x:number;y:number};
};

export const FRAME_LIMITS={
  mouldingCm:[1,5] as [number,number],
  depthCm:[1,6] as [number,number],
  mountCm:[0,10] as [number,number],
  /** the non-limiting dimension must still fill this much of the space left by the minimum mount */
  minPrintFill:0.7
};

export type PlanResult={ok:true;plan:FramePlan}|{ok:false;error:string};

export function validateFrameSpec(spec:FrameSpec):string|null{
  if(!spec||!allowedFrameSize(spec.outerCm)) return "FRAME_SIZE_OUT_OF_RANGE";
  const L=FRAME_LIMITS;
  const ok=(v:number,[a,b]:[number,number])=>Number.isFinite(v)&&v>=a&&v<=b;
  if(!ok(spec.mouldingWidthCm,L.mouldingCm)||!ok(spec.frameDepthCm,L.depthCm)||!ok(spec.mountWidthCm,L.mountCm)) return "INVALID_FRAME_SPEC";
  const col=(c:number[])=>Array.isArray(c)&&c.length===3&&c.every(v=>Number.isFinite(v)&&v>=0&&v<=255);
  if(!col(spec.mouldingColour)||!col(spec.mountColour)) return "INVALID_FRAME_SPEC";
  const win={w:spec.outerCm.width-2*spec.mouldingWidthCm,h:spec.outerCm.height-2*spec.mouldingWidthCm};
  if(win.w-2*spec.mountWidthCm<8||win.h-2*spec.mountWidthCm<8) return "INVALID_FRAME_SPEC";
  if(spec.printEdgeShadow!==undefined&&!(spec.printEdgeShadow>=0&&spec.printEdgeShadow<=0.3)) return "INVALID_FRAME_SPEC";
  return null;
}

/**
 * Integer pixels-per-cm so the outer size is an exact integer number of pixels (no aspect rounding). The piece is
 * drawn at about twice the resolution it will be shown at, then softened (see `edgeSigmaPx`) so its fine edges survive resampling.
 */
export function choosePxPerCm(localWallPxPerCm:number,outerMaxCm:number,maxSidePx=3000):number{
  const want=Math.ceil(Math.max(8,localWallPxPerCm*2));
  return Math.max(4,Math.min(want,Math.floor(maxSidePx/outerMaxCm)));
}

export function planFlatFrame(spec:FrameSpec,artwork:{width:number;height:number},pxPerCm:number):PlanResult{
  const bad=validateFrameSpec(spec);
  if(bad) return {ok:false,error:bad};
  if(!(artwork.width>0&&artwork.height>0)||!Number.isInteger(pxPerCm)||pxPerCm<1) return {ok:false,error:"INVALID_ARTWORK"};
  const W=spec.outerCm.width*pxPerCm,H=spec.outerCm.height*pxPerCm;
  const m=Math.round(spec.mouldingWidthCm*pxPerCm);
  const opening:Rect={x:m,y:m,width:W-2*m,height:H-2*m};
  const mount=Math.round(spec.mountWidthCm*pxPerCm);
  const availW=opening.width-2*mount,availH=opening.height-2*mount;
  const scale=Math.min(availW/artwork.width,availH/artwork.height); // contain: never crop, never stretch
  const pw=Math.max(1,Math.round(artwork.width*scale)),ph=Math.max(1,Math.round(artwork.height*scale));
  const fw=pw/availW,fh=ph/availH;
  const limiting=Math.max(fw,fh),other=Math.min(fw,fh);
  if(other/limiting<FRAME_LIMITS.minPrintFill) return {ok:false,error:"ARTWORK_ASPECT_TOO_DIFFERENT_FOR_FRAME"};
  const print:Rect={x:opening.x+Math.floor((opening.width-pw)/2),y:opening.y+Math.floor((opening.height-ph)/2),width:pw,height:ph};
  return {ok:true,plan:{
    pxPerCm,outer:{width:W,height:H},mouldingPx:m,opening,print,fill:{limiting:1,other:other/limiting},
    extraMountFraction:{x:(opening.width-pw-2*mount)/opening.width,y:(opening.height-ph-2*mount)/opening.height}
  }};
}

/** One resample, Lanczos. Exported so tests can prove the print pixels in the frame are exactly this. */
export async function resizeArtwork(art:RawImage,width:number,height:number):Promise<RawImage>{
  const {data,info}=await sharp(Buffer.from(art.data.buffer,art.data.byteOffset,art.data.byteLength),{raw:{width:art.width,height:art.height,channels:4}})
    .resize(width,height,{kernel:"lanczos3"}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {width:info.width,height:info.height,data:new Uint8ClampedArray(data.buffer,data.byteOffset,data.byteLength)};
}

const clamp8=(v:number)=>Math.max(0,Math.min(255,v));
function hash(x:number,y:number){
  let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263))>>>0;
  h=(Math.imul(h^(h>>>13),1274126177))>>>0;
  return ((h^(h>>>16))>>>0)/4294967296;
}

export type RenderedFrame={image:RawImage;plan:FramePlan;printPixels:RawImage};

/**
 * Render the finished piece (moulding with a rounded bevel, mount with a bevel-cut window and a rebate
 * shadow, the print) lit by the ROOM's key light. `shadowDir` is where shadows fall (image space), so
 * surfaces facing away from it catch the light. The print is copied unchanged unless `printEdgeShadow` > 0.
 */
export async function renderFlatFramedPiece(art:RawImage,spec:FrameSpec,shadowDir:Pt,pxPerCm:number,edgeSigmaPx=0):Promise<RenderedFrame>{
  const planned=planFlatFrame(spec,art,pxPerCm);
  if(!planned.ok) throw new Error(planned.error);
  const plan=planned.plan;
  const {width:W,height:H}=plan.outer;
  const print=await resizeArtwork(art,plan.print.width,plan.print.height);
  const len=Math.hypot(shadowDir.x,shadowDir.y)||1;
  const L:Pt={x:-shadowDir.x/len,y:-shadowDir.y/len}; // towards the light
  const bevel=spec.bevel ?? 0.6,grain=spec.grain ?? 2.5;
  const out=new Uint8ClampedArray(W*H*4);
  const m=plan.mouldingPx,op=plan.opening,pr=plan.print;
  const cutPx=Math.max(1,Math.round(0.3*pxPerCm));          // 45° mount cut, 3 mm
  const rebatePx=Math.max(2,Math.round(0.5*pxPerCm));        // reach of the moulding's shadow on the mount
  const dotL=(nx:number,ny:number)=>nx*L.x+ny*L.y;
  const mc=spec.mouldingColour,bc=spec.mountColour;
  const printShadow=spec.printEdgeShadow ?? 0;
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const o=(y*W+x)*4;
      let r:number,g:number,b:number;
      const dl=x,dr=W-1-x,dt=y,db=H-1-y;
      const d=Math.min(dl,dr,dt,db);
      if(d<m){
        // moulding: rounded profile, outer half slopes outwards, inner half inwards
        const u=(d+0.5)/m;
        const side=d===dt?[0,-1]:d===dl?[-1,0]:d===db?[0,1]:[1,0];
        const slope=1-2*u;                                   // +1 outer edge ... -1 inner edge
        const nx=side[0]*slope,ny=side[1]*slope;
        let k=0.97*(1+0.55*bevel*dotL(nx,ny));
        if(u<0.14) k*=1+0.12*Math.max(0,dotL(side[0],side[1]));   // thin ridge highlight on lit outer edge
        if(u>0.93) k*=0.7;                                    // dark rebate where moulding meets the mount
        const along=side[0]!==0?y:x;
        const streak=(hash(d*7919,along>>3)-0.5)*2*grain+(hash(d,along)-0.5)*grain*0.5;
        r=clamp8(mc[0]*k+streak);g=clamp8(mc[1]*k+streak*0.9);b=clamp8(mc[2]*k+streak*0.8);
      }else if(x>=pr.x&&x<pr.x+pr.width&&y>=pr.y&&y<pr.y+pr.height){
        const po=((y-pr.y)*pr.width+(x-pr.x))*4;
        r=print.data[po];g=print.data[po+1];b=print.data[po+2];
        if(printShadow>0){
          // shade the print edge nearest the light-facing mount edge (shadow falls along shadowDir)
          const kx=Math.max(0,1-(x-pr.x)/rebatePx)*Math.max(0,-L.x)+Math.max(0,1-(pr.x+pr.width-1-x)/rebatePx)*Math.max(0,L.x);
          const ky=Math.max(0,1-(y-pr.y)/rebatePx)*Math.max(0,-L.y)+Math.max(0,1-(pr.y+pr.height-1-y)/rebatePx)*Math.max(0,L.y);
          const s=1-printShadow*Math.min(1,kx+ky);
          r*=s;g*=s;b*=s;
        }
      }else{
        // mount board
        const gdn=(hash(x*3,y*3)-0.5)*2*grain*0.35;
        let k=1;
        // bevel-cut window edge (white core) just outside the print
        const ex=x<pr.x?pr.x-x:x>=pr.x+pr.width?x-(pr.x+pr.width-1):0;
        const ey=y<pr.y?pr.y-y:y>=pr.y+pr.height?y-(pr.y+pr.height-1):0;
        const e=Math.max(ex,ey);
        if(e>0&&e<=cutPx){
          // normal of the cut face points back towards the print centre
          const nx=ex>=ey?(x<pr.x?1:-1):0,ny=ey>ex?(y<pr.y?1:-1):0;
          const kk=0.94+0.1*dotL(nx,ny);
          r=clamp8(250*kk);g=clamp8(248*kk);b=clamp8(243*kk);
        }else{
          // rebate shadow of the moulding on the mount: falls along shadowDir from edges on the light side
          let sh=0;
          const fall=(dist:number)=>Math.exp(-dist/rebatePx);
          const fromLeft=Math.max(0,shadowDir.x/len)*fall(x-op.x),fromRight=Math.max(0,-shadowDir.x/len)*fall(op.x+op.width-1-x);
          const fromTop=Math.max(0,shadowDir.y/len)*fall(y-op.y),fromBottom=Math.max(0,-shadowDir.y/len)*fall(op.y+op.height-1-y);
          sh=0.32*Math.min(1,fromLeft+fromRight+fromTop+fromBottom);
          k=1-sh;
          r=clamp8((bc[0]+gdn)*k);g=clamp8((bc[1]+gdn)*k);b=clamp8((bc[2]+gdn)*k);
        }
      }
      out[o]=r;out[o+1]=g;out[o+2]=b;out[o+3]=255;
    }
  }
  // Real edges are never razor sharp at the scale a piece is photographed. Softening ONLY the frame and mount (never a
  // print pixel) also stops hairline bevels from aliasing differently every time the piece is resampled.
  if(edgeSigmaPx>0){
    const planes=[0,1,2].map(c=>{const f=new Float32Array(W*H);for(let i=0;i<f.length;i++) f[i]=out[i*4+c];return gaussianBlurPlane(f,W,H,edgeSigmaPx);});
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      if(x>=pr.x&&x<pr.x+pr.width&&y>=pr.y&&y<pr.y+pr.height) continue;
      const i=y*W+x;
      for(let c=0;c<3;c++) out[i*4+c]=clamp8(Math.round(planes[c][i]));
    }
  }
  return {image:{width:W,height:H,data:out},plan,printPixels:print};
}
