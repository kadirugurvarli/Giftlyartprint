# Room Library pilot (isolated feature branch `feat/room-library-pilot`)

Status: **phase 2, synthetic-room validated only**. Not connected to the Validation Studio UI, not deployed, not approved for commercial use. No real room asset, no customer photographs.

## What exists (`lib/mockup-v3/rooms/`)

- `schema.ts` (v2): room image, rights, **calibrated control points** (image px <-> wall cm, >= 4, may cover only part of a cropped wall), scale (method, basis, confidence, relative uncertainty), camera focal length (+ optional principal point), optional annotated lines, safe region, calibrated light, wall-only shadow mask. Allowed outer frame sizes: 30x40, 40x30, 40x50, 50x40, 50x70, 70x50, 60x80, 80x60 cm.
- `calibration.ts` / `validate.ts`: least-squares homography; reprojection RMS <= 1.5 px, max <= 3 px; perspective consistency (wall axes orthogonal and isotropic, implied focal vs stated focal within 15 % where it is observable, annotated lines <= 1.5 deg). Region must lie inside the control-point hull (+15 %).
- Scale: AI-generated rooms can never be "measured". They are capped at medium/low confidence, >= 5 % uncertainty, and every placement reports `physicalAccuracy: "illustrative"` with a disclosure and a width range.
- `aspect.ts`: source-frame aspect must match the outer size within 2 %. Artwork or frames are never stretched.
- `product.ts`: flat artwork -> procedural frame (moulding, mount, depth) rendered in real units at an integer px/cm; the print is placed with a uniform "contain" scale (mount absorbs the difference; refused if it fills < 70 %). Frame/mount edges are lightly softened, **print pixels never**.
- `light.ts` + engine override (`RealismOptions.lightOverride`, `shadowMask`): calibrated direction, intensity, softness, colour temperature (shadows tinted by the key light) and a wall-only mask built from wall/exclude polygons.
- `run.ts`: `runRoomMockup` orchestrates placement, rendering, the engine and post-checks (quad exact, not stretched, aspect, protected pixels, engine gates).

## Tests

`tests/rooms/*` on a synthetic ray-traced room: all eight sizes, lighting consistency, geometry, protected pixels, failure conditions, and ONE end-to-end integration test. Visual report: `npx tsx scripts/room-visual-report.ts` (output git-ignored).

## Remaining limits (not solved)

- Only a synthetic room has been tested; real photographs of rooms are untested.
- Frame is a procedural, stylised moulding; no real wood grain, no glass reflection, no room-light falloff or mount shadow on the print itself (default `printEdgeShadow` 0 keeps print pixels untouched).
- Light values are calibrated by a human; nothing is measured from a real room automatically.
- Frame depth faces are synthesised; the engine does not model contact with furniture or uneven walls.
- AI-generated rooms give only an illustrative scale.
- No rights-cleared room asset exists yet; no UI.
