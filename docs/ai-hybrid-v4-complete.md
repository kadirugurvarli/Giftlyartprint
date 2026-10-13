# Giftly Content Studio AI Hybrid V4: status, run instructions, blockers

Branch `experiment/ai-hybrid-v4`. Local only: nothing pushed, deployed or merged; Production V2 and Shopify untouched (`app/`, `lib/giftly-*` unchanged; only `.gitignore` gained `v4-output/`). No paid call was made; no credential was added.

## What exists
| area | files | status |
|---|---|---|
| Room workflow | `scripts/v4-annotate.ts` (+`-server`, `tools/v4-annotate/index.html`), `lib/mockup-v4/annotation.ts`, `scripts/v4-pack.ts`, `lib/mockup-v4/roomgen.ts`, `scripts/v4-generate-room.ts` | done; **the real AI room does not exist yet** (blocker 1) |
| Engine | `lib/mockup-v4/engine.ts`, `styles.ts`, `intake.ts`, `run.ts`, `mask.ts`, `composite.ts`, `request.ts`, `openai.ts`, `scenario.ts` | done; AI edit path built and unit-tested with a fake provider, **never run for real** (blocker 2) |
| Studio test interface | `scripts/v4-studio.ts` (+`-server`), `tools/v4-studio/index.html` | done, local only (127.0.0.1) |
| Social + captions | `social.ts`, `captions.ts` | done |
| Tracker / Drive hand-off | `tracker.ts` | done; builds the exact existing payloads; sending is opt-in and was not run |
| Examples / visual checks | `scripts/v4-examples.ts` | synthetic engine demo only |

### Room workflow
1. **Brief and prompt** (`ROOM_BRIEF`, `buildRoomPrompt`): photoreal English living room, natural daylight, sofa, plants, books, a large EMPTY flat wall, a door/window frame as calibration reference, no art/text/people, level camera. `scripts/v4-generate-room.ts` prints the exact `gpt-image-2` generation request (2560×1440, quality high, schema verified against OpenAI's OpenAPI spec 2.3.0) and is a dry run unless `--execute --authorize-paid --max-spend-usd N --price-per-image-usd P` and `OPENAI_API_KEY` are all given.
2. **Annotation tool** (`npx tsx scripts/v4-annotate.ts`, http://127.0.0.1:4170): load the room image, click 1–4 known-size rectangles on the wall plane (door, window...), the wall outline and furniture outlines, set the safe box and the light. Live check uses the real V3 room validator (reprojection ≤ 1.5 px rms / 3 px max, perspective consistency, region inside the calibrated hull) and draws the projected safe region. "Save pack" writes `manifest.json` + room + artwork into a git-ignored folder after checking rights, provenance (generator, date), empty-wall confirmation, size ≥ 2400 px and a non-customer artwork licence. AI rooms are always "illustrative" scale.
3. **Loader** (`scripts/v4-pack.ts`) re-checks everything and refuses folders that are not git-ignored.

### Engine
- Sizes: all eight outer sizes 30×40 … 60×80 cm, portrait and landscape. Styles: walnut, oak, black, white, antique gold. Mounts: none, narrow, classic, wide. The print is never cropped or stretched (uniform "contain" into the mount window; artwork whose aspect cannot fit is refused and the UI disables those sizes).
- Modes: **baseline** (deterministic V3: perspective-exact quad, rendered frame with mount/depth, light from the calibrated room, wall-only shadows, protected pixels verified); **hybrid** (bounded frame+shadow mask → editor → drift checks → deterministic re-insertion of the original artwork); the editor is the offline mock (labelled NOT AI) or OpenAI.
- Regeneration: new variant = different prompt wording (and a new paid call, which the spend guard counts).
- A rejected AI result (it repainted art, furniture or the room) is never shown as success: the baseline is returned with `AI_RESULT_REJECTED_SHOWING_BASELINE`.

### Studio interface
`npx tsx scripts/v4-studio.ts --demo` (synthetic engine demo) or `--pack private-fixtures/<pack>`; open http://127.0.0.1:4180. Room, artwork upload, style, mount, size (sizes unsuitable for the artwork are disabled), engine mode, Preview, Regenerate, V3-baseline toggle, per-check list, then export. Artwork lives only in server memory (30 min TTL); previews write nothing; export writes a folder under `v4-output/` (git-ignored). Hardening: loopback bind, Host/Origin checks, CSP `default-src 'self'`, no CDN, no CORS, no logging of bodies, 50 MB body limit.
**Paid AI mode is off** unless the server is started with `--execute --authorize-paid --max-spend-usd N --price-per-image-usd P` (+ `OPENAI_API_KEY`), the chosen room is an AI-generated, rights-cleared pack, and the spend guard (default 1 call) allows it.

### Facebook / Instagram output
Formats (JPEG, sRGB, no metadata, ≤ 900 KB to fit the existing Drive upload route): feed 4:5 1080×1350 (same as the V2 preset), square 1080×1080, story/reel cover 9:16 1080×1920 (same as V2; safe zones top 13 %/bottom 20 %), Facebook landscape 1200×630. The whole frame always stays in the window with margins and safe zones; if it cannot, the format is refused instead of cropping. A lossless PNG master is also saved. No on-image text (the clean mockup comes first; headline/CTA/logo overlay is left to the existing V2 compositor rules).
Captions (English, ≤ 3 sentences, no prices/offers/delivery claims, IG 8 hashtags, FB 3) plus alt text that states the room is a visualisation.

### Content Tracker and Google Drive (no V2 change)
`tracker.ts` produces a feed item with the existing fields (`id,title,category,status:"New",platforms,website,format,caption`) plus `source:"v4-mockup"`, notes and files, and a Drive plan whose upload body is exactly what the V2 routes send (`action:"upload", category, fileName, mimeType, base64`). The export folder contains `tracker_row.json` and `drive_upload_plan.json`. Sending to Drive exists only behind `--allow-drive-push` + `CONTENT_FEED_URL`/`CONTENT_FEED_TOKEN` + a confirmation click, and was not run. Writing the tracker row into the sheet itself is not automated (the existing feed has no documented write action for items); import the JSON row manually or tell me the Apps Script action to target.

## Run locally
```
npm install
npx tsc --noEmit
npx vitest run                                            # full suite
npx tsx scripts/v4-examples.ts v4-output/examples         # synthetic example images
npx tsx scripts/v4-studio.ts --demo                       # studio on http://127.0.0.1:4180
npx tsx scripts/v4-annotate.ts                            # annotation tool on http://127.0.0.1:4170
npx tsx scripts/v4-generate-room.ts                       # DRY RUN of the AI room request
npx tsx scripts/v4-experiment.ts --pack private-fixtures/<pack>   # dry-run validation + contact sheet of a real pack
```

## Blockers (the only ones)
1. **No real AI-generated room exists, so no photographic quality is claimed.** Generating it is one paid `gpt-image-2` call. Needed: the model price per image from OpenAI's pricing page (not in the API spec), a spend cap, explicit approval, and permission to use `OPENAI_API_KEY`. Command after approval: `npx tsx scripts/v4-generate-room.ts --execute --authorize-paid --max-spend-usd <cap> --price-per-image-usd <price>`; then annotate it with the tool, review the dry-run contact sheet, and approve the room visually.
2. **The AI frame-edit generation** needs the same kind of approval (price, cap, key) and the room from (1).

## Known limits
Synthetic-room examples only; procedural frame (no wood grain/mitre realism until the AI edit is judged); no glass reflection; AI-room scale is illustrative; drift thresholds are provisional and need calibration on the first real result; social crops can cut furniture at the window edge (never the frame); 4:5/9:16 crops of a 16:9 room upscale slightly for 9:16.
