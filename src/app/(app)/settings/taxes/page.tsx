import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import { prisma } from '@/lib/db';
import { requireSession } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusNotice } from '@/components/ui/status-notice';
import { TAX_CONFIG_VERSION } from '@/lib/finance/tax-config';
import { TaxRateEditor } from './tax-rate-editor';

export const metadata: Metadata = { title: 'Налоговые ставки' };

export default async function TaxesPage() {
  const session = await requireSession();
  const rates = await prisma.taxRateConfig.findMany({
    orderBy: [{ key: 'asc' }, { effectiveFrom: 'desc' }],
  });

  const unverified = rates.filter((r) =>
    (r.notes ?? '').includes('ТРЕБУЕТ СВЕРКИ'),
  );

  const canEdit = session.role === 'OWNER' || session.role === 'ADMIN';

  return (
    <>
      <PageHeader
        title="Налоговые ставки и нормативы"
        description={`Конфигурация расчётов, версия ${TAX_CONFIG_VERSION}. Каждая ставка имеет источник и дату начала действия.`}
      />
      <div className="flex-1 space-y-5 px-5 py-5 sm:px-7">
        <StatusNotice severity="INFO" title="Почему ставки настраиваются, а не «вшиты» в код">
          Налоговое законодательство меняется. Расчёт экономики тендера должен
          опираться на действующую норму с проверяемым источником, поэтому ставки
          хранятся как данные: их можно изменить, не меняя программу. Версия
          конфигурации сохраняется в каждом расчёте — по ней видно, по каким
          правилам он сделан.
        </StatusNotice>

        {unverified.length > 0 ? (
          <StatusNotice
            severity="WARNING"
            title={`${unverified.length} ставок требуют сверки с первоисточником`}
          >
            Эти значения взяты из обзорных публикаций, а не из официального текста
            нормы. До сверки с Налоговым кодексом и разъяснениями Комитета
            государственных доходов используйте их с осторожностью: ставки
            напрямую влияют на расчётную прибыль.
          </StatusNotice>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Действующие ставки</CardTitle>
            <CardDescription>
              Значения в процентах, кроме МРП (в тенге) и порога по НДС (в МРП).
            </CardDescription>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                    <th className="px-5 py-2.5 font-medium">Норматив</th>
                    <th className="px-5 py-2.5 text-right font-medium">Значение</th>
                    <th className="px-5 py-2.5 font-medium">Действует с</th>
                    <th className="px-5 py-2.5 font-medium">Источник</th>
                    <th className="px-5 py-2.5 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((rate) => {
                    const needsCheck = (rate.notes ?? '').includes('ТРЕБУЕТ СВЕРКИ');
                    return (
                      <tr
                        key={rate.id}
                        className="border-b border-ink-50 align-top last:border-0"
                      >
                        <td className="px-5 py-3">
                          <p className="font-medium text-ink-900">{rate.label}</p>
                          <p className="mt-0.5 font-mono text-[11.5px] text-ink-400">
                            {rate.key}
                          </p>
                          {rate.notes ? (
                            <p className="mt-1 max-w-md text-[12px] leading-relaxed text-ink-500">
                              {rate.notes.replace('⚠️ ТРЕБУЕТ СВЕРКИ С ПЕРВОИСТОЧНИКОМ. ', '')}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {canEdit ? (
                            <TaxRateEditor
                              rateId={rate.id}
                              value={Number(rate.ratePercent)}
                            />
                          ) : (
                            <span className="tabular font-medium text-ink-900">
                              {Number(rate.ratePercent)}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-ink-600">
                          {new Intl.DateTimeFormat('ru-KZ', {
                            dateStyle: 'medium',
                          }).format(rate.effectiveFrom)}
                          {rate.effectiveTo ? (
                            <span className="block text-[12px] text-ink-400">
                              до{' '}
                              {new Intl.DateTimeFormat('ru-KZ', {
                                dateStyle: 'medium',
                              }).format(rate.effectiveTo)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-5 py-3">
                          <p className="max-w-xs text-[12.5px] leading-relaxed text-ink-600">
                            {rate.sourceTitle}
                          </p>
                          {rate.sourceUrl ? (
                            <a
                              href={rate.sourceUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:text-brand-700"
                            >
                              Открыть источник
                              <ExternalLink className="size-3" aria-hidden />
                            </a>
                          ) : null}
                        </td>
                        <td className="px-5 py-3">
                          {needsCheck ? (
                            <Badge tone="caution">требует сверки</Badge>
                          ) : (
                            <Badge tone="positive">сверено</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Как режим влияет на расчёт</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-ink-100 text-left text-[12px] uppercase tracking-wide text-ink-400">
                  <th className="px-5 py-2.5 font-medium">Режим</th>
                  <th className="px-5 py-2.5 font-medium">НДС по внутренним оборотам</th>
                  <th className="px-5 py-2.5 font-medium">База налога на доход</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Общеустановленный, плательщик НДС', 'да', 'прибыль'],
                  ['Общеустановленный, не плательщик НДС', 'нет', 'прибыль'],
                  ['Упрощённая декларация (СНР)', 'нет', 'оборот'],
                  ['Розничный налог (СНР)', 'нет', 'оборот'],
                  ['ИП, общеустановленный режим', 'да', 'прибыль'],
                ].map(([regime, vat, base]) => (
                  <tr key={regime} className="border-b border-ink-50 last:border-0">
                    <td className="px-5 py-2.5 text-ink-700">{regime}</td>
                    <td className="px-5 py-2.5 text-ink-600">{vat}</td>
                    <td className="px-5 py-2.5">
                      {base === 'оборот' ? (
                        <Badge tone="caution">оборот</Badge>
                      ) : (
                        <span className="text-ink-600">прибыль</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-ink-100 px-5 py-3 text-[12.5px] leading-relaxed text-ink-500">
              На режимах с базой «оборот» налог начисляется независимо от
              прибыли: убыточная сделка всё равно создаёт налоговое
              обязательство, а безубыточная цена выше, чем при налоге с прибыли.
              Платформа учитывает это и предупреждает в расчёте.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
