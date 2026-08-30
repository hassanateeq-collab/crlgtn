/**
 * ef_lead — the public marketing site's enquiry endpoint.
 *
 * The SECOND function without JWT verification, and the reason is the same
 * shape as ef_vendor_respond's: the caller is by definition a stranger. A
 * company that wants an account, or a hotel that wants a visit, has no
 * credential yet — that is the entire point of the form.
 *
 * Because it is unauthenticated it is deliberately the narrowest thing that
 * works: it INSERTS one row into public.leads and notifies ops. It reads
 * nothing, returns nothing about existing data, provisions nothing, and cannot
 * be used to test whether a company is already a client. A lead is a stranger's
 * claim about themselves until ops verifies it.
 *
 * Controls: origin allowlist (CORS), fixed-window IP rate limit, a honeypot
 * field, hard length caps, and an IP hash kept for abuse triage rather than
 * identity.
 */

import { corsHeaders, preflight } from "../_shared/cors.ts";
import { adminClient } from "../_shared/context.ts";
import { notify } from "../_shared/notify.ts";

const MAX_PER_WINDOW = 5;
const WINDOW_SECS = 600; // 5 enquiries per 10 minutes per IP

interface LeadBody {
  kind?: string;
  org?: string;
  person?: string;
  email?: string;
  phone?: string;
  city?: string;
  volume?: string;
  notes?: string;
  source_page?: string;
  /** Honeypot. Real people never see this field; bots fill everything. */
  company_website?: string;
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

const fail = (req: Request, status: number, code: string, message: string) =>
  json(req, status, { ok: false, error: { code, message } });

/** Trim, collapse whitespace, and cap. Returns "" for absent values. */
function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Deliberately permissive: rejecting odd-but-valid addresses loses real leads. */
function looksLikeEmail(v: string): boolean {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v);
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail(req, 405, "method_not_allowed", "POST only");

  try {
    const admin = adminClient();

    let body: LeadBody;
    try {
      body = await req.json();
    } catch {
      return fail(req, 400, "bad_request", "Invalid JSON");
    }

    // ---- honeypot ---------------------------------------------------------
    // Answer 200 so a bot cannot learn it was caught, but store nothing.
    if (clean(body.company_website, 200)) {
      return json(req, 200, { ok: true, data: { received: true } });
    }

    // ---- rate limit -------------------------------------------------------
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const { data: allowed, error: rlErr } = await admin.rpc("check_rate_limit", {
      p_key: `lead:${ip}`,
      p_max: MAX_PER_WINDOW,
      p_window_secs: WINDOW_SECS,
    });
    if (rlErr) {
      console.error("rate limit check failed", rlErr.message);
    } else if (allowed === false) {
      return fail(req, 429, "rate_limited", "Too many requests. Please try again shortly.");
    }

    // ---- validate ---------------------------------------------------------
    const kind = clean(body.kind, 20);
    if (kind !== "corporate" && kind !== "vendor") {
      return fail(req, 422, "unprocessable", "kind must be 'corporate' or 'vendor'");
    }

    const org = clean(body.org, 200);
    const person = clean(body.person, 120);
    const email = clean(body.email, 200).toLowerCase();
    const phone = clean(body.phone, 60);

    const missing = [
      !org && "organisation",
      !person && "name",
      !email && "email",
      !phone && "phone",
    ].filter(Boolean);
    if (missing.length) {
      return fail(req, 422, "unprocessable", `Missing: ${missing.join(", ")}`);
    }
    if (!looksLikeEmail(email)) {
      return fail(req, 422, "unprocessable", "That email address does not look right");
    }

    const city = clean(body.city, 200) || null;
    const volume = clean(body.volume, 200) || null;
    // Notes keep their line breaks — clean() would flatten a paragraph.
    const notes = typeof body.notes === "string"
      ? body.notes.trim().slice(0, 2000) || null
      : null;

    // ---- write ------------------------------------------------------------
    const salt = Deno.env.get("LEAD_IP_SALT") ?? "corlington-lead";
    const { data: lead, error: insErr } = await admin
      .from("leads")
      .insert({
        kind,
        org,
        person,
        email,
        phone,
        city,
        volume,
        notes,
        source_page: clean(body.source_page, 300) || null,
        user_agent: clean(req.headers.get("user-agent"), 400) || null,
        ip_hash: await sha256(`${salt}:${ip}`),
      })
      .select("id, kind, org, created_at")
      .single();

    if (insErr || !lead) {
      console.error("lead insert failed", insErr?.message);
      return fail(req, 500, "internal", "Could not record the enquiry");
    }

    // ---- notify ops -------------------------------------------------------
    // Non-fatal by design: the lead is already safely stored, and a mail outage
    // must never make a prospective client think the form is broken.
    const to = Deno.env.get("LEAD_NOTIFY_EMAIL") ?? Deno.env.get("MAIL_FROM") ?? "";
    const label = kind === "corporate" ? "Company account request" : "Vendor listing request";
    try {
      await notify(admin, {
        event: "lead_received",
        recipientType: "ops",
        channel: "email",
        template: "lead_received",
        dedupeKey: `lead:${lead.id}`,
        toEmail: to || undefined,
        subject: `Corlington — ${label} — ${org}`,
        html: [
          `<h2>${escapeHtml(label)}</h2>`,
          `<table cellpadding="6" style="border-collapse:collapse;font:14px system-ui">`,
          `<tr><td><b>Organisation</b></td><td>${escapeHtml(org)}</td></tr>`,
          `<tr><td><b>Contact</b></td><td>${escapeHtml(person)}</td></tr>`,
          `<tr><td><b>Email</b></td><td>${escapeHtml(email)}</td></tr>`,
          `<tr><td><b>Phone</b></td><td>${escapeHtml(phone)}</td></tr>`,
          `<tr><td><b>${kind === "corporate" ? "Cities" : "City &amp; area"}</b></td><td>${escapeHtml(city ?? "—")}</td></tr>`,
          `<tr><td><b>${kind === "corporate" ? "Volume" : "Rooms / vehicles"}</b></td><td>${escapeHtml(volume ?? "—")}</td></tr>`,
          `<tr><td valign="top"><b>Notes</b></td><td>${escapeHtml(notes ?? "—").replace(/\n/g, "<br>")}</td></tr>`,
          `</table>`,
          `<p style="color:#666;font-size:12px">Lead ${lead.id} · recorded ${lead.created_at}</p>`,
        ].join(""),
        payload: { lead_id: lead.id, kind, org, person, email, phone, city, volume },
      });
    } catch (err) {
      console.error("lead notify failed (lead is stored)", err instanceof Error ? err.message : err);
    }

    return json(req, 200, { ok: true, data: { received: true } });
  } catch (err) {
    console.error("ef_lead unhandled", err instanceof Error ? err.message : err);
    return fail(req, 500, "internal", "Something went wrong");
  }
});
