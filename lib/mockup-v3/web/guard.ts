/**
 * Fail-closed environment guard for the validation interface.
 * The interface only runs on a Vercel PREVIEW deployment, only when switched on, only with both
 * secrets present, and never when the V2 production credentials are visible to this deployment.
 */
export const PRODUCTION_SECRET_NAMES=[
  "CONTENT_FEED_TOKEN","CONTENT_FEED_URL","OPENAI_API_KEY","METRICOOL_USER_TOKEN","METRICOOL_USER_ID","METRICOOL_BLOG_ID",
  "BLOB_READ_WRITE_TOKEN"
] as const;

export type Env=Record<string,string|undefined>;
export type GuardResult={ok:true}|{ok:false;status:404|503;reason:string;code:"DISABLED"|"NOT_PREVIEW"|"MISCONFIGURED"|"PRODUCTION_SECRETS_VISIBLE"};

export function checkEnvironment(env:Env=process.env):GuardResult{
  if(env.VALIDATION_UI_ENABLED!=="1") return {ok:false,status:404,code:"DISABLED",reason:"disabled"};
  // local development/tests may opt in explicitly; deployed code must be a Vercel preview
  const local=env.VALIDATION_ALLOW_LOCAL==="1" && !env.VERCEL_ENV && !env.VERCEL;
  if(!local && env.VERCEL_ENV!=="preview") return {ok:false,status:404,code:"NOT_PREVIEW",reason:"not a preview deployment"};
  if(!env.VALIDATION_PASSWORD || env.VALIDATION_PASSWORD.length<12) return {ok:false,status:503,code:"MISCONFIGURED",reason:"VALIDATION_PASSWORD missing or shorter than 12 characters"};
  if(!env.VALIDATION_SESSION_SECRET || env.VALIDATION_SESSION_SECRET.length<32) return {ok:false,status:503,code:"MISCONFIGURED",reason:"VALIDATION_SESSION_SECRET missing or shorter than 32 characters"};
  const leaked=PRODUCTION_SECRET_NAMES.filter((n)=>!!env[n]);
  if(leaked.length) return {ok:false,status:503,code:"PRODUCTION_SECRETS_VISIBLE",reason:`Production credentials are visible to this Preview deployment (${leaked.join(", ")}). Remove them from the Preview environment scope and redeploy; this interface refuses to run next to them.`};
  return {ok:true};
}
