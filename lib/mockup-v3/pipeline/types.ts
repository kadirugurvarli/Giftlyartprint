import type {Pt,Quad,RawImage} from "../types";
import type {Defect} from "../detect/defects";
import type {OcclusionMask,OcclusionProvider} from "../composite/occlusion";
import type {ProtectedContentReport} from "../qa/protected-content";
import type {ImageMetrics} from "../qa/metrics";

export type MockupMode="artwork-in-frame"|"framed-on-wall";
export type MockupStatus="pass"|"review"|"fail";

export type MockupOptions={
  /** Focal length (px of the SOURCE photo, e.g. from EXIF). Makes perspective proportions verifiable. */
  sourceFocalPx?:number;
  /** Focal length (px of the REFERENCE photo). */
  referenceFocalPx?:number;
  /** Known true width/height of the bare print (A-ratios etc.). Overrides the estimate; strongly recommended. */
  artworkAspect?:number;
  /** Known true width/height of the framed piece including frame. */
  pieceAspect?:number;
  /** Mode artwork-in-frame: "cover" crops the print to the opening, "contain" fills the remainder with mount colour. */
  fit?:"cover"|"contain";
  /** Crop beyond this fraction of the print raises ASPECT_MISMATCH_EXCESSIVE (default 0.06). */
  maxCropFraction?:number;
  cropAnchor?:{x:number;y:number};
  /** Mode framed-on-wall: physical outer width of the framed piece (m), room height (m), skirting height (m), hang height of centre (m). */
  physicalWidthM?:number;
  ceilingHeightM?:number;
  skirtingM?:number;
  centreHeightM?:number;
  lighting?:{gainStrength?:number;gainCap?:number;dropShadowStrength?:number;contactShadowStrength?:number;innerShadowStrength?:number;disable?:boolean};
  /** Artwork overlap beyond the opening so no old pixels peek out (px, default 0.6). */
  edgeOverlapPx?:number;
  /** Shrink the extracted framed piece so no background fringe survives (px, default 0.8). */
  edgeInsetPx?:number;
  /** Reference longer side is capped to this (scene pixels only; customer pixels are never downscaled below need). Default 2400. */
  maxReferenceSide?:number;
};

export type ManualInputs={
  /** Outer corners of the print (artwork-in-frame) or framed piece (framed-on-wall) in the SOURCE photo. TL,TR,BR,BL. */
  sourceQuad?:Quad;
  /** artwork-in-frame: corners of the opening to fill. framed-on-wall: corners where the piece should hang. In REFERENCE coordinates. */
  targetQuad?:Quad;
  /** Foreground that must stay in front (manual brush/polygon mask, or a provider such as a future auto-segmenter). */
  occlusion?:OcclusionMask|OcclusionProvider;
  /** Tap on the wall (framed-on-wall) to choose which smooth region is the wall. */
  wallHint?:Pt;
  /** artwork-in-frame: pick a different detected frame layer per side (0 = outermost). */
  apertureLayers?:{top:number;right:number;bottom:number;left:number};
};

export type MockupJobInput={
  mode:MockupMode;
  source:RawImage;
  reference:RawImage;
  options?:MockupOptions;
  manual?:ManualInputs;
};

export type CrossCheck={
  pass:boolean;
  failures:{code:string;detail:string}[];
  metrics:ImageMetrics|null;
  size:{width:number;height:number};
};

export type SceneIntegrity={
  pass:boolean;
  /** Pixels that differ from the reference although they lie outside the allowed region. */
  changedOutsideAllowed:number;
  allowedPixels:number;
  /** artwork-in-frame: changed pixels on the existing frame/mount ring. */
  changedFramePixels:number;
};

export type QaSummary={
  forward:ProtectedContentReport|null;
  crossCheck:CrossCheck|null;
  sceneIntegrity:SceneIntegrity|null;
};

export type MockupResult={
  mode:MockupMode;
  status:MockupStatus;
  /** True when an automatic step was unsure and a human should confirm/adjust corners or masks. */
  needsManual:boolean;
  /** The clean mockup: scene + the customer's real pixels only. Never contains text or branding. */
  image:RawImage|null;
  sourceQuad:Quad|null;
  targetQuad:Quad|null;
  /** artwork-in-frame: outer silhouette of the reference frame. */
  referenceFrameQuad:Quad|null;
  automation:{source:"auto"|"manual";target:"auto"|"manual";occlusion:"none"|"manual"|"provider"};
  adjustments:Record<string,number|string|boolean>;
  defects:Defect[];
  qa:QaSummary;
  diagnostics:{overlay:RawImage|null;extracted:RawImage|null};
};
