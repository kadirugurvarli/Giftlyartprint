import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import sharp from "sharp";
import type {RawImage} from "../lib/mockup-v3/types";
import {buildCaption,type Caption} from "../lib/mockup-v4/captions";
import {fitReport,renderMockup,type RenderOk,type RoomHandle} from "../lib/mockup-v4/engine";
import {prepareArtwork} from "../lib/mockup-v4/intake";
import {FaithfulMockEditor} from "../lib/mockup-v4/mock";
import {OpenAIImageEditor} from "../lib/mockup-v4/openai";
import {paidEligible} from "../lib/mockup-v4/pack";
import {renderMasterPng,renderSocial,SOCIAL_FORMATS,type SocialFile} from "../lib/mockup-v4/social";
import {FRAME_STYLES,MOUNTS,SIZES} from "../lib/mockup-v4/styles";
import {SpendGuard} from "../lib/mockup-v4/spend";
import {buildDrivePlan,buildTrackerItem,fileNameFor,pushToDrive,type TrackerCategory} from "../lib/mockup-v4/tracker";
import {BodyTooLarge,gate,readBody,send,sendJson} from "./v4-http";

export type StudioRoom={id:string;label:string;handle:RoomHandle};
export type StudioOptions={
  rooms:StudioRoom[];
  outDir:string;
  port?:number;
  /** Paid AI edits are OFF unless the server was started with all of these. */
  paid?:{guard:SpendGuard;apiKey:()=>string|undefined;model?:string;fetchImpl?:typeof fetch};
  /** Google Drive push is OFF unless enabled here (and the feed env is present). */
  drive?:{allow:boolean;feedUrl?:string;feedToken?:string;fetchImpl?:typeof fetch};
};

type Stored={id:string;render:RenderOk;roomId:string;size:string;style:string;mount:string;created:number};
type Export={id:string;files:SocialFile[];category:TrackerCategory;created:number};
const TTL=30*60*1000;

const jpegB64=async(img:RawImage,w:number,q=86)=>(await sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}}).removeAlpha().resize({width:Math.min(w,img.width)}).jpeg({quality:q}).toBuffer()).toString("base64");

export function createStudioServer(o:StudioOptions){
  let port=o.port ?? 0;
  const html=fs.readFileSync(path.resolve(__dirname,"../tools/v4-studio/index.html"));
  const renders=new Map<string,Stored>(),exportsM=new Map<string,Export>();
  const prune=()=>{const now=Date.now();for(const m of [renders,exportsM])for(const [k,v] of m)if(now-v.created>TTL||m.size>4&&k===m.keys().next().value)m.delete(k);};
  const rid=()=>crypto.randomBytes(8).toString("hex");

  const server=http.createServer(async(req,res)=>{
    try{
      port=(server.address() as {port:number}).port;
      if(!gate(req,res,port)) return;
      prune();
      const url=new URL(req.url ?? "/",`http://127.0.0.1:${port}`);
      const q=url.searchParams;
      if(req.method==="GET"&&url.pathname==="/") return send(res,200,html,"text/html; charset=utf-8");
      if(req.method==="GET"&&url.pathname==="/favicon.ico") return send(res,204,"");
      if(req.method==="GET"&&url.pathname==="/api/options"){
        return sendJson(res,200,{
          rooms:o.rooms.map(r=>({id:r.id,label:r.label,provenance:r.handle.manifest.provenance.kind,width:r.handle.roomImage.width,height:r.handle.roomImage.height,paidEligible:paidEligible(r.handle.manifest).eligible,physicalAccuracy:"illustrative"})),
          sizes:SIZES,styles:FRAME_STYLES.map(s=>({id:s.id,label:s.label,colour:s.mouldingColour})),mounts:MOUNTS.map(m=>({id:m.id,label:m.label})),
          formats:SOCIAL_FORMATS.map(f=>({key:f.key,label:f.label,platforms:f.platforms})),
          modes:[{id:"baseline",label:"V3 deterministic baseline",enabled:true},{id:"mock",label:"Mock editor (offline, NOT AI)",enabled:true},{id:"openai",label:"AI frame edit (paid)",enabled:!!o.paid}],
          driveEnabled:!!(o.drive?.allow&&o.drive.feedUrl&&o.drive.feedToken)
        });
      }
      if(req.method==="POST"&&url.pathname==="/api/fit"){
        const a=await prepareArtwork(await readBody(req,50_000_000));
        if(!a.ok) return sendJson(res,422,{ok:false,error:a.error});
        return sendJson(res,200,{ok:true,width:a.image.width,height:a.image.height,sizes:fitReport(a.image,q.get("style") ?? "walnut",q.get("mount") ?? "classic")});
      }
      if(req.method==="POST"&&url.pathname==="/api/render"){
        const a=await prepareArtwork(await readBody(req,50_000_000));
        if(!a.ok) return sendJson(res,422,{ok:false,error:a.error});
        const room=o.rooms.find(r=>r.id===q.get("room"));
        if(!room) return sendJson(res,404,{ok:false,error:"ROOM_NOT_FOUND"});
        const [w,h]=(q.get("size") ?? "").split("x").map(Number);
        const mode=q.get("mode") ?? "baseline";
        if(!["baseline","mock","openai"].includes(mode)) return sendJson(res,400,{ok:false,error:"MODE_INVALID"});
        let editor;
        if(mode==="mock") editor=new FaithfulMockEditor();
        if(mode==="openai"){
          if(!o.paid) return sendJson(res,403,{ok:false,error:"PAID_MODE_DISABLED",detail:"start the studio with --execute --authorize-paid --max-spend-usd --price-per-image-usd and OPENAI_API_KEY"});
          const el=paidEligible(room.handle.manifest);
          if(!el.eligible) return sendJson(res,403,{ok:false,error:"ROOM_NOT_PAID_ELIGIBLE",detail:el.reasons.join("; ")});
          editor=new OpenAIImageEditor({guard:o.paid.guard,model:o.paid.model,quality:"medium",apiKey:o.paid.apiKey,fetchImpl:o.paid.fetchImpl});
        }
        let r;
        try{r=await renderMockup({room:room.handle,artwork:a.image,size:{width:w,height:h},style:q.get("style") ?? "walnut",mount:q.get("mount") ?? "classic",mode:mode==="baseline"?"baseline":"hybrid",editor,variant:Number(q.get("variant") ?? 0)});}
        catch(e){const msg=e instanceof Error?e.message:String(e);return sendJson(res,e instanceof Error&&"code" in e?402:502,{ok:false,error:"RENDER_FAILED",detail:msg.slice(0,300)});}
        if(!r.ok) return sendJson(res,422,{ok:false,error:r.error,detail:r.detail});
        const id=rid();
        renders.set(id,{id,render:r,roomId:room.id,size:`${w}x${h}`,style:q.get("style") ?? "walnut",mount:q.get("mount") ?? "classic",created:Date.now()});
        return sendJson(res,200,{ok:true,renderId:id,mode:r.mode,verdict:r.verdict,rejectReasons:r.rejectReasons,checks:r.checks,hybridChecks:r.hybridChecks ?? [],
          physicalAccuracy:r.physicalAccuracy,scaleDisclosure:r.scaleDisclosure,editor:r.editor ?? null,
          preview:await jpegB64(r.master,1600),baselinePreview:r.mode==="hybrid"?await jpegB64(r.baseline,1600):null,
          warnings:[...(room.handle.manifest.provenance.kind==="synthetic-test"?["SYNTHETIC_ROOM_NOT_A_VISUAL_APPROVAL"]:[]),...(r.mode==="hybrid"&&r.editor?.provider==="mock"?["MOCK_EDITOR_NOT_AI"]:[]),...(r.verdict==="reject"?["AI_RESULT_REJECTED_SHOWING_BASELINE"]:[])]});
      }
      if(req.method==="POST"&&url.pathname==="/api/export"){
        const b=JSON.parse((await readBody(req,100_000)).toString("utf8")) as {renderId:string;formats?:string[];category?:TrackerCategory;title?:string;captionVariant?:number};
        const s=renders.get(b.renderId);
        if(!s) return sendJson(res,404,{ok:false,error:"RENDER_NOT_FOUND_OR_EXPIRED"});
        const styleLabel=FRAME_STYLES.find(x=>x.id===s.style)!.label,mountLabel=MOUNTS.find(x=>x.id===s.mount)!.label;
        const [w,h]=s.size.split("x").map(Number),size=SIZES.find(z=>z.width===w&&z.height===h)!;
        const wanted=SOCIAL_FORMATS.filter(f=>!b.formats||b.formats.includes(f.key));
        if(!wanted.length) return sendJson(res,400,{ok:false,error:"NO_FORMATS"});
        const files:SocialFile[]=[],errors:{format:string;error:string}[]=[];
        for(const f of wanted){const r=await renderSocial(s.render.master,s.render.outerQuad,f);if(r.ok)files.push(r.file);else errors.push({format:f.key,error:r.error});}
        if(!files.length) return sendJson(res,422,{ok:false,error:"EXPORT_FAILED",errors});
        const id=`V4-${new Date().toISOString().replace(/[-:T]/g,"").slice(0,14)}-${rid().slice(0,4)}`;
        const cap={Instagram:buildCaption({platform:"Instagram",size,styleLabel,mountLabel,variant:b.captionVariant}),Facebook:buildCaption({platform:"Facebook",size,styleLabel,mountLabel,variant:b.captionVariant})} as {Instagram:Caption;Facebook:Caption};
        const category=b.category ?? "Bespoke Framing";
        const provenance=s.render.mode==="hybrid"&&s.render.editor?.provider!=="mock"?`AI frame edit (${s.render.editor?.model}) over a deterministic baseline; original artwork re-inserted exactly.`:s.render.mode==="hybrid"?"MOCK editor (not AI) over a deterministic baseline.":"Deterministic V3 render.";
        const hand={id,title:(b.title ?? `Framed print ${size.label}`).slice(0,80),category,files,captions:cap,sizeLabel:size.label,styleLabel:`${styleLabel}, ${mountLabel}`,roomIllustrative:true,provenance};
        const tracker=buildTrackerItem(hand),plan=buildDrivePlan(hand);
        const dir=path.resolve(o.outDir,id);fs.mkdirSync(dir,{recursive:true});
        for(const f of files) fs.writeFileSync(path.join(dir,fileNameFor(id,f.format)),f.bytes);
        fs.writeFileSync(path.join(dir,`${id}_master.png`),await renderMasterPng(s.render.master));
        fs.writeFileSync(path.join(dir,"captions.md"),`# Instagram\n\n${cap.Instagram.text}\n\nAlt text: ${cap.Instagram.altText}\n\n# Facebook\n\n${cap.Facebook.text}\n\nAlt text: ${cap.Facebook.altText}\n`);
        fs.writeFileSync(path.join(dir,"tracker_row.json"),JSON.stringify(tracker,null,2));
        fs.writeFileSync(path.join(dir,"drive_upload_plan.json"),JSON.stringify(plan,null,2));
        exportsM.set(id,{id,files,category,created:Date.now()});
        const thumbs=await Promise.all(files.map(async f=>({format:f.format,width:f.width,height:f.height,bytes:f.bytes.length,quality:f.quality,upscale:+f.upscale.toFixed(2),fileName:fileNameFor(id,f.format),thumb:(await sharp(f.bytes).resize({width:360}).jpeg({quality:80}).toBuffer()).toString("base64")})));
        return sendJson(res,200,{ok:true,exportId:id,folder:dir,files:thumbs,errors,captions:cap,captionProblems:[...cap.Instagram.problems,...cap.Facebook.problems],tracker,drivePlan:plan});
      }
      if(req.method==="POST"&&url.pathname==="/api/drive-push"){
        const b=JSON.parse((await readBody(req,10_000)).toString("utf8")) as {exportId:string;confirm:boolean};
        if(!(o.drive?.allow&&o.drive.feedUrl&&o.drive.feedToken)) return sendJson(res,403,{ok:false,error:"DRIVE_PUSH_DISABLED"});
        const e=exportsM.get(b.exportId);
        if(!e) return sendJson(res,404,{ok:false,error:"EXPORT_NOT_FOUND_OR_EXPIRED"});
        try{const r=await pushToDrive({confirm:b.confirm===true,feedUrl:o.drive.feedUrl,feedToken:o.drive.feedToken,files:e.files,id:e.id,category:e.category,fetchImpl:o.drive.fetchImpl});return sendJson(res,200,{ok:r.every(x=>x.ok),results:r});}
        catch(err){return sendJson(res,400,{ok:false,error:err instanceof Error?err.message:"DRIVE_PUSH_FAILED"});}
      }
      sendJson(res,404,{ok:false,error:"NOT_FOUND"});
    }catch(e){
      if(e instanceof BodyTooLarge) return sendJson(res,413,{ok:false,error:"BODY_TOO_LARGE"});
      sendJson(res,400,{ok:false,error:"BAD_REQUEST"});
    }
  });
  return server;
}
