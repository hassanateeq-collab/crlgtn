/**
 * ef_whoami — the template Edge Function (M0).
 *
 * Establishes the pattern every later function follows, and earns its keep
 * permanently as the fastest way to answer "who does the platform think I am,
 * and what will RLS let me see?" when a policy misbehaves.
 *
 * It performs no domain write, but it does append an audit row, which is the
 * M0 done-gate: the template function writes to audit_log.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";

serveEdge("ef_whoami", async ({ admin, actor, functionName }: EdgeContext) => {
  // ---- validate -----------------------------------------------------------
  // Nothing to validate: the actor resolution in the envelope is the whole
  // input. Later functions do their argument checking here.

  // ---- read ---------------------------------------------------------------
  // Deliberately queried through the service-role client and then compared with
  // what the caller sees client-side under RLS. A mismatch is the bug.
  let corporate: { id: string; name: string; status: string } | null = null;
  if (actor.corporateId) {
    const { data } = await admin
      .from("corporates")
      .select("id, name, status")
      .eq("id", actor.corporateId)
      .maybeSingle();
    corporate = data ?? null;
  }

  const { count: visibleLiveVendors } = await admin
    .from("vendors")
    .select("id", { count: "exact", head: true })
    .eq("status", "live");

  // ---- audit --------------------------------------------------------------
  await writeAudit(admin, actor, {
    action: functionName,
    entity: actor.actorType === "ops_user" ? "ops_users" : "corporate_users",
    entityId: actor.recordId,
    diff: { identity_checked_at: new Date().toISOString() },
  });

  // ---- respond ------------------------------------------------------------
  return {
    authUserId: actor.authUserId,
    actorType: actor.actorType,
    name: actor.name,
    email: actor.email,
    isOps: isOps(actor),
    opsRole: actor.opsRole,
    corporateRole: actor.corporateRole,
    corporate,
    liveVendorCount: visibleLiveVendors ?? 0,
    serverTimeUtc: new Date().toISOString(),
  };
});
