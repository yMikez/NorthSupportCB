import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  devDetail,
  enabledAdapters,
  findOrder,
  findOrderByEmail,
  isMockMode,
  type PlatformAdapter,
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
 * The customer types their **email address**; we look for a mirrored purchase
 * made with it and, when there is one, carry the order through the rest of the
 * flow. An email with nothing behind it is *not* a dead end — support must
 * never turn away someone who bought under a different address or whose
 * purchase predates the webhook mirror. They go through to the chat with no
 * order attached and the agent asks what they need.
 *
 * `caseKey` is what the rest of the flow keys on: the resolved order id when we
 * found one, the email address when we did not. Chat, escalation and the
 * "already handled" check all speak that one value.
 *
 * An `orderId` body is still accepted so an operator can look a case up the old
 * way; the customer-facing UI no longer sends one.
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

  if (!rawEmail && rawOrderId) {
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
    return NextResponse.json({
      ...unmatched(email),
      existingCase: await findExistingCaseFor(null, email, email),
    });
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
    return NextResponse.json({
      ...unmatched(email),
      existingCase: await findExistingCaseFor(null, email, email),
    });
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
    existingCase: await findExistingCase(adapter, order.orderId, email),
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

/** Legacy path: an order number, resolved the way it always was. */
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
      existingCase: await findExistingCaseFor(null, orderId, null),
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
    existingCase: await findExistingCase(adapter, order.orderId, order.email),
  });
}

interface ExistingCase {
  type: string;
  status: string;
  openedDate: string;
  reference: string;
}

/**
 * Stops a customer from being taken through the whole flow twice.
 *
 * Two sources: a ticket already open on the platform (for platforms that
 * expose one), and our own records. Only *finished* refunds block — a
 * conversation still in progress means the customer refreshed the page and
 * they should be able to carry on.
 */
async function findExistingCase(
  adapter: PlatformAdapter,
  orderId: string,
  email: string | null,
): Promise<ExistingCase | null> {
  const platform = adapter.id;

  // In mock mode every adapter can answer, so the "already handled" screen is
  // reachable with an OPEN test id without needing a database.
  if (adapter.capabilities.listTickets || isMockMode()) {
    try {
      const [ticket] = await adapter.listOpenTickets(orderId);
      if (ticket) {
        return {
          type: ticket.type || "Support",
          status: ticket.status || "Open",
          openedDate: ticket.openedDate,
          reference: ticket.ticketId,
        };
      }
    } catch (err) {
      console.error(`[lookup-order] ${platform} ticket check failed`, err);
    }
  }

  return findExistingCaseFor(platform, orderId, email);
}

/**
 * DB-only check — works with or without a platform (handoff mode has none).
 *
 * Matches on the case key *or* the email address, so someone who opened a case
 * last week under an order number is still recognised when they come back and
 * type their email today.
 */
async function findExistingCaseFor(
  platform: string | null,
  caseKey: string,
  email: string | null,
): Promise<ExistingCase | null> {
  const identity = email
    ? { OR: [{ orderId: caseKey }, { customerEmail: email }] }
    : { orderId: caseKey };
  const scope = { ...identity, ...(platform ? { platform } : {}) };

  try {
    const open = await prisma.refundRequest.findFirst({
      where: { ...scope, status: "pending" as const },
      orderBy: { createdAt: "desc" },
    });
    if (open) {
      const handoff = open.kind === "handoff";
      return {
        type: handoff ? "Support request" : "Refund",
        status: handoff ? "With our team" : "Being processed",
        openedDate: open.createdAt.toISOString().slice(0, 10),
        reference: open.id.slice(-8).toUpperCase(),
      };
    }

    const finished = await prisma.conversation.findFirst({
      where: {
        ...scope,
        outcome: { in: ["refund_issued" as const, "escalated" as const] },
      },
      orderBy: { startedAt: "desc" },
    });
    if (finished) {
      const handoff = finished.outcome === "escalated";
      return {
        type: handoff ? "Support request" : "Refund",
        status: handoff ? "With our team" : "Approved",
        openedDate: (finished.endedAt ?? finished.startedAt)
          .toISOString()
          .slice(0, 10),
        reference: finished.id.slice(-8).toUpperCase(),
      };
    }

    return null;
  } catch (err) {
    // A DB hiccup must not stop a customer from getting support.
    console.error("[lookup-order] existing-case check failed", err);
    return null;
  }
}
