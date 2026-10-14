import type {Pt,Quad} from "../types";
import {orderQuad,quadArea} from "../geometry/quad";

export type Line={a:number;b:number;c:number}; // a*x+b*y+c=0 with a^2+b^2=1

export function convexHull(points:Pt[]):Pt[]{
  const p=[...points].sort((u,v)=>u.x-v.x || u.y-v.y);
  const uniq:Pt[]=[];
  for(const q of p) if(!uniq.length || uniq[uniq.length-1].x!==q.x || uniq[uniq.length-1].y!==q.y) uniq.push(q);
  if(uniq.length<3) return uniq;
  const cross=(o:Pt,a:Pt,b:Pt)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower:Pt[]=[];
  for(const q of uniq){
    while(lower.length>=2 && cross(lower[lower.length-2],lower[lower.length-1],q)<=0) lower.pop();
    lower.push(q);
  }
  const upper:Pt[]=[];
  for(let i=uniq.length-1;i>=0;i--){
    const q=uniq[i];
    while(upper.length>=2 && cross(upper[upper.length-2],upper[upper.length-1],q)<=0) upper.pop();
    upper.push(q);
  }
  lower.pop();upper.pop();
  return lower.concat(upper);
}

export function polygonArea(poly:Pt[]){
  let s=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    s+=a.x*b.y-b.x*a.y;
  }
  return Math.abs(s)/2;
}

/** Visvalingam-Whyatt: drop the vertex whose triangle is smallest until `target` remain. */
export function simplifyPolygon(poly:Pt[],target:number):Pt[]{
  const pts=[...poly];
  while(pts.length>target){
    let best=-1,bestArea=Infinity;
    for(let i=0;i<pts.length;i++){
      const a=pts[(i+pts.length-1)%pts.length],b=pts[i],c=pts[(i+1)%pts.length];
      const area=Math.abs((b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y))/2;
      if(area<bestArea){bestArea=area;best=i;}
    }
    pts.splice(best,1);
  }
  return pts;
}

/**
 * Four-corner approximation of a convex hull by repeatedly extending the polygon outward:
 * after simplification, corners are re-estimated as intersections of the lines through the
 * original hull edges, so the quad encloses the hull instead of cutting corners.
 */
export function hullToQuad(hull:Pt[]):Quad|null{
  if(hull.length<4) return null;
  const four=simplifyPolygon(hull,4);
  return orderQuad(four);
}

export function lineThrough(p:Pt,q:Pt):Line|null{
  const dx=q.x-p.x,dy=q.y-p.y;
  const len=Math.hypot(dx,dy);
  if(len<1e-9) return null;
  const a=dy/len,b=-dx/len;
  return {a,b,c:-(a*p.x+b*p.y)};
}

export function lineIntersection(l1:Line,l2:Line):Pt|null{
  const det=l1.a*l2.b-l2.a*l1.b;
  if(Math.abs(det)<1e-9) return null;
  return {x:(l1.b*l2.c-l2.b*l1.c)/det,y:(l2.a*l1.c-l1.a*l2.c)/det};
}

export function distanceToLine(l:Line,p:Pt){
  return Math.abs(l.a*p.x+l.b*p.y+l.c);
}

/** Total-least-squares line through weighted points. */
export function fitLineTLS(points:Pt[],weights?:number[]):Line|null{
  if(points.length<2) return null;
  let sw=0,mx=0,my=0;
  points.forEach((p,i)=>{const w=weights?weights[i]:1;sw+=w;mx+=w*p.x;my+=w*p.y;});
  if(sw<=0) return null;
  mx/=sw;my/=sw;
  let sxx=0,sxy=0,syy=0;
  points.forEach((p,i)=>{
    const w=weights?weights[i]:1;
    const dx=p.x-mx,dy=p.y-my;
    sxx+=w*dx*dx;sxy+=w*dx*dy;syy+=w*dy*dy;
  });
  const theta=0.5*Math.atan2(2*sxy,sxx-syy);
  // direction (cos,sin); normal is perpendicular
  const a=-Math.sin(theta),b=Math.cos(theta);
  return {a,b,c:-(a*mx+b*my)};
}

/** Trimmed LS: fit, discard the worst fraction, refit; repeat. Returns line, inliers and RMS. */
export function robustLineFit(points:Pt[],opts:{iterations?:number;keep?:number;maxResidual?:number}={}){
  const iterations=opts.iterations ?? 4;
  let keep=opts.keep ?? 0.8;
  let set=points;
  let line=fitLineTLS(set);
  for(let it=0;it<iterations && line && set.length>=4;it++){
    const sorted=set.map((p)=>({p,d:distanceToLine(line!,p)})).sort((u,v)=>u.d-v.d);
    const n=Math.max(2,Math.floor(sorted.length*keep));
    set=sorted.slice(0,n).map((s)=>s.p);
    line=fitLineTLS(set);
    keep=Math.min(0.95,keep+0.05);
  }
  if(!line) return null;
  const maxR=opts.maxResidual ?? Infinity;
  const inliers=points.filter((p)=>distanceToLine(line!,p)<=maxR);
  const rms=Math.sqrt(inliers.reduce((s,p)=>s+distanceToLine(line!,p)**2,0)/Math.max(1,inliers.length));
  return {line,inliers,rms};
}

export function quadFromLines(top:Line,right:Line,bottom:Line,left:Line):Quad|null{
  const tl=lineIntersection(top,left),tr=lineIntersection(top,right);
  const br=lineIntersection(bottom,right),bl=lineIntersection(bottom,left);
  if(!tl||!tr||!br||!bl) return null;
  return [tl,tr,br,bl];
}

export const quadAreaOf=quadArea;

function mulberry(seed:number){
  let a=seed>>>0;
  return ()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}

/**
 * Reconstruct a quadrilateral from boundary samples by finding its four dominant straight
 * lines (sequential RANSAC) and intersecting them. Unlike corner-based simplification this is
 * indifferent to hidden or rounded corners: each visible stretch of edge simply votes.
 * Deterministic (fixed seed).
 */
export function quadFromBoundaryRansac(points:Pt[],opts:{inlierDist?:number;minInliers?:number;iterations?:number}={}):Quad|null{
  const d=opts.inlierDist ?? 1.1;
  const minIn=opts.minInliers ?? 12;
  const iters=opts.iterations ?? 400;
  const rnd=mulberry(12345);
  let rest=[...points];
  const found:{line:Line;pts:Pt[]}[]=[];
  for(let k=0;k<4;k++){
    if(rest.length<minIn) return null;
    let best:{line:Line;count:number}|null=null;
    for(let it=0;it<iters;it++){
      const a=rest[Math.floor(rnd()*rest.length)],b=rest[Math.floor(rnd()*rest.length)];
      if(Math.hypot(a.x-b.x,a.y-b.y)<6) continue;
      const l=lineThrough(a,b);
      if(!l) continue;
      let c=0;
      for(const p of rest) if(distanceToLine(l,p)<=d) c++;
      if(!best||c>best.count) best={line:l,count:c};
    }
    if(!best||best.count<minIn) return null;
    const inl=rest.filter((p)=>distanceToLine(best!.line,p)<=d*1.5);
    const fit=robustLineFit(inl,{keep:0.9,maxResidual:d});
    const line=fit?fit.line:best.line;
    found.push({line,pts:inl});
    rest=rest.filter((p)=>distanceToLine(line,p)>d*2.2);
  }
  // pair into two near-parallel families
  const ang=(l:Line)=>{const a=Math.atan2(-l.a,l.b);return ((a%Math.PI)+Math.PI)%Math.PI;};
  const angDiff=(x:number,y:number)=>{const d0=Math.abs(x-y);return Math.min(d0,Math.PI-d0);};
  const idx=[0,1,2,3];
  const pairings=[[[0,1],[2,3]],[[0,2],[1,3]],[[0,3],[1,2]]];
  let bestP=pairings[0],bestScore=Infinity;
  for(const pr of pairings){
    const within=angDiff(ang(found[pr[0][0]].line),ang(found[pr[0][1]].line))+angDiff(ang(found[pr[1][0]].line),ang(found[pr[1][1]].line));
    if(within<bestScore){bestScore=within;bestP=pr;}
  }
  void idx;
  const mean=(f:{pts:Pt[]})=>({x:f.pts.reduce((s,p)=>s+p.x,0)/f.pts.length,y:f.pts.reduce((s,p)=>s+p.y,0)/f.pts.length});
  const famA=bestP[0].map((i)=>found[i]),famB=bestP[1].map((i)=>found[i]);
  // the family whose lines run closer to horizontal is top/bottom
  const horiz=(f:typeof found)=>f.reduce((s,l)=>s+Math.min(ang(l.line),Math.PI-ang(l.line)),0)/f.length;
  const [tb,lr]=horiz(famA)<=horiz(famB)?[famA,famB]:[famB,famA];
  const [top,bottom]=mean(tb[0]).y<=mean(tb[1]).y?[tb[0],tb[1]]:[tb[1],tb[0]];
  const [left,right]=mean(lr[0]).x<=mean(lr[1]).x?[lr[0],lr[1]]:[lr[1],lr[0]];
  return quadFromLines(top.line,right.line,bottom.line,left.line);
}
