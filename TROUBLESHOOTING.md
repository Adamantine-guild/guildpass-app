# Troubleshooting

This document outlines errors and warnings you might encounter during standard workflow operations (`install`, `build`, `typecheck`, `lint`) and how they were resolved or should be handled.

## 1. Missing `.bin` `ENOENT` Warning During `pnpm install`

**Symptom:**
When running `pnpm install`, you might see warnings like:
```text
[WARN] Failed to create bin at ...\apps\dashboard\node_modules\.bin\guildpass-env-check. ENOENT: no such file or directory
```

**Root Cause:**
The `@guildpass/env` package defines a `bin` script pointing to `dist/cli/index.js`. Because `pnpm install` runs before `pnpm -r build` has compiled `@guildpass/env`, the `dist` folder does not exist yet. When `pnpm` tries to link the `.bin` executable for dependent workspaces, it prints a warning.

**Fix:**
This warning is safe to ignore during the initial install. The script will correctly become available after you run `pnpm -r build`. If you need to fix the warning entirely, the `env` package could use a `preinstall` script or `pnpm` postinstall hook to compile just the CLI.

---

## 2. Dashboard Typecheck Failure (`TS6059`)

**Symptom:**
When running `pnpm typecheck` or `pnpm -r typecheck`, `apps/dashboard` fails with:
```text
error TS6059: File '.../packages/metrics/index.ts' is not under 'rootDir' '.../apps/dashboard'. 'rootDir' is expected to contain all source files.
```

**Root Cause:**
Previously, `@guildpass/metrics` did not have a `tsconfig.json` and its `main` field pointed to the raw `./index.ts` file. When `apps/dashboard` imported it, TypeScript treated it as part of the dashboard's source code, violating the isolated `rootDir` structure.

**Fix:**
This was permanently resolved by giving `@guildpass/metrics` a standard `tsconfig.json` that extends `tsconfig.base.json`, and updating its `package.json` to emit to `dist/index.js` and `dist/index.d.ts` alongside a proper `build` script.

---

## 3. Docusaurus Deprecated Config Warning

**Symptom:**
When running `pnpm -r build`, the `docs` app warns:
```text
[WARNING] The `siteConfig.onBrokenMarkdownLinks` config option is deprecated and will be removed in Docusaurus v4.
```

**Root Cause:**
The `apps/docs` uses Docusaurus v3+, where `onBrokenMarkdownLinks` was moved inside the `markdown.hooks` config. 

**Fix:**
This is just a warning and does not block the build. To resolve it completely, update `apps/docs/docusaurus.config.js` to structure the config as recommended by the warning.

---

## 4. Lint Errors in `integration-client`

**Symptom:**
Running `pnpm lint` fails in `packages/integration-client` due to multiple `no-undef` (for `Response`), `no-explicit-any`, and `no-unused-vars` errors.

**Root Cause:**
The ESLint configuration is overly strict or misconfigured for the Node 18+ environment (where `Response` is a global). 

**Fix:**
These errors do not prevent compiling or building. They should be fixed incrementally by the team by updating the ESLint globals to recognize Node 18 fetch API constructs or by explicitly turning off rules for legacy files.
