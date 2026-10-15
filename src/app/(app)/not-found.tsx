import { FileQuestion } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';

export default function AppNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="max-w-md text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-ink-100">
          <FileQuestion className="size-5 text-ink-500" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink-900">
          Страница или запись не найдена
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
          Возможно, запись удалена или принадлежит другой компании. Данные
          компаний в системе изолированы.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <ButtonLink href="/tenders">Мои тендеры</ButtonLink>
          <ButtonLink href="/dashboard" variant="outline">
            На главную
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
