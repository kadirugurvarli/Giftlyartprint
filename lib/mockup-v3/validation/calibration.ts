import {DEFAULT_TOLERANCE_SETS,validateApproved,type ApprovedTolerances,type ToleranceKind} from "../qa/tolerance-registry";
import type {CaseReport,Review} from "./runner";

/**
 * Calibration from real results. A case is "good" only when a person reviewed it as good/acceptable.
 * Probe results show whether a candidate limit would still catch known damage. Rules:
 *  - need >= MIN_GOOD good reviewed cases before proposing anything;
 *  - a limit is only ever proposed LOOSER when it would still catch >= 95% of the probes
 *    (and never beyond 50% looser); otherwise the result is "cannot separate" and the engine
 *    or inputs must improve instead;
 *  - nothing is applied here: approval is a separate, explicit step.
 */
export const MIN_GOOD=10;

export type MetricProposal={
  metric:"crossMeanDeltaE"|"crossP95DeltaE"|"crossSsim";
  current:number;
  goodP95:number|null;goodMax:number|null;
  probeMinOrMax:number|null;
  falseRejects:number;
  proposal:"keep"|"loosen"|"tighten-possible"|"cannot-separate";
  proposedValue:number|null;
  probeDetectionAtProposal:number|null;
  reason:string;
};
export type CalibrationReport={
  goodCases:number;badCases:number;probeCases:number;
  insufficient?:string;
  metrics:MetricProposal[];
};

const q=(v:number[],p:number)=>{const s=[...v].sort((a,b)=>a-b);return s.length?s[Math.min(s.length-1,Math.floor(p*s.length))]:NaN;};

export function reviewKey(id:string,level:string){return `${id}::${level}`;}

export function calibrate(reports:CaseReport[],reviews:Review[],kind:ToleranceKind="rectified"):CalibrationReport{
  const rv=new Map(reviews.filter((r)=>r.verdict).map((r)=>[reviewKey(r.id,r.level),r]));
  const good=reports.filter((r)=>{const v=rv.get(reviewKey(r.id,r.level))?.verdict;return (v==="good"||v==="acceptable")&&r.qa.crossCheck;});
  const bad=reports.filter((r)=>rv.get(reviewKey(r.id,r.level))?.verdict==="bad").length;
  const withProbes=reports.filter((r)=>r.probes?.length);
  const out:CalibrationReport={goodCases:good.length,badCases:bad,probeCases:withProbes.length,metrics:[]};
  if(good.length<MIN_GOOD) out.insufficient=`Only ${good.length} reviewed good cases; at least ${MIN_GOOD} are needed before any proposal.`;
  const tol=DEFAULT_TOLERANCE_SETS[kind];
  const probeVals=(f:(p:NonNullable<CaseReport["probes"]>[number])=>number|undefined)=>withProbes.flatMap((r)=>r.probes!.map(f)).filter((v):v is number=>typeof v==="number");
  const defs:{metric:MetricProposal["metric"];current:number;higherIsWorse:boolean;good:(r:CaseReport)=>number|undefined;probe:(p:NonNullable<CaseReport["probes"]>[number])=>number|undefined}[]=[
    {metric:"crossMeanDeltaE",current:tol.maxMeanDeltaE,higherIsWorse:true,good:(r)=>r.qa.crossCheck?.meanDeltaE,probe:(p)=>p.meanDeltaE},
    {metric:"crossP95DeltaE",current:tol.maxP95DeltaE,higherIsWorse:true,good:(r)=>r.qa.crossCheck?.p95DeltaE,probe:(p)=>p.p95DeltaE},
    {metric:"crossSsim",current:tol.minSsim,higherIsWorse:false,good:(r)=>r.qa.crossCheck?.ssim,probe:(p)=>p.ssim}
  ];
  for(const d of defs){
    const g=good.map(d.good).filter((v):v is number=>typeof v==="number");
    const pv=probeVals(d.probe);
    const gEdge=d.higherIsWorse?q(g,0.95):q(g,0.05);
    const gExtreme=g.length?(d.higherIsWorse?Math.max(...g):Math.min(...g)):NaN;
    const rejects=g.filter((v)=>d.higherIsWorse?v>d.current:v<d.current).length;
    const detectAt=(limit:number)=>pv.length?pv.filter((v)=>d.higherIsWorse?v>limit:v<limit).length/pv.length:NaN;
    const base:MetricProposal={metric:d.metric,current:d.current,goodP95:Number.isFinite(gEdge)?gEdge:null,goodMax:Number.isFinite(gExtreme)?gExtreme:null,probeMinOrMax:pv.length?(d.higherIsWorse?Math.min(...pv):Math.max(...pv)):null,falseRejects:rejects,proposal:"keep",proposedValue:null,probeDetectionAtProposal:null,reason:""};
    if(out.insufficient||!g.length){base.reason=out.insufficient??"no data";out.metrics.push(base);continue;}
    if(rejects===0){
      base.reason=`No reviewed-good case exceeds the current limit (${d.current}). Keep it.`;
      base.proposal=(d.higherIsWorse?gExtreme<d.current*0.6:gExtreme>d.current+0.04)?"tighten-possible":"keep";
      base.probeDetectionAtProposal=pv.length?detectAt(d.current):null;
      out.metrics.push(base);continue;
    }
    // good cases are being rejected: would a looser limit still catch the probes?
    const cap=d.higherIsWorse?d.current*1.5:d.current*0.67;
    const cand=d.higherIsWorse?Math.min(cap,gExtreme*1.05):Math.max(cap,gExtreme*0.95);
    const covers=d.higherIsWorse?cand>=gExtreme:cand<=gExtreme;
    const det=detectAt(cand);
    base.probeDetectionAtProposal=Number.isFinite(det)?det:null;
    if(!covers||!(det>=0.95)){
      base.proposal="cannot-separate";
      base.reason=!covers?`Good cases exceed even the maximum permitted loosening (${cap.toFixed(2)}). Improve the engine or the inputs; do not loosen.`
        :`Loosening to ${cand.toFixed(2)} would let probes through (detection ${(det*100||0).toFixed(0)}% < 95%). Improve the engine or the inputs; do not loosen.`;
    }else{
      base.proposal="loosen";base.proposedValue=Number(cand.toFixed(3));
      base.reason=`${rejects} reviewed-good case(s) are rejected today. ${base.proposedValue} accepts them and still catches ${(det*100).toFixed(0)}% of probes. Requires explicit approval and >=20 good + >=20 probe cases.`;
    }
    out.metrics.push(base);
  }
  return out;
}

/** Build an approval document; throws (via validateApproved) unless evidence is sufficient for any loosening. */
export function buildApproval(rep:CalibrationReport,kind:ToleranceKind,by:string,reason:string,now=new Date()):ApprovedTolerances{
  const keyOf:Record<MetricProposal["metric"],"maxMeanDeltaE"|"maxP95DeltaE"|"minSsim">={crossMeanDeltaE:"maxMeanDeltaE",crossP95DeltaE:"maxP95DeltaE",crossSsim:"minSsim"};
  const tol:Record<string,number>={};
  for(const m of rep.metrics) if(m.proposal==="loosen"&&m.proposedValue!==null) tol[keyOf[m.metric]]=m.proposedValue;
  if(!Object.keys(tol).length) throw new Error("Nothing to approve: no metric has a justified proposal.");
  const det=Math.min(...rep.metrics.filter((m)=>m.proposal==="loosen").map((m)=>m.probeDetectionAtProposal ?? 0));
  return validateApproved({version:1,approvedBy:by,approvedAt:now.toISOString(),reason,evidence:{goodCases:rep.goodCases,probeCases:rep.probeCases,probeDetectionRate:det},tolerances:{[kind]:tol}});
}
