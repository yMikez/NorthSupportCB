import { NextResponse } from "next/server";
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

    await markConversationOutcome(receipt, "resolved");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[resolve-conversation]", err);
    return NextResponse.json(
      { error: "Could not resolve conversation." },
      { status: 500 },
    );
  }
}
