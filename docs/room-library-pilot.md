# Room Library pilot (isolated feature branch)

Status: **foundation only**. Not connected to the Validation Studio UI, not deployed and not approved for commercial use.

- `schema.ts` defines room images, wall quadrilaterals, metric wall dimensions, a safe placement region, rights and lighting metadata.
- `placement.ts` projects an approved **outer framed-piece size** onto a verified wall plane, returning `manual.targetQuad` and physical width options for the existing `framed-on-wall` pipeline.
- `tests/room-library.test.ts` covers size limits, perspective projection and fail-closed gates.

## Important restrictions

- Supported outer frame sizes: 30x40, 40x50, 50x70 and 60x80 cm, plus landscape rotations. The bounds apply to the whole frame, **not** the print alone.
- No uncalibrated AI room is accepted as metrically accurate: `wall.scaleVerified` must be true after a human checks the intended relative scale. AI rooms have no trustworthy EXIF or true object measurements.
- The existing `framed-on-wall` workflow requires an image of a finished framed piece. Adding a procedural frame around a flat artwork is **not** implemented in this pilot.
- Lighting metadata is recorded, **not yet applied** to the renderer. The current engine estimates room lighting itself; claiming matched illumination now would be premature.
- The room image must be loaded by the caller; this module does not store images or artwork.
- For the first room, use the empty-wall cozy living room image (not the later AI-generated image with artwork). Room image needs a reviewed placement region and human-approved scale.
- Do not expose the feature through Production V2, publish, merge or upload customer photos before review.

## Next work, only after local tests pass

1. Save an approved, rights-cleared empty-wall room image in a private room store.
2. Annotate wall corners, safe region, sofa-width scale and lighting direction; review scale confidence.
3. Connect the room picker to the isolated V3 Validation Studio, with an explicit 30x40–60x80 outer-frame selector.
4. Add optional room-light override, mask and occlusion handling to the engine, with pixel-integrity tests.
5. Test with a non-sensitive finished-frame source image, compare the room before/after and obtain visual approval.
