# ─────────────────────────── Сборка ───────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Зависимости устанавливаются отдельным слоем для кеширования
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Prisma Client генерируется до сборки Next.js
RUN npx prisma generate

# DATABASE_URL на этапе сборки не нужен: страницы рендерятся по запросу.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Parser worker dependencies must be present even when Next tree-shakes a parser.
FROM node:22-alpine AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=peer --ignore-scripts --no-audit --no-fund

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

# Runtime executes Node only. Keep npm, migration CLI and build tooling out of it.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# standalone-сборка Next.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=production-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.workers ./.workers

# Migration/seed tools run in a separate one-shot builder service, never at app startup.

# Каталог для документов пользователей. В образ документы не попадают.
RUN mkdir -p /app/storage && chown nextjs:nodejs /app/storage
VOLUME ["/app/storage"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
