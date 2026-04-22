import { NextResponse } from "next/server";
import { streamClaudeResponse, type ChatMessage } from "@/lib/claude";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { getOrder, ClickBankError } from "@/lib/clickbank";
import { loadKnowledge } from "@/lib/knowledge";
import {
  ensureConversation,
  appendNewUserMessages,
  appendAssistantMessage,
  detectAndStoreInitialMood,
} from "@/lib/logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const MAX_PER_HOUR = 20;

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
    receipt?: string;
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
  const receipt = String(payload.receipt ?? "").trim();
  const refundAmount = Number(payload.refundAmount ?? 0);
  const currency = String(payload.currency ?? "USD");
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  if (receipt.length < 4) {
    return NextResponse.json(
      { error: "Receipt is required." },
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

  let vendor: string | null = null;
  let productTitle: string | null = null;
  let customerName: string | null = null;
  let customerEmail: string | null = null;
  try {
    const order = await getOrder(receipt);
    vendor = order.vendor ?? null;
    productTitle = order.productTitle ?? null;
    customerName = order.firstName ?? null;
    customerEmail = order.email ?? null;
  } catch (err) {
    if (!(err instanceof ClickBankError) || err.status !== 404) {
      console.error("[chat] getOrder failed", err);
    }
  }

  const knowledge = await loadKnowledge(vendor);

  await ensureConversation({
    conversationId,
    receipt,
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
      knowledge: knowledge.combined,
      context: {
        receipt,
        refundAmount,
        currency,
        customerName,
        productTitle,
        vendor,
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
          appendAssistantMessage(conversationId, assistantAccum).catch((e) =>
            console.error("[chat] appendAssistantMessage failed", e),
          );
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
