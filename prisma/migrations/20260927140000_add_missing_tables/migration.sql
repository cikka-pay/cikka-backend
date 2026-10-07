-- CreateTable: users (User model — customer auth)
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateTable: payment_transactions (PaymentTransaction model — Setu Payment Ledger)
CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "uniquePaymentRefID" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_uniquePaymentRefID_key" ON "payment_transactions"("uniquePaymentRefID");

-- CreateIndex
CREATE INDEX "payment_transactions_uniquePaymentRefID_idx" ON "payment_transactions"("uniquePaymentRefID");

-- CreateIndex
CREATE INDEX "payment_transactions_userId_idx" ON "payment_transactions"("userId");

-- CreateTable: bbps_transactions (BbpsTransaction model)
CREATE TABLE "bbps_transactions" (
    "id" TEXT NOT NULL,
    "refID" TEXT NOT NULL,
    "userId" TEXT,
    "billerId" TEXT NOT NULL,
    "billerName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "customerParams" JSONB,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "setuBillId" TEXT,
    "setuPaymentId" TEXT,
    "bbpsRefNo" TEXT,
    "rawPayload" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bbps_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bbps_transactions_refID_key" ON "bbps_transactions"("refID");

-- CreateIndex
CREATE INDEX "bbps_transactions_refID_idx" ON "bbps_transactions"("refID");

-- CreateIndex
CREATE INDEX "bbps_transactions_userId_idx" ON "bbps_transactions"("userId");

-- CreateIndex
CREATE INDEX "bbps_transactions_status_idx" ON "bbps_transactions"("status");

-- CreateIndex
CREATE INDEX "bbps_transactions_category_idx" ON "bbps_transactions"("category");

-- CreateTable: bbps_billers (BbpsBiller model)
CREATE TABLE "bbps_billers" (
    "id" TEXT NOT NULL,
    "billerId" TEXT NOT NULL,
    "billerName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "logoUrl" TEXT,
    "coverageArea" TEXT,
    "paramsSchema" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bbps_billers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bbps_billers_billerId_key" ON "bbps_billers"("billerId");

-- CreateIndex
CREATE INDEX "bbps_billers_category_idx" ON "bbps_billers"("category");

-- CreateTable: bbps_bill_fetches (BbpsBillFetch model)
CREATE TABLE "bbps_bill_fetches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "billerId" TEXT NOT NULL,
    "customerParams" JSONB NOT NULL,
    "billNumber" TEXT,
    "billAmount" DECIMAL(10,2) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "customerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FETCHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bbps_bill_fetches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bbps_bill_fetches_userId_idx" ON "bbps_bill_fetches"("userId");

-- CreateIndex
CREATE INDEX "bbps_bill_fetches_billerId_idx" ON "bbps_bill_fetches"("billerId");

-- CreateTable: bbps_bill_payments (BbpsBillPayment model)
CREATE TABLE "bbps_bill_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "billFetchId" TEXT,
    "billerId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paymentMode" TEXT NOT NULL DEFAULT 'UPI',
    "setuPaymentLink" TEXT,
    "setuQrCode" TEXT,
    "uniquePaymentRefID" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bbps_bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bbps_bill_payments_uniquePaymentRefID_key" ON "bbps_bill_payments"("uniquePaymentRefID");

-- CreateIndex
CREATE INDEX "bbps_bill_payments_userId_idx" ON "bbps_bill_payments"("userId");

-- CreateIndex
CREATE INDEX "bbps_bill_payments_uniquePaymentRefID_idx" ON "bbps_bill_payments"("uniquePaymentRefID");

-- CreateTable: pan_verification_records (PanVerificationRecord model)
CREATE TABLE "pan_verification_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "pan" TEXT NOT NULL,
    "registeredName" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'INSTANTPAY',
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pan_verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pan_verification_records_pan_idx" ON "pan_verification_records"("pan");

-- CreateIndex
CREATE INDEX "pan_verification_records_userId_idx" ON "pan_verification_records"("userId");

-- CreateTable: gstin_verification_records (GstinVerificationRecord model)
CREATE TABLE "gstin_verification_records" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT,
    "userId" TEXT,
    "gstin" TEXT NOT NULL,
    "legalName" TEXT,
    "tradeName" TEXT,
    "status" TEXT NOT NULL,
    "businessType" TEXT,
    "state" TEXT,
    "address" JSONB,
    "provider" TEXT NOT NULL DEFAULT 'INSTANTPAY',
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gstin_verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gstin_verification_records_gstin_idx" ON "gstin_verification_records"("gstin");

-- CreateIndex
CREATE INDEX "gstin_verification_records_sellerId_idx" ON "gstin_verification_records"("sellerId");

-- CreateIndex
CREATE INDEX "gstin_verification_records_userId_idx" ON "gstin_verification_records"("userId");

-- CreateTable: cin_verification_records (CinVerificationRecord model)
CREATE TABLE "cin_verification_records" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT,
    "userId" TEXT,
    "cin" TEXT NOT NULL,
    "companyName" TEXT,
    "companyStatus" TEXT,
    "companyType" TEXT,
    "state" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cin_verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cin_verification_records_cin_idx" ON "cin_verification_records"("cin");

-- CreateIndex
CREATE INDEX "cin_verification_records_sellerId_idx" ON "cin_verification_records"("sellerId");

-- CreateIndex
CREATE INDEX "cin_verification_records_userId_idx" ON "cin_verification_records"("userId");

-- CreateTable: aadhaar_verification_records (AadhaarVerificationRecord model)
CREATE TABLE "aadhaar_verification_records" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT,
    "userId" TEXT,
    "aadhaarNumber" TEXT NOT NULL,
    "aadhaarHolderName" TEXT,
    "state" TEXT,
    "ageBand" TEXT,
    "gender" TEXT,
    "maskedMobile" TEXT,
    "status" TEXT,
    "valid" BOOLEAN NOT NULL DEFAULT false,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aadhaar_verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aadhaar_verification_records_aadhaarNumber_idx" ON "aadhaar_verification_records"("aadhaarNumber");

-- CreateIndex
CREATE INDEX "aadhaar_verification_records_sellerId_idx" ON "aadhaar_verification_records"("sellerId");

-- CreateIndex
CREATE INDEX "aadhaar_verification_records_userId_idx" ON "aadhaar_verification_records"("userId");

-- CreateTable: vpa_verification_records (VpaVerificationRecord model)
CREATE TABLE "vpa_verification_records" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT,
    "userId" TEXT,
    "vpa" TEXT NOT NULL,
    "accountHolderName" TEXT,
    "ifsc" TEXT,
    "accountType" TEXT,
    "nameMatchPercent" DOUBLE PRECISION,
    "status" TEXT,
    "valid" BOOLEAN NOT NULL DEFAULT false,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vpa_verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vpa_verification_records_vpa_idx" ON "vpa_verification_records"("vpa");

-- CreateIndex
CREATE INDEX "vpa_verification_records_sellerId_idx" ON "vpa_verification_records"("sellerId");

-- CreateIndex
CREATE INDEX "vpa_verification_records_userId_idx" ON "vpa_verification_records"("userId");

-- CreateTable: bank_account_verification_records (BankAccountVerificationRecord model)
CREATE TABLE "bank_account_verification_records" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT,
    "userId" TEXT,
    "maskedAccountNumber" TEXT NOT NULL,
    "accountNumberHash" TEXT,
    "bankIfsc" TEXT NOT NULL,
    "accountHolderName" TEXT,
    "txnReferenceId" TEXT,
    "accountType" TEXT,
    "nameMatchPercent" DOUBLE PRECISION,
    "isPennyDrop" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT,
    "valid" BOOLEAN NOT NULL DEFAULT false,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_account_verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_account_verification_records_maskedAccountNumber_idx" ON "bank_account_verification_records"("maskedAccountNumber");

-- CreateIndex
CREATE INDEX "bank_account_verification_records_bankIfsc_idx" ON "bank_account_verification_records"("bankIfsc");

-- CreateIndex
CREATE INDEX "bank_account_verification_records_sellerId_idx" ON "bank_account_verification_records"("sellerId");

-- CreateIndex
CREATE INDEX "bank_account_verification_records_userId_idx" ON "bank_account_verification_records"("userId");
