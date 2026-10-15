-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('GENERAL_VAT', 'GENERAL_NO_VAT', 'SIMPLIFIED', 'RETAIL_TAX', 'INDIVIDUAL_ENTREPRENEUR');

-- CreateEnum
CREATE TYPE "TenderStage" AS ENUM ('DRAFT', 'ANALYSIS', 'DECIDED_GO', 'DECIDED_NO_GO', 'SUBMITTED', 'WON', 'LOST', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProcurementType" AS ENUM ('OPEN_TENDER', 'REQUEST_FOR_QUOTATIONS', 'SINGLE_SOURCE', 'AUCTION', 'CORPORATE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('TECHNICAL_SPEC', 'CONTRACT_DRAFT', 'TENDER_NOTICE', 'SUPPLIER_QUOTE', 'PRICE_LIST', 'OWN_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "RequirementCategory" AS ENUM ('DOCUMENT', 'TECHNICAL', 'QUALIFICATION', 'DEADLINE', 'FINANCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('CONFIRMED', 'NOT_FOUND', 'MISMATCH', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "QuoteVerification" AS ENUM ('VERIFIED', 'UNVERIFIED');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bin" TEXT,
    "taxRegime" "TaxRegime" NOT NULL DEFAULT 'GENERAL_VAT',
    "isVatPayer" BOOLEAN NOT NULL DEFAULT true,
    "isSmallBusiness" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "externalNumber" TEXT,
    "sourceUrl" TEXT,
    "customerName" TEXT,
    "customerBin" TEXT,
    "procurementType" "ProcurementType" NOT NULL DEFAULT 'OPEN_TENDER',
    "stage" "TenderStage" NOT NULL DEFAULT 'DRAFT',
    "startPriceMinor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "submissionDeadline" TIMESTAMP(3),
    "deliveryDeadline" TIMESTAMP(3),
    "region" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tenderId" TEXT,
    "kind" "DocumentKind" NOT NULL DEFAULT 'OTHER',
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_extractions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "text" TEXT,
    "pageCount" INTEGER,
    "unreadablePages" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "tables" JSONB,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "engine" TEXT,
    "charCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "documentId" TEXT,
    "category" "RequirementCategory" NOT NULL DEFAULT 'OTHER',
    "text" TEXT NOT NULL,
    "label" TEXT,
    "pageNumber" INTEGER,
    "sourceQuote" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'AI',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_runs" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "aiModel" TEXT,
    "promptVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "analyzedDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unreadableDocumentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenUsage" JSONB,

    CONSTRAINT "compliance_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_findings" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "requirementId" TEXT,
    "documentId" TEXT,
    "requirementText" TEXT NOT NULL,
    "documentName" TEXT,
    "pageNumber" INTEGER,
    "evidenceQuote" TEXT,
    "status" "ComplianceStatus" NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "recommendation" TEXT NOT NULL,
    "uncertaintyReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_items" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "specification" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'шт',
    "quantity" DECIMAL(18,4) NOT NULL,
    "customerUnitPriceMinor" BIGINT,
    "pageNumber" INTEGER,
    "sourceQuote" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'AI',
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
    "selectedQuoteItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierBin" TEXT,
    "contact" TEXT,
    "documentId" TEXT,
    "verification" "QuoteVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "fxRate" DECIMAL(18,6),
    "pricesIncludeVat" BOOLEAN NOT NULL DEFAULT true,
    "validUntil" TIMESTAMP(3),
    "deliveryDays" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'шт',
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "specMatch" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "specMatchNote" TEXT,
    "leadTimeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_models" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Базовый расчёт',
    "inputs" JSONB NOT NULL,
    "result" JSONB,
    "engineVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "taxConfigVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rate_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ratePercent" DECIMAL(9,4) NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rate_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_analyses" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "aiModel" TEXT,
    "promptVersion" TEXT,
    "error" TEXT,
    "extractedTerms" JSONB,
    "tokenUsage" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "contract_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_risks" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clauseRef" TEXT,
    "pageNumber" INTEGER,
    "sourceQuote" TEXT,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "explanation" TEXT NOT NULL,
    "recommendation" TEXT,
    "financialImpactMinor" BIGINT,
    "financeHint" JSONB,
    "needsLawyerReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_tenders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalNumber" TEXT,
    "title" TEXT NOT NULL,
    "customerName" TEXT,
    "customerBin" TEXT,
    "region" TEXT,
    "startPriceMinor" BIGINT,
    "finalPriceMinor" BIGINT,
    "winnerName" TEXT,
    "winnerBin" TEXT,
    "participantsCount" INTEGER,
    "awardedAt" TIMESTAMP(3),
    "procurementType" "ProcurementType" NOT NULL DEFAULT 'OTHER',
    "sourceRef" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importBatchId" TEXT,

    CONSTRAINT "historical_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DECISION',
    "payload" JSONB NOT NULL,
    "storagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON "audit_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "tenders_companyId_stage_idx" ON "tenders"("companyId", "stage");

-- CreateIndex
CREATE INDEX "documents_companyId_tenderId_idx" ON "documents"("companyId", "tenderId");

-- CreateIndex
CREATE INDEX "documents_sha256_idx" ON "documents"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "document_extractions_documentId_key" ON "document_extractions"("documentId");

-- CreateIndex
CREATE INDEX "requirements_tenderId_idx" ON "requirements"("tenderId");

-- CreateIndex
CREATE INDEX "compliance_runs_tenderId_idx" ON "compliance_runs"("tenderId");

-- CreateIndex
CREATE INDEX "compliance_findings_runId_idx" ON "compliance_findings"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "line_items_selectedQuoteItemId_key" ON "line_items"("selectedQuoteItemId");

-- CreateIndex
CREATE INDEX "line_items_tenderId_idx" ON "line_items"("tenderId");

-- CreateIndex
CREATE INDEX "supplier_quotes_tenderId_idx" ON "supplier_quotes"("tenderId");

-- CreateIndex
CREATE INDEX "supplier_quote_items_quoteId_idx" ON "supplier_quote_items"("quoteId");

-- CreateIndex
CREATE INDEX "financial_models_tenderId_idx" ON "financial_models"("tenderId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rate_configs_key_effectiveFrom_key" ON "tax_rate_configs"("key", "effectiveFrom");

-- CreateIndex
CREATE INDEX "contract_analyses_tenderId_idx" ON "contract_analyses"("tenderId");

-- CreateIndex
CREATE INDEX "contract_risks_analysisId_idx" ON "contract_risks"("analysisId");

-- CreateIndex
CREATE INDEX "historical_tenders_companyId_idx" ON "historical_tenders"("companyId");

-- CreateIndex
CREATE INDEX "historical_tenders_companyId_customerBin_idx" ON "historical_tenders"("companyId", "customerBin");

-- CreateIndex
CREATE INDEX "reports_companyId_tenderId_idx" ON "reports"("companyId", "tenderId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_runs" ADD CONSTRAINT "compliance_runs_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_runId_fkey" FOREIGN KEY ("runId") REFERENCES "compliance_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_selectedQuoteItemId_fkey" FOREIGN KEY ("selectedQuoteItemId") REFERENCES "supplier_quote_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "supplier_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quote_items" ADD CONSTRAINT "supplier_quote_items_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_models" ADD CONSTRAINT "financial_models_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_analyses" ADD CONSTRAINT "contract_analyses_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_analyses" ADD CONSTRAINT "contract_analyses_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_risks" ADD CONSTRAINT "contract_risks_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "contract_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_tenders" ADD CONSTRAINT "historical_tenders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
