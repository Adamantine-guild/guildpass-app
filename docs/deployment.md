# GuildPass Deployment Guide

> **Version:** 0.1.0  
> **Updated:** 2026-07-23

This document describes how to deploy the GuildPass application stack to
production. It covers environment validation, Docker builds, orchestration,
health checks, and CI/CD pipelines.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Environment Configuration](#environment-configuration)
4. [Environment Validation](#environment-validation)
5. [Docker Deployment](#docker-deployment)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Health Checks](#health-checks)
8. [Production Checklist](#production-checklist)
9. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
                         ┌─────────────┐
                         │   Browser    │
                         └──────┬──────┘
                                │ HTTPS
                         ┌──────▼──────┐
                         │  Dashboard  │  (Next.js, port 3000)
                         │  @guildpass │
                         │  /dashboard │
                         └──┬───────┬──┘
                            │       │
                  ┌─────────┘       └─────────┐
                  ▼                             ▼
         ┌──────────────┐           ┌──────────────────┐
         │  Access API  │           │   PostgreSQL     │
         │  (indexer +  │◄──────────│   (database)     │
         │   gateway)   │           │   port 5432      │
         │  port 3001   │           └──────────────────┘
         └──────┬───────┘
                │ RPC
         ┌──────▼───────┐
         │  Ethereum    │
         │  (EVM chain) │
         └──────────────┘

         ┌──────────────────┐
         │  Discord Bot     │  (optional, separate container)
         │  @guildpass      │
         │  /discord-bot    │
         └──────────────────┘
```

### Applications

| Component | Package | Type | Port |
|-----------|---------|------|------|
| Dashboard | `@guildpass/dashboard` | Next.js 14 web app | 3000 |
| Access API | `@guildpass/access-api` | Node.js + TypeScript API | 3001 |
| Discord Bot | `@guildpass/discord-bot` | Node.js + Discord.js | — |
| PostgreSQL | `postgres:16-alpine` | Database | 5432 |

---

## Prerequisites

- **Node.js** >= 18.17.0
- **pnpm** 9.x (`corepack enable && corepack prepare pnpm@9 --activate`)
- **Docker** 24+ (for containerized deployment)
- **Docker Compose** v2+ (for local orchestration, optional in production)

For production infrastructure, you will also need:

- A container registry (GitHub Container Registry, Docker Hub, ECR, etc.)
- An orchestrator (Kubernetes, Docker Swarm, ECS, or a simple VPS)
- A PostgreSQL 16 instance (RDS, Cloud SQL, self-hosted, etc.)
- An EVM RPC endpoint (Alchemy, Infura, or self-hosted node)

---

## Environment Configuration

### Configuration Precedence

Environment variables are resolved in the following order (later overrides
earlier):

1. `packages/env/src/schemas/*.ts` — Zod default values
2. `.env` file (loaded by `dotenv` in access-api, or Next.js built-in)
3. Actual shell environment variables (Docker, CI, etc.)

### Required Variables per Application

#### Dashboard (`DASHBOARD_API_MODE=live`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DASHBOARD_API_MODE` | No | `mock` | `mock` or `live` |
| `DASHBOARD_STORAGE_MODE` | No | `mock` | `mock` or `durable` |
| `GUILD_PASS_CORE_URL` | If live | — | Access API base URL |
| `GUILD_PASS_CORE_API_KEY` | If live | — | Access API key |
| `WEBHOOK_SECRET` | If live | — | Webhook signature secret |
| `DATABASE_URL` | If durable | — | PostgreSQL connection string |
| `NEXT_PUBLIC_ACTIVITY_REFRESH_MS` | No | `15000` | Activity poll interval |
| `ACTIVITY_STORAGE_MODE` | No | `memory` | `memory` or `file` |

#### Access API

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `RPC_URL` | **Yes** | — | EVM RPC endpoint URL |
| `MEMBERSHIP_CONTRACT_ADDRESS` | **Yes** | — | Membership contract (0x...) |
| `INDEXER_CONFIRMATION_DEPTH` | No | `10` | Block confirmations for safety |
| `INDEXER_START_BLOCK` | No | `0` | Starting block for indexer |
| `PORT` | No | `3000` | HTTP server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `API_KEY` | No | — | Optional request authentication |

#### Discord Bot

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | **Yes** | — | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | **Yes** | — | Application client ID |
| `DISCORD_GUILD_ID` | Dev mode | — | Guild ID for guild commands |
| `DISCORD_ROLE_ADMIN` | No | — | Admin role ID |
| `DISCORD_ROLE_MEMBER` | No | — | Member role ID |
| `DISCORD_ROLE_CONTRIBUTOR` | No | — | Contributor role ID |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |

### Setting Up Environment Files

```bash
# Copy the example environment (root level)
cp .env.example .env

# Edit .env with your values
# The docker-compose.yml reads from .env automatically
```

For the dashboard, you can also create `apps/dashboard/.env.local`:

```bash
cp .env.example apps/dashboard/.env.local
```

> **Security:** Never commit `.env` or `.env.local` files. They are already
> in `.gitignore`.

---

## Environment Validation

The `@guildpass/env` package provides Zod-based validation schemas for all
three applications. Validation runs:

1. **At container startup** — Each Docker image runs `guildpass-env-check`
   before starting the application. If validation fails, the container exits
   immediately with a clear error message.
2. **In CI** — The `env-check` job in CI validates schemas with test values.
3. **Manually** — You can run the CLI tool directly:

```bash
# Build the env package first
pnpm --filter @guildpass/env build

# Validate all apps
node packages/env/dist/cli/index.js

# Validate a specific app
node packages/env/dist/cli/index.js --app dashboard
node packages/env/dist/cli/index.js --app access-api
node packages/env/dist/cli/index.js --app discord-bot
```

### Example Output

```
🔍 GuildPass Environment Validation

  ── Dashboard ──
  ✓ @guildpass/dashboard: All environment variables valid

  ── Access API ──
  ✗ @guildpass/access-api: Validation failed
      DATABASE_URL: Required
      RPC_URL: Required
      MEMBERSHIP_CONTRACT_ADDRESS: Required

  ── Discord Bot ──
  ✗ @guildpass/discord-bot: Validation failed
      DISCORD_TOKEN: Required
      DISCORD_CLIENT_ID: Required

❌ Some environment checks failed. See above for details.
```

---

## Docker Deployment

### Building Images

Each application has its own multi-stage Dockerfile:

| Application | Dockerfile |
|-------------|------------|
| Dashboard | `apps/dashboard/Dockerfile` |
| Access API | `apps/access-api/Dockerfile` |
| Discord Bot | `apps/discord-bot/Dockerfile` |

Build all images from the monorepo root:

```bash
# Build all
docker compose build

# Build individual
docker build -f apps/dashboard/Dockerfile -t guildpass/dashboard:latest .
docker build -f apps/access-api/Dockerfile -t guildpass/access-api:latest .
docker build -f apps/discord-bot/Dockerfile -t guildpass/discord-bot:latest .
```

### Running with Docker Compose (Production-like)

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your production values

# 2. Start all services
docker compose up -d

# 3. Include Discord Bot (optional, uses profile)
docker compose --profile discord-bot up -d

# 4. Verify health
curl http://localhost:3000/api/health

# 5. View logs
docker compose logs -f
```

### Production Infrastructure Considerations

While Docker Compose is suitable for single-host deployments and testing,
production deployments should use an orchestrator:

- **Kubernetes** — For multi-host, auto-scaling, self-healing deployments
- **AWS ECS / Fargate** — Managed container orchestration
- **Google Cloud Run** — Serverless container platform
- **Azure Container Apps** — Managed serverless containers

Key considerations:
- Use a managed PostgreSQL service (RDS, Cloud SQL, Azure DB)
- Use a managed container registry (ECR, GCR, ACR, GHCR)
- Use a reverse proxy / load balancer (nginx, Traefik, ALB)
- Enable HTTPS with automated certificate management
- Set up log aggregation (CloudWatch, Stackdriver, Loki)
- Configure monitoring and alerting

#### Reverse Proxy Configuration Example

```nginx
# /etc/nginx/sites-available/guildpass
server {
    listen 443 ssl;
    server_name guildpass.example.com;

    ssl_certificate /etc/ssl/certs/guildpass.crt;
    ssl_certificate_key /etc/ssl/private/guildpass.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/health {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        # No auth required for health checks
    }
}
```

---

## CI/CD Pipeline

### Continuous Integration

The CI workflow (`.github/workflows/ci.yml`) runs on every push to `main` and
`develop`, and on pull requests:

1. **Lint & TypeCheck** — ESLint and TypeScript type checking
2. **Unit Tests** — All workspace test suites
3. **Env Schema Validation** — Tests that schemas accept valid values and reject
   invalid ones
4. **Docker Build Smoke Test** — Builds images to ensure Dockerfiles are valid
   (main branch only)

### Continuous Deployment

The CD workflow (`.github/workflows/cd.yml`) runs on push to `main`:

1. **CI Checks** — Reuses the CI workflow
2. **Build & Push Images** — Builds Docker images and pushes to GitHub Container
   Registry (GHCR) with tags:
   - `latest` — Latest stable build
   - `sha-<commit>` — Specific commit
   - `<semver>` — Version tag (when a tag is pushed)
3. **Deploy** — Placeholder step; adapt to your infrastructure (see examples in
   the workflow file)

### Required Secrets

| Secret | Description |
|--------|-------------|
| `GITHUB_TOKEN` | Automatically provided; used for GHCR access |

For custom deployment steps, add secrets as needed (e.g., `DEPLOY_SSH_KEY`,
`DOCKER_USERNAME`, `KUBECONFIG`).

---

## Health Checks

### Dashboard Health Endpoint

```
GET /api/health
```

**Healthy response (200):**
```json
{
  "status": "healthy",
  "timestamp": "2026-07-23T12:00:00.000Z",
  "version": "0.1.0",
  "mode": {
    "api": "live",
    "storage": "durable"
  },
  "checks": {
    "env": "passed"
  },
  "responseTimeMs": 3
}
```

**Unhealthy response (503):**
```json
{
  "status": "unhealthy",
  "timestamp": "2026-07-23T12:00:00.000Z",
  "error": "DATABASE_URL is required when DASHBOARD_STORAGE_MODE is 'durable'",
  "responseTimeMs": 1
}
```

### Docker HEALTHCHECK

The Dockerfiles use the health endpoint for Docker's built-in health checking.
When deployed, orchestrators can use the same endpoint:

```yaml
# In a Kubernetes Deployment
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

---

## Production Checklist

Use this checklist when deploying to production:

### Pre-deployment

- [ ] All environment variables configured and validated
- [ ] PostgreSQL 16 instance running and accessible
- [ ] EVM RPC endpoint configured and responsive
- [ ] Smart contract addresses verified
- [ ] Webhook secret generated (e.g., `openssl rand -hex 32`)
- [ ] Discord bot token and client ID ready (if using Discord Bot)
- [ ] Docker images built and pushed to registry
- [ ] Secret management solution in place (e.g., Vault, AWS Secrets Manager)

### Deployment

- [ ] Database migrations run (`prisma migrate deploy`)
- [ ] Environment validation passes (`guildpass-env-check`)
- [ ] Health check responds `200 OK`
- [ ] SSL/TLS certificate installed and valid
- [ ] Reverse proxy configured and tested
- [ ] Logging and monitoring configured

### Post-deployment

- [ ] Smoke test the dashboard UI
- [ ] Verify activity feed loads
- [ ] Test webhook delivery (if applicable)
- [ ] Verify Discord bot is online (if applicable)
- [ ] Monitor error rates and response times
- [ ] Set up backup schedule for the database
- [ ] Configure alerting for critical metrics

---

## Troubleshooting

### Container exits immediately with validation errors

```bash
# Check the container logs
docker compose logs dashboard
# Example output:
# ✗ @guildpass/dashboard: Validation failed
#   WEBHOOK_SECRET: Required

# Fix: Set the missing variable in your .env file and restart
docker compose up -d
```

### Database connection refused

```bash
# Verify PostgreSQL is running
docker compose ps postgres

# Check PostgreSQL logs
docker compose logs postgres

# Verify connection string
docker compose exec postgres psql -U guildpass -d guildpass -c "SELECT 1"
```

### Health check fails

```bash
# Direct health check
curl -v http://localhost:3000/api/health

# View application logs
docker compose logs dashboard

# Common causes:
# - Missing DATABASE_URL in durable mode
# - Core API unreachable in live mode
# - Missing WEBHOOK_SECRET in live mode
```

### Docker build fails (workspace resolution)

If `pnpm install` fails during Docker build, ensure the Docker context includes
all required workspace packages:

```bash
# The Dockerfile uses COPY for each workspace package's package.json
# Make sure you're building from the monorepo root:
docker build -f apps/dashboard/Dockerfile .
```

---

## Related Documents

- [Environment Validation Package](../packages/env/README.md)
- [Deployment Notes (preliminary)](./deployment.md)
- [Observability Guide](./observability.md)
- [Multi-tenancy Configuration](./multi-tenancy.md)