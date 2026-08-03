/**
 * O resumo do atendimento, gravado de volta no banco do SendTrace.
 *
 * É a memória de longo prazo do suporte: quando o mesmo cliente voltar, o
 * agente recebe este resumo no prompt (via lib/sendtrace.ts) e retoma de onde
 * o último contato parou — a conversa melhora a cada atendimento em vez de
 * recomeçar do zero. O painel também o mostra, então um humano que assuma o
 * caso lê em quatro frases o que aconteceu.
 *
 * Além do texto, o encerramento grava o que o DASHBOARD conta: o motivo do
 * contato, se a IA resolveu, se houve pedido de reembolso e se foi revertido,
 * a duração — e as perguntas que a IA não soube responder, que viram o
 * backlog da base de conhecimento.
 *
 * Roda DEPOIS da resposta ao cliente, fire-and-forget: um resumo perdido é
 * uma pena; um cliente esperando por causa dele seria um erro.
 */
import { prisma } from "./db";
import { CLAUDE_MODEL, getAnthropicClient } from "./claude";
import { isMockAI } from "./mock";
import {
  sendtraceEnabled,
  gravarResumoChat,
  gravarResumoParcial,
  gravarPerguntasSemResposta,
} from "./sendtrace";
import { isValidEmail } from "./email";
import { isChargebackRisk } from "./retention";

const MAX_MENSAGENS = 30;
const MAX_POR_MENSAGEM = 400;

/** O vocabulário de motivos que o dashboard agrupa — mesma lista da API. */
const MOTIVOS = [
  "rastreamento",
  "reembolso",
  "cancelamento",
  "pedido_duplicado",
  "uso_do_produto",
  "cobranca",
  "endereco",
  "outro",
] as const;

/** Mesma regra do staleCloser: o cliente falou em reembolso nesta conversa? */
const REFUND_KEYWORDS =
  /\b(refund|reembolso|estorno|chargeback|money back|devolu[cç][aã]o|dinheiro de volta|reembols)\b/i;

interface ResumoEstruturado {
  resumo: string;
  motivo: (typeof MOTIVOS)[number] | null;
  perguntas: string[];
}

/**
 * Uma chamada só faz as três coisas: resume, classifica o motivo e lista as
 * perguntas que ficaram sem resposta. JSON estrito para o parse não depender
 * de boa vontade; se vier torto, o texto inteiro ainda serve de resumo.
 */
async function resumirComClaude(
  transcricao: string,
): Promise<ResumoEstruturado | null> {
  try {
    const client = getAnthropicClient();
    const resposta = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      system:
        "Você analisa conversas de suporte ao cliente para o histórico interno. " +
        'Responda APENAS com JSON válido, sem markdown: {"resumo": string, ' +
        '"motivo": string, "perguntas_sem_resposta": string[]}. ' +
        "resumo: em português, até 4 frases — motivo do contato, humor do " +
        "cliente, o que foi tentado e o desfecho; inclua o que ajudar o próximo " +
        "atendente (produto, promessas feitas, sinais de risco de chargeback). " +
        `motivo: exatamente um de ${MOTIVOS.join(", ")} — o assunto PRINCIPAL ` +
        "do contato. perguntas_sem_resposta: as perguntas do cliente que o " +
        "agente NÃO conseguiu responder de fato (na língua original, curtas); " +
        "lista vazia se não houver.",
      messages: [{ role: "user", content: transcricao }],
    });
    const bloco = resposta.content.find((b) => b.type === "text");
    const texto = bloco && "text" in bloco ? bloco.text.trim() : null;
    if (!texto) return null;

    try {
      const dados = JSON.parse(texto) as {
        resumo?: string;
        motivo?: string;
        perguntas_sem_resposta?: unknown;
      };
      const motivo = MOTIVOS.includes(dados.motivo as (typeof MOTIVOS)[number])
        ? (dados.motivo as (typeof MOTIVOS)[number])
        : null;
      return {
        resumo: String(dados.resumo ?? "").trim() || texto,
        motivo,
        perguntas: Array.isArray(dados.perguntas_sem_resposta)
          ? dados.perguntas_sem_resposta.map((p) => String(p)).filter(Boolean)
          : [],
      };
    } catch {
      // JSON quebrado: o texto ainda é um resumo utilizável.
      return { resumo: texto, motivo: null, perguntas: [] };
    }
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
  opts: {
    /**
     * true = checkpoint no meio da conversa: sobrescreve o "último
     * atendimento" do pedido, sem criar registro no histórico. O registro
     * definitivo é o save final (parcial: false), no encerramento.
     */
    parcial?: boolean;
  } = {},
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

    // A chave preferida é a TRANSAÇÃO: o caseKey é um id de pedido sempre
    // que não for um e-mail. A API resolve o que faltar pela fila.
    const transacaoId = !isValidEmail(caseKey) ? caseKey : null;
    const email =
      conversa.customerEmail ?? (isValidEmail(caseKey) ? caseKey : null);
    if (!transacaoId && !email) return;

    const mensagens = conversa.messages.slice(-MAX_MENSAGENS);
    if (!mensagens.length) return;

    const transcricao = mensagens
      .map(
        (m) =>
          `${m.role === "user" ? "Cliente" : "Agente"}: ${m.content.slice(0, MAX_POR_MENSAGEM)}`,
      )
      .join("\n");

    const doCliente = mensagens.filter((m) => m.role === "user");
    const houveIntencaoReembolso = doCliente.some((m) =>
      REFUND_KEYWORDS.test(m.content),
    );

    // Em MOCK_AI não há Claude — um resumo mecânico ainda vale mais que nada,
    // e o motivo cai na heurística de reembolso.
    const estruturado: ResumoEstruturado = isMockAI()
      ? {
          resumo: `Conversa com ${mensagens.length} mensagens${conversa.productTitle ? ` sobre ${conversa.productTitle}` : ""}.`,
          motivo: houveIntencaoReembolso ? "reembolso" : "outro",
          perguntas: [],
        }
      : ((await resumirComClaude(transcricao)) ?? {
          resumo: `Conversa com ${mensagens.length} mensagens${conversa.productTitle ? ` sobre ${conversa.productTitle}` : ""}.`,
          motivo: houveIntencaoReembolso ? "reembolso" : null,
          perguntas: [],
        });

    // O detector de risco roda sobre o que o cliente escreveu — o registro
    // no histórico carrega a marca, e o painel a mostra na linha do tempo.
    const risco = isChargebackRisk(
      doCliente.map((m) => ({ role: "user" as const, content: m.content })),
    );

    const data = new Date().toISOString().slice(0, 10);

    if (opts.parcial) {
      // Checkpoint: só o espelho no pedido, sobrescrevendo o anterior.
      await gravarResumoParcial(
        { transacaoId, email },
        `[suporte ${data} · ${desfecho}] ${estruturado.resumo}`,
      );
      return;
    }

    /*
     * Do outcome da conversa saem os números do dashboard:
     *
     *   resolved / refund_abandoned  → a IA fechou sozinha (resolvida)
     *   refund_issued                → a IA fechou emitindo o reembolso
     *   escalated                    → não resolvida (foi para humano)
     *   in_progress                  → sem veredito (fica nulo)
     *
     * "Pediu reembolso" = o outcome diz respeito a reembolso OU o cliente
     * falou nele; "evitado" = pediu e a conversa fechou SEM reembolso sair.
     */
    const outcome = conversa.outcome;
    const resolvido =
      outcome === "resolved" ||
      outcome === "refund_abandoned" ||
      outcome === "refund_issued"
        ? true
        : outcome === "escalated"
          ? false
          : null;
    const reembolsoPedido =
      houveIntencaoReembolso ||
      outcome === "refund_issued" ||
      outcome === "refund_abandoned";
    const reembolsoEvitado = reembolsoPedido
      ? outcome === "resolved" || outcome === "refund_abandoned"
      : null;
    const duracaoS = Math.round(
      ((conversa.endedAt ?? new Date()).getTime() -
        conversa.startedAt.getTime()) /
        1000,
    );

    await gravarResumoChat(
      { transacaoId, email },
      `[suporte ${data} · ${desfecho}] ${estruturado.resumo}`,
      {
        desfecho,
        riscoChargeback: risco,
        motivo: estruturado.motivo,
        resolvido,
        reembolsoPedido,
        reembolsoEvitado,
        duracaoS,
      },
    );

    // O backlog da base de conhecimento — fire-and-forget dentro do
    // fire-and-forget: falhar aqui não pode derrubar o resumo.
    if (estruturado.perguntas.length) {
      await gravarPerguntasSemResposta(
        { transacaoId, email },
        estruturado.perguntas,
        conversa.productTitle,
      ).catch(() => {});
    }
  } catch (err) {
    console.warn("[resumo] não gravado:", (err as Error).message);
  }
}
