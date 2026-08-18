# Dependency Versions

This document records the toolchain and framework versions that the GuildPass
monorepo is built and tested against. It exists to keep the three app build
systems (Next.js, Docusaurus, and the Node.js TypeScript services) compatible
with the shared workspace packages.

> 💡 The monorepo's `engines` fields and CI matrix are the source of truth for
> what is *supported*. The "recommended" column reflects what the production
> Docker images and CI builds actually use.

---

## Node.js

| | Version |
| --- | --- |
| Minimum | `18.17.0` (18.x) |
| Recommended | `20.x` |

All apps and packages declare `"engines": { "node": ">=18.17.0" }`. The
production Dockerfiles (`apps/*/Dockerfile`) build and run on `node:20-alpine`.

---

## pnpm

| | Version |
| --- | --- |
| Minimum | `9.x` |
| Recommended | `10.x` |

- `apps/*/Dockerfile` enable and pin `pnpm@9` via Corepack.
- `pnpm-workspace.yaml` uses pnpm 10 options (`allowBuilds`,
  `minimumReleaseAgeExclude`), so **pnpm 10 is recommended** for local
  development.
- The lockfile is intentionally gitignored (see `verify-lockfile=false` in
  `.pnpmrc`).

---

## TypeScript

| | Version |
| --- | --- |
| Range | `^5.4.0` (workspace packages) · `^5.6.3` (dashboard, access-api, env) |

The workspace base config is [`tsconfig.base.json`](./tsconfig.base.json)
(`strict`, `NodeNext` module resolution, `ES2020` target). Apps override the
target where needed:

- `apps/dashboard` — `moduleResolution: "bundler"`, JSX `preserve` (Next.js).
- `apps/access-api` — `ES2022` target, NodeNext ESM.
- `apps/discord-bot` — NodeNext ESM, `rootDir: src`.

---

## App-specific versions

| App | Framework / runtime | Version |
| --- | --- | --- |
| `apps/dashboard` | Next.js | `14.2.21` (14.x) |
| `apps/dashboard` | React / React DOM | `18.3.1` |
| `apps/docs` | Docusaurus | `^3.2.1` (3.x) |
| `apps/docs` | React / React DOM | `^18.2.0` |
| `apps/access-api` | Node.js built-in `http` server | — (no web framework) |
| `apps/access-api` | Prisma | `^5.15.0` |
| `apps/access-api` | viem | `^2.13.0` |
| `apps/discord-bot` | discord.js | `^14.15.3` (14.x) |
| `apps/discord-bot` | @discordjs/rest | `^2.6.1` |

> **Note:** despite historical references to "Fastify", `apps/access-api` does
> not use Fastify. It uses Node's built-in `http` module for its health
> endpoint. See [`apps/access-api/README.md`](./apps/access-api/README.md).

---

## Update Policy

- **Major version updates** (e.g. Next.js 14 → 15, Docusaurus 3 → 4, Node 20 →
  22) require approval from the core team and must be accompanied by:
  - a passing CI run on the full Node version matrix, and
  - updated documentation in this file and the relevant `README.md`.
- Minor and patch updates may be applied independently, but must keep every app
  and package building with `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
