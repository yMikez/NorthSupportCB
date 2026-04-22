import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ClickBankError, devDetail, markTicketReturned } from "@/lib/clickbank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.ADMIN_SECRET;
  const cookie = cookies().get("admin_auth")?.value;
  if (!secret || cookie !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const ticketId = String(body.ticketId ?? "").trim();
    if (!ticketId) {
      return NextResponse.json(
        { error: "Ticket ID is required." },
        { status: 400 },
      );
    }

    await markTicketReturned(ticketId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ClickBankError) {
      // eslint-disable-next-line no-console
      console.error("[mark-returned]", err.status, err.body.slice(0, 500));
      const msg =
        err.status === 401
          ? "Your ClickBank API key is not authorized. Please check CLICKBANK_API_KEY_WRITE."
          : err.status === 403
            ? "Your ClickBank API key is missing the required role (API Order Write Role)."
            : err.status === 404
              ? "Ticket not found."
              : "ClickBank rejected the update.";
      return NextResponse.json(
        { error: msg, detail: devDetail(err) },
        { status: err.status === 404 ? 404 : 502 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[mark-returned] unexpected", err);
    return NextResponse.json(
      { error: "Could not update ticket." },
      { status: 500 },
    );
  }
}
