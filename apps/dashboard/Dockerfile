# =============================================================================
# GuildPass Dashboard — Multi-stage production Dockerfile
# =============================================================================
# Stage 1: Install dependencies & build
# =============================================================================
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace manifest files for dependency resolution
COPY pnpm-workspace.yaml package.json ./
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/contracts/package.json packages/contracts/
COPY packages/integration-client/package.json packages/integration-client/
COPY packages/metrics/package.json packages/metrics/
COPY packages/webhook-utils/package.json packages/webhook-utils/
COPY packages/env/package.json packages/env/

# Install ALL workspace dependencies (including devDependencies)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.base.json ./
COPY apps/dashboard apps/dashboard
COPY packages packages

# Build the @guildpass/env package first (needed by dashboard at runtime)
RUN pnpm --filter @guildpass/env build

# Build the dashboard
RUN pnpm --filter @guildpass/dashboard build

# =============================================================================
# Stage 2: Production runtime
# =============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy production dependencies only
COPY pnpm-workspace.yaml package.json .pnpmrc ./
COPY apps/dashboard/package.json apps/dashboard/
COPY packages packages

# Install only production dependencies
RUN corepack enable && corepack prepare pnpm@9 --activate && \
    pnpm install --frozen-lockfile --prod

# Copy built assets from builder
COPY --from=builder /app/apps/dashboard/.next apps/dashboard/.next
COPY --from=builder /app/apps/dashboard/public apps/dashboard/public
COPY --from=builder /app/apps/dashboard/next.config.mjs apps/dashboard/
COPY --from=builder /app/packages/env/dist packages/env/dist

# Set proper ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# Run environment validation before starting the server
CMD ["sh", "-c", "cd apps/dashboard && node ../../packages/env/dist/cli/index.js --app dashboard && node_modules/.bin/next start"]