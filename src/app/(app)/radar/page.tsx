import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { canWrite } from '@/lib/auth/guard';
import { requirePageSession } from '@/lib/auth/page-guard';
import { PageHeader } from '@/components/layout/page-header';
import { profileCompleteness } from '@/lib/radar/profile';
import { describeFilters, parseFilters } from '@/lib/radar/filters';
import { RadarPanel, type ImportSummary, type SavedSearchSummary } from '@/components/radar/radar-panel';

export const metadata: Metadata = { title: 'TENDER RADAR' };

export default async function RadarPage() {
  const session = await requirePageSession();

  const [profile, imports, searches, opportunityCount, openCount] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { companyId: session.companyId } }),
    prisma.procurementImport.findMany({
      where: { companyId: session.companyId },
      orderBy: { importedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        sourceName: true,
        sourceUrl: true,
        fileName: true,
        actualAt: true,
        importedAt: true,
        rowsImported: true,
        rowsRejected: true,
        warnings: true,
        _count: { select: { opportunities: true } },
      },
    }),
    prisma.savedSearch.findMany({
      where: { companyId: session.companyId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
    prisma.procurementOpportunity.count({ where: { companyId: session.companyId } }),
    prisma.procurementOpportunity.count({
      where: { companyId: session.companyId, deadline: { gte: new Date() } },
    }),
  ]);

  const importSummaries: ImportSummary[] = imports.map((item) => ({
    id: item.id,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    fileName: item.fileName,
    actualAt: item.actualAt.toISOString(),
    importedAt: item.importedAt.toISOString(),
    rowsImported: item.rowsImported,
    rowsRejected: item.rowsRejected,
    warnings: item.warnings,
    opportunities: item._count.opportunities,
  }));

  const savedSearches: SavedSearchSummary[] = searches.map((search) => {
    try {
      const filters = parseFilters(search.filters);
      return {
        id: search.id,
        name: search.name,
        filters,
        description: describeFilters(filters),
        invalid: null,
      };
    } catch {
      // Набор сохранён по прежним правилам: применять его молча нельзя.
      return {
        id: search.id,
        name: search.name,
        filters: null,
        description: null,
        invalid: 'Набор фильтров устарел — пересохраните поиск',
      };
    }
  });

  const completeness = profileCompleteness(profile);

  return (
    <>
      <PageHeader
        title="TENDER RADAR"
        description={
          'Поиск закупок по данным, которые вы импортировали. Приложение не '
          + 'загружает объявления с порталов само: автоматический доступ к их API '
          + 'требует разрешения и токенов, которых у приложения нет. Каждая '
          + 'найденная закупка показывается вместе с источником и датой '
          + 'актуальности данных.'
        }
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <RadarPanel
          canWrite={canWrite(session.role)}
          imports={importSummaries}
          savedSearches={savedSearches}
          profile={{
            exists: profile !== null,
            keywords: profile?.keywords ?? [],
            completeness,
          }}
          stats={{ total: opportunityCount, open: openCount }}
        />
      </div>
    </>
  );
}
