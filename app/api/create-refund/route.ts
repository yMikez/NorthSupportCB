import { NextResponse } from "next/server";
import { ClickBankError, createRefund, devDetail } from "@/lib/clickbank";
import { markConversationOutcome } from "@/lib/logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const receipt = String(body.receipt ?? "").trim();

    if (receipt.length < 4) {
      return NextResponse.json(
        { error: "Receipt is required." },
        { status: 400 },
      );
    }

    await createRefund(receipt);
    await markConversationOutcome(receipt, "refund_issued");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ClickBankError) {
      // eslint-disable-next-line no-console
      console.error("[create-refund]", err.status, err.body.slice(0, 500));
      const msg =
        err.status === 401
          ? "Your ClickBank API key is not authorized. Please check CLICKBANK_API_KEY_WRITE."
          : err.status === 403
            ? "Your ClickBank API key is missing the required role (API Order Write Role)."
            : err.status === 404
              ? "Receipt not found. Please check the number and try again."
              : "ClickBank rejected the refund request. Please contact support.";
      return NextResponse.json(
        { error: msg, detail: devDetail(err) },
        { status: err.status === 404 ? 404 : 502 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[create-refund] unexpected", err);
    return NextResponse.json(
      { error: "Could not submit refund request." },
      { status: 500 },
    );
  }
}
