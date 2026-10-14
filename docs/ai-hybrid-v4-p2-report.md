# V4-P2 preparation report (branch `experiment/ai-hybrid-v4`)

**No paid API call was made, no credential added, nothing pushed/deployed/merged; Production V2 and Shopify untouched.** This is the dry-run preparation for ONE real visual experiment. The real room is not in the container, so everything below was exercised on a locally generated **synthetic-test pack** (a ray-traced stand-in room, NOT an AI photo). That pack is marked `provenance.kind = "synthetic-test"` and can never be sent to a paid model.

## What was added
| item | purpose |
|---|---|
| `lib/mockup-v4/pack.ts` | manifest schema + validation: rights cleared with licence note, empty wall confirmed, AI provenance (generator + date), non-customer artwork with licence, plain file names, V3 room calibration (all room codes surfaced as `PACK_ROOM_*`), wall mask required, frame spec valid for 30×40 and 60×80, `paidEligible` (AI room only), `describeLight` (calibrated light → prompt words) |
| `scripts/v4-pack.ts` | local loader: pack folder must be git-ignored (or outside the repo), files must not be git-tracked, ≤ 40 MB / ≤ 8000 px, decoded in memory (EXIF dropped, orientation applied), room ≥ 2400 px long side, artwork ≥ 1200 px, no transparency, calibrated size must equal the image size |
| `lib/mockup-v4/scenario.ts` | V3 baseline for an outer size at **full room resolution** (no downscale), art quad, wall mask, furniture polygons, moulding width in scene px |
| `lib/mockup-v4/request.ts` + `resample.ts` | request planner: integer upscale (×1–×4) until the moulding is ≥ 28 px wide in the request, 16-aligned, inside the provider limits; Lanczos image and crisp-mask resampling |
| `lib/mockup-v4/run.ts` | now handles upscaled requests; drift is measured against the model's own (resampled) input, so a resampling round trip is never mistaken for repainting |
| `scripts/v4-experiment.ts` | `--pack <dir> [--sizes 30x40,60x80]` dry run: validations, contact sheet, `dry_run_report.json`, request PNGs, paid-readiness checklist |
| `scripts/v4-make-demo-pack.ts` | writes the synthetic-test pack |

Sizes enabled for the experiment: 30×40 and 60×80 cm outer frame (portrait; the V3 engine supports all eight).

## Dry-run result (synthetic-test pack, room 3200×2400, both sizes)
Contact sheet: `contact_sheet.jpg` (row 1: room, artwork, calibration overlay; rows 2–3: calibrated placement, V3 baseline, edit mask, request image per size). All 26 offline checks pass:
- room calibration: reprojection rms/max 0.00 px; pack manifest valid;
- V3 baseline: quad exact, not stretched, placed aspect, protected pixels, engine gates;
- frame and print corners inside the image; print inside the frame; frame clear of furniture polygons;
- mask: 0 px on the print, 0 px on furniture, 0 px of shadow band off the wall (30×40: 0.59 %, 60×80: 1.49 % of the scene);
- request: 30×40 crop 336×400 → ×2 → 672×800 px; 60×80 crop 544×720 → ×2 → 1088×1440 px; moulding 33 px in the request (≥ 28); schema build OK (images 0.4/1.2 MB, masks 11/30 KB, limit 4 MB);
- offline composite with a faithful mock editor: 7.6 M / 7.4 M protected pixels byte-identical; print = exact deterministic re-warp (V3's own art vs the re-warp: mean ΔE 0.49 / 0.54); furniture pixels unchanged; mock verdict accept.

## Defects found and fixed while preparing
1. `resizeMask`: sharp returns 3 channels for a 1-channel raw resize, so the upscaled mask was garbled (39 k of 117 k pixels wrong). Found because the faithful mock was rejected at 30×40; fixed (`extractChannel(0)` + length guard) and covered by a test.
2. V3 `invertMat3` uses a tolerance relative to the largest matrix entry and wrongly reports "singular" for a small quad far from the origin in a large image (`warpToQuad` of a 1500×2000 print onto a ~170 px quad at x≈2000). V3 was not changed; V4 warps inside a bbox-sized canvas instead (`expectedArtLayer`). Worth a separate V3 fix later.
3. `tests/validation/runner.test.ts` deletes the whole `validation-output/` folder, which races with anything else writing there. V4 tests therefore write to the OS temp dir.

## Tests
`tsc --noEmit` clean; full suite 38 files passed (1 skipped), 491 tests passed (9 skipped) on three consecutive runs. New V4-P2 tests: manifest validation (rights, provenance, customer artwork, file names, frame specs), light wording, request planning limits, resampling helpers, upscaled hybrid edits (faithful accepted; tint and wrong-size adversaries rejected), loader refusals (missing file, size mismatch, unsafe name, transparent artwork, not-git-ignored folder, too-small room), end-to-end dry run on a pack (exit 0, contact sheet size, all checks pass, a synthetic pack refused even with every flag), too-small room (exit 5).

## Limitations visible in the sheet
- The synthetic room is plain and flat-lit; it says nothing about photoreal quality.
- The shadow band is a rigid offset rectangle; a model's soft shadow inside it will meet the unchanged wall at a hard rectangular boundary (1 px inward feather only). Likely to need a wider feather or a soft-edged band after seeing a real result.
- Drift thresholds are still provisional (never loosened to pass).
- Calibration of a real AI room needs hand-annotated control points; AI-generated rooms are often not perfectly rectilinear, so the 1.5 px residual limit may reject some images.

## Exact remaining requirements for ONE paid AI generation
**Owner-supplied assets** (in a git-ignored folder, e.g. `private-fixtures/v4-room-pack/`, never committed):
1. `room.(png|jpg|webp)`: an **AI-generated** cozy furnished room, **empty wall** (no frame, art, poster or text on it), **≥ 2400 px on the long side (3200 recommended)**, wall as one clean flat plane, a visible rectangular reference (door/window/skirting/corner) for calibration, furniture not overlapping the planned frame area (60×80 centred near the wall middle).
2. `artwork.(png|jpg)`: a licensed **non-customer** sample, ≥ 1200 px long side, opaque.
3. `manifest.json` (see `lib/mockup-v4/pack.ts`): `provenance.kind "ai-generated"` with generator name, generation date, licence note, `rightsCleared: true`, `emptyWallConfirmed: true`; `artwork.origin "sample"`, `customer: false`, licence note; frame colours/widths and description; `room` = V3 v2 room definition for that image: ≥ 4 (ideally 9) control points with wall-plane cm coordinates, scale as `ai-estimate` (illustrative, never "measured"), camera focal, calibrated light (direction, intensity, softness, colour temperature), safe region, **wall polygon(s) and furniture exclude polygons**. These annotations must pass the room validation (reprojection ≤ 1.5 px rms / 3 px max). I can build a small point-annotation helper if you prefer not to produce them by hand.
**Owner decisions / approvals**
4. Review of the dry-run contact sheet for the real pack (all checks green, mask and placement look right) and the `--approve-dry-run-sheet` acknowledgement.
5. Which single size to run first (`--size 60x80` or `30x40`), quality (medium by default).
6. The `gpt-image-2` image-edit **price per image from OpenAI's pricing page** (not in the API spec) → `--price-per-image-usd`, and a **spend cap** ≥ that price → `--max-spend-usd`.
7. Explicit approval for exactly one paid call (`--execute --authorize-paid`).
8. Permission to use the existing `OPENAI_API_KEY` from the environment (never written to the repo or logs). Note: the key has not been checked for access to `gpt-image-2` image edits; a 403 would still consume nothing but would end the run.
**Command (only after the above)**
`npx tsx scripts/v4-experiment.ts --pack private-fixtures/v4-room-pack --sizes 60x80 --size 60x80 --execute --authorize-paid --approve-dry-run-sheet --max-spend-usd <cap> --price-per-image-usd <price>` with `OPENAI_API_KEY` set in the environment. The script refuses unless the pack is AI-generated and rights-cleared, every offline validation passes, and all items of its printed readiness checklist are satisfied.
**After the call:** inspect baseline vs candidate vs raw model output, the drift metrics and `rejectReasons`, calibrate the thresholds, check seams at the band boundary, frame grain/mitres, shadow agreement, then decide on V4-P3 sign-off. No social output, Content Studio or Shopify work is part of this experiment.
