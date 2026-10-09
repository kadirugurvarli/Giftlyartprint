import type {Pt,Quad,RawImage} from "@/lib/mockup-v3/types";
import {compositeOver,solidImage,warpToQuad} from "@/lib/mockup-v3/geometry/warp";
import {gaussianBlurPlane} from "@/lib/mockup-v3/vision/gray";
import {rasterizePolygons} from "@/lib/mockup-v3/vision/mask";
import {convexHull} from "@/lib/mockup-v3/vision/lines";
import {mulberry32} from "./fixtures";

const clamp8=(v:number)=>Math.max(0,Math.min(255,v));

function hash2(x:number,y:number,seed=0){
  let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(seed,2147483647))>>>0;
  h=(Math.imul(h^(h>>>13),1274126177))>>>0;
  return ((h^(h>>>16))>>>0)/4294967296;
}
function valueNoise(x:number,y:number,seed:number){
  const xi=Math.floor(x),yi=Math.floor(y);
  const fx=x-xi,fy=y-yi;
  const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const a=hash2(xi,yi,seed),b=hash2(xi+1,yi,seed),c=hash2(xi,yi+1,seed),d=hash2(xi+1,yi+1,seed);
  return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;
}

/** A painterly landscape so previews are easy to judge by eye. Synthetic: no real content. */
export function landscapeArt(w:number,h:number,seed=1):RawImage{
  const rnd=mulberry32(seed);
  const img=solidImage(w,h,[0,0,0,255]);
  const sunX=w*(0.25+rnd()*0.5),sunY=h*(0.28+rnd()*0.1);
  const ph1=rnd()*6,ph2=rnd()*6,ph3=rnd()*6;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const u=x/w,v=y/h;
      let r=mixc(250,120,v*1.4),g=mixc(200,160,v*1.4),b=mixc(150,210,v*1.4);
      const sd=Math.hypot(x-sunX,y-sunY)/(0.07*Math.min(w,h));
      const sun=Math.max(0,1-sd);
      r+=sun*80;g+=sun*60;b+=sun*10;
      const far=0.55+0.07*Math.sin(u*7+ph1)+0.03*Math.sin(u*19+ph2);
      const mid=0.66+0.06*Math.sin(u*5+ph2)+0.03*Math.sin(u*23+ph3);
      const near=0.80+0.05*Math.sin(u*3+ph3)+0.02*Math.sin(u*31+ph1);
      if(v>far){r=70+30*v;g=100+30*v;b=130-20*v;}
      if(v>mid){r=60;g=100+20*Math.sin(u*40)*0.3;b=70;}
      if(v>near){r=45+valueNoise(x/6,y/6,3)*20;g=75+valueNoise(x/5,y/5,4)*25;b=40;}
      const n=(valueNoise(x/2.5,y/2.5,seed)-0.5)*10;
      const o=(y*w+x)*4;
      img.data[o]=clamp8(r+n);img.data[o+1]=clamp8(g+n);img.data[o+2]=clamp8(b+n);
    }
  }
  return img;
}
const mixc=(a:number,b:number,t:number)=>a+(b-a)*Math.max(0,Math.min(1,t));

// ---------------------------------------------------------------------------------------------
// Room renderer (ray-traced box room, level camera with optional yaw/pitch)
// ---------------------------------------------------------------------------------------------

export type Camera={imgW:number;imgH:number;focalPx:number;yawDeg:number;pitchDeg:number;x:number;y:number};

export type RoomOptions={
  imgW:number;imgH:number;
  focalPx?:number;yawDeg?:number;pitchDeg?:number;camX?:number;camY?:number;
  wallColour?:[number,number,number];
  seed?:number;
  /** Light from the left (-1) or right (+1). */
  lightFrom?:"left"|"right";
};

export type Room={
  image:RawImage;
  camera:Camera;
  /** World point (x right, y down, z forward) to image pixel. */
  project:(X:number,Y:number,Z:number)=>Pt;
  /** Back wall plane metres (X in [-2.5,2.5], Y in [-1.4,1.2]) to image pixel. */
  wall:(X:number,Y:number)=>Pt;
  wallQuad:Quad;
  /** Wall z in metres. */
  wallZ:number;
};

const ROOM={xMin:-2.5,xMax:2.5,yTop:-1.4,yFloor:1.2,zBack:4.2};

export function renderRoom(o:RoomOptions):Room{
  const {imgW:W,imgH:H}=o;
  const cam:Camera={
    imgW:W,imgH:H,focalPx:o.focalPx ?? W*0.9,yawDeg:o.yawDeg ?? 0,pitchDeg:o.pitchDeg ?? 0,
    x:o.camX ?? 0,y:o.camY ?? 0
  };
  const yaw=cam.yawDeg*Math.PI/180,pit=cam.pitchDeg*Math.PI/180;
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pit),sp=Math.sin(pit);
  // camera->world: pitch about x then yaw about y
  const toWorld=(x:number,y:number,z:number):[number,number,number]=>{
    const y1=cp*y-sp*z,z1=sp*y+cp*z;
    return [cy*x+sy*z1,y1,-sy*x+cy*z1];
  };
  const toCam=(X:number,Y:number,Z:number):[number,number,number]=>{
    const x1=cy*X-sy*Z,z1=sy*X+cy*Z;
    return [x1,cp*Y+sp*z1,-sp*Y+cp*z1];
  };
  const project=(X:number,Y:number,Z:number):Pt=>{
    const [x,y,z]=toCam(X-cam.x,Y-cam.y,Z);
    return {x:cam.focalPx*x/z+W/2,y:cam.focalPx*y/z+H/2};
  };

  const wallC=o.wallColour ?? [226,218,204];
  const lightSign=o.lightFrom==="right"?1:-1;
  const seed=o.seed ?? 1;
  const planes:{axis:0|1|2;value:number;kind:"back"|"floor"|"ceil"|"left"|"right"}[]=[
    {axis:2,value:ROOM.zBack,kind:"back"},
    {axis:1,value:ROOM.yFloor,kind:"floor"},
    {axis:1,value:ROOM.yTop,kind:"ceil"},
    {axis:0,value:ROOM.xMin,kind:"left"},
    {axis:0,value:ROOM.xMax,kind:"right"}
  ];
  const chan=[new Float32Array(W*H),new Float32Array(W*H),new Float32Array(W*H)];

  for(let py=0;py<H;py++){
    for(let px=0;px<W;px++){
      const d=toWorld((px+0.5-W/2)/cam.focalPx,(py+0.5-H/2)/cam.focalPx,1);
      const org=[cam.x,cam.y,0];
      let bestT=Infinity,bestKind:string="",hit:[number,number,number]=[0,0,0];
      for(const p of planes){
        if(Math.abs(d[p.axis])<1e-9) continue;
        const t=(p.value-org[p.axis])/d[p.axis];
        if(t<=0 || t>=bestT) continue;
        const P:[number,number,number]=[org[0]+d[0]*t,org[1]+d[1]*t,org[2]+d[2]*t];
        const eps=1e-3;
        if(P[0]<ROOM.xMin-eps||P[0]>ROOM.xMax+eps||P[1]<ROOM.yTop-eps||P[1]>ROOM.yFloor+eps||P[2]<-eps||P[2]>ROOM.zBack+eps) continue;
        bestT=t;bestKind=p.kind;hit=P;
      }
      let r=0,g=0,b=0;
      if(bestKind){
        const [X,Y,Z]=hit;
        // light from a window on one side: brightness falls off across the room, plus slight top-down gradient
        const across=lightSign<0?(X-ROOM.xMin)/(ROOM.xMax-ROOM.xMin):(ROOM.xMax-X)/(ROOM.xMax-ROOM.xMin);
        let lum=1.04-0.16*across-0.05*((Y-ROOM.yTop)/(ROOM.yFloor-ROOM.yTop)-0.5);
        if(bestKind==="back"){
          const n=(valueNoise(X*60,Y*60,seed)-0.5)*5+(valueNoise(X*9,Y*9,seed+5)-0.5)*3;
          r=wallC[0]*lum+n;g=wallC[1]*lum+n;b=wallC[2]*lum+n;
          const sk=ROOM.yFloor-Y;
          if(sk<0.12){
            r=238*lum;g=234*lum;b=226*lum;
            if(sk>0.112){r*=0.78;g*=0.78;b*=0.78;} // shadow line under the skirting top
          }
        }else if(bestKind==="floor"){
          const plank=Math.floor(X/0.14);
          const jitter=(hash2(plank,0,seed)-0.5)*0.18;
          const grain=(valueNoise(X*30,Z*2.5,seed)-0.5)*0.12;
          const k=lum*0.78*(1+jitter+grain);
          const seam=Math.abs(((X/0.14)%1+1)%1-0.5)>0.485?0.75:1;
          r=150*k*seam;g=112*k*seam;b=78*k*seam;
        }else if(bestKind==="ceil"){
          r=244*lum*0.95;g=242*lum*0.95;b=238*lum*0.95;
        }else{
          const k=lum*0.82;
          r=wallC[0]*k;g=wallC[1]*k;b=wallC[2]*k;
        }
      }
      // vignette
      const vx=(px/W-0.5),vy=(py/H-0.5);
      const vig=1-0.16*(vx*vx+vy*vy)*4;
      const i=py*W+px;
      chan[0][i]=r*vig;chan[1][i]=g*vig;chan[2][i]=b*vig;
    }
  }
  const rnd=mulberry32(seed+77);
  const out=solidImage(W,H,[0,0,0,255]);
  const blurred=chan.map((c)=>gaussianBlurPlane(c,W,H,0.6));
  for(let i=0;i<W*H;i++){
    const n=(rnd()+rnd()+rnd()-1.5)*2.4;
    out.data[i*4]=clamp8(blurred[0][i]+n);
    out.data[i*4+1]=clamp8(blurred[1][i]+n);
    out.data[i*4+2]=clamp8(blurred[2][i]+n);
  }
  const wall=(X:number,Y:number)=>project(X,Y,ROOM.zBack);
  return {
    image:out,camera:cam,project,wall,wallZ:ROOM.zBack,
    wallQuad:[wall(ROOM.xMin,ROOM.yTop),wall(ROOM.xMax,ROOM.yTop),wall(ROOM.xMax,ROOM.yFloor),wall(ROOM.xMin,ROOM.yFloor)]
  };
}
export const ROOM_BOUNDS=ROOM;

// ---------------------------------------------------------------------------------------------
// Hanging a framed piece / photographing things
// ---------------------------------------------------------------------------------------------

function blurAlpha(alpha:Uint8Array,w:number,h:number,sigma:number){
  const f=new Float32Array(alpha.length);
  for(let i=0;i<alpha.length;i++) f[i]=alpha[i]/255;
  return gaussianBlurPlane(f,w,h,sigma);
}

/** Darken `base` under a (shifted, blurred) copy of `quad`. Fixture-only: independent of the engine's shadow code. */
export function castFixtureShadow(base:RawImage,quad:Quad,offset:Pt,sigma:number,strength:number):RawImage{
  const shifted=quad.map((p)=>({x:p.x+offset.x,y:p.y+offset.y}));
  const alpha=rasterizePolygons([shifted],base.width,base.height);
  const b=blurAlpha(alpha,base.width,base.height,sigma);
  const out=new Uint8ClampedArray(base.data);
  for(let i=0;i<base.width*base.height;i++){
    const k=1-strength*b[i];
    out[i*4]*=k;out[i*4+1]*=k;out[i*4+2]*=k;
  }
  return {width:base.width,height:base.height,data:out};
}

export function placeObject(bg:RawImage,obj:RawImage,quad:Quad,opts:{shadow?:{offset:Pt;sigma:number;strength:number};ambient?:number}={}){
  let base=bg;
  if(opts.shadow) base=castFixtureShadow(base,quad,opts.shadow.offset,opts.shadow.sigma,opts.shadow.strength);
  const layer=warpToQuad(obj,quad,bg.width,bg.height);
  if(opts.ambient && opts.ambient!==1){
    for(let i=0;i<bg.width*bg.height;i++){
      layer.data[i*4]=clamp8(layer.data[i*4]*opts.ambient);
      layer.data[i*4+1]=clamp8(layer.data[i*4+1]*opts.ambient);
      layer.data[i*4+2]=clamp8(layer.data[i*4+2]*opts.ambient);
    }
  }
  return compositeOver(base,layer);
}

/** Plain wall photo background with a soft lighting gradient (for product photos). */
export function plainBackground(w:number,h:number,colour:[number,number,number],seed=2,gradient=0.12):RawImage{
  const img=solidImage(w,h,[0,0,0,255]);
  const rnd=mulberry32(seed);
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const lum=1+gradient*(0.5-x/w)+gradient*0.6*(0.4-y/h);
      const n=(rnd()+rnd()-1)*2+(valueNoise(x/40,y/40,seed)-0.5)*3;
      const o=(y*w+x)*4;
      img.data[o]=clamp8(colour[0]*lum+n);img.data[o+1]=clamp8(colour[1]*lum+n);img.data[o+2]=clamp8(colour[2]*lum+n);
    }
  }
  return img;
}

/** Wooden table-like surface for flat-lay photos of unframed prints. */
export function tableBackground(w:number,h:number,seed=3):RawImage{
  const img=solidImage(w,h,[0,0,0,255]);
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const stripe=valueNoise(x/180,y/5,seed)*0.5+valueNoise(x/60,y/2.2,seed+1)*0.5;
      const lum=0.92+0.1*(0.5-y/h)+0.1*(stripe-0.5);
      const o=(y*w+x)*4;
      img.data[o]=clamp8(168*lum);img.data[o+1]=clamp8(128*lum);img.data[o+2]=clamp8(92*lum);
    }
  }
  return img;
}

export function lightingGradient(img:RawImage,strength:number,angleDeg:number):RawImage{
  const a=angleDeg*Math.PI/180,dx=Math.cos(a),dy=Math.sin(a);
  const out=new Uint8ClampedArray(img.data);
  for(let y=0;y<img.height;y++) for(let x=0;x<img.width;x++){
    const t=((x/img.width-0.5)*dx+(y/img.height-0.5)*dy);
    const k=1+strength*t;
    const o=(y*img.width+x)*4;
    out[o]*=k;out[o+1]*=k;out[o+2]*=k;
  }
  return {width:img.width,height:img.height,data:out};
}

export function addSensorNoise(img:RawImage,sigma:number,seed=5):RawImage{
  const rnd=mulberry32(seed);
  const out=new Uint8ClampedArray(img.data);
  for(let i=0;i<img.width*img.height;i++){
    const n=(rnd()+rnd()+rnd()-1.5)*2*sigma;
    out[i*4]+=n;out[i*4+1]+=n*0.9;out[i*4+2]+=n*1.1;
  }
  return {width:img.width,height:img.height,data:out};
}

// ---------------------------------------------------------------------------------------------
// Foreground occluder (manual-mask test subject)
// ---------------------------------------------------------------------------------------------

export function addPlant(base:RawImage,cx:number,cy:number,size:number,seed=9):{image:RawImage;maskPolygon:Pt[];alpha:Uint8Array}{
  const rnd=mulberry32(seed);
  const out=new Uint8ClampedArray(base.data);
  const leaves:{x:number;y:number;rx:number;ry:number;rot:number;tone:number}[]=[];
  for(let i=0;i<14;i++){
    const a=-Math.PI/2+(rnd()-0.5)*2.4;
    const len=size*(0.45+rnd()*0.55);
    leaves.push({x:cx+Math.cos(a)*len*0.45,y:cy+Math.sin(a)*len*0.45,rx:size*0.1,ry:len*0.5,rot:a+Math.PI/2,tone:rnd()});
  }
  const pts:Pt[]=[];
  for(const L of leaves){
    const cr=Math.cos(L.rot),sr=Math.sin(L.rot);
    for(let a=0;a<Math.PI*2;a+=Math.PI/10){
      pts.push({x:L.x+cr*Math.cos(a)*L.rx-sr*Math.sin(a)*L.ry,y:L.y+sr*Math.cos(a)*L.rx+cr*Math.sin(a)*L.ry});
    }
  }
  // pot
  const potW=size*0.28,potH=size*0.3;
  const potPoly:Pt[]=[{x:cx-potW,y:cy},{x:cx+potW,y:cy},{x:cx+potW*0.75,y:cy+potH},{x:cx-potW*0.75,y:cy+potH}];
  const potCov=rasterizePolygons([potPoly],base.width,base.height);
  const cover=new Float32Array(base.width*base.height);
  for(let i=0;i<potCov.length;i++){
    const a=potCov[i]/255;
    if(!a) continue;
    cover[i]=Math.max(cover[i],a);
    const x=i%base.width;
    const k=0.8+0.3*((x-(cx-potW))/(potW*2));
    out[i*4]=out[i*4]*(1-a)+168*k*a;out[i*4+1]=out[i*4+1]*(1-a)+92*k*a;out[i*4+2]=out[i*4+2]*(1-a)+66*k*a;
  }
  for(const L of leaves){
    const cr=Math.cos(L.rot),sr=Math.sin(L.rot);
    const R=Math.max(L.rx,L.ry)+2;
    for(let y=Math.max(0,Math.floor(L.y-R));y<Math.min(base.height,Math.ceil(L.y+R));y++){
      for(let x=Math.max(0,Math.floor(L.x-R));x<Math.min(base.width,Math.ceil(L.x+R));x++){
        const dx=x+0.5-L.x,dy=y+0.5-L.y;
        const u=(cr*dx+sr*dy)/L.rx,v=(-sr*dx+cr*dy)/L.ry;
        const d=u*u+v*v;
        if(d>1) continue;
        const edge=Math.min(1,(1-d)*6);
        const shade=0.55+0.45*(0.5+0.5*u)*(1-0.3*L.tone)+0.1*(-v);
        const o=(y*base.width+x)*4;
        cover[y*base.width+x]=Math.max(cover[y*base.width+x],edge);
        out[o]=out[o]*(1-edge)+(40+30*L.tone)*shade*edge;
        out[o+1]=out[o+1]*(1-edge)+(120+50*L.tone)*shade*edge;
        out[o+2]=out[o+2]*(1-edge)+(50+20*L.tone)*shade*edge;
      }
    }
  }
  const hull=convexHull([...pts,...potPoly]);
  const alpha=new Uint8Array(cover.length);
  for(let i=0;i<alpha.length;i++) alpha[i]=Math.round(Math.min(1,cover[i])*255);
  return {image:{width:base.width,height:base.height,data:out},maskPolygon:hull,alpha};
}

export function cornerError(a:Quad,b:Quad){
  return Math.max(...a.map((p,i)=>Math.hypot(p.x-b[i].x,p.y-b[i].y)));
}
