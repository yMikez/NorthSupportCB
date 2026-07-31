import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { updateRefundStatus } from "@/lib/refunds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = ["processed", "failed", "cancelled"] as const;
type AllowedStatus = (typeof ALLOWED)[number];

function isAllowed(value: string): value is AllowedStatus {
  return (ALLOWED as readonly string[]).includes(value);
}

/** Operator marks a queued refund as done (or failed / cancelled). */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const secret = process.env.ADMIN_SECRET;
  const cookie = cookies().get("admin_auth")?.value;
  if (!secret || cookie !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const status = String(body.status ?? "processed").toLowerCase();
  const note = body.note ? String(body.note).slice(0, 500) : null;

  if (!isAllowed(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED.join(", ")}` },
      { status: 400 },
    );
  }

  const ok = await updateRefundStatus(params.id, status, note);
  if (!ok) {
    return NextResponse.json(
      { error: "Refund request not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, status });
}
