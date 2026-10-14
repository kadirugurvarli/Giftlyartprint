import type {CaseReport} from "./runner";

/** Numbers-only extract of a validation run: safe to paste into a chat. No file names, notes, paths or EXIF text. */
export function numbersOnly(reports:CaseReport[]){
  return reports.map((r)=>({
    id:r.id,mode:r.mode,level:r.level,status:r.status,needsManual:r.needsManual,automation:r.automation,
    defects:r.defects.map((d)=>({code:d.code,severity:d.severity})),
    qa:r.qa,accuracy:r.accuracy,
    probes:r.probes,
    realism:r.realism?{findings:r.realism.findings.map((f)=>({code:f.code,value:f.value,limit:f.limit})),measurements:Object.fromEntries(Object.entries(r.realism.measurements).filter(([,v])=>typeof v==="number"))}:undefined,
    corrections:r.corrections?.map((c)=>({code:c.code,kind:c.kind})),
    size:{source:[r.inputs.source.width,r.inputs.source.height],reference:[r.inputs.reference.width,r.inputs.reference.height]},
    focal:{source:r.inputs.sourceFocalUsed,reference:r.inputs.referenceFocalUsed},
    camera:{source:{make:(r.inputs.source.exif as any).make,model:(r.inputs.source.exif as any).model},reference:{make:(r.inputs.reference.exif as any).make,model:(r.inputs.reference.exif as any).model}}
  }));
}
