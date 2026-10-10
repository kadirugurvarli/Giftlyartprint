import type {Pt,Quad,RawImage} from "../../lib/mockup-v3/types";
import {runRoomMockup} from "../../lib/mockup-v3/rooms/run";
import {buildShadowMask,shadowDirFromDeg} from "../../lib/mockup-v3/rooms/light";
import {printQuadFromPlan,type HybridInput} from "../../lib/mockup-v4/run";
import {FaithfulMockEditor} from "../../lib/mockup-v4/mock";
import {landscapeArt} from "./scenes";
import {SPEC,syntheticRoom} from "./rooms";

export type HybridScenario={
  baseline:RawImage;art:RawImage;outerQuad:Quad;artQuad:Quad;wallAlpha:Uint8Array;plantPolygon:Pt[];
  base:(over?:Partial<HybridInput>)=>HybridInput;
};

/** V3 baseline for one size on the synthetic room (no customer data, no network). */
export async function hybridScenario(size={width:50,height:70}):Promise<HybridScenario>{
  const s=syntheticRoom({withPlant:true});
  const art=landscapeArt(900,1260,61);
  const r=await runRoomMockup({room:s.room,roomImage:s.image,size,source:{kind:"flat-artwork",artwork:art,frame:SPEC(size.width,size.height)}});
  if(!r.ok) throw new Error("baseline failed: "+r.error);
  const outerQuad=r.result.targetQuad!;
  const artQuad=printQuadFromPlan(outerQuad,r.frame!.outer,r.frame!.print);
  const wallAlpha=buildShadowMask(s.room)!.alpha;
  const baseline=r.result.image!;
  const dir=shadowDirFromDeg(s.room.light.shadowDirectionDeg);
  const plantPolygon=s.plant!.polygon;
  return {
    baseline,art,outerQuad,artQuad,wallAlpha,plantPolygon,
    base:(over={})=>({baseline,art,outerQuad,artQuad,shadowDir:dir,shadowBandPx:26,wallAlpha,protect:[plantPolygon],prompt:"edit",editor:new FaithfulMockEditor(),...over})
  };
}
