import { NextResponse } from "next/server";
import { markConversationOutcome } from "@/lib/logging";
import { supportEmail } from "@/lib/mode";
import { salvarResumoConversa } from "@/lib/resumo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // The case key — an order id, or the customer's email when no purchase
    // could be matched to it.
    const caseKey = String(
      body.caseKey ?? body.orderId ?? body.receipt ?? "",
    ).trim();
    const platform = String(body.platform ?? "").trim().toLowerCase() || null;

    if (caseKey.length < 4) {
      return NextResponse.json(
        { error: "Please start over from the beginning." },
        { status: 400 },
      );
    }

    await markConversationOutcome(caseKey, "resolved", platform);

    // Grava a memória do atendimento no banco do SendTrace — o próximo
    // contato deste cliente começa de onde este parou. Fire-and-forget.
    salvarResumoConversa(caseKey, "resolvido (cliente retido)").catch((e) =>
      console.warn("[resolve-conversation] resumo não gravado", e),
    );

    // A tela de encerramento mostra o e-mail de suporte também no caminho
    // "resolvido": ticket fechado não pode significar porta fechada.
    return NextResponse.json({ ok: true, supportEmail: supportEmail() });
  } catch (err) {
    console.error("[resolve-conversation]", err);
    return NextResponse.json(
      { error: "Could not resolve conversation." },
      { status: 500 },
    );
  }
}
