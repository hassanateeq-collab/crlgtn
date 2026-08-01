/**
 * ef_finance (M7) — the ops money desk in one function.
 *
 * DEVIATION from spec §7's three names (ef_generate_invoice, ef_record_payment,
 * ef_settlement_run): identical behaviour behind one endpoint with an `action`
 * discriminator, because the three share every scrap of scaffolding. Recorded
 * in BUILD_LOG; trivial to split later if the console grows teams.
 *
 * All actions ops-only. Invoices are normally born inside book_offer();
 * generate_invoice here is the backfill/repair path.
 */

import { serveEdge, type EdgeContext } from "../_shared/handler.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isOps } from "../_shared/context.ts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../_shared/errors.ts";

serveEdge("ef_finance", async ({ admin, actor, body, functionName }: EdgeContext) => {
  if (!isOps(actor)) throw forbidden("Finance actions are ops-only");

  const action = body.action as string | undefined;

  // ---- generate_invoice ----------------------------------------------------
  if (action === "generate_invoice") {
    const bookingId = body.booking_id as string | undefined;
    if (!bookingId) throw badRequest("booking_id is required");
    const { data, error } = await admin.rpc("generate_invoice_for_booking", {
      p_booking_id: bookingId,
      p_actor_type: "ops_user",
      p_actor_id: actor.recordId,
    });
    if (error) {
      if (error.message.includes("booking_not_found")) throw notFound("Booking not found");
      throw unprocessable(`invoice generation failed: ${error.message}`);
    }
    return data;
  }

  // ---- record_payment --------------------------------------------------------
  if (action === "record_payment") {
    const invoiceId = body.invoice_id as string | undefined;
    const amount = body.amount_pkr as number | undefined;
    const method = body.method as string | undefined;
    const reference = (body.reference as string | undefined)?.trim();
    if (!invoiceId) throw badRequest("invoice_id is required");
    if (!Number.isInteger(amount) || (amount as number) <= 0) {
      throw unprocessable("amount_pkr must be a positive integer");
    }
    if (method !== "bank_transfer" && method !== "deposit_drawdown") {
      throw unprocessable("method must be bank_transfer or deposit_drawdown");
    }

    const { data: invoice } = await admin
      .from("invoices").select("*").eq("id", invoiceId).maybeSingle();
    if (!invoice) throw notFound("Invoice not found");
    if (invoice.status === "paid") throw conflict("Invoice is already paid");

    // Manual drawdown still respects the ledger.
    if (method === "deposit_drawdown") {
      const { data: dep } = await admin
        .from("deposits").select("*").eq("corporate_id", invoice.corporate_id).maybeSingle();
      if (!dep || dep.balance_pkr < (amount as number)) {
        throw unprocessable("Deposit balance is insufficient for this drawdown");
      }
      await admin.from("deposits")
        .update({ balance_pkr: dep.balance_pkr - (amount as number) })
        .eq("id", dep.id);
    }

    const { error: payErr } = await admin.from("payments").insert({
      corporate_id: invoice.corporate_id,
      invoice_id: invoiceId,
      amount_pkr: amount,
      method,
      reference: reference || null,
    });
    if (payErr) throw unprocessable(`payment failed: ${payErr.message}`);

    // Paid when cumulative payments cover the invoice.
    const { data: paidRows } = await admin
      .from("payments").select("amount_pkr").eq("invoice_id", invoiceId);
    const totalPaid = (paidRows ?? []).reduce((s, p) => s + p.amount_pkr, 0);
    let newStatus = invoice.status;
    if (totalPaid >= invoice.amount_pkr) {
      newStatus = "paid";
      await admin.from("invoices").update({ status: "paid" }).eq("id", invoiceId);
    }

    await writeAudit(admin, actor, {
      action: functionName,
      entity: "payments",
      entityId: invoiceId,
      diff: { after: { action, amount_pkr: amount, method, total_paid: totalPaid, status: newStatus } },
    });
    return { invoice_id: invoiceId, total_paid: totalPaid, status: newStatus };
  }

  // ---- run_settlement --------------------------------------------------------
  if (action === "run_settlement") {
    const period = body.period as string | undefined;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      throw badRequest("period must be YYYY-MM");
    }
    const { data, error } = await admin.rpc("run_settlement", { p_period: period });
    if (error) throw unprocessable(`settlement failed: ${error.message}`);
    await writeAudit(admin, actor, {
      action: functionName,
      entity: "settlements",
      diff: { after: { action, period } },
    });
    return { period, rows: data };
  }

  throw badRequest(`unknown action ${action ?? "(none)"}`);
});
