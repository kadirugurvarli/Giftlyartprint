import type {Pt,Quad} from "../mockup-v3/types";
import {rasterizePolygons} from "../mockup-v3/vision/mask";
import type {EditorConstraints,Rect} from "./types";

export type EditMaskInput={
  width:number;height:number;
  /** Outer edge of the frame in the scene. */
  outerQuad:Quad;
  /** The visible print (inside the mount). Never editable. */
  artQuad:Quad;
  /** Unit-ish direction the shadow falls in image space. */
  shadowDir:Pt;
  /** How far (px) the frame's shadow reaches onto the wall. 0 disables the shadow band. */
  shadowBandPx:number;
  /** Wall-only alpha (0-255). Without it NO shadow band is allowed (cannot prove it stays on the wall). */
  wallAlpha?:Uint8Array|null;
  /** Polygons that must never change (furniture, plants, floor). */
  protect?:Pt[][];
  /** Safety margin kept around the print, px. */
  artGuardPx?:number;
  /** Margin around the frame the model may soften/blend, px. */
  frameGrowPx?:number;
};

export type EditMask={
  width:number;height:number;
  /** 255 where the model may change pixels, 0 elsewhere (full scene size). */
  editable:Uint8Array;
  stats:{editablePixels:number;share:number;framePixels:number;shadowPixels:number;shadowBand:boolean};
};

function grow(q:Quad,amount:number):Quad{
  const cx=(q[0].x+q[1].x+q[2].x+q[3].x)/4,cy=(q[0].y+q[1].y+q[2].y+q[3].y)/4;
  return q.map((p)=>{const dx=p.x-cx,dy=p.y-cy,l=Math.hypot(dx,dy)||1;return {x:p.x+dx/l*amount,y:p.y+dy/l*amount};}) as Quad;
}
const shift=(q:Quad,d:Pt):Quad=>q.map((p)=>({x:p.x+d.x,y:p.y+d.y})) as Quad;

/**
 * Bounded frame-and-shadow edit mask: frame moulding + mount ring (minus the print and a guard around it)
 * plus a wall-only shadow band beside the frame. Furniture polygons are subtracted last.
 */
export function buildEditMask(i:EditMaskInput):EditMask{
  const {width:W,height:H}=i;
  const n=W*H;
  const frame=rasterizePolygons([grow(i.outerQuad,i.frameGrowPx ?? 2)],W,H);
  const art=rasterizePolygons([grow(i.artQuad,i.artGuardPx ?? 2)],W,H);
  const prot=i.protect?.length?rasterizePolygons(i.protect,W,H):null;
  const useShadow=i.shadowBandPx>0&&!!i.wallAlpha;
  let shadow:Uint8Array|null=null;
  if(useShadow){
    const l=Math.hypot(i.shadowDir.x,i.shadowDir.y)||1;
    const d={x:i.shadowDir.x/l*i.shadowBandPx,y:i.shadowDir.y/l*i.shadowBandPx};
    shadow=rasterizePolygons([grow(shift(i.outerQuad,d),i.shadowBandPx*0.5)],W,H);
  }
  const editable=new Uint8Array(n);
  let frameN=0,shadowN=0;
  for(let k=0;k<n;k++){
    if(art[k]>0) continue;
    if(prot&&prot[k]>0) continue;
    if(frame[k]>=128){editable[k]=255;frameN++;continue;}
    if(shadow&&shadow[k]>=128&&i.wallAlpha![k]>=250&&frame[k]===0){editable[k]=255;shadowN++;}
  }
  return {width:W,height:H,editable,stats:{editablePixels:frameN+shadowN,share:(frameN+shadowN)/n,framePixels:frameN,shadowPixels:shadowN,shadowBand:useShadow}};
}

export type CropResult={ok:true;crop:Rect}|{ok:false;error:string};

/**
 * Smallest crop around the editable area (plus context margin) that satisfies the editor's constraints:
 * dimensions are multiples of `alignPx`, aspect within 1:maxAspect, and it fits inside the scene.
 */
export function chooseCrop(m:EditMask,c:EditorConstraints,contextPx:number):CropResult{
  let x0=Infinity,y0=Infinity,x1=-1,y1=-1;
  for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++)if(m.editable[y*m.width+x]){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  if(x1<0) return {ok:false,error:"EDIT_MASK_EMPTY"};
  const up=(v:number)=>Math.ceil(v/c.alignPx)*c.alignPx;
  let w=Math.max(c.minSide,up(x1-x0+1+2*contextPx)),h=Math.max(c.minSide,up(y1-y0+1+2*contextPx));
  if(w/h>c.maxAspect) h=up(w/c.maxAspect);
  if(h/w>c.maxAspect) w=up(h/c.maxAspect);
  if(w>m.width||h>m.height) return {ok:false,error:"CROP_LARGER_THAN_SCENE"};
  if(Math.max(w,h)>c.maxSide||w*h>c.maxPixels) return {ok:false,error:"CROP_EXCEEDS_EDITOR_LIMITS"};
  const cx=(x0+x1)/2,cy=(y0+y1)/2;
  const x=Math.max(0,Math.min(m.width-w,Math.round(cx-w/2))),y=Math.max(0,Math.min(m.height-h,Math.round(cy-h/2)));
  return {ok:true,crop:{x,y,width:w,height:h}};
}

export function cropMask(m:EditMask,r:Rect):Uint8Array{
  const out=new Uint8Array(r.width*r.height);
  for(let y=0;y<r.height;y++)out.set(m.editable.subarray((r.y+y)*m.width+r.x,(r.y+y)*m.width+r.x+r.width),y*r.width);
  return out;
}
