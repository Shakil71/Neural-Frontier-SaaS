import { defineConfig } from "prisma/config";

// DATABASE_URL is only needed by migrate/introspect commands, not by `prisma generate`.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node dist/seed.js",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "mysql://placeholder@localhost:3306/placeholder",
  },
});
