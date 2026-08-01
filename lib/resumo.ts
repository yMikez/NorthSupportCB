/**
 * O resumo do atendimento, gravado de volta no banco do SendTrace.
 *
 * É a memória de longo prazo do suporte: quando o mesmo cliente voltar, o
 * agente recebe este resumo no prompt (via lib/sendtrace.ts) e retoma de onde
 * o último contato parou — a conversa melhora a cada atendimento em vez de
 * recomeçar do zero. O painel também o mostra, então um humano que assuma o
 * caso lê em quatro frases o que aconteceu.
 *
 * Roda DEPOIS da resposta ao cliente, fire-and-forget: um resumo perdido é
 * uma pena; um cliente esperando por causa dele seria um erro.
 */
import { prisma } from "./db";
import { CLAUDE_MODEL, getAnthropicClient } from "./claude";
import { isMockAI } from "./mock";
import { sendtraceEnabled, gravarResumoChat } from "./sendtrace";
import { isValidEmail } from "./email";
import { isChargebackRisk } from "./retention";

const MAX_MENSAGENS = 30;
const MAX_POR_MENSAGEM = 400;

async function resumirComClaude(transcricao: string): Promise<string | null> {
  try {
    const client = getAnthropicClient();
    const resposta = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      system:
        "Você resume conversas de suporte ao cliente para o histórico interno. " +
        "Responda APENAS com o resumo, em português, em até 4 frases: motivo do " +
        "contato, humor do cliente, o que foi tentado, e o desfecho. Inclua " +
        "qualquer detalhe que ajude o próximo atendente (produto, promessas " +
        "feitas, sinais de risco de chargeback). Sem saudação, sem markdown.",
      messages: [{ role: "user", content: transcricao }],
    });
    const bloco = resposta.content.find((b) => b.type === "text");
    return bloco && "text" in bloco ? bloco.text.trim() : null;
  } catch (err) {
    console.warn("[resumo] Claude indisponível:", (err as Error).message);
    return null;
  }
}

/**
 * Resume a conversa mais recente deste caso e grava no SendTrace.
 *
 * `caseKey` é o mesmo da conversa (Conversation.orderId): um número de pedido
 * ou o e-mail do cliente. `desfecho` é o rótulo humano do que aconteceu —
 * "resolvido (cliente retido)", "escalado para atendente humano", etc.
 */
export async function salvarResumoConversa(
  caseKey: string,
  desfecho: string,
): Promise<void> {
  if (!sendtraceEnabled()) return;

  try {
    const conversa = await prisma.conversation.findFirst({
      where: { orderId: caseKey },
      orderBy: { lastActivityAt: "desc" },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!conversa) return;

    const email =
      conversa.customerEmail ?? (isValidEmail(caseKey) ? caseKey : null);
    if (!email) return;

    const mensagens = conversa.messages.slice(-MAX_MENSAGENS);
    if (!mensagens.length) return;

    const transcricao = mensagens
      .map(
        (m) =>
          `${m.role === "user" ? "Cliente" : "Agente"}: ${m.content.slice(0, MAX_POR_MENSAGEM)}`,
      )
      .join("\n");

    // Em MOCK_AI não há Claude — um resumo mecânico ainda vale mais que nada.
    const corpo = isMockAI()
      ? `Conversa com ${mensagens.length} mensagens${conversa.productTitle ? ` sobre ${conversa.productTitle}` : ""}.`
      : ((await resumirComClaude(transcricao)) ??
        `Conversa com ${mensagens.length} mensagens${conversa.productTitle ? ` sobre ${conversa.productTitle}` : ""}.`);

    // O detector de risco roda sobre o que o cliente escreveu — o registro
    // no histórico carrega a marca, e o painel a mostra na linha do tempo.
    const risco = isChargebackRisk(
      mensagens
        .filter((m) => m.role === "user")
        .map((m) => ({ role: "user" as const, content: m.content })),
    );

    const data = new Date().toISOString().slice(0, 10);
    await gravarResumoChat(email, `[suporte ${data} · ${desfecho}] ${corpo}`, {
      desfecho,
      riscoChargeback: risco,
    });
  } catch (err) {
    console.warn("[resumo] não gravado:", (err as Error).message);
  }
}
