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
  metodo: "GET" | "PUT",
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

/**
 * Grava o resumo do atendimento no pedido do cliente (todos os pedidos
 * daquele e-mail). É o que o painel — e a próxima conversa deste bot —
 * vai ler como histórico.
 */
export async function gravarResumoChat(
  email: string,
  resumo: string,
): Promise<boolean> {
  const r = await chamar<{ atualizados?: number }>(
    "PUT",
    "/api/disparos/chat/",
    { email, resumo: resumo.slice(0, 9_000) },
  );
  if (r?.atualizados) {
    console.log(`[sendtrace] resumo gravado em ${r.atualizados} pedido(s) de ${email}`);
    return true;
  }
  return false;
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

  // O resumo de um atendimento anterior é o que faz a conversa melhorar a
  // cada contato: o agente retoma de onde o último parou em vez de fazer o
  // cliente repetir tudo.
  const comResumo = pedidos.find((p) => p.chat_resumo);
  if (comResumo?.chat_resumo) {
    linhas.push(
      `- Previous support contact (${String(comResumo.chat_resumo_em ?? "").slice(0, 10)}): ${comResumo.chat_resumo.slice(0, 800)}`,
    );
  }

  return linhas.join("\n");
}

/** Os readmes viram uma seção de conhecimento, no mesmo formato dos .md. */
export function formatarReadmesParaPrompt(readmes: ProdutoReadme[]): string | null {
  if (!readmes.length) return null;
  return readmes
    .map((r) => `## Product: ${r.produto}\n\n${r.readme.trim()}`)
    .join("\n\n---\n\n");
}
