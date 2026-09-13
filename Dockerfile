# syntax=docker/dockerfile:1
#
# Optional "run everything in Docker" path for issue #7. The primary, documented dev flow
# is still `npm run dev` locally against `docker compose up -d postgres` (see README) — this
# image is for when you'd rather not install Node at all. See docker-compose.yml's `full`
# profile.

FROM node:22-alpine AS base
WORKDIR /app
# Prisma's query engine dynamically links against OpenSSL; Alpine doesn't ship it by default.
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npx prisma generate
RUN npm run build

# Full toolchain (Prisma CLI + tsx), used by the one-off `migrate` compose service to run
# migrations and the seed script against the compose Postgres — not part of the app image.
FROM builder AS migrator
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

# Minimal production runtime: just the traced `next build` standalone server, no
# devDependencies, no Prisma CLI, no app source.
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
