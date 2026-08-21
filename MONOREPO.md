# GuildPass Monorepo Documentation

Welcome to the `GuildPass` monorepo. We use `pnpm` workspaces to manage our packages and applications.

## Workspace Structure

### Apps (`apps/`)
- `@guildpass/access-api`: Access API and Event Indexer.
- `@guildpass/dashboard`: Next.js web dashboard.
- `@guildpass/discord-bot`: Discord bot for MVP.
- `@guildpass/docs`: Docusaurus documentation site.

### Packages (`packages/`)
- `@guildpass/contracts`: Smart contract ABIs and constants.
- `@guildpass/env`: Shared environment validation schemas.
- `@guildpass/integration-client`: Typed client for integrations.
- `@guildpass/metrics`: Metrics utilities.
- `@guildpass/webhook-utils`: Webhook verification utilities.

## Build Order

Based on the actual dependency graph, `pnpm` builds the workspace in roughly the following topological order (parallelizing where possible):

1. **Leaf nodes (no internal dependencies):**
   - `@guildpass/docs`
   - `@guildpass/contracts`
   - `@guildpass/env`
   - `@guildpass/integration-client`
   - `@guildpass/metrics`
   - `@guildpass/webhook-utils`
2. **Dependent applications:**
   - `@guildpass/access-api` (depends on `@guildpass/contracts`)
   - `@guildpass/discord-bot` (depends on `@guildpass/integration-client`)
   - `@guildpass/dashboard` (depends on `@guildpass/integration-client`, `@guildpass/webhook-utils`, `@guildpass/metrics`, `@guildpass/env`)

## Common Commands

All commands below have been tested and verified to work from the repository root.

- **Install dependencies:**
  ```bash
  pnpm install
  ```
- **Build all packages and apps:**
  ```bash
  pnpm -r build
  ```
- **Build a specific package (and its dependencies):**
  ```bash
  pnpm build -r --filter @guildpass/dashboard
  ```
- **Run TypeScript typechecks workspace-wide:**
  ```bash
  pnpm typecheck
  ```
- **Lint all files:**
  ```bash
  pnpm lint
  ```
  *(Note: Linting may produce warnings/errors in certain packages like `integration-client` due to strict unused var rules and unresolved Node globals. See Troubleshooting for more).*
- **Validate the workspace:**
  ```bash
  pnpm validate:workspace
  ```

## Further Reading

- [Architecture & Dependency Graph](./ARCHITECTURE.md)
- [Troubleshooting & Known Issues](./TROUBLESHOOTING.md)
