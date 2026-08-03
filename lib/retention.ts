import type { ChatMessage } from "./claude";

/**
 * Counts explicit refund demands server-side.
 *
 * Asking the model to keep its own tally does not work reliably — small models
 * approximate, and in testing the agent escalated on the 4th demand when told
 * to wait for the 6th. Counting here makes the gate deterministic: the model
 * only has to compare a number it is given, not compute one.
 */

/** An unambiguous "give me my money back", in PT / EN / ES. */
const DEMAND_PATTERNS: RegExp[] = [
  // Portuguese
  /\b(quero|queria|exijo|desejo)\s+(o\s+)?(meu\s+)?(dinheiro|reembolso|estorno)\b/i,
  /\bdinheiro\s+de\s+volta\b/i,
  // process/processa/processar/processe, faz/faça/fazer, libera, manda, realiza…
  /\b(process\w*|faz\w*|fa[çc]a|realiz\w*|efetu\w*|liber\w*|mand[ae]\w*)\s+(o\s+)?(meu\s+)?(reembolso|estorno)\b/i,
  /\b(quero|queria)\s+cancelar\b/i,
  /\bme\s+(reembols\w*|estorn\w*|devolv\w*)\b/i,
  /\bdevolv\w*\s+(o\s+)?(meu\s+)?dinheiro\b/i,
  /\b(s[óo]\s+)?quero\s+(o\s+)?(meu\s+)?dinheiro\b/i,
  // English
  /\b(i\s+)?want\s+(a\s+|my\s+)?(refund|money\s+back)\b/i,
  /\bmoney\s+back\b/i,
  /\b(process|issue|give\s+me)\s+(the\s+|a\s+|my\s+)?refund\b/i,
  /\bjust\s+refund\s+me\b/i,
  /\brefund\s+me\b/i,
  /\bcancel\s+(my\s+)?(order|subscription)\b/i,
  // Spanish
  /\bquiero\s+(mi\s+)?(reembolso|dinero)\b/i,
  /\bdevu[ée]lv[ae]me\b/i,
];

/** Phrases that look like demands but are questions or musings. */
const SOFT_PATTERNS: RegExp[] = [
  /\b(tem|existe|h[áa])\s+(alguma\s+)?garantia\b/i,
  /\b(posso|consigo|d[áa]\s+pra)\s+(pedir|solicitar)\b/i,
  /\b(estou|tô|to)\s+pensando\s+em\b/i,
  /\bthinking\s+about\s+(a\s+)?(refund|returning)\b/i,
  /\b(is\s+there|do\s+you\s+have)\s+a\s+(guarantee|refund\s+policy)\b/i,
  /\bcan\s+i\s+(get|ask\s+for)\b/i,
];

export function isRefundDemand(text: string): boolean {
  if (SOFT_PATTERNS.some((p) => p.test(text))) return false;
  return DEMAND_PATTERNS.some((p) => p.test(text));
}

/** How many customer messages so far contain an unambiguous demand. */
export function countRefundDemands(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user" && isRefundDemand(m.content))
    .length;
}

/** Signals that must bypass retention entirely — see the hard exceptions. */
const HARD_EXCEPTION_PATTERNS: RegExp[] = [
  // Chargeback / legal
  /\b(chargeback|charge\s?back|estorno\s+no\s+cart[ãa]o)\b/i,
  /\b(disput[ae]|contest[ae]r?)\b.*\b(banco|bank|cart[ãa]o|card)\b/i,
  /\b(banco|bank)\b.*\b(disput[ae]|contest|reclama)/i,
  /\b(advogado|lawyer|attorney|procon|bbb|ftc)\b/i,
  /\bvou\s+(abrir|entrar\s+com)\s+(uma\s+)?(disputa|a[çc][ãa]o)\b/i,
  /\b(sue|suing|legal\s+action)\b/i,
  // Adverse reaction
  /\b(cora[çc][ãa]o\s+acelerad|taquicardia|palpita[çc])/i,
  /\b(tontura|tonteira|enj[ôo]o|v[ôo]mito|vomit|n[áa]usea)\b/i,
  /\b(al[ée]rgi|alergic|allergic|reaction|rea[çc][ãa]o\s+advers)/i,
  /\b(racing\s+heart|chest\s+pain|dizzy|dizziness|insomnia|ins[ôo]nia)\b/i,
  /\b(passei\s+mal|me\s+senti\s+mal|fiquei\s+mal)\b/i,
  // Our failure
  /\b(n[ãa]o\s+(chegou|recebi)|never\s+arrived|didn'?t\s+arrive)\b/i,
  /\b(produto\s+errado|wrong\s+(product|item)|veio\s+errado)\b/i,
  /\b(cobrad[oa]\s+(duas|2)\s+vezes|double\s+charg|duplicate\s+charg)/i,
  /\b(frasco|caixa|pacote)\s+(quebrad|danificad|violad|aberto)/i,
  // Vulnerable
  /\b(gr[áa]vida|gravidez|pregnan|amamentand|breastfeed)/i,
  /\b(tomo\s+rem[ée]dio|medica[çc][ãa]o|medication|press[ãa]o\s+alta|diab[ée]t)/i,
];

export function hasHardException(text: string): boolean {
  return HARD_EXCEPTION_PATTERNS.some((p) => p.test(text));
}

export function detectHardException(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === "user" && hasHardException(m.content));
}

/* ══════════════════════  risco de chargeback  ══════════════════════════ */

/**
 * A ameaça EXPLÍCITA de chargeback já é exceção dura (acima). Isto aqui pega
 * o degrau anterior — o cliente em rota de colisão que ainda não disse a
 * palavra: acusações de golpe, ameaça de denúncia, ultimatos, gritaria.
 *
 * Um chargeback custa a venda + taxa + pontos no processador; segurar a
 * retenção nesse estado é trocar um reembolso por um prejuízo maior. Quando o
 * risco passa do limiar, o gate abre mais cedo e o agente é instruído a
 * acalmar e OFERECER o atendente humano.
 *
 * Pesos somados por mensagem do cliente (com teto por mensagem, para uma
 * única mensagem raivosa não estourar sozinha o que três sinais espalhados
 * indicam melhor).
 */
const RISK_PATTERNS: Array<{ padrao: RegExp; peso: number }> = [
  // Acusações de fraude — quem chama a compra de golpe disputa no banco.
  { padrao: /\b(golpe|scam|fraude|fraud|rip[\s-]?off|enganad[oa]|charlat)/i, peso: 2 },
  { padrao: /\b(roub(o|ad[oa]|aram)|ladr[õoã]|stole|theft|thie(f|ves))\b/i, peso: 2 },
  // Ameaça de denúncia pública ou formal (Procon/BBB/advogado já são exceção
  // dura; aqui ficam os degraus antes disso).
  { padrao: /\b(reclame\s*aqui|denunciar?|denuncio|report(ar|ing|ed)?\s+(you|this|voc[êe]s?)|expor|exposing)\b/i, peso: 2 },
  { padrao: /\b(avalia[çc][ãa]o|review|coment[áa]rio)\s+(negativ|p[úu]blic|1\s*estrela)/i, peso: 1 },
  { padrao: /\bvou\s+(ligar|falar|entrar\s+em\s+contato)\s+(com|no|para)\s+(o\s+)?(banco|cart[ãa]o|operadora)\b/i, peso: 3 },
  { padrao: /\b(call(ing)?|contact(ing)?)\s+my\s+(bank|card|credit\s+card)\b/i, peso: 3 },
  // Ultimato — a última mensagem antes de resolver por fora.
  { padrao: /\b([úu]ltima\s+(vez|chance|mensagem)|last\s+(time|chance|warning)|final\s+(answer|warning))\b/i, peso: 2 },
  { padrao: /\b(cansei|chega|desisto|fed\s+up|i'?m\s+done|enough)\b/i, peso: 1 },
  // Gritaria sustentada.
  { padrao: /[!?]{3,}/, peso: 1 },
];

const CAPS_MIN_LETRAS = 12;
const RISCO_LIMIAR = 3;
const TETO_POR_MENSAGEM = 3;

function riscoDaMensagem(text: string): number {
  let pontos = 0;
  for (const { padrao, peso } of RISK_PATTERNS) {
    if (padrao.test(text)) pontos += peso;
  }
  // Mensagem inteira aos berros conta como um sinal.
  const letras = text.replace(/[^a-za-záéíóúâêôãõç]/gi, "");
  if (letras.length >= CAPS_MIN_LETRAS) {
    const maiusculas = text.replace(/[^A-ZÁÉÍÓÚÂÊÔÃÕÇ]/g, "").length;
    if (maiusculas / letras.length > 0.7) pontos += 1;
  }
  return Math.min(pontos, TETO_POR_MENSAGEM);
}

/** Soma do risco em todas as mensagens do cliente. */
export function chargebackRiskScore(messages: ChatMessage[]): number {
  return messages
    .filter((m) => m.role === "user")
    .reduce((total, m) => total + riscoDaMensagem(m.content), 0);
}

/**
 * O cliente está em pico de risco de chargeback?
 *
 * Dois caminhos: sinais de raiva/acusação suficientes por si sós, ou uma
 * insistência já longa (4+ pedidos de reembolso) combinada com qualquer
 * sinal de escalada — quem pediu quatro vezes e começou a gritar não vai
 * pedir uma sétima.
 */
export function isChargebackRisk(messages: ChatMessage[]): boolean {
  const score = chargebackRiskScore(messages);
  if (score >= RISCO_LIMIAR) return true;
  return countRefundDemands(messages) >= 4 && score >= 1;
}

/* ═══════════════════  pedido explícito de humano  ══════════════════════ */

/**
 * "Quero falar com um atendente" NÃO é pedido de reembolso — e o contador de
 * exigências não o via. Sem este detector, o cliente que só quer uma pessoa
 * ficava preso num loop de retenção até desistir (ou virar chargeback).
 *
 * Conta por MENSAGEM, como as exigências: pedir duas vezes já demonstra que
 * a primeira resposta da IA não bastou.
 */
const HUMAN_REQUEST_PATTERNS: RegExp[] = [
  // Português
  /\b(falar|conversar)\s+com\s+(um[a]?\s+)?(humano|atendente|pessoa|gerente|supervisor|algu[ée]m\s+de\s+verdade)\b/i,
  /\b(quero|preciso|me\s+(passa|transfere))\s+(de\s+)?(um[a]?\s+)?(atendente|humano|gerente|supervisor)\b/i,
  /\batendimento\s+humano\b/i,
  /\b(chega\s+de|cansei\s+de(sse)?)\s+(rob[ôo]|bot|ia|m[áa]quina)\b/i,
  /\bvoc[êe]\s+[ée]\s+(um\s+)?(rob[ôo]|bot|ia)\b/i,
  // English
  /\b(speak|talk)\s+(to|with)\s+(a\s+)?(human|person|real\s+person|agent|manager|supervisor|someone\s+real)\b/i,
  /\b(real|actual|live)\s+(person|human|agent)\b/i,
  /\bhuman\s+(agent|support|being)\b/i,
  /\bare\s+you\s+a\s+(bot|robot|an?\s+ai)\b/i,
  /\bstop\s+the\s+bot\b/i,
  // Español
  /\bhablar\s+con\s+(un[a]?\s+)?(humano|persona|agente|supervisor)\b/i,
];

export function isHumanRequest(text: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((p) => p.test(text));
}

/** Em quantas mensagens o cliente pediu um humano. */
export function countHumanRequests(messages: ChatMessage[]): number {
  return messages.filter(
    (m) => m.role === "user" && isHumanRequest(m.content),
  ).length;
}
