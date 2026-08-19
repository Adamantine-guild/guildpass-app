# GuildPass Dashboard

The **GuildPass Dashboard** is the main application in the [guildpass-app](https://github.com/Adamantine-Guild/guildpass-app) monorepo. It is a Next.js 14 web dashboard for managing access, passes, guilds/communities, members, and activity.

---

## Quick Start

```bash
# From the repository root
pnpm install
cp ../../.env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Available Routes

| Route | Description |
| ----- | ----------- |
| `/` | Landing page |
| `/dashboard` | Overview with key stats |
| `/passes` | Manage passes |
| `/guilds` | Manage communities/guilds |
| `/members` | Manage members |
| `/activity` | View activity / audit log |
| `/integrations` | Manage integrations and view status |
| `/settings` | App settings |

In mock mode, append `?mockState=error` or `?mockState=empty` to
`/guilds` or `/integrations` to preview and test their non-happy-path UI.

---

## Scripts

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Create an optimized production build |
| `pnpm start` | Start the production server |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run the test suite (`node --test` with tsx) |
| `pnpm test:js` | Run plain JS test files |

---

## API Modes

### Mock Mode (default)

All data comes from local fixture files. No external services needed — ideal for frontend development and most contributions.

### Live Mode

Forwards membership and verification lookups to a GuildPass core API. Set these in `.env.local`:

```env
DASHBOARD_API_MODE=live
GUILD_PASS_CORE_URL=https://your-core.example.com
GUILD_PASS_CORE_API_KEY=supersecret
```

---

## Webhooks

To receive live activity updates, configure a webhook secret in `.env.local`:

```env
WEBHOOK_SECRET=your_secret_here
```

Incoming webhooks should be sent to `/api/webhooks` with the `x-guildpass-signature` header for verification.

Supported event types:
- `membership.created`
- `membership.updated`
- `pass.created`
- `pass.updated`
- `guild.updated`
- `verification.completed`

---

## Environment Variables

See [`.env.example`](../../.env.example) for the full list of available variables.

---

## Testing

Tests are written using Node's built-in test runner with `tsx` for TypeScript support:

```bash
pnpm test        # Run all test files
pnpm test:js     # Run plain JS test files only
```

Test files are located in `apps/dashboard/test/` and follow the naming convention `*.test.ts`.

---

## Project Structure

```
apps/dashboard/
├── app/              # Next.js App Router pages and API routes
├── components/       # Shared React components
├── lib/              # Utilities, hooks, API helpers, mock data
│   ├── activity/     # Activity feed logic
│   ├── auth/         # Authentication helpers
│   ├── data/         # Data access layer
│   ├── hooks/        # Custom React hooks
│   ├── integrations/ # Integration helpers
│   └── repositories/ # Data repositories
├── scripts/          # Utility scripts
├── test/             # Test files
└── public/           # Static assets
```

---

## Related Packages

- `@guildpass/integration-client` — Typed HTTP client for the GuildPass core API
- `@guildpass/webhook-utils` — Webhook signature verification utilities

See the [root README](../../README.md) for the full monorepo overview.
