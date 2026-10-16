import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Пакеты, которые должны исполняться в Node.js runtime без бандлинга:
  // они используют нативные/файловые зависимости.
  serverExternalPackages: ['pdfjs-dist', 'pdfkit', 'exceljs', 'mammoth', '@prisma/client'],
  output: 'standalone',
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    ];
    // HSTS имеет смысл только там, где сайт отдаётся по HTTPS.
    if (process.env.NODE_ENV === 'production') {
      common.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains',
      });
    }
    return [
      { source: '/(.*)', headers: common },
      {
        // Для страниц CSP задаётся в proxy.ts: там есть одноразовый nonce.
        // Два заголовка CSP применяются оба, поэтому здесь только API.
        source: '/api/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox",
          },
        ],
      },
    ];
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
