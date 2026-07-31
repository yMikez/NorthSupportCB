import { PlatformError, type PlatformId } from "./types";

export interface PlatformFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined | null>;
  /** Already-encoded body (JSON string or form-urlencoded string). */
  body?: string;
  contentType?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Shared HTTP helper for every platform adapter: consistent logging, timeout,
 * and error typing. Returns parsed JSON when the response is JSON, the raw
 * string otherwise.
 */
export async function platformFetch<T>(
  platform: PlatformId,
  url: string,
  opts: PlatformFetchOptions = {},
): Promise<T> {
  const target = new URL(url);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value === undefined || value === null || value === "") continue;
      target.searchParams.set(key, String(value));
    }
  }

  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...opts.headers,
  };
  if (opts.contentType) headers["Content-Type"] = opts.contentType;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let res: Response;
  let text: string;
  try {
    res = await fetch(target.toString(), {
      method,
      headers,
      body: opts.body,
      cache: "no-store",
      signal: controller.signal,
    });
    text = await res.text();
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "request timed out"
        : `network error: ${err instanceof Error ? err.message : String(err)}`;
    throw new PlatformError(platform, reason, { status: null });
  } finally {
    clearTimeout(timeout);
  }

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(
      `[${platform}] ${method} ${target.pathname}${target.search} → ${res.status}`,
    );
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(`[${platform}] error body:`, text.slice(0, 800) || "(empty)");
    }
  }

  if (!res.ok) {
    throw new PlatformError(platform, `HTTP ${res.status}`, {
      status: res.status,
      body: text,
    });
  }

  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Reads a record field trying several possible names, returning the first present one. */
export function pick(
  source: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export function pickString(
  source: Record<string, unknown>,
  ...keys: string[]
): string | null {
  const value = pick(source, ...keys);
  return value === undefined ? null : String(value);
}

export function pickNumber(
  source: Record<string, unknown>,
  ...keys: string[]
): number {
  const value = pick(source, ...keys);
  if (value === undefined) return 0;
  const parsed =
    typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Turns "Some Product Name" or "vendor_nick" into a knowledge-file slug. */
export function toVendorSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return slug || null;
}
