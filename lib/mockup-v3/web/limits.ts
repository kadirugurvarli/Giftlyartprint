/**
 * Request/response budgets. Vercel serverless functions accept ~4.5 MB bodies, so both images plus
 * metadata must fit in one request, and the answer (mockup + overlay + report) in one response.
 */
export const REQUEST_LIMIT_BYTES=4_400_000;
export const SOURCE_TARGET_BYTES=2_450_000;
export const REFERENCE_TARGET_BYTES=1_550_000;
export const RESPONSE_LIMIT_BYTES=4_300_000;
export const MAX_SIDE=4000;
export const MAX_PIXELS=16_000_000;
/** The engine downsizes the reference to this anyway, so sending more is wasted. */
export const REFERENCE_MAX_SIDE=2400;
export const MAX_DURATION_S=60;
