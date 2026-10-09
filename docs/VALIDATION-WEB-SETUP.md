# Validation web interface: Vercel setup (Preview only)

Status: built and tested on `feat/mockup-engine-v3`, **not pushed, not deployed**. Nothing here touches
Production or `main`.

## What it is

`/validation` on a Preview deployment. Upload a source photo and a reference photo, choose
"Artwork only" or "Already framed", generate, compare side by side, see warnings and suggested
corrections, download the mockup, download feedback as JSON.

* **Stateless.** Photos travel in one request, are processed in memory and come back in the response. No
  database, no Blob store, no files written, no image URL. Previews and downloads use `blob:` URLs that
  exist only in your browser tab.
* **EXIF.** Your browser reads the camera facts from the original (make, model, focal length, sensor/crop
  sizes) with a tiny reader that cannot even parse the GPS block, then sends a *re-encoded* copy that has
  no metadata at all. Only the whitelisted facts go up as a small JSON; any other key (GPS, dates,
  anything) is rejected by the server. Output JPEGs carry no EXIF, XMP or IPTC.
* **Size.** The page shrinks to fit Vercel's ~4.5 MB request limit: reference to at most 2400 px (the engine
  uses 2400 anyway), source to at most 3600 px, quality first, dimensions only if needed. The report says
  how much the source was reduced. The download is a JPEG sized for the 4.5 MB response limit; lossless
  full-size output needs the local run.

## Verified limits (Hobby)

| Item | Value | Source |
|---|---|---|
| Function duration | default and maximum 300 s **with Fluid Compute**; 60 s max without it | Vercel limits docs (found via search; vercel.com itself is not reachable from this build sandbox, so please re-check on your dashboard) |
| Function memory | up to 2 GB (Fluid), 1 GB on the legacy setting | same |
| Request/response body | ~4.5 MB | Vercel docs; not confirmed from here, so the code budgets 4.4 MB and tests it |

Measured locally on synthetic photos of the maximum upload size: 14 s (artwork in frame) and 23 s
(framed on wall, photographic) of compute, peak memory about 530–700 MB including the test fixtures.
Vercel's CPU may be slower. `maxDuration` is set to **60 s**, which is valid with or without Fluid.
If Fluid Compute is on for your project and a run times out, tell me and I raise it to 300.

## Verified vs unverified about your Vercel account

I have no access to your Vercel account, so **I cannot see** your environment variable scopes,
Deployment Protection state, or whether previews already exist. The code is therefore defensive:

* It refuses to run unless `VERCEL_ENV === "preview"`.
* It refuses to run (HTTP 503, naming the variable, never its value) if **any** V2/production credential
  is visible to the deployment: `CONTENT_FEED_TOKEN`, `CONTENT_FEED_URL`, `OPENAI_API_KEY`,
  `METRICOOL_USER_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID`, `BLOB_READ_WRITE_TOKEN`.
* The validation code never reads any of those variables (a test scans for it).

## Step by step

Do these in the Vercel dashboard (vercel.com, your project). Do **step 1 and 2 before pushing anything**.

### 1. Check what already exists

1. Project → **Deployments**: is there any deployment for branch `feat/mockup-engine-v3`? If the Git
   integration is on, pushing a branch creates a Preview automatically.
2. Project → **Settings → Git**: note the *Production Branch* (should be `main`). Under
   "Ignored Build Step" nothing is required.

### 2. Turn on Vercel Authentication for Previews (primary protection)

1. Project → **Settings → Deployment Protection**.
2. **Vercel Authentication**: ON, scope **"Standard Protection"** (covers Preview deployments; Production
   can stay as it is). Save.
3. Test later: open the Preview URL in a private window. You must be asked to log in to Vercel.
   (If you see the page directly, protection is not on. Stop and tell me.)

### 3. Check Environment Variables scopes (do not trust defaults)

1. Project → **Settings → Environment Variables**.
2. For each existing variable look at the environment badges. `CONTENT_FEED_URL`, `CONTENT_FEED_TOKEN`,
   `OPENAI_API_KEY`, `METRICOOL_USER_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID` must show
   **Production only**. If any shows Preview (or "All Environments"), open it → **Edit** → untick
   **Preview** and **Development** → Save.
   *This matters*: the validation page deliberately refuses to start while those are visible to the
   Preview, and V2 routes in a Preview should not hold live credentials anyway.
3. Add the new variables (button **Add New**), and for each one tick **only Preview**:

   | Name | Value | Environment |
   |---|---|---|
   | `VALIDATION_UI_ENABLED` | `1` | **Preview only** |
   | `VALIDATION_PASSWORD` | a long passphrase (12+ characters, e.g. four random words) | **Preview only**, mark **Sensitive** |
   | `VALIDATION_SESSION_SECRET` | 32+ random characters (a password manager's generator is fine) | **Preview only**, mark **Sensitive** |

   Use "Sensitive" where offered; those values cannot be read back after saving. Never paste these into
   chat or Git.
4. Re-open each of the three new variables and confirm that Production and Development are **not** ticked.

### 4. Production safety check

Production must **not** have `VALIDATION_UI_ENABLED`. Even if it did, the code returns 404 outside Preview.
Production Branch stays `main`; this branch is never merged.

### 5. Confirm Function settings (Hobby)

Project → **Settings → Functions**: note whether **Fluid Compute** is on. Tell me; if it is, I can raise the
limit from 60 s to 300 s later if you need.

### 6. Approve, then I push

When you tell me steps 2 and 3 are done and approve, I push `feat/mockup-engine-v3` (this creates one
Preview deployment) and give you the Preview URL to test in this order:

1. Private window → Vercel login appears (layer 1).
2. Sign in → app password page appears (layer 2).
3. Wrong password is refused; right password opens the studio.
4. Upload two photos, generate, compare, download, download feedback JSON.
5. Check that the downloaded JPEG has no metadata (right-click → properties) and the feedback JSON has
   no file names.

### Rotating or removing access

* Change the password: edit `VALIDATION_PASSWORD` → Save → **Redeploy** the Preview.
* Kill all sessions: change `VALIDATION_SESSION_SECRET` → Redeploy.
* Switch the interface off: delete `VALIDATION_UI_ENABLED` → Redeploy. The routes return 404.

## What the tests prove (tests/web)

Environment guard (production/dev/missing secrets/each production credential), password and session
(tamper, expiry, wrong secret, brute-force lockout, cookie flags), CSRF/origin checks, size and type
limits, camera metadata whitelist (GPS rejected; the browser reader never parses GPS; corrupted EXIF is
survivable), end-to-end run in which nothing is written to disk, nothing is logged, outputs have no
metadata and reports carry no file names, one run at a time, middleware only matches the validation
paths (V2 routes untouched), no storage SDKs, and browser code only calls `/api/validation/*`.
A real Chromium run at desktop and iPhone sizes confirmed the upload carries no EXIF or GPS.

## Known limits

* Login throttling is per server instance (serverless instances do not share memory). Vercel Authentication
  is the primary barrier; the app password is the second.
* Sharpness checks run on the shrunken upload.
* No full-resolution lossless output on Hobby's request limits.
* Automatic realism limits stay provisional and uncalibrated.
