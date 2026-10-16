# ─────────────────────────── Сборка ───────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Зависимости устанавливаются отдельным слоем для кеширования
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Prisma CLI reads DATABASE_URL when loading prisma.config.ts even for client generation.
# A non-routable placeholder is used only during image build: no real DB is contacted.
# The production DATABASE_URL is injected by Railway at container runtime.
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npx prisma generate
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build

# Isolated production migration tooling: install its complete dependency graph.
# Avoid copying every build-time development dependency into the runtime image.
FROM node:22-alpine AS migration-tools
WORKDIR /tools
RUN printf '{}\n' > package.json \
 && npm install --no-audit --no-fund --no-save prisma@7.10.0 tsx@4.23.15

# ─────────────────────────── Запуск ───────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Приложение работает под непривилегированным пользователем
# Шрифт с поддержкой кириллицы нужен для генерации PDF-отчётов.
RUN apk add --no-cache font-dejavu

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# standalone-сборка Next.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Runtime CLI and transitive dependencies for Prisma migrations and tax reference seeding.
# Keep them complete: partial copies break the Prisma CLI (e.g. missing "effect").
COPY --from=migration-tools --chown=nextjs:nodejs /tools/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/finance/tax-config.ts ./src/lib/finance/tax-config.ts

# Каталог для документов пользователей. В образ документы не попадают.
RUN mkdir -p /app/storage && chown nextjs:nodejs /app/storage

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
