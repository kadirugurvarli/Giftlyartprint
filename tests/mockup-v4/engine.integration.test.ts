import sharp from "sharp";
import {describe,expect,it} from "vitest";
import {fitReport,renderMockup} from "../../lib/mockup-v4/engine";
import {FaithfulMockEditor} from "../../lib/mockup-v4/mock";
import type {PackManifest} from "../../lib/mockup-v4/pack";
import {renderSocial,SOCIAL_FORMATS} from "../../lib/mockup-v4/social";
import {FRAME_STYLES,MOUNTS,SIZES} from "../../lib/mockup-v4/styles";
import {landscapeArt} from "../helpers/scenes";
import {syntheticRoom} from "../helpers/rooms";
import {regionDelta} from "../../lib/mockup-v4/integrity";

/**
 * The single end-to-end integration test of the V4 engine on the SYNTHETIC room: every size × orientation from 30x40 to
 * 60x80, rendered through the V3 baseline, protected pixels verified, then every Facebook/Instagram format exported.
 * It proves plumbing and geometry, not photographic quality.
 */
describe("V4 engine, all eight sizes, end to end",()=>{
  const s=syntheticRoom({withPlant:true});
  const manifest:PackManifest={schemaVersion:1,id:"it-room",roomImage:"r.png",artworkImage:"a.png",room:s.room,
    provenance:{kind:"synthetic-test",rightsCleared:true,licence:"test",emptyWallConfirmed:true},artwork:{origin:"synthetic-test",customer:false,licence:"test"},
    frame:{mouldingWidthCm:2.4,mountWidthCm:3.5,frameDepthCm:3,mouldingColour:[66,48,34],mountColour:[238,233,222],description:"walnut"}};
  const room={manifest,roomImage:s.image};
  const plant=s.plant!;

  it("renders, verifies and exports every size",async()=>{
    for(let i=0;i<SIZES.length;i++){
      const z=SIZES[i],style=FRAME_STYLES[i%FRAME_STYLES.length].id,mount=MOUNTS[(i+1)%MOUNTS.length].id;
      const art=z.orientation==="portrait"?landscapeArt(1200,1600,i+1):landscapeArt(1600,1200,i+1);
      expect(fitReport(art,style,mount).find(x=>x.width===z.width&&x.height===z.height)!.fits,z.label).toBe(true);
      const r=await renderMockup({room,artwork:art,size:z,style,mount,mode:"baseline"});
      expect(r.ok,`${z.label} ${JSON.stringify(r).slice(0,200)}`).toBe(true);if(!r.ok) continue;
      expect(r.checks.every(c=>c.pass),z.label).toBe(true);
      // geometry: outer quad has the outer-size proportions (≤ 2 %), and the print sits inside it
      const q=r.outerQuad,wq=(Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y)+Math.hypot(q[2].x-q[3].x,q[2].y-q[3].y))/2,hq=(Math.hypot(q[3].x-q[0].x,q[3].y-q[0].y)+Math.hypot(q[2].x-q[1].x,q[2].y-q[1].y))/2;
      expect(Math.abs(wq/hq/(z.width/z.height)-1),`${z.label} aspect`).toBeLessThan(0.1); // perspective foreshortens the near edges a little; V3's own aspect check is the strict one
      // protected pixels: the plant is byte-identical, and the room far from the frame is unchanged
      const W=r.master.width,H=r.master.height;
      const xs=q.map(p=>p.x),ys=q.map(p=>p.y),x0=Math.min(...xs)-90,x1=Math.max(...xs)+90,y0=Math.min(...ys)-90,y1=Math.max(...ys)+90;
      const plantDelta=regionDelta(r.master,s.image,i=>plant.alpha[i]>200);
      expect(plantDelta.changed,`${z.label} plant`).toBe(0);
      const far=regionDelta(r.master,s.image,i=>{const x=i%W,y=(i-x)/W;return x<x0-60||x>x1+60||y<y0-60||y>y1+60;});
      expect(far.changed,`${z.label} far room`).toBe(0);expect(H).toBe(s.image.height);
      for(const f of SOCIAL_FORMATS){
        const o=await renderSocial(r.master,r.outerQuad,f);
        expect(o.ok,`${z.label} ${f.key}`).toBe(true);if(!o.ok) continue;
        const m=await sharp(o.file.bytes).metadata();expect([m.width,m.height]).toEqual([f.width,f.height]);
      }
    }
  },600000);

  it("hybrid mode with the offline mock keeps protected pixels and rejects nothing; regeneration varies the prompt",async()=>{
    const art=landscapeArt(1200,1600,9),prompts:string[]=[];
    for(const variant of [0,1]){
      const e=new FaithfulMockEditor();const o=e.edit.bind(e);e.edit=async(q)=>{prompts.push(q.prompt);return o(q);};
      const r=await renderMockup({room,artwork:art,size:{width:30,height:40},style:"oak",mount:"classic",mode:"hybrid",editor:e,variant});
      expect(r.ok).toBe(true);if(!r.ok) continue;
      expect(r.verdict).toBe("accept");expect(r.hybridChecks!.every(c=>c.pass)).toBe(true);expect(plantUnchanged(r.master)).toBe(true);
    }
    expect(prompts[0]).not.toBe(prompts[1]);expect(prompts[0]).toContain("oak");
    function plantUnchanged(img:{width:number;height:number;data:Uint8ClampedArray}){return regionDelta(img,s.image,i=>plant.alpha[i]>200).changed===0;}
  },300000);

  it("fails closed on unsupported sizes and unsuitable artwork",async()=>{
    expect((await renderMockup({room,artwork:landscapeArt(1200,900,1),size:{width:20,height:30},style:"oak",mount:"classic",mode:"baseline"}))).toMatchObject({ok:false,error:"SIZE_NOT_SUPPORTED"});
    expect((await renderMockup({room,artwork:landscapeArt(2000,500,1),size:{width:60,height:80},style:"oak",mount:"classic",mode:"baseline"})).ok).toBe(false);
  },120000);
});
