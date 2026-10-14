import type {Pt,Quad,RawImage} from "@/lib/mockup-v3/types";
import {solidImage} from "@/lib/mockup-v3/geometry/warp";

export function mulberry32(seed:number){
  let a=seed>>>0;
  return ()=>{
    a=(a+0x6d2b79f5)>>>0;
    let t=a;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

const smooth=(e0:number,e1:number,x:number)=>{
  const t=Math.max(0,Math.min(1,(x-e0)/(e1-e0)));
  return t*t*(3-2*t);
};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;

/**
 * Deterministic, artwork-like synthetic image: gradient, soft shapes, colour swatches,
 * medium-frequency stripes, a thin border and light grain. Contains no real/customer content.
 */
export function artworkPattern(width:number,height:number,seed=7):RawImage{
  const rnd=mulberry32(seed);
  const img=solidImage(width,height,[0,0,0,255]);
  const swatches:[number,number,number][]=[
    [196,57,48],[62,142,84],[48,92,171],[224,172,138],[128,128,128],[245,240,226]
  ];
  const circles=[0,1,2].map(()=>({
    x:rnd()*width,y:rnd()*height,r:(0.12+rnd()*0.12)*Math.min(width,height),
    c:[60+rnd()*160,60+rnd()*160,60+rnd()*160]
  }));

  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const u=x/width;
      const v=y/height;
      let r=mix(235,70,(u+v)/2);
      let g=mix(214,110,(u*0.6+v*0.4));
      let b=mix(178,150,v);

      for(const c of circles){
        const d=Math.hypot(x-c.x,y-c.y);
        const k=1-smooth(c.r-1.5,c.r+1.5,d);
        r=mix(r,c.c[0],k*0.85);g=mix(g,c.c[1],k*0.85);b=mix(b,c.c[2],k*0.85);
      }

      const stripe=Math.sin((x*0.9+y*0.5)/2.1)*0.5+0.5;
      const inStripeBand=v>0.62 && v<0.80;
      if(inStripeBand){
        const k=stripe*0.35;
        r=mix(r,30,k);g=mix(g,30,k);b=mix(b,40,k);
      }

      const sw=Math.floor(u*swatches.length);
      if(v>0.84 && v<0.96 && u>0.05 && u<0.95){
        const su=(u-0.05)/0.9;
        const s=swatches[Math.min(swatches.length-1,Math.floor(su*swatches.length))];
        r=s[0];g=s[1];b=s[2];
      }
      void sw;

      const bx=Math.min(x,width-1-x);
      const by=Math.min(y,height-1-y);
      const bd=Math.min(bx,by);
      if(bd>=4 && bd<6){r=25;g=25;b=25;}

      const n=(rnd()-0.5)*4;
      const o=(y*width+x)*4;
      img.data[o]=Math.max(0,Math.min(255,r+n));
      img.data[o+1]=Math.max(0,Math.min(255,g+n));
      img.data[o+2]=Math.max(0,Math.min(255,b+n));
    }
  }
  return img;
}

export function checkerboard(width:number,height:number,cell:number,a:[number,number,number]=[255,255,255],b:[number,number,number]=[0,0,0]):RawImage{
  const img=solidImage(width,height,[0,0,0,255]);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const c=((Math.floor(x/cell)+Math.floor(y/cell))%2===0)?a:b;
      const o=(y*width+x)*4;
      img.data[o]=c[0];img.data[o+1]=c[1];img.data[o+2]=c[2];
    }
  }
  return img;
}

export function wallScene(width:number,height:number):RawImage{
  const img=solidImage(width,height,[0,0,0,255]);
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const o=(y*width+x)*4;
      const g=Math.round(mix(214,186,y/height)-8*Math.sin(x/width*3));
      img.data[o]=g+6;img.data[o+1]=g+2;img.data[o+2]=g-6;
    }
  }
  return img;
}

export function tint(img:RawImage,dr:number,dg:number,db:number):RawImage{
  const out=new Uint8ClampedArray(img.data);
  for(let i=0;i<img.width*img.height;i++){
    out[i*4]+=dr;out[i*4+1]+=dg;out[i*4+2]+=db;
  }
  return {width:img.width,height:img.height,data:out};
}

export function crop(img:RawImage,x:number,y:number,w:number,h:number):RawImage{
  const out=new Uint8ClampedArray(w*h*4);
  for(let j=0;j<h;j++) for(let i=0;i<w;i++){
    const s=((y+j)*img.width+(x+i))*4;
    out.set(img.data.subarray(s,s+4),(j*w+i)*4);
  }
  return {width:w,height:h,data:out};
}

/** Pinhole camera projection of a world rectangle (centred, y down) for ground-truth quads. */
export function projectRect(args:{
  worldW:number;worldH:number;
  yawDeg:number;pitchDeg:number;rollDeg?:number;
  distance:number;focalPx:number;imgW:number;imgH:number;
  offset?:{x:number;y:number};
}):Quad{
  const d=Math.PI/180;
  const [cy,sy]=[Math.cos(args.yawDeg*d),Math.sin(args.yawDeg*d)];
  const [cp,sp]=[Math.cos(args.pitchDeg*d),Math.sin(args.pitchDeg*d)];
  const [cr,sr]=[Math.cos((args.rollDeg ?? 0)*d),Math.sin((args.rollDeg ?? 0)*d)];
  const hw=args.worldW/2;
  const hh=args.worldH/2;
  const corners:[number,number][]=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
  const pts=corners.map(([X,Y])=>{
    let x=X,y=Y,z=0;
    [x,z]=[cy*x+sy*z,-sy*x+cy*z];
    [y,z]=[cp*y-sp*z,sp*y+cp*z];
    [x,y]=[cr*x-sr*y,sr*x+cr*y];
    z+=args.distance;
    return {
      x:args.focalPx*x/z+args.imgW/2+(args.offset?.x ?? 0),
      y:args.focalPx*y/z+args.imgH/2+(args.offset?.y ?? 0)
    } as Pt;
  });
  return pts as Quad;
}
