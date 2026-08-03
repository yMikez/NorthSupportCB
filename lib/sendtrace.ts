/**
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  A ponte com o SendTrace — o banco de verdade da operação.            │
 * │                                                                      │
 * │  A API do SendTrace (o painel da régua de pós-venda) sabe o que este  │
 * │  app não sabe: os pedidos reais de cada cliente, em que etapa da      │
 * │  régua cada um está, o resumo do último atendimento e o README que    │
 * │  o time escreveu sobre cada produto no dashboard.                     │
 * │                                                                      │
 * │  Tudo aqui é FAIL-SOFT de propósito: se a API cair, o suporte segue   │
 * │  funcionando só com o conhecimento local — um cliente no chat nunca   │
 * │  pode ficar sem resposta porque um sistema interno piscou.            │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Autenticação, em ordem de preferência:
 *
 *   1. SENDTRACE_API_TOKEN — o TOKEN DE SERVIÇO fixo da API (o
 *      API_TOKEN_SERVICO do .env do SendTrace). Sem login, sem expiração,
 *      nunca admin. É o modo certo para o bot.
 *   2. SENDTRACE_EMAIL/SENHA — fallback: o bot loga como um usuário e
 *      renova o access a cada 45 min (ele vale ~60).
 */

const BASE = (process.env.SENDTRACE_API_URL || "").replace(/\/+$/, "");
const API_TOKEN = process.env.SENDTRACE_API_TOKEN || "";
const EMAIL = process.env.SENDTRACE_EMAIL || "";
const SENHA = process.env.SENDTRACE_SENHA || "";

const TIMEOUT_MS = 8_000;
const TOKEN_VALIDO_MS = 45 * 60 * 1000;

export function sendtraceEnabled(): boolean {
  return Boolean(BASE && (API_TOKEN || (EMAIL && SENHA)));
}

/** Um pedido na régua de pós-venda, como a API devolve. */
export interface PedidoRegua {
  id: number;
  transacao_id: string;
  nome: string | null;
  email: string | null;
  produto: string | null;
  etapa_atual: number;
  status: string;
  proximo_disparo: string;
  criado_em: string;
  chat_resumo: string | null;
  chat_resumo_em: string | null;
}

export interface ProdutoReadme {
  produto: string;
  readme: string;
}

/** Um atendimento encerrado, como está no histórico da API. */
export interface Atendimento {
  id: number;
  email: string;
  resumo: string;
  desfecho: string | null;
  risco_chargeback: boolean;
  criado_em: string;
}

/* ────────────────────────────  autenticação  ─────────────────────────── */

let tokenCache: { access: string; obtidoEm: number } | null = null;

async function obterToken(forcarNovo = false): Promise<string | null> {
  // Com o token de serviço não há login nem renovação — é ele, sempre.
  if (API_TOKEN) return API_TOKEN;

  if (
    !forcarNovo &&
    tokenCache &&
    Date.now() - tokenCache.obtidoEm < TOKEN_VALIDO_MS
  ) {
    return tokenCache.access;
  }

  try {
    const resp = await fetch(`${BASE}/api/auth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: SENHA }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(`[sendtrace] login falhou (${resp.status}) — seguindo sem os dados do banco`);
      return null;
    }
    const dados = (await resp.json()) as { access?: string };
    if (!dados.access) return null;
    tokenCache = { access: dados.access, obtidoEm: Date.now() };
    return dados.access;
  } catch (err) {
    console.warn("[sendtrace] login indisponível:", (err as Error).message);
    return null;
  }
}

async function chamar<T>(
  metodo: "GET" | "POST" | "PUT",
  rota: string,
  corpo?: unknown,
): Promise<T | null> {
  if (!sendtraceEnabled()) return null;
  let token = await obterToken();
  if (!token) return null;

  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    try {
      const resp = await fetch(`${BASE}${rota}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // Token vencido no meio do caminho: renova uma vez e repete.
      if (resp.status === 401 && tentativa === 0) {
        token = await obterToken(true);
        if (!token) return null;
        continue;
      }
      if (!resp.ok) {
        console.warn(`[sendtrace] ${metodo} ${rota} → ${resp.status}`);
        return null;
      }
      return (await resp.json()) as T;
    } catch (err) {
      console.warn(`[sendtrace] ${metodo} ${rota} falhou:`, (err as Error).message);
      return null;
    }
  }
  return null;
}

/* ─────────────────────────────  consultas  ───────────────────────────── */

/**
 * Os pedidos do cliente na régua, pelo e-mail.
 *
 * A busca da API é substring (ILIKE), então filtramos aqui pelo e-mail
 * EXATO — "ana@x.com" não pode trazer os pedidos de "mariana@x.com".
 */
export async function buscarPedidosPorEmail(
  email: string,
): Promise<PedidoRegua[]> {
  const alvo = email.trim().toLowerCase();
  if (!alvo) return [];
  const r = await chamar<{ results?: PedidoRegua[] }>(
    "GET",
    `/api/disparos/?search=${encodeURIComponent(alvo)}&page_size=20`,
  );
  return (r?.results ?? []).filter(
    (p) => (p.email ?? "").trim().toLowerCase() === alvo,
  );
}

/**
 * O pedido pelo ID DE TRANSAÇÃO — a chave preferida: identifica UM pedido,
 * e traz junto o nome do cliente e o produto para o contexto do agente.
 */
export async function buscarPedidosPorTransacao(
  transacaoId: string,
): Promise<PedidoRegua[]> {
  const alvo = transacaoId.trim();
  if (!alvo) return [];
  const r = await chamar<{ results?: PedidoRegua[] }>(
    "GET",
    `/api/disparos/?transacao_id=${encodeURIComponent(alvo)}&page_size=5`,
  );
  return r?.results ?? [];
}

/**
 * Os readmes de produto escritos no dashboard do painel — o conhecimento
 * vivo da IA. Cache curto: o time salva lá e quer ver o efeito na próxima
 * conversa, não amanhã.
 */
let readmesCache: { dados: ProdutoReadme[]; em: number } | null = null;
const READMES_CACHE_MS = 60 * 1000;

export async function listarReadmesProdutos(): Promise<ProdutoReadme[]> {
  if (readmesCache && Date.now() - readmesCache.em < READMES_CACHE_MS) {
    return readmesCache.dados;
  }
  const r = await chamar<{ results?: ProdutoReadme[] }>(
    "GET",
    "/api/produto-readmes/?ativo=true&page_size=200",
  );
  const dados = r?.results ?? [];
  if (r) readmesCache = { dados, em: Date.now() };
  return dados;
}

/** A chave de um atendimento: a transação do pedido e/ou o e-mail do cliente. */
export interface ChaveAtendimento {
  transacaoId?: string | null;
  email?: string | null;
}

/**
 * Os últimos atendimentos deste pedido/cliente — a memória do suporte, do
 * mais novo ao mais antigo. Mandando transação E e-mail, a API casa
 * qualquer um dos dois — costura o histórico antigo (por e-mail) com o
 * novo (por transação).
 */
export async function buscarAtendimentos(
  chave: ChaveAtendimento,
  max = 3,
): Promise<Atendimento[]> {
  const params = new URLSearchParams({ page_size: String(max) });
  if (chave.transacaoId?.trim()) params.set("transacao_id", chave.transacaoId.trim());
  if (chave.email?.trim()) params.set("email", chave.email.trim().toLowerCase());
  if (!params.has("transacao_id") && !params.has("email")) return [];

  const r = await chamar<{ results?: Atendimento[] }>(
    "GET",
    `/api/atendimentos/?${params.toString()}`,
  );
  return r?.results ?? [];
}

/**
 * Grava o resumo de uma conversa encerrada no HISTÓRICO da API, chaveado
 * pelo ID DE TRANSAÇÃO — a API resolve o que faltar (transação a partir do
 * e-mail, ou o contrário) consultando a fila, e devolve o nome do cliente
 * e o produto do pedido. Na mesma tacada, o texto vira o "último
 * atendimento" (chat_resumo) daquele pedido.
 *
 * Se a API for de uma versão sem o histórico, cai na rota antiga por
 * e-mail (só o espelho) para nunca perder o registro.
 */
export async function gravarResumoChat(
  chave: ChaveAtendimento,
  resumo: string,
  extras: {
    desfecho?: string;
    riscoChargeback?: boolean;
    /** O que o dashboard do suporte conta — ver os campos em Atendimento na API. */
    motivo?: string | null;
    resolvido?: boolean | null;
    reembolsoPedido?: boolean;
    reembolsoEvitado?: boolean | null;
    duracaoS?: number | null;
  } = {},
): Promise<boolean> {
  const corpo = {
    transacao_id: chave.transacaoId?.trim() || null,
    email: chave.email?.trim() || null,
    resumo: resumo.slice(0, 9_000),
    desfecho: extras.desfecho ?? null,
    risco_chargeback: extras.riscoChargeback === true,
    motivo: extras.motivo ?? null,
    resolvido: typeof extras.resolvido === "boolean" ? extras.resolvido : null,
    reembolso_pedido: extras.reembolsoPedido === true,
    reembolso_evitado:
      typeof extras.reembolsoEvitado === "boolean" ? extras.reembolsoEvitado : null,
    duracao_s: Number.isFinite(extras.duracaoS)
      ? Math.max(0, Math.round(extras.duracaoS as number))
      : null,
  };
  if (!corpo.transacao_id && !corpo.email) return false;

  const novo = await chamar<{ id?: number; transacao_id?: string | null; cliente?: string | null }>(
    "POST",
    "/api/atendimentos/",
    corpo,
  );
  if (novo?.id) {
    console.log(
      `[sendtrace] atendimento #${novo.id} registrado — pedido ${novo.transacao_id ?? "(sem transação)"}` +
        `${novo.cliente ? ` de ${novo.cliente}` : ""}`,
    );
    return true;
  }

  if (corpo.email) {
    const antigo = await chamar<{ atualizados?: number }>(
      "PUT",
      "/api/disparos/chat/",
      { email: corpo.email, resumo: corpo.resumo },
    );
    if (antigo?.atualizados) {
      console.log(`[sendtrace] resumo gravado (rota antiga) em ${antigo.atualizados} pedido(s) de ${corpo.email}`);
      return true;
    }
  }
  return false;
}

/**
 * As perguntas que a IA NÃO soube responder nesta conversa — vão para o
 * backlog da base de conhecimento no SendTrace, uma linha por ocorrência.
 * Fail-soft como tudo aqui: perder o registro é uma pena, nunca um erro.
 */
export async function gravarPerguntasSemResposta(
  chave: ChaveAtendimento,
  perguntas: string[],
  produto?: string | null,
): Promise<boolean> {
  const lote = perguntas
    .map((p) => String(p ?? "").trim().slice(0, 500))
    .filter(Boolean)
    .slice(0, 20);
  if (!lote.length) return false;

  const r = await chamar<{ gravadas?: number }>("POST", "/api/perguntas-sem-resposta/", {
    perguntas: lote,
    transacao_id: chave.transacaoId?.trim() || undefined,
    email: chave.email?.trim() || undefined,
    produto: produto?.trim() || undefined,
  });
  if (r?.gravadas) {
    console.log(`[sendtrace] ${r.gravadas} pergunta(s) sem resposta registradas`);
    return true;
  }
  return false;
}

/**
 * A nota de satisfação (1–5 estrelas) que o cliente dá DEPOIS do
 * encerramento. A API grava no atendimento mais recente (24h) do pedido —
 * o bot não precisa guardar id nenhum.
 */
export async function gravarCsat(
  chave: ChaveAtendimento,
  nota: number,
): Promise<boolean> {
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return false;
  const corpo: Record<string, unknown> = { csat: nota };
  if (chave.transacaoId?.trim()) corpo.transacao_id = chave.transacaoId.trim();
  if (chave.email?.trim()) corpo.email = chave.email.trim().toLowerCase();
  if (!corpo.transacao_id && !corpo.email) return false;

  const r = await chamar<{ id?: number }>("POST", "/api/atendimentos/csat/", corpo);
  return Boolean(r?.id);
}

/**
 * Resumo PARCIAL — o checkpoint durante a conversa.
 *
 * Vai só para o "último atendimento" do pedido (chat_resumo), sobrescrevendo
 * o checkpoint anterior — NÃO cria registro no histórico. O registro
 * definitivo, com desfecho, é o gravarResumoChat no encerramento.
 */
export async function gravarResumoParcial(
  chave: ChaveAtendimento,
  resumo: string,
): Promise<boolean> {
  const corpo: Record<string, unknown> = { resumo: resumo.slice(0, 9_000) };
  if (chave.transacaoId?.trim()) corpo.transacao_id = chave.transacaoId.trim();
  else if (chave.email?.trim()) corpo.email = chave.email.trim().toLowerCase();
  else return false;

  const r = await chamar<{ atualizados?: number }>("PUT", "/api/disparos/chat/", corpo);
  return Boolean(r?.atualizados);
}

/* ─────────────────────  formatação para o prompt  ────────────────────── */

/** O bloco de contexto que o agente recebe sobre os pedidos do cliente. */
export function formatarPedidosParaPrompt(pedidos: PedidoRegua[]): string | null {
  if (!pedidos.length) return null;

  const linhas = pedidos.slice(0, 5).map((p) => {
    const partes = [
      `- Order ${p.transacao_id}${p.produto ? ` · ${p.produto}` : ""}`,
      `status: ${p.status}, follow-up stage ${p.etapa_atual}`,
      `purchased ${String(p.criado_em).slice(0, 10)}`,
    ];
    return partes.join(" · ");
  });

  return linhas.join("\n");
}

/**
 * Os atendimentos anteriores viram linhas de contexto — é o que faz a
 * conversa melhorar a cada contato: o agente retoma de onde o último
 * parou em vez de fazer o cliente repetir tudo.
 *
 * Sem histórico (registros de antes dele existir), cai no chat_resumo do
 * pedido — o "último atendimento" espelhado.
 */
export function formatarAtendimentosParaPrompt(
  atendimentos: Atendimento[],
  pedidos: PedidoRegua[],
): string | null {
  if (atendimentos.length) {
    return atendimentos
      .slice(0, 3)
      .map((a) => {
        const marca = [
          String(a.criado_em).slice(0, 10),
          a.desfecho,
          a.risco_chargeback ? "chargeback risk was flagged" : null,
        ].filter(Boolean).join(" · ");
        return `- Previous support contact (${marca}): ${a.resumo.slice(0, 600)}`;
      })
      .join("\n");
  }

  const comResumo = pedidos.find((p) => p.chat_resumo);
  if (comResumo?.chat_resumo) {
    return `- Previous support contact (${String(comResumo.chat_resumo_em ?? "").slice(0, 10)}): ${comResumo.chat_resumo.slice(0, 800)}`;
  }
  return null;
}

/** Os readmes viram uma seção de conhecimento, no mesmo formato dos .md. */
export function formatarReadmesParaPrompt(readmes: ProdutoReadme[]): string | null {
  if (!readmes.length) return null;
  return readmes
    .map((r) => `## Product: ${r.produto}\n\n${r.readme.trim()}`)
    .join("\n\n---\n\n");
}
