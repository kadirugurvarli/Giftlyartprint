import type {Pt,Quad,RawImage} from "../types";
import {isConvex,orderQuad,quadArea,validateQuad} from "../geometry/quad";
import {blurGray,downscaleToMax,sampleGray,toGray,type GrayImage,type Mask} from "../vision/gray";
import {closeMask,connectedComponents,dilate,fillHoles,maskArea,openMask,rasterizePolygons} from "../vision/mask";
import {convexHull,hullToQuad,lineIntersection,lineThrough,polygonArea,quadFromBoundaryRansac,robustLineFit,type Line} from "../vision/lines";
import {foregroundMask,type ForegroundOptions,type ForegroundResult} from "./foreground";
import {defect,type Defect} from "./defects";

export type QuadStats={
  areaFraction:number;
  rectangularity:number;
  solidity:number;
  edgeSupport:[number,number,number,number];
  meanEdgeSupport:number;
  fitRmsPx:number;
  touchesBorder:boolean;
};

export type QuadCandidate={
  quad:Quad;
  confidence:number;
  score:number;
  stats:QuadStats;
  defects:Defect[];
};

export type DetectQuadOptions={
  minAreaFraction?:number;
  maxAreaFraction?:number;
  maxCandidates?:number;
  foreground?:ForegroundOptions;
};

export function bboxIoU(a:Quad,b:Quad){
  const box=(q:Quad)=>({x0:Math.min(...q.map((p)=>p.x)),y0:Math.min(...q.map((p)=>p.y)),x1:Math.max(...q.map((p)=>p.x)),y1:Math.max(...q.map((p)=>p.y))});
  const A=box(a),B=box(b);
  const iw=Math.max(0,Math.min(A.x1,B.x1)-Math.max(A.x0,B.x0)),ih=Math.max(0,Math.min(A.y1,B.y1)-Math.max(A.y0,B.y0));
  const inter=iw*ih,uni=(A.x1-A.x0)*(A.y1-A.y0)+(B.x1-B.x0)*(B.y1-B.y0)-inter;
  return uni>0?inter/uni:0;
}

const clamp01=(v:number)=>Math.max(0,Math.min(1,v));

type Seg={p:Pt;q:Pt};
function distToSegment(pt:Pt,s:Seg){
  const dx=s.q.x-s.p.x,dy=s.q.y-s.p.y;
  const l2=dx*dx+dy*dy;
  const t=l2===0?0:((pt.x-s.p.x)*dx+(pt.y-s.p.y)*dy)/l2;
  const tc=Math.max(0,Math.min(1,t));
  return {d:Math.hypot(pt.x-(s.p.x+tc*dx),pt.y-(s.p.y+tc*dy)),t};
}

/** Exposed pixel faces of a mask component: exact boundary samples in pixel-edge coordinates. */
function exposedFaces(labels:Int32Array,label:number,w:number,h:number,filled:Uint8Array,ignored?:Uint8Array){
  const pts:Pt[]=[];
  let skipped=0;
  const on=(x:number,y:number)=>x>=0&&y>=0&&x<w&&y<h&&filled[y*w+x]===1;
  // a boundary that only exists because pixels are unknown (occluded) is not an object edge
  const unk=(x:number,y:number)=>!!ignored && x>=0&&y>=0&&x<w&&y<h&&ignored[y*w+x]===1;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      if(!on(x,y)) continue;
      if(!on(x-1,y)){if(unk(x-1,y)) skipped++;else pts.push({x,y:y+0.5});}
      if(!on(x+1,y)){if(unk(x+1,y)) skipped++;else pts.push({x:x+1,y:y+0.5});}
      if(!on(x,y-1)){if(unk(x,y-1)) skipped++;else pts.push({x:x+0.5,y});}
      if(!on(x,y+1)){if(unk(x,y+1)) skipped++;else pts.push({x:x+0.5,y:y+1});}
    }
  }
  void labels;void label;
  return {pts,skipped};
}

function sideLines(quad:Quad,faces:Pt[],scaleRef:number):{lines:(Line|null)[];counts:number[]}{
  const segs:Seg[]=[0,1,2,3].map((i)=>({p:quad[i],q:quad[(i+1)%4]}));
  const buckets:Pt[][]=[[],[],[],[]];
  const maxD=0.05*scaleRef+2;
  for(const f of faces){
    let best=-1,bd=Infinity,bt=0;
    segs.forEach((s,i)=>{const r=distToSegment(f,s);if(r.d<bd){bd=r.d;best=i;bt=r.t;}});
    if(bd<=maxD && bt>0.08 && bt<0.92) buckets[best].push(f);
  }
  const lines=buckets.map((b,i)=>{
    if(b.length<8) return lineThrough(segs[i].p,segs[i].q);
    const fit=robustLineFit(b,{keep:0.85,maxResidual:1.2});
    return fit?fit.line:lineThrough(segs[i].p,segs[i].q);
  });
  return {lines,counts:buckets.map((b)=>b.length)};
}

function quadFromSideLines(lines:(Line|null)[]):Quad|null{
  if(lines.some((l)=>!l)) return null;
  const [t,r,b,l]=lines as Line[];
  const tl=lineIntersection(t,l),tr=lineIntersection(t,r),br=lineIntersection(b,r),bl=lineIntersection(b,l);
  if(!tl||!tr||!br||!bl) return null;
  return [tl,tr,br,bl];
}

export type RefineResult={quad:Quad;support:[number,number,number,number];rmsPx:number};

/**
 * Snap each side of `quad` to the strongest gradient along its outward normal (sub-pixel),
 * fit robust lines and re-intersect. `gray` must already be smoothed (sigma ~1).
 */
export function refineQuadToEdges(gray:GrayImage,quad:Quad,opts:{radiusPx:number;samples?:number;passes?:number;minGradient?:number;
  /** True where the pixel is unknown (occluded); such samples are skipped and do not count against support. */
  ignoreAt?:(x:number,y:number)=>boolean}):RefineResult{
  const samples=opts.samples ?? 64;
  const passes=opts.passes ?? 2;
  const minGrad=opts.minGradient ?? 4;
  let q=quad;
  let support:[number,number,number,number]=[0,0,0,0];
  let rms=0;
  for(let pass=0;pass<passes;pass++){
    const radius=pass===0?opts.radiusPx:Math.max(1.5,opts.radiusPx/2.5);
    const lines:Line[]=[];
    const sup:number[]=[];
    let sq=0,cnt=0;
    for(let i=0;i<4;i++){
      const P0=q[i],P1=q[(i+1)%4];
      const ex=P1.x-P0.x,ey=P1.y-P0.y,len=Math.hypot(ex,ey);
      const nx=ey/len,ny=-ex/len; // outward for TL,TR,BR,BL
      // Try the nominal radius first; a side that finds no coherent edge (e.g. the initial quad
      // swallowed a drop shadow) retries with a wider search before giving up.
      let fit:ReturnType<typeof robustLineFit>=null;
      let accepted=0;
      const mults=pass===0?[1,2,3.2]:[1];
      for(const mult of mults){
        const R=radius*mult;
        const pts:Pt[]=[];
        let valid=0;
        for(let k=0;k<samples;k++){
          const t=0.1+0.8*(k+0.5)/samples;
          const bx=P0.x+ex*t,by=P0.y+ey*t;
          if(opts.ignoreAt && (opts.ignoreAt(bx,by)||opts.ignoreAt(bx+nx*R,by+ny*R)||opts.ignoreAt(bx-nx*R,by-ny*R))) continue;
          valid++;
          let best=-Infinity,bs=0;
          const gs:number[]=[];
          const steps=Math.round(R*2/0.5);
          for(let j=0;j<=steps;j++){
            const s=-R+j*0.5;
            const g=Math.abs(sampleGray(gray,bx+nx*(s+0.5),by+ny*(s+0.5))-sampleGray(gray,bx+nx*(s-0.5),by+ny*(s-0.5)));
            gs.push(g);
            if(g>best){best=g;bs=j;}
          }
          if(best<minGrad) continue;
          let off=-R+bs*0.5;
          if(bs>0 && bs<gs.length-1){
            const a=gs[bs-1],b=gs[bs],c=gs[bs+1];
            const den=a-2*b+c;
            if(den<-1e-9) off+=0.5*0.5*(a-c)/den;
          }
          pts.push({x:bx+nx*off,y:by+ny*off});
        }
        const f=pts.length>=8?robustLineFit(pts,{keep:0.75,maxResidual:1.0}):null;
        const acc=f?f.inliers.length/Math.max(8,valid):0;
        if(acc>accepted){fit=f;accepted=acc;}
        if(accepted>=0.6) break;
      }
      sup.push(accepted);
      if(fit && accepted>=0.4){
        lines.push(fit.line);
        sq+=fit.rms**2*fit.inliers.length;cnt+=fit.inliers.length;
      }else{
        lines.push(lineThrough(P0,P1)!);
      }
    }
    const nq=quadFromSideLines(lines);
    if(nq && isConvex(nq) && quadArea(nq)>0.5*quadArea(q) && quadArea(nq)<2*quadArea(q)){
      q=nq;
      support=sup as [number,number,number,number];
      rms=cnt?Math.sqrt(sq/cnt):0;
    }
  }
  return {quad:q,support,rmsPx:rms};
}

/** Prepare once; reuse for several detections on the same image. */
export function prepareGray(img:RawImage,maxWork=1600){
  const {image,scale}=downscaleToMax(img,maxWork);
  return {gray:blurGray(toGray(image),1.0),scale};
}

export function detectQuads(img:RawImage,opts:DetectQuadOptions={}):{candidates:QuadCandidate[];foreground:ForegroundResult;defects:Defect[]}{
  const fg=foregroundMask(img,opts.foreground);
  const {width:w,height:h}=fg;
  const total=w*h;
  const {labels,components}=connectedComponents(fg.mask);
  const minA=opts.minAreaFraction ?? 0.004,maxA=opts.maxAreaFraction ?? 0.92;
  const work=prepareGray(img);
  const toFull=1/fg.scale;
  const cands:QuadCandidate[]=[];

  const buildCandidate=(comp:Mask,rawTouches:boolean):QuadCandidate|null=>{
    const frac=maskArea(comp)/total;
    if(frac<minA) return null;
    // Masked (occluded) pixels might be object: let them close holes (a ring whose gap is hidden
    // still encloses its interior), then take them out again so they never count as evidence.
    let filled:Mask;
    if(fg.ignored.some((v)=>v===1)){
      const union:Mask={width:w,height:h,data:new Uint8Array(comp.data)};
      for(let i=0;i<total;i++) if(fg.ignored[i]) union.data[i]=1;
      const f2=fillHoles(union);
      filled={width:w,height:h,data:new Uint8Array(f2.data)};
      for(let i=0;i<total;i++) if(fg.ignored[i]) filled.data[i]=0;
    }else filled=fillHoles(comp);
    const filledArea=maskArea(filled);
    const exposed=exposedFaces(labels,0,w,h,filled.data,fg.ignored);
    const faces=exposed.pts;
    const skippedFaces=exposed.skipped;
    // Morphology treats the outside as empty and pulls masks off the border, so test the final
    // mask's extent with a small tolerance instead of the raw component flag.
    let bx0=w,by0=h,bx1=-1,by1=-1;
    for(let i=0;i<total;i++){
      if(!filled.data[i]) continue;
      const x=i%w,y=(i-x)/w;
      if(x<bx0) bx0=x;if(x>bx1) bx1=x;if(y<by0) by0=y;if(y>by1) by1=y;
    }
    const touchesBorder=rawTouches || bx0<=3 || by0<=3 || bx1>=w-4 || by1>=h-4;
    if(faces.length<16) return null;
    const hull=convexHull(faces);
    const ref=Math.sqrt(filledArea);
    const wk=work.scale;
    const ig=opts.foreground?.ignore;
    const ignoreAt=ig?(x:number,y:number)=>{
      const sx=Math.floor(x/wk),sy=Math.floor(y/wk);
      return sx>=0&&sy>=0&&sx<ig.width&&sy<ig.height&&ig.alpha[sy*ig.width+sx]>32;
    }:undefined;

    // Initial quads: from the hull's four strongest corners, and (when occluded pixels border the
    // object, or the hull fit is poor) from four RANSAC lines, which survive hidden corners.
    const inits:Quad[]=[];
    const q0=hullToQuad(hull);
    if(q0){
      const {lines}=sideLines(q0,faces,ref);
      const q1=quadFromSideLines(lines) ?? q0;
      inits.push(isConvex(q1)?q1:q0);
    }
    const touchesIgnored=!!fg.ignored && fg.ignored.some((v)=>v===1) && skippedFaces>0;
    if(touchesIgnored || !inits.length){
      const qr=quadFromBoundaryRansac(faces);
      if(qr && isConvex(qr)) inits.push(qr);
    }
    if(!inits.length) return null;

    let bestC:QuadCandidate|null=null;
    for(const init of inits){
      const full:Quad=init.map((p)=>({x:p.x*toFull,y:p.y*toFull})) as Quad;
      const ordered=orderQuad(full);
      const wq=ordered.map((p)=>({x:p.x*wk,y:p.y*wk})) as Quad;
      const radius=Math.min(14,Math.max(4,0.03*Math.sqrt(quadArea(wq))));
      const ref2=refineQuadToEdges(work.gray,wq,{radiusPx:radius,ignoreAt});
      const finalQuad=ref2.quad.map((p)=>({x:p.x/wk,y:p.y/wk})) as Quad;
      const c=scoreCandidate(finalQuad,ref2,filledArea,hull,frac,touchesBorder);
      if(c && (!bestC || c.confidence>bestC.confidence)) bestC=c;
    }
    return bestC;
  };

  const scoreCandidate=(finalQuad:Quad,ref2:RefineResult,filledArea:number,hull:Pt[],frac:number,touchesBorder:boolean):QuadCandidate|null=>{
    const wk=work.scale;
    const quadAreaFull=quadArea(finalQuad);
    // hidden (occluded) pixels inside the quad are probably the object: count them as covered
    let hiddenInside=0;
    if(fg.ignored.some((v)=>v===1)){
      const cov=rasterizePolygons([finalQuad.map((p)=>({x:p.x*fg.scale,y:p.y*fg.scale}))],fg.width,fg.height,2);
      for(let i=0;i<cov.length;i++) if(cov[i]>127 && fg.ignored[i]) hiddenInside++;
    }
    const compAreaFull=(filledArea+hiddenInside)*toFull*toFull;
    const rect=compAreaFull/quadAreaFull;
    const rectangularity=rect>1?1/rect:rect;
    const solidity=filledArea/Math.max(1,polygonArea(hull));
    const meanSupport=ref2.support.reduce((s,v)=>s+v,0)/4;
    const minSupport=Math.min(...ref2.support);

    const imgBorder=touchesBorder;
    const valid=validateQuad(finalQuad,{minAreaPx:100,minEdgePx:8,minInteriorAngleDeg:25}).ok;
    if(!valid) return null;

    const rectScore=clamp01((rectangularity-0.85)/0.12);
    const supScore=clamp01((meanSupport-0.4)/0.45);
    let confidence=rectScore*supScore*(minSupport>=0.4?1:0.5);
    if(imgBorder) confidence*=0.6;
    const sizeFactor=Math.min(1,Math.sqrt(frac/0.05));
    const score=confidence*(0.5+0.5*sizeFactor);

    const defects:Defect[]=[];
    if(imgBorder) defects.push(defect("QUAD_TOUCHES_BORDER","warn","The object touches the image border; its true corners may be cut off.",{areaFraction:frac}));
    if(confidence<0.5) defects.push(defect("QUAD_LOW_CONFIDENCE",confidence<0.25?"blocker":"warn","Corner detection is not confident; manual corners recommended.",{confidence}));
    return {
      quad:finalQuad,confidence,score,defects,
      stats:{
        areaFraction:frac,rectangularity,solidity,
        edgeSupport:ref2.support,meanEdgeSupport:meanSupport,
        fitRmsPx:ref2.rmsPx/wk,touchesBorder:imgBorder
      }
    };
  };

  for(const c of components){
    const frac0=c.area/total;
    if(frac0<minA*0.5 || frac0>maxA) continue;
    const comp0:Mask={width:w,height:h,data:new Uint8Array(total)};
    for(let i=0;i<total;i++) comp0.data[i]=labels[i]===c.label?1:0;

    // Two hypotheses per component. "Adaptive": re-threshold at a fraction of the object's own
    // contrast, which drops faint drop shadows. "Loose": the raw component, which keeps pale
    // mouldings that are fainter than the artwork inside them. Frame analysis arbitrates later.
    const inside:number[]=[];
    for(let i=0;i<total;i++) if(comp0.data[i]) inside.push(fg.deltaE[i]);
    inside.sort((a,b)=>a-b);
    const p90=inside[Math.floor(inside.length*0.9)] ?? 0;
    const thrC=Math.min(60,Math.max(fg.threshold,0.5*p90));
    const masks:Mask[]=[comp0];
    if(thrC>fg.threshold+0.5){
      const region=dilate(comp0,3);
      const tight:Mask={width:w,height:h,data:new Uint8Array(total)};
      for(let i=0;i<total;i++) tight.data[i]=region.data[i]&&fg.deltaE[i]>thrC?1:0;
      // Keep every strong piece (a dark moulding ring and the artwork inside it are separate
      // components once pale mounts and faint shadows drop out), then fill: the ring encloses
      // the rest, which yields the true outer silhouette without the shadow.
      const cleaned=fillHoles(closeMask(openMask(tight,1),2));
      const cc=connectedComponents(cleaned);
      if(cc.components.length){
        const biggest=cc.components.reduce((a,b)=>b.area>a.area?b:a);
        const adaptive:Mask={width:w,height:h,data:new Uint8Array(total)};
        for(let i=0;i<total;i++) adaptive.data[i]=cc.labels[i]===biggest.label?1:0;
        masks.unshift(adaptive);
      }
    }
    for(const comp of masks){
      const cand=buildCandidate(comp,c.touchesBorder);
      if(cand) cands.push(cand);
    }
  }

  cands.sort((a,b)=>b.score-a.score);
  // merge near-identical candidates produced by the two threshold hypotheses
  const unique:QuadCandidate[]=[];
  for(const c of cands){
    const tol=0.02*Math.sqrt(quadArea(c.quad));
    const dup=unique.some((u)=>u.quad.every((p,i)=>Math.hypot(p.x-c.quad[i].x,p.y-c.quad[i].y)<tol));
    if(!dup) unique.push(c);
  }
  const kept=unique.slice(0,opts.maxCandidates ?? 6);
  const defects:Defect[]=[];
  if(!kept.length) defects.push(defect("QUAD_NOT_FOUND","blocker","No quadrilateral object was found; supply corners manually."));
  else{
    // Ambiguous only when another good candidate sits elsewhere in the image; a frame and the
    // artwork nested inside it are one object, not two.
    const rival=kept.slice(1).find((c)=>c.score>=0.8*kept[0].score && c.confidence>=0.5 && bboxIoU(c.quad,kept[0].quad)<0.2);
    if(rival) defects.push(defect("QUAD_AMBIGUOUS","warn","More than one similarly good object was found; the highest-scoring one was chosen.",{best:kept[0].score,second:rival.score}));
  }
  return {candidates:kept,foreground:fg,defects};
}
