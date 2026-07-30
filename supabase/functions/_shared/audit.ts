/**
 * Audit writing. Spec §4: an append-only audit_log row for every mutating
 * function.
 *
 * The table rejects UPDATE and DELETE at the trigger level, so anything written
 * here is permanent. Write the truth and write it once.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Actor, ActorType } from "./context.ts";

export interface AuditEntry {
  /** The function name, e.g. "ef_book_offer". */
  action: string;
  /** The table touched, e.g. "bookings". */
  entity: string;
  entityId?: string | null;
  /** Conventionally { before, after }. Keep the shape stable per function. */
  diff?: Record<string, unknown> | null;
}

/**
 * Appends an audit row on behalf of a human actor.
 *
 * Deliberately does NOT throw. A failed audit write must not roll back a
 * completed booking — losing the log line is bad, losing the guest's room is
 * worse. Failures go to the function logs, where the M8 hardening pass looks.
 */
export async function writeAudit(
  admin: SupabaseClient,
  actor: Actor,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    actor_type: actor.actorType,
    actor_id: actor.recordId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    diff: entry.diff ?? null,
  });

  if (error) {
    console.error("audit_write_failed", {
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      error: error.message,
    });
  }
}

/**
 * Appends an audit row for an actor-less action — the cron sweeps
 * (ef_expire_sweep, ef_sla_monitor). actor_id stays NULL, which the
 * audit_log_actor_coherent constraint permits only for actor_type 'system'.
 */
export async function writeSystemAudit(
  admin: SupabaseClient,
  entry: AuditEntry,
): Promise<void> {
  const systemActor = {
    actorType: "system" as ActorType,
    recordId: null,
  } as Actor;
  await writeAudit(admin, systemActor, entry);
}
