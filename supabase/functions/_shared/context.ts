/**
 * Actor resolution.
 *
 * Two clients, two jobs, and the distinction is load-bearing:
 *
 *   · `admin` holds the service-role key and bypasses RLS. Every write in the
 *     platform goes through it. It never leaves the function.
 *   · the caller's JWT is used only to establish *who* is asking.
 *
 * Spec §4 puts ops identity in `app_metadata.role`. We trust that claim because
 * app_metadata is writable only by the service role — a corporate user cannot
 * promote themselves by editing their own profile, which is precisely why the
 * claim lives there and not in user_metadata.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { unauthorized } from "./errors.ts";

export type ActorType = "corporate_user" | "vendor_user" | "ops_user" | "system";

export type CorporateRole =
  | "corp_admin"
  | "corp_booker"
  | "corp_approver"
  | "corp_finance";

export type OpsRole = "ops_agent" | "ops_admin";

export interface Actor {
  authUserId: string;
  actorType: ActorType;
  /** The row id in corporate_users or ops_users — what audit_log.actor_id records. */
  recordId: string | null;
  name: string;
  email: string;
  corporateId: string | null;
  corporateRole: CorporateRole | null;
  opsRole: OpsRole | null;
}

export const isOps = (a: Actor) => a.actorType === "ops_user";
export const isOpsAdmin = (a: Actor) => a.opsRole === "ops_admin";

/** Service-role client. Bypasses RLS by design; never expose it to a caller. */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be present in the function environment",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Verifies the bearer token and resolves it to a Corlington actor.
 *
 * The gateway already rejected requests without a JWT (verify_jwt = true), but
 * we re-verify here rather than decoding the token ourselves: a function must
 * never be one config flag away from trusting an unverified claim.
 */
export async function resolveActor(
  req: Request,
  admin: SupabaseClient,
): Promise<Actor> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!token) throw unauthorized("Missing bearer token");

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) throw unauthorized("Invalid or expired token");

  const user = userData.user;
  const claimedRole =
    (user.app_metadata as Record<string, unknown> | null)?.role ?? null;

  // Ops first: the claim is the gate, and ops_users is the registry behind it.
  if (claimedRole === "ops_agent" || claimedRole === "ops_admin") {
    const { data: ops } = await admin
      .from("ops_users")
      .select("id, name, email, role, active")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    // A claim with no active registry row is a revoked account, not an ops user.
    if (!ops || ops.active !== true) {
      throw unauthorized("Ops account is not active");
    }
    return {
      authUserId: user.id,
      actorType: "ops_user",
      recordId: ops.id,
      name: ops.name,
      email: ops.email,
      corporateId: null,
      corporateRole: null,
      // The registry row wins over the claim if they ever disagree.
      opsRole: ops.role as OpsRole,
    };
  }

  const { data: corp } = await admin
    .from("corporate_users")
    .select("id, corporate_id, role, name, email")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!corp) {
    // Authenticated with Supabase but not provisioned by ops. Corlington is
    // closed-access; an unlinked auth user is not yet anybody.
    throw unauthorized("No Corlington profile linked to this account");
  }

  return {
    authUserId: user.id,
    actorType: "corporate_user",
    recordId: corp.id,
    name: corp.name,
    email: corp.email,
    corporateId: corp.corporate_id,
    corporateRole: corp.role as CorporateRole,
    opsRole: null,
  };
}
