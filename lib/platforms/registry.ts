import { buygoodsAdapter } from "./buygoods";
import { digistore24Adapter } from "./digistore24";
import { jvzooAdapter } from "./jvzoo";
import { isMockMode, mockOrderForEmail } from "./mock";
import { findOrderRecordsByEmail } from "./orderStore";
import {
  isConfigured,
  isPlatformId,
  PLATFORM_IDS,
  type Order,
  type PlatformAdapter,
  type PlatformId,
} from "./types";

const ALL_ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  buygoods: buygoodsAdapter,
  digistore24: digistore24Adapter,
  jvzoo: jvzooAdapter,
};

/**
 * Which platforms this deployment serves, in lookup priority order.
 * Controlled by `PLATFORMS=buygoods,digistore24,jvzoo`. Unset means all three.
 */
export function enabledPlatformIds(): PlatformId[] {
  const raw = (process.env.PLATFORMS ?? "").trim();
  if (!raw) return [...PLATFORM_IDS];

  const requested = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(isPlatformId);

  return requested.length > 0 ? requested : [...PLATFORM_IDS];
}

export function getAdapter(platform: string): PlatformAdapter | null {
  if (!isPlatformId(platform)) return null;
  return ALL_ADAPTERS[platform];
}

export function allAdapters(): PlatformAdapter[] {
  return PLATFORM_IDS.map((id) => ALL_ADAPTERS[id]);
}

/** Enabled *and* ready to answer (credentials present, or mock mode). */
export function enabledAdapters(): PlatformAdapter[] {
  return enabledPlatformIds()
    .map((id) => ALL_ADAPTERS[id])
    .filter((adapter) => isMockMode() || isConfigured(adapter));
}

export interface OrderLookup {
  order: Order;
  adapter: PlatformAdapter;
}

/**
 * Auto-detection: ask every enabled platform about this order id at the same
 * time and keep the first hit, following the configured priority order so the
 * result is deterministic even if two platforms answer.
 *
 * One slow or broken platform can neither block nor break the lookup — each
 * adapter is isolated and failures are logged, not thrown.
 */
export async function findOrder(orderId: string): Promise<OrderLookup | null> {
  const trimmed = orderId.trim();
  if (!trimmed) return null;

  const adapters = enabledAdapters();
  if (adapters.length === 0) return null;

  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const order = await adapter.getOrder(trimmed);
        return order ? { order, adapter } : null;
      } catch (err) {
        console.error(`[registry] ${adapter.id} lookup failed`, err);
        return null;
      }
    }),
  );

  return results.find((result): result is OrderLookup => result !== null) ?? null;
}

/**
 * The email-first entry point: find this customer's most recent purchase.
 *
 * Only the webhook mirror can answer a customer-wide question — no platform
 * offers "list orders for this email". When the owning platform *does* have a
 * live lookup, the mirrored id is re-resolved through it so the agent sees the
 * current state (refunded, chargeback) rather than whatever the webhook said
 * at purchase time.
 *
 * Returns null when nothing is mirrored for that address. That is not an
 * error: the caller still lets the customer through to support.
 */
export async function findOrderByEmail(
  email: string,
): Promise<OrderLookup | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;

  const enabled = new Set(enabledPlatformIds());

  // Mock mode has no webhook mirror to read, so the fake data answers instead.
  if (isMockMode()) {
    const mocked = mockOrderForEmail(trimmed);
    if (mocked && enabled.has(mocked.platform)) {
      return { order: mocked, adapter: ALL_ADAPTERS[mocked.platform] };
    }
  }

  const records = await findOrderRecordsByEmail(trimmed);
  const record = records.find((order) => enabled.has(order.platform));
  if (!record) return null;

  const adapter = ALL_ADAPTERS[record.platform];

  if (adapter.capabilities.lookupOrder) {
    try {
      const live = await adapter.getOrder(record.orderId);
      if (live) return { order: live, adapter };
    } catch (err) {
      console.error(`[registry] ${adapter.id} refresh failed, using mirror`, err);
    }
  }

  return { order: record, adapter };
}

export interface PlatformStatus {
  id: PlatformId;
  label: string;
  enabled: boolean;
  ready: boolean;
  orderSource: PlatformAdapter["orderSource"];
  capabilities: PlatformAdapter["capabilities"];
  /** Env vars whose absence makes the adapter unusable. */
  missingEnv: string[];
  /** Reduced-capability warnings — the adapter still works. */
  notes: string[];
  /** True when refunds for this platform go to the manual admin queue. */
  refundsGoToQueue: boolean;
}

export function platformStatuses(): PlatformStatus[] {
  const enabled = new Set(enabledPlatformIds());

  return allAdapters().map((adapter) => {
    const missingEnv = adapter.missingEnv();
    const ready = isMockMode() || missingEnv.length === 0;
    return {
      id: adapter.id,
      label: adapter.label,
      enabled: enabled.has(adapter.id),
      ready,
      orderSource: adapter.orderSource,
      capabilities: adapter.capabilities,
      missingEnv,
      notes: adapter.notes?.() ?? [],
      refundsGoToQueue: !adapter.capabilities.createRefund,
    };
  });
}
