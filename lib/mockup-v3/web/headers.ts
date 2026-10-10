/** Security headers for the validation interface. Pure functions so they can be tested without a server. */
export function buildCsp(nonce:string):string{
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "upgrade-insecure-requests"
  ].join("; ");
}

/** Everything the page does not need is denied. clipboard-write stays for the "Copy feedback" button. */
export const PERMISSIONS_POLICY=[
  "accelerometer=()","autoplay=()","browsing-topics=()","camera=()","clipboard-read=()","clipboard-write=(self)","display-capture=()",
  "encrypted-media=()","fullscreen=()","geolocation=()","gyroscope=()","hid=()","idle-detection=()","magnetometer=()","microphone=()",
  "midi=()","payment=()","publickey-credentials-get=()","screen-wake-lock=()","serial=()","usb=()","xr-spatial-tracking=()"
].join(", ");

export const STATIC_SECURITY_HEADERS:Record<string,string>={
  "Permissions-Policy":PERMISSIONS_POLICY,
  "Cross-Origin-Opener-Policy":"same-origin",
  "X-Robots-Tag":"noindex, nofollow, noarchive",
  "Cache-Control":"no-store, private",
  "X-Frame-Options":"DENY",
  "Referrer-Policy":"no-referrer",
  "X-Content-Type-Options":"nosniff"
};
