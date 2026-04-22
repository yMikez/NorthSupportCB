import { NextResponse } from "next/server";
import {
  ClickBankError,
  devDetail,
  getOrder,
  getRefundAmount,
} from "@/lib/clickbank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const receipt = String(body.receipt ?? "").trim();

    if (receipt.length < 4) {
      return NextResponse.json(
        { error: "Receipt must be at least 4 characters." },
        { status: 400 },
      );
    }

    const order = await getOrder(receipt);

    let refundAmount = Number(order.totalOrderAmount) || 0;
    let currency = order.currency || "USD";

    if (!refundAmount) {
      try {
        const refund = await getRefundAmount(receipt);
        refundAmount = Number(refund.refundAmount) || 0;
        currency = refund.currency || currency;
      } catch {
        /* keep order total (which is 0 here — UI will still show $0.00) */
      }
    }

    return NextResponse.json({
      receipt,
      refundAmount,
      currency,
      vendor: order.vendor,
      firstName: order.firstName,
      productTitle: order.productTitle,
    });
  } catch (err) {
    if (err instanceof ClickBankError) {
      // eslint-disable-next-line no-console
      console.error("[refund-amount]", err.status, err.body.slice(0, 500));
      const msg =
        err.status === 401
          ? "Your ClickBank API key is not authorized. Please check CLICKBANK_API_KEY_READ."
          : err.status === 403
            ? "Your ClickBank API key is missing the required role (API Order Read Role)."
            : err.status === 404
              ? "Receipt not found. Please check the number and try again."
              : "Unable to fetch order details from ClickBank.";
      return NextResponse.json(
        { error: msg, detail: devDetail(err) },
        { status: err.status === 404 ? 404 : 502 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[refund-amount] unexpected", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
