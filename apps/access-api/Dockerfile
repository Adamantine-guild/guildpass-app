# =============================================================================
# GuildPass Access API — Multi-stage production Dockerfile
# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace manifests
COPY pnpm-workspace.yaml package.json ./
COPY apps/access-api/package.json apps/access-api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/env/package.json packages/env/

# Install all dependencies (including devDependencies)
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.base.json ./
COPY apps/access-api apps/access-api
COPY packages packages

# Build @guildpass/env first
RUN pnpm --filter @guildpass/env build

# Build the access-api (compiles TypeScript via tsc)
RUN pnpm --filter @guildpass/access-api build

# Generate Prisma client (needed at runtime)
RUN pnpm --filter @guildpass/access-api prisma:generate

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 guildpass

# Copy workspace manifests & node_modules with only production deps
COPY pnpm-workspace.yaml package.json .pnpmrc ./
COPY apps/access-api/package.json apps/access-api/
COPY packages packages

RUN corepack enable && corepack prepare pnpm@9 --activate && \
    pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/apps/access-api/dist apps/access-api/dist
COPY --from=builder /app/apps/access-api/prisma apps/access-api/prisma
COPY --from=builder /app/apps/access-api/node_modules/.prisma apps/access-api/node_modules/.prisma
COPY --from=builder /app/packages/env/dist packages/env/dist

RUN chown -R guildpass:nodejs /app

USER guildpass

EXPOSE 3000

# Run environment validation before starting
CMD ["sh", "-c", "node packages/env/dist/cli/index.js --app access-api && node apps/access-api/dist/index.js"]