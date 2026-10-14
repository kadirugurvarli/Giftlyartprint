import type {Pt} from "../types";
import type {Mask} from "./gray";
import {gaussianBlurPlane} from "./gray";

export function newMask(width:number,height:number,fill=0):Mask{
  return {width,height,data:new Uint8Array(width*height).fill(fill)};
}

export type Component={
  label:number;
  area:number;
  minX:number;minY:number;maxX:number;maxY:number;
  touchesBorder:boolean;
  cx:number;cy:number;
};

/** 4-connected components of the set pixels. */
export function connectedComponents(mask:Mask):{labels:Int32Array;components:Component[]}{
  const {width:w,height:h,data}=mask;
  const labels=new Int32Array(w*h).fill(-1);
  const components:Component[]=[];
  const stack:number[]=[];
  for(let start=0;start<w*h;start++){
    if(!data[start] || labels[start]!==-1) continue;
    const label=components.length;
    const comp:Component={label,area:0,minX:w,minY:h,maxX:-1,maxY:-1,touchesBorder:false,cx:0,cy:0};
    let sx=0,sy=0;
    stack.push(start);
    labels[start]=label;
    while(stack.length){
      const i=stack.pop()!;
      const x=i%w,y=(i-x)/w;
      comp.area++;
      sx+=x;sy+=y;
      if(x<comp.minX) comp.minX=x;
      if(x>comp.maxX) comp.maxX=x;
      if(y<comp.minY) comp.minY=y;
      if(y>comp.maxY) comp.maxY=y;
      if(x===0 || y===0 || x===w-1 || y===h-1) comp.touchesBorder=true;
      if(x>0 && data[i-1] && labels[i-1]===-1){labels[i-1]=label;stack.push(i-1);}
      if(x<w-1 && data[i+1] && labels[i+1]===-1){labels[i+1]=label;stack.push(i+1);}
      if(y>0 && data[i-w] && labels[i-w]===-1){labels[i-w]=label;stack.push(i-w);}
      if(y<h-1 && data[i+w] && labels[i+w]===-1){labels[i+w]=label;stack.push(i+w);}
    }
    comp.cx=sx/comp.area;comp.cy=sy/comp.area;
    components.push(comp);
  }
  return {labels,components};
}

/** Fill background regions that do not connect to the image border. */
export function fillHoles(mask:Mask):Mask{
  const {width:w,height:h}=mask;
  const inv:Mask={width:w,height:h,data:new Uint8Array(w*h)};
  for(let i=0;i<w*h;i++) inv.data[i]=mask.data[i]?0:1;
  const {labels,components}=connectedComponents(inv);
  const out=new Uint8Array(mask.data);
  for(let i=0;i<w*h;i++){
    if(!mask.data[i] && !components[labels[i]].touchesBorder) out[i]=1;
  }
  return {width:w,height:h,data:out};
}

/** Square-structuring-element morphology (separable). */
function morph(mask:Mask,r:number,mode:"dilate"|"erode"):Mask{
  if(r<=0) return mask;
  const {width:w,height:h}=mask;
  const want=mode==="dilate"?1:0;
  const pass=(src:Uint8Array,horizontal:boolean)=>{
    const out=new Uint8Array(src.length);
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        let hit=false;
        for(let i=-r;i<=r;i++){
          const xx=horizontal?x+i:x;
          const yy=horizontal?y:y+i;
          const v=(xx<0||yy<0||xx>=w||yy>=h)?(mode==="erode"?0:0):src[yy*w+xx];
          if(v===want){hit=true;break;}
        }
        out[y*w+x]=mode==="dilate"?(hit?1:0):(hit?0:1);
      }
    }
    return out;
  };
  return {width:w,height:h,data:pass(pass(mask.data,true),false)};
}
export const dilate=(m:Mask,r:number)=>morph(m,r,"dilate");
export const erode=(m:Mask,r:number)=>morph(m,r,"erode");
export const openMask=(m:Mask,r:number)=>dilate(erode(m,r),r);
export const closeMask=(m:Mask,r:number)=>erode(dilate(m,r),r);

export function maskArea(m:Mask){
  let n=0;
  for(let i=0;i<m.data.length;i++) n+=m.data[i];
  return n;
}

/**
 * Anti-aliased polygon coverage (even-odd), 0-255 per pixel. Exact horizontally, `vSamples`
 * sub-scanlines vertically. Works for concave polygons and for masks drawn by hand.
 */
export function rasterizePolygons(polys:Pt[][],width:number,height:number,vSamples=8):Uint8Array{
  const acc=new Float32Array(width*height);
  for(const poly of polys){
    if(poly.length<3) continue;
    let minY=Infinity,maxY=-Infinity;
    for(const p of poly){minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    const y0=Math.max(0,Math.floor(minY));
    const y1=Math.min(height-1,Math.ceil(maxY));
    for(let y=y0;y<=y1;y++){
      for(let s=0;s<vSamples;s++){
        const sy=y+(s+0.5)/vSamples;
        const xs:number[]=[];
        for(let i=0;i<poly.length;i++){
          const a=poly[i],b=poly[(i+1)%poly.length];
          if((a.y<=sy && b.y>sy) || (b.y<=sy && a.y>sy)){
            xs.push(a.x+(sy-a.y)/(b.y-a.y)*(b.x-a.x));
          }
        }
        xs.sort((p,q)=>p-q);
        for(let k=0;k+1<xs.length;k+=2){
          const xa=Math.max(0,xs[k]),xb=Math.min(width,xs[k+1]);
          if(xb<=xa) continue;
          const ia=Math.floor(xa),ib=Math.min(width-1,Math.floor(xb));
          for(let x=ia;x<=ib;x++){
            const l=Math.max(xa,x),r=Math.min(xb,x+1);
            if(r>l) acc[y*width+x]+=(r-l)/vSamples;
          }
        }
      }
    }
  }
  const out=new Uint8Array(width*height);
  for(let i=0;i<out.length;i++) out[i]=Math.round(Math.min(1,acc[i])*255);
  return out;
}

/** Soften a 0-255 alpha plane. */
export function featherAlpha(alpha:Uint8Array,width:number,height:number,sigma:number):Uint8Array{
  if(sigma<=0) return alpha;
  const f=new Float32Array(alpha.length);
  for(let i=0;i<alpha.length;i++) f[i]=alpha[i];
  const b=gaussianBlurPlane(f,width,height,sigma);
  const out=new Uint8Array(alpha.length);
  for(let i=0;i<out.length;i++) out[i]=Math.max(0,Math.min(255,Math.round(b[i])));
  return out;
}
