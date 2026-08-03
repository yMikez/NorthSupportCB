import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ESCALATION_THRESHOLD, escalationGateOpen } from "@/lib/claude";
import { markConversationOutcome } from "@/lib/logging";
import { escalateToHuman } from "@/lib/refunds";
import { supportEmail } from "@/lib/mode";
import { countRefundDemands, countHumanRequests } from "@/lib/retention";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { pickAgent } from "@/lib/agents";
import { salvarResumoConversa } from "@/lib/resumo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recomputes the escalation gate from what the customer actually wrote, so a
 * model that jumps the gun cannot short-circuit retention. Falls open when the
 * conversation cannot be read — a customer must never be stuck in a loop
 * because of a database problem.
 */
async function checkGate(
  conversationId: string | null,
  urgent: boolean,
): Promise<{ allowed: boolean; demands: number }> {
  if (urgent) return { allowed: true, demands: 0 };
  if (!conversationId) return { allowed: true, demands: 0 };

  try {
    const rows = await prisma.message.findMany({
      where: { conversationId, role: "user" },
      select: { content: true },
      orderBy: { createdAt: "asc" },
    });
    if (rows.length === 0) return { allowed: true, demands: 0 };

    // A MESMA regra do prompt (exigências, pedidos de humano, conversa
    // arrastada) — duas regras divergentes fariam o modelo escalar e o
    // servidor recusar, prendendo o cliente no meio.
    const msgs = rows.map((r) => ({ role: "user" as const, content: r.content }));
    const demands = countRefundDemands(msgs);
    return {
      allowed: escalationGateOpen({
        demands,
        humanRequests: countHumanRequests(msgs),
        userTurns: msgs.length,
      }),
      demands,
    };
  } catch (err) {
    console.error("[escalate] gate check failed, allowing", err);
    return { allowed: true, demands: 0 };
  }
}

/**
 * The agent could not retain the customer — hand the conversation to a person.
 *
 * No money moves here. This creates a work item in the /admin queue carrying
 * the conversation id, so whoever picks it up can read the whole exchange.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // The case key: an order id when the customer's email matched a purchase,
    // the email address itself when it did not.
    const caseKey = String(body.caseKey ?? body.orderId ?? "").trim();
    const rawEmail = String(body.email ?? "").trim();
    const email = isValidEmail(rawEmail) ? normalizeEmail(rawEmail) : null;
    const platform = String(body.platform ?? "").trim() || null;
    const conversationId = String(body.conversationId ?? "").trim() || null;
    const reason = body.reason ? String(body.reason).slice(0, 500) : null;
    const urgent = body.urgent === true;

    if (caseKey.length < 4) {
      return NextResponse.json(
        { error: "Please start over from the beginning." },
        { status: 400 },
      );
    }

    // Belt and braces: the prompt only offers the escalate action once the gate
    // is open, but the model is not the authority on whether it may escalate.
    // Re-derive the decision from the stored conversation.
    const gate = await checkGate(conversationId, urgent);
    if (!gate.allowed) {
      console.warn(
        `[escalate] blocked for case ${caseKey} — ${gate.demands}/${ESCALATION_THRESHOLD} demands`,
      );
      return NextResponse.json(
        { error: "Not eligible for handover yet.", demands: gate.demands },
        { status: 409 },
      );
    }

    const queued = await escalateToHuman({
      orderId: caseKey,
      platform,
      conversationId,
      customerEmail: email,
      reason,
      urgent,
    });
    await markConversationOutcome(caseKey, "escalated", platform);

    // A memória de longo prazo: o resumo vai para o banco do SendTrace e o
    // próximo atendimento (humano ou IA) começa sabendo o que houve aqui.
    // Fire-and-forget — o cliente não espera por isto.
    salvarResumoConversa(
      caseKey,
      urgent ? "escalado para humano (urgente)" : "escalado para humano",
    ).catch((e) => console.warn("[escalate] resumo não gravado", e));

    // Nothing is emailed from here. The confirmation screen hands the customer
    // a mailto: link with the message already written, so reaching a person is
    // one click in their own mail app — and it cannot fail silently the way an
    // outbound send can.
    return NextResponse.json({
      ok: true,
      reference: queued?.reference ?? null,
      supportEmail: supportEmail(),
      // What the pre-written message should quote, resolved server-side so the
      // browser is not the authority on any of it.
      agentName: pickAgent(conversationId).name,
      orderId: queued?.orderId ?? null,
      productTitle: queued?.productTitle ?? null,
    });
  } catch (err) {
    console.error("[escalate] unexpected", err);
    return NextResponse.json(
      { error: "Could not hand this over. Please try again." },
      { status: 500 },
    );
  }
}
