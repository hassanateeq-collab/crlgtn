/**
 * ef_upsert_corporate (M1) — corporate + credit profile + users, ops-only.
 *
 * The credit profile is set by ops judgment (spec §2): limit, terms, security.
 * Users are upserted by (corporate_id, email) and never deleted here — account
 * removal is a deliberate separate action, not a side effect of an edit form.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";
import { badRequest, forbidden, unprocessable } from "../_shared/errors.ts";

const CORP_ROLES = ["corp_admin", "corp_booker", "corp_approver", "corp_finance"];

serveEdge("ef_upsert_corporate", async ({ admin, actor, body, functionName }: EdgeContext) => {
  // ---- validate -----------------------------------------------------------
  if (!isOps(actor)) throw forbidden("Corporate management is an ops action");

  const corpIn = body.corporate as Record<string, unknown> | undefined;
  if (!corpIn || typeof corpIn.name !== "string" || !corpIn.name.trim()) {
    throw badRequest("corporate.name is required");
  }

  const creditLimit = corpIn.credit_limit_pkr ?? 0;
  if (!Number.isInteger(creditLimit) || (creditLimit as number) < 0) {
    throw unprocessable("credit_limit_pkr must be a non-negative integer (PKR)");
  }
  const securityAmount = corpIn.security_amount_pkr ?? 0;
  if (!Number.isInteger(securityAmount) || (securityAmount as number) < 0) {
    throw unprocessable("security_amount_pkr must be a non-negative integer (PKR)");
  }

  const usersIn = (body.users ?? []) as {
    role: string; name: string; email: string; phone?: string;
  }[];
  if (!Array.isArray(usersIn)) throw badRequest("users must be an array");
  for (const u of usersIn) {
    if (!CORP_ROLES.includes(u.role)) throw unprocessable(`unknown role ${u.role}`);
    if (!u.name?.trim() || !u.email?.trim()) {
      throw badRequest("every user needs name and email");
    }
  }

  // ---- write: corporate ----------------------------------------------------
  const corpRow = {
    name: (corpIn.name as string).trim(),
    status: corpIn.status ?? "prospect",
    credit_limit_pkr: creditLimit,
    credit_terms: corpIn.credit_terms ?? "on_checkout",
    security_type: corpIn.security_type ?? "none",
    security_amount_pkr: securityAmount,
    fee_waived_until: corpIn.fee_waived_until ?? null,
    approval_required: corpIn.approval_required ?? false,
    notes: corpIn.notes ?? null,
  };

  let corporateId = corpIn.id as string | undefined;
  if (corporateId) {
    const { error } = await admin.from("corporates").update(corpRow).eq("id", corporateId);
    if (error) throw unprocessable(`corporate update failed: ${error.message}`);
  } else {
    const { data, error } = await admin
      .from("corporates").insert(corpRow).select("id").single();
    if (error) throw unprocessable(`corporate insert failed: ${error.message}`);
    corporateId = data.id;
  }

  // ---- write: users --------------------------------------------------------
  for (const u of usersIn) {
    const { error } = await admin.from("corporate_users").upsert(
      {
        corporate_id: corporateId,
        role: u.role,
        name: u.name.trim(),
        email: u.email.trim().toLowerCase(),
        phone: u.phone?.trim() || null,
      },
      { onConflict: "corporate_id,email" },
    );
    if (error) throw unprocessable(`user ${u.email}: ${error.message}`);
  }

  // ---- audit ---------------------------------------------------------------
  await writeAudit(admin, actor, {
    action: functionName,
    entity: "corporates",
    entityId: corporateId,
    diff: { after: { corporate: corpRow, users: usersIn.length } },
  });

  // ---- respond --------------------------------------------------------------
  const [corporate, users] = await Promise.all([
    admin.from("corporates").select("*").eq("id", corporateId).single(),
    admin
      .from("corporate_users")
      .select("id, role, name, email, phone, auth_user_id")
      .eq("corporate_id", corporateId)
      .order("name"),
  ]);

  return { corporate: corporate.data, users: users.data ?? [] };
});
