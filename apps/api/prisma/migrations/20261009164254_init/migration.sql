-- CreateTable
CREATE TABLE "LoanScheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interestRatePercent" DECIMAL(5,2) NOT NULL,
    "maxLtv" DECIMAL(4,3) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "repaymentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "mobile" VARCHAR(10) NOT NULL,
    "netWeightGrams" DECIMAL(10,3) NOT NULL,
    "grossWeightGrams" DECIMAL(10,3) NOT NULL,
    "karat" INTEGER NOT NULL,
    "schemeId" TEXT NOT NULL,
    "eligibleLoanRupees" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_mobile_createdAt_idx" ON "Lead"("mobile", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "LoanScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
