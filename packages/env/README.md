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