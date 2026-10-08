"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [uploadProjectId, setUploadProjectId] = useState("GAP-0003");
  const [uploadCategory, setUploadCategory] = useState("Bespoke Framing");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const loadContent = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content", { cache: "no-store" });
      const data = await res.json();
      const raw = Array.isArray(data.items) ? data.items : [];
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
  }, []);

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
      items.flatMap((item) =>
        (item.media || []).map((url, index) => ({ url, index, item }))
      ),
    [items]
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
                <button className="primary" onClick={() => setUploadOpen(true)}>Upload Images</button>
                <button className="secondary" onClick={() => setView("dashboard")}>Back to Dashboard</button>
              </div>
            </div>

            <div className="mediaGrid">
              {allMedia.map(({ url, index, item }) => (
                <article className="mediaTile" key={url}>
                  <img src={url} alt={item.title + " " + (index + 1)} />
                  <div className="mediaTileInfo">
                    <b>{item.title}</b>
                    <span>
                      {item.id} · Image {index + 1}
                    </span>
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
              <div className="hint">Upload a project image to Google Drive. It will be placed in 00 - UPLOAD HERE and linked to the selected project.</div>
              <div className="field">
                <label>Project ID</label>
                <select value={uploadProjectId} onChange={(e)=>setUploadProjectId(e.target.value)}>
                  {items.map((item)=><option key={item.id} value={item.id}>{item.id} — {item.title}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Category</label>
                <input value={uploadCategory} onChange={(e)=>setUploadCategory(e.target.value)} />
              </div>
              <div className="field">
                <label>Image</label>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(e)=>setUploadFile(e.target.files?.[0] || null)} />
              </div>
              <div className="row end">
                <button className="secondary" onClick={()=>{setUploadOpen(false);setUploadFile(null)}}>Cancel</button>
                <button className="primary" disabled={uploading || !uploadFile} onClick={async()=>{
                  if(!uploadFile) return;
                  setUploading(true);
                  setMessage("");
                  const form=new FormData();
                  form.append("file",uploadFile);
                  form.append("projectId",uploadProjectId);
                  form.append("category",uploadCategory);
                  try{
                    const res=await fetch("/api/upload",{method:"POST",body:form});
                    const data=await res.json();
                    setMessage(data.message || (res.ok?"Upload complete.":"Upload failed."));
                    if(res.ok){
                      setUploadOpen(false);
                      setUploadFile(null);
                      await loadContent();
                    }
                  }catch{
                    setMessage("Upload failed.");
                  }finally{
                    setUploading(false);
                  }
                }}>{uploading?"Uploading...":"Upload to Drive"}</button>
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
