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

# Миграции, схема и seed нужны для запуска db:deploy в контейнере
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/dotenv ./node_modules/dotenv

# Каталог для документов пользователей. В образ документы не попадают.
RUN mkdir -p /app/storage && chown nextjs:nodejs /app/storage
VOLUME ["/app/storage"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
