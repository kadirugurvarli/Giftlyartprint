import {beforeAll,describe,expect,it} from "vitest";
import {rasterizePolygons} from "../../lib/mockup-v3/vision/mask";
import {buildEditMask,chooseCrop,cropMask} from "../../lib/mockup-v4/mask";
import {hybridScenario,type HybridScenario} from "../helpers/hybrid";

let S:HybridScenario;
beforeAll(async()=>{S=await hybridScenario();},120000);
const W=1600,H=1200;
const mk=(o:Record<string,unknown>={})=>buildEditMask({width:W,height:H,outerQuad:S.outerQuad,artQuad:S.artQuad,shadowDir:{x:0.45,y:0.89},shadowBandPx:26,wallAlpha:S.wallAlpha,protect:[S.plantPolygon],...o} as never);

describe("bounded frame-and-shadow mask",()=>{
  it("never includes the print (or a guard band around it)",()=>{
    const m=mk(),art=rasterizePolygons([S.artQuad],W,H);
    let bad=0;for(let i=0;i<W*H;i++) if(art[i]>0&&m.editable[i]) bad++;
    expect(bad).toBe(0);
  });
  it("never includes furniture (plant polygons) even when the shadow band reaches them",()=>{
    const m=mk({shadowBandPx:400}),pl=rasterizePolygons([S.plantPolygon],W,H);
    let bad=0;for(let i=0;i<W*H;i++) if(pl[i]>0&&m.editable[i]) bad++;
    expect(bad).toBe(0);
  });
  it("shadow band stays on the wall; without a wall mask there is NO shadow band",()=>{
    const m=mk({shadowBandPx:60});
    const frame=rasterizePolygons([S.outerQuad],W,H);
    let off=0;for(let i=0;i<W*H;i++) if(m.editable[i]&&frame[i]===0&&S.wallAlpha[i]<250) off++;
    expect(m.stats.shadowBand).toBe(true);expect(m.stats.shadowPixels).toBeGreaterThan(200);
    const none=mk({wallAlpha:null,shadowBandPx:60});
    expect(none.stats.shadowBand).toBe(false);expect(none.stats.shadowPixels).toBe(0);
    expect(none.stats.editablePixels).toBe(none.stats.framePixels);
    expect(off).toBe(0);
  });
  it("furniture protection holds on its own, and the shadow band is clipped by the wall mask itself",()=>{
    const pl=rasterizePolygons([S.plantPolygon],W,H);
    const open=new Uint8Array(W*H).fill(255); // a wall mask that (wrongly) covers the plant
    const m=mk({wallAlpha:open,shadowBandPx:400});
    let onPlant=0;for(let i=0;i<W*H;i++) if(pl[i]>0&&m.editable[i]) onPlant++;
    expect(onPlant).toBe(0);
    const cx=Math.round(Math.max(...S.outerQuad.map(p=>p.x)))+20;
    const cut=new Uint8Array(W*H).fill(255);for(let y=0;y<H;y++)for(let x=cx;x<W;x++)cut[y*W+x]=0; // pretend the wall ends right of the frame
    const frame=rasterizePolygons([S.outerQuad],W,H),c=mk({wallAlpha:cut,shadowBandPx:120});
    let off=0;for(let i=0;i<W*H;i++) if(c.editable[i]&&frame[i]===0&&cut[i]<250) off++;
    expect(off).toBe(0);expect(c.stats.shadowPixels).toBeGreaterThan(100);
  });
  it("the shadow band lies on the shadow side of the frame",()=>{
    const m=mk();
    const frame=rasterizePolygons([S.outerQuad],W,H);
    const cx=S.outerQuad.reduce((a,p)=>a+p.x,0)/4,cy=S.outerQuad.reduce((a,p)=>a+p.y,0)/4;
    let right=0,left=0,below=0,above=0;
    for(let i=0;i<W*H;i++) if(m.editable[i]&&frame[i]===0){const x=i%W,y=(i-x)/W;x>cx?right++:left++;y>cy?below++:above++;}
    expect(right).toBeGreaterThan(left);expect(below).toBeGreaterThan(above);
  });
  it("is a small share of the scene and non-empty",()=>{
    const m=mk();expect(m.stats.share).toBeGreaterThan(0.002);expect(m.stats.share).toBeLessThan(0.1);
  });
});

describe("crop selection for provider constraints",()=>{
  const C={alignPx:16,maxAspect:3,maxSide:3840,maxPixels:3840*2160,minSide:64};
  it("aligns to 16, keeps aspect and stays inside the scene while covering the whole mask",()=>{
    const m=mk(),r=chooseCrop(m,C,40);
    expect(r.ok).toBe(true);if(!r.ok) return;
    const c=r.crop;
    expect(c.width%16).toBe(0);expect(c.height%16).toBe(0);
    expect(c.x).toBeGreaterThanOrEqual(0);expect(c.x+c.width).toBeLessThanOrEqual(W);expect(c.y+c.height).toBeLessThanOrEqual(H);
    expect(Math.max(c.width/c.height,c.height/c.width)).toBeLessThanOrEqual(3);
    const inCrop=cropMask(m,c).reduce((a,v)=>a+(v?1:0),0);
    expect(inCrop).toBe(m.stats.editablePixels);
  });
  it("fails closed on an empty mask, an oversize crop and provider limits",()=>{
    const empty=mk({outerQuad:S.outerQuad,artQuad:S.outerQuad,shadowBandPx:0});
    expect(empty.stats.editablePixels).toBe(0);
    expect(chooseCrop(empty,C,40)).toEqual({ok:false,error:"EDIT_MASK_EMPTY"});
    expect(chooseCrop(mk(),C,5000)).toEqual({ok:false,error:"CROP_LARGER_THAN_SCENE"});
    expect(chooseCrop(mk(),{...C,maxSide:100},40)).toEqual({ok:false,error:"CROP_EXCEEDS_EDITOR_LIMITS"});
  });
});
