-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('INCOMPLETE', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REFUNDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'OUT_OF_STOCK');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER', 'INVENTORY', 'SETTLEMENT', 'SYSTEM', 'KYB');

-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('SELF', 'THREE_PL', 'CIKKA');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('PRIVATE_LIMITED', 'LLP', 'PROPRIETORSHIP', 'PARTNERSHIP');

-- CreateEnum
CREATE TYPE "SettlementCycle" AS ENUM ('T_PLUS_1', 'T_PLUS_3', 'T_PLUS_7', 'T_PLUS_14');

-- CreateTable
CREATE TABLE "sellers" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "businessName" TEXT NOT NULL DEFAULT '',
    "kycVerified" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'INCOMPLETE',
    "phoneOtpCode" TEXT,
    "phoneOtpExpiresAt" TIMESTAMP(3),
    "phoneOtpAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailOtpCode" TEXT,
    "emailOtpExpiresAt" TIMESTAMP(3),
    "resetOtpCode" TEXT,
    "resetOtpExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_onboarding" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "businessName" TEXT,
    "businessType" "BusinessType",
    "yearEstablished" INTEGER,
    "website" TEXT,
    "businessCategory" TEXT,
    "description" TEXT,
    "gstNumber" TEXT,
    "gstVerified" BOOLEAN NOT NULL DEFAULT false,
    "gstData" JSONB,
    "panNumber" TEXT,
    "panVerified" BOOLEAN NOT NULL DEFAULT false,
    "panData" JSONB,
    "cinNumber" TEXT,
    "cinVerified" BOOLEAN NOT NULL DEFAULT false,
    "cinData" JSONB,
    "msmeNumber" TEXT,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT,
    "signatoryPersonalPan" TEXT,
    "signatoryAadhaar" TEXT,
    "signatoryAadhaarVerified" BOOLEAN NOT NULL DEFAULT false,
    "signatoryMobile" TEXT,
    "signatoryEmail" TEXT,
    "bankAccountHolder" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfsc" TEXT,
    "bankVerified" BOOLEAN NOT NULL DEFAULT false,
    "bankData" JSONB,
    "logoUrl" TEXT,
    "productCategories" JSONB,
    "returnPolicy" TEXT,
    "settlementCycle" "SettlementCycle" NOT NULL DEFAULT 'T_PLUS_7',
    "avgOrderValue" DECIMAL(10,2),
    "monthlySalesTarget" DECIMAL(12,2),
    "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'THREE_PL',
    "pickupAddress" JSONB,
    "merchantAgreementAccepted" BOOLEAN NOT NULL DEFAULT false,
    "commissionAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "returnPolicyAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "authenticityAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "digitalSignature" TEXT,
    "agreementAcceptedAt" TIMESTAMP(3),
    "applicationId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedSteps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_settings" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "settlementCycle" "SettlementCycle" NOT NULL DEFAULT 'T_PLUS_7',
    "returnPolicy" TEXT NOT NULL DEFAULT '7-Day Return Window',
    "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'THREE_PL',
    "lowStockDefault" INTEGER NOT NULL DEFAULT 5,
    "notifyLowStock" BOOLEAN NOT NULL DEFAULT true,
    "notifyNewOrder" BOOLEAN NOT NULL DEFAULT true,
    "notifySettlement" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "mrp" DECIMAL(10,2),
    "price" DECIMAL(10,2) NOT NULL,
    "gstSlab" INTEGER NOT NULL DEFAULT 12,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "weightGrams" INTEGER,
    "dimLengthCm" DECIMAL(6,1),
    "dimWidthCm" DECIMAL(6,1),
    "dimHeightCm" DECIMAL(6,1),
    "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'THREE_PL',
    "dispatchDays" TEXT NOT NULL DEFAULT 'same',
    "imageUrls" JSONB,
    "videoUrl" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "typeName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerCity" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "trackingNumber" TEXT,
    "courier" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "variantId" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Cosmetics',
    "grossSales" DECIMAL(10,2) NOT NULL,
    "commissionRate" DECIMAL(5,2) NOT NULL,
    "commissionAmount" DECIMAL(10,2) NOT NULL,
    "shippingGstAmount" DECIMAL(10,2) NOT NULL,
    "netPayable" DECIMAL(10,2) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "payoutDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "refundAmount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_sequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "application_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sellers_phone_key" ON "sellers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_email_key" ON "sellers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "seller_onboarding_sellerId_key" ON "seller_onboarding"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "seller_onboarding_applicationId_key" ON "seller_onboarding"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "seller_settings_sellerId_key" ON "seller_settings"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_sellerId_idx" ON "products"("sellerId");

-- CreateIndex
CREATE INDEX "products_sellerId_status_idx" ON "products"("sellerId", "status");

-- CreateIndex
CREATE INDEX "products_sellerId_category_idx" ON "products"("sellerId", "category");

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_typeName_value_key" ON "product_variants"("productId", "typeName", "value");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_sellerId_createdAt_idx" ON "orders"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_sellerId_status_idx" ON "orders"("sellerId", "status");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "settlements_sellerId_periodStart_idx" ON "settlements"("sellerId", "periodStart");

-- CreateIndex
CREATE INDEX "settlements_sellerId_status_idx" ON "settlements"("sellerId", "status");

-- CreateIndex
CREATE INDEX "returns_orderId_idx" ON "returns"("orderId");

-- CreateIndex
CREATE INDEX "returns_productId_idx" ON "returns"("productId");

-- CreateIndex
CREATE INDEX "notifications_sellerId_read_idx" ON "notifications"("sellerId", "read");

-- CreateIndex
CREATE INDEX "notifications_sellerId_createdAt_idx" ON "notifications"("sellerId", "createdAt");

-- AddForeignKey
ALTER TABLE "seller_onboarding" ADD CONSTRAINT "seller_onboarding_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_settings" ADD CONSTRAINT "seller_settings_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddColumn: Separate country code + phone number on sellers
ALTER TABLE "sellers" ADD COLUMN "countryCode" TEXT NOT NULL DEFAULT '91';
ALTER TABLE "sellers" ADD COLUMN "phoneNumber" TEXT;

-- AddColumn: Brand name on products
ALTER TABLE "products" ADD COLUMN "brandName" TEXT;


