# V4-P1 technical report (branch `experiment/ai-hybrid-v4`)

Scope: provider-neutral hybrid editing plumbing, bounded mask, deterministic artwork reinsertion, integrity checks, adversarial mock tests, OpenAI adapter (built, never run), dry-run-by-default experiment script. **No paid or network API call was made, no credential was added, nothing was pushed/deployed/merged, V2 and Shopify are untouched.**

## Modules (`lib/mockup-v4/`)
| file | purpose |
|---|---|
| `types.ts` | `HybridImageEditor` interface (`edit({image,mask,prompt,references?})`), `EditorConstraints` |
| `mask.ts` | `buildEditMask` (frame/mount ring + wall-only shadow band; print + 2 px guard and furniture polygons subtracted; no shadow band at all without a wall mask), `chooseCrop` (16-aligned, aspect ≤ 3:1, inside scene, provider limits), `cropMask` |
| `composite.ts` | `compositeHybrid`: baseline bytes outside the mask, model pixels inside (feather inward only), then the original art re-projected with V3's `warpToQuad` and composited last |
| `integrity.ts` | `regionDelta` (ΔE76, changed-pixel count, p95, big-ΔE share), crop/paste |
| `run.ts` | `runHybridEdit`: validate → mask → crop → edit → paste → composite → checks → `accept`/`reject`; `printQuadFromPlan` |
| `prompt.ts` | frame-and-shadow instruction with explicit "do not change" clauses |
| `spend.ts` | `SpendGuard`: needs authorisation + cap + known per-call price + under cap + call limit (default 1) |
| `openai.ts` | request builder + adapter; refuses unverified models, consults the guard before any `fetch` |
| `mock.ts` | faithful editor and adversarial editors (repaint art / furniture, ghost object, global tint, wrong size, shifted) |
| `scripts/v4-experiment.ts` | dry run by default; writes baseline, request crop, mask overlay and `request_summary.json` to git-ignored `validation-output/` |

## OpenAI request schema: what was verified
Source: OpenAI's published OpenAPI spec (`github.com/openai/openai-openapi`, `openapi.yaml`, version 2.3.0, `CreateImageEditRequest`), read 2026-10-10. The vendor docs sites are not reachable from this container, so the guide pages were not read.
Verified and implemented: `POST /v1/images/edits` multipart; `model`, `prompt` (≤ 32000), `image` (≤ 16 files, png/webp/jpg, < 50 MB), `mask` (PNG < 4 MB, same size as the first image, **fully transparent pixels = area to edit**, applied to the first image), `size`, `quality` (low/medium/high/auto), `n`, `output_format`; response `data[0].b64_json` (always base64 for GPT image models). For `gpt-image-2`: arbitrary `WxH`, both divisible by 16, aspect within 1:3–3:1, max 3840×2160 (above 2560×1440 experimental), and **`input_fidelity` must be omitted** (the adapter never sends it; a test asserts this). `response_format` is not sent (unsupported for GPT image models).
Deliberately not implemented: other models (`gpt-image-1.5`, etc.) — documented, but their fixed sizes would need crop resizing; the adapter throws `MODEL_NOT_VERIFIED` for them.
**Not verified (not assumed):** price per image (absent from the spec), latency, any model-specific pixel/edge limit beyond the spec text ("must also satisfy the model's current pixel and edge limits"), and how faithfully `gpt-image-2` keeps pixels outside the mask in practice. The spec only says masks indicate where to edit; the pipeline therefore never relies on it.

## Safety design
- Outside the mask the final image is the baseline, byte for byte (`finalOutside.changed = 0`, 1.87 M pixels checked).
- The art is the deterministic re-warp (`finalArtVsWarp.changed = 0`); the engine's own art pixels agree with it at mean ΔE 0.58, p95 1.6 (resampling differences only; the check limit is 2.5).
- Model misbehaviour is measured separately and decides accept/reject, so a model that repaints art or furniture is **rejected, not silently hidden** (per the failure policy), even though the composite would hide it.
- Spend guard: nothing paid unless `--execute --authorize-paid --max-spend-usd N --price-per-image-usd P` and `OPENAI_API_KEY` exist; the guard also caps calls at 1. Tests prove `fetch` is never called otherwise, and that an invalid request reserves no spend.
- The experiment script was run without any flag (dry run, exit 0) and with `--execute` only (refused, exit 3). Both without a key.
- No fs, logging, storage or V2 imports in `lib/mockup-v4`; `process.env` only for `OPENAI_API_KEY` inside the adapter's default key reader (tests scan for this).

## Results
- `tsc --noEmit`: clean. Full suite: 37 files passed (1 skipped), 472 tests passed (9 skipped), V4 adds 31 tests across `tests/mockup-v4/{mask,hybrid,provider}.test.ts`.
- Adversarial outcomes on the 50×70 synthetic scene: faithful → accept; repaint art → reject; repaint plant → reject, plant byte-identical; ghost object on the wall → reject and removed from the output; global colour cast (mean ΔE 9.3) → reject; 3 px shift → reject (ΔE>10 share 1.85 %); wrong-size output → error, never composited.
- Mutation checks (10 mutants of guards/thresholds/schema): 3 initially survived (furniture subtraction and wall clipping were masked by an overlapping protection; the outside-mask mutant was equivalent); two tests were added and the mutants are now killed.

## Limitations
- Drift thresholds (`mean ΔE ≤ 4` art, `≤ 2.5` outside, p95 ≤ 8, ΔE>10 share ≤ 0.5 %) are **provisional**, set against mock behaviour, not a real model. Calibrate on the first real output, never loosen merely to pass.
- Mocks cannot show how a real model's output looks; no visual realism has been judged.
- The scenario crop is only 304×384 px (the synthetic room is 1600×1200), too small for a convincing generative result.
- Mask edge handling is a hard crop with 1 px inward feather; visible seams on real output are possible.
- Cost and latency are unknown until the owner confirms the price on OpenAI's page.

## Remaining requirements for the first real visual experiment
1. A rights-cleared, cozy, furnished room photo with an empty wall, ≥ 2500 px on the long side (so the frame crop is ≥ ~1000 px), plus its V3 calibration (control points, scale, light, wall/exclude polygons for furniture). A loader for a real room JSON + image and a non-synthetic artwork path in `scripts/v4-experiment.ts` (currently synthetic only).
2. Owner-verified `gpt-image-2` edit price (and whether to use `quality` medium or high) from OpenAI's pricing page, a spend cap, and explicit approval to run one paid call.
3. Confirmation that the existing `OPENAI_API_KEY` may be used (or a new key supplied by the owner in the environment; never committed).
4. Decide the upscale strategy for the small frame crop (send a 2–3× upscaled crop and downsample the result, or request a larger scene crop) and whether to pass a frame-style reference image.
5. After the first real output: calibrate the drift thresholds, inspect seams, mitre/grain realism and shadow agreement by eye, and record the cost/latency/size actually observed.
6. Human visual sign-off (V4-P3) before any Content Studio integration (V4-P4). Social export, EXIF scrub and a private Preview UI remain out of scope for now.
