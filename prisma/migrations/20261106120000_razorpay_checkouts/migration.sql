-- Razorpay checkout records: server-side amount + cart snapshot per Razorpay order,
-- and the idempotency claim for fulfilment (verify-payment, verify-card-otp, webhook).
-- CreateTable
CREATE TABLE "razorpay_checkouts" (
    "id" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "razorpayPaymentId" TEXT,
    "snapshot" JSONB,
    "result" JSONB,
    "fulfilledVia" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "razorpay_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "razorpay_checkouts_razorpayOrderId_key" ON "razorpay_checkouts"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "razorpay_checkouts_razorpayPaymentId_key" ON "razorpay_checkouts"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "razorpay_checkouts_userId_idx" ON "razorpay_checkouts"("userId");

-- CreateIndex
CREATE INDEX "razorpay_checkouts_status_idx" ON "razorpay_checkouts"("status");
