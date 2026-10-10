import {describe,expect,it} from "vitest";
import {choosePxPerCm,FRAME_LIMITS,planFlatFrame,renderFlatFramedPiece,resizeArtwork,validateFrameSpec} from "@/lib/mockup-v3/rooms/product";
import {landscapeArt} from "../helpers/scenes";
import {ALL_SIZES,SPEC} from "../helpers/rooms";
import type {RawImage} from "@/lib/mockup-v3/types";

const lum=(img:RawImage,x:number,y:number)=>{const o=(y*img.width+x)*4;return 0.2126*img.data[o]+0.7152*img.data[o+1]+0.0722*img.data[o+2];};
const meanLum=(img:RawImage,x0:number,y0:number,x1:number,y1:number)=>{let s=0,n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){s+=lum(img,x,y);n++;}return s/n;};
const artFor=(w:number,h:number)=>landscapeArt(900,Math.round(900*h/w),3);

describe("flat artwork in a frame rendered in real units",()=>{
  it.each(ALL_SIZES.map(z=>[`${z.width}x${z.height}`,z]))("%s: exact outer size, window and mount; print scaled uniformly (never stretched or cropped)",(_n,z:any)=>{
    const art=artFor(z.width,z.height);
    const px=10;
    const p=planFlatFrame(SPEC(z.width,z.height),art,px);
    expect(p.ok).toBe(true);if(!p.ok) return;
    const {plan}=p;
    expect(plan.outer).toEqual({width:z.width*px,height:z.height*px}); // exact: integer px per cm
    expect(plan.mouldingPx).toBe(24);
    expect(plan.opening.width).toBe(z.width*px-48);
    // uniform scale: print proportions equal the artwork's within rounding
    expect(Math.abs(plan.print.width/plan.print.height/(art.width/art.height)-1)).toBeLessThan(0.006);
    // print + minimum mount fit inside the window; nothing is cropped
    expect(plan.print.x).toBeGreaterThanOrEqual(plan.opening.x+35);expect(plan.print.y).toBeGreaterThanOrEqual(plan.opening.y+35);
    expect(plan.print.x+plan.print.width).toBeLessThanOrEqual(plan.opening.x+plan.opening.width-35);
    expect(plan.print.y+plan.print.height).toBeLessThanOrEqual(plan.opening.y+plan.opening.height-35);
  });
  it("a small proportion difference becomes extra mount; a large one is refused",()=>{
    const slightly=planFlatFrame(SPEC(40,50),landscapeArt(900,1200,1),10); // 3:4 art in a 4:5 frame
    expect(slightly.ok).toBe(true);
    if(slightly.ok) expect(Math.max(slightly.plan.extraMountFraction.x,slightly.plan.extraMountFraction.y)).toBeGreaterThan(0.005);
    expect(planFlatFrame(SPEC(30,40),landscapeArt(1200,800,1),10)).toEqual({ok:false,error:"ARTWORK_ASPECT_TOO_DIFFERENT_FOR_FRAME"}); // landscape print, portrait frame
    expect(planFlatFrame(SPEC(40,30),landscapeArt(600,900,1),10)).toEqual({ok:false,error:"ARTWORK_ASPECT_TOO_DIFFERENT_FOR_FRAME"});
    expect(FRAME_LIMITS.minPrintFill).toBe(0.7);
  });
  it.each([
    ["outer size outside the approved set",SPEC(30,30),"FRAME_SIZE_OUT_OF_RANGE"],
    ["outer size too large",SPEC(90,120),"FRAME_SIZE_OUT_OF_RANGE"],
    ["no moulding",SPEC(30,40,{mouldingWidthCm:0}),"INVALID_FRAME_SPEC"],
    ["moulding absurdly wide",SPEC(30,40,{mouldingWidthCm:9}),"INVALID_FRAME_SPEC"],
    ["frame depth absurd",SPEC(30,40,{frameDepthCm:12}),"INVALID_FRAME_SPEC"],
    ["negative mount",SPEC(30,40,{mountWidthCm:-1}),"INVALID_FRAME_SPEC"],
    ["mount leaves no room for a print",SPEC(30,40,{mountWidthCm:9.5,mouldingWidthCm:5}),"INVALID_FRAME_SPEC"],
    ["colour out of range",SPEC(30,40,{mouldingColour:[300,0,0]}),"INVALID_FRAME_SPEC"],
    ["edge shadow beyond its cap",SPEC(30,40,{printEdgeShadow:0.9}),"INVALID_FRAME_SPEC"]
  ])("rejects: %s",(_n,spec,code)=>{
    expect(validateFrameSpec(spec as any)).toBe(code);
    expect(planFlatFrame(spec as any,landscapeArt(900,1200,1),10)).toEqual({ok:false,error:code});
  });
  it("pixels per cm is an integer, scaled to the wall and capped",()=>{
    expect(choosePxPerCm(3,80)).toBe(8);            // floor of 8 px/cm
    expect(choosePxPerCm(10,80)).toBe(20);
    expect(choosePxPerCm(100,80)).toBe(Math.floor(3000/80));
    expect(Number.isInteger(choosePxPerCm(2.37,60))).toBe(true);
  });

  it("the print inside the rendered piece is byte-identical to one Lanczos resample of the customer's artwork",async()=>{
    const art=artFor(30,40);
    const r=await renderFlatFramedPiece(art,SPEC(30,40),{x:0.5,y:0.87},10);
    const want=await resizeArtwork(art,r.plan.print.width,r.plan.print.height);
    let diff=0;
    for(let y=0;y<want.height;y++)for(let x=0;x<want.width;x++){
      const a=((y+r.plan.print.y)*r.image.width+(x+r.plan.print.x))*4,b=(y*want.width+x)*4;
      for(let c=0;c<3;c++) diff+=Math.abs(r.image.data[a+c]-want.data[b+c]);
    }
    expect(diff).toBe(0);
    expect(r.image.width).toBe(300);expect(r.image.height).toBe(400);
  });
  it("edge softening touches only the frame and mount, never a print pixel, and smooths hairline edges",async()=>{
    const art=artFor(30,40);
    const sharp=await renderFlatFramedPiece(art,SPEC(30,40),{x:0.5,y:0.87},10,0);
    const soft=await renderFlatFramedPiece(art,SPEC(30,40),{x:0.5,y:0.87},10,1.2);
    const pr=sharp.plan.print;let printDiff=0,frameDiff=0,maxStepSharp=0,maxStepSoft=0;
    for(let y=0;y<sharp.image.height;y++)for(let x=0;x<sharp.image.width;x++){
      const o=(y*sharp.image.width+x)*4;
      const inPrint=x>=pr.x&&x<pr.x+pr.width&&y>=pr.y&&y<pr.y+pr.height;
      const d=Math.abs(sharp.image.data[o]-soft.image.data[o])+Math.abs(sharp.image.data[o+1]-soft.image.data[o+1])+Math.abs(sharp.image.data[o+2]-soft.image.data[o+2]);
      if(inPrint) printDiff+=d;else frameDiff+=d;
    }
    // the step across the moulding/mount boundary (a hairline in the sharp render) gets gentler
    const row=Math.floor(sharp.image.height/2),m=sharp.plan.mouldingPx;
    for(let x=m-3;x<m+3;x++){maxStepSharp=Math.max(maxStepSharp,Math.abs(sharp.image.data[(row*sharp.image.width+x+1)*4]-sharp.image.data[(row*sharp.image.width+x)*4]));maxStepSoft=Math.max(maxStepSoft,Math.abs(soft.image.data[(row*soft.image.width+x+1)*4]-soft.image.data[(row*soft.image.width+x)*4]));}
    expect(printDiff).toBe(0);expect(frameDiff).toBeGreaterThan(1000);expect(maxStepSoft).toBeLessThan(maxStepSharp);
  });
  it("print edge shading is OFF by default, and when requested only ever darkens, only near the mount",async()=>{
    const art=artFor(30,40);
    const off=await renderFlatFramedPiece(art,SPEC(30,40),{x:0.5,y:0.87},10);
    const on=await renderFlatFramedPiece(art,SPEC(30,40,{printEdgeShadow:0.25}),{x:0.5,y:0.87},10);
    const pr=off.plan.print;let darker=0,brighter=0,changedFar=0;
    for(let y=pr.y;y<pr.y+pr.height;y++)for(let x=pr.x;x<pr.x+pr.width;x++){
      const o=(y*off.image.width+x)*4;
      const d=on.image.data[o]-off.image.data[o];
      if(d<0) darker++;else if(d>0) brighter++;
      const edge=Math.min(x-pr.x,pr.x+pr.width-1-x,y-pr.y,pr.y+pr.height-1-y);
      if(d!==0&&edge>8) changedFar++;
    }
    expect(darker).toBeGreaterThan(100);expect(brighter).toBe(0);expect(changedFar).toBe(0);
  });
});

describe("the frame is lit by the room's light",()=>{
  const sample=async(shadowDir:{x:number;y:number})=>{
    const r=await renderFlatFramedPiece(artFor(50,70),SPEC(50,70),shadowDir,10);
    const {image:im,plan}=r,m=plan.mouldingPx,W=im.width,H=im.height;
    const half=Math.floor(m/2);
    const mid=(a:number,b:number)=>Math.floor((a+b)/2);
    const cx=mid(0,W),cy=mid(0,H);
    return {
      // outer half of each side (slopes outwards), inner half (slopes inwards)
      topOuter:meanLum(im,cx-60,1,cx+60,half-1),bottomOuter:meanLum(im,cx-60,H-half+1,cx+60,H-1),
      leftOuter:meanLum(im,1,cy-60,half-1,cy+60),rightOuter:meanLum(im,W-half+1,cy-60,W-1,cy+60),
      topInner:meanLum(im,cx-60,half+2,cx+60,m-3),bottomInner:meanLum(im,cx-60,H-m+3,cx+60,H-half-2),
      mountTop:meanLum(im,cx-60,m+2,cx+60,m+6),mountBottom:meanLum(im,cx-60,H-m-6,cx+60,H-m-2),
      mountLeft:meanLum(im,m+2,cy-60,m+6,cy+60),mountRight:meanLum(im,W-m-6,cy-60,W-m-2,cy+60),
      cutTop:meanLum(im,cx-40,r.plan.print.y-3,cx+40,r.plan.print.y-1),cutBottom:meanLum(im,cx-40,r.plan.print.y+r.plan.print.height,cx+40,r.plan.print.y+r.plan.print.height+2)
    };
  };
  it("light from the top-left (shadows fall right/down): lit sides catch more light, shaded sides less",async()=>{
    const s=await sample({x:0.5,y:0.87});
    expect(s.topOuter).toBeGreaterThan(s.bottomOuter+4);
    expect(s.leftOuter).toBeGreaterThan(s.rightOuter+2);
    expect(s.bottomInner).toBeGreaterThan(s.topInner+4); // inner slope faces the opposite way
    expect(s.mountTop).toBeLessThan(s.mountBottom-3);    // rebate shadow of the moulding falls on the top/left of the mount
    expect(s.mountLeft).toBeLessThan(s.mountRight-3);
    expect(s.cutBottom).toBeGreaterThan(s.cutTop);        // bevel-cut window edge: lower edge faces the light
  });
  it("flipping the light flips every highlight (consistency, not a baked-in lighting direction)",async()=>{
    const a=await sample({x:0.5,y:0.87}),b=await sample({x:-0.5,y:-0.87});
    expect(b.topOuter).toBeLessThan(b.bottomOuter-4);
    expect(b.leftOuter).toBeLessThan(b.rightOuter-2);
    expect(b.mountTop).toBeGreaterThan(b.mountBottom+3);
    expect(Math.sign(a.topOuter-a.bottomOuter)).toBe(-Math.sign(b.topOuter-b.bottomOuter));
  });
  it("colours follow the spec (mount and moulding) within grain",async()=>{
    const r=await renderFlatFramedPiece(artFor(30,40),SPEC(30,40,{mouldingColour:[120,60,30],mountColour:[200,210,190]}),{x:0,y:1},10);
    const im=r.image;
    const m=meanLum(im,r.plan.opening.x+5,r.plan.print.y+40,r.plan.opening.x+25,r.plan.print.y+80);
    expect(Math.abs(m-(0.2126*200+0.7152*210+0.0722*190))).toBeLessThan(25);
  });
});
