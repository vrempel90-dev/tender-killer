-- CreateEnum
CREATE TYPE "WatchSourceKind" AS ENUM ('DOCUMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "ChangeSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'INFO');

-- CreateEnum
CREATE TYPE "WatchChangeKind" AS ENUM ('SUBMISSION_DEADLINE_MOVED', 'DELIVERY_DEADLINE_MOVED', 'START_PRICE_CHANGED', 'SPEC_CHANGED', 'DOCUMENT_REPLACED', 'DOCUMENT_ADDED', 'PROCUREMENT_CANCELLED', 'OTHER');

-- CreateTable
CREATE TABLE "tender_watches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "watchedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tender_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_snapshots" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sourceKind" "WatchSourceKind" NOT NULL,
    "documentId" TEXT,
    "submissionDeadline" TIMESTAMP(3),
    "deliveryDeadline" TIMESTAMP(3),
    "startPriceMinor" BIGINT,
    "specText" TEXT,
    "specHash" TEXT,
    "specCharCount" INTEGER,
    "note" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedById" TEXT,

    CONSTRAINT "watch_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_changes" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "fromSnapshotId" TEXT,
    "toSnapshotId" TEXT NOT NULL,
    "kind" "WatchChangeKind" NOT NULL,
    "severity" "ChangeSeverity" NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "requiresRecalc" BOOLEAN NOT NULL DEFAULT false,
    "financialImpact" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tender_watches_tenderId_key" ON "tender_watches"("tenderId");

-- CreateIndex
CREATE INDEX "tender_watches_companyId_isActive_idx" ON "tender_watches"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "watch_snapshots_watchId_capturedAt_idx" ON "watch_snapshots"("watchId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "watch_snapshots_watchId_revision_key" ON "watch_snapshots"("watchId", "revision");

-- CreateIndex
CREATE INDEX "watch_changes_watchId_createdAt_idx" ON "watch_changes"("watchId", "createdAt");

-- AddForeignKey
ALTER TABLE "tender_watches" ADD CONSTRAINT "tender_watches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_watches" ADD CONSTRAINT "tender_watches_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_snapshots" ADD CONSTRAINT "watch_snapshots_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "tender_watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_snapshots" ADD CONSTRAINT "watch_snapshots_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_changes" ADD CONSTRAINT "watch_changes_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "tender_watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_changes" ADD CONSTRAINT "watch_changes_fromSnapshotId_fkey" FOREIGN KEY ("fromSnapshotId") REFERENCES "watch_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_changes" ADD CONSTRAINT "watch_changes_toSnapshotId_fkey" FOREIGN KEY ("toSnapshotId") REFERENCES "watch_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
