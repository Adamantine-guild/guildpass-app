# Dashboard API Routes

This directory contains Next.js API route handlers for the GuildPass dashboard.

---

## Route Reference

### Activity

| Method | Route | Permission | Description |
|--------|-------|------------|-------------|
| GET | `/api/activity` | `guilds:read` | Fetch recent activity events |
| GET | `/api/activity/stream` | `guilds:read` | SSE stream for live activity updates |
| GET | `/api/activity/verify` | `guilds:write` (owner/admin) | Verify the global durable PostgreSQL activity hash chain |

### Authentication

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/auth/nonce` | Generate a sign-in nonce |
| POST | `/api/auth/signin` | Sign in with wallet signature |
| POST | `/api/auth/refresh` | Refresh an access token |
| POST | `/api/auth/revoke` | Revoke an access token |

### Guilds

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST/PATCH/DELETE | `/api/guilds` | Guild CRUD operations |

### Integrations

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/integrations` | List integrations and their status |
| POST | `/api/integrations/reconcile` | Trigger a core reconciliation run |

### Members

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST/PATCH/DELETE | `/api/members` | Member CRUD operations |
| GET | `/api/members/export` | Export members as CSV |

### Passes

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST/PATCH/DELETE | `/api/passes` | Pass CRUD operations |

### Settings

| Method | Route | Description |
|--------|-------|-------------|
| GET/PATCH | `/api/settings` | Read and update dashboard settings |

### Verification

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/verify` | Verify a wallet signature |
| POST | `/api/verify/challenge` | Issue a verification challenge |

### Webhooks

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/webhooks` | Receive and process signed GuildPass webhook events |

### Admin

| Method | Route | Permission | Description |
|--------|-------|------------|-------------|
| POST | `/api/admin/reconcile` | Admin only | Admin-level guild count reconciliation |

### Health

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Health check endpoint |
| GET | `/api/metrics` | Application metrics |

---

## Webhook Endpoint

The `/api/webhooks` route is already implemented and handles incoming GuildPass events. It:

1. Rejects oversized payloads before any verification work
2. Rate-limits sources that repeatedly fail verification
3. Verifies the `x-guildpass-signature` header using `@guildpass/webhook-utils`
4. Validates and maps the payload to a dashboard activity event
5. Stores the event and publishes it to the SSE stream

### Configuration

Set the webhook secret in `.env.local`:

```env
WEBHOOK_SECRET=your_secret_here
```

### Supported Event Types

| Event | Description |
|-------|-------------|
| `membership.created` | A new membership was created |
| `membership.updated` | A membership was updated |
| `pass.created` | A pass was created |
| `pass.updated` | A pass was updated |
| `guild.updated` | Guild settings were updated |
| `verification.completed` | A verification was completed |

### Response Codes

| Status | Meaning |
|--------|---------|
| 200 | Processed (`status: "success"`) or intentionally skipped (`status: "ignored"`) |
| 401 | Missing or invalid signature |
| 413 | Payload too large |
| 422 | Invalid payload structure |
| 429 | Rate limited (too many failed attempts from source) |
| 500 | Internal error |

---

## Additional Resources

- [Webhook Utils Package](../../../packages/webhook-utils/README.md)
- [Root README](../../README.md)
