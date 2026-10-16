'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogOut, Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV_ITEMS } from './nav-config';

function isActive(pathname: string, href: string): boolean {
  if (href === '/tenders/new') return pathname === '/tenders/new';
  if (href === '/tenders') {
    return pathname === '/tenders' || /^\/tenders\/(?!new$)/.test(pathname);
  }
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  companyName,
  userName,
  roleLabel,
  aiConfigured,
}: {
  companyName: string;
  userName: string;
  roleLabel: string;
  aiConfigured: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3 scrollbar-slim">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        const blocked = item.status === 'NEEDS_AI_KEY' && !aiConfigured;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors',
              active
                ? 'bg-brand-600 font-medium text-white'
                : 'text-ink-300 hover:bg-ink-800/70 hover:text-white',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {blocked ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-amber-400"
                title="Требуется настройка AI-модели"
                aria-label="Требуется настройка AI-модели"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Мобильная шапка */}
      <div className="flex items-center justify-between border-b border-ink-200 bg-white px-4 py-3 lg:hidden">
        <span className="text-[12px] font-semibold tracking-[0.18em] text-ink-900">
          TENDER KILLER
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
          aria-label="Открыть меню"
        >
          <Menu className="size-5" aria-hidden />
        </button>
      </div>

      {/* Мобильное меню */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink-950/50"
            onClick={() => setOpen(false)}
            aria-label="Закрыть меню"
          />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-ink-950">
            <div className="flex items-center justify-between px-4 py-4">
              <span className="text-[12px] font-semibold tracking-[0.18em] text-white">
                TENDER KILLER
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800"
                aria-label="Закрыть меню"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            {nav}
            <SidebarFooter
              companyName={companyName}
              userName={userName}
              roleLabel={roleLabel}
              onLogout={handleLogout}
            />
          </div>
        </div>
      ) : null}

      {/* Постоянное меню на десктопе */}
      <aside className="hidden w-[248px] shrink-0 flex-col bg-ink-950 lg:flex">
        <div className="px-5 py-5">
          <span className="text-[12px] font-semibold tracking-[0.18em] text-white">
            TENDER KILLER
          </span>
          <p className="mt-1 truncate text-[11.5px] text-ink-500" title={companyName}>
            {companyName}
          </p>
        </div>
        {nav}
        <SidebarFooter
          companyName={companyName}
          userName={userName}
          roleLabel={roleLabel}
          onLogout={handleLogout}
        />
      </aside>
    </>
  );
}

function SidebarFooter({
  userName,
  roleLabel,
  onLogout,
}: {
  companyName: string;
  userName: string;
  roleLabel: string;
  onLogout: () => void;
}) {
  return (
    <div className="border-t border-ink-800 px-3 py-3">
      <div className="flex items-center gap-2.5 px-1.5 py-1">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600/20 text-[12px] font-semibold text-brand-300">
          {userName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-white">{userName}</p>
          <p className="text-[11.5px] text-ink-500">{roleLabel}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onLogout}
        className="mt-2 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-400 transition-colors hover:bg-ink-800/70 hover:text-white"
      >
        <LogOut className="size-4" aria-hidden />
        Выйти
      </button>
    </div>
  );
}
