import { isStaging } from '@/lib/deployment';

export function StagingNotice() {
  if (!isStaging()) return null;
  return <aside aria-label="Тестовая версия" className="border-b border-amber-300 bg-amber-50 px-5 py-3 text-center text-sm text-amber-950">
    <p className="font-semibold">TENDER KILLER — TEST / STAGING</p>
    <p className="mt-1">Это тестовая версия с отдельной базой данных. Для входа требуется тестовая учётная запись</p>
  </aside>;
}
