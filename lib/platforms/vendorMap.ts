import { toVendorSlug } from "./http";
import type { PlatformId } from "./types";

/**
 * Decides which file in `knowledge/` an order should load.
 *
 * Every platform names products differently (Digistore24 has numeric product
 * ids, JVZoo has product ids per seller, BuyGoods uses campaign names), so the
 * mapping is explicit and lives in one env var:
 *
 *   PRODUCT_VENDOR_MAP="digistore24:534210=burnthermo,jvzoo:99812=glycopulse,buygoods:thermo-burn-us=burnthermo"
 *
 * Entries are `platform:productId=vendorSlug`. `platform:` may be omitted to
 * match the product id on any platform. When nothing matches, the product
 * title is slugified — so `Thermo Burn` also finds `knowledge/thermoburn.md`.
 */

interface MapEntry {
  platform: PlatformId | null;
  productId: string;
  vendor: string;
}

let cachedRaw: string | undefined;
let cachedEntries: MapEntry[] = [];

function parseMap(): MapEntry[] {
  const raw = process.env.PRODUCT_VENDOR_MAP ?? "";
  if (raw === cachedRaw) return cachedEntries;

  const entries: MapEntry[] = [];
  for (const chunk of raw.split(/[,;\n]/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const left = trimmed.slice(0, eq).trim();
    const vendor = toVendorSlug(trimmed.slice(eq + 1));
    if (!vendor) continue;

    const colon = left.indexOf(":");
    if (colon === -1) {
      entries.push({ platform: null, productId: left.toLowerCase(), vendor });
    } else {
      entries.push({
        platform: left.slice(0, colon).trim().toLowerCase() as PlatformId,
        productId: left.slice(colon + 1).trim().toLowerCase(),
        vendor,
      });
    }
  }

  cachedRaw = raw;
  cachedEntries = entries;
  return entries;
}

export function resolveVendor(
  platform: PlatformId,
  productId: string | null | undefined,
  productTitle: string | null | undefined,
): string | null {
  const id = (productId ?? "").trim().toLowerCase();

  if (id) {
    const entries = parseMap();
    const exact = entries.find(
      (e) => e.productId === id && (e.platform === null || e.platform === platform),
    );
    if (exact) return exact.vendor;
  }

  return toVendorSlug(productTitle);
}

/** Vendor slugs referenced by the map — used to populate the admin filter. */
export function mappedVendors(): string[] {
  return Array.from(new Set(parseMap().map((e) => e.vendor))).sort();
}
