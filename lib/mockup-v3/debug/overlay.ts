import type {Pt,Quad,RawImage} from "../types";
import {rasterizePolygons} from "../vision/mask";

function segmentPoly(a:Pt,b:Pt,t:number):Pt[]{
  const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;
  const nx=-dy/l*t/2,ny=dx/l*t/2;
  return [{x:a.x+nx,y:a.y+ny},{x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny},{x:a.x-nx,y:a.y-ny}];
}

export type Rgb=[number,number,number];

/** Draw anti-aliased polylines/quads on a copy of `img` (diagnostics only, never part of a mockup). */
export function drawOverlay(img:RawImage,items:{quad?:Quad;poly?:Pt[];line?:[Pt,Pt];colour:Rgb;thickness?:number;closed?:boolean}[]):RawImage{
  const out=new Uint8ClampedArray(img.data);
  for(const it of items){
    const t=it.thickness ?? 2;
    const polys:Pt[][]=[];
    const pts=it.quad?[...it.quad]:it.poly?it.poly:it.line?[...it.line]:[];
    const closed=it.closed ?? (!!it.quad);
    for(let i=0;i+1<pts.length;i++) polys.push(segmentPoly(pts[i],pts[i+1],t));
    if(closed && pts.length>2) polys.push(segmentPoly(pts[pts.length-1],pts[0],t));
    const cov=rasterizePolygons(polys,img.width,img.height,4);
    for(let i=0;i<cov.length;i++){
      const a=cov[i]/255;
      if(!a) continue;
      for(let c=0;c<3;c++) out[i*4+c]=Math.round(out[i*4+c]*(1-a)+it.colour[c]*a);
    }
  }
  return {width:img.width,height:img.height,data:out};
}

/** Side-by-side contact sheet with a thin neutral gutter. Same height required; images are scaled to `height`. */
export function sideBySide(images:RawImage[],height:number,gutter=12,bg:Rgb=[245,245,243]):RawImage{
  const scaled=images.map((im)=>{
    const s=height/im.height;
    const w=Math.round(im.width*s);
    const data=new Uint8ClampedArray(w*height*4);
    for(let y=0;y<height;y++){
      for(let x=0;x<w;x++){
        const sx=Math.min(im.width-1,Math.floor((x+0.5)/s)),sy=Math.min(im.height-1,Math.floor((y+0.5)/s));
        // area-average for downscales to keep previews crisp
        const x0=Math.max(0,Math.floor(x/s)),x1=Math.min(im.width,Math.max(x0+1,Math.ceil((x+1)/s)));
        const y0=Math.max(0,Math.floor(y/s)),y1=Math.min(im.height,Math.max(y0+1,Math.ceil((y+1)/s)));
        let r=0,g=0,b=0,n=0;
        if(s<1){
          for(let yy=y0;yy<y1;yy++) for(let xx=x0;xx<x1;xx++){const o=(yy*im.width+xx)*4;r+=im.data[o];g+=im.data[o+1];b+=im.data[o+2];n++;}
          r/=n;g/=n;b/=n;
        }else{const o=(sy*im.width+sx)*4;r=im.data[o];g=im.data[o+1];b=im.data[o+2];}
        const d=(y*w+x)*4;
        data[d]=r;data[d+1]=g;data[d+2]=b;data[d+3]=255;
      }
    }
    return {width:w,height,data};
  });
  const totalW=scaled.reduce((s,im)=>s+im.width,0)+gutter*(scaled.length+1);
  const out=new Uint8ClampedArray(totalW*(height+2*gutter)*4);
  for(let i=0;i<totalW*(height+2*gutter);i++){out[i*4]=bg[0];out[i*4+1]=bg[1];out[i*4+2]=bg[2];out[i*4+3]=255;}
  let x0=gutter;
  for(const im of scaled){
    for(let y=0;y<height;y++) for(let x=0;x<im.width;x++){
      const s=(y*im.width+x)*4,d=((y+gutter)*totalW+x0+x)*4;
      out[d]=im.data[s];out[d+1]=im.data[s+1];out[d+2]=im.data[s+2];out[d+3]=255;
    }
    x0+=im.width+gutter;
  }
  return {width:totalW,height:height+2*gutter,data:out};
}
