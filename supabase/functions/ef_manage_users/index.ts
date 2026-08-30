/**
 * ef_manage_users — ops-admin-only account management:
 *
 *   · upsert_ops      — create/update an ops team member: registry row,
 *                       auth account (created if missing), app_metadata.role.
 *   · set_password    — issue a password for any existing account (ops or
 *                       corporate booker). The password arrives in the request,
 *                       is set via the admin API, and is NEVER stored or
 *                       logged here — the audit row records only who/when.
 *   · set_ops_active  — activate/deactivate an ops member (not yourself).
 *
 * Passwords exist because the closed-access OTP needs working email; until the
 * mail secrets land — and for desks that prefer them — the Corlington desk
 * issues a password shown once to the admin.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOpsAdmin } from "../_shared/context.ts";
import { badRequest, forbidden, notFound, unprocessable } from "../_shared/errors.ts";

const OPS_ROLES = ["ops_agent", "ops_admin"];

async function findAuthUserByEmail(admin: EdgeContext["admin"], email: string) {
  // Small user base; paging once is fine at this scale.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return data?.users.find((u) => u.email?.toLowerCase() === email) ?? null;
}

serveEdge("ef_manage_users", async ({ admin, actor, body, functionName }: EdgeContext) => {
  if (!isOpsAdmin(actor)) throw forbidden("Only ops admins manage accounts");

  const action = body.action as string | undefined;

  // ---- upsert_ops ----------------------------------------------------------
  if (action === "upsert_ops") {
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "ops_agent");
    if (!name || !email) throw badRequest("name and email are required");
    if (!OPS_ROLES.includes(role)) throw unprocessable("role must be ops_agent or ops_admin");

    const { data: row, error } = await admin
      .from("ops_users")
      .upsert({ name, email, role, active: true }, { onConflict: "email" })
      .select("id, auth_user_id")
      .single();
    if (error) throw unprocessable(`ops registry: ${error.message}`);

    // Ensure the auth account exists and carries the ops claim.
    let authId = row.auth_user_id as string | null;
    if (!authId) {
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { role },
        user_metadata: { name },
      });
      authId = created.data?.user?.id ?? (await findAuthUserByEmail(admin, email))?.id ?? null;
      if (!authId) throw unprocessable("could not create or find the sign-in account");
      const { error: linkErr } = await admin
        .from("ops_users").update({ auth_user_id: authId }).eq("id", row.id);
      if (linkErr) throw unprocessable(`link failed: ${linkErr.message}`);
    }
    // The claim follows the registry role even on role changes.
    await admin.auth.admin.updateUserById(authId, { app_metadata: { role } });

    await writeAudit(admin, actor, {
      action: functionName,
      entity: "ops_users",
      entityId: row.id,
      diff: { after: { op: "upsert_ops", email, role } },
    });

    const { data: fresh } = await admin
      .from("ops_users").select("id, name, email, role, active, auth_user_id").eq("id", row.id).single();
    return { ops_user: fresh };
  }

  // ---- set_password --------------------------------------------------------
  if (action === "set_password") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!email) throw badRequest("email is required");
    if (password.length < 12) throw unprocessable("password must be at least 12 characters");

    const user = await findAuthUserByEmail(admin, email);
    if (!user) {
      throw notFound(
        "No sign-in account for that email yet — save the corporate (or team member) first to provision it.",
      );
    }
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) throw unprocessable(`password update failed: ${error.message}`);

    // Deliberately no password anywhere near the audit log.
    await writeAudit(admin, actor, {
      action: functionName,
      entity: "auth_users",
      entityId: user.id,
      diff: { after: { op: "set_password", email } },
    });
    return { email, password_set: true };
  }

  // ---- set_ops_active ------------------------------------------------------
  if (action === "set_ops_active") {
    const id = String(body.id ?? "");
    const active = Boolean(body.active);
    if (!id) throw badRequest("id is required");
    if (id === actor.recordId && !active) throw unprocessable("you cannot deactivate yourself");

    const { data: row, error } = await admin
      .from("ops_users").update({ active }).eq("id", id)
      .select("id, name, email, role, active").single();
    if (error) throw unprocessable(error.message);

    await writeAudit(admin, actor, {
      action: functionName,
      entity: "ops_users",
      entityId: id,
      diff: { after: { op: "set_ops_active", active } },
    });
    return { ops_user: row };
  }

  throw badRequest("action must be upsert_ops, set_password or set_ops_active");
});
