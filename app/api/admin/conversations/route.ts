import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getConfiguredVendors } from "@/lib/clickbank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

type Outcome = "in_progress" | "refund_issued" | "refund_abandoned" | "resolved";
type Mood = "unknown" | "calm" | "disappointed" | "angry";

const VALID_OUTCOMES: Outcome[] = [
  "in_progress",
  "refund_issued",
  "refund_abandoned",
  "resolved",
];
const VALID_MOODS: Mood[] = ["unknown", "calm", "disappointed", "angry"];

export async function GET(req: Request) {
  const secret = process.env.ADMIN_SECRET;
  const cookie = cookies().get("admin_auth")?.value;
  if (!secret || cookie !== secret) return unauthorized();

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const vendor = (searchParams.get("vendor") ?? "").trim();
  const outcomeParam = (searchParams.get("outcome") ?? "").trim();
  const moodParam = (searchParams.get("mood") ?? "").trim();
  const receipt = (searchParams.get("receipt") ?? "").trim();
  const email = (searchParams.get("email") ?? "").trim();
  const search = (searchParams.get("search") ?? "").trim();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") ?? "25", 10) || 25),
  );

  const where: Prisma.ConversationWhereInput = {};

  if (from || to) {
    where.startedAt = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime()))
        (where.startedAt as Prisma.DateTimeFilter).gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime()))
        (where.startedAt as Prisma.DateTimeFilter).lte = d;
    }
  }
  if (vendor) where.vendor = { equals: vendor, mode: "insensitive" };
  if (outcomeParam && VALID_OUTCOMES.includes(outcomeParam as Outcome)) {
    where.outcome = outcomeParam as Outcome;
  }
  if (moodParam && VALID_MOODS.includes(moodParam as Mood)) {
    where.initialMood = moodParam as Mood;
  }
  if (receipt) where.receipt = { contains: receipt, mode: "insensitive" };
  if (email) where.customerEmail = { contains: email, mode: "insensitive" };
  if (search) {
    where.OR = [
      { receipt: { contains: search, mode: "insensitive" } },
      { customerEmail: { contains: search, mode: "insensitive" } },
      { customerName: { contains: search, mode: "insensitive" } },
    ];
  }

  try {
    const [total, conversations, byOutcome, byVendor, byMood] =
      await Promise.all([
        prisma.conversation.count({ where }),
        prisma.conversation.findMany({
          where,
          orderBy: { startedAt: "desc" },
          take: pageSize,
          skip: (page - 1) * pageSize,
          select: {
            id: true,
            receipt: true,
            vendor: true,
            productTitle: true,
            customerName: true,
            customerEmail: true,
            refundAmount: true,
            currency: true,
            startedAt: true,
            endedAt: true,
            lastActivityAt: true,
            initialMood: true,
            outcome: true,
            retentionAttempts: true,
            _count: { select: { messages: true } },
          },
        }),
        prisma.conversation.groupBy({
          by: ["outcome"],
          where,
          _count: { outcome: true },
        }),
        prisma.conversation.groupBy({
          by: ["vendor"],
          where,
          _count: { vendor: true },
        }),
        prisma.conversation.groupBy({
          by: ["initialMood"],
          where,
          _count: { initialMood: true },
        }),
      ]);

    const outcomeCounts = Object.fromEntries(
      VALID_OUTCOMES.map((o) => [o, 0]),
    ) as Record<Outcome, number>;
    for (const row of byOutcome) {
      outcomeCounts[row.outcome as Outcome] = row._count.outcome;
    }

    const moodCounts = Object.fromEntries(
      VALID_MOODS.map((m) => [m, 0]),
    ) as Record<Mood, number>;
    for (const row of byMood) {
      moodCounts[row.initialMood as Mood] = row._count.initialMood;
    }

    const totalFinalized =
      outcomeCounts.refund_issued +
      outcomeCounts.refund_abandoned +
      outcomeCounts.resolved;

    const retentionSaved =
      outcomeCounts.refund_abandoned + outcomeCounts.resolved;

    const retentionRate =
      totalFinalized === 0 ? 0 : retentionSaved / totalFinalized;

    const refundRate =
      totalFinalized === 0
        ? 0
        : outcomeCounts.refund_issued / totalFinalized;

    return NextResponse.json({
      total,
      page,
      pageSize,
      conversations: conversations.map((c) => ({
        id: c.id,
        receipt: c.receipt,
        vendor: c.vendor,
        productTitle: c.productTitle,
        customerName: c.customerName,
        customerEmail: c.customerEmail,
        refundAmount: c.refundAmount ? Number(c.refundAmount) : null,
        currency: c.currency,
        startedAt: c.startedAt,
        endedAt: c.endedAt,
        lastActivityAt: c.lastActivityAt,
        initialMood: c.initialMood,
        outcome: c.outcome,
        retentionAttempts: c.retentionAttempts,
        messagesCount: c._count.messages,
      })),
      stats: {
        byOutcome: outcomeCounts,
        byMood: moodCounts,
        byVendor: Object.fromEntries(
          byVendor.map((r) => [r.vendor ?? "(none)", r._count.vendor]),
        ),
        totalFinalized,
        retentionRate,
        refundRate,
      },
      vendors: getConfiguredVendors(),
    });
  } catch (err) {
    console.error("[admin/conversations]", err);
    return NextResponse.json(
      { error: "Could not load conversations." },
      { status: 500 },
    );
  }
}
