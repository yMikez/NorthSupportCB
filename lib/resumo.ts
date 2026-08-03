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
  listarMotivosExistentes,
} from "./sendtrace";
import { isValidEmail } from "./email";
import { isChargebackRisk } from "./retention";

const MAX_MENSAGENS = 30;
const MAX_POR_MENSAGEM = 400;

/**
 * Os motivos CANÔNICOS — a semente do vocabulário, não o teto dele.
 *
 * O vocabulário é ABERTO: quando o assunto não é nenhum destes, a IA cria um
 * nome novo (curto, em slug) em vez de despejar tudo em "outro". Para
 * assuntos similares não virarem dez grafias do mesmo motivo, o classificador
 * recebe a lista dos motivos JÁ EXISTENTES no banco e reutiliza o nome quando
 * o assunto é o mesmo ou muito próximo — só o realmente diferente ganha linha
 * própria no dashboard.
 */
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

/**
 * Normaliza o que a IA devolver para slug: minúsculas, sem acento, underscore.
 * "Brinde não recebido" e "brinde_nao_recebido" precisam ser a MESMA linha.
 */
function slugMotivo(bruto: string | null | undefined): string | null {
  const slug = String(bruto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || null;
}

/** Mesma regra do staleCloser: o cliente falou em reembolso nesta conversa? */
const REFUND_KEYWORDS =
  /\b(refund|reembolso|estorno|chargeback|money back|devolu[cç][aã]o|dinheiro de volta|reembols)\b/i;

/**
 * Pedido de CANCELAMENTO conta como pedido de saída, igual ao de reembolso:
 * para o refund save rate, "cancela minha assinatura" e "quero meu dinheiro"
 * são o mesmo evento — o cliente indo embora — e reverter os dois é save.
 */
const CANCEL_KEYWORDS = /\b(cancel\w*|cancelar\w*|cancelamento)\b/i;

/**
 * Classificador DETERMINÍSTICO de motivo — a rede de segurança do Claude.
 *
 * A regra do produto é: o motivo nasce da PRIMEIRA mensagem do cliente (é o
 * que o trouxe aqui), ajustado pelo rumo do resto da conversa. Este
 * classificador aplica exatamente isso com palavras-chave (PT/EN/ES): decide
 * pela primeira mensagem quando ela bate em algum padrão; senão, olha as
 * demais. É o que vale em MOCK_AI, quando o Claude está fora, ou quando o
 * JSON dele vem sem motivo — uma conversa sem classificação some do ranking.
 *
 * A ORDEM importa: "cobraram duas vezes" tem 'cobra' e 'duas vezes' — o
 * duplicado precisa vir antes da cobrança, senão nunca seria detectado.
 */
const MOTIVO_PADROES: Array<[(typeof MOTIVOS)[number], RegExp]> = [
  ["pedido_duplicado", /\b(duplicad|duplicate|charged\s+twice|cobrad[oa]\s+(duas|2)\s+vezes|two\s+(orders|charges)|dois\s+pedidos|twice)\b/i],
  ["rastreamento", /\b(track|rastre|where\s+is\s+my\s+(order|package|parcel)|onde\s+est[áa]|n[ãa]o\s+(chegou|recebi)|(not|hasn'?t)\s+arrived|delivery|entrega|shipping\s+status|correio|cad[êe]\s+meu)\b/i],
  ["endereco", /\b(address|endere[çc]o)\b/i],
  ["reembolso", REFUND_KEYWORDS],
  ["cancelamento", /\b(cancel|cancelar|cancelamento)\b/i],
  ["cobranca", /\b(cobran[çc]a|cobrad[oa]|charge[ds]?|billing|payment|pagamento|cart[ãa]o|card\s+was|invoice|fatura)\b/i],
  ["uso_do_produto", /\b(how\s+(do\s+i|to)\s+(use|take)|como\s+(usar|tomar|devo)|dosage|dose|dosagem|quantas\s+(gotas|c[áa]psulas)|instru[çc][õo]es|instructions|serve\s+para)\b/i],
];

function classificarMotivoHeuristico(
  doCliente: { content: string }[],
): (typeof MOTIVOS)[number] | null {
  if (!doCliente.length) return null;
  const primeira = doCliente[0].content;
  for (const [motivo, padrao] of MOTIVO_PADROES) {
    if (padrao.test(primeira)) return motivo;
  }
  const resto = doCliente.slice(1).map((m) => m.content).join("\n");
  for (const [motivo, padrao] of MOTIVO_PADROES) {
    if (padrao.test(resto)) return motivo;
  }
  return null;
}

interface ResumoEstruturado {
  resumo: string;
  motivo: string | null;
  perguntas: string[];
}

/**
 * Uma chamada só faz as três coisas: resume, classifica o motivo e lista as
 * perguntas que ficaram sem resposta. JSON estrito para o parse não depender
 * de boa vontade; se vier torto, o texto inteiro ainda serve de resumo.
 *
 * `motivosExistentes` é o vocabulário vivo do banco: assunto igual ou muito
 * próximo de um deles REUTILIZA aquele nome exato (mescla na mesma linha do
 * dashboard); só assunto realmente diferente ganha nome novo.
 */
async function resumirComClaude(
  transcricao: string,
  motivosExistentes: string[],
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
        "motivo: decida pela PRIMEIRA mensagem do cliente (é o que o trouxe ao " +
        "chat), ajustando pelo rumo do resto da conversa; se ele começou " +
        "perguntando do rastreio e só pediu reembolso depois que soube do " +
        "atraso, o motivo é rastreamento, não reembolso. Se o assunto for o " +
        "MESMO ou muito próximo de um destes motivos já registrados, use " +
        `EXATAMENTE aquele nome: ${motivosExistentes.join(", ")}. Só quando o ` +
        "assunto for realmente diferente de todos, crie um nome NOVO que o " +
        "descreva: curto (2 a 4 palavras), em português, minúsculas com " +
        'underscore (ex.: "brinde_nao_recebido", "desconto_nao_aplicado"). ' +
        'Evite "outro" — ele esconde o assunto. ' +
        "perguntas_sem_resposta: as perguntas do cliente que o agente NÃO " +
        "conseguiu responder de fato (na língua original, curtas); lista " +
        "vazia se não houver.",
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
      return {
        resumo: String(dados.resumo ?? "").trim() || texto,
        motivo: slugMotivo(dados.motivo),
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

    const doCliente = mensagens.filter((m) => m.role === "user");
    const houveIntencaoReembolso = doCliente.some((m) =>
      REFUND_KEYWORDS.test(m.content),
    );
    // Reembolso E cancelamento são o mesmo evento para o save rate: o
    // cliente indo embora. Reverter qualquer um dos dois é save.
    const houveIntencaoSaida = houveIntencaoReembolso
      || doCliente.some((m) => CANCEL_KEYWORDS.test(m.content));

    // A primeira mensagem do cliente vai DESTACADA no topo: é a âncora da
    // classificação de motivo — sem o destaque, o modelo pesa igualmente o
    // fim da conversa, onde quase tudo desagua em "reembolso".
    const transcricao = [
      doCliente[0]
        ? `PRIMEIRA MENSAGEM DO CLIENTE (âncora do motivo): ${doCliente[0].content.slice(0, MAX_POR_MENSAGEM)}\n`
        : null,
      ...mensagens.map(
        (m) =>
          `${m.role === "user" ? "Cliente" : "Agente"}: ${m.content.slice(0, MAX_POR_MENSAGEM)}`,
      ),
    ]
      .filter(Boolean)
      .join("\n");

    // O classificador de reserva: primeira mensagem primeiro, resto depois.
    // É o motivo em MOCK_AI, quando o Claude cai, ou quando o JSON dele vem
    // sem a classificação — conversa sem motivo some do ranking da dash.
    const motivoHeuristico = classificarMotivoHeuristico(doCliente)
      ?? (houveIntencaoReembolso ? "reembolso" : "outro");

    // O vocabulário vivo: os motivos já registrados (por volume) mais os
    // canônicos que ainda não apareceram. É contra esta lista que a IA decide
    // "mesmo assunto → mesmo nome" ou "assunto novo → nome novo".
    const vocabulario = [
      ...new Set([
        ...(await listarMotivosExistentes().catch(() => [])),
        ...MOTIVOS.filter((m) => m !== "outro"),
      ]),
    ];

    const estruturado: ResumoEstruturado = isMockAI()
      ? {
          resumo: `Conversa com ${mensagens.length} mensagens${conversa.productTitle ? ` sobre ${conversa.productTitle}` : ""}.`,
          motivo: motivoHeuristico,
          perguntas: [],
        }
      : ((await resumirComClaude(transcricao, vocabulario)) ?? {
          resumo: `Conversa com ${mensagens.length} mensagens${conversa.productTitle ? ` sobre ${conversa.productTitle}` : ""}.`,
          motivo: motivoHeuristico,
          perguntas: [],
        });
    if (!estruturado.motivo) estruturado.motivo = motivoHeuristico;

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
    // "Pediu para sair" = falou em reembolso OU cancelamento, o desfecho foi
    // de reembolso, ou o motivo classificado é um dos dois. Tudo isso conta
    // no denominador do refund save rate.
    const reembolsoPedido =
      houveIntencaoSaida ||
      outcome === "refund_issued" ||
      outcome === "refund_abandoned" ||
      estruturado.motivo === "reembolso" ||
      estruturado.motivo === "cancelamento";
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
        // Quando a conversa COMEÇOU — o filtro de tempo da dash recorta por
        // isto, não pela hora em que o registro foi gravado.
        iniciadoEm: conversa.startedAt,
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
