# Real-photo validation workflow

Goal: prove (or disprove) on **your real photographs** that the V3 engine produces reliable,
genuine-looking mockups, and calibrate its tolerances on real data. Nothing here posts, deploys or
produces marketing graphics. Branch: `feat/mockup-engine-v3`.

## Ground rules the engine enforces
1. **The print is never cropped by default.** It is shown whole, at its true proportions, with a mount
   border if the opening's shape differs. Cropping happens only with an explicit `approvedCrop`.
2. **Product pixels are not recoloured.** At `strict` and `environment` (default) the artwork/frame
   pixels are only geometrically resampled (measured ΔE ≈ 0). `photographic` is opt-in and reported.
3. **Photorealism**: wall shadows, physically derived frame depth, and (opt-in) glass sheen and
   grain/softness matched to the *reference photo*; glare already baked into your source is detected.
4. **The reference decides**: a framed picture already in the reference is replaced in place; otherwise
   the piece goes on free wall with the room's perspective and scale.
5. **Clean mockup first**: no text, logo or CTA anywhere in the engine. Anything marketing-related must
   pass `requireApprovedMockup` with the exact approved pixels.

## What to send (please)
Original files straight from the camera: **JPEG with EXIF intact** (focal length is what makes angled
proportions verifiable). Not screenshots, not WhatsApp/Messenger copies, not edited or cropped.
iPhone HEIC: AirDrop to a Mac with "Most Compatible", or Share > Options > Format: "Most Compatible".

| # | Source photos (about 8) | Reference mockups (about 6) |
|---|---|---|
| 1 | Bare print, flat on a table, shot from above | Room with a framed picture, viewed head-on |
| 2 | Bare print, shot at an angle | Same kind of room, viewed at an angle |
| 3 | Bare print with a white margin | Empty wall, nothing in front |
| 4 | Dark artwork, and a very pale artwork | Empty wall with a sofa/shelf/plant in front |
| 5 | Framed piece (moulding + mount) on a plain wall | Black-framed and white/oak-framed pictures |
| 6 | Framed piece, shot at an angle | A room you like and one you do not (one line each) |
| 7 | Framed piece behind glass (some glare is fine, it is a test) | |
| 8 | An awkward one: low light, edges near the border | |

For each file, one line: intended workflow (A bare print into a frame, B framed piece onto a wall),
the **real size** (print in cm, framed piece outer size in cm), the room's ceiling height if known,
and anything that must not change.

**Optional but very valuable** for 3-4 files: the four corners you would pick by eye (pixel coordinates,
top-left, top-right, bottom-right, bottom-left), so accuracy can be measured. Phone markup tools show
pixel coordinates; or send a screenshot with the corners circled.

**How to share securely:** a private Google Drive folder (tell me its name) or attach in chat. Never public
links, never API keys or tokens in chat. The repository is public, so customer images are never committed:
inputs and outputs live in git-ignored folders (`validation-input/`, `validation-output/`,
`fixtures/private/`) and the runner refuses to write anywhere git would track. GPS is never copied into
reports (only "has GPS: true/false"); output images carry no metadata.

## Running it
```bash
mkdir validation-input            # git-ignored; put the originals + manifest.json here
cp docs/validation-manifest.example.json validation-input/manifest.json   # edit paths/options
npm run validate:real -- --manifest validation-input/manifest.json --out validation-output
open validation-output/index.html
```
Options: `--levels strict,environment,photographic`, `--only A-01,B-02`. Case fields are documented in
`lib/mockup-v3/validation/runner.ts` (`ValidationCase`). Manual inputs (`sourceQuad`, `targetQuad`,
`wallHint`, `occlusionMask`) are fallbacks; run first without them to measure automation.

## What you get per case and level
`mockup.png` (clean, full size), `sheet.jpg` (source | reference | result), `overlay.jpg` (what the
engine detected), `report.json`, plus `index.html`, `summary.json`. Each report states the status
(pass/review/fail), whether a person must confirm something, every defect with its reason, which values
came from EXIF vs defaults, accuracy against your marked corners, and the three measured quality gates
(forward fidelity, independent cross-check against the original photo, scene integrity).
`summary.json` also has the **real-photo metric distributions** used to set tolerances.

## Proposed acceptance criteria (for your approval before we rely on them)
| Area | Criterion |
|---|---|
| Automatic detection | Source and opening/placement corners within 0.5% / 1.0% of object size on at least 80% of cases; the rest are flagged (`needsManual`), never confidently wrong |
| Product fidelity (default levels) | Forward ΔE < 0.1 (pure resample); cross-check vs original photo: mean ΔE ≤ 2, p95 ≤ 8, chroma bias ≤ 0.5 |
| Scene integrity | 0 changed pixels outside placement + shadow + declared depth faces |
| Cropping | 0 unless approved |
| Looks like a photograph | Human review (below) scores 4/5 or better on at least 80% of mockups that pass automatically |
| Honesty | Every manual fix needed is predicted by a defect/`needsManual` flag (no silent failures) |

## Human visual review checklist (per mockup, 1-5)
Perspective and scale believable · shadows consistent with the room's light · frame depth plausible ·
grain/sharpness match the room photo · colours of the artwork look true · no halo/fringe at edges and
occluders · no leftover pieces of the old picture · no obvious glare carried over · nothing added
(text, logos, props). Note the two biggest tells for each case.

## After the first real run
We will (1) fix what the real data breaks, (2) replace the synthetic-calibrated tolerances with ones
derived from `summary.json`, (3) decide the default realism level with you from side-by-side results,
and only then (4) discuss anything beyond clean mockups.
