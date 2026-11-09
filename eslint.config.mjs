import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

const webFiles = ["apps/web/**/*.{ts,tsx,js,mjs}"];
// Next's presets target every file by default; confine them (and their parser) to the web app.
const scopeToWeb = (configs) =>
  configs.map((c) => (c.ignores && Object.keys(c).length === 1 ? c : { ...c, files: webFiles }));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "packages/db/src/generated/**",
      "apps/web/playwright-report/**",
      "apps/web/test-results/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  // Nest relies on runtime class references for DI; type-only imports would break injection.
  {
    files: ["apps/api/src/**/*.ts"],
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  // CLIs and dev tools print to stdout by design.
  {
    files: ["packages/db/src/seed.ts", "apps/api/src/openapi.ts", "tools/**/*.{js,mjs}"],
    rules: { "no-console": "off" },
  },
  ...scopeToWeb(nextVitals),
  ...scopeToWeb(nextTs),
  {
    files: webFiles,
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: "apps/web" } },
    // App Router only: there is no pages/ directory.
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
);
