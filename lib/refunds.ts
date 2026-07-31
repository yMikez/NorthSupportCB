import { prisma } from "./db";
import {
  getAdapter,
  UnsupportedOperationError,
  type Order,
  type RefundOutcome,
} from "./platforms";

/**
 * Single entry point for "the agent approved a refund".
 *
 * The rule: the customer's request must never be lost. If the platform can
 * issue the refund programmatically we do that; in every other case
 * (no refund API, API down, credentials unverified) the request is written to
 * the `RefundRequest` queue for a human to execute in the platform dashboard.
 *
 * The customer sees the same confirmation either way.
 */

export interface RefundContext {
  conversationId?: string | null;
}

export async function processRefund(
  order: Order,
  ctx: RefundContext = {},
): Promise<RefundOutcome> {
  const adapter = getAdapter(order.platform);

  if (adapter?.capabilities.createRefund) {
    try {
      const outcome = await adapter.createRefund(order);
      return outcome;
    } catch (err) {
      const reason =
        err instanceof UnsupportedOperationError
          ? "Platform has no usable refund API."
          : `Platform refund call failed: ${
              err instanceof Error ? err.message : String(err)
            }`;
      console.error(`[refunds] ${order.platform}/${order.orderId} → queue`, err);
      await queueRefund(order, reason, ctx.conversationId ?? null);
      return { mode: "manual", reference: null };
    }
  }

  await queueRefund(
    order,
    adapter
      ? `${adapter.label} does not expose a refund API — needs manual processing.`
      : `Unknown platform "${order.platform}".`,
    ctx.conversationId ?? null,
  );
  return { mode: "manual", reference: null };
}

/** Writes to the queue, skipping duplicates for the same order. */
export async function queueRefund(
  order: Order,
  note: string,
  conversationId: string | null,
): Promise<void> {
  try {
    const existing = await prisma.refundRequest.findFirst({
      where: {
        platform: order.platform,
        orderId: order.orderId,
        status: "pending",
      },
      select: { id: true },
    });
    if (existing) return;

    await prisma.refundRequest.create({
      data: {
        platform: order.platform,
        orderId: order.orderId,
        conversationId,
        vendor: order.vendor,
        productTitle: order.productTitle,
        customerName: [order.firstName, order.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || null,
        customerEmail: order.email,
        amount: order.amount || null,
        currency: order.currency,
        note,
      },
    });
  } catch (err) {
    // Losing the queue entry would mean silently dropping a promised refund —
    // shout loudly in the logs so it can be recovered from the conversation log.
    console.error(
      `[refunds] FAILED TO QUEUE ${order.platform}/${order.orderId} — refund promised to customer but not recorded!`,
      err,
    );
  }
}

export interface EscalationInput {
  orderId: string;
  platform?: string | null;
  conversationId?: string | null;
  /** Where the customer expects our reply — what they typed on the first screen. */
  customerEmail?: string | null;
  /** Why the agent gave up — shown to whoever picks the conversation up. */
  reason?: string | null;
  /** Hard exception (health, chargeback threat, our failure): work it first. */
  urgent?: boolean;
}

/** Enough to write to the customer without re-reading the queue. */
export interface EscalationResult {
  reference: string;
  customerEmail: string | null;
  customerName: string | null;
  productTitle: string | null;
  /** Null when the case is keyed on an email rather than a real order. */
  orderId: string | null;
}

/**
 * Retention failed — hand the conversation to a human.
 *
 * Nothing is refunded here. The row is a work item for a person, carrying the
 * conversation id so they can read the whole exchange before replying.
 */
export async function escalateToHuman(
  input: EscalationInput,
): Promise<EscalationResult | null> {
  const platform = input.platform ?? "";
  const typedEmail = input.customerEmail?.trim().toLowerCase() || null;
  // The case key doubles as the order number only when a purchase was matched;
  // otherwise it holds the customer's own email address. No platform issues
  // order ids containing "@", so that is the reliable tell — surer than
  // comparing against the address we happen to have been handed.
  const realOrderId = input.orderId.includes("@") ? null : input.orderId;

  try {
    const existing = await prisma.refundRequest.findFirst({
      where: {
        orderId: input.orderId,
        kind: "handoff",
        status: "pending",
      },
      select: {
        id: true,
        customerEmail: true,
        customerName: true,
        productTitle: true,
      },
    });
    if (existing) {
      return {
        reference: existing.id.slice(-8).toUpperCase(),
        customerEmail: existing.customerEmail ?? typedEmail,
        customerName: existing.customerName,
        productTitle: existing.productTitle,
        orderId: realOrderId,
      };
    }

    // Copy the customer's details off the conversation so the queue is readable
    // without opening each transcript.
    const conversation = input.conversationId
      ? await prisma.conversation.findUnique({
          where: { id: input.conversationId },
          select: {
            vendor: true,
            productTitle: true,
            customerName: true,
            customerEmail: true,
            refundAmount: true,
            currency: true,
          },
        })
      : null;

    const row = await prisma.refundRequest.create({
      data: {
        kind: "handoff",
        urgent: input.urgent ?? false,
        platform,
        orderId: input.orderId,
        conversationId: input.conversationId ?? null,
        vendor: conversation?.vendor ?? null,
        productTitle: conversation?.productTitle ?? null,
        customerName: conversation?.customerName ?? null,
        customerEmail: conversation?.customerEmail ?? typedEmail,
        amount: conversation?.refundAmount ?? null,
        currency: conversation?.currency ?? null,
        note: input.reason ?? "Agent could not retain the customer.",
      },
    });

    return {
      reference: row.id.slice(-8).toUpperCase(),
      customerEmail: row.customerEmail,
      customerName: row.customerName,
      productTitle: row.productTitle,
      orderId: realOrderId,
    };
  } catch (err) {
    // The customer has already been told a human will follow up — if we cannot
    // record that, say so loudly so it can be recovered from the chat log.
    console.error(
      `[refunds] FAILED TO QUEUE HANDOFF for order ${input.orderId} — customer was promised a human!`,
      err,
    );
    return null;
  }
}

export interface PendingRefundRow {
  id: string;
  kind: string;
  urgent: boolean;
  platform: string;
  orderId: string;
  conversationId: string | null;
  vendor: string | null;
  productTitle: string | null;
  customerName: string | null;
  customerEmail: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  note: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

export async function listRefundRequests(
  status: "pending" | "processed" | "failed" | "cancelled" | "all" = "pending",
  limit = 100,
  kind?: "refund" | "handoff",
): Promise<PendingRefundRow[]> {
  const rows = await prisma.refundRequest.findMany({
    where: {
      ...(status === "all" ? {} : { status }),
      ...(kind ? { kind } : {}),
    },
    // Urgent escalations (health reactions, chargeback threats) float to the top.
    orderBy: [{ urgent: "desc" }, { createdAt: "desc" }],
    take: limit,
  });

  return rows.map((row) => ({
    ...row,
    amount: row.amount ? Number(row.amount) : null,
  }));
}

export async function countPendingRefunds(): Promise<number> {
  return prisma.refundRequest.count({ where: { status: "pending" } });
}

export async function updateRefundStatus(
  id: string,
  status: "processed" | "failed" | "cancelled",
  note?: string | null,
): Promise<boolean> {
  try {
    await prisma.refundRequest.update({
      where: { id },
      data: {
        status,
        processedAt: new Date(),
        ...(note ? { note } : {}),
      },
    });
    return true;
  } catch (err) {
    console.error(`[refunds] updateRefundStatus failed for ${id}`, err);
    return false;
  }
}
