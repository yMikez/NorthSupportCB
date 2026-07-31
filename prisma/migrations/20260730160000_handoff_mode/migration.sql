-- Handoff mode: the agent escalates to a human instead of issuing refunds
-- while the store integrations are not wired up.

-- AlterEnum: a conversation can now end by being handed to a human.
ALTER TYPE "Outcome" ADD VALUE 'escalated';

-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('refund', 'handoff');

-- The queue now holds two kinds of work. Existing rows are all refunds.
ALTER TABLE "RefundRequest"
  ADD COLUMN "kind" "RequestKind" NOT NULL DEFAULT 'refund',
  ADD COLUMN "urgent" BOOLEAN NOT NULL DEFAULT false;

-- Handoff rows have no platform until the stores are connected.
ALTER TABLE "RefundRequest" ALTER COLUMN "platform" SET DEFAULT '';

-- CreateIndex
CREATE INDEX "RefundRequest_kind_idx" ON "RefundRequest"("kind");
