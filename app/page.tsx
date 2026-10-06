"use client";
import {useMemo,useState} from "react";

type Platform="Instagram"|"Facebook"|"Google Business";
type Status="New"|"Ready"|"Scheduled"|"Published";
type Item={id:string;title:string;category:string;status:Status;platforms:Platform[];website:boolean;caption:string;format:string;scheduled?:string};

const sample:Item={
  id:"GAP-0003",
  title:"Decorative Plate & Object Framing",
  category:"Bespoke Framing",
  status:"Ready",
  platforms:["Instagram","Facebook"],
  website:true,
  format:"Square / Carousel-ready",
  caption:"A recent bespoke framing project completed in our Maidstone studio.\n\nThis decorative plate was presented in a black wooden box frame, giving the piece enough depth to sit securely while keeping the focus on its colour, texture and character.\n\nHave something unusual or special that you would like framed? Send us a photo for a quote."
};

export default function Home(){
  const [items,setItems]=useState<Item[]>([sample]);
  const [filter,setFilter]=useState<Status|"All">("All");
  const [edit,setEdit]=useState<Item|null>(null);
  const [prompt,setPrompt]=useState("");
  const [publish,setPublish]=useState<Item|null>(null);
  const [schedule,setSchedule]=useState<Item|null>(null);
  const shown=useMemo(()=>filter==="All"?items:items.filter(x=>x.status===filter),[items,filter]);

  const update=(id:string,patch:Partial<Item>)=>setItems(xs=>xs.map(x=>x.id===id?{...x,...patch}:x));
  const counts=(s:Status)=>items.filter(x=>x.status===s).length;

  return <div className="shell">
    <aside className="side">
      <div className="brand">Giftly Content Studio</div>
      <div className="nav">
        <button className="active">Dashboard</button>
        <button>New Content</button>
        <button>Ready to Publish</button>
        <button>Scheduled</button>
        <button>Published</button>
        <button>Website Content</button>
        <button>Media Library</button>
      </div>
    </aside>
    <main className="main">
      <div className="top">
        <div><h1>Content Dashboard</h1><div className="sub">Review, edit, schedule and publish from one screen.</div></div>
        <button className="primary" onClick={()=>alert("Upload integration will connect to Google Drive.")}>+ New Content</button>
      </div>

      <div className="stats">
        <div className="stat"><b>{counts("New")}</b><span>New</span></div>
        <div className="stat"><b>{counts("Ready")}</b><span>Ready</span></div>
        <div className="stat"><b>{counts("Scheduled")}</b><span>Scheduled</span></div>
        <div className="stat"><b>{counts("Published")}</b><span>Published</span></div>
      </div>

      <div className="toolbar">{(["All","New","Ready","Scheduled","Published"] as const).map(s=><button key={s} className={"chip "+(filter===s?"on":"")} onClick={()=>setFilter(s)}>{s}</button>)}</div>

      {shown.map(item=><section className="card" key={item.id}>
        <div className="preview">
          <div className="platforms">{item.platforms.map(p=><span className="platform" key={p}>{p}</span>)}</div>
          <div className="placeholder"><strong>Project preview</strong>Decorative plate / object framing<br/>Black wooden box frame</div>
        </div>
        <div className="content">
          <div className="eyebrow">{item.category}</div>
          <div className="title">{item.title}</div>
          <div className="meta"><span>{item.id}</span><span>{item.format}</span><span className="status">{item.status.toUpperCase()}</span></div>
          <div className="caption">{item.caption}</div>
          <label className="switch"><input type="checkbox" checked={item.website} onChange={e=>update(item.id,{website:e.target.checked})}/><b>Website</b> — include in Recent Work</label>
          <div className="row end">
            <button className="secondary" onClick={()=>setEdit(item)}>Edit</button>
            <button className="secondary" onClick={()=>setSchedule(item)}>Schedule</button>
            <button className="primary" onClick={()=>setPublish(item)}>Publish</button>
          </div>
        </div>
      </section>)}

      {edit&&<div className="modal"><div className="dialog">
        <h2>Edit with a prompt</h2>
        <div className="hint">Describe the change naturally. Example: “Make the frame 10% larger, reduce the text and keep the design more minimal.”</div>
        <div className="field"><label>Editing prompt</label><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="What should change?"/></div>
        <div className="field"><label>Caption</label><textarea value={edit.caption} onChange={e=>setEdit({...edit,caption:e.target.value})}/></div>
        <div className="row end"><button className="secondary" onClick={()=>{setEdit(null);setPrompt("")}}>Cancel</button><button className="primary" onClick={()=>{update(edit.id,{caption:edit.caption});alert("AI image edit adapter is ready to be connected.");setEdit(null);setPrompt("")}}>Create new version</button></div>
      </div></div>}

      {schedule&&<div className="modal"><div className="dialog">
        <h2>Schedule content</h2>
        <div className="field"><label>Date and time</label><input id="when" type="datetime-local"/></div>
        <div className="hint">Platforms: {schedule.platforms.join(" + ")}</div>
        <div className="row end"><button className="secondary" onClick={()=>setSchedule(null)}>Cancel</button><button className="primary" onClick={()=>{update(schedule.id,{status:"Scheduled"});setSchedule(null)}}>Confirm schedule</button></div>
      </div></div>}

      {publish&&<div className="modal"><div className="dialog">
        <h2>Publish now?</h2>
        <p>This will publish the approved image and caption to: <b>{publish.platforms.join(" + ")}</b>.</p>
        <div className="field"><label><input type="checkbox" defaultChecked/> Instagram</label><label><input type="checkbox" defaultChecked/> Facebook</label><label><input type="checkbox"/> Google Business</label></div>
        <div className="row end"><button className="secondary" onClick={()=>setPublish(null)}>Cancel</button><button className="primary" onClick={()=>{update(publish.id,{status:"Published"});setPublish(null)}}>Confirm & Publish</button></div>
      </div></div>}
    </main>
  </div>
}
