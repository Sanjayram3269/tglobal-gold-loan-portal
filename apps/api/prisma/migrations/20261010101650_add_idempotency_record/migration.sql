-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" VARCHAR(255) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);
