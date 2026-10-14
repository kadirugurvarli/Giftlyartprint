"use client";
import {useEffect,useRef,useState} from "react";
import "./validation.css";
import {shrinkForUpload,type Shrunk} from "@/lib/mockup-v3/web/client/shrink";
import {REFERENCE_MAX_SIDE,REFERENCE_TARGET_BYTES,SOURCE_TARGET_BYTES} from "@/lib/mockup-v3/web/limits";
import {unpackFrame} from "@/lib/mockup-v3/web/frame";
import {buildFeedback,DEFECT_CHOICES,RATING_KEYS,type Verdict} from "@/lib/mockup-v3/web/client/feedback";

type Mode="artwork-in-frame"|"framed-on-wall";
type Level="strict"|"environment"|"photographic";
type Report=any;
const RATING_LABEL:Record<string,string>={placement:"Placement",perspective:"Perspective",lighting:"Lighting",shadow:"Shadow",edges:"Edges",colourFidelity:"Colour fidelity"};

const bytesLabel=(n:number)=>n>1e6?`${(n/1e6).toFixed(1)} MB`:`${Math.round(n/1e3)} KB`;
const save=(blob:Blob,name:string)=>{const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);};

export default function Studio(){
  const [mode,setMode]=useState<Mode>("artwork-in-frame");
  const [level,setLevel]=useState<Level>("environment");
  const [srcFile,setSrcFile]=useState<File|null>(null),[refFile,setRefFile]=useState<File|null>(null);
  const [srcUrl,setSrcUrl]=useState(""),[refUrl,setRefUrl]=useState("");
  const [pieceW,setPieceW]=useState(""),[ceilH,setCeilH]=useState("");
  const [busy,setBusy]=useState(""),[err,setErr]=useState("");
  const [res,setRes]=useState<{report:Report;mockup:Blob;mockupUrl:string;overlayUrl:string|null;srcPrev:string;refPrev:string}|null>(null);
  const [showOverlay,setShowOverlay]=useState(false);
  const [verdict,setVerdict]=useState<Verdict>(""),[ratings,setRatings]=useState<Record<string,number|null>>({}),[seen,setSeen]=useState<string[]>([]),[notes,setNotes]=useState("");
  const caseId=useRef(crypto.randomUUID().slice(0,8));
  const urls=useRef<string[]>([]);
  useEffect(()=>()=>{urls.current.forEach(URL.revokeObjectURL);},[]);

  const pick=(setF:(f:File|null)=>void,setU:(u:string)=>void)=>(e:React.ChangeEvent<HTMLInputElement>)=>{
    const f=e.target.files?.[0] ?? null;setF(f);
    const u=f?URL.createObjectURL(f):"";if(u) urls.current.push(u);setU(u);
    setRes(null);setErr("");
  };

  async function generate(){
    if(!srcFile||!refFile) return;
    setErr("");setRes(null);
    try{
      setBusy("Preparing your photos in the browser…");
      const [s,r]:[Shrunk,Shrunk]=[await shrinkForUpload(srcFile,SOURCE_TARGET_BYTES,3600),await shrinkForUpload(refFile,REFERENCE_TARGET_BYTES,REFERENCE_MAX_SIDE)];
      const fd=new FormData();
      fd.set("mode",mode);fd.set("level",level);
      fd.set("source",new File([s.blob],"s.jpg",{type:"image/jpeg"}));
      fd.set("reference",new File([r.blob],"r.jpg",{type:"image/jpeg"}));
      fd.set("sourceMeta",JSON.stringify(s.hint));fd.set("referenceMeta",JSON.stringify(r.hint));
      if(mode==="framed-on-wall"){ if(pieceW) fd.set("pieceWidthCm",pieceW); if(ceilH) fd.set("ceilingHeightCm",ceilH); }
      setBusy(`Uploading ${bytesLabel(s.blob.size+r.blob.size)} and generating (about 10–40 seconds)…`);
      const resp=await fetch("/api/validation/run",{method:"POST",body:fd});
      if(!resp.ok){const j=await resp.json().catch(()=>({}));throw new Error(j.error ?? `Server answered ${resp.status}.`);}
      const {header,mockup,overlay}=unpackFrame(new Uint8Array(await resp.arrayBuffer()));
      const mBlob=new Blob([mockup as BlobPart],{type:"image/jpeg"});
      const mUrl=URL.createObjectURL(mBlob),oUrl=overlay?URL.createObjectURL(new Blob([overlay as BlobPart],{type:"image/jpeg"})):null;
      urls.current.push(mUrl);if(oUrl) urls.current.push(oUrl);
      // previews of what was actually analysed (the shrunken copies), from local blobs
      const sp=URL.createObjectURL(s.blob),rp=URL.createObjectURL(r.blob);urls.current.push(sp,rp);
      setRes({report:header.report,mockup:mBlob,mockupUrl:mUrl,overlayUrl:oUrl,srcPrev:sp,refPrev:rp});
      setVerdict("");setRatings({});setSeen([]);setNotes("");caseId.current=crypto.randomUUID().slice(0,8);
    }catch(e){setErr((e as Error).message);}
    setBusy("");
  }

  const rep=res?.report;
  const feedback=()=>buildFeedback({mode,level,verdict,ratings,defectsSeen:seen,notes},rep,caseId.current);
  const warnings=rep?[
    ...rep.defects.filter((d:any)=>d.severity!=="info").map((d:any)=>({sev:d.severity,code:d.code,text:d.message})),
    ...rep.realism.findings.filter((d:any)=>d.severity==="warn").map((d:any)=>({sev:"warn",code:d.code,text:d.message})),
  ]:[];
  const infos=rep?[...rep.defects.filter((d:any)=>d.severity==="info"),...rep.realism.findings.filter((d:any)=>d.severity==="info")]:[];

  return <div className="v3"><div className="vs-wrap">
    <div className="vs-top"><div><h1>Validation studio</h1><p className="vs-sub">Private test tool. Photos are processed in memory and never stored.</p></div></div>

    <div className="vs-card"><h2>1. Your photos</h2>
      <div className="vs-row">
        <label className="vs-pick"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={pick(setSrcFile,setSrcUrl)}/>
          <strong>Source artwork photo</strong><br/><span className="vs-note">Your original print or framed piece</span>{srcUrl&&<img src={srcUrl} alt="Source preview"/>}</label>
        <label className="vs-pick"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={pick(setRefFile,setRefUrl)}/>
          <strong>Reference mockup</strong><br/><span className="vs-note">The room / frame photo to place it in</span>{refUrl&&<img src={refUrl} alt="Reference preview"/>}</label>
      </div>
      <p className="vs-note">Use the original camera files. The page reads the camera details (focal length) here on your device, then shrinks a copy to fit the preview's upload limit. Location data is never read or sent.</p></div>

    <div className="vs-card"><h2>2. What is the source?</h2>
      <div className="vs-modes">
        <label className={`vs-mode ${mode==="artwork-in-frame"?"on":""}`}><input type="radio" name="m" checked={mode==="artwork-in-frame"} onChange={()=>setMode("artwork-in-frame")}/><strong>Artwork only</strong><small>A bare print, placed inside the frame in the reference</small></label>
        <label className={`vs-mode ${mode==="framed-on-wall"?"on":""}`}><input type="radio" name="m" checked={mode==="framed-on-wall"} onChange={()=>setMode("framed-on-wall")}/><strong>Already framed</strong><small>A finished framed piece, placed on the wall (or replacing a picture)</small></label>
      </div>
      <details className="vs-mt12"><summary>Options</summary>
        <p><label>Realism level<br/><select value={level} onChange={(e)=>setLevel(e.target.value as Level)}>
          <option value="environment">environment (default): your pixels untouched, adds frame depth</option>
          <option value="strict">strict: your pixels untouched, wall shadow only</option>
          <option value="photographic">photographic: also adjusts your pixels (measured)</option></select></label></p>
        {mode==="framed-on-wall"&&<div className="vs-row"><label>Real width of the framed piece (cm), optional<input type="number" inputMode="decimal" value={pieceW} onChange={(e)=>setPieceW(e.target.value)}/></label>
          <label>Ceiling height (cm), optional<input type="number" inputMode="decimal" value={ceilH} onChange={(e)=>setCeilH(e.target.value)}/></label></div>}
      </details></div>

    <p><button onClick={generate} disabled={!srcFile||!refFile||!!busy} className="vs-full">{busy ? "Working…" : "Generate clean mockup"}</button></p>
    {busy&&<p className="vs-note" role="status">{busy}</p>}
    {err&&<p className="vs-err" role="alert">{err}</p>}

    {res&&rep&&<>
      <div className="vs-card"><h2>3. Compare</h2>
        <div className="vs-cmp">
          <figure><img src={res.srcPrev} alt="Source as analysed"/><figcaption>Source (as analysed)</figcaption></figure>
          <figure><img src={res.refPrev} alt="Reference as analysed"/><figcaption>Reference</figcaption></figure>
          <figure><img src={showOverlay&&res.overlayUrl?res.overlayUrl:res.mockupUrl} alt="Result"/><figcaption>{showOverlay?"Detection and placement overlay":"Clean mockup"}</figcaption></figure>
        </div>
        <p className="vs-flex">
          {res.overlayUrl&&<button className="sec" onClick={()=>setShowOverlay(v=>!v)}>{showOverlay?"Show clean mockup":"Show detection overlay"}</button>}
          <button onClick={()=>save(res.mockup,`mockup-${caseId.current}.jpg`)}>Download mockup</button></p>
        {rep.output&&<p className="vs-note">{rep.output.note} ({rep.output.px[0]}×{rep.output.px[1]} px)</p>}
      </div>

      <div className="vs-card"><h2>4. Quality</h2>
        <p><span className={`vs-badge ${rep.status}`}>{rep.status==="pass"?"Passed automatic checks":rep.status==="review"?"Needs your review":"Failed checks"}</span>{rep.needsManual&&<span className="vs-note"> · a person should confirm the placement</span>}</p>
        {warnings.length===0&&<p>No warnings. Please still look at the mockup at full size.</p>}
        <ul className="vs-w">{warnings.map((w:any,i:number)=><li key={i}><span className={`vs-tag ${w.sev==="blocker"?"fail":"review"}`}>{w.sev}</span><strong>{w.code}</strong><br/>{w.text}</li>)}</ul>
        {infos.length>0&&<details><summary>{infos.length} notes</summary><ul className="vs-w">{infos.map((w:any,i:number)=><li key={i}><strong>{w.code}</strong><br/>{w.message}</li>)}</ul></details>}
        {rep.corrections.length>0&&<><h2 className="vs-mt12">Suggested corrections</h2><ul className="vs-w">{rep.corrections.map((c:any,i:number)=><li key={i}><span className="vs-tag">{c.kind}</span><strong>{c.code}</strong><br/>{c.action}</li>)}</ul></>}
        <details className="vs-mt8"><summary>Fidelity and geometry numbers</summary>
          <table><tbody>
            {rep.qa.forward&&<tr><th>Forward fidelity</th><td>{rep.qa.forward.pass?"pass":"FAIL"} · ΔE {rep.qa.forward.meanDeltaE} (p95 {rep.qa.forward.p95DeltaE}) · SSIM {rep.qa.forward.ssim}</td></tr>}
            {rep.qa.crossCheck&&<tr><th>Independent cross-check</th><td>{rep.qa.crossCheck.pass?"pass":"FAIL"} · ΔE {rep.qa.crossCheck.meanDeltaE} (p95 {rep.qa.crossCheck.p95DeltaE}) · SSIM {rep.qa.crossCheck.ssim}</td></tr>}
            {rep.qa.integrity&&<tr><th>Scene untouched elsewhere</th><td>{rep.qa.integrity.pass?"pass":"FAIL"} ({rep.qa.integrity.changedOutsideAllowed} stray pixels)</td></tr>}
            <tr><th>Your pixels altered</th><td>{rep.qa.productPixelsModified?"yes (photographic level)":"no"}</td></tr>
            <tr><th>Source focal length</th><td>{rep.input.sourceFocal?`${rep.input.sourceFocal.px} px (${rep.input.sourceFocal.from})`:"not available"}</td></tr>
            <tr><th>Reference focal length</th><td>{rep.input.referenceFocal?`${rep.input.referenceFocal.px} px (${rep.input.referenceFocal.from})`:"not available"}</td></tr>
            <tr><th>Source size used</th><td>{rep.input.sourcePx.join("×")} (original {rep.input.sourceOriginalPx.join("×")})</td></tr>
          </tbody></table>
          <p className="vs-note">{rep.notes.join(" ")}</p></details>
      </div>

      <div className="vs-card"><h2>5. Your feedback</h2>
        <p>Overall<br/><span className="vs-flex">{(["good","acceptable","bad"] as const).map(v=><button key={v} className={verdict===v?"":"sec"} onClick={()=>setVerdict(v)}>{v}</button>)}</span></p>
        {RATING_KEYS.map(k=><div key={k} className="vs-m8">{RATING_LABEL[k]}<div className="vs-stars">{[1,2,3,4,5].map(n=><button key={n} className={ratings[k]===n?"on":""} onClick={()=>setRatings(r=>({...r,[k]:n}))} aria-label={`${RATING_LABEL[k]} ${n} of 5`}>{n}</button>)}</div></div>)}
        <p>What do you see?</p>
        {DEFECT_CHOICES.map(([k,label])=><label className="vs-chk" key={k}><input type="checkbox" checked={seen.includes(k)} onChange={(e)=>setSeen(s=>e.target.checked?[...s,k]:s.filter(x=>x!==k))}/>{label}</label>)}
        <p><textarea rows={3} placeholder="Notes (no customer names, please)" value={notes} onChange={(e)=>setNotes(e.target.value)}/></p>
        <p className="vs-flex">
          <button disabled={!verdict} onClick={()=>save(new Blob([JSON.stringify(feedback(),null,2)],{type:"application/json"}),`feedback-${caseId.current}.json`)}>Download feedback (JSON)</button>
          <button className="sec" disabled={!verdict} onClick={()=>navigator.clipboard?.writeText(JSON.stringify(feedback(),null,2))}>Copy feedback</button></p>
        <p className="vs-note">The feedback file holds ratings and numbers only: no images, file names or location.</p>
      </div>
    </>}
  </div></div>;
}
