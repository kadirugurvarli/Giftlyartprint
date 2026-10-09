import type {Mat3,Quad,RawImage} from "../types";
import {homographyFromPoints,applyHomography} from "../geometry/homography";
import {edgeLengths,estimateRectAspect,rectQuad} from "../geometry/quad";
import {rectifyQuad} from "../geometry/warp";
import {gaussianBlurPlane} from "../vision/gray";
import {erodeMask} from "../qa/metrics";
import {defect,type Defect} from "./defects";

export type SideName="top"|"right"|"bottom"|"left";
export type Layer={
  /** Distance from the outer silhouette, in rectified px (pixel-edge coordinates). */
  depthPx:number;
  /** Gradient strength sustained along >=75% of the side. */
  strength:number;
};

export type Insets={top:number;right:number;bottom:number;left:number};

export type FrameAnalysis={
  rect:{width:number;height:number};
  /** Rectified (upright) frame space to source image. */
  toImage:Mat3;
  layers:Record<SideName,Layer[]>;
  /** Deepest coherent layer per side = the opening; null if any side has none. */
  insets:Insets|null;
  /** Sides whose opening edge was hidden/undetected and inferred from the opposite side. */
  inferredSides:SideName[];
  apertureQuad:Quad|null;
  apertureAreaFraction:number;
  /** 0-1: opposite sides agree on layer depths. */
  consistency:number;
  /** 0-1 evidence that a moulding + mount/opening structure is present. */
  framedScore:number;
  confidence:number;
  defects:Defect[];
};

const SIDES:SideName[]=["top","right","bottom","left"];

function percentile(sorted:number[],p:number){
  if(!sorted.length) return 0;
  return sorted[Math.min(sorted.length-1,Math.max(0,Math.floor(sorted.length*p)))];
}

/** Gradient strength (25th percentile along the side) per depth, plus peak extraction. */
type ColourPlanes={width:number;height:number;r:Float32Array;g:Float32Array;b:Float32Array};

function colourPlanes(img:RawImage,sigma:number):ColourPlanes{
  const n=img.width*img.height;
  const ch=[0,1,2].map((c)=>{const p=new Float32Array(n);for(let i=0;i<n;i++) p[i]=img.data[i*4+c];return gaussianBlurPlane(p,img.width,img.height,sigma);});
  return {width:img.width,height:img.height,r:ch[0],g:ch[1],b:ch[2]};
}

/** Gradient strength from colour difference (not just luma), so isoluminant but differently coloured edges are seen. */
function sideLayers(g:ColourPlanes,side:SideName,maxDepth:number,valid?:Uint8Array):Layer[]{
  const W=g.width,H=g.height;
  const horizontal=side==="top"||side==="bottom"; // sampling runs along x for top/bottom
  const len=horizontal?W:H;
  const lo=Math.floor(len*0.12),hi=Math.ceil(len*0.88);
  const idx=(d:number,s:number)=>{
    switch(side){
      case "top":return Math.min(H-1,d)*W+s;
      case "bottom":return Math.max(0,H-1-d)*W+s;
      case "left":return s*W+Math.min(W-1,d);
      default:return s*W+Math.max(0,W-1-d);
    }
  };
  const colourStep=(d:number,s:number)=>{
    const a=idx(Math.max(0,d-1),s),b=idx(d+1,s);
    const dr=g.r[b]-g.r[a],dg=g.g[b]-g.g[a],db=g.b[b]-g.b[a];
    return Math.sqrt((dr*dr+dg*dg+db*db)/3)/2;
  };
  const ok=(d:number,s:number)=>{
    if(!valid) return true;
    switch(side){
      case "top":return valid[Math.min(H-1,d)*W+s]===1;
      case "bottom":return valid[Math.max(0,H-1-d)*W+s]===1;
      case "left":return valid[s*W+Math.min(W-1,d)]===1;
      default:return valid[s*W+Math.max(0,W-1-d)]===1;
    }
  };
  const strength:number[]=[];
  let minValid=1;
  for(let d=0;d<=maxDepth;d++){
    const vals:number[]=[];
    for(let s=lo;s<hi;s++){
      if(valid && !(ok(Math.max(0,d-1),s)&&ok(d+1,s))) continue;
      vals.push(colourStep(d,s));
    }
    minValid=Math.min(minValid,vals.length/Math.max(1,hi-lo));
    vals.sort((x,y)=>x-y);
    strength.push(vals.length>=0.4*(hi-lo)?percentile(vals,0.25):0);
  }
  void minValid;
  const peaks:Layer[]=[];
  const minAbs=3.0;
  const maxS=Math.max(...strength.slice(3));
  for(let d=3;d<strength.length-1;d++){
    const s=strength[d];
    if(s<minAbs || s<0.06*maxS) continue;
    if(s>=strength[d-1] && s>=strength[d+1]){
      let off=0;
      const a=strength[d-1],b=s,c=strength[d+1];
      const den=a-2*b+c;
      if(den<-1e-9) off=0.5*(a-c)/den;
      peaks.push({depthPx:d+off+0.5,strength:s});
    }
  }
  // merge plateau duplicates / close neighbours (keep the stronger)
  const merged:Layer[]=[];
  for(const p of peaks){
    const last=merged[merged.length-1];
    if(last && p.depthPx-last.depthPx<3){
      if(p.strength>last.strength) merged[merged.length-1]=p;
    }else merged.push(p);
  }
  // Edges a few pixels apart (a mount's bevel core, or the tail of its inner shadow) are one
  // visual boundary. Take the OUTERMOST strong edge of the cluster: covering a sliver of mount
  // bevel is nearly invisible, whereas leaving a strip of the old picture visible is not.
  const win=Math.max(4,0.015*Math.min(g.width,g.height));
  const out:Layer[]=[];
  let group:Layer[]=[];
  const flush=()=>{
    if(!group.length) return;
    const maxS=Math.max(...group.map((p)=>p.strength));
    const first=group.find((p)=>p.strength>=0.1*maxS)!;
    out.push({depthPx:first.depthPx,strength:maxS});
    group=[];
  };
  for(const p of merged){
    if(group.length && p.depthPx-group[0].depthPx>=win) flush();
    group.push(p);
  }
  flush();
  return out;
}

/**
 * The opening is the deepest edge that most sides agree on. A coherent edge on one side only
 * (a horizon or band inside the artwork) is not structure of the frame. A bottom-weighted mount
 * is allowed: the bottom may sit deeper than the consensus (up to 1.45x) but not shallower.
 */
export function chooseOpening(layers:Record<SideName,Layer[]>):Record<SideName,number|null>{
  const all=SIDES.flatMap((s)=>layers[s].map((l)=>({side:s,depth:l.depthPx,strength:l.strength})));
  const clusters:{depth:number;sides:Set<SideName>;strength:number}[]=[];
  for(const l of all.sort((a,b)=>a.depth-b.depth)){
    const c=clusters.find((k)=>Math.abs(k.depth-l.depth)<=Math.max(4,0.07*k.depth));
    if(c){c.sides.add(l.side);c.strength+=l.strength;c.depth=(c.depth*(c.sides.size-1)+l.depth)/c.sides.size;}
    else clusters.push({depth:l.depth,sides:new Set([l.side]),strength:l.strength});
  }
  const need=Math.min(3,Math.max(...clusters.map((c)=>c.sides.size),0));
  const supported=clusters.filter((c)=>c.sides.size>=Math.max(2,need));
  const out={top:null,right:null,bottom:null,left:null} as Record<SideName,number|null>;
  const own=(s:SideName)=>layers[s].length?layers[s][layers[s].length-1].depthPx:null;
  if(!supported.length){for(const s of SIDES) out[s]=own(s);return out;}
  const D=supported[supported.length-1].depth; // deepest well-supported depth
  for(const s of SIDES){
    const lo=0.8*D,hi=(s==="bottom"?1.45:1.12)*D;
    const inWin=layers[s].filter((l)=>l.depthPx>=lo && l.depthPx<=hi);
    if(inWin.length){
      const maxS=Math.max(...inWin.map((l)=>l.strength));
      out[s]=inWin.find((l)=>l.strength>=0.25*maxS)!.depthPx;   // outermost strong edge in the window
    }else out[s]=own(s);
  }
  return out;
}

export type FrameOptions={focalPx?:number;maxDepthFraction?:number;maxWidth?:number;
  /** Image-space occlusion alpha (255 = unknown); occluded samples are skipped when scoring edges. */
  ignore?:{width:number;height:number;alpha:Uint8Array}};

export function analyseFrameLayers(img:RawImage,outerQuad:Quad,opts:FrameOptions={}):FrameAnalysis{
  const e=edgeLengths(outerQuad);
  const est=estimateRectAspect(outerQuad,img.width,img.height,{focalPx:opts.focalPx});
  const aspect=est.aspect ?? ((e[0]+e[2])/2)/((e[1]+e[3])/2);
  const width=Math.max(300,Math.min(opts.maxWidth ?? 1000,Math.round(Math.max(e[0],e[2])*1.5)));
  const height=Math.max(160,Math.round(width/aspect));
  const rect=rectifyQuad(img,outerQuad,width,height);
  const g=colourPlanes(rect,0.8);
  const maxDepth=Math.floor((opts.maxDepthFraction ?? 0.3)*Math.min(width,height));

  let valid:Uint8Array|undefined;
  if(opts.ignore){
    const m:RawImage={width:opts.ignore.width,height:opts.ignore.height,data:new Uint8ClampedArray(opts.ignore.width*opts.ignore.height*4)};
    for(let i=0;i<opts.ignore.alpha.length;i++){const v=opts.ignore.alpha[i];m.data[i*4]=v;m.data[i*4+1]=v;m.data[i*4+2]=v;m.data[i*4+3]=255;}
    const r=rectifyQuad(m,outerQuad,width,height);
    valid=new Uint8Array(width*height);
    for(let i=0;i<valid.length;i++) valid[i]=r.data[i*4]<48?1:0;
    // keep a margin around the unknown area: the occluder's edge is not frame structure
    valid=erodeMask(valid,width,height,3);
  }
  const layers={} as Record<SideName,Layer[]>;
  for(const s of SIDES) layers[s]=sideLayers(g,s,maxDepth,valid);

  const toImage=homographyFromPoints(rectQuad(width,height),outerQuad)!;
  const defects:Defect[]=[];

  const chosen=chooseOpening(layers);
  const inferred:SideName[]=[];
  const infer=(s:SideName,opp:SideName)=>{if(chosen[s]===null && chosen[opp]!==null){chosen[s]=chosen[opp];inferred.push(s);}};
  infer("top","bottom");infer("bottom","top");infer("left","right");infer("right","left");
  const dT=chosen.top,dR=chosen.right,dB=chosen.bottom,dL=chosen.left;
  let insets:Insets|null=null,apertureQuad:Quad|null=null,areaFrac=0,consistency=0;
  if(dT!==null&&dR!==null&&dB!==null&&dL!==null){
    insets={top:dT,right:dR,bottom:dB,left:dL};
    const corners=[{x:dL,y:dT},{x:width-dR,y:dT},{x:width-dR,y:height-dB},{x:dL,y:height-dB}]
      .map((p)=>applyHomography(toImage,p)!);
    apertureQuad=corners as Quad;
    areaFrac=Math.max(0,(width-dL-dR)*(height-dT-dB))/(width*height);
    // left/right should match closely; top/bottom may differ (bottom-weighted mounts) but not wildly
    const lr=Math.min(dL,dR)/Math.max(dL,dR);
    const tb=Math.min(dT,dB)/Math.max(dT,dB);
    consistency=Math.min(1,Math.max(0,Math.min((lr-0.5)/0.4,(tb-0.35)/0.45)));
    if(inferred.length) defects.push(defect("APERTURE_UNCERTAIN","warn","The opening edge on "+inferred.join(" and ")+" could not be seen (hidden or too faint) and was inferred from the opposite side.",{inferred:inferred.join(",")}));
    if(areaFrac<0.2) defects.push(defect("APERTURE_UNCERTAIN","warn","Detected opening is under 20% of the frame area.",{areaFraction:areaFrac}));
  }else{
    defects.push(defect("APERTURE_UNCERTAIN","warn","No coherent inner edge was found on every side; choose the opening manually.",
      {top:dT!==null,right:dR!==null,bottom:dB!==null,left:dL!==null}));
  }

  const multi=SIDES.filter((s)=>layers[s].length>=2).length/4;
  const any=SIDES.filter((s)=>layers[s].length>=1).length/4;
  const framedScore=Math.min(1,0.65*multi+0.35*any);
  const confidence=insets?Math.min(1,consistency*0.7+0.3*Math.min(1,framedScore)):0;
  if(insets && consistency<0.5) defects.push(defect("APERTURE_UNCERTAIN","warn","Inner edges disagree between opposite sides (consistency "+consistency.toFixed(2)+").",{consistency}));
  return {rect:{width,height},toImage,layers,insets,inferredSides:inferred,apertureQuad,apertureAreaFraction:areaFrac,consistency,framedScore,confidence,defects};
}

/** Opening quad when the user (or a UI) picks a different layer than the deepest. */
export function apertureFromLayers(a:FrameAnalysis,pick:{top:number;right:number;bottom:number;left:number}):Quad|null{
  const get=(s:SideName,i:number)=>a.layers[s][Math.min(i,a.layers[s].length-1)]?.depthPx;
  const t=get("top",pick.top),r=get("right",pick.right),b=get("bottom",pick.bottom),l=get("left",pick.left);
  if([t,r,b,l].some((v)=>v===undefined)) return null;
  const {width,height}=a.rect;
  const c=[{x:l,y:t},{x:width-r,y:t},{x:width-r,y:height-b},{x:l,y:height-b}].map((p)=>applyHomography(a.toImage,p as {x:number;y:number})!);
  return c as Quad;
}

export type SourceKind="framed"|"artwork";
export function suggestSourceKind(a:FrameAnalysis):{kind:SourceKind;confidence:number;defects:Defect[]}{
  // A moulding plus mount/opening shows at least two coherent layers on most sides.
  const multi=SIDES.filter((s)=>a.layers[s].length>=2).length;
  const kind:SourceKind=multi>=3?"framed":"artwork";
  const confidence=multi>=3?Math.min(1,0.55+0.15*multi*Math.min(1,a.consistency+0.3)):multi===0?0.7:0.4;
  const defects:Defect[]=[];
  if(confidence<0.6) defects.push(defect("SOURCE_KIND_UNCERTAIN","info","Could not tell reliably whether this photo shows a framed piece or a bare print; please confirm.",{multiLayerSides:multi}));
  return {kind,confidence,defects};
}
