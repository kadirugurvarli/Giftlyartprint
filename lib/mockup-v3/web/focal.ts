import type {ExifHint} from "./hint";
/** Focal length in pixels of the image actually received (the shrunken copy), with the same rules as readExif. */
import {cropCaution,focalPxFromExif} from "../exif";
export function focalFromHint(h:ExifHint,sentW:number,sentH:number){
  if(!h.focalLength35mm && !h.exifWidth) return {focalPx:undefined,source:"none" as const,caution:undefined};
  const {focalPx,source}=focalPxFromExif({width:sentW,height:sentH,f35:h.focalLength35mm,focalMm:h.focalLengthMm,fpXRes:h.focalPlaneXResolution,fpUnit:h.focalPlaneResolutionUnit,exifWidth:h.exifWidth});
  // the shrunken copy keeps the original's proportions; a mismatch with the camera's recorded size means a crop
  const caution=cropCaution(h.exifWidth,h.exifHeight,h.originalWidth,h.originalHeight);
  return {focalPx:caution?undefined:focalPx,source,caution};
}

