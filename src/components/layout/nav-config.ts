import {
  BadgeCheck,
  Banknote,
  FileSearch,
  FileText,
  Gauge,
  LayoutDashboard,
  type LucideIcon,
  PackageSearch,
  Plus,
  Radar,
  Settings,
  TrendingUp,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Статус раздела. Правило проекта: неработающих кнопок нет —
   * если раздел ограничен, это видно в интерфейсе.
   */
  status?: 'READY' | 'NEEDS_AI_KEY' | 'NEEDS_DATA';
  description?: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Главная',
    icon: LayoutDashboard,
    status: 'READY',
  },
  {
    href: '/tenders',
    label: 'Мои тендеры',
    icon: FileText,
    status: 'READY',
  },
  {
    href: '/tenders/new',
    label: 'Новый анализ',
    icon: Plus,
    status: 'READY',
  },
  {
    href: '/radar',
    label: 'TENDER RADAR',
    icon: Radar,
    status: 'NEEDS_DATA',
    description: 'Поиск закупок по импортированным выгрузкам',
  },
  {
    href: '/finance',
    label: 'Финансовая аналитика',
    icon: Banknote,
    status: 'READY',
    description: 'Экономика сделки, ДДС, сценарии',
  },
  {
    href: '/compliance',
    label: 'Проверка документов',
    icon: BadgeCheck,
    status: 'NEEDS_AI_KEY',
    description: 'Извлечение требований и сопоставление',
  },
  {
    href: '/market',
    label: 'Аналитика конкурентов',
    icon: TrendingUp,
    status: 'NEEDS_DATA',
    description: 'Импорт завершённых закупок',
  },
  {
    href: '/sourcing',
    label: 'AI-Снабженец',
    icon: PackageSearch,
    status: 'READY',
    description: 'Позиции, КП поставщиков, себестоимость',
  },
  {
    href: '/contracts',
    label: 'Анализ договоров',
    icon: FileSearch,
    status: 'NEEDS_AI_KEY',
    description: 'Риски проекта договора',
  },
  {
    href: '/reports',
    label: 'Отчёты',
    icon: Gauge,
    status: 'READY',
  },
  {
    href: '/settings',
    label: 'Настройки',
    icon: Settings,
    status: 'READY',
  },
];

export const STATUS_LABELS: Record<
  NonNullable<NavItem['status']>,
  { label: string; tone: 'positive' | 'caution' | 'neutral' }
> = {
  READY: { label: 'Работает', tone: 'positive' },
  NEEDS_AI_KEY: { label: 'Нужен ключ AI', tone: 'caution' },
  NEEDS_DATA: { label: 'Нужны данные', tone: 'neutral' },
};
