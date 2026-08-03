import { NextResponse } from "next/server";
import {
  devDetail,
  enabledAdapters,
  findOrder,
  findOrderByEmail,
} from "@/lib/platforms";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { isHandoffMode } from "@/lib/mode";
import { isValidEmail, normalizeEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
/** Lower than the chat limit: this endpoint is the one an id-guesser would hammer. */
const MAX_LOOKUPS_PER_HOUR = 30;

/**
 * Where the flow starts.
 *
 * The customer identifies by **order ID** (the transaction id on their
 * receipt) — it resolves to exactly ONE purchase, and everything downstream
 * (conversation, support history, the dashboard) keys on it. The **email
 * address** remains as the explicit fallback for whoever can't find the
 * number: an email with nothing behind it is *not* a dead end — support must
 * never turn away someone who bought under a different address or whose
 * purchase predates the webhook mirror. They go through to the chat with no
 * order attached and the agent asks what they need.
 *
 * `caseKey` is what the rest of the flow keys on: the resolved order id when we
 * found one, the email address when we did not. Chat and escalation both speak
 * that one value.
 *
 * Having been here before is never a reason to refuse someone: a customer
 * refunded last month may have a new problem today, so every lookup opens a
 * fresh conversation.
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const limit = rateLimit(`lookup:${ip}`, MAX_LOOKUPS_PER_HOUR, HOUR_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many lookups. Please try again later." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const rawEmail = String(body.email ?? "").trim();
  const rawOrderId = String(body.orderId ?? body.receipt ?? "").trim();

  // O id de transação tem precedência quando os dois vierem: ele identifica
  // UM pedido; o e-mail identifica uma pessoa que pode ter vários.
  if (rawOrderId) {
    return lookupByOrderId(rawOrderId);
  }

  if (!isValidEmail(rawEmail)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  const email = normalizeEmail(rawEmail);

  // Handoff mode: no store is wired up, so there is nothing to resolve the
  // email against. The address itself identifies the case.
  if (isHandoffMode()) {
    return NextResponse.json(unmatched(email));
  }

  if (enabledAdapters().length === 0) {
    console.error("[lookup-order] no platform is configured");
    return NextResponse.json(
      {
        error:
          "Support is temporarily unavailable. Please email us and we'll help you directly.",
      },
      { status: 503 },
    );
  }

  let lookup;
  try {
    lookup = await findOrderByEmail(email);
  } catch (err) {
    console.error("[lookup-order] unexpected", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", detail: devDetail(err) },
      { status: 500 },
    );
  }

  // No mirrored purchase for this address — let them through anyway.
  if (!lookup) {
    console.log(`[lookup-order] no order mirrored for this email — proceeding`);
    return NextResponse.json(unmatched(email));
  }

  const { order, adapter } = lookup;

  return NextResponse.json({
    found: true,
    matched: true,
    caseKey: order.orderId,
    email,
    platform: order.platform,
    platformLabel: adapter.label,
    orderId: order.orderId,
    refundAmount: order.amount,
    currency: order.currency,
    vendor: order.vendor,
    firstName: order.firstName,
    productTitle: order.productTitle,
  });
}

/** The shape returned when no purchase could be tied to the address. */
function unmatched(email: string) {
  return {
    found: true,
    matched: false,
    caseKey: email,
    email,
    platform: null,
    platformLabel: null,
    orderId: null,
    refundAmount: 0,
    currency: "USD",
    vendor: null,
    firstName: null,
    productTitle: null,
  };
}

/** O caminho principal: o id de transação resolve exatamente um pedido. */
async function lookupByOrderId(orderId: string) {
  if (orderId.length < 4) {
    return NextResponse.json(
      { error: "Order number must be at least 4 characters." },
      { status: 400 },
    );
  }

  if (isHandoffMode()) {
    return NextResponse.json({
      found: true,
      matched: false,
      caseKey: orderId,
      email: null,
      platform: null,
      platformLabel: null,
      orderId,
      refundAmount: 0,
      currency: "USD",
      vendor: null,
      firstName: null,
      productTitle: null,
    });
  }

  let lookup;
  try {
    lookup = await findOrder(orderId);
  } catch (err) {
    console.error("[lookup-order] unexpected", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again.", detail: devDetail(err) },
      { status: 500 },
    );
  }

  if (!lookup) {
    return NextResponse.json(
      {
        found: false,
        error:
          "We couldn't find that order number. Please double-check it, or use the email address on your receipt.",
      },
      { status: 404 },
    );
  }

  const { order, adapter } = lookup;
  return NextResponse.json({
    found: true,
    matched: true,
    caseKey: order.orderId,
    email: order.email,
    platform: order.platform,
    platformLabel: adapter.label,
    orderId: order.orderId,
    refundAmount: order.amount,
    currency: order.currency,
    vendor: order.vendor,
    firstName: order.firstName,
    productTitle: order.productTitle,
  });
}
