import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Пакеты, которые должны исполняться в Node.js runtime без бандлинга:
  // они используют нативные/файловые зависимости.
  serverExternalPackages: ['pdfjs-dist', 'pdfkit', 'exceljs', 'mammoth', '@prisma/client'],
  output: 'standalone',
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
    ] }];
  },
  // Не генерировать AGENTS.md в репозитории
  agentRules: false,
  typedRoutes: false,
  experimental: {
    // Лимит на размер payload server actions (загрузка файлов идёт через API routes).
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
