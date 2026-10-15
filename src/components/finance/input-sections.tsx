'use client';

import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { StatusNotice } from '@/components/ui/status-notice';
import { TAX_REGIME_LABELS } from '@/lib/finance/tax-config';
import type { FinanceInput, SecurityInput } from '@/lib/finance/types';
import { ItemCostLinesEditor, SimpleCostLinesEditor } from './cost-lines-editor';
import { MoneyInput, NumberInput } from './money-input';

type Patch = (updater: (current: FinanceInput) => FinanceInput) => void;

export function TenderPriceSection({
  input,
  patch,
}: {
  input: FinanceInput;
  patch: Patch;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Цена</CardTitle>
        <CardDescription>
          Трактовка НДС важна: от неё зависит, что является доходом.
          {!input.tax.isVatPayer
            ? ' Ваша компания не плательщик НДС — НДС из цены не выделяется.'
            : ''}
        </CardDescription>
      </CardHeader>
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label="Начальная стоимость тендера, ₸">
          {(id) => (
            <MoneyInput
              id={id}
              valueMinor={input.tender.startPriceMinor}
              onChangeMinor={(v) =>
                patch((c) => ({ ...c, tender: { ...c.tender, startPriceMinor: v } }))
              }
            />
          )}
        </Field>
        <Field label="Планируемая цена предложения, ₸">
          {(id) => (
            <MoneyInput
              id={id}
              valueMinor={input.tender.bidPriceMinor}
              onChangeMinor={(v) =>
                patch((c) => ({ ...c, tender: { ...c.tender, bidPriceMinor: v } }))
              }
            />
          )}
        </Field>
        <Field label="Цена предложения указана">
          {(id) => (
            <Select
              id={id}
              value={input.tender.bidPriceVatMode}
              onChange={(e) =>
                patch((c) => ({
                  ...c,
                  tender: {
                    ...c.tender,
                    bidPriceVatMode: e.target.value as 'INCLUSIVE' | 'EXCLUSIVE',
                  },
                }))
              }
            >
              <option value="INCLUSIVE">с НДС</option>
              <option value="EXCLUSIVE">без НДС</option>
            </Select>
          )}
        </Field>
        <Field label="Начальная цена указана">
          {(id) => (
            <Select
              id={id}
              value={input.tender.startPriceVatMode}
              onChange={(e) =>
                patch((c) => ({
                  ...c,
                  tender: {
                    ...c.tender,
                    startPriceVatMode: e.target.value as 'INCLUSIVE' | 'EXCLUSIVE',
                  },
                }))
              }
            >
              <option value="INCLUSIVE">с НДС</option>
              <option value="EXCLUSIVE">без НДС</option>
            </Select>
          )}
        </Field>
      </CardBody>
    </Card>
  );
}

export function TaxSection({
  input,
  patch,
  taxSourcesHref,
}: {
  input: FinanceInput;
  patch: Patch;
  taxSourcesHref: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Налоговый статус</CardTitle>
        <CardDescription>
          Ставки берутся из настроек компании с указанием источника и даты
          актуальности.{' '}
          <a
            href={taxSourcesHref}
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            Проверить источники ставок
          </a>
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Налоговый режим">
            {(id) => (
              <Select id={id} value={input.tax.regime} disabled>
                {Object.entries(TAX_REGIME_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Доля зачёта входящего НДС, %"
            help="100 % — обычный случай. Меньше — при пропорциональном методе зачёта."
          >
            {(id) => (
              <NumberInput
                id={id}
                value={input.tax.vatRecoverySharePercent}
                allowNull={false}
                max={100}
                suffix="%"
                disabled={!input.tax.isVatPayer}
                onChange={(v) =>
                  patch((c) => ({
                    ...c,
                    tax: { ...c.tax, vatRecoverySharePercent: v ?? 0 },
                  }))
                }
              />
            )}
          </Field>
        </div>

        <div className="grid gap-3 rounded-lg border border-ink-200 bg-ink-50/50 p-3 text-[12.5px] sm:grid-cols-3">
          <div>
            <p className="text-ink-400">НДС на реализацию</p>
            <p className="mt-0.5 font-medium text-ink-800">
              {input.tax.isVatPayer ? `${input.tax.vatRatePercent} %` : 'не начисляется'}
            </p>
          </div>
          <div>
            <p className="text-ink-400">НДС поставщиков</p>
            <p className="mt-0.5 font-medium text-ink-800">
              {input.tax.purchaseVatRatePercent} %
            </p>
          </div>
          <div>
            <p className="text-ink-400">Налог на доход</p>
            <p className="mt-0.5 font-medium text-ink-800">
              {input.tax.incomeTaxRatePercent} %{' '}
              {input.tax.incomeTaxBase === 'TURNOVER' ? 'с оборота' : 'с прибыли'}
            </p>
          </div>
        </div>

        {input.tax.incomeTaxBase === 'TURNOVER' ? (
          <StatusNotice severity="WARNING">
            На вашем режиме налог считается с оборота. Убыточная сделка всё равно
            создаёт налог к уплате, а безубыточная цена выше, чем при налоге с
            прибыли.
          </StatusNotice>
        ) : null}
        {!input.tax.isVatPayer ? (
          <StatusNotice severity="WARNING">
            Входящий НДС поставщиков вы не ставите в зачёт — он полностью становится
            вашим расходом и учтён в себестоимости.
          </StatusNotice>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function CostsSection({
  input,
  patch,
}: {
  input: FinanceInput;
  patch: Patch;
}) {
  const costs = input.costs;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Товары и материалы</CardTitle>
          <CardDescription>
            Отметка «Док.» означает, что цена подтверждена коммерческим
            предложением, счётом или прайс-листом. Неподтверждённые цены помечаются
            в отчёте.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <ItemCostLinesEditor
            items={costs.items}
            onChange={(items) =>
              patch((c) => ({ ...c, costs: { ...c.costs, items } }))
            }
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Доставка, логистика, таможня</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <SimpleCostLinesEditor
            lines={costs.logistics}
            onChange={(logistics) =>
              patch((c) => ({ ...c, costs: { ...c.costs, logistics } }))
            }
            addLabel="Добавить строку логистики"
            namePlaceholder="Доставка, разгрузка, монтаж"
          />

          <label className="flex items-center gap-2 text-[13px] text-ink-700">
            <input
              type="checkbox"
              checked={costs.customs.isImport}
              onChange={(e) =>
                patch((c) => ({
                  ...c,
                  costs: {
                    ...c.costs,
                    customs: { ...c.costs.customs, isImport: e.target.checked },
                  },
                }))
              }
              className="size-4 rounded border-ink-300"
            />
            Товар импортируется — есть таможенные платежи
          </label>

          {costs.customs.isImport ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="Таможенная пошлина, ₸"
                help="В зачёт по НДС не принимается"
              >
                {(id) => (
                  <MoneyInput
                    id={id}
                    valueMinor={costs.customs.dutyMinor}
                    allowNull={false}
                    onChangeMinor={(v) =>
                      patch((c) => ({
                        ...c,
                        costs: {
                          ...c.costs,
                          customs: { ...c.costs.customs, dutyMinor: v ?? 0 },
                        },
                      }))
                    }
                  />
                )}
              </Field>
              <Field
                label="НДС на импорт, ₸"
                help="Платится на границе; в зачёт идёт только у плательщика НДС"
              >
                {(id) => (
                  <MoneyInput
                    id={id}
                    valueMinor={costs.customs.importVatMinor}
                    allowNull={false}
                    onChangeMinor={(v) =>
                      patch((c) => ({
                        ...c,
                        costs: {
                          ...c.costs,
                          customs: { ...c.costs.customs, importVatMinor: v ?? 0 },
                        },
                      }))
                    }
                  />
                )}
              </Field>
              <Field label="Сборы, брокер, СВХ, ₸">
                {(id) => (
                  <MoneyInput
                    id={id}
                    valueMinor={costs.customs.feesMinor}
                    allowNull={false}
                    onChangeMinor={(v) =>
                      patch((c) => ({
                        ...c,
                        costs: {
                          ...c.costs,
                          customs: { ...c.costs.customs, feesMinor: v ?? 0 },
                        },
                      }))
                    }
                  />
                )}
              </Field>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Работы, персонал, субподряд</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Фонд оплаты труда по проекту, ₸"
              help="Начисленная заработная плата без налогов"
            >
              {(id) => (
                <MoneyInput
                  id={id}
                  valueMinor={costs.payroll.grossPayrollMinor}
                  allowNull={false}
                  onChangeMinor={(v) =>
                    patch((c) => ({
                      ...c,
                      costs: {
                        ...c.costs,
                        payroll: { ...c.costs.payroll, grossPayrollMinor: v ?? 0 },
                      },
                    }))
                  }
                />
              )}
            </Field>
            <Field
              label="Налоги и отчисления с ФОТ, %"
              help={`По умолчанию ${input.tax.payrollTaxPercent} % из настроек. Уточните у бухгалтера.`}
            >
              {(id) => (
                <NumberInput
                  id={id}
                  value={costs.payroll.payrollTaxPercentOverride}
                  suffix="%"
                  placeholder={String(input.tax.payrollTaxPercent)}
                  onChange={(v) =>
                    patch((c) => ({
                      ...c,
                      costs: {
                        ...c.costs,
                        payroll: { ...c.costs.payroll, payrollTaxPercentOverride: v },
                      },
                    }))
                  }
                />
              )}
            </Field>
          </div>

          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-700">
              Услуги субподрядчиков
            </p>
            <SimpleCostLinesEditor
              lines={costs.subcontractors}
              onChange={(subcontractors) =>
                patch((c) => ({ ...c, costs: { ...c.costs, subcontractors } }))
              }
              addLabel="Добавить субподрядчика"
              namePlaceholder="Монтажные работы, пусконаладка"
            />
          </div>

          <div>
            <p className="mb-2 text-[13px] font-medium text-ink-700">
              Прочие прямые затраты
            </p>
            <SimpleCostLinesEditor
              lines={costs.otherDirect}
              onChange={(otherDirect) =>
                patch((c) => ({ ...c, costs: { ...c.costs, otherDirect } }))
              }
              addLabel="Добавить затрату"
              namePlaceholder="Сертификация, экспертиза, упаковка"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Накладные расходы и резерв</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <SimpleCostLinesEditor
            lines={costs.overhead}
            onChange={(overhead) =>
              patch((c) => ({ ...c, costs: { ...c.costs, overhead } }))
            }
            addLabel="Добавить накладной расход"
            namePlaceholder="Офис, связь, транспорт, администрирование"
          />
          <Field
            label="Резерв на непредвиденные расходы, %"
            help="Процент от суммы всех затрат. Для длинных контрактов отсутствие резерва — основная причина убытка."
            className="max-w-xs"
          >
            {(id) => (
              <NumberInput
                id={id}
                value={costs.contingencyPercent}
                allowNull={false}
                max={100}
                suffix="%"
                onChange={(v) =>
                  patch((c) => ({
                    ...c,
                    costs: { ...c.costs, contingencyPercent: v ?? 0 },
                  }))
                }
              />
            )}
          </Field>
        </CardBody>
      </Card>
    </div>
  );
}

export function ScheduleSection({
  input,
  patch,
}: {
  input: FinanceInput;
  patch: Patch;
}) {
  const s = input.schedule;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Сроки и платежи</CardTitle>
        <CardDescription>
          Эти данные определяют кассовый разрыв. Дни считаются от начала исполнения
          договора.
        </CardDescription>
      </CardHeader>
      <CardBody className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Срок исполнения договора, дней">
          {(id) => (
            <NumberInput
              id={id}
              value={s.contractDurationDays}
              suffix="дн."
              onChange={(v) =>
                patch((c) => ({
                  ...c,
                  schedule: { ...c.schedule, contractDurationDays: v },
                }))
              }
            />
          )}
        </Field>
        <Field label="День подписания акта / поставки">
          {(id) => (
            <NumberInput
              id={id}
              value={s.deliveryDay}
              suffix="день"
              onChange={(v) =>
                patch((c) => ({ ...c, schedule: { ...c.schedule, deliveryDay: v } }))
              }
            />
          )}
        </Field>
        <Field
          label="Отсрочка оплаты после акта, дней"
          help="Сколько заказчик платит после подписания акта"
        >
          {(id) => (
            <NumberInput
              id={id}
              value={s.paymentDelayDays}
              suffix="дн."
              onChange={(v) =>
                patch((c) => ({
                  ...c,
                  schedule: { ...c.schedule, paymentDelayDays: v },
                }))
              }
            />
          )}
        </Field>
        <Field label="Аванс заказчика, %">
          {(id) => (
            <NumberInput
              id={id}
              value={s.advancePercent}
              allowNull={false}
              max={100}
              suffix="%"
              onChange={(v) =>
                patch((c) => ({
                  ...c,
                  schedule: { ...c.schedule, advancePercent: v ?? 0 },
                }))
              }
            />
          )}
        </Field>
        <Field label="День поступления аванса">
          {(id) => (
            <NumberInput
              id={id}
              value={s.advanceDay}
              allowNull={false}
              suffix="день"
              onChange={(v) =>
                patch((c) => ({ ...c, schedule: { ...c.schedule, advanceDay: v ?? 0 } }))
              }
            />
          )}
        </Field>
        <Field
          label="Гарантийное удержание заказчика, %"
          help="Часть суммы, которую заказчик удерживает до конца гарантии"
        >
          {(id) => (
            <NumberInput
              id={id}
              value={s.retentionPercent}
              allowNull={false}
              max={100}
              suffix="%"
              onChange={(v) =>
                patch((c) => ({
                  ...c,
                  schedule: { ...c.schedule, retentionPercent: v ?? 0 },
                }))
              }
            />
          )}
        </Field>
        <Field label="Возврат удержания через, дней">
          {(id) => (
            <NumberInput
              id={id}
              value={s.retentionReleaseDays}
              suffix="дн."
              onChange={(v) =>
                patch((c) => ({
                  ...c,
                  schedule: { ...c.schedule, retentionReleaseDays: v },
                }))
              }
            />
          )}
        </Field>
        <Field label="Предоплата поставщикам, %">
          {(id) => (
            <NumberInput
              id={id}
              value={s.procurementPrepaymentPercent}
              allowNull={false}
              max={100}
              suffix="%"
              onChange={(v) =>
                patch((c) => ({
                  ...c,
                  schedule: { ...c.schedule, procurementPrepaymentPercent: v ?? 0 },
                }))
              }
            />
          )}
        </Field>
        <Field label="День начала закупки">
          {(id) => (
            <NumberInput
              id={id}
              value={s.procurementStartDay}
              allowNull={false}
              suffix="день"
              onChange={(v) =>
                patch((c) => ({
                  ...c,
                  schedule: { ...c.schedule, procurementStartDay: v ?? 0 },
                }))
              }
            />
          )}
        </Field>
      </CardBody>
    </Card>
  );
}

export function SecuritiesSection({
  input,
  patch,
}: {
  input: FinanceInput;
  patch: Patch;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Обеспечения и гарантии</CardTitle>
        <CardDescription>
          Обеспечение — возвратная сумма. В расходы попадает только комиссия банка
          за гарантию либо стоимость собственных денег за срок блокировки.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-5">
        <SecurityEditor
          title="Обеспечение заявки на участие"
          baseHint="процент считается от начальной цены закупки"
          security={input.securities.bid}
          onChange={(bid) =>
            patch((c) => ({ ...c, securities: { ...c.securities, bid } }))
          }
        />
        <SecurityEditor
          title="Обеспечение исполнения договора"
          baseHint="процент считается от суммы договора"
          security={input.securities.performance}
          onChange={(performance) =>
            patch((c) => ({ ...c, securities: { ...c.securities, performance } }))
          }
        />
        <div className="grid gap-4 border-t border-ink-100 pt-4 sm:grid-cols-2">
          <Field label="Гарантийный срок, месяцев">
            {(id) => (
              <NumberInput
                id={id}
                value={input.warranty.months}
                suffix="мес."
                onChange={(v) =>
                  patch((c) => ({ ...c, warranty: { ...c.warranty, months: v } }))
                }
              />
            )}
          </Field>
          <Field
            label="Резерв на гарантийные обязательства, %"
            help="Процент от выручки без НДС на будущее обслуживание и замену"
          >
            {(id) => (
              <NumberInput
                id={id}
                value={input.warranty.reservePercentOfRevenue}
                allowNull={false}
                max={100}
                suffix="%"
                onChange={(v) =>
                  patch((c) => ({
                    ...c,
                    warranty: { ...c.warranty, reservePercentOfRevenue: v ?? 0 },
                  }))
                }
              />
            )}
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}

function SecurityEditor({
  title,
  baseHint,
  security,
  onChange,
}: {
  title: string;
  baseHint: string;
  security: SecurityInput;
  onChange: (next: SecurityInput) => void;
}) {
  return (
    <div className="rounded-lg border border-ink-200 p-3.5">
      <p className="text-[13px] font-medium text-ink-800">{title}</p>
      <div className="mt-3 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Форма">
          {(id) => (
            <Select
              id={id}
              value={security.form}
              onChange={(e) =>
                onChange({ ...security, form: e.target.value as SecurityInput['form'] })
              }
            >
              <option value="NONE">не требуется</option>
              <option value="CASH_DEPOSIT">денежный залог</option>
              <option value="BANK_GUARANTEE">банковская гарантия</option>
            </Select>
          )}
        </Field>
        {security.form !== 'NONE' ? (
          <>
            <Field label="Размер, %" help={baseHint}>
              {(id) => (
                <NumberInput
                  id={id}
                  value={security.percentOfBase}
                  max={100}
                  suffix="%"
                  onChange={(v) => onChange({ ...security, percentOfBase: v })}
                />
              )}
            </Field>
            <Field label="Либо сумма, ₸" help="имеет приоритет над процентом">
              {(id) => (
                <MoneyInput
                  id={id}
                  valueMinor={security.amountMinor}
                  onChangeMinor={(v) => onChange({ ...security, amountMinor: v })}
                />
              )}
            </Field>
            <Field label="Срок, дней">
              {(id) => (
                <NumberInput
                  id={id}
                  value={security.heldDays}
                  suffix="дн."
                  onChange={(v) => onChange({ ...security, heldDays: v })}
                />
              )}
            </Field>
            {security.form === 'BANK_GUARANTEE' ? (
              <>
                <Field label="Комиссия банка, % годовых">
                  {(id) => (
                    <NumberInput
                      id={id}
                      value={security.guaranteeFeePercentAnnual}
                      allowNull={false}
                      suffix="%"
                      onChange={(v) =>
                        onChange({ ...security, guaranteeFeePercentAnnual: v ?? 0 })
                      }
                    />
                  )}
                </Field>
                <Field label="Фиксированная комиссия, ₸">
                  {(id) => (
                    <MoneyInput
                      id={id}
                      valueMinor={security.guaranteeFeeFixedMinor}
                      allowNull={false}
                      onChangeMinor={(v) =>
                        onChange({ ...security, guaranteeFeeFixedMinor: v ?? 0 })
                      }
                    />
                  )}
                </Field>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export function FinancingSection({
  input,
  patch,
}: {
  input: FinanceInput;
  patch: Patch;
}) {
  const f = input.financing;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Банк, финансирование и цели</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Field
            label="Банковская комиссия, % от поступлений"
            help="РКО, переводы, эквайринг"
          >
            {(id) => (
              <NumberInput
                id={id}
                value={f.bankFeePercentOfRevenue}
                allowNull={false}
                max={100}
                suffix="%"
                onChange={(v) =>
                  patch((c) => ({
                    ...c,
                    financing: { ...c.financing, bankFeePercentOfRevenue: v ?? 0 },
                  }))
                }
              />
            )}
          </Field>
          <Field label="Фиксированные банковские расходы, ₸">
            {(id) => (
              <MoneyInput
                id={id}
                valueMinor={f.bankFeeFixedMinor}
                allowNull={false}
                onChangeMinor={(v) =>
                  patch((c) => ({
                    ...c,
                    financing: { ...c.financing, bankFeeFixedMinor: v ?? 0 },
                  }))
                }
              />
            )}
          </Field>
          <Field
            label="Стоимость собственных средств, % годовых"
            help="Применяется к деньгам, замороженным в залоге"
          >
            {(id) => (
              <NumberInput
                id={id}
                value={f.ownCapitalOpportunityRatePercent}
                allowNull={false}
                suffix="%"
                onChange={(v) =>
                  patch((c) => ({
                    ...c,
                    financing: {
                      ...c.financing,
                      ownCapitalOpportunityRatePercent: v ?? 0,
                    },
                  }))
                }
              />
            )}
          </Field>
        </div>

        <label className="flex items-start gap-2 text-[13px] text-ink-700">
          <input
            type="checkbox"
            checked={f.autoFinancePeakGap}
            onChange={(e) =>
              patch((c) => ({
                ...c,
                financing: { ...c.financing, autoFinancePeakGap: e.target.checked },
              }))
            }
            className="mt-0.5 size-4 rounded border-ink-300"
          />
          <span>
            Считать потребность в кредите автоматически — по пиковому кассовому
            разрыву из прогноза ДДС
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          {!f.autoFinancePeakGap ? (
            <Field label="Сумма кредита, ₸">
              {(id) => (
                <MoneyInput
                  id={id}
                  valueMinor={f.loanAmountMinor}
                  onChangeMinor={(v) =>
                    patch((c) => ({
                      ...c,
                      financing: { ...c.financing, loanAmountMinor: v },
                    }))
                  }
                />
              )}
            </Field>
          ) : null}
          <Field label="Годовая ставка по займу, %">
            {(id) => (
              <NumberInput
                id={id}
                value={f.loanAnnualRatePercent}
                suffix="%"
                onChange={(v) =>
                  patch((c) => ({
                    ...c,
                    financing: { ...c.financing, loanAnnualRatePercent: v },
                  }))
                }
              />
            )}
          </Field>
          <Field
            label="Срок использования займа, дней"
            help="Если не указать, берётся срок дефицита по прогнозу ДДС"
          >
            {(id) => (
              <NumberInput
                id={id}
                value={f.loanTermDays}
                suffix="дн."
                onChange={(v) =>
                  patch((c) => ({
                    ...c,
                    financing: { ...c.financing, loanTermDays: v },
                  }))
                }
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 border-t border-ink-100 pt-4 sm:grid-cols-2">
          <Field label="Целевая чистая прибыль, ₸" help="либо укажите целевую маржу">
            {(id) => (
              <MoneyInput
                id={id}
                valueMinor={input.targets.targetNetProfitMinor}
                onChangeMinor={(v) =>
                  patch((c) => ({
                    ...c,
                    targets: { ...c.targets, targetNetProfitMinor: v },
                  }))
                }
              />
            )}
          </Field>
          <Field label="Целевая чистая маржа, %">
            {(id) => (
              <NumberInput
                id={id}
                value={input.targets.targetNetMarginPercent}
                max={100}
                suffix="%"
                onChange={(v) =>
                  patch((c) => ({
                    ...c,
                    targets: { ...c.targets, targetNetMarginPercent: v },
                  }))
                }
              />
            )}
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}
