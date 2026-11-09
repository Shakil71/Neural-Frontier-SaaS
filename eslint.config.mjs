import { readdirSync } from "node:fs";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import globals from "globals";
import tseslint from "typescript-eslint";

const webFiles = ["apps/web/**/*.{ts,tsx,js,mjs}"];

/**
 * Architecture boundaries (docs/architecture/overview.md). CI fails on an import that crosses them.
 * - contracts: pure, browser-safe schemas. No database, Node built-ins, framework or app code.
 * - db: data access only. Never imports an app.
 * - web: never touches the database or API internals; talks to the API over HTTP. A feature
 *   folder never imports another feature (shared code lives in components/ or lib/).
 * - api modules: may use another module's services, never its controllers, and never the
 *   process entry points (app/worker modules, main, bootstrap).
 * One config per file set: ESLint replaces (does not merge) a rule set by several configs.
 */
function boundaries() {
  const rule = (groups) => ({
    "no-restricted-imports": [
      "error",
      { patterns: groups.map(([group, message]) => ({ group, message })) },
    ],
  });
  const webRules = [
    [["@nf/db", "@nf/db/*"], "The web app must not access the database; call the API."],
    [["**/apps/api/**", "@nestjs/*"], "The web app must not import API code; use @nf/contracts."],
  ];
  const featuresDir = new URL("./apps/web/src/features/", import.meta.url);
  const features = readdirSync(featuresDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  return [
    {
      files: ["packages/contracts/src/**/*.ts"],
      rules: rule([
        [["@nf/db", "@nf/db/*", "**/apps/**"], "Contracts are shared and must stay independent."],
        [["node:*", "@nestjs/*", "react", "next", "next/*"], "Contracts must stay browser-safe."],
      ]),
    },
    {
      files: ["packages/db/src/**/*.ts"],
      rules: rule([
        [["**/apps/**", "@nestjs/*", "react", "next/*"], "The db package never imports apps."],
      ]),
    },
    {
      files: ["apps/web/src/**/*.{ts,tsx}"],
      ignores: ["apps/web/src/features/**"],
      rules: rule(webRules),
    },
    ...features.map((feature) => ({
      files: [`apps/web/src/features/${feature}/**/*.{ts,tsx}`],
      rules: rule([
        ...webRules,
        [
          ["@/features/*", `!@/features/${feature}`, `!@/features/${feature}/*`, "../*/*"],
          "Features don't import each other; move shared code to components/ or lib/.",
        ],
      ]),
    })),
    {
      files: ["apps/api/src/modules/**/*.ts"],
      rules: rule([
        [["../*/*.controller.js"], "Use another module's service, never its controller."],
        [
          [
            "../../app.module.js",
            "../../worker.module.js",
            "../../main.js",
            "../../worker.js",
            "../../bootstrap.js",
          ],
          "Modules must not depend on process entry points.",
        ],
        [["**/apps/web/**", "react", "next", "next/*"], "The API never imports web code."],
        [["@nf/*/src/*"], "Import packages through their public entry point."],
      ]),
    },
  ];
}
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
  ...boundaries(),
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
