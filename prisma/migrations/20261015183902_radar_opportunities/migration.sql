-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "procurementTypes" "ProcurementType"[] DEFAULT ARRAY[]::"ProcurementType"[],
    "minPriceMinor" BIGINT,
    "maxPriceMinor" BIGINT,
    "minDeliveryDays" INTEGER,
    "excludedCustomerBins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredCustomerBins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minDaysToDeadline" INTEGER,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_imports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "actualAt" TIMESTAMP(3) NOT NULL,
    "rowsTotal" INTEGER NOT NULL,
    "rowsImported" INTEGER NOT NULL,
    "rowsRejected" INTEGER NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT,

    CONSTRAINT "procurement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_opportunities" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "customerName" TEXT,
    "customerBin" TEXT,
    "priceMinor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "procurementType" "ProcurementType" NOT NULL DEFAULT 'OTHER',
    "region" TEXT,
    "deadline" TIMESTAMP(3),
    "deliveryDeadline" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "raw" JSONB NOT NULL,
    "tenderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdById" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_companyId_key" ON "company_profiles"("companyId");

-- CreateIndex
CREATE INDEX "procurement_imports_companyId_importedAt_idx" ON "procurement_imports"("companyId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_opportunities_tenderId_key" ON "procurement_opportunities"("tenderId");

-- CreateIndex
CREATE INDEX "procurement_opportunities_companyId_deadline_idx" ON "procurement_opportunities"("companyId", "deadline");

-- CreateIndex
CREATE INDEX "procurement_opportunities_companyId_importId_idx" ON "procurement_opportunities"("companyId", "importId");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_opportunities_importId_externalId_key" ON "procurement_opportunities"("importId", "externalId");

-- CreateIndex
CREATE INDEX "saved_searches_companyId_updatedAt_idx" ON "saved_searches"("companyId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_searches_companyId_name_key" ON "saved_searches"("companyId", "name");

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_imports" ADD CONSTRAINT "procurement_imports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_opportunities" ADD CONSTRAINT "procurement_opportunities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_opportunities" ADD CONSTRAINT "procurement_opportunities_importId_fkey" FOREIGN KEY ("importId") REFERENCES "procurement_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_opportunities" ADD CONSTRAINT "procurement_opportunities_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
