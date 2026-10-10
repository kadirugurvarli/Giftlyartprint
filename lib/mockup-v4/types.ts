import type {Pt,Quad,RawImage} from "../mockup-v3/types";

export type Rect={x:number;y:number;width:number;height:number};

/** One edit request. `mask` is full-crop-size, 255 = the model MAY change this pixel, 0 = must stay as it is. */
export type EditRequest={
  image:RawImage;
  mask:Uint8Array;
  prompt:string;
  /** Extra style references (never the customer artwork). The mask always applies to `image`. */
  references?:RawImage[];
};

export type EditMeta={provider:string;model:string;requestSize:string;estimatedCostUsd:number|null;usage?:unknown};
export type EditResult={image:RawImage;meta:EditMeta};

/** What a provider can accept. The orchestrator crops/aligns the request to satisfy these. */
export type EditorConstraints={
  alignPx:number;
  maxAspect:number;
  maxSide:number;
  maxPixels:number;
  minSide:number;
};

/** Provider-neutral image editor. Implementations must not log image or prompt content. */
export interface HybridImageEditor{
  readonly id:string;
  readonly constraints:EditorConstraints;
  edit(req:EditRequest):Promise<EditResult>;
}

export type HybridQuads={outer:Quad;art:Quad};
export type {Pt,Quad,RawImage};
