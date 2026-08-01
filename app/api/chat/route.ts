import { NextResponse } from "next/server";
import { streamClaudeResponse, type ChatMessage } from "@/lib/claude";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { getAdapter, isPlatformId } from "@/lib/platforms";
import { isHandoffMode } from "@/lib/mode";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { pickAgent } from "@/lib/agents";
import {
  countRefundDemands,
  detectHardException,
  isChargebackRisk,
  chargebackRiskScore,
} from "@/lib/retention";
import { loadKnowledge } from "@/lib/knowledge";
import {
  sendtraceEnabled,
  buscarPedidosPorEmail,
  buscarPedidosPorTransacao,
  buscarAtendimentos,
  listarReadmesProdutos,
  formatarPedidosParaPrompt,
  formatarAtendimentosParaPrompt,
  formatarReadmesParaPrompt,
} from "@/lib/sendtrace";
import {
  ensureConversation,
  appendNewUserMessages,
  appendAssistantMessage,
  detectAndStoreInitialMood,
} from "@/lib/logging";
import { salvarResumoConversa } from "@/lib/resumo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Mensagens por IP por hora. 20 segura abuso sem atrapalhar um cliente real
 * (uma conversa inteira raramente passa disso) — mas em teste/tuning estoura
 * rápido, então é configurável. O contador é em memória: reiniciar o app
 * zera tudo.
 */
const MAX_PER_HOUR = Number(process.env.CHAT_MAX_PER_HOUR) || 20;

/**
 * O contexto do SendTrace (pedido, nome do cliente, histórico) é buscado UMA
 * vez, na primeira mensagem da conversa, e reusado nas seguintes — as
 * informações do pedido não mudam no meio de um chat, e consultar o banco a
 * cada mensagem era desperdício. Em memória: reiniciar o app só faz a
 * próxima mensagem buscar de novo.
 */
interface ContextoConversa {
  pedidosRegua: string | null;
  transacaoId: string | null;
  nome: string | null;
  produto: string | null;
  email: string | null;
  em: number;
}
const contextoPorConversa = new Map<string, ContextoConversa>();
const CONTEXTO_TTL_MS = 30 * 60 * 1000;

/** Checkpoint do resumo: no máximo um a cada N minutos por conversa (0 = a cada resposta). */
const parcialMin = Number(process.env.RESUMO_PARCIAL_MIN);
const RESUMO_PARCIAL_MS =
  (Number.isFinite(parcialMin) && parcialMin >= 0 ? parcialMin : 5) * 60 * 1000;
const ultimoParcial = new Map<string, number>();

function limparMapas() {
  const agora = Date.now();
  for (const [id, c] of contextoPorConversa) {
    if (agora - c.em > CONTEXTO_TTL_MS) contextoPorConversa.delete(id);
  }
  for (const [id, em] of ultimoParcial) {
    if (agora - em > CONTEXTO_TTL_MS) ultimoParcial.delete(id);
  }
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = rateLimit(`chat:${ip}`, MAX_PER_HOUR, HOUR_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many messages. Please try again later." },
      { status: 429 },
    );
  }

  let payload: {
    conversationId?: string;
    platform?: string;
    /** Order id when one was resolved, the customer's email otherwise. */
    caseKey?: string;
    orderId?: string;
    email?: string;
    refundAmount?: number;
    currency?: string;
    messages?: ChatMessage[];
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const conversationId = String(payload.conversationId ?? "").trim();
  const orderId = String(payload.orderId ?? "").trim() || null;
  const typedEmail = String(payload.email ?? "").trim();
  const caseKey = String(payload.caseKey ?? "").trim() || orderId || typedEmail;
  const platformParam = String(payload.platform ?? "").trim().toLowerCase();
  const refundAmount = Number(payload.refundAmount ?? 0);
  const currency = String(payload.currency ?? "USD");
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  if (!caseKey || caseKey.length < 4) {
    return NextResponse.json(
      { error: "Please start over from the beginning." },
      { status: 400 },
    );
  }
  if (typedEmail && !isValidEmail(typedEmail)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  // In handoff mode no store is wired up, so there is no platform to validate.
  const platform: string | null = isPlatformId(platformParam)
    ? platformParam
    : null;
  if (!platform && !isHandoffMode()) {
    return NextResponse.json(
      { error: "Unknown platform. Please start over." },
      { status: 400 },
    );
  }
  if (conversationId.length < 8) {
    return NextResponse.json(
      { error: "conversationId is required." },
      { status: 400 },
    );
  }
  if (!messages.length) {
    return NextResponse.json(
      { error: "At least one message is required." },
      { status: 400 },
    );
  }

  const cleanMessages: ChatMessage[] = messages
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
    .map((m) => ({ role: m.role, content: m.content }));

  // Re-fetch the order server-side: never trust customer/product data that
  // came back through the browser. Skipped in handoff mode — there is nothing
  // to fetch from, and loadKnowledge falls back to every product file.
  let vendor: string | null = null;
  let productTitle: string | null = null;
  let customerName: string | null = null;
  // The address the customer typed wins over the one on the purchase: it is
  // where they expect the handover email, and it is the one they can read.
  let customerEmail: string | null = typedEmail
    ? normalizeEmail(typedEmail)
    : null;
  if (platform && orderId) {
    try {
      const order = await getAdapter(platform)?.getOrder(orderId);
      if (order) {
        vendor = order.vendor;
        productTitle = order.productTitle;
        customerName = order.firstName;
        customerEmail = customerEmail ?? order.email;
      }
    } catch (err) {
      console.error("[chat] order lookup failed", err);
    }
  }

  const refundDemands = countRefundDemands(cleanMessages);
  const hardException = detectHardException(cleanMessages);
  const chargebackRisk = isChargebackRisk(cleanMessages);

  // The gate is enforced by these numbers, so make them visible when tuning
  // the policy — otherwise an early escalation is impossible to debug.
  console.log(
    `[chat] ${conversationId.slice(-8)} demands=${refundDemands} hardException=${hardException} ` +
      `chargebackRisk=${chargebackRisk} (score=${chargebackRiskScore(cleanMessages)}) vendor=${vendor ?? "(none)"}`,
  );

  const knowledge = await loadKnowledge(vendor, platform);

  // O banco do SendTrace entra em duas frentes: os PEDIDOS deste cliente (com
  // o resumo do último atendimento) viram contexto da conversa, e os READMES
  // de produto escritos no dashboard viram conhecimento — a mesma seção que os
  // .md locais ocupam. Tudo fail-soft: sem API, o chat segue só com o local.
  let pedidosRegua: string | null = null;
  let conhecimentoDb: string | null = null;
  if (sendtraceEnabled()) {
    limparMapas();

    // Os readmes têm cache próprio de 60 s dentro de listarReadmesProdutos —
    // custam no máximo uma chamada por minuto, para o app inteiro.
    conhecimentoDb = formatarReadmesParaPrompt(await listarReadmesProdutos());

    const cacheado = contextoPorConversa.get(conversationId);
    if (cacheado && Date.now() - cacheado.em < CONTEXTO_TTL_MS) {
      // Mensagens seguintes da mesma conversa: zero consultas de pedido —
      // o contexto foi buscado na primeira mensagem.
      pedidosRegua = cacheado.pedidosRegua;
      if (!customerName) customerName = cacheado.nome;
      if (!productTitle) productTitle = cacheado.produto;
      if (!customerEmail) customerEmail = cacheado.email;
      console.log(
        `[chat] sendtrace: contexto em cache (transacao=${cacheado.transacaoId ?? "(nenhuma)"})`,
      );
    } else {
      // PRIMEIRA mensagem da conversa: uma busca do pedido (pela transação,
      // a chave preferida — ou pelo e-mail) e uma do histórico. Só.
      const transacaoRef =
        orderId ?? (caseKey && !caseKey.includes("@") ? caseKey : null);

      const pedidos = transacaoRef
        ? await buscarPedidosPorTransacao(transacaoRef)
        : customerEmail
          ? await buscarPedidosPorEmail(customerEmail)
          : [];
      const transacaoId = pedidos[0]?.transacao_id ?? transacaoRef;

      const atendimentos =
        transacaoId || customerEmail
          ? await buscarAtendimentos({ transacaoId, email: customerEmail })
          : [];

      // O banco sabe quem é o cliente e o que ele comprou — quando o lookup
      // local não trouxe, o agente recebe o nome e o produto daqui.
      if (!customerName && pedidos[0]?.nome) customerName = pedidos[0].nome;
      if (!productTitle && pedidos[0]?.produto) productTitle = pedidos[0].produto;
      if (!customerEmail && pedidos[0]?.email) customerEmail = pedidos[0].email;

      pedidosRegua = [
        formatarPedidosParaPrompt(pedidos),
        formatarAtendimentosParaPrompt(atendimentos, pedidos),
      ]
        .filter(Boolean)
        .join("\n") || null;

      contextoPorConversa.set(conversationId, {
        pedidosRegua,
        transacaoId: transacaoId ?? null,
        nome: customerName,
        produto: productTitle,
        email: customerEmail,
        em: Date.now(),
      });
      console.log(
        `[chat] sendtrace: contexto buscado (transacao=${transacaoId ?? "(nenhuma)"} ` +
          `pedidos=${pedidos.length} atendimentos=${atendimentos.length})`,
      );
    }
  }

  const conhecimentoCompleto = [
    knowledge.combined,
    conhecimentoDb
      ? "# Product knowledge — written by the team in the dashboard (authoritative, kept up to date)\n\n" +
        conhecimentoDb
      : null,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  await ensureConversation({
    conversationId,
    platform,
    // Conversation.orderId is the case key — see the column's comment in
    // prisma/schema.prisma.
    orderId: caseKey,
    vendor,
    productTitle,
    customerName,
    customerEmail,
    refundAmount,
    currency,
    ip,
  });

  await appendNewUserMessages(conversationId, cleanMessages);

  const firstUser = cleanMessages.find((m) => m.role === "user");
  if (firstUser) {
    await detectAndStoreInitialMood(conversationId, firstUser.content);
  }

  try {
    const upstream = await streamClaudeResponse({
      knowledge: conhecimentoCompleto,
      context: {
        // Re-derived from the conversation id rather than taken from the
        // request: the browser cannot rename the agent mid-conversation.
        agentName: pickAgent(conversationId).name,
        caseRef: caseKey,
        orderId,
        customerEmail,
        platform,
        refundAmount,
        currency,
        customerName,
        productTitle,
        vendor,
        refundDemands,
        hardException,
        pedidosRegua,
        chargebackRisk,
      },
      messages: cleanMessages,
    });

    const decoder = new TextDecoder();
    let assistantAccum = "";

    const teed = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              assistantAccum += decoder.decode(value, { stream: true });
              controller.enqueue(value);
            }
          }
        } catch (err) {
          controller.error(err);
          return;
        }
        controller.close();

        if (assistantAccum.trim()) {
          appendAssistantMessage(conversationId, assistantAccum)
            .catch((e) =>
              console.error("[chat] appendAssistantMessage failed", e),
            )
            .finally(() => {
              // Checkpoint do resumo: no máximo um a cada RESUMO_PARCIAL_MIN
              // minutos por conversa, depois que a resposta já foi entregue —
              // o cliente nunca espera por isto. O definitivo (com desfecho)
              // sai no encerramento, em resolve/escalate.
              if (!sendtraceEnabled()) return;
              const agora = Date.now();
              if (agora - (ultimoParcial.get(conversationId) ?? 0) < RESUMO_PARCIAL_MS) return;
              ultimoParcial.set(conversationId, agora);
              salvarResumoConversa(caseKey, "em andamento", { parcial: true }).catch((e) =>
                console.warn("[chat] resumo parcial não gravado", e),
              );
            });
        }
      },
    });

    return new Response(teed, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-RateLimit-Remaining": String(rl.remaining),
      },
    });
  } catch (err) {
    console.error("[chat] streamClaudeResponse failed", err);

    const rawMessage = err instanceof Error ? err.message : String(err);
    const isDev = process.env.NODE_ENV !== "production";

    let userMessage = "The assistant is unavailable right now. Please try again.";
    let status = 502;

    if (rawMessage.includes("ANTHROPIC_API_KEY is not configured")) {
      userMessage =
        "The AI is not configured (missing ANTHROPIC_API_KEY). Please set it in .env.local and restart the server.";
      status = 500;
    } else if (
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status?: unknown }).status === "number"
    ) {
      const s = (err as { status: number }).status;
      if (s === 401)
        userMessage =
          "Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY.";
      else if (s === 404)
        userMessage =
          "Anthropic returned 404 — the model name may be wrong or not available to this key.";
      else if (s === 429)
        userMessage = "Anthropic rate-limited us. Please wait a moment.";
      else if (s >= 500)
        userMessage = "Anthropic had a server error. Please try again.";
    }

    return NextResponse.json(
      {
        error: userMessage,
        ...(isDev ? { detail: rawMessage.slice(0, 500) } : {}),
      },
      { status },
    );
  }
}
