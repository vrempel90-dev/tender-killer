-- Изоляция данных компаний на уровне СУБД (Row Level Security).
--
-- Проверки в приложении остаются, это второй, независимый рубеж: если в
-- каком-то запросе забудут фильтр по companyId, строки другой компании
-- всё равно не вернутся.
--
-- Правило: идентификатор компании берётся из переменной сессии
-- app.company_id. Если она не установлена, current_setting(...,true)
-- возвращает NULL, сравнение даёт false и не видно НИ ОДНОЙ строки —
-- отказ закрытый, а не открытый.
--
-- Политики применяются к роли приложения. Владелец таблиц (роль миграций
-- и сидов) RLS обходит, поэтому db:deploy и db:seed работают как раньше.
-- Роль приложения создаётся отдельно: scripts/db-roles.sql.
--
-- Таблицы аутентификации (companies, users, sessions, recovery_codes,
-- audit_logs) намеренно не покрыты: вход по паролю и запись неудачных
-- попыток происходят ДО того, как компания известна. Обоснование и
-- компенсирующие меры — docs/db-isolation.md.

-- 1. Таблицы с прямым companyId -------------------------------------------

ALTER TABLE "tenders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenders" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documents" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "supplier_quotes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_quotes" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "company_tax_rates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_tax_rates" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "historical_tenders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "historical_tenders" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reports" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

-- 2. Дочерние таблицы без companyId ---------------------------------------
--
-- Видимость определяется видимостью родителя: подзапрос выполняется той же
-- ролью, поэтому к нему применяется политика родителя. Строка доступна
-- тогда и только тогда, когда доступен её родитель.

ALTER TABLE "document_extractions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "document_extractions" FOR ALL
  USING (EXISTS (SELECT 1 FROM "documents" d WHERE d."id" = "documentId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "documents" d WHERE d."id" = "documentId"));

ALTER TABLE "requirements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "requirements" FOR ALL
  USING (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"));

ALTER TABLE "compliance_runs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "compliance_runs" FOR ALL
  USING (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"));

ALTER TABLE "compliance_findings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "compliance_findings" FOR ALL
  USING (EXISTS (SELECT 1 FROM "compliance_runs" r WHERE r."id" = "runId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "compliance_runs" r WHERE r."id" = "runId"));

ALTER TABLE "line_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "line_items" FOR ALL
  USING (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"));

ALTER TABLE "supplier_quote_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_quote_items" FOR ALL
  USING (EXISTS (SELECT 1 FROM "supplier_quotes" q WHERE q."id" = "quoteId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "supplier_quotes" q WHERE q."id" = "quoteId"));

ALTER TABLE "financial_models" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "financial_models" FOR ALL
  USING (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"));

ALTER TABLE "contract_analyses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contract_analyses" FOR ALL
  USING (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "tenders" t WHERE t."id" = "tenderId"));

ALTER TABLE "contract_risks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "contract_risks" FOR ALL
  USING (EXISTS (SELECT 1 FROM "contract_analyses" a WHERE a."id" = "analysisId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "contract_analyses" a WHERE a."id" = "analysisId"));
