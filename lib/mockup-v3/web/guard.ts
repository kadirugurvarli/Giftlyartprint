/**
 * Fail-closed environment guard for the validation interface.
 * It only runs on a Vercel PREVIEW deployment, only when switched on, only on hostnames that were
 * explicitly confirmed to sit behind Vercel Authentication, and never when production credentials
 * are visible to the deployment. There is no application password: Vercel Authentication is the gate,
 * and the host allowlist stops an unprotected alias from ever serving the tool.
 */
export const PRODUCTION_SECRET_NAMES=[
  "CONTENT_FEED_TOKEN","CONTENT_FEED_URL","OPENAI_API_KEY","METRICOOL_USER_TOKEN","METRICOOL_USER_ID","METRICOOL_BLOG_ID",
  "BLOB_READ_WRITE_TOKEN","SHOPIFY_ADMIN_ACCESS_TOKEN","SHOPIFY_STORE_DOMAIN","GOOGLE_DRIVE_FOLDER_ID","GOOGLE_SHEET_ID"
] as const;
/** Any variable with one of these prefixes also counts as a production credential. */
export const PRODUCTION_SECRET_PREFIXES=["SHOPIFY_","GOOGLE_","METRICOOL_","OPENAI_","CONTENT_FEED_"] as const;

export type Env=Record<string,string|undefined>;
export type GuardCode="DISABLED"|"NOT_PREVIEW"|"MISCONFIGURED"|"HOST_NOT_ALLOWED"|"PRODUCTION_SECRETS_VISIBLE";
export type GuardResult={ok:true}|{ok:false;status:404|503;reason:string;code:GuardCode};

/** Lower-cased host without port. */
export const normaliseHost=(h:string|null|undefined)=>(h ?? "").trim().toLowerCase().replace(/:\d+$/,"");

export function allowedHosts(env:Env):string[]{
  return (env.VALIDATION_ALLOWED_HOSTS ?? "").split(",").map(normaliseHost).filter(Boolean);
}

export function visibleProductionSecrets(env:Env):string[]{
  const hit=new Set<string>();
  for(const n of PRODUCTION_SECRET_NAMES) if(env[n]) hit.add(n);
  for(const k of Object.keys(env)) if(env[k] && PRODUCTION_SECRET_PREFIXES.some((p)=>k.startsWith(p))) hit.add(k);
  return [...hit];
}

/** `host` is the Host the request was made to (the alias the visitor used). */
export function checkEnvironment(env:Env=process.env,host?:string|null):GuardResult{
  if(env.VALIDATION_UI_ENABLED!=="1") return {ok:false,status:404,code:"DISABLED",reason:"disabled"};
  // local development/tests may opt in explicitly; deployed code must be a Vercel preview
  const local=env.VALIDATION_ALLOW_LOCAL==="1" && !env.VERCEL_ENV && !env.VERCEL;
  if(!local && env.VERCEL_ENV!=="preview") return {ok:false,status:404,code:"NOT_PREVIEW",reason:"not a preview deployment"};
  const hosts=allowedHosts(env);
  if(!hosts.length) return {ok:false,status:503,code:"MISCONFIGURED",reason:"VALIDATION_ALLOWED_HOSTS is not set. List the Preview hostname(s) you have confirmed are behind Vercel Authentication (comma separated, no https://)."};
  if(host!==undefined){
    const h=normaliseHost(host);
    if(!h || !hosts.includes(h)) return {ok:false,status:404,code:"HOST_NOT_ALLOWED",reason:"host not allowed"};
  }
  const leaked=visibleProductionSecrets(env);
  if(leaked.length) return {ok:false,status:503,code:"PRODUCTION_SECRETS_VISIBLE",reason:`Production credentials are visible to this Preview deployment (${leaked.join(", ")}). Remove them from the Preview environment scope and redeploy; this interface refuses to run next to them.`};
  return {ok:true};
}
