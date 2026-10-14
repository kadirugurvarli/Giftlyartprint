import type {SocialFile} from "./social";
import type {Caption} from "./captions";

/**
 * Hand-off to the EXISTING Content Tracker / Google Drive feed, without touching V2:
 *  - tracker item: the same fields the current /api/content feed items use (id, title, category, status, platforms, website, format, caption);
 *  - Drive upload: the same Apps Script request the V2 routes send (`action:"upload"`, category, fileName, mimeType, base64).
 * Building a plan never sends anything. `pushToDrive` sends only when called with `confirm:true`, a feed URL and a token.
 */
export type TrackerCategory="Bespoke Framing"|"Fine Art Printing"|"Iris Photography"|"Photo Gifts"|"Business Printing";

export type TrackerItem={
  id:string;title:string;category:TrackerCategory;status:"New";platforms:("Instagram"|"Facebook")[];website:false;format:string;caption:string;source:"v4-mockup";
  notes:string;files:string[];
};

export type HandoffInput={
  id:string;title:string;category?:TrackerCategory;
  files:SocialFile[];
  captions:{Instagram:Caption;Facebook:Caption};
  sizeLabel:string;styleLabel:string;
  roomIllustrative:boolean;
  /** how the visual was made, for the reviewer */
  provenance:string;
};

export function fileNameFor(id:string,format:string){return `${id}_${format}.jpg`;}

export function buildTrackerItem(i:HandoffInput):TrackerItem{
  const platforms=[...new Set(i.files.flatMap(f=>f.format==="landscape_191x100"?["Facebook" as const]:["Instagram" as const,"Facebook" as const]))] as TrackerItem["platforms"];
  return {
    id:i.id,title:i.title,category:i.category ?? "Bespoke Framing",status:"New",platforms,website:false,
    format:i.files.map(f=>`${f.width}×${f.height}`).join(" / "),
    caption:i.captions.Instagram.text,
    source:"v4-mockup",
    notes:`${i.sizeLabel}, ${i.styleLabel}. ${i.provenance}${i.roomIllustrative?" The room is an illustration; the frame size is illustrative, not a physical measurement.":""} Facebook caption: ${i.captions.Facebook.text.split("\n")[0]}`,
    files:i.files.map(f=>fileNameFor(i.id,f.format))
  };
}

export type DriveUpload={fileName:string;mimeType:"image/jpeg";category:TrackerCategory;bytes:number};
export function buildDrivePlan(i:HandoffInput):DriveUpload[]{
  return i.files.map(f=>({fileName:fileNameFor(i.id,f.format),mimeType:"image/jpeg",category:i.category ?? "Bespoke Framing",bytes:f.bytes.length}));
}

/** Exactly the body the V2 routes post to the Apps Script feed. */
export function buildDriveUploadBody(file:SocialFile,id:string,category:TrackerCategory){
  return {action:"upload",category,fileName:fileNameFor(id,file.format),mimeType:file.mime,base64:file.bytes.toString("base64")};
}

export async function pushToDrive(o:{confirm:boolean;feedUrl?:string;feedToken?:string;files:SocialFile[];id:string;category:TrackerCategory;fetchImpl?:typeof fetch}):Promise<{fileName:string;ok:boolean;error?:string}[]>{
  if(o.confirm!==true) throw new Error("DRIVE_PUSH_NOT_CONFIRMED");
  if(!o.feedUrl||!o.feedToken) throw new Error("DRIVE_FEED_NOT_CONFIGURED");
  const url=new URL(o.feedUrl);url.searchParams.set("token",o.feedToken);
  const out:{fileName:string;ok:boolean;error?:string}[]=[];
  for(const f of o.files){
    const body=buildDriveUploadBody(f,o.id,o.category);
    try{
      const res=await (o.fetchImpl ?? fetch)(url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(body),cache:"no-store"});
      const data=await res.json().catch(()=>({})) as {ok?:boolean;error?:string;message?:string};
      out.push({fileName:body.fileName,ok:res.ok&&data.ok!==false,error:res.ok&&data.ok!==false?undefined:(data.error ?? data.message ?? `HTTP ${res.status}`)});
    }catch(e){out.push({fileName:body.fileName,ok:false,error:e instanceof Error?e.message:String(e)});}
  }
  return out;
}
