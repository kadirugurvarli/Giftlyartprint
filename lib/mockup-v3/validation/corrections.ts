import type {DefectCode} from "../detect/defects";
import type {RealismFinding} from "./realism-audit";

/**
 * Maps every defect / audit finding to a targeted correction. Kinds:
 *  - input:    something the person can fix by supplying a better photo or a hint
 *  - option:   a documented pipeline option to change for this case
 *  - decision: a person must decide (e.g. approve a crop)
 *  - engine:   a defect in the engine itself: log it for triage; do NOT work around it by loosening QA
 * No rule ever recommends loosening a threshold.
 */
export type CorrectionKind="input"|"option"|"decision"|"engine";
export type Correction={code:string;kind:CorrectionKind;action:string};

export const DEFECT_CORRECTIONS:Record<DefectCode,{kind:CorrectionKind;action:string}>={
  QUAD_NOT_FOUND:{kind:"input",action:"Mark the four corners of the opening/piece manually (manual.targetQuad or manual.sourceQuad), then log the photo for engine triage."},
  QUAD_LOW_CONFIDENCE:{kind:"input",action:"Check the detection overlay. If the outline is right, no action; if not, supply corners manually and log the case."},
  QUAD_TOUCHES_BORDER:{kind:"input",action:"Re-shoot with a margin of background around the piece, or mark the corners manually."},
  QUAD_AMBIGUOUS:{kind:"input",action:"Two plausible outlines were found. Mark corners manually, or add an ignore mask over the distracting object."},
  APERTURE_UNCERTAIN:{kind:"input",action:"The mount/frame opening was uncertain. Give manual.apertureLayers or mark the opening corners."},
  SOURCE_KIND_UNCERTAIN:{kind:"option",action:"State whether the source is a bare print or a framed piece (choose mode A or B explicitly)."},
  PERSPECTIVE_ASSUMED_FRONTAL:{kind:"input",action:"Supply a source photo taken square-on, or mark the source corners so perspective is solved."},
  SCALE_ASSUMED:{kind:"input",action:"Give the real size of the piece (options.productSize) so the scale in the room is exact."},
  PLACEMENT_UNCERTAIN:{kind:"input",action:"Give a wallHint point, or mark the target corners manually."},
  WALL_NOT_FOUND:{kind:"input",action:"Give a wallHint point on a plain wall area, or use a reference with a plain wall; log if the wall is plain."},
  NO_FREE_WALL_SPACE:{kind:"decision",action:"There is no clear wall area for this size. Choose a smaller size, or use a reference with free wall."},
  CAMERA_NOT_LEVEL:{kind:"input",action:"Camera is tilted; give referenceFocalPx or a straighter reference, or mark the target corners."},
  FOCAL_ASSUMED:{kind:"input",action:"Supply the original reference with EXIF intact, or state referenceFocalPx; proportions on angled views depend on it."},
  SOURCE_GLARE_DETECTED:{kind:"input",action:"Re-photograph the product without glare (angle the light or camera). Glare is never retouched out."},
  CROP_NOT_APPROVED:{kind:"decision",action:"The print does not fit the opening's shape. Approve the proposed crop or keep the mount border."},
  CROP_EXCEEDS_APPROVAL:{kind:"decision",action:"The needed crop is larger than approved. Approve a larger crop or keep the border."},
  REPLACEMENT_SIZE_MISMATCH:{kind:"decision",action:"The new piece's size/shape differs from the picture it replaces. Pick a matching size or accept visible leftovers."},
  REPLACED_FRAME_NOT_COVERED:{kind:"engine",action:"The old frame was not fully covered. Check the overlay; log for engine triage and use a manual target quad meanwhile."},
  DEPTH_FACES_SYNTHESISED:{kind:"decision",action:"Frame depth sides were synthesised (environment level). Confirm visually that they look right, or use level strict."},
  TEXTURE_DEFAULTS_USED:{kind:"input",action:"The reference gave no measurable grain/softness; use a reference with more plain-wall area."},
  ASPECT_MISMATCH_CROPPED:{kind:"decision",action:"A crop was applied. Confirm it was approved."},
  ASPECT_MISMATCH_FILLED:{kind:"decision",action:"A mount border fills the shape difference; confirm it looks acceptable."},
  ASPECT_MISMATCH_EXCESSIVE:{kind:"decision",action:"Shape difference is large; use a different opening or approve a deliberate crop."},
  PROPORTION_UNVERIFIED:{kind:"input",action:"Provide EXIF focal length or the real sizes so proportions can be verified."},
  COLOUR_DRIFT:{kind:"engine",action:"Product colours moved beyond tolerance. Log for engine triage with the case; do NOT relax thresholds."},
  COLOUR_BIAS:{kind:"engine",action:"A systematic colour shift was measured. Log for engine triage; check the level is not photographic."},
  STRUCTURE_LOSS:{kind:"engine",action:"Fine structure was lost. Check the overlay for wrong corners first; otherwise log for engine triage."},
  SOFTENED:{kind:"input",action:"The product is softer than the source. Use a higher-resolution source or a larger apparent size; if resolution is fine, log for triage."},
  OVER_SHARPENED:{kind:"engine",action:"The product is sharper than the source allows. Log for engine triage."},
  PROPORTION_CHANGED:{kind:"input",action:"Check corner positions in the overlay; supply the real size or EXIF focal if the view is angled."},
  CROSS_CHECK_FAILED:{kind:"engine",action:"The independent check could not compare. Verify the overlay corners; log for triage."},
  SCENE_ALTERED:{kind:"engine",action:"Something outside the product/shadow changed. This is an engine bug: log for triage, do not use the mockup."},
  FRAME_ALTERED:{kind:"engine",action:"The customer's frame/mount pixels changed. This is an engine bug: log for triage, do not use the mockup."}
};

export const AUDIT_CORRECTIONS:Record<RealismFinding["code"],{kind:CorrectionKind;action:string}>={
  SEAM_TOO_SHARP:{kind:"option",action:"Product edges are sharper than the room's. Try realism level environment with edge softening (options.realism.edgeOverlapPx higher), then re-check visually."},
  GRAIN_MISMATCH:{kind:"option",action:"Texture differs from the room photo. Compare at 100%; if it is visible, consider the photographic level on this case only."},
  SHADOW_ABSENT:{kind:"option",action:"No shadow beside the piece. Check shadow strengths were not set to 0; if the room is dim/diffuse this may be acceptable."},
  SHADOW_DIRECTION_MISMATCH:{kind:"decision",action:"Shadow direction differs from the intended light. Confirm by eye against the room's other shadows."},
  OLD_PICTURE_LEAK:{kind:"engine",action:"Part of the old picture may still show inside the opening. Check overlay; mark corners manually and log for triage."},
  PERSPECTIVE_DEVIATION:{kind:"input",action:"Piece does not follow the room's perspective. Supply referenceFocalPx or mark target corners."},
  PRODUCT_SMALL:{kind:"decision",action:"The product is small in the picture; choose a closer reference if detail matters."},
  MEASUREMENT_UNAVAILABLE:{kind:"engine",action:"No mockup was produced; see the defects."}
};

export function recommendCorrections(defects:{code:string;severity?:string}[],findings:{code:string}[]):Correction[]{
  const out:Correction[]=[];
  const seen=new Set<string>();
  for(const d of defects){
    if(seen.has(d.code)) continue;seen.add(d.code);
    const r=(DEFECT_CORRECTIONS as Record<string,{kind:CorrectionKind;action:string}>)[d.code];
    out.push(r?{code:d.code,...r}:{code:d.code,kind:"engine",action:"Unrecognised defect code; log for engine triage."});
  }
  for(const f of findings){
    if(seen.has(f.code)) continue;seen.add(f.code);
    out.push({code:f.code,...AUDIT_CORRECTIONS[f.code as RealismFinding["code"]]});
  }
  return out;
}
