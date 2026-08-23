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
const TIERS = ["A", "B", "C"];
// d30 abolished by the cash-flow rule (2026-08-18); the DB trigger enforces the
// per-tier ceiling, this list just gives a cleaner error than the trigger's.
const TERMS = ["on_checkout", "d7", "d15", "d20"];

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

  if (corpIn.tier !== undefined && !TIERS.includes(String(corpIn.tier))) {
    throw unprocessable("tier must be A, B or C");
  }
  if (corpIn.credit_terms !== undefined && !TERMS.includes(String(corpIn.credit_terms))) {
    throw unprocessable("credit_terms must be on_checkout, d7, d15 or d20 (d30 is abolished)");
  }
  const threshold = corpIn.countersign_threshold_pkr;
  if (threshold !== undefined && threshold !== null) {
    if (!Number.isInteger(threshold) || (threshold as number) < 0) {
      throw unprocessable("countersign_threshold_pkr must be a non-negative integer");
    }
  }
  const agreementIn = body.agreement as Record<string, unknown> | undefined;
  /** Create auth accounts for users that have none — the closed-access OTP only works for existing accounts. */
  const provision = body.provision !== false;

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
    // Onboarding setup (migration 019).
    tier: corpIn.tier ?? "C",
    official_email: typeof corpIn.official_email === "string" && corpIn.official_email.trim()
      ? corpIn.official_email.trim().toLowerCase()
      : null,
    countersign_required: corpIn.countersign_required ?? false,
    countersign_threshold_pkr: threshold ?? null,
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

  // ---- write: users + auth provisioning ------------------------------------
  const provisioned: string[] = [];
  for (const u of usersIn) {
    const email = u.email.trim().toLowerCase();
    const { data: row, error } = await admin.from("corporate_users").upsert(
      {
        corporate_id: corporateId,
        role: u.role,
        name: u.name.trim(),
        email,
        phone: u.phone?.trim() || null,
      },
      { onConflict: "corporate_id,email" },
    ).select("id, auth_user_id").single();
    if (error) throw unprocessable(`user ${u.email}: ${error.message}`);

    // Link an auth account so the sign-in code actually arrives. Nothing is
    // emailed here; the user gets their first code when they sign in.
    if (provision && row && !row.auth_user_id) {
      let authId: string | null = null;
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { name: u.name.trim(), corlington: "corporate_user" },
      });
      if (created.data?.user) {
        authId = created.data.user.id;
      } else {
        // Already registered (e.g. moved between corporates): find and link.
        const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        authId = page?.users.find((x) => x.email?.toLowerCase() === email)?.id ?? null;
      }
      if (authId) {
        const { error: linkErr } = await admin
          .from("corporate_users").update({ auth_user_id: authId }).eq("id", row.id);
        if (linkErr) throw unprocessable(`link ${email}: ${linkErr.message}`);
        provisioned.push(email);
      }
    }
  }

  // ---- write: agreement record (append, never overwrite) ------------------
  if (agreementIn) {
    const { error } = await admin.from("agreements").insert({
      party_type: "corporate",
      party_id: corporateId,
      tier: agreementIn.tier ?? null,
      version: agreementIn.version ?? "v1",
      doc_url: agreementIn.doc_url ?? null,
      signed_digital_at: agreementIn.signed_digital_at ?? null,
      signed_physical_at: agreementIn.signed_physical_at ?? null,
    });
    if (error) throw unprocessable(`agreement: ${error.message}`);
  }

  // ---- audit ---------------------------------------------------------------
  await writeAudit(admin, actor, {
    action: functionName,
    entity: "corporates",
    entityId: corporateId,
    diff: { after: { corporate: corpRow, users: usersIn.length, provisioned, agreement: !!agreementIn } },
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

  return { corporate: corporate.data, users: users.data ?? [], provisioned };
});
