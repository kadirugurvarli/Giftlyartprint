import type {Mat3,Pt} from "../types";
import {applyHomography,invertMat3,mulMat3,solveLinear} from "../geometry/homography";
import type {ControlPoint,RoomCamera} from "./schema";

/** Least-squares homography dst ~ H*src from N>=4 point pairs (normalised DLT, h33 = 1). */
export function fitHomography(src:Pt[],dst:Pt[]):Mat3|null{
  const n=src.length;
  if(n<4||dst.length!==n) return null;
  const norm=(pts:Pt[])=>{
    const cx=pts.reduce((s,p)=>s+p.x,0)/n,cy=pts.reduce((s,p)=>s+p.y,0)/n;
    const d=pts.reduce((s,p)=>s+Math.hypot(p.x-cx,p.y-cy),0)/n;
    if(!(d>1e-9)) return null;
    const s=Math.SQRT2/d;
    return [s,0,-s*cx,0,s,-s*cy,0,0,1] as Mat3;
  };
  const Ts=norm(src),Td=norm(dst);
  if(!Ts||!Td) return null;
  const ata:number[][]=Array.from({length:8},()=>new Array(8).fill(0));
  const atb:number[]=new Array(8).fill(0);
  const add=(row:number[],rhs:number)=>{for(let i=0;i<8;i++){atb[i]+=row[i]*rhs;for(let j=0;j<8;j++) ata[i][j]+=row[i]*row[j];}};
  for(let i=0;i<n;i++){
    const x=Ts[0]*src[i].x+Ts[2],y=Ts[4]*src[i].y+Ts[5];
    const u=Td[0]*dst[i].x+Td[2],v=Td[4]*dst[i].y+Td[5];
    add([x,y,1,0,0,0,-u*x,-u*y],u);
    add([0,0,0,x,y,1,-v*x,-v*y],v);
  }
  const h=solveLinear(ata,atb);
  if(!h) return null;
  const Hn:Mat3=[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1];
  const TdInv=invertMat3(Td);
  if(!TdInv) return null;
  const H=mulMat3(mulMat3(TdInv,Hn),Ts);
  if(!H.every(Number.isFinite)||Math.abs(H[8])<1e-12) return null;
  return H.map(v=>v/H[8]) as Mat3;
}

export type WallFit={
  /** wall cm -> image px */
  H:Mat3;
  /** image px -> wall cm */
  Hinv:Mat3;
  rmsPx:number;
  maxPx:number;
};

/** Fit the wall plane from calibrated control points and report the reprojection error. */
export function fitWall(points:ControlPoint[]):WallFit|null{
  const H=fitHomography(points.map(p=>p.wallCm),points.map(p=>p.image));
  if(!H) return null;
  const Hinv=invertMat3(H);
  if(!Hinv) return null;
  let sum=0,max=0;
  for(const p of points){
    const q=applyHomography(H,p.wallCm);
    if(!q) return null;
    const e=Math.hypot(q.x-p.image.x,q.y-p.image.y);
    sum+=e*e;max=Math.max(max,e);
  }
  return {H,Hinv,rmsPx:Math.sqrt(sum/points.length),maxPx:max};
}

/** Local image-px per wall-cm at a wall position (square root of the Jacobian determinant). */
export function pxPerCmAt(H:Mat3,at:Pt):number{
  const c=applyHomography(H,at),sx=applyHomography(H,{x:at.x+1,y:at.y}),sy=applyHomography(H,{x:at.x,y:at.y+1});
  if(!c||!sx||!sy) return NaN;
  const a=sx.x-c.x,b=sy.x-c.x,cc=sx.y-c.y,d=sy.y-c.y;
  return Math.sqrt(Math.abs(a*d-b*cc));
}

export type PerspectiveReport={
  /** Angle between the back-projected horizontal and vertical wall directions; 90 for a real rectangle. */
  axesAngleDeg:number;
  /** |K^-1 h1| / |K^-1 h2|: 1 when the wall's cm are isotropic as seen by the stated camera. */
  axesNormRatio:number;
  /** Focal length implied by the homography alone (null when the wall is fronto-parallel: unobservable). */
  impliedFocalPx:number|null;
  /** Wall-plane normal angle to the optical axis, degrees (0 = fronto-parallel). */
  wallTiltDeg:number;
};

/**
 * Do the stated camera and the calibrated wall plane belong together? For a metric plane the first two
 * columns of K^-1*H are the plane's x and y axes in camera space: they must be orthogonal and of equal
 * length. A mismatch means the focal length, the control points or the picture's perspective are wrong
 * (typical of AI-generated rooms).
 */
export function perspectiveReport(H:Mat3,camera:RoomCamera,image:{width:number;height:number}):PerspectiveReport|null{
  const cx=camera.principalPoint?.x ?? image.width/2,cy=camera.principalPoint?.y ?? image.height/2,f=camera.focalPx;
  if(!(f>0)) return null;
  const kinv=(x:number,y:number,z:number)=>[(x-cx*z)/f,(y-cy*z)/f,z];
  const d1=kinv(H[0],H[3],H[6]),d2=kinv(H[1],H[4],H[7]),d3=kinv(H[2],H[5],H[8]);
  const dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const n1=Math.sqrt(dot(d1,d1)),n2=Math.sqrt(dot(d2,d2));
  if(!(n1>1e-12&&n2>1e-12)) return null;
  const cosA=Math.max(-1,Math.min(1,dot(d1,d2)/(n1*n2)));
  const axesAngleDeg=Math.acos(cosA)*180/Math.PI;
  // plane normal = d1 x d2
  const nrm=[d1[1]*d2[2]-d1[2]*d2[1],d1[2]*d2[0]-d1[0]*d2[2],d1[0]*d2[1]-d1[1]*d2[0]];
  const nl=Math.sqrt(dot(nrm,nrm))||1;
  const tilt=Math.acos(Math.min(1,Math.abs(nrm[2])/nl))*180/Math.PI;
  void d3;
  // implied focal: needs two vanishing points that are not (nearly) at infinity. A level camera puts the
  // vertical one at infinity and then the focal length is unobservable, so nothing is claimed.
  let impliedFocalPx:number|null=null;
  const h1z=H[6],h2z=H[7];
  if(Math.abs(h1z)>1e-12&&Math.abs(h2z)>1e-12){
    const v1={x:H[0]/h1z-cx,y:H[3]/h1z-cy},v2={x:H[1]/h2z-cx,y:H[4]/h2z-cy};
    const far=Math.max(Math.hypot(v1.x,v1.y),Math.hypot(v2.x,v2.y));
    const f2=-(v1.x*v2.x+v1.y*v2.y);
    if(far<20*f&&f2>0&&Number.isFinite(f2)) impliedFocalPx=Math.sqrt(f2);
  }
  return {axesAngleDeg,axesNormRatio:n1/n2,impliedFocalPx,wallTiltDeg:tilt};
}

/** Angle in degrees between a drawn line and the direction the wall plane predicts at its midpoint. */
export function lineDeviationDeg(Hfit:{H:Mat3;Hinv:Mat3},kind:"horizontal"|"vertical",a:Pt,b:Pt):number|null{
  const m={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  const w=applyHomography(Hfit.Hinv,m);
  if(!w) return null;
  const step=kind==="horizontal"?{x:w.x+1,y:w.y}:{x:w.x,y:w.y+1};
  const p0=applyHomography(Hfit.H,w),p1=applyHomography(Hfit.H,step);
  if(!p0||!p1) return null;
  const pred=Math.atan2(p1.y-p0.y,p1.x-p0.x),drawn=Math.atan2(b.y-a.y,b.x-a.x);
  let d=Math.abs(pred-drawn)%Math.PI;if(d>Math.PI/2) d=Math.PI-d;
  return d*180/Math.PI;
}

/** Convex hull (Andrew monotone chain) of points. */
export function convexHull(pts:Pt[]):Pt[]{
  const p=[...pts].sort((a,b)=>a.x-b.x||a.y-b.y);
  if(p.length<3) return p;
  const cr=(o:Pt,a:Pt,b:Pt)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lo:Pt[]=[];for(const q of p){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0) lo.pop();lo.push(q);}
  const up:Pt[]=[];for(const q of [...p].reverse()){while(up.length>=2&&cr(up[up.length-2],up[up.length-1],q)<=0) up.pop();up.push(q);}
  lo.pop();up.pop();
  return [...lo,...up];
}

export function polygonArea(poly:Pt[]):number{
  let s=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];s+=a.x*b.y-b.x*a.y;}
  return Math.abs(s)/2;
}

export function pointInPolygon(p:Pt,poly:Pt[]):boolean{
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

/** Scale a convex polygon about its centroid. */
export function expandPolygon(poly:Pt[],factor:number):Pt[]{
  const cx=poly.reduce((s,p)=>s+p.x,0)/poly.length,cy=poly.reduce((s,p)=>s+p.y,0)/poly.length;
  return poly.map(p=>({x:cx+(p.x-cx)*factor,y:cy+(p.y-cy)*factor}));
}

/** Sutherland-Hodgman clip of a polygon to an axis-aligned rectangle (used to keep wall polygons inside the image). */
export function clipPolygonToRect(poly:Pt[],width:number,height:number):Pt[]{
  const edges:[(p:Pt)=>boolean,(a:Pt,b:Pt)=>Pt][]=[
    [p=>p.x>=0,(a,b)=>{const t=(0-a.x)/(b.x-a.x);return {x:0,y:a.y+t*(b.y-a.y)};}],
    [p=>p.x<=width,(a,b)=>{const t=(width-a.x)/(b.x-a.x);return {x:width,y:a.y+t*(b.y-a.y)};}],
    [p=>p.y>=0,(a,b)=>{const t=(0-a.y)/(b.y-a.y);return {x:a.x+t*(b.x-a.x),y:0};}],
    [p=>p.y<=height,(a,b)=>{const t=(height-a.y)/(b.y-a.y);return {x:a.x+t*(b.x-a.x),y:height};}]
  ];
  let out=poly;
  for(const [inside,hit] of edges){
    const inp=out;out=[];
    for(let i=0;i<inp.length;i++){
      const cur=inp[i],prev=inp[(i+inp.length-1)%inp.length];
      if(inside(cur)){if(!inside(prev)) out.push(hit(prev,cur));out.push(cur);}
      else if(inside(prev)) out.push(hit(prev,cur));
    }
    if(!out.length) break;
  }
  return out;
}
