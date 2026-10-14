import fs from "node:fs";
import path from "node:path";
import {
  FORWARD_TOLERANCES,LIGHTING_FORWARD_TOLERANCES,LIGHTING_RECTIFIED_TOLERANCES,LOSSY_FORWARD_TOLERANCES,RECTIFIED_TOLERANCES,
  type FidelityTolerances
} from "./metrics";

/**
 * Single source of truth for the QA thresholds the pipelines use. Defaults are the synthetic-data
 * values from metrics.ts. A calibration approved by a person (calibration/tolerances.approved.json,
 * produced only by `npm run calibrate -- --approve`) may override them, but only with evidence, and
 * the loader refuses overrides that loosen a threshold without that evidence.
 */
export type ToleranceKind="forward"|"lossyForward"|"rectified"|"lightingForward"|"lightingRectified";

const DEFAULTS:Record<ToleranceKind,FidelityTolerances>={
  forward:FORWARD_TOLERANCES,lossyForward:LOSSY_FORWARD_TOLERANCES,rectified:RECTIFIED_TOLERANCES,
  lightingForward:LIGHTING_FORWARD_TOLERANCES,lightingRectified:LIGHTING_RECTIFIED_TOLERANCES
};

export type ApprovedTolerances={
  version:1;
  approvedBy:string;
  approvedAt:string;
  reason:string;
  evidence:{goodCases:number;probeCases:number;probeDetectionRate:number};
  tolerances:Partial<Record<ToleranceKind,Partial<FidelityTolerances>>>;
};

export class ToleranceApprovalError extends Error{constructor(m:string){super(m);this.name="ToleranceApprovalError";}}

const MAX_KEYS=["maxMeanDeltaE","maxP95DeltaE","maxAbsLabBias","maxAbsLBias","maxAbsChromaBias","maxSharpnessRatio","maxAspectError"] as const;
const MIN_KEYS=["minSsim","minSharpnessRatio"] as const;

/** Throws unless the approval is well-formed and any loosening is backed by enough evidence. */
export function validateApproved(a:ApprovedTolerances):ApprovedTolerances{
  if(a?.version!==1) throw new ToleranceApprovalError("Unsupported tolerance file version.");
  if(!a.approvedBy?.trim()||!a.reason?.trim()||!a.approvedAt) throw new ToleranceApprovalError("An approval needs approvedBy, approvedAt and a reason.");
  const ev=a.evidence;
  if(!ev||![ev.goodCases,ev.probeCases,ev.probeDetectionRate].every(Number.isFinite)) throw new ToleranceApprovalError("Missing evidence.");
  const strong=ev.goodCases>=20 && ev.probeCases>=20 && ev.probeDetectionRate>=0.95;
  for(const [kind,t] of Object.entries(a.tolerances ?? {})){
    if(!(kind in DEFAULTS)) throw new ToleranceApprovalError(`Unknown tolerance set "${kind}".`);
    const base=DEFAULTS[kind as ToleranceKind] as unknown as Record<string,number|undefined>;
    for(const [k,v] of Object.entries(t as Record<string,number>)){
      if(!Number.isFinite(v)||v<0) throw new ToleranceApprovalError(`${kind}.${k} must be a non-negative number.`);
      const def=base[k];
      if(def===undefined) throw new ToleranceApprovalError(`${kind}.${k} is not a known threshold.`);
      const looser=(MAX_KEYS as readonly string[]).includes(k)?v>def:(MIN_KEYS as readonly string[]).includes(k)?v<def:false;
      const farLooser=(MAX_KEYS as readonly string[]).includes(k)?v>def*1.5:(MIN_KEYS as readonly string[]).includes(k)?v<def*0.67:false;
      if(farLooser) throw new ToleranceApprovalError(`${kind}.${k}=${v} loosens the default (${def}) by more than 50%; refused. Fix the engine or the inputs instead.`);
      if(looser && !strong) throw new ToleranceApprovalError(`${kind}.${k}=${v} loosens the default (${def}) without strong evidence (need >=20 good cases, >=20 probe cases and >=95% probe detection).`);
    }
  }
  return a;
}

let cache:{file:string;mtime:number;value:ApprovedTolerances|null}|null=null;

export function approvedFilePath(){
  return process.env.GIFTLY_TOLERANCES_FILE ?? path.resolve(process.cwd(),"calibration","tolerances.approved.json");
}

export function loadApproved():ApprovedTolerances|null{
  const file=approvedFilePath();
  if(!fs.existsSync(file)){cache=null;return null;}
  const mtime=fs.statSync(file).mtimeMs;
  if(cache&&cache.file===file&&cache.mtime===mtime) return cache.value;
  const value=validateApproved(JSON.parse(fs.readFileSync(file,"utf8")));
  cache={file,mtime,value};
  return value;
}

export function getTolerances(kind:ToleranceKind):FidelityTolerances{
  const a=loadApproved();
  const o=a?.tolerances[kind];
  return o?{...DEFAULTS[kind],...o}:DEFAULTS[kind];
}

export const DEFAULT_TOLERANCE_SETS=DEFAULTS;
