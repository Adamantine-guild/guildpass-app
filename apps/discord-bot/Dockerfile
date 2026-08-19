# =============================================================================
# GuildPass Discord Bot — Multi-stage production Dockerfile
# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace manifests
COPY pnpm-workspace.yaml package.json ./
COPY apps/discord-bot/package.json apps/discord-bot/
COPY packages/env/package.json packages/env/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.base.json ./
COPY apps/discord-bot apps/discord-bot
COPY packages packages

# Build @guildpass/env first
RUN pnpm --filter @guildpass/env build

# Build the discord-bot
RUN pnpm --filter @guildpass/discord-bot build

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 guildpass

# Copy manifests & install production dependencies
COPY pnpm-workspace.yaml package.json .pnpmrc ./
COPY apps/discord-bot/package.json apps/discord-bot/
COPY packages packages

RUN corepack enable && corepack prepare pnpm@9 --activate && \
    pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/apps/discord-bot/dist apps/discord-bot/dist
COPY --from=builder /app/packages/env/dist packages/env/dist

RUN chown -R guildpass:nodejs /app

USER guildpass

# Run environment validation before starting the bot
CMD ["sh", "-c", "node packages/env/dist/cli/index.js --app discord-bot && node apps/discord-bot/dist/index.js"]