import { NextResponse } from "next/server";
import { buygoodsToOrder } from "@/lib/platforms/buygoods";
import { digistore24ToOrder } from "@/lib/platforms/digistore24";
import {
  isJvzooReversal,
  jvzooToOrder,
  verifyJvzooSignature,
} from "@/lib/platforms/jvzoo";
import {
  isPlatformId,
  markOrderRecordRefunded,
  saveOrderRecord,
  type Order,
  type PlatformId,
} from "@/lib/platforms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sale notifications from each platform, mirrored into `OrderRecord` so the
 * support agent can resolve an order number later.
 *
 * URLs to configure on each platform:
 *   JVZoo       → https://<domain>/api/webhooks/jvzoo            (signed with JVZOO_SECRET_KEY)
 *   BuyGoods    → https://<domain>/api/webhooks/buygoods?token=<WEBHOOK_SHARED_SECRET>
 *   Digistore24 → https://<domain>/api/webhooks/digistore24?token=<WEBHOOK_SHARED_SECRET>
 *
 * Always answers 200 to a *valid* notification, even when we choose to ignore
 * the event — platforms retry or disable endpoints that return errors.
 */
export async function POST(
  req: Request,
  { params }: { params: { platform: string } },
) {
  const platform = params.platform.toLowerCase();
  if (!isPlatformId(platform)) {
    return NextResponse.json({ error: "Unknown platform." }, { status: 404 });
  }

  const rawBody = await req.text();
  const fields = parseBody(rawBody, req.headers.get("content-type"));

  if (!verify(platform, req, fields)) {
    console.warn(`[webhook/${platform}] rejected: signature/token mismatch`);
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let order: Order | null = null;
  let isReversal = false;

  try {
    if (platform === "jvzoo") {
      order = jvzooToOrder(fields);
      isReversal = isJvzooReversal(fields.ctransaction ?? null);
    } else if (platform === "buygoods") {
      order = buygoodsToOrder(fields as unknown as Record<string, unknown>, "");
      isReversal = /refund|chargeback|reversal/i.test(
        fields.event ?? fields.status ?? fields.transaction_type ?? "",
      );
    } else {
      order = digistore24ToOrder(fields as unknown as Record<string, unknown>, "");
      isReversal = /refund|chargeback/i.test(
        fields.event ?? fields.billing_status ?? "",
      );
    }
  } catch (err) {
    console.error(`[webhook/${platform}] could not map payload`, err);
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  if (!order?.orderId) {
    console.warn(
      `[webhook/${platform}] payload had no order id — ignoring`,
      Object.keys(fields).join(","),
    );
    return NextResponse.json({ ok: true, ignored: "no order id" });
  }

  try {
    await saveOrderRecord({ ...order, raw: fields });
    if (isReversal) await markOrderRecordRefunded(platform, order.orderId);
  } catch (err) {
    // 500 here makes the platform retry, which is what we want: the mirror is
    // the only copy of this data.
    console.error(`[webhook/${platform}] persist failed`, err);
    return NextResponse.json({ error: "Storage error." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, orderId: order.orderId });
}

function parseBody(
  rawBody: string,
  contentType: string | null,
): Record<string, string> {
  const type = (contentType ?? "").toLowerCase();

  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      const flat: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (value === null || value === undefined) continue;
        flat[key] =
          typeof value === "object" ? JSON.stringify(value) : String(value);
      }
      return flat;
    } catch {
      return {};
    }
  }

  // form-urlencoded (JVZIPN and most postbacks)
  const params = new URLSearchParams(rawBody);
  return Object.fromEntries(params.entries());
}

function verify(
  platform: PlatformId,
  req: Request,
  fields: Record<string, string>,
): boolean {
  if (platform === "jvzoo") {
    const secret = process.env.JVZOO_SECRET_KEY?.trim();
    if (!secret) {
      console.error("[webhook/jvzoo] JVZOO_SECRET_KEY is not set");
      return false;
    }
    return verifyJvzooSignature(fields, secret);
  }

  // BuyGoods and Digistore24: shared token in the URL or a header. Platforms
  // that later gain a real signature can be moved above.
  const expected = process.env.WEBHOOK_SHARED_SECRET?.trim();
  if (!expected) {
    console.error("[webhook] WEBHOOK_SHARED_SECRET is not set");
    return false;
  }

  const provided =
    new URL(req.url).searchParams.get("token") ??
    req.headers.get("x-webhook-token") ??
    "";

  return timingSafeEqual(provided, expected);
}

/** Constant-time compare so the token can't be guessed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
