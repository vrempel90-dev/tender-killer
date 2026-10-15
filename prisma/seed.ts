/**
 * Наполнение справочников. ВАЖНО: сюда попадают только НОРМАТИВНЫЕ данные
 * (налоговые ставки с источниками). Демонстрационные тендеры, поставщики,
 * цены и исторические закупки здесь НЕ создаются: приложение не должно
 * зависеть от выдуманных данных.
 *
 * Запуск: npm run db:seed
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_TAX_RATES } from '../src/lib/finance/tax-config';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL не задан. Скопируйте .env.example в .env');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  console.log('Загрузка налоговых ставок с указанием источников…');
  let created = 0;
  for (const rate of DEFAULT_TAX_RATES) {
    const effectiveFrom = new Date(`${rate.effectiveFrom}T00:00:00.000Z`);
    await prisma.taxRateConfig.upsert({
      where: { key_effectiveFrom: { key: rate.key, effectiveFrom } },
      update: {
        label: rate.label,
        ratePercent: rate.ratePercent,
        sourceTitle: rate.sourceTitle,
        sourceUrl: rate.sourceUrl,
        effectiveTo: rate.effectiveTo
          ? new Date(`${rate.effectiveTo}T00:00:00.000Z`)
          : null,
        notes: rate.needsVerification
          ? `⚠️ ТРЕБУЕТ СВЕРКИ С ПЕРВОИСТОЧНИКОМ. ${rate.notes ?? ''}`.trim()
          : (rate.notes ?? null),
      },
      create: {
        key: rate.key,
        label: rate.label,
        ratePercent: rate.ratePercent,
        sourceTitle: rate.sourceTitle,
        sourceUrl: rate.sourceUrl,
        effectiveFrom,
        effectiveTo: rate.effectiveTo
          ? new Date(`${rate.effectiveTo}T00:00:00.000Z`)
          : null,
        notes: rate.needsVerification
          ? `⚠️ ТРЕБУЕТ СВЕРКИ С ПЕРВОИСТОЧНИКОМ. ${rate.notes ?? ''}`.trim()
          : (rate.notes ?? null),
      },
    });
    created += 1;
  }
  console.log(`Готово: ${created} ставок записано в tax_rate_configs.`);
  console.log(
    'Демонстрационные тендеры и поставщики не создаются — приложение работает '
    + 'только на ваших данных.',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
