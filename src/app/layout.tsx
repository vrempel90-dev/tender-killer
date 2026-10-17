import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { StagingNotice } from '@/components/layout/staging-notice';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'TENDER KILLER — анализ тендеров Казахстана',
    template: '%s · TENDER KILLER',
  },
  description:
    'AI-платформа анализа государственных и корпоративных закупок Казахстана: '
    + 'экономика сделки, проверка документов, риски договора.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Docker images are built without staging variables and reused across environments.
  await connection();
  return (
    <html lang="ru">
      <body><StagingNotice />{children}</body>
    </html>
  );
}
