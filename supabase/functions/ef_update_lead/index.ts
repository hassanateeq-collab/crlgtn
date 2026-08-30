/**
 * ef_update_lead — ops working a marketing enquiry.
 *
 * Leads arrive from the public site through ef_lead (unauthenticated by
 * necessity). Everything after that is ops-only: moving a lead along its
 * status, or attaching a note about the call.
 *
 * Deliberately narrow. It cannot create or delete a lead, cannot alter what the
 * enquirer actually typed, and cannot touch any other table. A lead is a record
 * of what a stranger claimed — ops annotate it, they do not rewrite it.
 * Converting a lead into a real corporate or vendor stays a separate, explicit
 * act through ef_upsert_corporate / ef_onboard_vendor.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";
import { badRequest, forbidden, notFound, unprocessable } from "../_shared/errors.ts";

const STATUSES = ["new", "contacted", "qualified", "converted", "rejected"];

serveEdge("ef_update_lead", async ({ admin, actor, body, functionName }: EdgeContext) => {
  // ---- authorize -----------------------------------------------------------
  if (!isOps(actor)) throw forbidden("Only ops can work leads");

  // ---- validate ------------------------------------------------------------
  const id = String(body.id ?? "").trim();
  if (!id) throw badRequest("id is required");

  const status = body.status === undefined ? null : String(body.status);
  if (status !== null && !STATUSES.includes(status)) {
    throw unprocessable(`status must be one of ${STATUSES.join(", ")}`);
  }

  // An explicit empty string clears the note; undefined leaves it alone.
  const note = body.ops_note === undefined ? undefined : String(body.ops_note).slice(0, 2000);

  if (status === null && note === undefined) {
    throw badRequest("nothing to update");
  }

  const { data: before, error: readErr } = await admin
    .from("leads")
    .select("id, status, ops_note, org, kind")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw unprocessable(`lead lookup failed: ${readErr.message}`);
  if (!before) throw notFound("No such lead");

  // ---- write ---------------------------------------------------------------
  const patch: Record<string, unknown> = {};
  if (status !== null) {
    patch.status = status;
    // Stamp who picked it up the moment it leaves 'new', so "who has this?" is
    // answerable without reading the audit log.
    if (status !== "new") {
      patch.handled_by = actor.recordId;
      patch.handled_at = new Date().toISOString();
    }
  }
  if (note !== undefined) patch.ops_note = note || null;

  const { data: after, error: updErr } = await admin
    .from("leads")
    .update(patch)
    .eq("id", id)
    .select("id, status, ops_note, handled_by, handled_at")
    .single();
  if (updErr) throw unprocessable(`lead update failed: ${updErr.message}`);

  // ---- audit ---------------------------------------------------------------
  await writeAudit(admin, actor, {
    action: functionName,
    entity: "leads",
    entityId: id,
    diff: {
      org: before.org,
      kind: before.kind,
      status: status !== null ? { from: before.status, to: status } : undefined,
      ops_note_changed: note !== undefined ? true : undefined,
    },
  });

  // ---- respond -------------------------------------------------------------
  return after;
});
