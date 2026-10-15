import type { Metadata, Viewport } from 'next';
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
