import {beforeAll,describe,expect,it} from "vitest";
import {rasterizePolygons} from "../../lib/mockup-v3/vision/mask";
import {runHybridEdit,type HybridOutcome} from "../../lib/mockup-v4/run";
import {AdversarialMockEditor,FaithfulMockEditor,type Misbehaviour} from "../../lib/mockup-v4/mock";
import {hybridScenario,type HybridScenario} from "../helpers/hybrid";

let S:HybridScenario;
beforeAll(async()=>{S=await hybridScenario();},120000);
const W=1600,H=1200;
const must=(o:HybridOutcome)=>{if(!o.ok) throw new Error(o.error+" "+(o.detail??""));return o;};

/** A region (crop coordinates) of the given polygon's bounding box, for the adversary to repaint. */
function regionOf(crop:{x:number;y:number},poly:{x:number;y:number}[],shrink=0){
  const xs=poly.map(p=>p.x),ys=poly.map(p=>p.y);
  const x0=Math.min(...xs)+shrink,y0=Math.min(...ys)+shrink,x1=Math.max(...xs)-shrink,y1=Math.max(...ys)-shrink;
  return {x:Math.round(x0-crop.x),y:Math.round(y0-crop.y),width:Math.round(x1-x0),height:Math.round(y1-y0)};
}
async function cropOf(ctx=300){
  const r=must(await runHybridEdit(S.base({contextPx:ctx})));
  return r.crop;
}

describe("faithful editor",()=>{
  it("is accepted; outside the mask is byte-identical; the art is exactly the deterministic warp",async()=>{
    const r=must(await runHybridEdit(S.base()));
    expect(r.verdict).toBe("accept");
    expect(r.metrics.finalOutside.count).toBeGreaterThan(1_000_000);
    expect(r.metrics.finalOutside.changed).toBe(0);
    expect(r.metrics.finalArtVsWarp.count).toBeGreaterThan(20000);
    expect(r.metrics.finalArtVsWarp.changed).toBe(0);
    expect(r.metrics.candidateArtDrift.meanDE).toBeLessThanOrEqual(2.5); // faithful model leaves the engine's art as is (differs from the re-warp only by resampling)
    // the edit actually did something inside the mask
    let changed=0;for(let i=0;i<W*H;i++) if(r.mask.editable[i]&&(r.image.data[i*4]!==S.baseline.data[i*4]||r.image.data[i*4+1]!==S.baseline.data[i*4+1])) changed++;
    expect(changed).toBeGreaterThan(r.mask.stats.editablePixels*0.5);
  });
  it("the engine's own art pixels agree with the independent re-warp (mean ΔE ≤ 2.5)",async()=>{
    const r=must(await runHybridEdit(S.base()));
    expect(r.metrics.baselineArtVsWarp.meanDE).toBeLessThanOrEqual(2.5);
  });
  it("the model's crop is aligned to 16 and the request mask never exposes the art",async()=>{
    let seen:{w:number;h:number;maskOnArt:number}|null=null;
    const art=rasterizePolygons([S.artQuad],W,H);
    const spy=new FaithfulMockEditor();const orig=spy.edit.bind(spy);
    spy.edit=async(req)=>{seen={w:req.image.width,h:req.image.height,maskOnArt:0};return orig(req);};
    const r=must(await runHybridEdit(S.base({editor:spy})));
    expect(seen!.w%16).toBe(0);expect(seen!.h%16).toBe(0);
    let bad=0;for(let i=0;i<W*H;i++) if(art[i]>0&&r.mask.editable[i]) bad++;
    expect(bad).toBe(0);
  });
});

describe("adversarial editors (must be neutralised and/or rejected)",()=>{
  const outside=(r:Extract<HybridOutcome,{ok:true}>)=>{expect(r.metrics.finalOutside.changed).toBe(0);expect(r.metrics.finalArtVsWarp.changed).toBe(0);};

  it("repainting the artwork is rejected, and the final art is still the exact re-warp",async()=>{
    const crop=await cropOf();
    const region=regionOf(crop,S.artQuad,12);
    const r=must(await runHybridEdit(S.base({contextPx:300,editor:new AdversarialMockEditor("repaint-art",region)})));
    expect(r.verdict).toBe("reject");expect(r.rejectReasons).toContain("model-left-art-alone");
    outside(r);
  });
  it("repainting furniture (the plant) is rejected and the plant stays byte-identical",async()=>{
    const crop=await cropOf();
    const region=regionOf(crop,S.plantPolygon,4);
    const r=must(await runHybridEdit(S.base({contextPx:300,editor:new AdversarialMockEditor("repaint-furniture",region)})));
    expect(r.verdict).toBe("reject");expect(r.rejectReasons).toContain("model-left-furniture-alone");
    outside(r);
    const pl=rasterizePolygons([S.plantPolygon],W,H);let ch=0;
    for(let i=0;i<W*H;i++) if(pl[i]>=250&&(r.image.data[i*4]!==S.baseline.data[i*4]||r.image.data[i*4+1]!==S.baseline.data[i*4+1]||r.image.data[i*4+2]!==S.baseline.data[i*4+2])) ch++;
    expect(ch).toBe(0);
  });
  it("a ghost object on the wall outside the mask is rejected and removed from the output",async()=>{
    const crop=await cropOf();
    const q=S.outerQuad,minX=Math.min(...q.map(p=>p.x)),minY=Math.min(...q.map(p=>p.y));
    const region={x:Math.round(minX-crop.x-150),y:Math.round(minY-crop.y+20),width:70,height:90}; // wall left of the frame
    const r=must(await runHybridEdit(S.base({contextPx:300,editor:new AdversarialMockEditor("ghost-object",region)})));
    expect(r.verdict).toBe("reject");expect(r.rejectReasons).toContain("model-left-room-alone");
    outside(r);
    const gx=Math.round(region.x+crop.x+35),gy=Math.round(region.y+crop.y+45),p=(gy*W+gx)*4;
    expect(Array.from(r.image.data.slice(p,p+3))).toEqual(Array.from(S.baseline.data.slice(p,p+3)));
  });
  it("a global colour cast is rejected",async()=>{
    const r=must(await runHybridEdit(S.base({editor:new AdversarialMockEditor("global-tint")})));
    expect(r.verdict).toBe("reject");expect(r.rejectReasons).toContain("model-left-room-alone");outside(r);
  });
  it("a wrong-size output is an error, never composited",async()=>{
    const r=await runHybridEdit(S.base({editor:new AdversarialMockEditor("wrong-size")}));
    expect(r.ok).toBe(false);if(!r.ok) expect(r.error).toBe("CANDIDATE_SIZE_MISMATCH");
  });
  it("a 3 px spatially shifted output is rejected (edge drift) and the baseline outside the mask is kept",async()=>{
    const r=must(await runHybridEdit(S.base({editor:new AdversarialMockEditor("shifted")})));
    expect(r.verdict).toBe("reject");expect(r.rejectReasons).toContain("model-left-room-alone");
    outside(r);
  });
});

describe("input validation",()=>{
  it("fails closed on bad geometry and oversized masks",async()=>{
    const out=S.outerQuad.map(p=>({x:p.x+5000,y:p.y})) as typeof S.outerQuad;
    expect(await runHybridEdit(S.base({outerQuad:out}))).toMatchObject({ok:false,error:"QUAD_OUTSIDE_IMAGE"});
    expect(await runHybridEdit(S.base({artQuad:S.outerQuad.map(p=>({x:p.x+300,y:p.y})) as never}))).toMatchObject({ok:false});
    expect(await runHybridEdit(S.base({thresholds:{maxEditableShare:0.0001}}))).toMatchObject({ok:false,error:"EDIT_MASK_TOO_LARGE"});
    expect(await runHybridEdit(S.base({artQuad:S.outerQuad}))).toMatchObject({ok:false,error:"NO_FRAME_RING"});
  });
});
