import type {Mat3,Pt,Quad,RawImage} from "../types";
import {applyHomography,homographyFromPoints} from "../geometry/homography";
import {rectQuad} from "../geometry/quad";
import {blurGray,downscaleToMax,sobel,toGray,sampleGray,type Mask} from "../vision/gray";
import {connectedComponents,maskArea,openMask} from "../vision/mask";
import {robustLineFit} from "../vision/lines";
import {defect,type Defect} from "../detect/defects";

/** y = m*x + c in full-resolution image coordinates. */
export type YLine={m:number;c:number;rmsPx:number;samples:number};

export type WallAnalysis={
  scale:number;
  mask:Mask;
  areaFraction:number;
  top:YLine|null;
  bottom:YLine|null;
  /** Horizontal vanishing point (full-res px). null = ceiling and floor lines are parallel (frontal). */
  vanishingX:number|null;
  vanishingY:number|null;
  /** |vp_y - principal y| / height. Large means the camera is pitched and the level-camera model is off. */
  levelResidual:number|null;
  confidence:number;
  imageSize:{width:number;height:number};
  defects:Defect[];
};

export type WallOptions={
  /** Tap point on the wall (full-res px): selects the wall region under the finger. */
  hint?:Pt;
};

const at=(m:Mask,x:number,y:number)=>x>=0&&y>=0&&x<m.width&&y<m.height?m.data[y*m.width+x]:0;

/** Wall = the largest smooth region (low local gradient); edges between planes and objects separate regions. */
export function analyseWall(img:RawImage,opts:WallOptions={}):WallAnalysis{
  const {image,scale}=downscaleToMax(img,480);
  const w=image.width,h=image.height;
  const g=blurGray(toGray(image),1.6);
  const {mag}=sobel(g);
  const sorted=Float32Array.from(mag).sort();
  const med=sorted[Math.floor(sorted.length/2)];
  const thr=Math.min(3.2,Math.max(1.0,3.2*med));
  const smooth:Mask={width:w,height:h,data:new Uint8Array(w*h)};
  for(let i=0;i<w*h;i++) smooth.data[i]=mag[i]<thr?1:0;
  // open only: closing would bridge the thin edge band between wall and ceiling/floor
  const cleaned=openMask(smooth,1);
  const {labels,components}=connectedComponents(cleaned);
  const defects:Defect[]=[];
  const fail=(msg:string):WallAnalysis=>({
    scale,mask:{width:w,height:h,data:new Uint8Array(w*h)},areaFraction:0,top:null,bottom:null,
    vanishingX:null,vanishingY:null,levelResidual:null,confidence:0,imageSize:{width:img.width,height:img.height},
    defects:[...defects,defect("WALL_NOT_FOUND","blocker",msg)]
  });
  if(!components.length) return fail("No smooth wall-like region was found.");

  let chosen=components.reduce((a,b)=>b.area>a.area?b:a);
  if(opts.hint){
    const hx=Math.round(opts.hint.x*scale),hy=Math.round(opts.hint.y*scale);
    const lab=labels[Math.min(h-1,Math.max(0,hy))*w+Math.min(w-1,Math.max(0,hx))];
    if(lab>=0) chosen=components[lab];
  }
  const total=w*h;
  const frac=chosen.area/total;
  if(frac<0.08) return fail("The largest smooth region is under 8% of the image; it does not look like a wall.");
  const wall:Mask={width:w,height:h,data:new Uint8Array(total)};
  for(let i=0;i<total;i++) wall.data[i]=labels[i]===chosen.label?1:0;

  // column-wise top/bottom boundary of the wall (ignoring columns clipped by the image border)
  const topPts:Pt[]=[],botPts:Pt[]=[];
  for(let x=2;x<w-2;x++){
    let first=-1,last=-1;
    for(let y=0;y<h;y++) if(wall.data[y*w+x]){first=y;break;}
    for(let y=h-1;y>=0;y--) if(wall.data[y*w+x]){last=y;break;}
    if(first<0) continue;
    if(first>3) topPts.push({x:x+0.5,y:first});
    if(last<h-4) botPts.push({x:x+0.5,y:last+1});
  }
  const fit=(pts:Pt[]):YLine|null=>{
    if(pts.length<Math.max(20,0.2*w)) return null;
    const f=robustLineFit(pts,{keep:0.7,maxResidual:2.0});
    if(!f || f.inliers.length<0.15*w) return null;
    const {a,b,c}=f.line;
    if(Math.abs(b)<0.2) return null; // near-vertical, not a horizontal wall edge
    const m=-a/b,cc=-c/b;
    return {m:m,c:cc/scale,rmsPx:f.rms/scale,samples:f.inliers.length};
  };
  const top=fit(topPts),bottom=fit(botPts);
  const toFull=(l:YLine|null):YLine|null=>l?{m:l.m,c:l.c,rmsPx:l.rmsPx,samples:l.samples}:null;
  void toFull;

  let vanishingX:number|null=null,vanishingY:number|null=null,level:number|null=null;
  if(top && bottom){
    const dm=top.m-bottom.m;
    if(Math.abs(dm)>0.012){
      vanishingX=(bottom.c-top.c)/dm;
      vanishingY=top.m*vanishingX+top.c;
      level=Math.abs(vanishingY-img.height/2)/img.height;
      if(level>0.12) defects.push(defect("CAMERA_NOT_LEVEL","warn","The ceiling/floor lines meet far from the image centre line, so the camera looks pitched; wall geometry is approximate.",{levelResidual:level}));
    }
  }else{
    defects.push(defect("PERSPECTIVE_ASSUMED_FRONTAL","warn","Could not find both the ceiling and floor/skirting lines of the wall; assuming a frontal view.",{hasTop:!!top,hasBottom:!!bottom}));
  }
  const confidence=top&&bottom?Math.min(1,0.4+0.6*Math.min(1,(top.samples+bottom.samples)/(1.2*w))):0.3;
  return {scale,mask:wall,areaFraction:frac,top,bottom,vanishingX,vanishingY,levelResidual:level,confidence,imageSize:{width:img.width,height:img.height},defects};
}

export type PlacementInput={
  /** Width/height of the framed piece INCLUDING frame (what hangs on the wall). */
  aspect:number;
  /** Physical outer width in metres. Default 0.6 (flagged as assumed). */
  widthM?:number;
  /** Room height between floor and ceiling in metres (default 2.4, flagged as assumed). */
  ceilingHeightM?:number;
  /** Height of the skirting board whose top edge is the detected lower line (default 0.1; 0 if the line is the floor). */
  skirtingM?:number;
  /** Where the centre of the piece hangs above the floor, metres (default 1.45, gallery eye level). */
  centreHeightM?:number;
  /** Camera focal length in px (e.g. from EXIF). Without it 0.72 * longest side is assumed. */
  focalPx?:number;
  /** Prefer this horizontal position (full-res px) when it is free. */
  preferX?:number;
  /** Required clearance around the piece, as a fraction of its width (default 0.04). */
  clearance?:number;
};

export type PlacementResult={
  quad:Quad|null;
  centre:Pt|null;
  /** Image -> metric info for tests/diagnostics */
  usedFocalPx:number;
  scaleMethod:"physical"|"assumed-fraction"|"none";
  perspectiveMethod:"vanishing-point"|"frontal";
  freeFraction:number;
  defects:Defect[];
};

const lineY=(l:YLine,x:number)=>l.m*x+l.c;

/** Build the quad for a frame centred at image x, using the level-camera wall model. */
function buildQuad(a:WallAnalysis,inp:Required<Pick<PlacementInput,"aspect">>&PlacementInput,xc:number,f:number):{quad:Quad;scaleMethod:PlacementResult["scaleMethod"]}|null{
  const {width:W,height:H}=a.imageSize;
  const cx=W/2;
  const widthM=inp.widthM ?? 0.6;
  const heightM=widthM/inp.aspect;
  const ceiling=inp.ceilingHeightM ?? 2.4,skirt=inp.skirtingM ?? 0.1;
  const wallSpanM=ceiling-skirt; // metres between the two detected lines
  const centreBelowCeilingM=ceiling-(inp.centreHeightM ?? 1.45);

  if(a.top && a.bottom){
    const sv=(x:number)=>(lineY(a.bottom!,x)-lineY(a.top!,x))/wallSpanM; // px per metre along a vertical at x
    const svc=sv(xc);
    if(!(svc>1)) return null;
    // horizontal direction of the wall in camera space from the vanishing point
    let psi=0;
    if(a.vanishingX!==null){
      const dx=a.vanishingX-cx;
      psi=Math.abs(dx)<1e-6?Math.PI/2:Math.atan(f/dx);
    }
    const Pzc=f/svc;
    const Pxc=(xc-cx)*Pzc/f;
    const ex=Math.cos(psi),ez=Math.sin(psi);
    const corner=(dX:number,belowCeilingM:number):Pt=>{
      const Px=Pxc+dX*ex,Pz=Pzc+dX*ez;
      const x=cx+f*Px/Pz;
      const s=f/Pz;
      return {x,y:lineY(a.top!,x)+belowCeilingM*s};
    };
    const yt=centreBelowCeilingM-heightM/2,yb=centreBelowCeilingM+heightM/2;
    const q:Quad=[corner(-widthM/2,yt),corner(widthM/2,yt),corner(widthM/2,yb),corner(-widthM/2,yb)];
    return {quad:q,scaleMethod:"physical"};
  }
  // frontal fallback: scale from the wall's visible width (assumed), axis aligned
  const wallPxW=Math.max(1,(a.areaFraction*W*H)/H);
  const wPx=Math.min(0.3*W,0.35*wallPxW);
  const hPx=wPx/inp.aspect;
  const yc=H*0.42;
  return {quad:[{x:xc-wPx/2,y:yc-hPx/2},{x:xc+wPx/2,y:yc-hPx/2},{x:xc+wPx/2,y:yc+hPx/2},{x:xc-wPx/2,y:yc+hPx/2}],scaleMethod:"none"};
}

function freeFractionOf(a:WallAnalysis,q:Quad,marginFrac:number):number{
  const Hm:Mat3|null=homographyFromPoints(rectQuad(1,1),q);
  if(!Hm) return 0;
  const sizePx=Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y);
  const grow=marginFrac;
  let ok=0,n=0;
  const N=16;
  for(let j=0;j<=N;j++){
    for(let i=0;i<=N;i++){
      const u=-grow+(1+2*grow)*i/N,v=-grow*0.8+(1+1.6*grow)*j/N;
      const p=applyHomography(Hm,{x:u,y:v});
      if(!p) continue;
      n++;
      if(at(a.mask,Math.floor(p.x*a.scale),Math.floor(p.y*a.scale))) ok++;
    }
  }
  void sizePx;
  return n?ok/n:0;
}

/**
 * Choose where to hang the piece: scan candidate horizontal positions across the wall, build the
 * perspective-correct quad for each and keep those fully on free wall; pick the centre of the
 * widest feasible run (or the position nearest `preferX`).
 */
export function proposeWallPlacement(a:WallAnalysis,input:PlacementInput):PlacementResult{
  const defects:Defect[]=[...a.defects];
  const {width:W,height:H}=a.imageSize;
  const f=input.focalPx ?? 0.72*Math.max(W,H);
  if(!input.focalPx && a.vanishingX!==null) defects.push(defect("FOCAL_ASSUMED","info","No camera focal length supplied; a typical phone lens was assumed. Foreshortening (and so the frame's apparent proportions) is approximate on angled views.",{assumedFocalPx:f}));
  if(input.widthM===undefined) defects.push(defect("SCALE_ASSUMED","info","No physical frame width supplied; 0.6 m was assumed.",{widthM:0.6}));
  if(input.ceilingHeightM===undefined && a.top && a.bottom) defects.push(defect("SCALE_ASSUMED","info","Ceiling height not supplied; 2.4 m was assumed. Apparent frame size scales with this.",{ceilingHeightM:2.4}));
  if(a.mask.data.length===0 || a.areaFraction===0){
    return {quad:null,centre:null,usedFocalPx:f,scaleMethod:"none",perspectiveMethod:"frontal",freeFraction:0,defects};
  }
  const clearance=input.clearance ?? 0.04;
  const xs:{x:number;free:number;q:Quad;sm:PlacementResult["scaleMethod"]}[]=[];
  for(let x=Math.round(0.04*W);x<=Math.round(0.96*W);x+=Math.max(3,Math.round(W/240))){
    const b=buildQuad(a,input as Required<Pick<PlacementInput,"aspect">>&PlacementInput,x,f);
    if(!b) continue;
    const free=freeFractionOf(a,b.quad,clearance);
    xs.push({x,free,q:b.quad,sm:b.scaleMethod});
  }
  const feasible=xs.filter((p)=>p.free>=0.985);
  if(!feasible.length){
    defects.push(defect("NO_FREE_WALL_SPACE","blocker","No position was found where the piece fits fully on free wall; supply corners or a smaller size.",{best:xs.length?Math.max(...xs.map((p)=>p.free)):0}));
    return {quad:null,centre:null,usedFocalPx:f,scaleMethod:"none",perspectiveMethod:a.vanishingX===null?"frontal":"vanishing-point",freeFraction:xs.length?Math.max(...xs.map((p)=>p.free)):0,defects};
  }
  // contiguous runs of feasible positions
  const step=xs.length>1?xs[1].x-xs[0].x:1;
  const runs:{a:number;b:number}[]=[];
  let cur:{a:number;b:number}|null=null;
  for(const p of xs){
    if(p.free>=0.985){
      if(cur && p.x-cur.b<=step*1.01) cur.b=p.x;
      else{cur={a:p.x,b:p.x};runs.push(cur);}
    }
  }
  let pick:number;
  if(input.preferX!==undefined && feasible.some((p)=>Math.abs(p.x-input.preferX!)<=step*1.5)){
    pick=feasible.reduce((best,p)=>Math.abs(p.x-input.preferX!)<Math.abs(best.x-input.preferX!)?p:best).x;
  }else{
    // bias towards the centre of the wall among near-equal runs
    const wallCx=(()=>{
      let s=0,n=0;
      for(let y=0;y<a.mask.height;y+=2) for(let x=0;x<a.mask.width;x++) if(a.mask.data[y*a.mask.width+x]){s+=x;n++;}
      return n?s/n/a.scale:W/2;
    })();
    const widest=Math.max(...runs.map((r)=>r.b-r.a));
    const good=runs.filter((r)=>r.b-r.a>=0.6*widest);
    const best=good.reduce((u,v)=>Math.abs((v.a+v.b)/2-wallCx)<Math.abs((u.a+u.b)/2-wallCx)?v:u);
    pick=(best.a+best.b)/2;
  }
  const chosen=xs.reduce((best,p)=>Math.abs(p.x-pick)<Math.abs(best.x-pick)?p:best);
  const rebuilt=buildQuad(a,input as Required<Pick<PlacementInput,"aspect">>&PlacementInput,pick,f)!;
  const quad=rebuilt.quad;
  const centre:Pt={x:(quad[0].x+quad[1].x+quad[2].x+quad[3].x)/4,y:(quad[0].y+quad[1].y+quad[2].y+quad[3].y)/4};
  return {
    quad,centre,usedFocalPx:f,scaleMethod:rebuilt.scaleMethod,
    perspectiveMethod:a.vanishingX===null?"frontal":"vanishing-point",
    freeFraction:chosen.free,defects
  };
}

void (undefined as unknown as RawImage);void sampleGray;void maskArea;
