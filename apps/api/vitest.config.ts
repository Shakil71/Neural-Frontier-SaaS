import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC (not esbuild) so decorator metadata is emitted — NestJS DI depends on it.
const decorators = swc.vite({
  jsc: {
    parser: { syntax: "typescript", decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true, useDefineForClassFields: false },
    target: "es2023",
  },
});

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [decorators],
        test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" },
      },
      {
        plugins: [decorators],
        test: {
          name: "integration",
          include: ["test/**/*.int.test.ts"],
          environment: "node",
          globalSetup: ["test/global-setup.ts"],
          // One database: run files sequentially to keep fixtures deterministic.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
