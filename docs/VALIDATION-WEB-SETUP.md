# Validation web interface: Vercel setup (Preview only)

`/validation` on a Preview deployment of `feat/mockup-engine-v3`. Upload a source photo and a reference
photo, choose "Artwork only" or "Already framed", generate, compare side by side, see warnings and
suggested corrections, download the mockup, download feedback as JSON.

## Why there is no application password

Google Safe Browsing classified the first Preview hostname as deceptive after a custom password-only
form was used on a shared `*.vercel.app` host. The form was the most plausible trigger, so it was removed.
**Vercel Authentication is now the only login.** To keep that safe the app adds three code-level guards:

1. **Preview only.** `VERCEL_ENV` must be `preview` and `VALIDATION_UI_ENABLED=1`. Production returns 404.
2. **Host allowlist (`VALIDATION_ALLOWED_HOSTS`).** The tool serves only the hostname(s) you have confirmed
   sit behind Vercel Authentication. Any other alias of the same deployment (the unique deployment URL, other
   branch aliases, the production alias) returns 404. Empty list = nothing is served (fail closed).
3. **No production credentials nearby.** If any production credential is visible to the deployment
   (`CONTENT_FEED_*`, `OPENAI_*`, `METRICOOL_*`, `SHOPIFY_*`, `GOOGLE_*`, `BLOB_READ_WRITE_TOKEN`), the tool
   refuses to start (503 naming the variable, never the value).

Also: same-origin check on the API (Vercel's login cookie is sent automatically, so this blocks cross-site
requests), one generation at a time, strict CSP and Permissions-Policy, `noindex`, `no-store`.

## Data handling (unchanged)

Stateless: photos are processed in memory and returned in the response. No storage, no logs of content, no
image URLs. Your browser reads only camera facts (make, model, focal length, sizes; never GPS), shrinks a
copy to fit Vercel's ~4.5 MB limits, and outputs carry no EXIF/XMP/IPTC.

## Headers (middleware, validation paths only)

* `Content-Security-Policy`: `default-src 'none'; script-src 'nonce-<random per request>' 'strict-dynamic'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; manifest-src 'self'; upgrade-insecure-requests`
* `Permissions-Policy`: camera, microphone, geolocation, payment, USB, serial, HID, display-capture,
  clipboard-read and more are denied; only `clipboard-write=(self)` (for "Copy feedback").
* `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`.

## What YOU do in Vercel (in this order)

You have already: Vercel Authentication = Standard Protection, `VALIDATION_UI_ENABLED` Preview-only,
`OPENAI_API_KEY` and `CONTENT_FEED_*` Production-only.

**A. Verify protection on every alias (before anything else).** Use a private/incognito window that is NOT
signed in to Vercel (or your phone on mobile data). For each address below open `https://<address>/validation`
and confirm you are sent to a **Vercel login** (or get a 401), and never see "Validation studio":

1. The branch alias: `giftly-content-studio-git-feat-mocku-b5c687-kadirugurvarli-4605.vercel.app`
2. The unique deployment URL of the latest `feat/mockup-engine-v3` deployment (Deployments → that
   deployment → "Domains" / "Visit" dropdown).
3. Any other `*.vercel.app` address listed on that deployment.

Then check Production: `https://<your production domain>/validation` must show a 404 page.
If any Preview address shows the tool or a normal page without a Vercel login, stop and tell me.

**B. Check the remaining variables' scopes.** Settings → Environment Variables. Nothing named
`SHOPIFY_*`, `GOOGLE_*`, `METRICOOL_*`, `OPENAI_*`, `CONTENT_FEED_*` or `BLOB_*` may be ticked for Preview
(untick Preview/Development on any that are). The tool will show a 503 naming any it finds.

**C. Add one new variable, Preview only:**

| Name | Value | Environment |
|---|---|---|
| `VALIDATION_ALLOWED_HOSTS` | the hostname(s) from step A that showed the Vercel login, comma separated, without `https://` and without a path, e.g. `giftly-content-studio-git-feat-mocku-b5c687-kadirugurvarli-4605.vercel.app` | **Preview only** |

Re-open it and confirm Production and Development are not ticked. (Add only the aliases you verified in A.
Leaving out the unique deployment URL is fine and safer: it will simply return 404.)

**D. Redeploy** the latest `feat/mockup-engine-v3` Preview (Deployments → ⋯ → Redeploy) so it picks up the new
variable. Pushing the branch also creates a deployment, but a redeploy is needed if you add the variable afterwards.

**E. Later cleanup (not yet).** `VALIDATION_PASSWORD` and `VALIDATION_SESSION_SECRET` are no longer read by
anything. They may stay for now; delete them once everything works.

**F. Test:** private window → Vercel login → sign in → the studio opens directly (no second password).
Use only non-customer test images until all checks above pass.

## Google Safe Browsing

Do **not** submit anything yet. After A–F pass, see the review procedure in the report (Google's
"report incorrect phishing warning" form and a Vercel support request).

## Limits (Hobby)

`maxDuration` is 60 s (valid with or without Fluid Compute); request/response bodies ~4.5 MB (budgeted at
4.4 MB); one generation at a time. Realism checks use provisional, uncalibrated limits.
