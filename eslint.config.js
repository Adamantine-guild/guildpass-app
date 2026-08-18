import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "apps/docs/.docusaurus/**",
      "apps/docs/build/**"
    ]
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          "./tsconfig.base.json",
          "./apps/discord-bot/tsconfig.json",
          "./packages/integration-client/tsconfig.json",
          "./packages/webhook-utils/tsconfig.json"
        ],
        tsconfigRootDir: __dirname
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
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
        // Web/fetch API globals available in Node 18+ (used by tests and scripts)
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        structuredClone: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly"
      }
    }
  }
);
