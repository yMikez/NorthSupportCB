import type { ChatMessage } from "./claude";
import { isMockMode } from "./platforms/mock";

export { isMockMode, mockDelay } from "./platforms/mock";

/**
 * Whether to use the scripted stand-in instead of the real Claude call.
 *
 * Separate from MOCK_MODE on purpose: the most useful setup for tuning the
 * agent is **fake orders + real agent** — no platform credentials needed, but
 * the knowledge/ files are actually exercised.
 *
 *   MOCK_MODE=true                 → fake orders, scripted replies (no API key)
 *   MOCK_MODE=true  MOCK_AI=false  → fake orders, REAL Claude  ← tune the prompt
 *   MOCK_MODE=false MOCK_AI=false  → production
 */
export function isMockAI(): boolean {
  const explicit = process.env.MOCK_AI;
  if (explicit === "false" || explicit === "0") return false;
  if (explicit === "true" || explicit === "1") return true;
  return isMockMode();
}

/**
 * Scripted stand-in for Claude, so the full conversation → refund → admin flow
 * can be walked through with MOCK_MODE=true and no Anthropic key.
 * Platform-agnostic: it only ever sees the order number.
 */
function mockScript(
  messages: ChatMessage[],
  orderId: string,
  refundAmount: number,
): string {
  const userMessages = messages.filter((m) => m.role === "user");
  const last =
    userMessages[userMessages.length - 1]?.content?.toLowerCase() ?? "";

  const confirmRegex =
    /\b(yes|yeah|yep|sure|sim|confirm|confirmo|proceed|prosseguir|ok|okay|go ahead|please do)\b/i;
  const amount = `$${refundAmount.toFixed(2)}`;

  if (userMessages.length === 1) {
    return `I'm really sorry to hear that. I want to help you get this sorted out. Could you tell me a little more about what happened? Was the product damaged in shipping, did it arrive late, or was it not what you were expecting?`;
  }

  if (confirmRegex.test(last)) {
    return `Understood — I'll process your full refund of ${amount} right now. You'll see it back on your original payment method within 3–10 business days depending on your bank. You don't need to return anything — we'll take care of everything on our side.\n{"action":"create_refund","order":"${orderId}"}`;
  }

  if (userMessages.length === 2) {
    return `Thank you for explaining. Before we go the refund route — most customers who feel this way at this stage are closer to results than they think. Would you be open to giving it another two weeks? If not, I'll process the full refund of ${amount} right away, just say the word.`;
  }

  return `Just to make sure we're aligned — would you like me to go ahead and process the full refund of ${amount}? Reply "yes" to confirm, or let me know if you'd like to try something else first.`;
}

export function mockChatStream(
  messages: ChatMessage[],
  orderId: string,
  refundAmount: number,
): ReadableStream<Uint8Array> {
  const text = mockScript(messages, orderId, refundAmount);
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const chunks = text.match(/.{1,18}/gs) ?? [text];
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await new Promise((r) => setTimeout(r, 45));
      }
      controller.close();
    },
  });
}
