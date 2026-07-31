import { NextResponse } from "next/server";
import { devDetail, getAdapter, isPlatformId } from "@/lib/platforms";
import { markConversationOutcome } from "@/lib/logging";
import { processRefund } from "@/lib/refunds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const orderId = String(body.orderId ?? body.receipt ?? "").trim();
    const platform = String(body.platform ?? "").trim().toLowerCase();
    const conversationId = String(body.conversationId ?? "").trim() || null;

    if (orderId.length < 4) {
      return NextResponse.json(
        { error: "Order number is required." },
        { status: 400 },
      );
    }
    if (!isPlatformId(platform)) {
      return NextResponse.json(
        { error: "Unknown platform." },
        { status: 400 },
      );
    }

    const adapter = getAdapter(platform);
    const order = await adapter?.getOrder(orderId);
    if (!order) {
      return NextResponse.json(
        { error: "We couldn't find that order anymore. Please contact support." },
        { status: 404 },
      );
    }

    // Never throws for platform reasons: anything the API can't do becomes a
    // queued request for a human. See lib/refunds.ts.
    const outcome = await processRefund(order, { conversationId });
    await markConversationOutcome(orderId, "refund_issued", platform);

    return NextResponse.json({ ok: true, mode: outcome.mode });
  } catch (err) {
    console.error("[create-refund] unexpected", err);
    return NextResponse.json(
      {
        error: "Could not submit refund request.",
        detail: devDetail(err),
      },
      { status: 500 },
    );
  }
}
