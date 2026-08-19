<div align="center">
  <a href="./README.md">
    <img src="./logo/Guildpass App Logo.png" alt="GuildPass App Logo" width="120" />
  </a>
  <h1>GuildPass Dashboard</h1>
</div>

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.17-green?style=flat-square)](https://nodejs.org)

GuildPass is a web dashboard for managing access, passes, guilds/communities, members, and activity.

---

## Features

- Dashboard overview with key stats
- Pass management
- Guild/community management
- Member management with wallet info
- Activity/audit log
- Settings page
- Mock data for easy local development

---

## Tech Stack

- [Next.js 14](https://nextjs.org/) – Full-stack React framework
- [TypeScript](https://www.typescriptlang.org/) – Type-safe code
- [Tailwind CSS](https://tailwindcss.com/) – Utility-first CSS
- [pnpm](https://pnpm.io/) – Fast, disk-efficient package manager
- Monorepo structure with packages/integration-client shared types

---

## Prerequisites

- **Node.js** 18.17 or later
- **pnpm** (install via `npm install -g pnpm`)

---

## Installation

```bash
# Clone or navigate to the project directory
cd guildpass-app

# Install all dependencies
pnpm install
```

---

## Webhook Configuration

To receive live activity updates in the dashboard, you must configure a webhook secret.

1.  Set the `WEBHOOK_SECRET` environment variable in `apps/dashboard/.env.local`.
2.  Incoming webhooks should be sent to `/api/webhooks`.
3.  Webhooks must include the `x-guildpass-signature` header for verification.

Example `.env.local`:
```env
WEBHOOK_SECRET=your_secret_here
```

### Supported Event Types

- `membership.created`
- `membership.updated`
- `pass.created`
- `pass.updated`
- `guild.updated`
- `verification.completed`

---

## Development

Run the local development server:

```bash
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Production Build

Create an optimized production build:

```bash
pnpm build
```

Then start the production server:

```bash
pnpm start
```

---

## Build Caching
- Incremental builds are enabled by default
- First build is slower; subsequent builds reuse cached data
- Clean builds: `pnpm build:clean`

---

## Type Checking & Linting

- Type check all packages and apps: `pnpm typecheck`
- Run linter: `pnpm lint`

---

## Project Structure

```
guildpass-app/
├── apps/
│   ├── dashboard/        # Main Next.js dashboard app (NEW!)
│   ├── discord-bot/      # Optional Discord bot integration (legacy)
│   └── docs/             # Docusaurus docs (legacy)
├── packages/
│   ├── integration-client/ # Shared types and API client
│   └── webhook-utils/      # Webhook verification utilities (optional)
├── .pnpmrc               # pnpm configuration
├── pnpm-workspace.yaml   # Monorepo workspace config
└── package.json          # Root package.json
```

### Webhook Utilities

The `@guildpass/webhook-utils` package provides production-ready webhook signature verification for GuildPass integrations:

- ✅ HMAC-SHA256 signature verification
- ✅ Replay attack protection with timestamp validation
- ✅ Timing attack resistant
- ✅ Zero dependencies
- ✅ Full TypeScript support

See [packages/webhook-utils/README.md](./packages/webhook-utils/README.md) for complete documentation and examples.

**Quick Example:**

```typescript
import { verifySignature } from "@guildpass/webhook-utils";

const result = verifySignature({
  signatureHeader: request.headers.get('x-guildpass-signature'),
  secret: process.env.WEBHOOK_SECRET,
  payload: rawBody,
});

if (!result.valid) {
  return Response.json({ error: result.error }, { status: 401 });
}
```

---

## Live API Mode

The dashboard supports two API modes controlled by the `DASHBOARD_API_MODE` environment variable:

- `mock` (default) — the app uses local mock data for all pages and API routes.
- `live` — the app will forward membership and verification lookups to a GuildPass core API via the `@guildpass/integration-client` package.

To enable live mode, set these environment variables for the dashboard app (server-side only):

```env
# set the dashboard API mode
DASHBOARD_API_MODE=live

# GuildPass core API base URL (required in live mode)
GUILD_PASS_CORE_URL=https://your-core.example.com

# API key for the core (server-side secret)
GUILD_PASS_CORE_API_KEY=supersecret

# webhook secret (if you use webhooks)
WEBHOOK_SECRET=your_webhook_secret
```

Notes:
- Live mode must run on the server-side (Next.js App Router API routes) — the client bundle never receives your `GUILD_PASS_CORE_API_KEY`.
- The dashboard's API routes perform lookups by `wallet` or `discordUserId` when live mode is enabled (e.g. `GET /api/members?wallet=0x...`).
- Mock mode remains the default for easy local development.

## Available Routes

- `/` – Landing page
- `/dashboard` – Overview with key stats
- `/passes` – Manage passes
- `/guilds` – Manage communities/guilds
- `/members` – Manage members
- `/activity` – View activity log
- `/integrations` – Manage integrations & view status (NEW!)
- `/settings` – App settings

---

## Integrations

### Discord Bot
The Discord bot (`apps/discord-bot`) is preserved as an optional integration and not required for the dashboard to function. The dashboard exposes an integration status UI to check if the bot is configured and healthy.

**Health-Check Contract:**
For a live production environment, the integration adapter checks the bot's health using two strategies:
1.  **Microservice Health Endpoint:** If `DISCORD_BOT_STATUS_URL` is set, the dashboard will ping the bot's HTTP health endpoint (e.g., `GET /health`). It expects a JSON response containing `status: "healthy"` or `gatewayConnected: true`.
2.  **Discord REST API:** If no endpoint is configured, the dashboard falls back to directly pinging the Discord API (`GET https://discord.com/api/v10/guilds/{guildId}`) using the provided `DISCORD_TOKEN`.

---

## Notes

- All data is currently mock data (see `apps/dashboard/lib/mock-data.ts`).
- The docs site (`apps/docs`) is also preserved as optional legacy documentation.

---

## License

MIT — see [LICENSE](./LICENSE).
