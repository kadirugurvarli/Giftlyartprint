export type Verdict="good"|"acceptable"|"bad"|"";
export const RATING_KEYS=["placement","perspective","lighting","shadow","edges","colourFidelity"] as const;
export const DEFECT_CHOICES=[
  ["pasted-look","Looks pasted in / edges too sharp"],["wrong-corners","Wrong corners or placement"],["perspective","Perspective looks wrong"],
  ["no-shadow","Floating / no shadow"],["shadow-wrong","Shadow looks wrong"],["old-picture","Old picture still visible"],
  ["colour","Colours differ from my artwork"],["too-soft","Too soft / blurry"],["frame-edge","Frame or mount edge damaged"],["scale","Size looks wrong"],["other","Something else (see notes)"]
] as const;

export type FeedbackInput={
  mode:string;level:string;verdict:Verdict;
  ratings:Partial<Record<typeof RATING_KEYS[number],number|null>>;
  defectsSeen:string[];notes:string;
};

/** Numbers-only extract of the server report (no images, no file names, no metadata beyond camera model). */
export function buildFeedback(i:FeedbackInput,report:any,caseId:string,now=new Date()){
  return {
    version:1,caseId,createdAt:now.toISOString(),
    mode:i.mode,level:i.level,verdict:i.verdict,
    ratings:Object.fromEntries(RATING_KEYS.map((k)=>[k,i.ratings[k] ?? null])),
    defectsSeen:i.defectsSeen,notes:i.notes.slice(0,2000),
    report:report?{
      status:report.status,needsManual:report.needsManual,automation:report.automation,
      defects:(report.defects ?? []).map((d:any)=>({code:d.code,severity:d.severity})),
      realism:(report.realism?.findings ?? []).map((f:any)=>({code:f.code,value:f.value,limit:f.limit})),
      measurements:Object.fromEntries(Object.entries(report.realism?.measurements ?? {}).filter(([,v])=>typeof v==="number")),
      qa:report.qa,input:{...report.input,camera:report.input?.camera},output:report.output?{px:report.output.px,jpegQuality:report.output.jpegQuality}:null
    }:null
  };
}
