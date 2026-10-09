# Real-photo validation — quick start

Goal: run the engine on YOUR real source artwork and reference mockups, look at the results, and
only then decide whether anything (including a QA limit) should change. Nothing here touches
production, `main` or V2. **Customer images never go into git** — the folders below are ignored,
and `npm run check:assets` plus a test fail if an image ever gets tracked.

## 1. Getting your files to the tool (pick one)

1. **Recommended — run it on your own computer.** Clone the repo, `git checkout feat/mockup-engine-v3`,
   `npm ci`, put your files in `validation-input/`, run the steps below. Your images never leave
   your machine. Afterwards you can share only `validation-output/share-bundle/numbers.json`
   (numbers and defect codes, no images, no file names) and any review sheets you choose.
2. **Expiring download link.** Put one `<file name> <https link>` per line in `links.txt` (links are
   secrets; delete the file afterwards) and run `npm run validate:fetch -- links.txt --delete-list`.
   In the cloud session this only works if the file host is allowed in the environment's network policy.
3. **Google Drive connector.** Works for small test files only; full-size originals are too large to
   pass through the chat.

Send **originals straight from the camera** (not WhatsApp/Messenger/screenshots): they carry the
EXIF focal length that makes proportions on angled photos verifiable. HEIC must be exported as JPEG
("Most Compatible" on iPhone, or Photos → Export → JPEG with metadata).

## 2. Folder convention

```
validation-input/
  A-01_source.jpg      the bare print photographed flat (workflow A)
  A-01_reference.jpg   the room/frame photo with the empty or old frame
  B-01_source.jpg      the finished framed piece (workflow B)
  B-01_reference.jpg   the room photo (empty wall, or a framed picture to replace)
  B-01_mask.png        OPTIONAL: white = something standing in front (plant, sofa edge)
  B-01.json            OPTIONAL: settings and notes
```
IDs starting `A` are workflow A, `B` workflow B (otherwise put `"mode"` in the JSON).

Optional `B-01.json`:
```json
{ "options": { "physicalWidthM": 0.62, "ceilingHeightM": 2.6 },
  "groundTruth": { "targetQuad": [[100,80],[900,85],[895,700],[98,690]] },
  "notes": "sofa in front-left" }
```
`groundTruth` (corners you click yourself, TL,TR,BR,BL in original pixels) is only used to MEASURE
accuracy; it is never given to the engine. Real sizes help placement scale; do not guess them.

## 3. Run

```
npm run validate:preflight -- validation-input     # checks each file (format, EXIF, resolution, messenger copies)
npm run validate:init -- validation-input          # writes manifest.json from the names
npm run validate:real -- --manifest validation-input/manifest.json --out validation-output
open validation-output/index.html
```
Default level is `environment` (the product's pixels are never recoloured); `photographic` is also
run for comparison and is opt-in.

## 4. What you get for every test (`validation-output/<ID>/<level>/`)

| # | Item | File |
|---|------|------|
| 1 | Original source | `source.jpg` (downscaled copy for viewing) |
| 2 | Reference | `reference.jpg` |
| 3 | Final clean mockup | `mockup.png` (full resolution, no text/branding) |
| 4 | Detection and placement overlay | `overlay.jpg` |
| 5 | Fidelity and geometry QA | `report.json`, section 5 of `case-report.md` |
| 6 | Visible realism defects | `case-report.md` section 6 (defect codes + measured realism checks) |
| 7 | Recommended targeted corrections | `case-report.md` section 7 (input / option / decision / engine) |

`sheet.jpg` shows source, reference and mockup side by side. Open the mockup at 100% — automatic
realism checks are provisional proxies, **your eye is the reference**.

## 5. Review and calibrate

Fill in each `review-template.json` (verdict `good` / `acceptable` / `bad`, 1–5 ratings, defects you
saw) and keep them in a folder, e.g. `validation-output/reviews/`. Then:

```
npm run calibrate -- --summary validation-output/summary.json --review validation-output/reviews
```
This compares the QA numbers on cases you judged good with the "sensitivity probes" (known damage
applied to each result that the cross-check must catch). Rules, fixed in code:

* Fewer than 10 reviewed good cases → no proposal at all.
* A limit is never loosened if that would let probes through (< 95 % caught) — the report says
  "cannot separate": fix the engine or the photo instead.
* Never more than 50 % looser; any loosening needs ≥ 20 good and ≥ 20 probe cases.
* Nothing is applied automatically. `--approve --by "Name" --reason "why"` writes
  `calibration/tolerances.approved.json` only if all rules hold; commit it deliberately.
* Tightening is always allowed.

Known gap on synthetic data (recorded by the probes): the lenient independent check does not yet
catch a 1.2 px blur or a 1.5 px shift of the product. Real-photo results decide whether that needs a
tighter, separately calibrated check; it will not be quietly relaxed or forgotten.

## 6. Sharing results

`npm run validate:bundle` → `validation-output/share-bundle/numbers.json`: numbers and defect codes only.
`--include-images` adds the review sheets and overlays (these show customer artwork — share on purpose).
