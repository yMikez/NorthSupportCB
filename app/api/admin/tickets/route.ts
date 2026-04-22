import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ClickBankError,
  devDetail,
  getConfiguredVendors,
  listOpenTickets,
} from "@/lib/clickbank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const secret = process.env.ADMIN_SECRET;
  const cookie = cookies().get("admin_auth")?.value;
  if (!secret || cookie !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const tickets = await listOpenTickets();
    return NextResponse.json({ tickets, vendors: getConfiguredVendors() });
  } catch (err) {
    if (err instanceof ClickBankError) {
      // eslint-disable-next-line no-console
      console.error("[admin/tickets]", err.status, err.body.slice(0, 500));
      const msg =
        err.status === 401
          ? "Your ClickBank API key is not authorized. Please check CLICKBANK_API_KEY_READ."
          : err.status === 403
            ? "Your ClickBank API key is missing the required role (API Order Read Role)."
            : "Unable to load tickets from ClickBank.";
      return NextResponse.json(
        { error: msg, detail: devDetail(err) },
        { status: 502 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[admin/tickets] unexpected", err);
    return NextResponse.json(
      { error: "Could not load tickets." },
      { status: 500 },
    );
  }
}
