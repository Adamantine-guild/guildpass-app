# Deployment notes

## Webhook idempotency storage

The dashboard webhook route must treat the incoming webhook event id as an
idempotency key. In local mock mode the dashboard keeps this in memory, which is
fine for development but resets on restart.

For durable local testing, set:

```env
ACTIVITY_STORAGE_MODE=file
ACTIVITY_STORAGE_DIR=.guildpass-activity
```

The file adapter records each processed webhook id with an exclusive write. If
the same event id is submitted again, the second request is treated as a
duplicate and no second activity entry is created.

For hosted production deployments, use the same activity storage interface with
a database-backed adapter. The processed webhook id should be stored with a
unique constraint or equivalent atomic insert operation. That keeps retries safe
across multiple app instances, redeployments, and serverless cold starts.

Keep `WEBHOOK_SECRET` configured in the dashboard environment before enabling
incoming webhooks.
