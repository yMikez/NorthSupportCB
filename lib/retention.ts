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
