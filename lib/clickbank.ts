import {
  isMockMode,
  mockDelay,
  mockOpenTickets,
  mockRefundAmount,
  mockTicketsByReceipt,
} from "./mock";

const BASE_URL = "https://api.clickbank.com/rest/1.3";

export type TicketStatus = "open" | "closed" | "reopened" | string;
export type TicketType = "REFUND" | "CANCEL" | "TECH_SUPPORT" | string;

export interface ClickBankTicket {
  ticketId: string;
  receipt: string;
  type: TicketType;
  status: TicketStatus;
  openedDate: string;
  vendor?: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail?: string;
  description?: string;
}

export interface RefundAmountResponse {
  receipt: string;
  refundAmount: number;
  currency: string;
}

export interface OrderDetails {
  receipt: string;
  vendor?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  totalOrderAmount: number;
  currency: string;
  transactionTime?: string;
  productTitle?: string;
  itemNo?: string;
  status?: string;
}

export interface ProductDetails {
  itemNo: string;
  vendor?: string;
  title?: string;
  description?: string;
  productType?: string;
  productCategory?: string;
  currency?: string;
  price?: number;
  recurring?: boolean;
}

export class ClickBankError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`ClickBank API error ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

type AuthMode = "read" | "write";

function buildAuthHeader(mode: AuthMode): string {
  const envName =
    mode === "read" ? "CLICKBANK_API_KEY_READ" : "CLICKBANK_API_KEY_WRITE";
  const key = process.env[envName];
  if (!key) throw new Error(`${envName} is not configured`);
  return key;
}

async function clickbankFetch<T>(
  path: string,
  opts: {
    method?: string;
    auth: AuthMode;
    query?: Record<string, string>;
    body?: string;
    contentType?: string;
  },
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, v);
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(opts.auth),
    Accept: "application/json",
  };
  if (opts.contentType) headers["Content-Type"] = opts.contentType;

  const method = opts.method ?? "GET";
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body,
    cache: "no-store",
  });

  const text = await res.text();

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(
      `[clickbank] ${method} ${url.pathname}${url.search} → ${res.status}`,
    );
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(
        `[clickbank] ERROR body:`,
        text.slice(0, 800) || "(empty)",
      );
    }
  }

  if (!res.ok) throw new ClickBankError(res.status, text);

  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

function normalizeTickets(raw: unknown): ClickBankTicket[] {
  if (!raw || typeof raw !== "object") return [];

  const rootUnknown = (raw as { ticketData?: unknown }).ticketData ?? raw;
  const ticketField =
    rootUnknown && typeof rootUnknown === "object"
      ? (rootUnknown as { ticket?: unknown }).ticket
      : undefined;

  let list: unknown[];
  if (Array.isArray(rootUnknown)) {
    list = rootUnknown;
  } else if (ticketField) {
    list = Array.isArray(ticketField) ? ticketField : [ticketField];
  } else {
    list = [rootUnknown];
  }

  return list
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => ({
      ticketId: String(t.ticketId ?? t.ticketid ?? t.id ?? ""),
      receipt: String(t.receipt ?? ""),
      type: String(t.type ?? t.ticketType ?? "") as TicketType,
      status: String(t.status ?? "") as TicketStatus,
      openedDate: String(t.openedDate ?? t.opened ?? ""),
      vendor:
        (t.vendor as string | undefined) ??
        (t.vendorAccount as string | undefined),
      customerFirstName: t.customerFirstName as string | undefined,
      customerLastName: t.customerLastName as string | undefined,
      customerEmail:
        (t.customerEmail as string | undefined) ??
        (t.email as string | undefined),
      description: t.description as string | undefined,
    }))
    .filter((t) => t.ticketId);
}

export async function listTicketsByReceipt(
  receipt: string,
): Promise<ClickBankTicket[]> {
  if (isMockMode()) {
    await mockDelay(300);
    return mockTicketsByReceipt(receipt);
  }
  const raw = await clickbankFetch<unknown>(`/tickets/list`, {
    auth: "read",
    query: { receipt },
  });
  return normalizeTickets(raw);
}

export async function listOpenTickets(): Promise<ClickBankTicket[]> {
  if (isMockMode()) {
    await mockDelay(250);
    return mockOpenTickets();
  }
  const raw = await clickbankFetch<unknown>(`/tickets/list`, {
    auth: "read",
    query: { status: "open" },
  });
  return normalizeTickets(raw);
}

export async function getRefundAmount(
  receipt: string,
): Promise<RefundAmountResponse> {
  if (isMockMode()) {
    await mockDelay(400);
    const result = mockRefundAmount(receipt);
    if ("notFound" in result) {
      throw new ClickBankError(404, "Mock: receipt not found");
    }
    return result;
  }

  const raw = await clickbankFetch<Record<string, unknown>>(
    `/tickets/refundAmounts/${encodeURIComponent(receipt)}`,
    { auth: "read", query: { refundType: "FULL" } },
  );

  const root =
    (raw.partialRefundData as Record<string, unknown> | undefined) ?? raw;

  const amount =
    (root.refundAmount as number | undefined) ??
    (root.amount as number | undefined) ??
    (root.totalRefund as number | undefined) ??
    Number((root as { FULL?: number }).FULL ?? 0);

  const currency = (root.currency as string | undefined) ?? "USD";

  return {
    receipt,
    refundAmount: Number(amount) || 0,
    currency,
  };
}

export async function getOrder(receipt: string): Promise<OrderDetails> {
  const raw = await clickbankFetch<Record<string, unknown>>(
    `/orders2/${encodeURIComponent(receipt)}`,
    { auth: "read" },
  );

  const root =
    (raw.orderData as Record<string, unknown> | undefined) ?? raw;

  const lineItemsField =
    (root.lineItemData as unknown) ?? (root.lineItem as unknown);
  let firstLine: Record<string, unknown> = {};
  if (Array.isArray(lineItemsField) && lineItemsField.length > 0) {
    firstLine = lineItemsField[0] as Record<string, unknown>;
  } else if (lineItemsField && typeof lineItemsField === "object") {
    firstLine = lineItemsField as Record<string, unknown>;
  }

  return {
    receipt: String(root.receipt ?? receipt),
    vendor:
      (root.vendor as string | undefined) ??
      (root.vendorAccount as string | undefined),
    firstName: root.firstName as string | undefined,
    lastName: root.lastName as string | undefined,
    email:
      (root.email as string | undefined) ??
      (root.customerEmail as string | undefined),
    totalOrderAmount: Number(root.totalOrderAmount ?? root.amount ?? 0),
    currency: (root.currency as string | undefined) ?? "USD",
    transactionTime: root.transactionTime as string | undefined,
    productTitle: firstLine.productTitle as string | undefined,
    itemNo: firstLine.itemNo as string | undefined,
    status: firstLine.status as string | undefined,
  };
}

export async function getProduct(
  vendor: string,
  itemNo: string,
): Promise<ProductDetails> {
  const raw = await clickbankFetch<Record<string, unknown>>(
    `/products/${encodeURIComponent(vendor)}/${encodeURIComponent(itemNo)}`,
    { auth: "read" },
  );

  const root =
    (raw.product as Record<string, unknown> | undefined) ??
    (raw.productData as Record<string, unknown> | undefined) ??
    raw;

  return {
    itemNo: String(root.itemNo ?? root.sku ?? itemNo),
    vendor: (root.vendor as string | undefined) ?? vendor,
    title:
      (root.title as string | undefined) ??
      (root.productTitle as string | undefined) ??
      (root.name as string | undefined),
    description: root.description as string | undefined,
    productType:
      (root.productType as string | undefined) ??
      (root.type as string | undefined),
    productCategory: root.productCategory as string | undefined,
    currency: (root.currency as string | undefined) ?? "USD",
    price: root.price !== undefined ? Number(root.price) : undefined,
    recurring: Boolean(root.recurring ?? false),
  };
}

export async function listProducts(vendor: string): Promise<ProductDetails[]> {
  const raw = await clickbankFetch<Record<string, unknown>>(
    `/products/list/${encodeURIComponent(vendor)}`,
    { auth: "read" },
  );

  const root =
    (raw.productData as unknown) ?? (raw.products as unknown) ?? raw;
  const productField =
    root && typeof root === "object" && !Array.isArray(root)
      ? (root as { product?: unknown }).product
      : undefined;

  let list: unknown[];
  if (Array.isArray(root)) list = root;
  else if (productField)
    list = Array.isArray(productField) ? productField : [productField];
  else list = [];

  return list
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      itemNo: String(p.itemNo ?? p.sku ?? ""),
      vendor: (p.vendor as string | undefined) ?? vendor,
      title:
        (p.title as string | undefined) ??
        (p.productTitle as string | undefined) ??
        (p.name as string | undefined),
      description: p.description as string | undefined,
      productType:
        (p.productType as string | undefined) ??
        (p.type as string | undefined),
      productCategory: p.productCategory as string | undefined,
      currency: (p.currency as string | undefined) ?? "USD",
      price: p.price !== undefined ? Number(p.price) : undefined,
      recurring: Boolean(p.recurring ?? false),
    }))
    .filter((p) => p.itemNo);
}

export async function createRefund(receipt: string): Promise<void> {
  if (isMockMode()) {
    await mockDelay(700);
    return;
  }

  const body = new URLSearchParams({
    type: "rfnd",
    refundType: "FULL",
    reason: "ticket.type.refund.2",
    comment: "Customer requested refund via support chat.",
  });

  await clickbankFetch<unknown>(`/tickets/${encodeURIComponent(receipt)}`, {
    method: "POST",
    auth: "write",
    body: body.toString(),
    contentType: "application/x-www-form-urlencoded",
  });

  try {
    const tickets = await listTicketsByReceipt(receipt);
    const refundTicket = tickets.find(
      (t) => isRefundTicket(t) && isOpenTicket(t),
    );
    if (refundTicket?.ticketId) {
      await markTicketReturned(refundTicket.ticketId);
    }
  } catch (err) {
    console.error(
      `[clickbank] auto mark-returned failed for receipt ${receipt}`,
      err,
    );
  }
}

export async function markTicketReturned(ticketId: string): Promise<void> {
  if (isMockMode()) {
    await mockDelay(500);
    return;
  }
  await clickbankFetch<unknown>(
    `/tickets/${encodeURIComponent(ticketId)}/returned`,
    { method: "POST", auth: "write" },
  );
}

export function isOpenTicket(t: ClickBankTicket): boolean {
  const s = (t.status || "").toLowerCase();
  return s === "open" || s === "reopened";
}

export function isRefundTicket(t: ClickBankTicket): boolean {
  return (t.type || "").toUpperCase() === "REFUND";
}

export function devDetail(err: ClickBankError): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return `ClickBank ${err.status}: ${err.body.slice(0, 300)}`;
}

export function getConfiguredVendors(): string[] {
  const raw = process.env.CLICKBANK_VENDORS ?? "";
  return raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}
