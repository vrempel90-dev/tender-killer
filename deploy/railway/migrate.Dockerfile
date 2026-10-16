# Complete migration/seed graph from the same lockfile as the application.
# A separate service with DDL credentials; never the public web runtime.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src/lib/finance/tax-config.ts ./src/lib/finance/tax-config.ts
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build ./node_modules/.bin/prisma generate
USER node
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx prisma/seed.ts"]
