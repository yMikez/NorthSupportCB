import { NextResponse } from "next/server";
import { gravarCsat } from "@/lib/sendtrace";
import { isValidEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A nota de satisfação (1–5 estrelas) da tela final do chat.
 *
 * Só repassa ao SendTrace, que grava no atendimento mais recente (24h) do
 * pedido — este app não guarda a nota em lugar nenhum. Sempre responde ok:
 * a avaliação é cortesia do cliente, e um erro aqui viraria uma tela de
 * falha por causa de uma estrela.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Rating must be 1-5." }, { status: 400 });
    }

    // Mesma resolução de chave do resumo: o caseKey é uma transação sempre
    // que não for um e-mail; o e-mail do formulário cobre o resto.
    const caseKey = String(body.caseKey ?? "").trim();
    const email = String(body.email ?? "").trim();
    const transacaoId = caseKey && !isValidEmail(caseKey) ? caseKey : null;
    const emailFinal = isValidEmail(email)
      ? email
      : isValidEmail(caseKey)
        ? caseKey
        : null;

    if (transacaoId || emailFinal) {
      await gravarCsat({ transacaoId, email: emailFinal }, rating).catch(
        () => {},
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
