-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('in_progress', 'refund_issued', 'refund_abandoned', 'resolved');

-- CreateEnum
CREATE TYPE "Mood" AS ENUM ('unknown', 'calm', 'disappointed', 'angry');

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "receipt" TEXT NOT NULL,
    "vendor" TEXT,
    "productTitle" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "refundAmount" DECIMAL(10,2),
    "currency" TEXT,
    "ipHash" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initialMood" "Mood" NOT NULL DEFAULT 'unknown',
    "outcome" "Outcome" NOT NULL DEFAULT 'in_progress',
    "retentionAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_receipt_idx" ON "Conversation"("receipt");
CREATE INDEX "Conversation_vendor_idx" ON "Conversation"("vendor");
CREATE INDEX "Conversation_startedAt_idx" ON "Conversation"("startedAt");
CREATE INDEX "Conversation_outcome_idx" ON "Conversation"("outcome");
CREATE INDEX "Conversation_lastActivityAt_idx" ON "Conversation"("lastActivityAt");
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
