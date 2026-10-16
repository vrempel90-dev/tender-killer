-- Изоляция компаний для таблиц TENDER GUARD (см. docs/db-isolation.md).
--
-- У наблюдения есть companyId, у снимков и изменений — нет: их видимость
-- определяется видимостью наблюдения. Подзапрос выполняется той же ролью,
-- поэтому к нему применяется политика родителя.

ALTER TABLE "tender_watches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tender_watches" FOR ALL
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "watch_snapshots" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "watch_snapshots" FOR ALL
  USING (EXISTS (SELECT 1 FROM "tender_watches" w WHERE w."id" = "watchId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "tender_watches" w WHERE w."id" = "watchId"));

ALTER TABLE "watch_changes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "watch_changes" FOR ALL
  USING (EXISTS (SELECT 1 FROM "tender_watches" w WHERE w."id" = "watchId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "tender_watches" w WHERE w."id" = "watchId"));
