import { prisma } from "../db";
import { isPlatformId, type Order, type PlatformId } from "./types";

/**
 * Local mirror of purchases, filled by each platform's webhook/IPN.
 *
 * This is the only way some platforms can be supported at all: JVZoo, for
 * example, pushes every sale through JVZIPN but offers no public "look up this
 * transaction" endpoint. For platforms that *do* have a lookup API, this still
 * acts as a cache and as a safety net when their API is down.
 */

export interface OrderRecordInput extends Omit<Order, "purchaseDate"> {
  purchaseDate: string | Date | null;
  raw?: unknown;
}

export async function saveOrderRecord(input: OrderRecordInput): Promise<void> {
  const purchaseDate = input.purchaseDate
    ? new Date(input.purchaseDate)
    : null;
  const data = {
    vendor: input.vendor,
    productId: input.productId,
    productTitle: input.productTitle,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    amount: input.amount || null,
    currency: input.currency,
    purchaseDate:
      purchaseDate && !Number.isNaN(purchaseDate.getTime())
        ? purchaseDate
        : null,
    status: input.status,
  };

  await prisma.orderRecord.upsert({
    where: {
      platform_orderId: { platform: input.platform, orderId: input.orderId },
    },
    update: data,
    create: {
      platform: input.platform,
      orderId: input.orderId,
      ...data,
    },
  });
}

export async function findOrderRecord(
  platform: PlatformId,
  orderId: string,
): Promise<Order | null> {
  try {
    const row = await prisma.orderRecord.findUnique({
      where: { platform_orderId: { platform, orderId } },
    });
    if (!row) return null;

    return {
      platform,
      orderId: row.orderId,
      vendor: row.vendor,
      productId: row.productId,
      productTitle: row.productTitle,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      amount: row.amount ? Number(row.amount) : 0,
      currency: row.currency ?? "USD",
      purchaseDate: row.purchaseDate ? row.purchaseDate.toISOString() : null,
      status: row.status,
    };
  } catch (err) {
    // A missing DB must never break the customer-facing lookup — the API
    // adapters can still answer.
    console.error(`[orderStore] lookup failed for ${platform}/${orderId}`, err);
    return null;
  }
}

/**
 * Every mirrored purchase made with this email address, newest first.
 *
 * This is what makes "type your email" possible at all: no platform exposes a
 * customer-wide lookup, so the webhook mirror is the only place that can answer
 * "what did this person buy?".
 */
export async function findOrderRecordsByEmail(
  email: string,
  limit = 5,
): Promise<Order[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  try {
    const rows = await prisma.orderRecord.findMany({
      where: { email: { equals: normalized, mode: "insensitive" } },
      orderBy: [
        // Purchases that predate the mirror carry no date — keep them, but
        // behind everything we can actually order.
        { purchaseDate: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: limit,
    });

    return rows.flatMap((row) => {
      if (!isPlatformId(row.platform)) return [];
      return [
        {
          platform: row.platform,
          orderId: row.orderId,
          vendor: row.vendor,
          productId: row.productId,
          productTitle: row.productTitle,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email,
          amount: row.amount ? Number(row.amount) : 0,
          currency: row.currency ?? "USD",
          purchaseDate: row.purchaseDate ? row.purchaseDate.toISOString() : null,
          status: row.status,
        },
      ];
    });
  } catch (err) {
    // Same rule as the order lookup: a database problem must never be the
    // reason a customer cannot reach support.
    console.error(`[orderStore] email lookup failed`, err);
    return [];
  }
}

/** Marks a mirrored order as refunded, so a second lookup reflects reality. */
export async function markOrderRecordRefunded(
  platform: PlatformId,
  orderId: string,
): Promise<void> {
  try {
    await prisma.orderRecord.updateMany({
      where: { platform, orderId },
      data: { status: "refunded" },
    });
  } catch (err) {
    console.error(`[orderStore] refund flag failed for ${platform}/${orderId}`, err);
  }
}
