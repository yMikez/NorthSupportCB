import { NextResponse } from "next/server";
import { markConversationOutcome } from "@/lib/logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // The case key — an order id, or the customer's email when no purchase
    // could be matched to it.
    const caseKey = String(
      body.caseKey ?? body.orderId ?? body.receipt ?? "",
    ).trim();
    const platform = String(body.platform ?? "").trim().toLowerCase() || null;

    if (caseKey.length < 4) {
      return NextResponse.json(
        { error: "Please start over from the beginning." },
        { status: 400 },
      );
    }

    await markConversationOutcome(caseKey, "resolved", platform);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[resolve-conversation]", err);
    return NextResponse.json(
      { error: "Could not resolve conversation." },
      { status: 500 },
    );
  }
}
