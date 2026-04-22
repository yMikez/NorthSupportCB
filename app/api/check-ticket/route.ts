import { NextResponse } from "next/server";
import {
  ClickBankError,
  devDetail,
  isOpenTicket,
  listTicketsByReceipt,
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

    const tickets = await listTicketsByReceipt(receipt);
    const openTicket = tickets.find(isOpenTicket);

    if (openTicket) {
      return NextResponse.json({
        hasOpenTicket: true,
        ticket: {
          ticketId: openTicket.ticketId,
          type: openTicket.type,
          status: openTicket.status,
          openedDate: openTicket.openedDate,
          vendor: openTicket.vendor,
        },
      });
    }

    return NextResponse.json({ hasOpenTicket: false });
  } catch (err) {
    if (err instanceof ClickBankError) {
      // eslint-disable-next-line no-console
      console.error("[check-ticket]", err.status, err.body.slice(0, 500));
      const userMessage =
        err.status === 401
          ? "Your ClickBank API key is not authorized. Please check CLICKBANK_API_KEY_READ."
          : err.status === 403
            ? "Your ClickBank API key is missing the required role."
            : err.status === 404
              ? "Receipt not found."
              : "Unable to check ticket status with ClickBank.";
      return NextResponse.json(
        { error: userMessage, detail: devDetail(err) },
        { status: err.status === 404 ? 404 : 502 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[check-ticket] unexpected", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
