import { createHash } from "node:crypto";
import { pickString } from "./http";
import { isMockMode, mockDelay, mockGetOrder, mockOpenTickets } from "./mock";
import { findOrderRecord } from "./orderStore";
import { resolveVendor } from "./vendorMap";
import {
  UnsupportedOperationError,
  type Order,
  type PlatformAdapter,
  type RefundOutcome,
  type SupportTicket,
} from "./types";

const PLATFORM = "jvzoo" as const;

/**
 * JVZoo adapter — webhook-only by design.
 *
 * JVZoo's integration surface is JVZIPN: it POSTs to your URL on every sale,
 * rebill, refund and chargeback. There is no public endpoint to look a
 * transaction up after the fact, so the mirror IS the source of truth here.
 *
 * Setup (no API key needed):
 *   1. JVZoo dashboard → your product → JVZIPN URL:
 *        https://<your-domain>/api/webhooks/jvzoo
 *   2. Copy the product's JVZIPN secret key into JVZOO_SECRET_KEY.
 *   3. Every new sale from then on is answerable by the support agent.
 *
 * Orders placed BEFORE the webhook was configured will not be found — that is
 * a JVZoo limitation, not a bug in this app. The lookup route degrades to a
 * clear "we couldn't find that order" message.
 *
 * Refunds: JVZoo exposes no refund API. `createRefund` therefore throws
 * `UnsupportedOperationError` and the refund lands in the admin queue for a
 * human to execute in the JVZoo dashboard.
 */

function secretKey(): string | undefined {
  return process.env.JVZOO_SECRET_KEY?.trim() || undefined;
}

function amountInCents(): boolean {
  // JVZoo documents ctransamount in cents. Flip to false if your IPN log
  // shows decimal values instead.
  const value = process.env.JVZOO_AMOUNT_IN_CENTS;
  if (value === undefined || value === "") return true;
  return value === "true" || value === "1";
}

/**
 * JVZIPN signature check, per JVZoo's documented algorithm:
 * every POST field except `cverify`, sorted by key, values joined with "|",
 * secret key appended last, SHA1, first 8 chars uppercased.
 */
export function verifyJvzooSignature(
  params: Record<string, string>,
  secret: string,
): boolean {
  const provided = params.cverify;
  if (!provided) return false;

  const keys = Object.keys(params)
    .filter((key) => key !== "cverify")
    .sort();

  const payload = [...keys.map((key) => params[key]), secret].join("|");
  const expected = createHash("sha1")
    .update(payload, "utf8")
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();

  return expected === provided.toUpperCase();
}

/** JVZIPN transaction types that mean "this purchase is no longer valid". */
const REVERSAL_TRANSACTIONS = new Set(["RFND", "CGBK", "INSF", "CANCEL-REBILL"]);

export function isJvzooReversal(transactionType: string | null): boolean {
  return REVERSAL_TRANSACTIONS.has((transactionType ?? "").toUpperCase());
}

/** Normalizes a raw JVZIPN payload into an `Order`. */
export function jvzooToOrder(
  params: Record<string, string>,
  fallbackOrderId = "",
): Order {
  const raw = params as unknown as Record<string, unknown>;
  const productId = pickString(raw, "cproditem");
  const productTitle = pickString(raw, "cprodtitle");

  const rawAmount = Number(params.ctransamount ?? 0);
  const amount = Number.isFinite(rawAmount)
    ? amountInCents()
      ? rawAmount / 100
      : rawAmount
    : 0;

  const fullName = (params.ccustname ?? "").trim();
  const spaceAt = fullName.indexOf(" ");

  return {
    platform: PLATFORM,
    orderId: params.ctransreceipt?.trim() || fallbackOrderId,
    vendor: resolveVendor(PLATFORM, productId, productTitle),
    productId,
    productTitle,
    firstName: spaceAt === -1 ? fullName || null : fullName.slice(0, spaceAt),
    lastName: spaceAt === -1 ? null : fullName.slice(spaceAt + 1),
    email: params.ccustemail?.trim() || null,
    amount,
    currency: params.ccurrency?.trim() || "USD",
    purchaseDate: params.ctranstime
      ? new Date(Number(params.ctranstime) * 1000).toISOString()
      : null,
    status: isJvzooReversal(params.ctransaction ?? null)
      ? "refunded"
      : params.ctransaction || "completed",
  };
}

export const jvzooAdapter: PlatformAdapter = {
  id: PLATFORM,
  label: "JVZoo",
  orderSource: "webhook",
  capabilities: {
    lookupOrder: true,
    listTickets: false,
    // JVZoo has no refund API — refunds always go through the admin queue.
    createRefund: false,
  },

  missingEnv() {
    if (isMockMode()) return [];
    // Without the secret the JVZIPN signature can't be verified, so the mirror
    // never fills and the adapter genuinely cannot answer anything.
    return secretKey() ? [] : ["JVZOO_SECRET_KEY"];
  },

  notes() {
    if (isMockMode()) return [];
    return [
      "Resolves orders from the JVZIPN mirror only — purchases made before the webhook was configured cannot be found.",
      "JVZoo has no refund API; every approved refund goes to the /admin queue.",
    ];
  },

  async getOrder(orderId: string): Promise<Order | null> {
    if (isMockMode()) {
      await mockDelay(220);
      return mockGetOrder(PLATFORM, orderId);
    }
    return findOrderRecord(PLATFORM, orderId);
  },

  async listOpenTickets(orderId: string): Promise<SupportTicket[]> {
    if (isMockMode()) {
      await mockDelay(120);
      return mockOpenTickets(orderId);
    }
    return [];
  },

  async createRefund(order: Order): Promise<RefundOutcome> {
    if (isMockMode()) {
      await mockDelay(500);
      return { mode: "manual", reference: `mock-jv-${order.orderId}` };
    }
    throw new UnsupportedOperationError(
      PLATFORM,
      "createRefund (JVZoo has no public refund API — handled by the admin queue)",
    );
  },
};
