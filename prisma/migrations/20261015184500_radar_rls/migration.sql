-- Изоляция компаний для новых таблиц (см. docs/db-isolation.md).
-- Политика та же: нет app.company_id — нет строк.

ALTER TABLE "company_profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "company_profiles" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "procurement_imports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "procurement_imports" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "procurement_opportunities" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "procurement_opportunities" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "saved_searches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "saved_searches" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
