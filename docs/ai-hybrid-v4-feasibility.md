# V4-P0 feasibility note (no API calls made, no credentials added)

Branch `experiment/ai-hybrid-v4`. Nothing here is committed or pushed.

## Evidence limits
`platform.openai.com` and `docs.bfl.ai` are not reachable from the build container, so vendor pages were NOT read directly. Figures below come from search snippets and third-party aggregators, which disagree. **Every number is "unverified" until checked on the vendor page by the owner or in an environment that can reach it, before any paid call (experiment gate).**

## What exists in the repo
- V3 Room Library (`lib/mockup-v3/rooms/*`): calibrated `targetQuad`, `pxPerCm`, `lightOverride`, wall-only `shadowMask`, procedural frame renderer (`product.ts`), `runRoomMockup` with post-checks (quad exact, no stretch, protected pixels). This is the deterministic baseline and the geometry source.
- Existing OpenAI integration (V2, do not touch): `lib/giftly-v2-director.ts` calls `/v1/images/generations` with `gpt-image-2`; `app/api/media/enhance/route.ts` calls `/v1/images/edits` (multipart, `image[]`) with `gpt-image-2`. `OPENAI_API_KEY` is read server-side from env. No Gemini, BFL, Replicate or fal integration. No SDK dependency (plain `fetch`). V4 should add its own adapter and must not import V2 routes.
- sharp is available for masks, resampling and the final composite.

## Best approach
Bounded "frame-ring + shadow" edit with deterministic art reinsertion:
1. V3 produces the baseline composite and the exact art quad.
2. Build an edit mask = frame/mount ring plus a shadow band on the wall, **excluding the art quad (eroded inward by a few px) and all furniture** (reuse `shadowMask` polygons).
3. The model gets the baseline crop (art region filled with a neutral placeholder or the V3 art, since it must not be repainted anyway) and the mask; it only restyles moulding, bevels, contact shadow, light/reflection.
4. Final = baseline outside the mask (hard guarantee for room pixels) with the model output inside the mask; then the original art is re-warped by the same homography and composited last over the art quad. Report ΔE/pixel diffs for art and for outside-mask regions; reject on any protected-pixel change.
Models treat masks as soft guidance, so the guarantee must come from our composite, not from the model.

## Two candidates
| | OpenAI `gpt-image-2` (`/v1/images/edits`) | Black Forest Labs FLUX.1 Fill [pro] (`/v1/flux-pro-1.0-fill`) |
|---|---|---|
| Masking | Alpha-channel mask (transparent = editable), per summaries | Separate B/W mask (white = inpaint) or transparent PNG/WebP; seen on BFL docs snippet |
| Reference images | Multiple `image[]` inputs (sources say 5–16, unverified); can pass a frame-style reference | Single image + mask; no style reference input |
| Output size | Sources claim up to ~2K–4K, flexible sizes (unverified). Edit crop at 1024–2048 px is plenty | Roughly ≤ ~4 MP class; unverified; crop of the frame region fits |
| Cost per edit | Token-based; third-party estimates ~$0.04–0.21 per medium–high 1024-class image plus input-image tokens; unverified | Flat ~$0.05 per image on aggregators; unverified |
| Latency | Often tens of seconds (not verified) | Typically seconds to ~20 s, async polling (not verified) |
| Integration | Already in repo conventions, key env var exists | New key `BFL_API_KEY` or Replicate token; new adapter, polling |
| Risk | May alter unmasked pixels slightly (mitigated by our composite); prompt adherence good for materials/light | Mask-faithful inpainting, weaker at coherent lighting from prompt alone; no reference |

**Recommendation:** run the single experiment with `gpt-image-2` edits (no new vendor/credential; reference image can carry frame style). Keep FLUX.1 Fill [pro] as the fallback if the model repaints outside the mask in a way the composite hides badly (e.g. seams). Gemini image models were also found but masking/reference limits were not confirmed, so they were excluded.

## Minimal implementation plan (V4-P1, then one P2 run)
1. `lib/mockup-v4/editor.ts`: `HybridImageEditor` interface `{edit({image,mask,prompt,references?}) => Promise<Buffer>}`, no logging of content.
2. `lib/mockup-v4/mask.ts`: build ring+shadow mask from the V3 placement; erode art quad; subtract exclude polygons; export crop box and alpha mask.
3. `lib/mockup-v4/composite.ts`: baseline outside mask, model inside, deterministic art reinsertion; compute protected-pixel and art-fidelity metrics; reject on failure.
4. `lib/mockup-v4/adapters/mock.ts` (tests) and `adapters/openai.ts` (not run). Env var `OPENAI_API_KEY` read server-side only.
5. `tests/mockup-v4/*`: mask excludes art and furniture, composite leaves outside-mask pixels byte-identical, art preserved, adversarial mock that repaints art/furniture is rejected.
6. `scripts/v4-experiment.ts`: dry-run by default (prints request size, estimated cost, no network); paid call only with `--approve-paid` and a spend cap. Output to git-ignored folder: room / art / V3 baseline / V4 candidate / zoomed detail side-by-side, parameters and cost, no secrets, EXIF stripped.
7. Room asset: a rights-cleared cozy empty-wall room is required (none exists; the synthetic room is too plain to judge realism). Needs owner supply or approval.

## Needed from the owner before P2
- Rights-cleared furnished room image and its control points/scale.
- Approval for one paid call, the exact model/price confirmed on the vendor page, and a spend cap.
- Confirmation the existing `OPENAI_API_KEY` may be used (no new credential added by me).
