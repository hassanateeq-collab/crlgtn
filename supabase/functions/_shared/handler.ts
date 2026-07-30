/**
 * The Edge Function envelope. Every Corlington function is written as a handler
 * passed to `serveEdge`, which establishes the pattern the spec mandates:
 *
 *     JWT check → validate → write → audit → respond
 *
 * Centralising it means no individual function can forget the auth step, leak a
 * stack trace, or invent its own response shape.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, preflight } from "./cors.ts";
import { EdgeError, badRequest } from "./errors.ts";
import { adminClient, resolveActor, type Actor } from "./context.ts";

export interface EdgeContext {
  req: Request;
  /** Service-role client. The only thing permitted to write. */
  admin: SupabaseClient;
  actor: Actor;
  body: Record<string, unknown>;
  functionName: string;
}

export type EdgeHandler = (ctx: EdgeContext) => Promise<unknown>;

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw badRequest("Request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof EdgeError) throw err;
    throw badRequest("Request body is not valid JSON");
  }
}

export function serveEdge(functionName: string, handler: EdgeHandler): void {
  Deno.serve(async (req: Request) => {
    const pre = preflight(req);
    if (pre) return pre;

    const headers = {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
    };

    try {
      if (req.method !== "POST") {
        throw new EdgeError(
          405,
          "method_not_allowed",
          "This function accepts POST only",
        );
      }

      const admin = adminClient();
      const actor = await resolveActor(req, admin);
      const body = await parseBody(req);

      const data = await handler({ req, admin, actor, body, functionName });

      return new Response(JSON.stringify({ ok: true, data: data ?? null }), {
        status: 200,
        headers,
      });
    } catch (err) {
      if (err instanceof EdgeError) {
        // Expected, client-actionable failures. Safe to describe.
        return new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: err.code,
              message: err.message,
              details: err.details ?? null,
            },
          }),
          { status: err.status, headers },
        );
      }

      // Unexpected. Log everything, tell the client nothing.
      console.error("unhandled_error", {
        function: functionName,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          error: { code: "internal_error", message: "Something went wrong" },
        }),
        { status: 500, headers },
      );
    }
  });
}
