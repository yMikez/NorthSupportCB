/**
 * Platform-agnostic domain types.
 *
 * Nothing outside `lib/platforms/*` should know that BuyGoods, Digistore24 or
 * JVZoo exist. Routes, the AI layer and the admin panel all speak `Order`,
 * `SupportTicket` and `RefundOutcome`.
 */

export const PLATFORM_IDS = ["buygoods", "digistore24", "jvzoo"] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export function isPlatformId(value: unknown): value is PlatformId {
  return (
    typeof value === "string" &&
    (PLATFORM_IDS as readonly string[]).includes(value)
  );
}

/** A purchase, normalized across every platform. */
export interface Order {
  platform: PlatformId;
  /** The identifier the customer types in. Called receipt/purchase id/transaction id depending on the platform. */
  orderId: string;
  /** Slug used to pick the knowledge file in `knowledge/`. */
  vendor: string | null;
  productId: string | null;
  productTitle: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  amount: number;
  currency: string;
  /** ISO-8601, or null when the platform does not report it. */
  purchaseDate: string | null;
  status: string | null;
}

/** An existing support/refund request already open on the platform side. */
export interface SupportTicket {
  ticketId: string;
  orderId: string;
  type: string;
  status: string;
  openedDate: string;
}

/**
 * How a refund was actually carried out.
 * - `api`    — the platform accepted it programmatically, money is on its way.
 * - `manual` — queued in the admin panel for a human to execute on the
 *              platform's dashboard. The customer is told the same thing
 *              either way; only the internal handling differs.
 */
export type RefundMode = "api" | "manual";

export interface RefundOutcome {
  mode: RefundMode;
  /** Platform-side id/confirmation, when there is one. */
  reference: string | null;
}

export interface PlatformCapabilities {
  /** Can we resolve an order id into an `Order`? */
  lookupOrder: boolean;
  /** Can we tell whether a support ticket is already open for this order? */
  listTickets: boolean;
  /** Can we issue the refund programmatically? If false, refunds are queued for a human. */
  createRefund: boolean;
}

/** Where an adapter gets its order data from. */
export type OrderSource =
  /** Live REST call to the platform. */
  | "api"
  /** Our own database, filled by the platform's webhook/IPN. */
  | "webhook";

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly label: string;
  readonly orderSource: OrderSource;
  readonly capabilities: PlatformCapabilities;

  /**
   * Env vars whose absence makes this adapter **unusable**. Empty array means
   * it can answer lookups. Credentials that merely unlock extra capability
   * (a live API on top of the webhook mirror, programmatic refunds) belong in
   * `notes()`, not here — listing them here would disable the adapter entirely.
   */
  missingEnv(): string[];

  /** Human-readable warnings about reduced capability. Shown by /api/diagnose. */
  notes?(): string[];

  /** Resolve an order id. Returns null when this platform simply doesn't know it. */
  getOrder(orderId: string): Promise<Order | null>;

  /** Open tickets for the order. Adapters without ticket APIs return []. */
  listOpenTickets(orderId: string): Promise<SupportTicket[]>;

  /**
   * Issue the refund on the platform.
   * Throws `UnsupportedOperationError` when the platform has no refund API —
   * callers translate that into the manual queue.
   */
  createRefund(order: Order): Promise<RefundOutcome>;
}

export class PlatformError extends Error {
  readonly platform: PlatformId;
  readonly status: number | null;
  readonly body: string;

  constructor(
    platform: PlatformId,
    message: string,
    opts: { status?: number | null; body?: string } = {},
  ) {
    super(`[${platform}] ${message}`);
    this.name = "PlatformError";
    this.platform = platform;
    this.status = opts.status ?? null;
    this.body = opts.body ?? "";
  }
}

export class UnsupportedOperationError extends PlatformError {
  constructor(platform: PlatformId, operation: string) {
    super(platform, `${operation} is not supported by this platform's API`);
    this.name = "UnsupportedOperationError";
  }
}

export function isConfigured(adapter: PlatformAdapter): boolean {
  return adapter.missingEnv().length === 0;
}

/** Only shown in development — never leak API bodies to customers in prod. */
export function devDetail(err: unknown): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  if (err instanceof PlatformError) {
    const status = err.status === null ? "—" : String(err.status);
    return `${err.platform} ${status}: ${err.body.slice(0, 300) || err.message}`;
  }
  return err instanceof Error ? err.message.slice(0, 300) : String(err);
}
