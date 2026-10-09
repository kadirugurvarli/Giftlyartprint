import type {Pt,Quad} from "../types";

export type QuadIssueCode=
  | "NOT_CONVEX"
  | "WRONG_WINDING"
  | "DEGENERATE_AREA"
  | "EDGE_TOO_SHORT"
  | "TOO_SKEWED"
  | "OUT_OF_BOUNDS";

export type QuadIssue={code:QuadIssueCode;message:string};

export type QuadValidationOptions={
  minAreaPx?:number;
  minEdgePx?:number;
  minInteriorAngleDeg?:number;
  bounds?:{width:number;height:number;tolerancePx?:number};
  allowMirrored?:boolean;
};

export function rectQuad(width:number,height:number):Quad{
  return [{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}];
}

export function cloneQuad(q:Quad):Quad{
  return q.map((p)=>({x:p.x,y:p.y})) as Quad;
}

export function cross(ax:number,ay:number,bx:number,by:number){
  return ax*by-ay*bx;
}

/** Positive for TL,TR,BR,BL order (clockwise on a y-down screen). */
export function signedArea(q:Quad){
  let s=0;
  for(let i=0;i<4;i++){
    const a=q[i];
    const b=q[(i+1)%4];
    s+=a.x*b.y-b.x*a.y;
  }
  return s/2;
}

export function quadArea(q:Quad){
  return Math.abs(signedArea(q));
}

export function quadCentroid(q:Quad):Pt{
  return {
    x:(q[0].x+q[1].x+q[2].x+q[3].x)/4,
    y:(q[0].y+q[1].y+q[2].y+q[3].y)/4
  };
}

export function quadBounds(q:Quad){
  const xs=q.map((p)=>p.x);
  const ys=q.map((p)=>p.y);
  return {minX:Math.min(...xs),minY:Math.min(...ys),maxX:Math.max(...xs),maxY:Math.max(...ys)};
}

/** Lengths of edges TL-TR, TR-BR, BR-BL, BL-TL. */
export function edgeLengths(q:Quad):[number,number,number,number]{
  return [0,1,2,3].map((i)=>Math.hypot(q[(i+1)%4].x-q[i].x,q[(i+1)%4].y-q[i].y)) as [number,number,number,number];
}

function turns(q:Quad){
  const out:number[]=[];
  for(let i=0;i<4;i++){
    const a=q[i];
    const b=q[(i+1)%4];
    const c=q[(i+2)%4];
    out.push(cross(b.x-a.x,b.y-a.y,c.x-b.x,c.y-b.y));
  }
  return out;
}

/** Strictly convex with a single winding direction (rejects bow-ties and reflex corners). */
export function isConvex(q:Quad){
  const t=turns(q);
  return t.every((v)=>v>1e-9) || t.every((v)=>v<-1e-9);
}

/** Interior angle (degrees) at each vertex. */
export function interiorAngles(q:Quad):number[]{
  return [0,1,2,3].map((i)=>{
    const p=q[i];
    const a=q[(i+3)%4];
    const b=q[(i+1)%4];
    const v1={x:a.x-p.x,y:a.y-p.y};
    const v2={x:b.x-p.x,y:b.y-p.y};
    const d=v1.x*v2.x+v1.y*v2.y;
    const l=Math.hypot(v1.x,v1.y)*Math.hypot(v2.x,v2.y);
    if(l===0) return 0;
    return Math.acos(Math.max(-1,Math.min(1,d/l)))*180/Math.PI;
  });
}

/**
 * Order four unordered points as TL,TR,BR,BL (clockwise on screen).
 * Sorts by angle about the centroid, then starts at the point nearest the top-left.
 */
export function orderQuad(points:Pt[]):Quad{
  if(points.length!==4) throw new Error("orderQuad needs exactly four points.");
  const cx=points.reduce((s,p)=>s+p.x,0)/4;
  const cy=points.reduce((s,p)=>s+p.y,0)/4;
  const sorted=[...points].sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
  let start=0;
  let best=Infinity;
  sorted.forEach((p,i)=>{
    const s=p.x+p.y;
    if(s<best){best=s;start=i;}
  });
  return [0,1,2,3].map((i)=>({...sorted[(start+i)%4]})) as Quad;
}

export function validateQuad(q:Quad,opts:QuadValidationOptions={}):{ok:boolean;issues:QuadIssue[]}{
  const issues:QuadIssue[]=[];
  const minArea=opts.minAreaPx ?? 64;
  const minEdge=opts.minEdgePx ?? 4;
  const minAngle=opts.minInteriorAngleDeg ?? 15;

  if(q.some((p)=>!Number.isFinite(p.x) || !Number.isFinite(p.y))){
    return {ok:false,issues:[{code:"DEGENERATE_AREA",message:"Corner coordinates are not finite."}]};
  }

  if(!isConvex(q)){
    issues.push({code:"NOT_CONVEX",message:"Corners do not form a convex quadrilateral (check corner order)."});
  }else if(signedArea(q)<0 && !opts.allowMirrored){
    issues.push({code:"WRONG_WINDING",message:"Corners are mirrored; expected top-left, top-right, bottom-right, bottom-left."});
  }
  if(quadArea(q)<minArea){
    issues.push({code:"DEGENERATE_AREA",message:`Quad area is below ${minArea}px.`});
  }
  if(edgeLengths(q).some((l)=>l<minEdge)){
    issues.push({code:"EDGE_TOO_SHORT",message:`An edge is shorter than ${minEdge}px.`});
  }
  if(isConvex(q) && interiorAngles(q).some((a)=>a<minAngle || a>180-minAngle)){
    issues.push({code:"TOO_SKEWED",message:`An interior angle is outside ${minAngle}-${180-minAngle} degrees.`});
  }
  if(opts.bounds){
    const tol=opts.bounds.tolerancePx ?? 0;
    const b=quadBounds(q);
    if(b.minX<-tol || b.minY<-tol || b.maxX>opts.bounds.width+tol || b.maxY>opts.bounds.height+tol){
      issues.push({code:"OUT_OF_BOUNDS",message:"Quad extends outside the image."});
    }
  }
  return {ok:issues.length===0,issues};
}

export type AspectMethod="zhang-he"|"fronto-parallel"|"given-focal"|"assumed-focal"|"edge-fallback"|"none";

export type AspectEstimate={
  /** width/height of the real rectangle that produced the quad; null when it cannot be estimated. */
  aspect:number|null;
  /** Focal length in px that the estimate used, when applicable. */
  focalPx:number|null;
  method:AspectMethod;
  /** False when the estimate rests on an assumption and must not be enforced as a hard failure. */
  reliable:boolean;
};

export type AspectOptions={
  /** Known focal length in px (e.g. from EXIF). Always preferred when supplied. */
  focalPx?:number;
};

/** Opposite-edge ratio deviation below which a quad is treated as a parallelogram. */
const PARALLEL_TOL=0.004;
/** One vanishing point at infinity (level camera, pure yaw/pitch): focal length is unobservable. */
const ONE_VP_TOL=0.01;
/** Typical phone main camera (about 26mm equivalent) as a fraction of the long image side. */
const ASSUMED_FOCAL_RATIO=0.72;

type V3=[number,number,number];
const cr3=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot3=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

/**
 * Recover the true width/height ratio of a rectangle seen in perspective (square pixels,
 * principal point at the image centre; Zhang & He, "Whiteboard scanning").
 *
 * - Two vanishing points: focal length is solved from the quad itself.
 * - Parallelogram (no perspective): edge lengths are exact.
 * - One vanishing point (level camera): focal is unobservable; uses `opts.focalPx` when given,
 *   otherwise a phone-typical assumption that is flagged `reliable:false`.
 */
export function estimateRectAspect(q:Quad,imageWidth:number,imageHeight:number,opts:AspectOptions={}):AspectEstimate{
  const u0=imageWidth/2;
  const v0=imageHeight/2;
  const m1:V3=[q[0].x-u0,q[0].y-v0,1];
  const m2:V3=[q[1].x-u0,q[1].y-v0,1];
  const m3:V3=[q[3].x-u0,q[3].y-v0,1];
  const m4:V3=[q[2].x-u0,q[2].y-v0,1];

  const e=edgeLengths(q);
  const edgeAspect=((e[0]+e[2])/2)/((e[1]+e[3])/2);
  const edgeOk=Number.isFinite(edgeAspect) && edgeAspect>0;
  const none:AspectEstimate={aspect:null,focalPx:null,method:"none",reliable:false};
  const fronto:AspectEstimate=edgeOk?{aspect:edgeAspect,focalPx:null,method:"fronto-parallel",reliable:true}:none;
  const edgeFallback:AspectEstimate=edgeOk?{aspect:edgeAspect,focalPx:null,method:"edge-fallback",reliable:false}:none;

  const m14=cr3(m1,m4);
  const d2=dot3(cr3(m2,m4),m3);
  const d3=dot3(cr3(m3,m4),m2);
  if(Math.abs(d2)<1e-12 || Math.abs(d3)<1e-12) return edgeFallback;
  const k2=dot3(m14,m3)/d2;
  const k3=dot3(m14,m2)/d3;

  if(Math.abs(k2-1)<PARALLEL_TOL && Math.abs(k3-1)<PARALLEL_TOL) return fronto;

  const n2:V3=[k2*m2[0]-m1[0],k2*m2[1]-m1[1],k2*m2[2]-m1[2]];
  const n3:V3=[k3*m3[0]-m1[0],k3*m3[1]-m1[1],k3*m3[2]-m1[2]];

  const fromFocal=(f:number)=>{
    const f2=f*f;
    const wSq=(n2[0]*n2[0]+n2[1]*n2[1])/f2+n2[2]*n2[2];
    const hSq=(n3[0]*n3[0]+n3[1]*n3[1])/f2+n3[2]*n3[2];
    return wSq>0 && hSq>0?Math.sqrt(wSq/hSq):null;
  };

  if(opts.focalPx && opts.focalPx>0){
    const a=fromFocal(opts.focalPx);
    return a===null?edgeFallback:{aspect:a,focalPx:opts.focalPx,method:"given-focal",reliable:true};
  }

  if(Math.min(Math.abs(k2-1),Math.abs(k3-1))>=ONE_VP_TOL){
    const f2=-(n2[0]*n3[0]+n2[1]*n3[1])/(n2[2]*n3[2]);
    if(f2>0 && Number.isFinite(f2)){
      const f=Math.sqrt(f2);
      const a=fromFocal(f);
      if(a!==null) return {aspect:a,focalPx:f,method:"zhang-he",reliable:true};
    }
    return edgeFallback;
  }

  const f=ASSUMED_FOCAL_RATIO*Math.max(imageWidth,imageHeight);
  const a=fromFocal(f);
  return a===null?edgeFallback:{aspect:a,focalPx:f,method:"assumed-focal",reliable:false};
}

/**
 * Offset every edge of a convex quad by `d` px (positive = outward) and re-intersect.
 * Used for sub-pixel overlap/inset where moving corners radially would skew the shape.
 */
export function offsetQuad(q:Quad,d:number):Quad{
  const lines=[0,1,2,3].map((i)=>{
    const a=q[i],b=q[(i+1)%4];
    const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;
    const nx=dy/l,ny=-dx/l; // outward for TL,TR,BR,BL
    const p={x:a.x+nx*d,y:a.y+ny*d};
    return {p,dx:dx/l,dy:dy/l};
  });
  const inter=(l1:typeof lines[0],l2:typeof lines[0]):Pt=>{
    const det=l1.dx*l2.dy-l1.dy*l2.dx;
    if(Math.abs(det)<1e-12) return l1.p;
    const t=((l2.p.x-l1.p.x)*l2.dy-(l2.p.y-l1.p.y)*l2.dx)/det;
    return {x:l1.p.x+l1.dx*t,y:l1.p.y+l1.dy*t};
  };
  return [inter(lines[3],lines[0]),inter(lines[0],lines[1]),inter(lines[1],lines[2]),inter(lines[2],lines[3])];
}
