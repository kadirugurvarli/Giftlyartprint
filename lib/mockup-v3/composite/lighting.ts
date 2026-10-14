import type {Pt,Quad,RawImage} from "../types";
import {rasterizePolygons} from "../vision/mask";
import {solveLinear} from "../geometry/homography";
import {linearToSrgb8,luma8,SRGB_TO_LINEAR} from "./color";

export type LightEstimate={
  /** Unit vector, image space: direction shadows fall (away from the light). */
  shadowDir:Pt;
  /** Measured relative darkening beside the object on the shadow side (0-1). */
  strength:number;
  source:"measured"|"default";
};

const DEFAULT_DIR:Pt={x:0.5,y:0.866}; // light from the upper-left, a gentle downward shadow

/** Mean luma of pixels in an (offset-from-quad) band along one side. */
function bandLuma(img:RawImage,q:Quad,side:number,d0:number,d1:number,exclude?:Uint8Array){
  const P0=q[side],P1=q[(side+1)%4];
  const ex=P1.x-P0.x,ey=P1.y-P0.y,len=Math.hypot(ex,ey);
  const nx=ey/len,ny=-ex/len;
  let s=0,n=0;
  const steps=Math.max(12,Math.round(len/3));
  for(let k=0;k<steps;k++){
    const t=0.15+0.7*(k+0.5)/steps;
    for(let d=d0;d<=d1;d+=1){
      const x=Math.round(P0.x+ex*t+nx*d),y=Math.round(P0.y+ey*t+ny*d);
      if(x<0||y<0||x>=img.width||y>=img.height) continue;
      const i=y*img.width+x;
      if(exclude && exclude[i]) continue;
      s+=luma8(img.data[i*4],img.data[i*4+1],img.data[i*4+2]);n++;
    }
  }
  return n>=8?s/n:null;
}

/**
 * Infer where shadows fall from the scene itself: bands just outside each side of an existing
 * object are compared with a band further out. Darker near bands are the shadow sides.
 */
export function estimateLight(scene:RawImage,quad:Quad,exclude?:Uint8Array):LightEstimate{
  const size=Math.sqrt(Math.abs(
    (quad[2].x-quad[0].x)*(quad[3].y-quad[1].y)-(quad[3].x-quad[1].x)*(quad[2].y-quad[0].y)
  )/2);
  const near0=Math.max(2,0.01*size),near1=Math.max(4,0.035*size);
  const far0=Math.max(near1+4,0.09*size),far1=far0+Math.max(6,0.05*size);
  let vx=0,vy=0,best=0;
  for(let s=0;s<4;s++){
    const P0=quad[s],P1=quad[(s+1)%4];
    const len=Math.hypot(P1.x-P0.x,P1.y-P0.y);
    const nx=(P1.y-P0.y)/len,ny=-(P1.x-P0.x)/len;
    const near=bandLuma(scene,quad,s,near0,near1,exclude);
    const far=bandLuma(scene,quad,s,far0,far1,exclude);
    if(near===null||far===null||far<=1) continue;
    const dark=Math.max(0,(far-near)/far);
    vx+=dark*nx;vy+=dark*ny;
    best=Math.max(best,dark);
  }
  const mag=Math.hypot(vx,vy);
  if(best<0.02 || mag<0.01) return {shadowDir:DEFAULT_DIR,strength:0.3,source:"default"};
  return {shadowDir:{x:vx/mag,y:vy/mag},strength:Math.min(0.6,best*1.4),source:"measured"};
}

export type GainEstimate={
  /** Multiplicative exposure factor at image position (x,y); normalised to mean 1 over the quad. */
  at:(x:number,y:number)=>number;
  maxDeviation:number;
  /** Luminance gradient across the quad, fractional change edge to edge. */
  gradientFraction:number;
};

/**
 * Smooth illumination gradient from the surroundings: fit a plane to the luma in a ring around
 * the quad, evaluate across the quad, normalise to mean 1 (exposure/colour untouched, only the
 * falloff is imposed), blend by `strength` and clamp to +/-`cap`. Neutral by construction:
 * the same gain is applied to R, G and B in linear light.
 */
export function estimateIlluminationGain(scene:RawImage,quad:Quad,opts:{strength?:number;cap?:number;exclude?:Uint8Array}={}):GainEstimate{
  const strength=opts.strength ?? 0.6,cap=opts.cap ?? 0.05;
  const size=Math.sqrt(Math.abs((quad[2].x-quad[0].x)*(quad[3].y-quad[1].y)-(quad[3].x-quad[1].x)*(quad[2].y-quad[0].y))/2);
  const inner=rasterizePolygons([quad.map((p)=>({x:p.x,y:p.y}))],scene.width,scene.height,2);
  const grow=Math.max(6,0.25*size);
  const cx=(quad[0].x+quad[1].x+quad[2].x+quad[3].x)/4,cy=(quad[0].y+quad[1].y+quad[2].y+quad[3].y)/4;
  const outer=rasterizePolygons([quad.map((p)=>{
    const dx=p.x-cx,dy=p.y-cy,l=Math.hypot(dx,dy);
    return {x:p.x+dx/l*grow,y:p.y+dy/l*grow};
  })],scene.width,scene.height,2);
  const skip=Math.max(4,0.04*size);
  const near=rasterizePolygons([quad.map((p)=>{
    const dx=p.x-cx,dy=p.y-cy,l=Math.hypot(dx,dy);
    return {x:p.x+dx/l*skip,y:p.y+dy/l*skip};
  })],scene.width,scene.height,2);
  // plane fit on ring pixels (outside the shadow-contaminated skip zone)
  const M=Array.from({length:3},()=>[0,0,0]);const V=[0,0,0];
  let count=0;
  const stride=2;
  for(let y=0;y<scene.height;y+=stride){
    for(let x=0;x<scene.width;x+=stride){
      const i=y*scene.width+x;
      if(!outer[i]||near[i]||inner[i]) continue;
      if(opts.exclude && opts.exclude[i]) continue;
      const L=luma8(scene.data[i*4],scene.data[i*4+1],scene.data[i*4+2]);
      const nx=(x-cx)/size,ny=(y-cy)/size;
      const b=[1,nx,ny];
      for(let r=0;r<3;r++){V[r]+=b[r]*L;for(let c=0;c<3;c++) M[r][c]+=b[r]*b[c];}
      count++;
    }
  }
  const flat:GainEstimate={at:()=>1,maxDeviation:0,gradientFraction:0};
  if(count<50) return flat;
  for(let r=0;r<3;r++) M[r][r]+=1e-6;
  const sol=solveLinear(M,V);
  if(!sol || sol[0]<=1) return flat;
  const plane=(x:number,y:number)=>sol[0]+sol[1]*(x-cx)/size+sol[2]*(y-cy)/size;
  // mean of the plane over the quad (for exposure-neutral normalisation)
  let sum=0,n=0;
  for(let y=Math.floor(Math.min(...quad.map((p)=>p.y)));y<=Math.ceil(Math.max(...quad.map((p)=>p.y)));y+=3){
    for(let x=Math.floor(Math.min(...quad.map((p)=>p.x)));x<=Math.ceil(Math.max(...quad.map((p)=>p.x)));x+=3){
      if(x<0||y<0||x>=scene.width||y>=scene.height) continue;
      if(!inner[y*scene.width+x]) continue;
      sum+=plane(x,y);n++;
    }
  }
  const mean=n?sum/n:sol[0];
  const raw=(x:number,y:number)=>plane(x,y)/mean;
  const at=(x:number,y:number)=>Math.max(1-cap,Math.min(1+cap,1+strength*(raw(x,y)-1)));
  const corners=quad.map((p)=>at(p.x,p.y));
  const maxDeviation=Math.max(...corners.map((v)=>Math.abs(v-1)));
  return {at,maxDeviation,gradientFraction:Math.max(...corners)-Math.min(...corners)};
}

/** Multiply a layer's RGB by a spatial gain in linear light (alpha untouched). */
export function applyGain(layer:RawImage,gain:GainEstimate):RawImage{
  if(gain.maxDeviation===0) return layer;
  const out=new Uint8ClampedArray(layer.data);
  for(let y=0;y<layer.height;y++){
    for(let x=0;x<layer.width;x++){
      const o=(y*layer.width+x)*4;
      if(out[o+3]===0) continue;
      const g=gain.at(x+0.5,y+0.5);
      out[o]=linearToSrgb8(SRGB_TO_LINEAR[out[o]]*g);
      out[o+1]=linearToSrgb8(SRGB_TO_LINEAR[out[o+1]]*g);
      out[o+2]=linearToSrgb8(SRGB_TO_LINEAR[out[o+2]]*g);
    }
  }
  return {width:layer.width,height:layer.height,data:out};
}

/**
 * Light direction when the scene has nothing to cast a measurable shadow (an empty wall): the
 * shadow falls away from the brighter side of the wall, with a gentle downward component.
 */
export function estimateLightFromGradient(scene:RawImage,quad:Quad,exclude?:Uint8Array):LightEstimate{
  const g=estimateIlluminationGain(scene,quad,{strength:1,cap:0.5,exclude});
  const mid=(a:Pt,b:Pt):Pt=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const gx=g.at(mid(quad[1],quad[2]).x,mid(quad[1],quad[2]).y)-g.at(mid(quad[0],quad[3]).x,mid(quad[0],quad[3]).y);
  if(Math.abs(gx)<0.01) return {shadowDir:DEFAULT_DIR,strength:0.3,source:"default"};
  const dx=Math.max(-0.8,Math.min(0.8,-gx*9));
  const l=Math.hypot(dx,0.85);
  return {shadowDir:{x:dx/l,y:0.85/l},strength:0.3,source:"measured"};
}
