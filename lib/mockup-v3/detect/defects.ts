/**
 * Pipeline-level defect vocabulary. Every automatic decision that can be wrong reports a code
 * here with a severity, so the caller (UI/API) can decide whether to ask for manual input.
 */
export type DefectCode=
  // detection / placement
  | "QUAD_NOT_FOUND"
  | "QUAD_LOW_CONFIDENCE"
  | "QUAD_TOUCHES_BORDER"
  | "QUAD_AMBIGUOUS"
  | "APERTURE_UNCERTAIN"
  | "SOURCE_KIND_UNCERTAIN"
  | "PERSPECTIVE_ASSUMED_FRONTAL"
  | "SCALE_ASSUMED"
  | "PLACEMENT_UNCERTAIN"
  | "WALL_NOT_FOUND"
  | "NO_FREE_WALL_SPACE"
  | "CAMERA_NOT_LEVEL"
  | "FOCAL_ASSUMED"
  | "SOURCE_GLARE_DETECTED"
  | "CROP_NOT_APPROVED"
  | "CROP_EXCEEDS_APPROVAL"
  | "REPLACEMENT_SIZE_MISMATCH"
  | "REPLACED_FRAME_NOT_COVERED"
  | "DEPTH_FACES_SYNTHESISED"
  | "TEXTURE_DEFAULTS_USED"
  // content handling
  | "ASPECT_MISMATCH_CROPPED"
  | "ASPECT_MISMATCH_FILLED"
  | "ASPECT_MISMATCH_EXCESSIVE"
  | "PROPORTION_UNVERIFIED"
  // measured fidelity / integrity (mirrors qa/metrics codes plus scene checks)
  | "COLOUR_DRIFT"
  | "COLOUR_BIAS"
  | "STRUCTURE_LOSS"
  | "SOFTENED"
  | "OVER_SHARPENED"
  | "PROPORTION_CHANGED"
  | "CROSS_CHECK_FAILED"
  | "SCENE_ALTERED"
  | "FRAME_ALTERED";

export type Severity="info"|"warn"|"blocker";

export type Defect={
  code:DefectCode;
  severity:Severity;
  message:string;
  data?:Record<string,number|string|boolean>;
};

export const defect=(code:DefectCode,severity:Severity,message:string,data?:Defect["data"]):Defect=>({code,severity,message,data});

export function worstSeverity(defects:Defect[]):Severity|"none"{
  if(defects.some((d)=>d.severity==="blocker")) return "blocker";
  if(defects.some((d)=>d.severity==="warn")) return "warn";
  if(defects.length) return "info";
  return "none";
}
