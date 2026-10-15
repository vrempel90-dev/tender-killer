/**
 * Формирование запроса коммерческого предложения (RFQ) поставщику.
 *
 * Текст составляется ТОЛЬКО из подтверждённых данных тендера.
 * Никаких вымышленных реквизитов, цен и поставщиков.
 */

export interface RfqLineItem {
  position: number;
  name: string;
  specification: string | null;
  unit: string;
  quantity: number;
}

export interface RfqParams {
  companyName: string;
  companyBin: string | null;
  contactName: string;
  contactEmail: string;
  tenderTitle: string;
  /** Срок поставки по условиям закупки, если он известен. */
  deliveryDeadline: Date | null;
  region: string | null;
  items: RfqLineItem[];
  /** Срок, до которого нужно предложение. */
  responseDeadline: Date | null;
}

/** Текст запроса КП в виде готового письма. */
export function buildRfqText(params: RfqParams): string {
  const lines: string[] = [];

  lines.push('Запрос коммерческого предложения');
  lines.push('');
  lines.push('Уважаемые коллеги!');
  lines.push('');
  lines.push(
    `${params.companyName}${params.companyBin ? ` (БИН ${params.companyBin})` : ''} `
    + `рассматривает участие в закупке «${params.tenderTitle}» `
    + 'и просит направить коммерческое предложение на поставку следующих позиций.',
  );
  lines.push('');
  lines.push('ПОЗИЦИИ:');

  if (params.items.length === 0) {
    lines.push(
      '[позиции не заполнены — добавьте их в карточке тендера перед отправкой запроса]',
    );
  } else {
    for (const item of params.items) {
      lines.push('');
      lines.push(`${item.position}. ${item.name}`);
      lines.push(
        `   Количество: ${item.quantity > 0 ? `${formatQuantity(item.quantity)} ${item.unit}` : 'уточняется'}`,
      );
      if (item.specification) {
        lines.push(`   Требования: ${item.specification}`);
      }
    }
  }

  lines.push('');
  lines.push('ПРОСИМ УКАЗАТЬ В ПРЕДЛОЖЕНИИ:');
  lines.push('1. Цену за единицу по каждой позиции и общую сумму.');
  lines.push('2. Указана ли цена с НДС или без НДС, ставку НДС.');
  lines.push('3. Являетесь ли вы плательщиком НДС.');
  lines.push('4. Срок поставки в календарных днях с даты заказа.');
  lines.push('5. Условия оплаты: размер предоплаты, срок окончательного расчёта.');
  lines.push('6. Условия доставки: входит ли она в цену, до какого адреса.');
  lines.push('7. Гарантийный срок и порядок гарантийного обслуживания.');
  lines.push('8. Срок действия коммерческого предложения.');
  lines.push('9. Соответствие предлагаемого товара указанным требованиям; при');
  lines.push('   отличиях — укажите их отдельно.');
  lines.push('10. Наличие товара на складе либо срок поставки под заказ.');

  if (params.deliveryDeadline) {
    lines.push('');
    lines.push(
      'Обращаем внимание: по условиям закупки поставка должна быть завершена '
      + `до ${formatDate(params.deliveryDeadline)}.`,
    );
  }
  if (params.region) {
    lines.push(`Место поставки: ${params.region}.`);
  }
  if (params.responseDeadline) {
    lines.push('');
    lines.push(
      `Просим направить предложение до ${formatDate(params.responseDeadline)}.`,
    );
  }

  lines.push('');
  lines.push('С уважением,');
  lines.push(params.contactName);
  lines.push(params.companyName);
  lines.push(params.contactEmail);

  return lines.join('\n');
}

function formatQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.?0+$/, '');
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('ru-KZ', { dateStyle: 'long' }).format(date);
}
