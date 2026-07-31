/**
 * ef_notify as a library (spec §7 calls it a single dispatcher; implementing it
 * as a shared module avoids a function-to-function HTTP hop while keeping one
 * choke point for every channel).
 *
 * Channel truth table today:
 *   email    — sends via Resend when RESEND_API_KEY + MAIL_FROM are configured;
 *              queued otherwise. The queue drains once the secrets land.
 *   whatsapp — queued always (Meta WABA for Corlington pending; ops forward
 *              magic links manually from the notifications payload meanwhile).
 *   portal   — the notifications row IS the delivery; marked sent immediately.
 *   sms/slack — queued placeholders for Phase 2.
 *
 * Every attempt writes a notifications row first, so nothing is ever sent
 * without a record, and a crash after insert leaves 'queued' — retryable —
 * rather than a silent gap.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface NotifyInput {
  event: string;
  recipientType: "vendor_user" | "corporate_user" | "ops" | "traveler";
  recipientId?: string | null;
  channel: "email" | "whatsapp" | "sms" | "portal" | "slack";
  template: string;
  payload: Record<string, unknown>;
  /** Stable key for idempotency, e.g. `rfq_sent:{offerId}:email`. */
  dedupeKey?: string;
  /** For channel email. */
  toEmail?: string;
  subject?: string;
  html?: string;
}

export async function notify(
  admin: SupabaseClient,
  input: NotifyInput,
): Promise<void> {
  const { data: row, error } = await admin
    .from("notifications")
    .insert({
      event: input.event,
      recipient_type: input.recipientType,
      recipient_id: input.recipientId ?? null,
      channel: input.channel,
      template: input.template,
      payload: input.payload,
      dedupe_key: input.dedupeKey ?? null,
      status: "queued",
    })
    .select("id")
    .single();

  if (error) {
    // Unique violation on dedupe_key = already recorded; anything else is a
    // real problem but must not abort the caller's transaction-of-record.
    if (!error.message.includes("duplicate key")) {
      console.error("notify_insert_failed", { event: input.event, error: error.message });
    }
    return;
  }

  if (input.channel === "portal") {
    await admin
      .from("notifications")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", row.id);
    return;
  }

  if (input.channel === "email" && input.toEmail && input.html) {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("MAIL_FROM");
    if (!apiKey || !from) return; // stays queued until secrets exist

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [input.toEmail],
          subject: input.subject ?? "Corlington",
          html: input.html,
        }),
      });
      if (res.ok) {
        const body = await res.json();
        await admin
          .from("notifications")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            provider_id: body?.id ?? null,
          })
          .eq("id", row.id);
      } else {
        const text = await res.text();
        console.error("notify_email_failed", { status: res.status, text });
        await admin.from("notifications").update({ status: "failed" }).eq("id", row.id);
      }
    } catch (err) {
      console.error("notify_email_error", {
        error: err instanceof Error ? err.message : String(err),
      });
      await admin.from("notifications").update({ status: "failed" }).eq("id", row.id);
    }
  }
  // whatsapp / sms / slack: intentionally left queued.
}
