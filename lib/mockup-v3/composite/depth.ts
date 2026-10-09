import type {Pt,Quad,RawImage} from "../types";
import {homographyFromPoints,mulMat3} from "../geometry/homography";
import {compositeOver,solidImage} from "../geometry/warp";
import {rasterizePolygons} from "../vision/mask";
import {SRGB_TO_LINEAR,linearToSrgb8} from "./color";

type V3=[number,number,number];
const sub=(a:V3,b:V3):V3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a:V3,b:V3):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a:V3,k:number):V3=>[a[0]*k,a[1]*k,a[2]*k];
const dot=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(a:V3)=>Math.hypot(a[0],a[1],a[2]);

export type PlanePose={
  /** Camera-space 3D corners of the front face (TL,TR,BR,BL). */
  corners:[V3,V3,V3,V3];
  /** Unit normal pointing INTO the wall (away from the camera). */
  nIn:V3;
  /** In-plane unit axes (x along width, y along height). */
  ex:V3;ey:V3;
};

/**
 * Pose of a flat rectangle of known physical size from its image quad, for a pinhole camera with
 * focal length `f` (px) and the principal point at the image centre.
 */
export function planePoseFromQuad(quad:Quad,widthM:number,heightM:number,f:number,cx:number,cy:number):PlanePose|null{
  const Hm=homographyFromPoints([{x:0,y:0},{x:widthM,y:0},{x:widthM,y:heightM},{x:0,y:heightM}],quad);
  if(!Hm) return null;
  const Kinv:[number,number,number,number,number,number,number,number,number]=[1/f,0,-cx/f,0,1/f,-cy/f,0,0,1];
  const M=mulMat3(Kinv,Hm);
  const h3:V3=[M[2],M[5],M[8]];
  const c1:V3=[M[0],M[3],M[6]],c2:V3=[M[1],M[4],M[7]];
  const lambda=2/(norm(c1)+norm(c2));
  let r1=mul(c1,lambda),r2=mul(c2,lambda),t=mul(h3,lambda);
  if(t[2]<0){r1=mul(r1,-1);r2=mul(r2,-1);t=mul(t,-1);}
  const ex=mul(r1,1/norm(r1));
  // re-orthogonalise y against x
  let ey=sub(r2,mul(ex,dot(r2,ex)));ey=mul(ey,1/norm(ey));
  let n=cross(ex,ey);
  if(dot(n,t)<0) n=mul(n,-1);
  const corner=(X:number,Y:number):V3=>add(add(mul(r1,X),mul(r2,Y)),t);
  return {corners:[corner(0,0),corner(widthM,0),corner(widthM,heightM),corner(0,heightM)],nIn:n,ex,ey};
}

export type DepthFace={polygon:Pt[];side:"top"|"right"|"bottom"|"left";brightness:number};

/**
 * Visible side faces of a frame of depth `depthM` hanging flush to a wall. The placed quad is the
 * front face; the back edge sits `depthM` further from the camera. Only faces whose outward normal
 * points towards the camera are returned.
 */
export function depthFaces(quad:Quad,widthM:number,heightM:number,depthM:number,f:number,cx:number,cy:number,shadowDir:Pt):DepthFace[]{
  const pose=planePoseFromQuad(quad,widthM,heightM,f,cx,cy);
  if(!pose) return [];
  const proj=(p:V3):Pt=>({x:cx+f*p[0]/p[2],y:cy+f*p[1]/p[2]});
  const back=pose.corners.map((c)=>add(c,mul(pose.nIn,depthM))) as [V3,V3,V3,V3];
  const names:DepthFace["side"][]=["top","right","bottom","left"];
  const outward:V3[]=[mul(pose.ey,-1),pose.ex,pose.ey,mul(pose.ex,-1)];
  const faces:DepthFace[]=[];
  for(let i=0;i<4;i++){
    const a=pose.corners[i],b=pose.corners[(i+1)%4];
    const mid=mul(add(a,b),0.5);
    // visible when the outward normal faces the camera at the origin
    if(dot(outward[i],mul(mid,-1))<=0) continue;
    const poly=[proj(a),proj(b),proj(back[(i+1)%4]),proj(back[i])];
    const o=outward[i];
    const oImg=Math.hypot(o[0],o[1])||1;
    // faces pointing away from the light's shadow direction are lit: brightness 0.62..0.95
    const lit=-(o[0]/oImg*shadowDir.x+o[1]/oImg*shadowDir.y);
    faces.push({polygon:poly,side:names[i],brightness:0.78+0.17*Math.max(-1,Math.min(1,lit))});
  }
  return faces;
}

/** Mean colour of the outermost ring of an upright piece (the frame's outer edge). */
export function outerEdgeColour(piece:RawImage,ringFraction=0.015):[number,number,number]{
  const r=Math.max(2,Math.round(Math.min(piece.width,piece.height)*ringFraction));
  const s=[0,0,0];let n=0;
  for(let y=0;y<piece.height;y++) for(let x=0;x<piece.width;x++){
    if(x>=r&&y>=r&&x<piece.width-r&&y<piece.height-r) continue;
    for(let c=0;c<3;c++) s[c]+=SRGB_TO_LINEAR[piece.data[(y*piece.width+x)*4+c]];n++;
  }
  return [linearToSrgb8(s[0]/n),linearToSrgb8(s[1]/n),linearToSrgb8(s[2]/n)];
}

/**
 * Draw the side faces into a transparent layer (same size as the scene). The colour derives from the
 * frame's own outer edge, shaded by orientation relative to the light. These pixels are SYNTHESISED
 * (the photo never saw this side), so they are reported and can be disabled.
 */
export function renderDepthLayer(faces:DepthFace[],colour:[number,number,number],width:number,height:number):RawImage{
  let layer=solidImage(width,height,[0,0,0,0]);
  for(const f of faces){
    const cov=rasterizePolygons([f.polygon],width,height,4);
    const face=solidImage(width,height,[0,0,0,0]);
    const c=[0,1,2].map((k)=>linearToSrgb8(SRGB_TO_LINEAR[colour[k]]*f.brightness*f.brightness));
    for(let i=0;i<cov.length;i++) if(cov[i]){face.data[i*4]=c[0];face.data[i*4+1]=c[1];face.data[i*4+2]=c[2];face.data[i*4+3]=cov[i];}
    layer=compositeOver(layer,face);
  }
  return layer;
}
