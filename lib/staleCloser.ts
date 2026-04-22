import { prisma } from "./db";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 30 * 60 * 1000;
const REFUND_KEYWORDS =
  /\b(refund|reembolso|estorno|chargeback|money back|devolu[cç][aã]o|dinheiro de volta|reembols)\b/i;

let started = false;

export function startStaleCloser(): void {
  if (started) return;
  started = true;

  console.log(
    `[staleCloser] started — checking every ${CHECK_INTERVAL_MS / 1000}s, stale threshold ${STALE_THRESHOLD_MS / 1000}s`,
  );

  void closeStaleConversations();
  const timer = setInterval(closeStaleConversations, CHECK_INTERVAL_MS);
  timer.unref();
}

async function closeStaleConversations(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const stale = await prisma.conversation.findMany({
      where: {
        outcome: "in_progress",
        lastActivityAt: { lt: cutoff },
      },
      include: {
        messages: {
          where: { role: "user" },
          select: { content: true },
        },
      },
      take: 100,
    });

    if (stale.length === 0) return;

    for (const conv of stale) {
      const hadRefundIntent = conv.messages.some((m) =>
        REFUND_KEYWORDS.test(m.content),
      );
      const outcome = hadRefundIntent ? "refund_abandoned" : "resolved";

      await prisma.conversation.update({
        where: { id: conv.id },
        data: { outcome, endedAt: new Date() },
      });
    }

    console.log(
      `[staleCloser] closed ${stale.length} stale conversation(s)`,
    );
  } catch (err) {
    console.error("[staleCloser] error", err);
  }
}
