CREATE TABLE "company_tax_rates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "rateId" TEXT NOT NULL REFERENCES "tax_rate_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "ratePercent" DECIMAL(9,4) NOT NULL CHECK ("ratePercent" >= 0),
  "confirmedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "company_tax_rates_companyId_rateId_key" ON "company_tax_rates"("companyId", "rateId");
CREATE TABLE "request_quotas" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL CHECK ("count" > 0),
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "request_quotas_expiresAt_idx" ON "request_quotas"("expiresAt");
