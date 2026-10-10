# AI Hybrid V4 — isolated visual proof of concept

**Status:** experiment only. Never merge into `main`, deploy, or promote without explicit owner approval. Production V2 must remain unchanged.

## Goal

Generate **one** photorealistic social-media mockup from:
1. one rights-cleared, cozy, furnished room image with an **empty wall** (no existing frame or art);
2. one non-customer sample artwork;
3. one realistic frame style, mount choice and **outer frame** size in {30x40, 40x30, 40x50, 50x40, 50x70, 70x50, 60x80, 80x60} cm.

## Core hybrid rule

Use the existing calibrated room placement pipeline to establish the **exact artwork quadrilateral and geometry**. Use an image-capable generative model **only for room-compatible frame material, bevels, contact shadows, light and reflection**, preferably in a tightly bounded mask. Do **not** allow the model to repaint or alter the artwork itself. Reinsert original artwork through a deterministic final composite and compare against its expected homography warp.

Do not claim pixel-perfect preservation when perspective resampling, colour conversion, shading or JPEG encoding change pixels. Report quantitative differences and visible errors. Keep an untouched high-quality master and a separate social export.

## Experiment gates

- Only sample, owned, or explicitly rights-cleared input assets; no real customer photos.
- Private, server-side model calls only; no browser-visible API keys. Use a provider/model that is **verified to support reference-image editing and masks**; do not guess an API or model name. Document actual model, price estimate and output size before any paid calls.
- Explicit owner approval **before a paid generation**, any cloud deployment, any new credential, or any GitHub push. No automatic push from hooks.
- No permanent storage of customer artwork; no content in application logs; scrub EXIF from exports. Experiment sample files may be retained locally in git-ignored output.
- Reuse V3 authentication and host allowlist if a future Preview UI is added. Do not visit the Safe Browsing-flagged Preview or bypass Chrome warnings.

## Implementation stages

**V4-P0:** Inspect the existing V3 room code, current dependencies and available model/provider integrations. Produce a feasibility note comparing 2 image-edit-capable providers with current documentation, masking capability, latency, output size, and approximate cost. No API calls yet.

**V4-P1:** Implement a provider-neutral `HybridImageEditor` interface, bounded edit mask, input validation, deterministic artwork reinsertion, and a visual comparison runner on a local isolated branch. Use mock adapters for tests.

**V4-P2:** With approval, run **one** paid generation on an approved empty-wall cozy room. Save a side-by-side of (room / artwork / V3 baseline / V4 candidate / zoomed detail). Capture generation parameters and cost, no secrets.

**V4-P3:** Evaluate before proceeding:
- room furnishings, walls, and décor unchanged outside edit and shadow regions;
- original artwork complete, not reinterpreted or cropped;
- outer frame scale illustrative but plausible relative to sofa, max 60x80 cm;
- correct perspective, mount, wood grain/mitres, glass effects;
- shadow direction, softness and light colour agree with room;
- no ghost frames, double artwork, hallucinated writing, extra objects;
- compare geometry, artwork fidelity, and region pixel integrity; human visual sign-off required.

**V4-P4:** Only after P2/P3 pass, plan Content Studio social output sizes, captions and Content Tracker/Drive integration. Shopify mobile configurator is out of scope.

## Failure policy

If AI edits the source artwork or furniture, **reject** the output rather than concealing the problem. If no editing model can reliably preserve the protected areas, fall back to AI-generated room/frame background plus deterministic compositing; do not repeatedly spend on unbounded generations.
