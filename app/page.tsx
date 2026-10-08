"use client";

import { useEffect, useMemo, useState } from "react";

async function prepareImageForUpload(file: File): Promise<File> {
  const maxBytes = 700 * 1024;
  const supported = /^image\/(jpeg|png|webp)$/i.test(file.type || "");

  if (!supported) {
    if (file.size > maxBytes) {
      throw new Error("HEIC/HEIF files larger than 700 KB should be converted to JPEG before upload.");
    }
    return file;
  }

  if (file.size <= maxBytes) return file;

  const bitmap = await createImageBitmap(file);
  const maxSide = 1400;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare image for upload.");

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const toBlob = (quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not compress image."))),
        "image/jpeg",
        quality
      );
    });

  let quality = 0.78;
  let blob = await toBlob(quality);

  while (blob.size > maxBytes && quality > 0.42) {
    quality -= 0.07;
    blob = await toBlob(quality);
  }

  if (blob.size > maxBytes) {
    throw new Error("Image is still too large after compression. Please use a smaller JPEG or PNG.");
  }

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], baseName + ".jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

type Platform = "Instagram" | "Facebook" | "Google Business";
type Status = "New" | "Ready" | "Scheduled" | "Published";

type Item = {
  id: string;
  title: string;
  category: string;
  status: Status;
  platforms: Platform[];
  website: boolean;
  caption: string;
  format: string;
  scheduled?: string;
  media?: string[];
};

type MediaEntry = {
  fileId: string;
  fileName: string;
  category: string;
  url: string;
  driveUrl?: string;
  createdDate?: string;
};

type CampaignDraft = {
  concept: string;
  headline: string;
  supporting: string;
  cta: string;
  instagramCaption: string;
  facebookCaption: string;
  googleCaption: string;
};

type CampaignOutput = MediaEntry & {
  preset: string;
  width: number;
  height: number;
};

const MEDIA_BY_ID: Record<string, string[]> = {
  "GAP-0003": [
    "https://drive.google.com/thumbnail?id=14wK2A5acg9iBC76Uuze3psCKxv79euen&sz=w1400",
    "https://drive.google.com/thumbnail?id=1bz_bEldUK3cgX5CEaAf8CFhkZRpK3FMb&sz=w1400",
    "https://drive.google.com/thumbnail?id=1gv8F-SHZcOFGPetowjKtHfPv1fDqlQkV&sz=w1400",
  ],
};

export default function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<Status | "All">("All");
  const [view, setView] = useState<"dashboard" | "media">("dashboard");
  const [edit, setEdit] = useState<Item | null>(null);
  const [prompt, setPrompt] = useState("");
  const [publish, setPublish] = useState<Item | null>(null);
  const [schedule, setSchedule] = useState<Item | null>(null);
  const [metricoolMessage, setMetricoolMessage] = useState(
    "Free plan mode: publishing is handed off to ChatGPT + Metricool MCP."
  );
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [source, setSource] = useState("Loading...");
  const [message, setMessage] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("Bespoke Framing");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [testingUpload, setTestingUpload] = useState(false);
  const [uploadTestStatus, setUploadTestStatus] = useState("");
  const [mediaCategory, setMediaCategory] = useState("All");
  const [mediaLibrary, setMediaLibrary] = useState<MediaEntry[]>([]);
  const [moveTarget, setMoveTarget] = useState<MediaEntry | null>(null);
  const [moveFolder, setMoveFolder] = useState("Bespoke Framing");
  const [previewMedia, setPreviewMedia] = useState<MediaEntry | null>(null);
  const [enhanceTarget, setEnhanceTarget] = useState<MediaEntry | null>(null);
  const [enhancePrompt, setEnhancePrompt] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceStatus, setEnhanceStatus] = useState("");
  const [enhancePerspective, setEnhancePerspective] = useState(true);
  const [enhanceLighting, setEnhanceLighting] = useState(true);
  const [enhanceBackground, setEnhanceBackground] = useState(false);
  const [enhanceStraighten, setEnhanceStraighten] = useState(true);
  const [contentTarget, setContentTarget] = useState<MediaEntry | null>(null);
  const [contentPrompt, setContentPrompt] = useState("");
  const [contentReference, setContentReference] = useState<File | null>(null);
  const [creatingContent, setCreatingContent] = useState(false);
  const [contentStatus, setContentStatus] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approvalCampaign, setApprovalCampaign] = useState<CampaignDraft | null>(null);
  const [approvalOutputs, setApprovalOutputs] = useState<CampaignOutput[]>([]);
  const [approvalStatus, setApprovalStatus] = useState("");
  const [approvalScheduleAt, setApprovalScheduleAt] = useState("");
  const [hasSavedApproval, setHasSavedApproval] = useState(false);

  const loadContent = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content", { cache: "no-store" });
      const data = await res.json();
      const raw = Array.isArray(data.items) ? data.items : [];
      setMediaLibrary(Array.isArray(data.mediaLibrary) ? data.mediaLibrary : []);
      setItems(
        raw.map((item: Item) => ({
          ...item,
          media: item.media?.length ? item.media : MEDIA_BY_ID[item.id] || [],
        }))
      );
      setSource(
        data.source === "google-drive"
          ? "Google Drive + Content Tracker"
          : "Demo data"
      );
      setMessage(data.warning || data.message || "");
    } catch {
      setSource("Unavailable");
      setMessage("Could not load content.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContent();

    try {
      const saved = localStorage.getItem("giftly-latest-approval-v1");
      setHasSavedApproval(Boolean(saved));
    } catch {
      setHasSavedApproval(false);
    }
  }, []);

  useEffect(() => {
    if (!approvalOpen || !approvalCampaign || approvalOutputs.length === 0) return;

    try {
      localStorage.setItem(
        "giftly-latest-approval-v1",
        JSON.stringify({
          campaign: approvalCampaign,
          outputs: approvalOutputs,
          scheduleAt: approvalScheduleAt,
        })
      );
      setHasSavedApproval(true);
    } catch {
      // Approval still works even if browser storage is unavailable.
    }
  }, [approvalOpen, approvalCampaign, approvalOutputs, approvalScheduleAt]);

  const runSync = async () => {
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      setMessage(data.message || "Sync finished.");
      if (res.ok) await loadContent();
    } catch {
      setMessage("Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const shown = useMemo(
    () => (filter === "All" ? items : items.filter((x) => x.status === filter)),
    [items, filter]
  );

  const allMedia = useMemo(
    () =>
      mediaLibrary.filter((entry) => {
        if (mediaCategory === "All") return true;
        const category = (entry.category || "").toLowerCase();
        if (mediaCategory === "Framing") return category.includes("framing");
        if (mediaCategory === "Fine Art Print") return category.includes("fine art");
        if (mediaCategory === "Photo Gifts") return category.includes("gift");
        if (mediaCategory === "Iris Photo") return category.includes("iris");
        if (mediaCategory === "Business Print") return category.includes("business");
        return true;
      }),
    [mediaLibrary, mediaCategory]
  );

  const update = (id: string, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const counts = (status: Status) =>
    items.filter((x) => x.status === status).length;

  const copyPublishBrief = async (item: Item) => {
    const brief = [
      "Publish Giftly Art Print content now via Metricool:",
      "ID: " + item.id,
      "Title: " + item.title,
      "Platforms: " + item.platforms.join(", "),
      "Website Recent Work: " + (item.website ? "Yes" : "No"),
      "Caption:",
      item.caption,
    ].join("\n");

    await navigator.clipboard.writeText(brief);
    update(item.id, { status: "Ready" });
    setMetricoolMessage(
      "Publishing brief copied. Paste it into ChatGPT and I will publish it through Metricool."
    );
  };

  const deleteMedia = async (entry: MediaEntry) => {
    const ok = window.confirm("Delete this image from the Media Library? It will be moved to Google Drive Trash.");
    if (!ok) return;

    try {
      const res = await fetch("/api/media/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: entry.fileId }),
      });
      const data = await res.json();
      setMessage(data.message || (res.ok ? "Image deleted." : "Delete failed."));
      if (res.ok) {
        setMediaLibrary((xs) => xs.filter((x) => x.fileId !== entry.fileId));
      }
    } catch {
      setMessage("Delete failed.");
    }
  };

  const copyScheduleBrief = async (item: Item, when: string) => {
    const brief = [
      "Schedule Giftly Art Print content via Metricool:",
      "ID: " + item.id,
      "Title: " + item.title,
      "Platforms: " + item.platforms.join(", "),
      "Date/time (Europe/London): " + when,
      "Caption:",
      item.caption,
    ].join("\n");

    await navigator.clipboard.writeText(brief);
    update(item.id, { status: "Ready", scheduled: when });
    setMetricoolMessage(
      "Scheduling brief copied. Paste it into ChatGPT and I will schedule it through Metricool."
    );
  };

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">Giftly Content Studio</div>
        <div className="nav">
          <button
            className={view === "dashboard" ? "active" : ""}
            onClick={() => setView("dashboard")}
          >
            Dashboard
          </button>
          <button>New Content</button>
          <button
            onClick={() => {
              setView("dashboard");
              setFilter("Ready");
            }}
          >
            Ready to Publish
          </button>
          <button
            onClick={() => {
              setView("dashboard");
              setFilter("Scheduled");
            }}
          >
            Scheduled
          </button>
          <button
            onClick={() => {
              setView("dashboard");
              setFilter("Published");
            }}
          >
            Published
          </button>
          <button>Website Content</button>
          <button
            className={view === "media" ? "active" : ""}
            onClick={() => setView("media")}
          >
            Media Library
          </button>
        </div>
      </aside>

      <main className="main">
        {view === "dashboard" ? (
          <>
            <div className="top">
              <div>
                <h1>Content Dashboard</h1>
                <div className="sub">
                  Review, edit, schedule and publish from one screen.
                </div>
                <div className="sub">
                  Source: <b>{source}</b>
                  {message ? " · " + message : ""}
                </div>
                {metricoolMessage && (
                  <div className="sub">{metricoolMessage}</div>
                )}
              </div>
              <div className="row">
                <button
                  className="secondary"
                  disabled={syncing}
                  onClick={runSync}
                >
                  {syncing ? "Syncing..." : "Sync from Drive"}
                </button>
                <button
                  className="primary"
                  onClick={() => setUploadOpen(true)}
                >
                  + New Content
                </button>
              </div>
            </div>

            <div className="stats">
              <div className="stat">
                <b>{counts("New")}</b>
                <span>New</span>
              </div>
              <div className="stat">
                <b>{counts("Ready")}</b>
                <span>Ready</span>
              </div>
              <div className="stat">
                <b>{counts("Scheduled")}</b>
                <span>Scheduled</span>
              </div>
              <div className="stat">
                <b>{counts("Published")}</b>
                <span>Published</span>
              </div>
            </div>

            <div className="toolbar">
              {(["All", "New", "Ready", "Scheduled", "Published"] as const).map(
                (status) => (
                  <button
                    key={status}
                    className={"chip " + (filter === status ? "on" : "")}
                    onClick={() => setFilter(status)}
                  >
                    {status}
                  </button>
                )
              )}
            </div>

            {loading && <div className="stat">Loading content…</div>}
            {!loading && shown.length === 0 && (
              <div className="stat">No content found for this filter.</div>
            )}

            {shown.map((item) => (
              <section className="card" key={item.id}>
                <div className="preview">
                  <div className="platforms">
                    {item.platforms.map((platform) => (
                      <span className="platform" key={platform}>
                        {platform}
                      </span>
                    ))}
                  </div>

                  {item.media?.length ? (
                    <div className="mediaStage">
                      <img src={item.media[0]} alt={item.title} />
                      {item.media.length > 1 && (
                        <div className="thumbStrip">
                          {item.media.slice(1).map((src, index) => (
                            <img
                              key={src}
                              src={src}
                              alt={item.title + " " + (index + 2)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="placeholder">
                      <strong>Project preview</strong>
                      {item.title}
                      <br />
                      {item.category}
                    </div>
                  )}
                </div>

                <div className="content">
                  <div className="eyebrow">{item.category}</div>
                  <div className="title">{item.title}</div>
                  <div className="meta">
                    <span>{item.id}</span>
                    <span>{item.format}</span>
                    <span className="status">{item.status.toUpperCase()}</span>
                  </div>
                  <div className="caption">{item.caption}</div>

                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={item.website}
                      onChange={(event) =>
                        update(item.id, { website: event.target.checked })
                      }
                    />
                    <b>Website</b> — include in Recent Work
                  </label>

                  {uploadStatus && <div className="hint"><b>{uploadStatus}</b></div>}
              <div className="row end">
                    <button className="secondary" onClick={() => setEdit(item)}>
                      Edit
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setSchedule(item)}
                    >
                      Schedule
                    </button>
                    <button className="primary" onClick={() => setPublish(item)}>
                      Publish
                    </button>
                  </div>
                </div>
              </section>
            ))}
          </>
        ) : (
          <>
            <div className="top">
              <div>
                <h1>Media Library</h1>
                <div className="sub">
                  Drive-linked images currently available to Giftly Content
                  Studio.
                </div>
              </div>
              <div className="row">
                <button className="secondary" disabled={testingUpload} onClick={async()=>{
                  setTestingUpload(true);
                  setUploadTestStatus("Testing upload connection...");
                  try{
                    const res=await fetch("/api/upload/self-test",{cache:"no-store"});
                    const data=await res.json();
                    const upstream=data?.upstream;
                    if(res.ok && data.ok){
                      setUploadTestStatus("Upload connection OK" + (upstream?.fileId ? " · Test file created in Drive." : ""));
                    }else{
                      setUploadTestStatus("Upload test failed: " + (upstream?.error || data?.message || JSON.stringify(upstream || data)));
                    }
                  }catch(error){
                    setUploadTestStatus("Upload test failed: " + (error instanceof Error ? error.message : "Unknown error"));
                  }finally{
                    setTestingUpload(false);
                  }
                }}>{testingUpload?"Testing...":"Test Upload Connection"}</button>
                <button className="primary" onClick={() => setUploadOpen(true)}>Upload Images</button>
                {hasSavedApproval && (
                  <button className="secondary" onClick={()=>{
                    try{
                      const raw=localStorage.getItem("giftly-latest-approval-v1");
                      if(!raw) return;
                      const saved=JSON.parse(raw);
                      setApprovalCampaign(saved.campaign || null);
                      setApprovalOutputs(Array.isArray(saved.outputs) ? saved.outputs : []);
                      setApprovalScheduleAt(saved.scheduleAt || "");
                      setApprovalStatus("");
                      setApprovalOpen(true);
                    }catch{
                      setMessage("Saved approval could not be restored.");
                    }
                  }}>Resume Approval</button>
                )}
                <button className="secondary" onClick={() => setView("dashboard")}>Back to Dashboard</button>
              </div>
            </div>
            {uploadTestStatus && (
              <div className="stat" style={{marginBottom:12}}>
                {uploadTestStatus}
              </div>
            )}

            <div className="mediaFilters">
              {["All","Framing","Fine Art Print","Photo Gifts","Iris Photo","Business Print"].map((name)=>(
                <button
                  key={name}
                  className={mediaCategory===name ? "active" : ""}
                  onClick={()=>setMediaCategory(name)}
                >
                  {name}
                </button>
              ))}
            </div>

            <div className="mediaGrid">
              {allMedia.map((entry) => (
                <article className="mediaTile" key={entry.fileId}>
                  <button
                    className="mediaPreviewButton"
                    onClick={() => setPreviewMedia(entry)}
                    title="Open full preview"
                  >
                    <div className="mediaImageWrap">
                      <img src={entry.url} alt={entry.fileName} />
                    </div>
                  </button>
                  <div className="mediaTileInfo">
                    <b>{entry.fileName}</b>
                    <span>{entry.category}</span>
                    <div className="mediaInlineActions">
                      <button onClick={() => setPreviewMedia(entry)}>Preview</button>
                      <button onClick={() => {
                        setContentTarget(entry);
                        setContentPrompt("");
                        setContentReference(null);
                        setContentStatus("");
                      }}>Create Content</button>
                      <button
                        onClick={() => {
                          setMoveTarget(entry);
                          setMoveFolder(entry.category || "Bespoke Framing");
                        }}
                      >
                        Move
                      </button>
                      <button onClick={() => void deleteMedia(entry)}>Delete</button>
                    </div>
                  </div>
                </article>
              ))}
              {!loading && allMedia.length === 0 && (
                <div className="stat">No linked media yet.</div>
              )}
            </div>
          </>
        )}

        {uploadOpen && (
          <div className="modal">
            <div className="dialog">
              <h2>Upload image</h2>
              <div className="hint">Choose the service folder and upload the image. No Project ID is required.</div>
              <div className="field">
                <label>Upload folder</label>
                <select value={uploadCategory} onChange={(e)=>setUploadCategory(e.target.value)}>
                  <option value="Bespoke Framing">Framing</option>
                  <option value="Fine Art Printing">Fine Art Print</option>
                  <option value="Photo Gifts">Photo Gifts</option>
                  <option value="Iris Photography">Iris Photo</option>
                  <option value="Business Printing">Business Print</option>
                </select>
              </div>
              <div className="field">
                <label>Image</label>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(e)=>setUploadFile(e.target.files?.[0] || null)} />
              </div>
              <div className="row end">
                <button className="secondary" onClick={()=>{setUploadOpen(false);setUploadFile(null);setUploadStatus("")}}>Cancel</button>
                <button className="primary" disabled={uploading || !uploadFile} onClick={async()=>{
                  if(!uploadFile) return;
                  setUploading(true);
                  setMessage("");
                  setUploadStatus("Preparing image...");
                  try {
                    const prepared=await prepareImageForUpload(uploadFile);
                    setUploadStatus("Uploading...");
                    const form=new FormData();
                    form.append("file",prepared);
                    form.append("category",uploadCategory);
                    const controller=new AbortController();
                  const timeoutId=window.setTimeout(()=>controller.abort(),25000);
                  const res=await fetch("/api/upload",{method:"POST",body:form,signal:controller.signal});
                  window.clearTimeout(timeoutId);
                    const data=await res.json();
                    setMessage(data.message || (res.ok?"Upload complete.":"Upload failed."));
                    if(res.ok){
                      setUploadOpen(false);
                      setUploadFile(null);
                      await loadContent();
                    }
                  } catch(error) {
                    const text = error instanceof DOMException && error.name==="AbortError"
                      ? "Upload timed out after 25 seconds."
                      : error instanceof Error ? error.message : "Upload failed.";
                    setMessage(text);
                    setUploadStatus(text);
                  } finally {
                    setUploading(false);
                  }
                }}>{uploading?"Uploading...":"Upload to Drive"}</button>
              </div>
            </div>
          </div>
        )}

        {previewMedia && (
          <div className="modal mediaLightbox" onClick={() => setPreviewMedia(null)}>
            <div className="dialog mediaLightboxDialog" onClick={(e) => e.stopPropagation()}>
              <div className="mediaLightboxTop">
                <div>
                  <h2>{previewMedia.fileName}</h2>
                  <div className="hint">{previewMedia.category}</div>
                </div>
                <button className="secondary" onClick={() => setPreviewMedia(null)}>Close</button>
              </div>
              <div className="mediaFullPreview">
                <img src={previewMedia.url} alt={previewMedia.fileName} />
              </div>
              <div className="row end">
                <button
                  className="secondary"
                  onClick={() => {
                    setMoveTarget(previewMedia);
                    setMoveFolder(previewMedia.category || "Bespoke Framing");
                    setPreviewMedia(null);
                  }}
                >
                  Move
                </button>
                <button
                  className="secondary"
                  onClick={() => void deleteMedia(previewMedia)}
                >
                  Delete
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setContentTarget(previewMedia);
                    setContentPrompt("");
                    setContentReference(null);
                    setContentStatus("");
                    setPreviewMedia(null);
                  }}
                >
                  Create Content
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    setEnhanceTarget(previewMedia);
                    setEnhanceStatus("");
                    setPreviewMedia(null);
                  }}
                >
                  Enhance
                </button>
              </div>
            </div>
          </div>
        )}

        {approvalOpen && approvalCampaign && (
          <div className="modal">
            <div className="dialog approvalDialog">
              <div className="approvalHead">
                <div>
                  <h2>Approve campaign</h2>
                  <div className="hint">Review the finished platform pack and captions before publishing.</div>
                </div>
                <button className="secondary" onClick={()=>setApprovalOpen(false)}>Close</button>
              </div>

              <div className="approvalVisuals">
                {approvalOutputs.map((output)=>(
                  <div className="approvalVisual" key={output.fileId}>
                    <img src={output.url} alt={output.preset} />
                    <b>{output.preset.replaceAll("_"," ")}</b>
                    <span>{output.width}×{output.height}</span>
                  </div>
                ))}
              </div>

              <div className="approvalCopy">
                <div className="field">
                  <label>Headline</label>
                  <input value={approvalCampaign.headline} onChange={(e)=>setApprovalCampaign({...approvalCampaign,headline:e.target.value})} />
                </div>
                <div className="field">
                  <label>Supporting line</label>
                  <input value={approvalCampaign.supporting} onChange={(e)=>setApprovalCampaign({...approvalCampaign,supporting:e.target.value})} />
                </div>
                <div className="field">
                  <label>CTA</label>
                  <input value={approvalCampaign.cta} onChange={(e)=>setApprovalCampaign({...approvalCampaign,cta:e.target.value})} />
                </div>
                <div className="field">
                  <label>Instagram caption</label>
                  <textarea value={approvalCampaign.instagramCaption} onChange={(e)=>setApprovalCampaign({...approvalCampaign,instagramCaption:e.target.value})} />
                </div>
                <div className="field">
                  <label>Facebook caption</label>
                  <textarea value={approvalCampaign.facebookCaption} onChange={(e)=>setApprovalCampaign({...approvalCampaign,facebookCaption:e.target.value})} />
                </div>
                <div className="field">
                  <label>Google Business caption</label>
                  <textarea value={approvalCampaign.googleCaption} onChange={(e)=>setApprovalCampaign({...approvalCampaign,googleCaption:e.target.value})} />
                </div>
              </div>

              <div className="field">
                <label>Schedule date & time (optional)</label>
                <input
                  type="datetime-local"
                  value={approvalScheduleAt}
                  onChange={(e)=>setApprovalScheduleAt(e.target.value)}
                />
                <div className="hint">Used only when you choose Approve & Schedule. Timezone: Europe/London.</div>
              </div>

              {approvalStatus && <div className="hint"><b>{approvalStatus}</b></div>}

              <div className="row end">
                <button className="secondary" onClick={()=>{
                  try{ localStorage.removeItem("giftly-latest-approval-v1"); }catch{}
                  setHasSavedApproval(false);
                  setApprovalOpen(false);
                  setApprovalCampaign(null);
                  setApprovalOutputs([]);
                  setApprovalScheduleAt("");
                }}>Discard Draft</button>
                <button className="secondary" onClick={()=>{
                  setApprovalOpen(false);
                  setApprovalStatus("Regenerate from the source image if you want a different concept.");
                }}>Regenerate later</button>

                <button className="secondary" disabled={!approvalScheduleAt} onClick={async()=>{
                  const feed=approvalOutputs.find((x)=>x.preset==="feed_4x5");
                  const story=approvalOutputs.find((x)=>x.preset==="story_9x16");
                  const google=approvalOutputs.find((x)=>x.preset==="google_business_1x1");
                  const brief=[
                    "Schedule this approved Giftly Art Print campaign via Metricool.",
                    "Timezone: Europe/London",
                    "Schedule date/time: " + approvalScheduleAt,
                    "",
                    "Instagram + Facebook Feed 4:5:",
                    feed?.driveUrl || feed?.url || "",
                    "Caption:",
                    approvalCampaign.instagramCaption,
                    "",
                    "Instagram Story 9:16:",
                    story?.driveUrl || story?.url || "",
                    "",
                    "Google Business 1:1:",
                    google?.driveUrl || google?.url || "",
                    "Caption:",
                    approvalCampaign.googleCaption,
                    "",
                    "Facebook caption:",
                    approvalCampaign.facebookCaption
                  ].join("\n");
                  await navigator.clipboard.writeText(brief);
                  setApprovalStatus("Approved schedule package copied. Paste it into ChatGPT and I will schedule it in Metricool.");
                }}>Approve & Schedule</button>

                <button className="primary" onClick={async()=>{
                  const feed=approvalOutputs.find((x)=>x.preset==="feed_4x5");
                  const story=approvalOutputs.find((x)=>x.preset==="story_9x16");
                  const google=approvalOutputs.find((x)=>x.preset==="google_business_1x1");
                  const brief=[
                    "Publish this approved Giftly Art Print campaign now via Metricool.",
                    "",
                    "Instagram + Facebook Feed 4:5:",
                    feed?.driveUrl || feed?.url || "",
                    "Instagram caption:",
                    approvalCampaign.instagramCaption,
                    "Facebook caption:",
                    approvalCampaign.facebookCaption,
                    "",
                    "Instagram Story 9:16:",
                    story?.driveUrl || story?.url || "",
                    "",
                    "Google Business 1:1:",
                    google?.driveUrl || google?.url || "",
                    "Google Business caption:",
                    approvalCampaign.googleCaption
                  ].join("\n");
                  await navigator.clipboard.writeText(brief);
                  setApprovalStatus("Approved publishing package copied. Paste it into ChatGPT and I will publish it via Metricool.");
                }}>Approve & Publish</button>
              </div>
            </div>
          </div>
        )}

        {contentTarget && (
          <div className="modal">
            <div className="dialog">
              <h2>Create content visual</h2>
              <div className="hint">
                Source: <b>{contentTarget.fileName}</b>. The original image is preserved.
              </div>

              <div className="field">
                <label>Visual idea (optional)</label>
                <textarea
                  value={contentPrompt}
                  onChange={(e)=>setContentPrompt(e.target.value)}
                  placeholder="Optional. Example: Show the frame being held in a warm modern interior. Leave blank and the system will choose the strongest concept automatically."
                />
              </div>

              <div className="field">
                <label>Reference image (optional)</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e)=>setContentReference(e.target.files?.[0] || null)}
                />
                <div className="hint">
                  Use this when you want the new visual to follow another image's layout, background, mood or style.
                </div>
              </div>

              <div className="field">
                <label>Output package</label>
                <div className="platformPack">
                  <b>Standard Platform Pack</b>
                  <span>Feed 4:5 · Story/Reel 9:16 · Google Business 1:1</span>
                </div>
              </div>

              {contentStatus && <div className="hint"><b>{contentStatus}</b></div>}

              <div className="row end">
                <button className="secondary" disabled={creatingContent} onClick={()=>{
                  setContentTarget(null);
                  setContentReference(null);
                  setContentPrompt("");
                  setContentStatus("");
                }}>Cancel</button>

                <button
                  className="primary"
                  disabled={creatingContent}
                  onClick={async()=>{
                    setCreatingContent(true);
                    setContentStatus("Preparing content visual...");
                    try{
                      const form=new FormData();
                      form.append("fileId",contentTarget.fileId);
                      form.append("category",contentTarget.category);
                      form.append("description",contentPrompt);

                      if(contentReference){
                        setContentStatus("Preparing reference image...");
                        const preparedRef=await prepareImageForUpload(contentReference);
                        form.append("reference",preparedRef);
                      }

                      setContentStatus("Creating content visual...");
                      const res=await fetch("/api/media/create-content",{
                        method:"POST",
                        body:form
                      });
                      const data=await res.json();
                      setContentStatus(data.message || (res.ok ? "Content visual created." : "Content generation failed."));

                      if(res.ok){
                        setApprovalCampaign(data.campaign || null);
                        setApprovalOutputs(Array.isArray(data.outputs) ? data.outputs : []);
                        setApprovalStatus("");
                        setApprovalScheduleAt("");
                        setApprovalOpen(true);
                        setContentTarget(null);
                        setContentReference(null);
                        setContentPrompt("");
                        await loadContent();
                        setMessage("Platform pack created and ready for approval.");
                      }
                    }catch(error){
                      setContentStatus(error instanceof Error ? error.message : "Content generation failed.");
                    }finally{
                      setCreatingContent(false);
                    }
                  }}
                >
                  {creatingContent ? "Creating..." : "Create visual"}
                </button>
              </div>
            </div>
          </div>
        )}

        {enhanceTarget && (
          <div className="modal">
            <div className="dialog">
              <h2>Enhance image</h2>
              <div className="hint">
                Original file will be preserved. A new <b>_enhanced</b> version will be created.
              </div>

              <div className="field enhanceChecks">
                <label><input type="checkbox" checked={enhancePerspective} onChange={(e)=>setEnhancePerspective(e.target.checked)} /> Correct perspective</label>
                <label><input type="checkbox" checked={enhanceStraighten} onChange={(e)=>setEnhanceStraighten(e.target.checked)} /> Straighten angle</label>
                <label><input type="checkbox" checked={enhanceLighting} onChange={(e)=>setEnhanceLighting(e.target.checked)} /> Improve lighting / white balance</label>
                <label><input type="checkbox" checked={enhanceBackground} onChange={(e)=>setEnhanceBackground(e.target.checked)} /> Clean distracting background</label>
              </div>

              <div className="field">
                <label>Additional instruction (optional)</label>
                <textarea
                  value={enhancePrompt}
                  onChange={(e)=>setEnhancePrompt(e.target.value)}
                  placeholder="Example: keep the black frame exactly as it is; remove only the distracting item on the left."
                />
              </div>

              {enhanceStatus && <div className="hint"><b>{enhanceStatus}</b></div>}

              <div className="row end">
                <button className="secondary" disabled={enhancing} onClick={()=>{
                  setEnhanceTarget(null);
                  setEnhancePrompt("");
                  setEnhanceStatus("");
                }}>Cancel</button>

                <button className="primary" disabled={enhancing} onClick={async()=>{
                  setEnhancing(true);
                  setEnhanceStatus("Creating enhanced version...");
                  try{
                    const res=await fetch("/api/media/enhance",{
                      method:"POST",
                      headers:{"Content-Type":"application/json"},
                      body:JSON.stringify({
                        fileId:enhanceTarget.fileId,
                        category:enhanceTarget.category,
                        prompt:enhancePrompt,
                        perspective:enhancePerspective,
                        lighting:enhanceLighting,
                        background:enhanceBackground,
                        straighten:enhanceStraighten
                      })
                    });
                    const data=await res.json();
                    setEnhanceStatus(data.message || (res.ok ? "Enhanced version created." : "Enhancement failed."));
                    if(res.ok){
                      await loadContent();
                      setMessage("Enhanced version created. Original preserved.");
                    }
                  }catch(error){
                    setEnhanceStatus(error instanceof Error ? error.message : "Enhancement failed.");
                  }finally{
                    setEnhancing(false);
                  }
                }}>{enhancing ? "Enhancing..." : "Create enhanced version"}</button>
              </div>
            </div>
          </div>
        )}

        {moveTarget && (
          <div className="modal">
            <div className="dialog">
              <h2>Move image</h2>
              <div className="hint">Choose the destination folder.</div>
              <div className="field">
                <label>Move to</label>
                <select value={moveFolder} onChange={(e)=>setMoveFolder(e.target.value)}>
                  <option value="Bespoke Framing">Framing</option>
                  <option value="Fine Art Printing">Fine Art Print</option>
                  <option value="Photo Gifts">Photo Gifts</option>
                  <option value="Iris Photography">Iris Photo</option>
                  <option value="Business Printing">Business Print</option>
                </select>
              </div>
              <div className="row end">
                <button className="secondary" onClick={()=>setMoveTarget(null)}>Cancel</button>
                <button className="primary" onClick={async()=>{
                  try{
                    const res=await fetch("/api/media/move",{
                      method:"POST",
                      headers:{"Content-Type":"application/json"},
                      body:JSON.stringify({
                        fileId:moveTarget.fileId,
                        category:moveFolder
                      })
                    });
                    const data=await res.json();
                    setMessage(data.message || (res.ok ? "Image moved." : "Move failed."));
                    if(res.ok){
                      setMediaLibrary((xs)=>xs.map((x)=>x.fileId===moveTarget.fileId ? {...x,category:moveFolder} : x));
                      setMoveTarget(null);
                      await loadContent();
                    }
                  }catch(error){
                    setMessage(error instanceof Error ? error.message : "Move failed.");
                  }
                }}>Move image</button>
              </div>
            </div>
          </div>
        )}

        {edit && (
          <div className="modal">
            <div className="dialog">
              <h2>Edit with a prompt</h2>
              <div className="hint">
                Describe the change naturally. Example: “Make the frame 10%
                larger, reduce the text and keep the design more minimal.”
              </div>
              <div className="field">
                <label>Editing prompt</label>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="What should change?"
                />
              </div>
              <div className="field">
                <label>Caption</label>
                <textarea
                  value={edit.caption}
                  onChange={(event) =>
                    setEdit({ ...edit, caption: event.target.value })
                  }
                />
              </div>
              <div className="row end">
                <button
                  className="secondary"
                  onClick={() => {
                    setEdit(null);
                    setPrompt("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    update(edit.id, { caption: edit.caption });
                    setMetricoolMessage(
                      "Caption updated locally. AI image editing will be connected in the next phase."
                    );
                    setEdit(null);
                    setPrompt("");
                  }}
                >
                  Save new version
                </button>
              </div>
            </div>
          </div>
        )}

        {schedule && (
          <div className="modal">
            <div className="dialog">
              <h2>Schedule content</h2>
              <div className="field">
                <label>Date and time</label>
                <input id="when" type="datetime-local" />
              </div>
              <div className="hint">
                Platforms: {schedule.platforms.join(" + ")}
              </div>
              <div className="hint">
                Free plan: the scheduling brief is copied and ChatGPT sends it
                to Metricool MCP.
              </div>
              <div className="row end">
                <button
                  className="secondary"
                  onClick={() => setSchedule(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={async () => {
                    const input = document.getElementById(
                      "when"
                    ) as HTMLInputElement | null;
                    const when = input?.value || "";
                    if (!when) {
                      setMetricoolMessage("Choose a date and time first.");
                      return;
                    }
                    await copyScheduleBrief(schedule, when);
                    setSchedule(null);
                  }}
                >
                  Copy schedule brief
                </button>
              </div>
            </div>
          </div>
        )}

        {publish && (
          <div className="modal">
            <div className="dialog">
              <h2>Publish with ChatGPT</h2>
              <p>
                Free plan mode: this prepares the approved post for{" "}
                <b>{publish.platforms.join(" + ")}</b>. The publishing brief is
                copied so ChatGPT can send it through Metricool MCP.
              </p>
              <div className="field">
                <label>
                  <input type="checkbox" defaultChecked /> Instagram
                </label>
                <label>
                  <input type="checkbox" defaultChecked /> Facebook
                </label>
                <label>
                  <input type="checkbox" defaultChecked /> Google Business
                </label>
              </div>
              <div className="row end">
                <button
                  className="secondary"
                  onClick={() => setPublish(null)}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  onClick={async () => {
                    await copyPublishBrief(publish);
                    setPublish(null);
                  }}
                >
                  Copy & publish with ChatGPT
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
