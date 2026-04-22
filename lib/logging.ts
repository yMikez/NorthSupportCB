import { createHash } from "node:crypto";
import { prisma } from "./db";
import type { ChatMessage } from "./claude";

export interface StartConversationInput {
  conversationId: string;
  receipt: string;
  vendor: string | null;
  productTitle: string | null;
  customerName: string | null;
  customerEmail: string | null;
  refundAmount: number;
  currency: string;
  ip: string;
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export async function ensureConversation(
  input: StartConversationInput,
): Promise<void> {
  try {
    await prisma.conversation.upsert({
      where: { id: input.conversationId },
      update: { lastActivityAt: new Date() },
      create: {
        id: input.conversationId,
        receipt: input.receipt,
        vendor: input.vendor,
        productTitle: input.productTitle,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        refundAmount: input.refundAmount || null,
        currency: input.currency,
        ipHash: hashIp(input.ip),
      },
    });
  } catch (err) {
    console.error("[logging] ensureConversation failed", err);
  }
}

export async function appendNewUserMessages(
  conversationId: string,
  messages: ChatMessage[],
): Promise<void> {
  try {
    const existingCount = await prisma.message.count({
      where: { conversationId },
    });
    const toInsert = messages.slice(existingCount);
    if (toInsert.length === 0) return;

    await prisma.message.createMany({
      data: toInsert.map((m) => ({
        conversationId,
        role: m.role,
        content: m.content,
      })),
    });
  } catch (err) {
    console.error("[logging] appendNewUserMessages failed", err);
  }
}

export async function appendAssistantMessage(
  conversationId: string,
  content: string,
): Promise<void> {
  try {
    await prisma.message.create({
      data: { conversationId, role: "assistant", content },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastActivityAt: new Date() },
    });
  } catch (err) {
    console.error("[logging] appendAssistantMessage failed", err);
  }
}

export async function markConversationOutcome(
  receipt: string,
  outcome: "refund_issued" | "refund_abandoned" | "resolved",
): Promise<void> {
  try {
    const latest = await prisma.conversation.findFirst({
      where: { receipt },
      orderBy: { startedAt: "desc" },
    });
    if (!latest) return;
    await prisma.conversation.update({
      where: { id: latest.id },
      data: { outcome, endedAt: new Date() },
    });
  } catch (err) {
    console.error("[logging] markConversationOutcome failed", err);
  }
}

const ANGRY_PATTERNS =
  /\b(scam|fraud|chargeback|dispute|sue|lawyer|bbb|refund me now|fucking|fucked|bullshit|ripoff|stole|steal|theft)\b/i;
const ANGRY_CAPS_MIN = 12;

function looksAngry(text: string): boolean {
  if (ANGRY_PATTERNS.test(text)) return true;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= ANGRY_CAPS_MIN) {
    const uppers = letters.replace(/[^A-Z]/g, "").length;
    if (uppers / letters.length > 0.6) return true;
  }
  const exclamations = (text.match(/!/g) || []).length;
  if (exclamations >= 3) return true;
  return false;
}

const DISAPPOINTED_PATTERNS =
  /\b(not working|doesn[' ]?t work|disappointed|didn[' ]?t work|no results|waste|regret|refund)\b/i;

export async function detectAndStoreInitialMood(
  conversationId: string,
  firstUserMessage: string,
): Promise<void> {
  const mood = looksAngry(firstUserMessage)
    ? "angry"
    : DISAPPOINTED_PATTERNS.test(firstUserMessage)
      ? "disappointed"
      : "calm";

  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { initialMood: true },
    });
    if (conv?.initialMood !== "unknown") return;
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { initialMood: mood },
    });
  } catch (err) {
    console.error("[logging] detectAndStoreInitialMood failed", err);
  }
}
