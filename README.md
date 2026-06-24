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

## Local Admin Access

Management pages (`/passes`, `/guilds`, `/members`, `/activity`, `/settings`) are protected by `AdminGuard`. Unauthenticated visitors see an access-denied screen.

To unlock these pages during local development, enable mock admin mode:

1. Create or edit `apps/dashboard/.env.local`:

```env
NEXT_PUBLIC_MOCK_ADMIN=true
```

2. Restart the dev server (`pnpm dev`).

The dashboard will use the mock session defined by `MOCK_ACTIVE_ROLE` in `apps/dashboard/lib/auth/session.ts`. Change that constant to simulate a different role (`owner`, `admin`, `moderator`, or `readonly`).

| `NEXT_PUBLIC_MOCK_ADMIN` | Effect |
|---|---|
| `true` | Mock session active — management pages accessible |
| unset / `false` | No session — management pages show access denied |

> **Note:** `NEXT_PUBLIC_MOCK_ADMIN` is a development convenience only. When real authentication is wired up, replace `getSession()` in `apps/dashboard/lib/auth/session.ts` with your auth provider call. No page-level code needs to change.

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

## Available Routes

- `/` – Landing page
- `/dashboard` – Overview with key stats
- `/passes` – Manage passes
- `/guilds` – Manage communities/guilds
- `/members` – Manage members
- `/activity` – View activity log
- `/settings` – App settings

---

## Notes

- All data is currently mock data (see `apps/dashboard/lib/mock-data.ts`).
- The Discord bot (`apps/discord-bot`) is preserved as an optional integration and not required for the dashboard to function.
- The docs site (`apps/docs`) is also preserved as optional legacy documentation.

---

## License

MIT — see [LICENSE](./LICENSE).
