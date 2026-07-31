import { pickNumber, pickString, platformFetch } from "./http";
import { isMockMode, mockDelay, mockGetOrder, mockOpenTickets } from "./mock";
import { findOrderRecord } from "./orderStore";
import { resolveVendor } from "./vendorMap";
import {
  PlatformError,
  UnsupportedOperationError,
  type Order,
  type PlatformAdapter,
  type RefundOutcome,
  type SupportTicket,
} from "./types";

const PLATFORM = "buygoods" as const;

/**
 * BuyGoods adapter — webhook-first.
 *
 * BuyGoods does not publish an open REST reference, but it does let a vendor
 * configure a postback/webhook URL for every sale. So the reliable path is:
 *
 *   BuyGoods sale → POST /api/webhooks/buygoods → OrderRecord row → lookup works
 *
 * That needs no API key at all and you can turn it on today. Point BuyGoods'
 * postback at:
 *
 *   https://<your-domain>/api/webhooks/buygoods?token=<WEBHOOK_SHARED_SECRET>
 *
 * ┌─ OPTIONAL: direct API lookup ───────────────────────────────────────────┐
 * │ If your BuyGoods account manager gives you REST credentials, set        │
 * │ BUYGOODS_API_BASE + BUYGOODS_API_KEY and fill in `fetchOrderFromApi`    │
 * │ below. Until then the mirror above answers every lookup, so leaving     │
 * │ this unimplemented costs nothing.                                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

function apiKey(): string | undefined {
  return process.env.BUYGOODS_API_KEY?.trim() || undefined;
}

function apiBase(): string | undefined {
  return process.env.BUYGOODS_API_BASE?.trim() || undefined;
}

function apiRefundEnabled(): boolean {
  const value = process.env.BUYGOODS_ENABLE_API_REFUND;
  return value === "true" || value === "1";
}

/** Normalizes either an API payload or a webhook payload into an `Order`. */
export function buygoodsToOrder(
  raw: Record<string, unknown>,
  fallbackOrderId: string,
): Order {
  const productId = pickString(raw, "product_id", "productId", "product_code", "campaign_id");
  const productTitle = pickString(raw, "product_name", "productName", "product", "campaign_name");

  return {
    platform: PLATFORM,
    orderId:
      pickString(raw, "order_id", "orderId", "transaction_id", "id") ??
      fallbackOrderId,
    vendor: resolveVendor(PLATFORM, productId, productTitle),
    productId,
    productTitle,
    firstName: pickString(raw, "first_name", "firstName", "customer_first_name"),
    lastName: pickString(raw, "last_name", "lastName", "customer_last_name"),
    email: pickString(raw, "email", "customer_email", "buyer_email"),
    amount: pickNumber(raw, "amount", "total", "order_total", "price"),
    currency: pickString(raw, "currency", "currency_code") ?? "USD",
    purchaseDate: pickString(raw, "order_date", "created_at", "date", "timestamp"),
    status: pickString(raw, "status", "order_status", "transaction_type"),
  };
}

async function fetchOrderFromApi(orderId: string): Promise<Order | null> {
  const base = apiBase();
  const key = apiKey();
  if (!base || !key) return null;

  try {
    const raw = await platformFetch<Record<string, unknown>>(
      PLATFORM,
      `${base.replace(/\/$/, "")}/orders/${encodeURIComponent(orderId)}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    if (!raw || Object.keys(raw).length === 0) return null;
    // Some APIs wrap the payload; unwrap the common shapes.
    const root =
      (raw.order as Record<string, unknown> | undefined) ??
      (raw.data as Record<string, unknown> | undefined) ??
      raw;
    return buygoodsToOrder(root, orderId);
  } catch (err) {
    if (err instanceof PlatformError && err.status === 404) return null;
    console.error("[buygoods] API lookup failed", err);
    return null;
  }
}

export const buygoodsAdapter: PlatformAdapter = {
  id: PLATFORM,
  label: "BuyGoods",
  orderSource: "webhook",
  capabilities: {
    lookupOrder: true,
    listTickets: false,
    createRefund: false,
  },

  missingEnv() {
    // The webhook mirror needs no credentials, so the adapter is always usable.
    return [];
  },

  notes() {
    if (isMockMode()) return [];
    const out: string[] = [];
    if (!apiBase() || !apiKey()) {
      out.push(
        "No REST credentials — orders resolve from the postback mirror only, so purchases made before the webhook was configured cannot be found.",
      );
    }
    if (!apiRefundEnabled()) {
      out.push(
        "API refunds are off — approved refunds go to the /admin queue instead.",
      );
    }
    return out;
  },

  async getOrder(orderId: string): Promise<Order | null> {
    if (isMockMode()) {
      await mockDelay(250);
      return mockGetOrder(PLATFORM, orderId);
    }

    const mirrored = await findOrderRecord(PLATFORM, orderId);
    if (mirrored) return mirrored;

    return fetchOrderFromApi(orderId);
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
      await mockDelay(600);
      return { mode: "api", reference: `mock-bg-${order.orderId}` };
    }

    if (!apiRefundEnabled() || !apiBase() || !apiKey()) {
      throw new UnsupportedOperationError(
        PLATFORM,
        "createRefund (needs BUYGOODS_API_BASE + BUYGOODS_API_KEY + BUYGOODS_ENABLE_API_REFUND=true)",
      );
    }

    const raw = await platformFetch<Record<string, unknown>>(
      PLATFORM,
      `${apiBase()!.replace(/\/$/, "")}/orders/${encodeURIComponent(order.orderId)}/refund`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey()!}` },
        contentType: "application/json",
        body: JSON.stringify({ reason: "Customer requested refund via support chat" }),
      },
    );

    return {
      mode: "api",
      reference: pickString(raw ?? {}, "refund_id", "id"),
    };
  },
};
