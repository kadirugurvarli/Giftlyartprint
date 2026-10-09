import type {Pt,Quad,RawImage} from "../types";
import {downscaleToMax,toGray,gaussianBlurPlane} from "../vision/gray";
import {rasterizePolygons} from "../vision/mask";
import {estimateEdgeBlur,estimateGrain} from "../composite/photo";
import {analyseWall} from "../place/wall";
import {offsetQuad} from "../geometry/quad";
import {luma8} from "../composite/color";
import type {MockupResult} from "../pipeline";

/**
 * Automatic checks for VISIBLE REALISM defects. These are measurable proxies, not a substitute for
 * looking at the picture: every finding carries the measured value and a provisional limit, and the
 * limits are UNCALIBRATED until real photographs have been reviewed by a person.
 */
export type RealismFinding={
  code:
    | "SEAM_TOO_SHARP" | "GRAIN_MISMATCH" | "SHADOW_ABSENT" | "SHADOW_DIRECTION_MISMATCH"
    | "OLD_PICTURE_LEAK" | "PERSPECTIVE_DEVIATION" | "PRODUCT_SMALL" | "MEASUREMENT_UNAVAILABLE";
  severity:"info"|"warn";
  value:number;
  limit?:number;
  message:string;
};

export type RealismAudit={
  findings:RealismFinding[];
  measurements:Record<string,number|string>;
  calibrated:false;
};

const mean=(v:number[])=>v.length?v.reduce((s,x)=>s+x,0)/v.length:NaN;

function sideBand(img:RawImage,q:Quad,side:number,d0:number,d1:number,exclude?:Uint8Array){
  const P0=q[side],P1=q[(side+1)%4];
  const ex=P1.x-P0.x,ey=P1.y-P0.y,len=Math.hypot(ex,ey);
  const nx=ey/len,ny=-ex/len;
  const vals:number[]=[];
  const steps=Math.max(16,Math.round(len/3));
  for(let k=0;k<steps;k++){
    const t=0.15+0.7*(k+0.5)/steps;
    for(let d=d0;d<=d1;d++){
      const x=Math.round(P0.x+ex*t+nx*d),y=Math.round(P0.y+ey*t+ny*d);
      if(x<0||y<0||x>=img.width||y>=img.height) continue;
      const i=y*img.width+x;
      if(exclude&&exclude[i]) continue;
      vals.push(luma8(img.data[i*4],img.data[i*4+1],img.data[i*4+2]));
    }
  }
  return vals.length>=12?mean(vals):NaN;
}

/** `reference` must be the scene-scale reference (downscaled exactly like the pipeline did). */
export function auditRealism(o:{result:MockupResult;reference:RawImage;maxReferenceSide?:number}):RealismAudit{
  const {result}=o;
  const findings:RealismFinding[]=[];
  const meas:Record<string,number|string>={};
  const final=result.image,target=result.targetQuad;
  if(!final||!target) return {findings:[{code:"MEASUREMENT_UNAVAILABLE",severity:"info",value:0,message:"No mockup was produced, so no realism audit was possible."}],measurements:meas,calibrated:false};
  const ref=downscaleToMax(o.reference,o.maxReferenceSide ?? 2400).image;
  const W=final.width,H=final.height;
  const size=Math.sqrt(Math.abs((target[2].x-target[0].x)*(target[3].y-target[1].y)-(target[3].x-target[1].x)*(target[2].y-target[0].y))/2);
  const areaFrac=(size*size)/(W*H);
  meas.productAreaFraction=areaFrac;
  if(areaFrac<0.02) findings.push({code:"PRODUCT_SMALL",severity:"info",value:areaFrac,limit:0.02,message:"The product fills under 2% of the picture; fine detail will be hard to judge."});

  // 1. seam sharpness: product edge vs the room's own edges (a pasted-in look has razor-sharp edges in a soft photo)
  const refEdge:[Pt,Pt]|null=result.referenceFrameQuad?[result.referenceFrameQuad[0],result.referenceFrameQuad[1]]:null;
  const placedEdge:[Pt,Pt]=[
    {x:target[0].x+(target[1].x-target[0].x)*0.15,y:target[0].y+(target[1].y-target[0].y)*0.15},
    {x:target[0].x+(target[1].x-target[0].x)*0.85,y:target[0].y+(target[1].y-target[0].y)*0.85}
  ];
  let roomSigma:number|null=refEdge?estimateEdgeBlur(ref,refEdge[0],refEdge[1]):null;
  if(roomSigma===null){
    const wall=analyseWall(ref);
    if(wall.top){
      const y=(x:number)=>wall.top!.m*x+wall.top!.c;
      roomSigma=estimateEdgeBlur(ref,{x:W*0.2,y:y(W*0.2)},{x:W*0.8,y:y(W*0.8)});
    }
  }
  const placedSigma=estimateEdgeBlur(final,placedEdge[0],placedEdge[1]);
  if(roomSigma!==null&&placedSigma!==null){
    meas.roomEdgeSigmaPx=roomSigma;meas.productEdgeSigmaPx=placedSigma;
    const ratio=placedSigma/roomSigma;
    meas.edgeSharpnessRatio=ratio;
    if(roomSigma>=0.8&&ratio<0.5) findings.push({code:"SEAM_TOO_SHARP",severity:"warn",value:ratio,limit:0.5,message:`The product's edges (blur σ ${placedSigma.toFixed(2)}px) are much sharper than the room's own edges (σ ${roomSigma.toFixed(2)}px): it may look pasted in.`});
  }else meas.edgeSharpness="not measurable (no straight edge found in the reference)";

  // 2. grain: product's flat areas vs the room's flat areas
  const inner=rasterizePolygons([offsetQuad(target,-Math.max(3,0.03*size)).map((p)=>({x:p.x,y:p.y}))],W,H,1);
  const only=new Uint8Array(W*H);for(let i=0;i<only.length;i++) only[i]=inner[i]>250?1:0;
  const prod=estimateGrain(final,undefined,only);
  const room=estimateGrain(ref);
  meas.roomGrainSigma=room.sigma;
  if(prod.samples>=400&&room.samples>=400){
    meas.productGrainSigma=prod.sigma;
    const ratio=(prod.sigma+0.3)/(room.sigma+0.3);
    meas.grainRatio=ratio;
    if(room.sigma>=1.0&&(ratio<0.5||ratio>2)) findings.push({code:"GRAIN_MISMATCH",severity:"warn",value:ratio,limit:ratio<1?0.5:2,message:`Fine grain in the product (σ ${prod.sigma.toFixed(2)}) differs from the room photo (σ ${room.sigma.toFixed(2)}).`});
  }else meas.grain="not measurable (the product has no flat areas to sample)";

  // 3. shadow (wall workflow): darkening just outside the placed piece, and which way it falls
  if(result.mode==="framed-on-wall"){
    const d0=Math.max(2,0.01*size),d1=Math.max(5,0.04*size),f0=Math.max(d1+4,0.1*size),f1=f0+Math.max(6,0.05*size);
    let vx=0,vy=0,best=0;
    for(let s=0;s<4;s++){
      const a=sideBand(final,target,s,d0,d1),r=sideBand(ref,target,s,d0,d1),fr=sideBand(ref,target,s,f0,f1);
      if([a,r,fr].some(Number.isNaN)) continue;
      const dark=Math.max(0,(r-a)/Math.max(1,fr)); // darkening added by the engine relative to the room's brightness
      const P0=target[s],P1=target[(s+1)%4],len=Math.hypot(P1.x-P0.x,P1.y-P0.y);
      vx+=dark*(P1.y-P0.y)/len;vy+=dark*-(P1.x-P0.x)/len;best=Math.max(best,dark);
    }
    meas.shadowStrengthMax=best;
    if(best<0.025) findings.push({code:"SHADOW_ABSENT",severity:"warn",value:best,limit:0.025,message:"No measurable shadow was cast on the wall beside the piece; it may look like it floats."});
    else{
      const want=Math.atan2(Number(result.adjustments.shadowDirY),Number(result.adjustments.shadowDirX));
      const got=Math.atan2(vy,vx);
      let dev=Math.abs(want-got);if(dev>Math.PI) dev=2*Math.PI-dev;
      meas.shadowDirDeviationDeg=dev*180/Math.PI;
      if(Number.isFinite(want)&&dev>Math.PI/4) findings.push({code:"SHADOW_DIRECTION_MISMATCH",severity:"info",value:dev*180/Math.PI,limit:45,message:"The measured shadow direction differs from the intended light direction by more than 45° (often a near-symmetric shadow)."});
    }
  }

  // 4. old picture leaking at the opening edge (bare-print workflow)
  if(result.mode==="artwork-in-frame"){
    const ring=rasterizePolygons([target.map((p)=>({x:p.x,y:p.y}))],W,H,1);
    const inner2=rasterizePolygons([offsetQuad(target,-3).map((p)=>({x:p.x,y:p.y}))],W,H,1);
    let n=0,same=0;
    for(let i=0;i<ring.length;i++){
      if(ring[i]>250&&inner2[i]<5){
        n++;
        if(Math.abs(final.data[i*4]-ref.data[i*4])<3&&Math.abs(final.data[i*4+1]-ref.data[i*4+1])<3&&Math.abs(final.data[i*4+2]-ref.data[i*4+2])<3) same++;
      }
    }
    if(n>40){
      meas.openingEdgeUnchangedFraction=same/n;
      if(same/n>0.08) findings.push({code:"OLD_PICTURE_LEAK",severity:"warn",value:same/n,limit:0.08,message:`${(same/n*100).toFixed(0)}% of the strip just inside the opening is unchanged from the reference: part of the old picture may still show.`});
    }
  }

  // 5. perspective: placed top edge vs the room's converging lines (free-wall placement only)
  if(result.mode==="framed-on-wall"&&result.adjustments.placement==="free-wall"){
    const wall=analyseWall(ref);
    if(wall.top&&wall.bottom&&wall.vanishingX!==null&&wall.vanishingY!==null){
      const sx=wall.vanishingX,sy=wall.vanishingY;
      const predicted=Math.atan2(sy-target[0].y,sx-target[0].x);
      const measured=Math.atan2(target[1].y-target[0].y,target[1].x-target[0].x);
      let dev=Math.abs(predicted-measured);if(dev>Math.PI) dev=2*Math.PI-dev;
      if(dev>Math.PI/2) dev=Math.PI-dev;
      const deg=dev*180/Math.PI;
      meas.perspectiveDeviationDeg=deg;
      if(deg>1.5) findings.push({code:"PERSPECTIVE_DEVIATION",severity:"warn",value:deg,limit:1.5,message:`The piece's top edge deviates ${deg.toFixed(1)}° from the room's converging lines.`});
    }
  }
  // informational exposure relation (no judgement without a reviewer)
  const g=toGray(final);void g;void gaussianBlurPlane;
  return {findings,measurements:meas,calibrated:false};
}
