import {checkEnvironment,type Env} from "./guard";

/** What the /validation page may do for this request. Pure so it can be tested without rendering. */
export type PageDecision={kind:"ok"}|{kind:"notFound"}|{kind:"message";text:string};

export function decidePage(env:Env,host:string|null|undefined):PageDecision{
  const g=checkEnvironment(env,host ?? "");
  if(g.ok) return {kind:"ok"};
  return g.status===404?{kind:"notFound"}:{kind:"message",text:g.reason};
}
