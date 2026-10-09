import type {Pt,Quad,RawImage} from "../types";
import type {Defect} from "../detect/defects";
import type {OcclusionMask,OcclusionProvider} from "../composite/occlusion";
import type {ProtectedContentReport} from "../qa/protected-content";
import type {ImageMetrics} from "../qa/metrics";

export type MockupMode="artwork-in-frame"|"framed-on-wall";
export type MockupStatus="pass"|"review"|"fail";

/**
 * How much the engine may touch product pixels (the customer's artwork and real frame):
 * - strict:        none. Only shadows on the wall around the product (workflow B).
 * - environment:   none on the product. Adds synthesised frame depth around it (workflow B).  [default]
 * - photographic:  opt-in. Also acts ON the product: edge shadow from the mount, glass sheen,
 *                  grain/softness matched to the reference, bounded colour-neutral exposure gain.
 *                  Every effect is bounded and the result is measured against a colour-drift budget.
 */
export type RealismLevel="strict"|"environment"|"photographic";

export type RealismOptions={
  level?:RealismLevel;
  /** photographic: exposure gain strength 0-1 and cap (fractional, default 0.6 / 0.03). */
  gainStrength?:number;gainCap?:number;
  /** photographic: glass sheen strength (linear-light lift, default 0.03). */
  glassSheen?:number;
  /** photographic: mount-lip shadow on the artwork edge, 0-0.3 (default from measured light). */
  lipShadowStrength?:number;
  /** photographic: override measured grain (8-bit levels) / softness (px sigma); "auto" measures the reference. */
  grainSigma?:number|"auto";softnessSigma?:number|"auto";
  /** Frame depth in metres for side faces and shadow standoff (default 0.025). */
  frameDepthM?:number;
  dropShadowStrength?:number;contactShadowStrength?:number;
  textureSeed?:number;
};

export type MockupOptions={
  /** Focal length (px of the SOURCE photo, e.g. from EXIF). Makes perspective proportions verifiable. */
  sourceFocalPx?:number;
  /** Focal length (px of the REFERENCE photo). */
  referenceFocalPx?:number;
  /** Known true width/height of the bare print (A-ratios etc.). Overrides the estimate; strongly recommended. */
  artworkAspect?:number;
  /** Known true width/height of the framed piece including frame. */
  pieceAspect?:number;
  /**
   * artwork-in-frame fitting. "contain" (default) keeps the WHOLE print at its true proportions and
   * fills the rest of the opening with the reference's mount colour. "cover" crops the print and is
   * only honoured together with `approvedCrop`; otherwise the engine falls back to "contain" and
   * reports the crop it would have needed (adjustments.proposedCropFraction) so a person can decide.
   */
  fit?:"contain"|"cover";
  approvedCrop?:{maxFraction:number};
  cropAnchor?:{x:number;y:number};
  /** Extra mount border around the print inside the opening, as a fraction of the opening (default 0). */
  matMarginFraction?:number;
  /** Mode framed-on-wall: physical outer width of the framed piece (m), room height (m), skirting height (m), hang height of centre (m). */
  physicalWidthM?:number;
  ceilingHeightM?:number;
  skirtingM?:number;
  centreHeightM?:number;
  /**
   * framed-on-wall placement. "auto" (default): if the reference already shows a framed picture,
   * the new piece replaces it in place (the reference decides the composition); otherwise a free spot
   * on the wall is chosen. "replace-existing" and "free-wall" force one behaviour.
   */
  placement?:"auto"|"replace-existing"|"free-wall";
  realism?:RealismOptions;
  /** Artwork overlap beyond the opening so no old pixels peek out (px, default 1.0). */
  edgeOverlapPx?:number;
  /** Shrink the extracted print/piece so no background fringe survives (px, default 0.5 / 0.8). This is a sub-pixel guard, reported. */
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
  /** The exact source/target region pair the independent cross-check compared (for diagnostics and probes). */
  crossRegions?:{source:Quad;target:Quad};
  /** Did anything alter the customer's product pixels beyond geometric resampling? */
  productPixels?:{modified:boolean;level:RealismLevel;note:string};
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
