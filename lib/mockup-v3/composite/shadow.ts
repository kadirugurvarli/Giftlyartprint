import type {Mat3,Pt,Quad,RawImage} from "../types";
import {applyHomography,homographyFromPoints} from "../geometry/homography";
import {rectQuad} from "../geometry/quad";
import {gaussianBlurPlane} from "../vision/gray";
import {rasterizePolygons} from "../vision/mask";
import {linearToSrgb8,SRGB_TO_LINEAR} from "./color";

export type ShadowParams={
  /** Unit vector in image space along which the shadow falls. */
  dir:Pt;
  /** Object standoff from the wall, in object-plane px (distance the shadow is displaced). */
  depthPx:number;
  /** Peak darkening of the drop shadow, 0-1. */
  dropStrength:number;
  /** Peak darkening of the tight contact shadow, 0-1. */
  contactStrength:number;
  /** Blur sigma of the drop shadow as a multiple of depthPx. */
  softness?:number;
  /** Absolute blur sigma of the drop shadow in image px; wins over `softness`. */
  softnessPx?:number;
  /** Per-channel weights (mean ~1) of the darkening in linear light, e.g. a cooler shadow under warm light. */
  tint?:[number,number,number];
  /** Where shadow may fall (alpha 0-255 per pixel, scene resolution); everywhere else is left untouched. */
  allow?:Uint8Array;
};

export type ShadowResult={
  image:RawImage;
  /** Pixels whose value was changed (for scene-preservation checks). */
  influence:Uint8Array;
};

function grow(q:Quad,amount:number):Quad{
  const cx=(q[0].x+q[1].x+q[2].x+q[3].x)/4,cy=(q[0].y+q[1].y+q[2].y+q[3].y)/4;
  return q.map((p)=>{const dx=p.x-cx,dy=p.y-cy,l=Math.hypot(dx,dy);return {x:p.x+dx/l*amount,y:p.y+dy/l*amount};}) as Quad;
}

/**
 * Express an image-space direction in the plane coordinates of a homography H (plane -> image),
 * using the local affine of H at `at` (plane coords). Returns a unit vector.
 */
export function dirToPlane(H:Mat3,at:Pt,dirImg:Pt):Pt{
  const c=applyHomography(H,at)!;
  const sx=applyHomography(H,{x:at.x+1,y:at.y})!;
  const sy=applyHomography(H,{x:at.x,y:at.y+1})!;
  const a=sx.x-c.x,b=sy.x-c.x,cc=sx.y-c.y,d=sy.y-c.y;
  const det=a*d-b*cc;
  const du=det!==0?(dirImg.x*d-b*dirImg.y)/det:dirImg.x;
  const dv=det!==0?(a*dirImg.y-cc*dirImg.x)/det:dirImg.y;
  const l=Math.hypot(du,dv)||1;
  return {x:du/l,y:dv/l};
}

/**
 * Perspective-correct shadows of a flat framed object hanging off a wall. The displacement is
 * applied in the OBJECT PLANE (via the object->image homography) so it foreshortens like the
 * wall does, then rendered as a blurred polygon darkening the scene in linear light.
 * Only pixels outside the object footprint are ever darkened (the object covers the rest).
 */
export function castWallShadows(scene:RawImage,quad:Quad,objectSize:{width:number;height:number},p:ShadowParams):ShadowResult{
  const {width:W,height:H}=scene;
  const Hm:Mat3|null=homographyFromPoints(rectQuad(objectSize.width,objectSize.height),quad);
  if(!Hm) throw new Error("Degenerate object quad for shadow.");
  // express the image-space direction in object-plane coordinates by mapping a short step through H^-1
  const c={x:objectSize.width/2,y:objectSize.height/2};
  const imgC=applyHomography(Hm,c)!;
  const imgStep=applyHomography(Hm,{x:c.x+1,y:c.y})!;
  const imgStepY=applyHomography(Hm,{x:c.x,y:c.y+1})!;
  // solve [ex ey] * (du,dv) = dir  (local affine of H at the centre)
  const a=imgStep.x-imgC.x,b=imgStepY.x-imgC.x,cc=imgStep.y-imgC.y,d=imgStepY.y-imgC.y;
  const det=a*d-b*cc;
  const du=det!==0?(p.dir.x*d-b*p.dir.y)/det:p.dir.x;
  const dv=det!==0?(a*p.dir.y-cc*p.dir.x)/det:p.dir.y;
  const dl=Math.hypot(du,dv)||1;
  const off={x:du/dl*p.depthPx,y:dv/dl*p.depthPx};
  const shiftedRect=rectQuad(objectSize.width,objectSize.height).map((q)=>({x:q.x+off.x,y:q.y+off.y}));
  const dropPoly=shiftedRect.map((q)=>applyHomography(Hm,q)!);

  const sizePx=Math.sqrt(Math.abs((quad[2].x-quad[0].x)*(quad[3].y-quad[1].y)-(quad[3].x-quad[1].x)*(quad[2].y-quad[0].y))/2);
  const dropSigma=p.softnessPx!==undefined?Math.max(0.6,p.softnessPx):Math.max(1.2,(p.softness ?? 0.7)*p.depthPx*(sizePx/objectSize.width));
  const contactSigma=Math.max(0.8,0.0025*sizePx);

  const toF=(u8:Uint8Array)=>{const f=new Float32Array(u8.length);for(let i=0;i<f.length;i++) f[i]=u8[i]/255;return f;};
  const drop=gaussianBlurPlane(toF(rasterizePolygons([dropPoly],W,H)),W,H,dropSigma);
  const contact=gaussianBlurPlane(toF(rasterizePolygons([grow(quad,Math.max(0.6,0.002*sizePx))],W,H)),W,H,contactSigma);
  const foot=rasterizePolygons([quad],W,H,4);

  const out=new Uint8ClampedArray(scene.data);
  const influence=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){
    if(foot[i]===255) continue;
    let dark=1-(1-p.dropStrength*drop[i])*(1-p.contactStrength*contact[i]);
    if(p.allow){const a=p.allow[i];if(a===0) continue;dark*=a/255;}
    if(dark<0.002) continue;
    const tr=p.tint?Math.max(0,1-dark*p.tint[0]):1-dark,tg=p.tint?Math.max(0,1-dark*p.tint[1]):1-dark,tb=p.tint?Math.max(0,1-dark*p.tint[2]):1-dark;
    out[i*4]=linearToSrgb8(SRGB_TO_LINEAR[out[i*4]]*tr);
    out[i*4+1]=linearToSrgb8(SRGB_TO_LINEAR[out[i*4+1]]*tg);
    out[i*4+2]=linearToSrgb8(SRGB_TO_LINEAR[out[i*4+2]]*tb);
    influence[i]=1;
  }
  return {image:{width:W,height:H,data:out},influence};
}

/**
 * Soft shading the mount/frame lip casts INTO an opening (artwork replacement): darkest at the
 * edge nearest the light, fading over `bandPx` (in the artwork's own pixels). Applied to the
 * artwork BEFORE it is warped, in linear light.
 */
export function innerShadowLayer(art:RawImage,dirInArt:Pt,bandPx:number,strength:number):RawImage{
  const out=new Uint8ClampedArray(art.data);
  const l=Math.hypot(dirInArt.x,dirInArt.y)||1;
  const dx=dirInArt.x/l,dy=dirInArt.y/l;
  for(let y=0;y<art.height;y++){
    for(let x=0;x<art.width;x++){
      // edges the light-facing lip shades are the ones the shadow direction points AWAY from:
      // shadow falls along dir, so it is cast from the left edge when dx>0 and from the top when dy>0
      const dLeft=x+0.5,dRight=art.width-x-0.5,dTop=y+0.5,dBottom=art.height-y-0.5;
      const kx=dx>0?Math.max(0,1-dLeft/bandPx)*dx:Math.max(0,1-dRight/bandPx)*(-dx);
      const ky=dy>0?Math.max(0,1-dTop/bandPx)*dy:Math.max(0,1-dBottom/bandPx)*(-dy);
      const shade=1-strength*Math.min(1,kx+ky);
      if(shade>=0.999) continue;
      const o=(y*art.width+x)*4;
      out[o]=linearToSrgb8(SRGB_TO_LINEAR[out[o]]*shade);
      out[o+1]=linearToSrgb8(SRGB_TO_LINEAR[out[o+1]]*shade);
      out[o+2]=linearToSrgb8(SRGB_TO_LINEAR[out[o+2]]*shade);
    }
  }
  return {width:art.width,height:art.height,data:out};
}

/**
 * Shadow tint for a key light of colour temperature `kelvin`: the darkening weight of each channel is the
 * key light's own colour (normalised to mean 1), because a shadow removes exactly that light. Warm light
 * (low K) therefore darkens red more than blue, leaving shadows cooler than the lit wall. 6500 K is neutral.
 */
export function shadowTintForKelvin(kelvin:number):[number,number,number]{
  const t=Math.max(1000,Math.min(40000,kelvin))/100;
  // Tanner Helland's blackbody approximation (sRGB), relative key-light colour
  let r=t<=66?255:329.698727446*Math.pow(t-60,-0.1332047592);
  let g=t<=66?99.4708025861*Math.log(t)-161.1195681661:288.1221695283*Math.pow(t-60,-0.0755148492);
  let b=t>=66?255:t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307;
  const c=(v:number)=>Math.max(1,Math.min(255,v));
  r=c(r);g=c(g);b=c(b);
  // relative to the 6500 K neutral so the default stays (1,1,1)
  const n=[r/255,g/255,b/255];
  const ref=[1,0.9994,0.9985];
  const w=[n[0]/ref[0],n[1]/ref[1],n[2]/ref[2]];
  const m=(w[0]+w[1]+w[2])/3;
  return [w[0]/m,w[1]/m,w[2]/m];
}
