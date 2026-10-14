/**
 * Camera metadata the browser extracts from the ORIGINAL file before shrinking it. Strictly whitelisted:
 * anything else (notably GPS) is rejected, not ignored, so a bug in the client cannot leak location.
 */
export type ExifHint={
  make?:string;model?:string;
  focalLengthMm?:number;focalLength35mm?:number;
  focalPlaneXResolution?:number;focalPlaneResolutionUnit?:number;
  /** Pixel size of the original after orientation was applied, and of the file actually sent. */
  originalWidth:number;originalHeight:number;
  /** Camera's recorded image size (PixelXDimension/PixelYDimension), used to detect crops. */
  exifWidth?:number;exifHeight?:number;
};

const KEYS=new Set(["make","model","focalLengthMm","focalLength35mm","focalPlaneXResolution","focalPlaneResolutionUnit","originalWidth","originalHeight","exifWidth","exifHeight"]);

export class HintError extends Error{}

const num=(v:unknown,name:string,min:number,max:number,optional=true)=>{
  if(v===undefined||v===null){ if(optional) return undefined; throw new HintError(`${name} is required`);}
  if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max) throw new HintError(`${name} is out of range`);
  return v;
};
const str=(v:unknown,name:string)=>{
  if(v===undefined||v===null) return undefined;
  if(typeof v!=="string"||v.length>60||/[^\x20-\x7e]/.test(v)) throw new HintError(`${name} is not a plain short string`);
  return v.trim();
};

export function parseHint(raw:unknown):ExifHint{
  if(raw===null||typeof raw!=="object"||Array.isArray(raw)) throw new HintError("metadata must be an object");
  const o=raw as Record<string,unknown>;
  for(const k of Object.keys(o)) if(!KEYS.has(k)) throw new HintError(`field "${k}" is not accepted`);
  return {
    make:str(o.make,"make"),model:str(o.model,"model"),
    focalLengthMm:num(o.focalLengthMm,"focalLengthMm",0.5,2000),
    focalLength35mm:num(o.focalLength35mm,"focalLength35mm",3,3000),
    focalPlaneXResolution:num(o.focalPlaneXResolution,"focalPlaneXResolution",1,1e7),
    focalPlaneResolutionUnit:num(o.focalPlaneResolutionUnit,"focalPlaneResolutionUnit",1,5),
    originalWidth:num(o.originalWidth,"originalWidth",16,100000,false)!,
    originalHeight:num(o.originalHeight,"originalHeight",16,100000,false)!,
    exifWidth:num(o.exifWidth,"exifWidth",1,100000),
    exifHeight:num(o.exifHeight,"exifHeight",1,100000)
  };
}

/** Browser side: drop any optional field the server would reject (corrupt EXIF), so one bad tag never blocks a run. */
export function sanitiseHint(h:ExifHint):ExifHint{
  const out:Record<string,unknown>={...h};
  for(const k of Object.keys(out)){
    if(k==="originalWidth"||k==="originalHeight") continue;
    try{parseHint({originalWidth:h.originalWidth,originalHeight:h.originalHeight,[k]:out[k]});}catch{delete out[k];}
  }
  return out as ExifHint;
}
