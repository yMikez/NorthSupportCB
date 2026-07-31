import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdapter, platformStatuses } from "@/lib/platforms";
import { listRefundRequests } from "@/lib/refunds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["pending", "processed", "failed", "cancelled", "all"] as const;
type Status = (typeof VALID_STATUSES)[number];

function isStatus(value: string): value is Status {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

/** Refunds the agent approved that a human still has to execute. */
export async function GET(req: Request) {
  const secret = process.env.ADMIN_SECRET;
  const cookie = cookies().get("admin_auth")?.value;
  if (!secret || cookie !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = (searchParams.get("status") ?? "pending").toLowerCase();
  const status: Status = isStatus(statusParam) ? statusParam : "pending";

  try {
    const rows = await listRefundRequests(status, 200);

    return NextResponse.json({
      status,
      total: rows.length,
      refunds: rows.map((row) => ({
        ...row,
        // Handoff rows have no platform while the stores aren't connected.
        platformLabel: row.platform
          ? (getAdapter(row.platform)?.label ?? row.platform)
          : "",
        createdAt: row.createdAt.toISOString(),
        processedAt: row.processedAt ? row.processedAt.toISOString() : null,
      })),
      platforms: platformStatuses().map((p) => ({
        id: p.id,
        label: p.label,
        refundsGoToQueue: p.refundsGoToQueue,
      })),
    });
  } catch (err) {
    console.error("[admin/refunds]", err);
    return NextResponse.json(
      { error: "Could not load the refund queue." },
      { status: 500 },
    );
  }
}
