import type { Metadata } from 'next';
import { requireWriteAccess } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TenderForm } from './tender-form';

export const metadata: Metadata = { title: 'Новый анализ' };

export default async function NewTenderPage() {
  await requireWriteAccess();

  return (
    <>
      <PageHeader
        title="Новый анализ тендера"
        description="Шаг 1 из 5. Создайте карточку закупки — дальше загрузите документы, подтвердите извлечённые данные и посчитайте экономику."
      />
      <div className="flex-1 px-5 py-5 sm:px-7">
        <div className="max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Данные закупки</CardTitle>
              <CardDescription>
                Обязательно только название. Остальные поля можно заполнить позже —
                незаполненные данные платформа не домысливает, а показывает как
                отсутствующие.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <TenderForm />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
