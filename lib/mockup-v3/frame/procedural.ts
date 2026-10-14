import type {RawImage} from "../types";
import {solidImage} from "../geometry/warp";

/**
 * Simple procedural frame: bevelled moulding + optional mount, lit from the top-left.
 * Intended for development, tests and the later "artwork-only -> framed" mode. Production
 * moulding profiles / templates from our real framing range plug in behind the same output
 * contract (an opaque upright image plus the geometry of each layer).
 */
export type FrameStyle={
  mouldingPx:number;
  mouldingColour:[number,number,number];
  mountPx:number;
  mountColour:[number,number,number];
  /** 0-1, strength of the bevel highlight/shadow. */
  bevel?:number;
  /** Grain amplitude in 8-bit levels. */
  grain?:number;
};

export type Rect={x:number;y:number;width:number;height:number};

export type FramedPiece={
  image:RawImage;
  /** Outer silhouette (whole image). */
  outer:Rect;
  /** Area visible through the mount window = where the artwork shows. */
  aperture:Rect;
  /** Inner edge of the moulding (outer edge of the mount). */
  mouldingInner:Rect;
};

const clamp8=(v:number)=>Math.max(0,Math.min(255,v));
const shade=(c:[number,number,number],k:number):[number,number,number]=>[clamp8(c[0]*k),clamp8(c[1]*k),clamp8(c[2]*k)];

function hash(x:number,y:number){
  let h=(x*374761393+y*668265263)>>>0;
  h=((h^(h>>>13))*1274126177)>>>0;
  return ((h^(h>>>16))>>>0)/4294967296;
}

/** Frame an artwork image. The artwork pixels are copied unchanged except for the mount's soft inner shadow. */
export function renderFramedPiece(art:RawImage,style:FrameStyle):FramedPiece{
  const m=style.mouldingPx,t=style.mountPx;
  const W=art.width+2*(m+t),H=art.height+2*(m+t);
  const img=solidImage(W,H,[0,0,0,255]);
  const bevel=style.bevel ?? 0.6;
  const grain=style.grain ?? 3;
  const put=(x:number,y:number,c:[number,number,number])=>{
    const o=(y*W+x)*4;
    img.data[o]=c[0];img.data[o+1]=c[1];img.data[o+2]=c[2];img.data[o+3]=255;
  };

  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const dl=x,dr=W-1-x,dt=y,db=H-1-y;
      const d=Math.min(dl,dr,dt,db);
      if(d<m){
        // which face of the moulding are we on? nearest side decides the bevel facing
        let k=1;
        const f=d/m; // 0 outer edge -> 1 inner edge
        const side=d===dt?"t":d===dl?"l":d===db?"b":"r";
        // two-zone bevel: outer flat face, inner sloped face
        const sloped=f>0.55;
        const base=sloped?1:0.94;
        const facing={t:1.18,l:1.08,b:0.78,r:0.86}[side];
        k=base*(1+(facing-1)*bevel*(sloped?1.4:0.55));
        if(d<=0.6) k*=1.12; // thin outer highlight
        if(f>0.93) k*=0.7;  // dark lip where moulding meets the mount
        const g=(hash(x,y)-0.5)*2*grain;
        const c=shade(style.mouldingColour,k);
        put(x,y,[clamp8(c[0]+g),clamp8(c[1]+g),clamp8(c[2]+g)]);
      }else if(d<m+t){
        const g=(hash(x*3,y*3)-0.5)*2*(grain*0.35);
        let k=1;
        const f=(d-m)/t;
        if(f>0.93) k=1.06; // bevel-cut edge of the mount window catches the light
        const side=d===dt?"t":d===dl?"l":d===db?"b":"r";
        if(f>0.93 && (side==="b"||side==="r")) k=0.9;
        put(x,y,shade(style.mountColour.map((v)=>clamp8(v+g)) as [number,number,number],k));
      }else{
        const ax=x-(m+t),ay=y-(m+t);
        const o=(ay*art.width+ax)*4;
        img.data[(y*W+x)*4]=art.data[o];
        img.data[(y*W+x)*4+1]=art.data[o+1];
        img.data[(y*W+x)*4+2]=art.data[o+2];
        img.data[(y*W+x)*4+3]=255;
      }
    }
  }

  // Soft shadow the mount casts onto the top/left of the artwork (depth of the mount board).
  const sh=Math.max(2,Math.round(Math.min(art.width,art.height)*0.012));
  for(let ay=0;ay<art.height;ay++){
    for(let ax=0;ax<art.width;ax++){
      const dTop=ay,dLeft=ax;
      const k=Math.max(0,1-dTop/sh)*0.28+Math.max(0,1-dLeft/sh)*0.2;
      if(k<=0) continue;
      const o=((ay+m+t)*W+(ax+m+t))*4;
      img.data[o]=img.data[o]*(1-k);
      img.data[o+1]=img.data[o+1]*(1-k);
      img.data[o+2]=img.data[o+2]*(1-k);
    }
  }

  return {
    image:img,
    outer:{x:0,y:0,width:W,height:H},
    mouldingInner:{x:m,y:m,width:W-2*m,height:H-2*m},
    aperture:{x:m+t,y:m+t,width:art.width,height:art.height}
  };
}
