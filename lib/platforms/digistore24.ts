import { pickNumber, pickString, platformFetch } from "./http";
import { isMockMode, mockDelay, mockGetOrder, mockOpenTickets } from "./mock";
import { findOrderRecord, markOrderRecordRefunded } from "./orderStore";
import { resolveVendor } from "./vendorMap";
import {
  PlatformError,
  UnsupportedOperationError,
  type Order,
  type PlatformAdapter,
  type RefundOutcome,
  type SupportTicket,
} from "./types";

const PLATFORM = "digistore24" as const;
const BASE_URL = "https://www.digistore24.com/api/call";

/**
 * Digistore24 adapter.
 *
 * ┌─ VERIFY ONCE YOU HAVE A KEY ────────────────────────────────────────────┐
 * │ Confirm against https://dev.digistore24.com/ :                          │
 * │  1. Auth header name (`X-DS-API-KEY`) and where to generate the key     │
 * │     (Account → Settings → API).                                          │
 * │  2. That `getPurchase/<id>` is the right lookup function and which       │
 * │     field holds the id the customer sees on their receipt.               │
 * │  3. Whether refunds are exposed (`refundPurchase`) for your account.     │
 * │     If they are not, leave DIGISTORE24_ENABLE_API_REFUND unset — every   │
 * │     refund then lands in the admin queue instead, and nothing breaks.    │
 * │ Field mapping below is defensive (several fallback names per field), so  │
 * │ small naming differences will not crash the lookup.                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

interface Digistore24Envelope {
  status?: string;
  code?: number;
  message?: string;
  result?: unknown;
}

function apiKey(): string | undefined {
  return process.env.DIGISTORE24_API_KEY?.trim() || undefined;
}

function apiRefundEnabled(): boolean {
  const value = process.env.DIGISTORE24_ENABLE_API_REFUND;
  return value === "true" || value === "1";
}

async function call<T>(
  fn: string,
  pathParams: string[] = [],
  opts: { method?: string; query?: Record<string, string> } = {},
): Promise<T> {
  const key = apiKey();
  if (!key) throw new PlatformError(PLATFORM, "DIGISTORE24_API_KEY is not set");

  const path = [fn, ...pathParams.map(encodeURIComponent)].join("/");
  const envelope = await platformFetch<Digistore24Envelope>(
    PLATFORM,
    `${BASE_URL}/${path}/`,
    {
      method: opts.method ?? "GET",
      headers: { "X-DS-API-KEY": key },
      query: opts.query,
    },
  );

  // Digistore24 answers 200 with an envelope even for logical errors.
  if (envelope && typeof envelope === "object" && "status" in envelope) {
    if (envelope.status && envelope.status !== "success") {
      throw new PlatformError(
        PLATFORM,
        envelope.message || `API returned status "${envelope.status}"`,
        { status: envelope.code ?? null, body: JSON.stringify(envelope).slice(0, 500) },
      );
    }
    return (envelope.result ?? {}) as T;
  }

  return envelope as unknown as T;
}

/** Shared by the REST lookup and the IPN webhook — both send the same fields. */
export function digistore24ToOrder(
  raw: Record<string, unknown>,
  orderId: string,
): Order {
  const productId = pickString(raw, "product_id", "productId", "product");
  const productTitle = pickString(raw, "product_name", "productName", "title");

  return {
    platform: PLATFORM,
    orderId: pickString(raw, "purchase_id", "id", "order_id") ?? orderId,
    vendor: resolveVendor(PLATFORM, productId, productTitle),
    productId,
    productTitle,
    firstName: pickString(raw, "first_name", "firstName", "buyer_first_name"),
    lastName: pickString(raw, "last_name", "lastName", "buyer_last_name"),
    email: pickString(raw, "email", "buyer_email", "customer_email"),
    amount: pickNumber(raw, "amount", "total_amount", "amount_brutto", "payment_amount"),
    currency: pickString(raw, "currency", "amount_currency") ?? "USD",
    purchaseDate: pickString(raw, "created_at", "order_date", "date", "pay_date"),
    status: pickString(raw, "billing_status", "status", "payment_status"),
  };
}

export const digistore24Adapter: PlatformAdapter = {
  id: PLATFORM,
  label: "Digistore24",
  orderSource: "api",
  capabilities: {
    lookupOrder: true,
    listTickets: false,
    createRefund: true,
  },

  missingEnv() {
    // Never blocking: without an API key this adapter still answers from the
    // IPN mirror. The key upgrades it to live lookups — see notes().
    return [];
  },

  notes() {
    if (isMockMode()) return [];
    const out: string[] = [];
    if (!apiKey()) {
      out.push(
        "DIGISTORE24_API_KEY is not set — orders resolve from the IPN mirror only, so purchases made before the webhook was configured cannot be found.",
      );
    }
    if (!apiRefundEnabled()) {
      out.push(
        "DIGISTORE24_ENABLE_API_REFUND is off — approved refunds go to the /admin queue instead of the Digistore24 API.",
      );
    }
    return out;
  },

  async getOrder(orderId: string): Promise<Order | null> {
    if (isMockMode()) {
      await mockDelay(250);
      return mockGetOrder(PLATFORM, orderId);
    }

    // No key configured: the mirror is the only source, don't attempt the API.
    if (!apiKey()) return findOrderRecord(PLATFORM, orderId);

    try {
      const raw = await call<Record<string, unknown>>("getPurchase", [orderId]);
      if (!raw || Object.keys(raw).length === 0) {
        return findOrderRecord(PLATFORM, orderId);
      }
      return digistore24ToOrder(raw, orderId);
    } catch (err) {
      // 404 / "not found" from the live API doesn't rule the order out — it may
      // predate API access but still be in the mirror. Check there before
      // declaring it unknown.
      if (err instanceof PlatformError && !isNotFound(err)) {
        console.error("[digistore24] getOrder failed, trying local mirror", err);
      }
      return findOrderRecord(PLATFORM, orderId);
    }
  },

  async listOpenTickets(orderId: string): Promise<SupportTicket[]> {
    if (isMockMode()) {
      await mockDelay(150);
      return mockOpenTickets(orderId);
    }
    // Digistore24 has no public support-ticket API; the chat itself is the
    // ticket. Open-conversation detection is handled by our own database.
    return [];
  },

  async createRefund(order: Order): Promise<RefundOutcome> {
    if (isMockMode()) {
      await mockDelay(600);
      return { mode: "api", reference: `mock-ds-${order.orderId}` };
    }

    if (!apiRefundEnabled()) {
      throw new UnsupportedOperationError(
        PLATFORM,
        "createRefund (set DIGISTORE24_ENABLE_API_REFUND=true once verified)",
      );
    }

    const raw = await call<Record<string, unknown>>("refundPurchase", [
      order.orderId,
    ]);
    await markOrderRecordRefunded(PLATFORM, order.orderId);
    return {
      mode: "api",
      reference: pickString(raw ?? {}, "refund_id", "id", "purchase_id"),
    };
  },
};

function isNotFound(err: PlatformError): boolean {
  if (err.status === 404) return true;
  return /not.?found|unknown purchase|no such/i.test(err.message + err.body);
}
