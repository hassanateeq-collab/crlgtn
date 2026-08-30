/**
 * CORS for the corporate portal, ops console and vendor magic-link page.
 *
 * ALLOWED_ORIGINS is a comma-separated allowlist set as a function secret. It is
 * unset in local development, where we fall back to the Vite dev server. We do
 * not fall back to "*": the portal sends Authorization headers, and a wildcard
 * origin with credentials is exactly the mistake worth designing out.
 */

// The production portal is a known, fixed origin — baked in so functions work
// the moment they're deployed. ALLOWED_ORIGINS overrides (it REPLACES this
// list, so include every origin you want when setting it).
const DEFAULT_ORIGINS = [
  // Production hosts, one per audience (canonical domain: corlington.pk).
  "https://book.corlington.pk", // corporate portal
  "https://link.corlington.pk", // vendor magic-link pages
  "https://atlas.corlington.pk", // ops console
  // Cutover fallback — REMOVE once the .pk hosts are verified and serving.
  "https://crlgtn.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function allowlist(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (!configured) return DEFAULT_ORIGINS;
  return configured.split(",").map((o) => o.trim()).filter(Boolean);
}

/** Headers to attach to every response, echoing the origin only if allowed. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = allowlist();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
