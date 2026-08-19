import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// One shared ESLint config for the whole monorepo (flat config, ESLint >= 9).
// Every workspace package's `lint` script runs `eslint .` from its own
// directory and inherits these rules — no per-package configs needed.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "apps/docs/.docusaurus/**",
      "apps/docs/build/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Type-aware linting: each workspace's tsconfig is registered so
        // every linted file gets the compiler options of its own project.
        // tsconfig.base.json is listed last as a fallback for files that are
        // not included by a package tsconfig (e.g. package test directories).
        project: [
          "./apps/access-api/tsconfig.json",
          "./apps/dashboard/tsconfig.json",
          "./apps/discord-bot/tsconfig.json",
          "./packages/contracts/tsconfig.json",
          "./packages/integration-client/tsconfig.json",
          "./packages/webhook-utils/tsconfig.json",
          "./tsconfig.base.json"
        ],
        tsconfigRootDir: __dirname
      }
    },
    rules: {
      // Warnings by design — `any` is occasionally necessary (JSON-RPC wire
      // types, mocks); keep it visible for review without blocking CI.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Type-safety best practices:
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Repo targets ES2020, where Error#cause does not exist yet — the rule
      // would force throwing `{ cause }` and break the typecheck.
      "preserve-caught-error": "off"
    }
  },
  {
    // node:test's top-level `test()`/`describe()` calls (and test helpers in
    // test directories) return promises that the test runner itself awaits —
    // flagging them as floating is a false positive, so keep this rule strict
    // for source code only.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off"
    }
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        process: "readonly",
        __dirname: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        FormData: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        queueMicrotask: "readonly"
      }
    }
  }
);
