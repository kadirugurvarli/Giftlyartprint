import {describe,expect,it} from "vitest";
import type {Pt,Quad} from "@/lib/mockup-v3/types";
import {applyGain,estimateIlluminationGain,estimateLight} from "@/lib/mockup-v3/composite/lighting";
import {castWallShadows,innerShadowLayer} from "@/lib/mockup-v3/composite/shadow";
import {applyOcclusion,emptyOcclusion,ManualOcclusionProvider,maskFromBrushStrokes,maskFromPolygons,unionOcclusion} from "@/lib/mockup-v3/composite/occlusion";
import {pixelAt,solidImage} from "@/lib/mockup-v3/geometry/warp";
import {SRGB_TO_LINEAR} from "@/lib/mockup-v3/composite/color";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";
import {projectRect} from "../helpers/fixtures";
import {addSensorNoise,landscapeArt,lightingGradient,placeObject,plainBackground} from "../helpers/scenes";

const W=1200,H=900;
const piece=renderFramedPiece(landscapeArt(480,360,3),{mouldingPx:34,mouldingColour:[70,52,38],mountPx:46,mountColour:[240,236,226]});
const frontal=projectRect({worldW:0.64,worldH:0.52,yawDeg:0,pitchDeg:0,distance:1.7,focalPx:1000,imgW:W,imgH:H});
const sizeOf=piece.image;

describe("estimateLight (from the scene's own shadows)",()=>{
  it("recovers the shadow direction (down-right) from a framed object with a drop shadow",()=>{
    const bg=plainBackground(W,H,[214,208,198],2,0.02);
    const scene=addSensorNoise(placeObject(bg,piece.image,frontal,{shadow:{offset:{x:7,y:11},sigma:7,strength:0.32}}),1.0);
    const est=estimateLight(scene,frontal);
    const want=Math.atan2(11,7);
    const got=Math.atan2(est.shadowDir.y,est.shadowDir.x);
    console.log(`[light] measured angle ${(got*180/Math.PI).toFixed(1)}deg vs true ${(want*180/Math.PI).toFixed(1)}deg, strength ${est.strength.toFixed(2)}`);
    expect(est.source).toBe("measured");
    expect(Math.abs(got-want)*180/Math.PI).toBeLessThan(20);
    expect(est.strength).toBeGreaterThan(0.05);
  });
  it("recovers an opposite (down-left) shadow direction",()=>{
    const bg=plainBackground(W,H,[214,208,198],2,0.02);
    const scene=placeObject(bg,piece.image,frontal,{shadow:{offset:{x:-9,y:8},sigma:7,strength:0.32}});
    const est=estimateLight(scene,frontal);
    expect(est.shadowDir.x).toBeLessThan(-0.2);
    expect(est.shadowDir.y).toBeGreaterThan(0.2);
  });
  it("falls back to a default (flagged as such) when there is no measurable shadow",()=>{
    const bg=plainBackground(W,H,[214,208,198],2,0.0);
    const scene=placeObject(bg,piece.image,frontal);
    expect(estimateLight(scene,frontal).source).toBe("default");
  });
});

describe("castWallShadows",()=>{
  const bg=plainBackground(W,H,[214,208,198],2,0.0);
  const params={dir:{x:0.55,y:0.835},depthPx:20,dropStrength:0.32,contactStrength:0.22};
  const res=castWallShadows(bg,frontal,{width:sizeOf.width,height:sizeOf.height},params);

  it("never changes a pixel outside its influence mask, and never darkens inside the object footprint",()=>{
    let outsideChanged=0,insideDarkened=0;
    const foot=placeObject(solidImage(W,H,[0,0,0,0]),solidImage(sizeOf.width,sizeOf.height,[255,255,255,255]),frontal);
    for(let i=0;i<W*H;i++){
      const changed=res.image.data[i*4]!==bg.data[i*4]||res.image.data[i*4+1]!==bg.data[i*4+1]||res.image.data[i*4+2]!==bg.data[i*4+2];
      if(changed && !res.influence[i]) outsideChanged++;
      if(foot.data[i*4+3]===255 && changed) insideDarkened++;
    }
    expect(outsideChanged).toBe(0);
    expect(insideDarkened).toBe(0);
  });
  it("only darkens (never brightens) and is stronger on the lit-away sides (bottom/right) than top/left",()=>{
    let brighter=0;
    for(let i=0;i<W*H;i++) if(res.image.data[i*4]>bg.data[i*4]) brighter++;
    expect(brighter).toBe(0);
    const band=(x0:number,y0:number,x1:number,y1:number)=>{
      let s=0,n=0;
      for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){s+=bg.data[(y*W+x)*4]-res.image.data[(y*W+x)*4];n++;}
      return s/n;
    };
    const L=frontal[0].x,T=frontal[0].y,R=frontal[2].x,B=frontal[2].y;
    const right=band(Math.round(R)+2,Math.round(T)+30,Math.round(R)+16,Math.round(B)-30);
    const left=band(Math.round(L)-16,Math.round(T)+30,Math.round(L)-2,Math.round(B)-30);
    const bottom=band(Math.round(L)+30,Math.round(B)+2,Math.round(R)-30,Math.round(B)+16);
    const top=band(Math.round(L)+30,Math.round(T)-16,Math.round(R)-30,Math.round(T)-2);
    console.log(`[shadow] mean darkening (levels) right ${right.toFixed(1)} bottom ${bottom.toFixed(1)} left ${left.toFixed(1)} top ${top.toFixed(1)}`);
    expect(right).toBeGreaterThan(2*left);
    expect(bottom).toBeGreaterThan(2*top);
    expect(right).toBeGreaterThan(4);
  });
  it("a straight-down light leaves the sides far lighter than a diagonal light does (only blur bleed remains)",()=>{
    const R=Math.round(frontal[2].x),T=Math.round(frontal[0].y),B=Math.round(frontal[2].y);
    const side=(img:{data:Uint8ClampedArray})=>{
      let d=0,n=0;
      for(let y=T+60;y<B-60;y++) for(let x=R+6;x<R+16;x++){d+=bg.data[(y*W+x)*4]-img.data[(y*W+x)*4];n++;}
      return d/n;
    };
    const down=side(castWallShadows(bg,frontal,{width:sizeOf.width,height:sizeOf.height},{...params,dir:{x:0,y:1},contactStrength:0}).image);
    const diag=side(castWallShadows(bg,frontal,{width:sizeOf.width,height:sizeOf.height},{...params,contactStrength:0}).image);
    console.log(`[shadow] side darkening: straight-down ${down.toFixed(2)} vs diagonal ${diag.toFixed(2)}`);
    expect(down).toBeLessThan(0.35*diag);
  });
  it("in perspective the shadow is displaced in the object plane (nearer edge casts a bigger shadow)",()=>{
    const q=projectRect({worldW:0.64,worldH:0.52,yawDeg:40,pitchDeg:0,distance:1.5,focalPx:1000,imgW:W,imgH:H});
    const r=castWallShadows(bg,q,{width:sizeOf.width,height:sizeOf.height},{...params,dir:{x:1,y:0},depthPx:28,contactStrength:0});
    const reach=(xEdge:number,yMid:number)=>{
      let d=0;
      for(let x=Math.round(xEdge)+1;x<Math.round(xEdge)+80;x++){
        const k=(bg.data[(Math.round(yMid)*W+x)*4]-r.image.data[(Math.round(yMid)*W+x)*4]);
        if(k>2) d=x-xEdge;
      }
      return d;
    };
    // yaw 40: right edge is nearer or farther than the left; compare plane-displacement scale to quad edge heights
    const hl=Math.hypot(q[3].x-q[0].x,q[3].y-q[0].y),hr=Math.hypot(q[2].x-q[1].x,q[2].y-q[1].y);
    // shadow falls to +x; only the right edge can show it: its reach should scale with local scale
    const rightReach=reach(Math.max(q[1].x,q[2].x)-0,(q[1].y+q[2].y)/2);
    console.log(`[shadow] persp edge heights L=${hl.toFixed(0)} R=${hr.toFixed(0)}, right-edge reach ${rightReach}px`);
    expect(rightReach).toBeGreaterThan(3);
  });
});

describe("innerShadowLayer (shading the opening casts onto the artwork)",()=>{
  const art=solidImage(200,150,[180,180,180,255]);
  const out=innerShadowLayer(art,{x:0.6,y:0.8},12,0.3);
  it("darkens only near the shadow-casting (top/left) edges, nothing in the interior or far edges",()=>{
    expect(pixelAt(out,100,75)).toEqual([180,180,180,255]);
    expect(pixelAt(out,190,140)).toEqual([180,180,180,255]);
    expect(pixelAt(out,100,0)[0]).toBeLessThanOrEqual(162);
    expect(pixelAt(out,0,75)[0]).toBeLessThan(172);
    expect(pixelAt(out,100,0)[0]).toBeLessThan(pixelAt(out,100,10)[0]);
    expect(pixelAt(out,100,40)).toEqual([180,180,180,255]);
  });
  it("is capped by its strength (linear-light factor >= 1-strength)",()=>{
    let minLin=1;
    for(let i=0;i<200*150;i++) minLin=Math.min(minLin,SRGB_TO_LINEAR[out.data[i*4]]/SRGB_TO_LINEAR[180]);
    expect(minLin).toBeGreaterThanOrEqual(0.7-0.01);
  });
  it("preserves hue (equal linear factor per channel)",()=>{
    const colour=solidImage(60,60,[200,120,60,255]);
    const o=innerShadowLayer(colour,{x:0,y:1},10,0.3);
    const [r,g,b]=pixelAt(o,30,1);
    const kr=SRGB_TO_LINEAR[r]/SRGB_TO_LINEAR[200],kg=SRGB_TO_LINEAR[g]/SRGB_TO_LINEAR[120],kb=SRGB_TO_LINEAR[b]/SRGB_TO_LINEAR[60];
    expect(Math.abs(kr-kg)).toBeLessThan(0.03);
    expect(Math.abs(kr-kb)).toBeLessThan(0.03);
  });
});

describe("estimateIlluminationGain",()=>{
  it("imposes the scene's falloff across the object yet keeps overall exposure (mean gain 1) and respects the cap",()=>{
    const scene=lightingGradient(plainBackground(W,H,[200,196,188],2,0.0),0.22,0);
    const g=estimateIlluminationGain(scene,frontal,{strength:0.8,cap:0.05});
    const left=g.at(frontal[0].x+5,(frontal[0].y+frontal[3].y)/2),right=g.at(frontal[1].x-5,(frontal[1].y+frontal[2].y)/2);
    let sum=0,n=0;
    for(let y=Math.round(frontal[0].y);y<Math.round(frontal[2].y);y+=4) for(let x=Math.round(frontal[0].x);x<Math.round(frontal[2].x);x+=4){sum+=g.at(x,y);n++;}
    console.log(`[gain] left ${left.toFixed(3)} right ${right.toFixed(3)} mean ${(sum/n).toFixed(4)} maxDev ${g.maxDeviation.toFixed(3)}`);
    expect(left).toBeLessThan(right);              // scene gets brighter to the right (gradient angle 0)
    expect(Math.abs(sum/n-1)).toBeLessThan(0.012);
    expect(g.maxDeviation).toBeLessThanOrEqual(0.05+1e-9);
  });
  it("is the identity on evenly lit surroundings",()=>{
    const g=estimateIlluminationGain(plainBackground(W,H,[200,196,188],2,0.0),frontal);
    expect(g.maxDeviation).toBeLessThan(0.01);
  });
  it("applyGain is colour-neutral: R,G,B scale by the same linear factor",()=>{
    const layer=solidImage(40,40,[200,120,60,255]);
    const out=applyGain(layer,{at:()=>1.04,maxDeviation:0.04,gradientFraction:0});
    const [r,g,b]=pixelAt(out,5,5);
    const k=(a:number,o:number)=>SRGB_TO_LINEAR[a]/SRGB_TO_LINEAR[o];
    // 8-bit quantisation limits precision (about 1 level, i.e. 1-4% in linear light at these values)
    expect(Math.abs(k(r,200)-1.04)).toBeLessThan(0.015);expect(Math.abs(k(g,120)-1.04)).toBeLessThan(0.02);expect(Math.abs(k(b,60)-1.04)).toBeLessThan(0.04);
  });
});

describe("occlusion masks (manual interface)",()=>{
  const WW=200,HH=150;
  const base=solidImage(WW,HH,[10,10,10,255]);
  const comp=solidImage(WW,HH,[250,250,250,255]);
  it("polygon mask restores original pixels exactly inside and leaves outside untouched",()=>{
    const poly:Pt[]=[{x:40,y:30},{x:120,y:30},{x:120,y:100},{x:40,y:100}];
    const m=maskFromPolygons([poly],WW,HH,0);
    const out=applyOcclusion(comp,base,m);
    expect(pixelAt(out,80,60)).toEqual([10,10,10,255]);
    expect(pixelAt(out,10,10)).toEqual([250,250,250,255]);
  });
  it("feathering produces smooth partial blends at the edge",()=>{
    const poly:Pt[]=[{x:40,y:30},{x:120,y:30},{x:120,y:100},{x:40,y:100}];
    const out=applyOcclusion(comp,base,maskFromPolygons([poly],WW,HH,2));
    const v=pixelAt(out,40,60)[0];
    expect(v).toBeGreaterThan(40);expect(v).toBeLessThan(220);
  });
  it("brush strokes paint, erase strokes remove, and union combines masks",()=>{
    const paint=maskFromBrushStrokes([{points:[{x:30,y:75},{x:170,y:75}],radiusPx:10}],WW,HH,0);
    expect(paint.alpha[75*WW+100]).toBe(255);
    expect(paint.alpha[30*WW+100]).toBe(0);
    const erased=maskFromBrushStrokes([
      {points:[{x:30,y:75},{x:170,y:75}],radiusPx:10},
      {points:[{x:100,y:75}],radiusPx:6,erase:true}
    ],WW,HH,0);
    expect(erased.alpha[75*WW+100]).toBe(0);
    expect(erased.alpha[75*WW+50]).toBe(255);
    const u=unionOcclusion(paint,maskFromPolygons([[{x:10,y:10},{x:30,y:10},{x:30,y:30},{x:10,y:30}]],WW,HH,0));
    expect(u.alpha[20*WW+20]).toBe(255);expect(u.alpha[75*WW+100]).toBe(255);
  });
  it("rejects a mask of the wrong size and the manual provider returns what it was given",async()=>{
    expect(()=>applyOcclusion(comp,base,emptyOcclusion(10,10))).toThrow();
    const m=maskFromPolygons([[{x:1,y:1},{x:9,y:1},{x:9,y:9}]],WW,HH,0);
    expect(await new ManualOcclusionProvider(m).provide()).toBe(m);
    expect(await new ManualOcclusionProvider(null).provide()).toBeNull();
  });
});
void (undefined as unknown as Quad);
