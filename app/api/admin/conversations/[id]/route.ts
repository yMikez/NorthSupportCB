import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const secret = process.env.ADMIN_SECRET;
  const cookie = cookies().get("admin_auth")?.value;
  if (!secret || cookie !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: params.id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });

    if (!conv) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    return NextResponse.json({
      id: conv.id,
      receipt: conv.receipt,
      vendor: conv.vendor,
      productTitle: conv.productTitle,
      customerName: conv.customerName,
      customerEmail: conv.customerEmail,
      refundAmount: conv.refundAmount ? Number(conv.refundAmount) : null,
      currency: conv.currency,
      startedAt: conv.startedAt,
      endedAt: conv.endedAt,
      lastActivityAt: conv.lastActivityAt,
      initialMood: conv.initialMood,
      outcome: conv.outcome,
      retentionAttempts: conv.retentionAttempts,
      messages: conv.messages,
    });
  } catch (err) {
    console.error("[admin/conversations/[id]]", err);
    return NextResponse.json(
      { error: "Could not load conversation." },
      { status: 500 },
    );
  }
}
