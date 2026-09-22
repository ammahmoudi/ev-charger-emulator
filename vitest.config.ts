import path from "node:path";

import { defineConfig } from "vitest/config";

// A handful of `src/lib/device-instances/**` tests are integration tests against the local
// Postgres from `docker-compose.yml` (persistence is most of what that module owns — mocking
// Prisma would test very little; see AUDIT-state.md). They need `DATABASE_URL`, which the app
// itself gets from `.env` via Next.js's own env loading, but `vitest` doesn't load `.env` on its
// own — so load it here. Missing/unreadable `.env` isn't fatal: those tests use
// `describe.skipIf(!process.env.DATABASE_URL)` and skip cleanly when it's absent.
try {
  process.loadEnvFile(path.resolve(__dirname, ".env"));
} catch {
  // No .env (e.g. `cp .env.example .env` hasn't been run yet) — DB-backed tests will skip.
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
