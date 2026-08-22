# @guildpass/env — Shared Environment Validation

Zod-based environment variable validation for all GuildPass applications.

## Usage

```typescript
import { dashboardEnvSchema, validateEnv } from "@guildpass/env";

const env = validateEnv(dashboardEnvSchema);
// env.DASHBOARD_API_MODE is typed as "mock" | "live"
```

### CLI Tool

```bash
pnpm --filter @guildpass/env build
node packages/env/dist/cli/index.js --app dashboard
```

## Schemas

| Schema | File | Application |
|--------|------|-------------|
| `dashboardEnvSchema` | `src/schemas/dashboard.ts` | `@guildpass/dashboard` |
| `accessApiEnvSchema` | `src/schemas/access-api.ts` | `@guildpass/access-api` |
| `discordBotEnvSchema` | `src/schemas/discord-bot.ts` | `@guildpass/discord-bot` |

## Build Output

`@guildpass/env` is compiled from `src/` to `./dist/` with `tsc` via
`pnpm --filter @guildpass/env build`. The package is ESM-only
(`"type": "module"`); no CommonJS (`.cjs`) output is produced.

| Artifact | Path |
|----------|------|
| Entry point (`main`) | `dist/index.js` |
| Types (`types`) | `dist/index.d.ts` |
| CLI (`bin`: `guildpass-env-check`) | `dist/cli/index.js` |
| Source maps | `dist/**/*.js.map` |

- `packages/env/tsconfig.json` sets `outDir: "dist"`, `rootDir: "src"`,
  `declaration: true` and `emitDeclarationOnly: false` (the default), so every
  `.ts` file under `src/` emits a `.js` file with a sibling `.d.ts` — never
  declarations only.
- Consumers should import from `@guildpass/env` (resolved via
  `package.json#exports`) rather than reaching into `dist/` directly.
- `dist/` is gitignored and rebuilt automatically by `pnpm install` (via the
  `prepare` script), so downstream workspaces such as `apps/dashboard` always
  find both `.js` and `.d.ts` output. If a downstream build reports "Module
  not found" for `@guildpass/env`, rebuild with
  `pnpm --filter @guildpass/env build` and re-run the downstream build.