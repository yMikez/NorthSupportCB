-- Multi-platform migration: ClickBank-only → BuyGoods / Digistore24 / JVZoo.

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'processed', 'failed', 'cancelled');

-- Conversation: "receipt" was ClickBank vocabulary; every platform calls it
-- something different, so the column becomes the neutral "orderId".
ALTER TABLE "Conversation" RENAME COLUMN "receipt" TO "orderId";
ALTER INDEX "Conversation_receipt_idx" RENAME TO "Conversation_orderId_idx";

-- Which platform the order came from. Nullable: rows created before this
-- migration have no platform, and the admin UI renders those as "—".
ALTER TABLE "Conversation" ADD COLUMN "platform" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_platform_idx" ON "Conversation"("platform");

-- CreateTable
CREATE TABLE "OrderRecord" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendor" TEXT,
    "productId" TEXT,
    "productTitle" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "amount" DECIMAL(10,2),
    "currency" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderRecord_platform_orderId_key" ON "OrderRecord"("platform", "orderId");
CREATE INDEX "OrderRecord_email_idx" ON "OrderRecord"("email");
CREATE INDEX "OrderRecord_platform_idx" ON "OrderRecord"("platform");
CREATE INDEX "OrderRecord_purchaseDate_idx" ON "OrderRecord"("purchaseDate");

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "conversationId" TEXT,
    "vendor" TEXT,
    "productTitle" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "amount" DECIMAL(10,2),
    "currency" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundRequest_status_idx" ON "RefundRequest"("status");
CREATE INDEX "RefundRequest_platform_idx" ON "RefundRequest"("platform");
CREATE INDEX "RefundRequest_createdAt_idx" ON "RefundRequest"("createdAt");
CREATE INDEX "RefundRequest_orderId_idx" ON "RefundRequest"("orderId");
