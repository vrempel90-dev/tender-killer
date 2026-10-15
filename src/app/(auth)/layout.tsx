import { ShieldCheck } from 'lucide-react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Левая панель: позиционирование продукта */}
      <aside className="hidden bg-ink-950 px-10 py-12 lg:flex lg:w-[46%] lg:flex-col lg:justify-between xl:px-16">
        <div>
          <p className="text-[13px] font-semibold tracking-[0.2em] text-brand-300">
            TENDER KILLER
          </p>
          <h1 className="mt-8 max-w-md text-[32px] font-semibold leading-[1.2] text-white">
            Пять вопросов перед участием в тендере — с расчётом, а не на глаз
          </h1>
          <ul className="mt-8 space-y-3.5 text-[14px] leading-relaxed text-ink-300">
            {[
              'Стоит ли участвовать в этой закупке',
              'Сколько останется после всех расходов и налогов',
              'Какие ошибки есть в документах заявки',
              'Какова подтверждённая закупочная стоимость',
              'Где финансовые и договорные риски',
            ].map((item, index) => (
              <li key={item} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-[11px] font-semibold text-brand-300">
                  {index + 1}
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-start gap-2.5 rounded-lg border border-ink-800 bg-ink-900/60 px-4 py-3 text-[12px] leading-relaxed text-ink-400">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />
          <p>
            Данные каждой компании изолированы. Документы хранятся вне репозитория,
            доступ проверяется на сервере, операции пишутся в журнал.
          </p>
        </div>
      </aside>

      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
    </div>
  );
}
