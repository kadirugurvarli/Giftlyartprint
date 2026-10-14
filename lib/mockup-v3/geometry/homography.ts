import type {Mat3,Pt} from "../types";

export const IDENTITY:Mat3=[1,0,0,0,1,0,0,0,1];

/** Gaussian elimination with partial pivoting. Returns null when singular. */
export function solveLinear(a:number[][],b:number[]):number[]|null{
  const n=b.length;
  const m=a.map((row,i)=>[...row,b[i]]);
  for(let c=0;c<n;c++){
    let p=c;
    for(let r=c+1;r<n;r++) if(Math.abs(m[r][c])>Math.abs(m[p][c])) p=r;
    if(Math.abs(m[p][c])<1e-12) return null;
    [m[c],m[p]]=[m[p],m[c]];
    for(let r=c+1;r<n;r++){
      const f=m[r][c]/m[c][c];
      for(let k=c;k<=n;k++) m[r][k]-=f*m[c][k];
    }
  }
  const x=new Array<number>(n).fill(0);
  for(let r=n-1;r>=0;r--){
    let s=m[r][n];
    for(let k=r+1;k<n;k++) s-=m[r][k]*x[k];
    x[r]=s/m[r][r];
  }
  return x;
}

export function mulMat3(a:Mat3,b:Mat3):Mat3{
  const o=new Array<number>(9).fill(0);
  for(let r=0;r<3;r++){
    for(let c=0;c<3;c++){
      o[r*3+c]=a[r*3]*b[c]+a[r*3+1]*b[3+c]+a[r*3+2]*b[6+c];
    }
  }
  return o as Mat3;
}

export function invertMat3(m:Mat3):Mat3|null{
  const [a,b,c,d,e,f,g,h,i]=m;
  const A=e*i-f*h;
  const B=-(d*i-f*g);
  const C=d*h-e*g;
  const det=a*A+b*B+c*C;
  const scale=Math.max(...m.map(Math.abs),1e-300);
  if(!Number.isFinite(det) || Math.abs(det)<1e-12*scale*scale*scale) return null;
  const k=1/det;
  return [
    A*k,-(b*i-c*h)*k,(b*f-c*e)*k,
    B*k,(a*i-c*g)*k,-(a*f-c*d)*k,
    C*k,-(a*h-b*g)*k,(a*e-b*d)*k
  ];
}

export function applyHomography(H:Mat3,p:Pt):Pt|null{
  const w=H[6]*p.x+H[7]*p.y+H[8];
  if(!Number.isFinite(w) || Math.abs(w)<1e-12) return null;
  return {
    x:(H[0]*p.x+H[1]*p.y+H[2])/w,
    y:(H[3]*p.x+H[4]*p.y+H[5])/w
  };
}

/** Hartley normalisation: centroid at origin, mean distance sqrt(2). */
function normaliser(pts:Pt[]):Mat3|null{
  const cx=pts.reduce((s,p)=>s+p.x,0)/pts.length;
  const cy=pts.reduce((s,p)=>s+p.y,0)/pts.length;
  const d=pts.reduce((s,p)=>s+Math.hypot(p.x-cx,p.y-cy),0)/pts.length;
  if(!(d>1e-9)) return null;
  const s=Math.SQRT2/d;
  return [s,0,-s*cx,0,s,-s*cy,0,0,1];
}

/** True when any three of the points are (nearly) collinear. */
export function hasCollinearTriple(pts:Pt[],relTol=1e-6):boolean{
  const n=pts.length;
  let span=0;
  for(const p of pts) for(const q of pts) span=Math.max(span,Math.hypot(p.x-q.x,p.y-q.y));
  if(span===0) return true;
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) for(let k=j+1;k<n;k++){
    const cr=(pts[j].x-pts[i].x)*(pts[k].y-pts[i].y)-(pts[j].y-pts[i].y)*(pts[k].x-pts[i].x);
    if(Math.abs(cr)<relTol*span*span) return true;
  }
  return false;
}

/**
 * Homography H with dst ~ H * src from exactly four point pairs (normalised DLT).
 * Returns null for degenerate input (collinear points, coincident points).
 */
export function homographyFromPoints(src:Pt[],dst:Pt[]):Mat3|null{
  if(src.length!==4 || dst.length!==4) return null;
  if(hasCollinearTriple(src) || hasCollinearTriple(dst)) return null;
  const Ts=normaliser(src);
  const Td=normaliser(dst);
  if(!Ts || !Td) return null;

  const rows:number[][]=[];
  const rhs:number[]=[];
  for(let i=0;i<4;i++){
    const x=Ts[0]*src[i].x+Ts[2];
    const y=Ts[4]*src[i].y+Ts[5];
    const u=Td[0]*dst[i].x+Td[2];
    const v=Td[4]*dst[i].y+Td[5];
    rows.push([x,y,1,0,0,0,-u*x,-u*y]);
    rhs.push(u);
    rows.push([0,0,0,x,y,1,-v*x,-v*y]);
    rhs.push(v);
  }
  const h=solveLinear(rows,rhs);
  if(!h) return null;
  const Hn:Mat3=[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1];
  const TdInv=invertMat3(Td);
  if(!TdInv) return null;
  const H=mulMat3(mulMat3(TdInv,Hn),Ts);
  if(!H.every(Number.isFinite) || Math.abs(H[8])<1e-12) return null;
  const k=1/H[8];
  return H.map((v)=>v*k) as Mat3;
}
