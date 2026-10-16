CREATE TABLE "ai_analysis_jobs" (
  "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "sources" JSONB NOT NULL, "totalChunks" INTEGER NOT NULL, "completedChunks" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "ai_analysis_jobs_companyId_createdAt_idx" ON "ai_analysis_jobs"("companyId", "createdAt");
CREATE TABLE "ai_analysis_chunks" (
  "id" TEXT PRIMARY KEY, "jobId" TEXT NOT NULL REFERENCES "ai_analysis_jobs"("id") ON DELETE CASCADE,
  "position" INTEGER NOT NULL, "result" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ai_analysis_chunks_jobId_position_key" ON "ai_analysis_chunks"("jobId", "position");
ALTER TABLE "ai_analysis_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_analysis_jobs" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
ALTER TABLE "ai_analysis_chunks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_analysis_chunks" FOR ALL
  USING (EXISTS (SELECT 1 FROM "ai_analysis_jobs" j WHERE j."id" = "jobId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "ai_analysis_jobs" j WHERE j."id" = "jobId"));
