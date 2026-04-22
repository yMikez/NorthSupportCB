import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = "https://api.clickbank.com/rest/1.3";

type Check = {
  name: string;
  method: string;
  url: string;
  status: number | null;
  ok: boolean;
  bodyPreview: string;
  hint?: string;
};

async function probe(
  name: string,
  url: string,
  key: string,
  opts: { method?: string; body?: string; contentType?: string } = {},
): Promise<Check> {
  try {
    const headers: Record<string, string> = {
      Authorization: key,
      Accept: "application/json",
    };
    if (opts.contentType) headers["Content-Type"] = opts.contentType;

    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body,
      cache: "no-store",
    });
    const text = await res.text();
    return {
      name,
      method: opts.method ?? "GET",
      url,
      status: res.status,
      ok: res.ok,
      bodyPreview: text.slice(0, 600),
      hint: hintFor(res.status, text),
    };
  } catch (err) {
    return {
      name,
      method: opts.method ?? "GET",
      url,
      status: null,
      ok: false,
      bodyPreview: String(err),
      hint: "Network error reaching ClickBank",
    };
  }
}

function hintFor(status: number, body: string): string | undefined {
  if (status === 401)
    return "401 — your API key is invalid or not activated. Check it in ClickBank under Settings → API keys.";
  if (status === 403)
    return "403 — your API key is valid but is missing the required role (API Order Read / API Order Write).";
  if (status === 404)
    return "404 — receipt was not found in your vendor account. Try a receipt from your ClickBank dashboard.";
  if (status === 429) return "429 — rate limited (10/sec per IP).";
  if (status >= 500) return "5xx — ClickBank is having trouble; retry later.";
  if (body && body.trim().startsWith("<"))
    return "Response looks like XML/HTML — something is likely wrong with the Accept header or auth.";
  return undefined;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const receipt = (searchParams.get("receipt") || "").trim();

  const readKey = process.env.CLICKBANK_API_KEY_READ;
  const writeKey = process.env.CLICKBANK_API_KEY_WRITE;

  const env = {
    MOCK_MODE: process.env.MOCK_MODE ?? null,
    CLICKBANK_API_KEY_READ: readKey
      ? maskKey(readKey)
      : "(missing)",
    CLICKBANK_API_KEY_WRITE: writeKey
      ? maskKey(writeKey)
      : "(missing)",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "(missing)",
    ADMIN_SECRET: process.env.ADMIN_SECRET ? "set" : "(missing)",
    NODE_ENV: process.env.NODE_ENV,
  };

  const checks: Check[] = [];

  if (!readKey) {
    return NextResponse.json({
      env,
      checks: [],
      message: "CLICKBANK_API_KEY_READ is not set — nothing to test.",
    });
  }

  checks.push(
    await probe(
      "GET /tickets/list?status=open (list tickets, read role)",
      `${BASE_URL}/tickets/list?status=open`,
      readKey,
    ),
  );

  if (receipt) {
    checks.push(
      await probe(
        `GET /orders2/${receipt} (fetch order by receipt)`,
        `${BASE_URL}/orders2/${encodeURIComponent(receipt)}`,
        readKey,
      ),
    );
    checks.push(
      await probe(
        `GET /tickets/list?receipt=${receipt}`,
        `${BASE_URL}/tickets/list?receipt=${encodeURIComponent(receipt)}`,
        readKey,
      ),
    );
    checks.push(
      await probe(
        `GET /tickets/refundAmounts/${receipt}?refundType=FULL`,
        `${BASE_URL}/tickets/refundAmounts/${encodeURIComponent(
          receipt,
        )}?refundType=FULL`,
        readKey,
      ),
    );
  }

  return NextResponse.json(
    { env, receipt: receipt || null, checks },
    { status: 200 },
  );
}

function maskKey(k: string): string {
  if (k.length <= 10) return "***";
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}
