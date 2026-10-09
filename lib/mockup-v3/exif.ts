import sharp from "sharp";
import exifReader from "exif-reader";

/**
 * Camera metadata relevant to geometry. GPS and other personal data are deliberately NOT returned
 * (only whether GPS exists), so reports and logs never leak a customer's location.
 */
export type ExifSummary={
  make?:string;
  model?:string;
  orientation?:number;
  /** Pixel size after EXIF orientation is applied (what the pipeline sees). */
  width:number;
  height:number;
  focalLengthMm?:number;
  focalLength35mm?:number;
  /** Estimated focal length in pixels of the oriented image, when derivable. */
  focalPx?:number;
  focalSource:"35mm-equivalent"|"focal-plane"|"none";
  /** True when the image looks cropped/resized so the focal estimate may be wrong. */
  focalCaution?:string;
  hasGps:boolean;
  hasExif:boolean;
  dateTimeOriginal?:string;
};

const UNIT_MM:Record<number,number>={2:25.4,3:10,4:1,5:0.001};

/**
 * Focal length in pixels from EXIF.
 * - 35mm-equivalent: f_px = f35 * diagonal_px / 43.27 (the 35mm frame diagonal), valid for any aspect ratio uncropped.
 * - otherwise focal-plane resolution: f_px = f_mm * pixels-per-mm, rescaled to the current image size.
 */
export function focalPxFromExif(o:{width:number;height:number;f35?:number;focalMm?:number;fpXRes?:number;fpUnit?:number;exifWidth?:number}):{focalPx?:number;source:ExifSummary["focalSource"]}{
  if(o.f35 && o.f35>0){
    return {focalPx:o.f35*Math.hypot(o.width,o.height)/43.27,source:"35mm-equivalent"};
  }
  if(o.focalMm && o.fpXRes && o.fpUnit && UNIT_MM[o.fpUnit]){
    const pxPerMm=o.fpXRes/UNIT_MM[o.fpUnit];
    const scale=o.exifWidth?o.width/o.exifWidth:1;
    return {focalPx:o.focalMm*pxPerMm*scale,source:"focal-plane"};
  }
  return {source:"none"};
}

/** The image's proportions differ from the capture's: it was cropped, so a focal estimate from EXIF is suspect. */
export function cropCaution(exifW:number|undefined,exifH:number|undefined,width:number,height:number):string|undefined{
  if(!exifW||!exifH) return undefined;
  const ex=Math.max(exifW,exifH)/Math.min(exifW,exifH),cur=Math.max(width,height)/Math.min(width,height);
  return Math.abs(ex-cur)/ex>0.02?"Image proportions differ from the original capture: it has been cropped, so the focal length estimate may be wrong.":undefined;
}

export async function readExif(buffer:Buffer):Promise<ExifSummary>{
  const meta=await sharp(buffer).metadata();
  const swap=(meta.orientation ?? 1)>=5;
  const width=swap?meta.height!:meta.width!;
  const height=swap?meta.width!:meta.height!;
  const base:ExifSummary={width,height,focalSource:"none",hasGps:false,hasExif:!!meta.exif,orientation:meta.orientation};
  if(!meta.exif) return base;
  let x:any;
  try{x=exifReader(meta.exif);}catch{return base;}
  const img=x.Image ?? {},ph=x.Photo ?? {};
  const f35=Number(ph.FocalLengthIn35mmFilm) || undefined;
  const fmm=Number(ph.FocalLength) || undefined;
  const {focalPx,source}=focalPxFromExif({
    width,height,f35,focalMm:fmm,fpXRes:Number(ph.FocalPlaneXResolution) || undefined,fpUnit:Number(ph.FocalPlaneResolutionUnit) || undefined,
    exifWidth:Number(ph.PixelXDimension) || undefined
  });
  const caution=cropCaution(Number(ph.PixelXDimension) || undefined,Number(ph.PixelYDimension) || undefined,width,height);
  return {
    ...base,
    make:typeof img.Make==="string"?img.Make.trim():undefined,
    model:typeof img.Model==="string"?img.Model.trim():undefined,
    focalLengthMm:fmm,focalLength35mm:f35,focalPx,focalSource:source,focalCaution:caution,
    hasGps:!!x.GPSInfo && Object.keys(x.GPSInfo).length>0,
    dateTimeOriginal:ph.DateTimeOriginal instanceof Date?ph.DateTimeOriginal.toISOString():undefined
  };
}
