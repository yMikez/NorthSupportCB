import type { Order, PlatformId, SupportTicket } from "./types";

/**
 * Fake data so the whole flow (lookup → chat → refund → admin) can be exercised
 * before any real API key exists.
 *
 * Conventions for test order ids:
 *   prefix `DS…` → resolves on Digistore24   (e.g. DS12345)
 *   prefix `BG…` → resolves on BuyGoods      (e.g. BG12345)
 *   prefix `JV…` → resolves on JVZoo         (e.g. JV12345)
 *   no prefix     → resolves on Digistore24
 *
 *   contains OPEN or EXISTING → an open ticket already exists
 *   contains INVALID, NOTFOUND or REJECT → resolves nowhere (404 path)
 *
 * The customer-facing flow starts from an email address, so the same ids work
 * as the local part of one: `ds12345@example.com` resolves exactly what
 * `DS12345` resolves. Any other address is "no purchase mirrored" — which is a
 * supported path, not an error.
 */

export function isMockMode(): boolean {
  const value = process.env.MOCK_MODE;
  return value === "true" || value === "1";
}

export const MOCK_EXISTING_KEYWORDS = ["OPEN", "EXISTING"];
export const MOCK_INVALID_KEYWORDS = ["INVALID", "NOTFOUND", "REJECT"];

const PLATFORM_PREFIX: Record<string, PlatformId> = {
  DS: "digistore24",
  BG: "buygoods",
  JV: "jvzoo",
};

/** Vendors that have a knowledge file in `knowledge/`. */
const MOCK_VENDORS = ["burnthermo", "glycopulse", "maxvitaliz", "neurompro"];

const MOCK_PRODUCT_TITLES: Record<string, string> = {
  burnthermo: "Thermo Burn — 6 bottle bundle",
  glycopulse: "Glyco Pulse — 3 bottle bundle",
  maxvitaliz: "Max Vitaliz — 6 bottle bundle",
  neurompro: "Neurom Pro — 2 bottle bundle",
};

const MOCK_CUSTOMERS = [
  { firstName: "Ana", lastName: "Silva", email: "ana@example.com" },
  { firstName: "Bruno", lastName: "Costa", email: "bruno@example.com" },
  { firstName: "Clara", lastName: "Mendes", email: "clara@example.com" },
  { firstName: "Diego", lastName: "Rocha", email: "diego@example.com" },
];

function contains(orderId: string, keywords: string[]): boolean {
  const upper = orderId.toUpperCase();
  return keywords.some((keyword) => upper.includes(keyword));
}

/** Stable pseudo-random index derived from the order id, so tests are repeatable. */
function indexFor(orderId: string, buckets: number): number {
  let sum = 0;
  for (let i = 0; i < orderId.length; i++) sum += orderId.charCodeAt(i);
  return sum % buckets;
}

export function mockPlatformFor(orderId: string): PlatformId {
  const prefix = orderId.trim().slice(0, 2).toUpperCase();
  return PLATFORM_PREFIX[prefix] ?? "digistore24";
}

export function mockGetOrder(
  platform: PlatformId,
  orderId: string,
): Order | null {
  const trimmed = orderId.trim();
  if (!trimmed) return null;
  if (contains(trimmed, MOCK_INVALID_KEYWORDS)) return null;
  if (mockPlatformFor(trimmed) !== platform) return null;

  const vendor = MOCK_VENDORS[indexFor(trimmed, MOCK_VENDORS.length)];
  const customer = MOCK_CUSTOMERS[indexFor(trimmed, MOCK_CUSTOMERS.length)];
  const purchase = new Date();
  purchase.setDate(purchase.getDate() - (10 + indexFor(trimmed, 40)));

  return {
    platform,
    orderId: trimmed,
    vendor,
    productId: `${vendor}-006`,
    productTitle: MOCK_PRODUCT_TITLES[vendor] ?? vendor,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    amount: Math.round((49.99 + indexFor(trimmed, 5) * 10) * 100) / 100,
    currency: "USD",
    purchaseDate: purchase.toISOString(),
    status: "completed",
  };
}

/**
 * Mock counterpart to the email-first lookup.
 *
 * The local part of the address is read as an order id, so the documented test
 * ids keep working without a database behind them. Returns null for anything
 * else — that is the "we couldn't match a purchase" branch, which the flow
 * deliberately lets through.
 */
export function mockOrderForEmail(email: string): Order | null {
  const localPart = email.trim().split("@")[0]?.split("+")[0]?.trim();
  if (!localPart) return null;
  return mockGetOrder(mockPlatformFor(localPart), localPart);
}

export function mockOpenTickets(
  orderId: string,
): SupportTicket[] {
  if (!contains(orderId, MOCK_EXISTING_KEYWORDS)) return [];
  return [
    {
      ticketId: "9912",
      orderId,
      type: "REFUND",
      status: "open",
      openedDate: new Date().toISOString().slice(0, 10),
    },
  ];
}

export async function mockDelay(ms = 400): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
