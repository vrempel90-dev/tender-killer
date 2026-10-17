# Validation-only migrator: isolated database with real RLS runtime role.
# Never point this image at production without an approved migration plan.
FROM node:22-alpine
RUN apk add --no-cache postgresql18-client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src/lib/finance/tax-config.ts ./src/lib/finance/tax-config.ts
COPY scripts/db-roles.sql ./scripts/db-roles.sql
COPY scripts/revoke-staging-totp.mjs ./scripts/revoke-staging-totp.mjs
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build ./node_modules/.bin/prisma generate
USER node
CMD ["sh", "-c", "set -eu; ./node_modules/.bin/prisma migrate deploy; ./node_modules/.bin/tsx prisma/seed.ts; node scripts/revoke-staging-totp.mjs; psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -v app_user=\"$APP_DB_USER\" -v app_password=\"$APP_DB_PASSWORD\" -f scripts/db-roles.sql"]
