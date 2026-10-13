import type {Quad,RawImage} from "../mockup-v3/types";
import {planFlatFrame} from "../mockup-v3/rooms/product";
import {buildScenario} from "./scenario";
import {describeLight,frameSpecFor,PACK_SIZES,paidEligible,validatePackManifest,type PackManifest} from "./pack";
import {buildFrameEditPrompt} from "./prompt";
import {runHybridEdit,type HybridCheck} from "./run";
import {frameFor,SIZES} from "./styles";
import type {HybridImageEditor,Rect} from "./types";

export type RoomHandle={manifest:PackManifest;roomImage:RawImage};
export type EngineMode="baseline"|"hybrid";

export type RenderRequest={
  room:RoomHandle;
  artwork:RawImage;
  size:{width:number;height:number};
  style:string;
  mount:string;
  mode:EngineMode;
  editor?:HybridImageEditor;
  /** regeneration counter; changes the prompt wording so a repeat call is a genuinely new attempt */
  variant?:number;
  /** limit the sizes to those a room pack was validated for; the V3 engine itself supports all eight */
  allowAnySize?:boolean;
};

export type RenderOk={
  ok:true;
  mode:EngineMode;
  /** what the customer sees: the V3 baseline, or the accepted hybrid result */
  master:RawImage;
  baseline:RawImage;
  rawModelOutput?:RawImage;
  outerQuad:Quad;artQuad:Quad;
  verdict:"baseline"|"accept"|"reject";
  rejectReasons:string[];
  checks:{name:string;pass:boolean;detail:string}[];
  hybridChecks?:HybridCheck[];
  physicalAccuracy:string;scaleDisclosure:string;
  editor?:{id:string;provider:string;model:string;estimatedCostUsd:number|null};
  crop?:Rect;scale?:number;
  prompt?:string;
};
export type RenderResult=RenderOk|{ok:false;error:string;detail?:string};

export function isSupportedSize(z:{width:number;height:number}){return SIZES.some(s=>s.width===z.width&&s.height===z.height);}

/** Which sizes fit this artwork (the print is never cropped or stretched; the mount absorbs the difference). */
export function fitReport(art:{width:number;height:number},style:string,mount:string){
  const frame=frameFor(style,mount);
  return SIZES.map(s=>{
    if(!frame) return {...s,fits:false,reason:"UNKNOWN_STYLE_OR_MOUNT",printFill:0};
    const r=planFlatFrame(frameSpecFor({frame} as PackManifest,s),art,8);
    return r.ok?{...s,fits:true,reason:"",printFill:+(r.plan.print.width*r.plan.print.height/(r.plan.opening.width*r.plan.opening.height)).toFixed(2)}:{...s,fits:false,reason:r.error,printFill:0};
  });
}

const VARIANT_NOTES=["","Keep the frame highlights soft and natural.","Make the wood grain slightly more pronounced.","Favour a crisp, clean mitred corner finish.","Keep the shadow very soft and diffuse."];

export async function renderMockup(r:RenderRequest):Promise<RenderResult>{
  if(!isSupportedSize(r.size)) return {ok:false,error:"SIZE_NOT_SUPPORTED",detail:"outer sizes 30x40 to 60x80 cm, portrait or landscape"};
  const frame=frameFor(r.style,r.mount);
  if(!frame) return {ok:false,error:"UNKNOWN_STYLE_OR_MOUNT"};
  const m:PackManifest={...r.room.manifest,frame};
  const issues=validatePackManifest(m).filter(i=>!/^PACK_FRAME_SPEC_INVALID/.test(i.code)||PACK_SIZES.some(s=>s.width===r.size.width&&s.height===r.size.height)||false);
  const hard=issues.filter(i=>i.code!=="PACK_FRAME_SPEC_INVALID");
  if(hard.length) return {ok:false,error:"ROOM_PACK_INVALID",detail:hard.map(i=>i.code).join(",")};
  const sc=await buildScenario({room:m.room,roomImage:r.room.roomImage,artwork:r.artwork,frame:frameSpecFor(m,r.size),size:r.size});
  if(!sc.ok) return {ok:false,error:sc.error,detail:sc.detail};
  const base:Omit<RenderOk,"verdict"|"mode"|"master"|"rejectReasons"> = {baseline:sc.baseline,outerQuad:sc.outerQuad,artQuad:sc.artQuad,checks:sc.v3Checks,physicalAccuracy:sc.physicalAccuracy,scaleDisclosure:sc.scaleDisclosure} as never;
  if(!sc.v3Checks.every(c=>c.pass)||sc.v3Status==="fail") return {ok:false,error:"BASELINE_QA_FAILED",detail:sc.v3Checks.filter(c=>!c.pass).map(c=>c.name).join(",")};
  if(r.mode==="baseline"||!r.editor) return {...base,ok:true,mode:"baseline",master:sc.baseline,verdict:"baseline",rejectReasons:[]};
  const light=m.lightDescription ?? describeLight(m.room.light);
  const note=VARIANT_NOTES[(r.variant ?? 0)%VARIANT_NOTES.length];
  const prompt=buildFrameEditPrompt({frameDescription:frame.description,lightDescription:light})+(note?`\n${note}`:"");
  const band=Math.round(Math.max(18,0.08*Math.hypot(sc.outerQuad[1].x-sc.outerQuad[0].x,sc.outerQuad[1].y-sc.outerQuad[0].y)));
  const h=await runHybridEdit({baseline:sc.baseline,art:r.artwork,outerQuad:sc.outerQuad,artQuad:sc.artQuad,shadowDir:sc.shadowDir,shadowBandPx:band,wallAlpha:sc.wallAlpha,protect:sc.protect,prompt,editor:r.editor,contextPx:Math.round(Math.max(48,sc.wallPxPerCm*6)),mouldingPx:sc.mouldingPx});
  if(!h.ok) return {ok:false,error:h.error,detail:h.detail};
  return {...base,ok:true,mode:"hybrid",master:h.verdict==="accept"?h.image:sc.baseline,rawModelOutput:h.candidateFull,verdict:h.verdict,rejectReasons:h.rejectReasons,hybridChecks:h.checks,
    editor:{id:r.editor.id,provider:h.meta.provider,model:h.meta.model,estimatedCostUsd:h.meta.estimatedCostUsd},crop:h.crop,scale:h.scale,prompt};
}

export {paidEligible};
