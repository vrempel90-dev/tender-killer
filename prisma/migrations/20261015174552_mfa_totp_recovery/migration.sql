-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "requireMfaForAdmins" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "mfaSteppedUpAt" TIMESTAMP(3),
ADD COLUMN     "mfaVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totpConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "totpLastCounter" BIGINT,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_codes_userId_idx" ON "recovery_codes"("userId");

-- AddForeignKey
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
