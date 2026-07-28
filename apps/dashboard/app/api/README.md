# Dashboard API Routes

This directory contains Next.js API route handlers for the GuildPass dashboard.

## Existing Routes

### Activity Feed
- **GET** `/api/activity` - Fetch recent activity events
- **GET** `/api/activity/verify` - Verify the global durable PostgreSQL activity hash chain (owner/admin; `guilds:write`)

### Guilds
- **GET** `/api/guilds` - List guilds and their metadata

### Members
- **GET** `/api/members` - List guild members

### Passes
- **GET** `/api/passes` - List guild passes

### Verification
- **POST** `/api/verify` - Verify user credentials

## Adding Webhook Support

To receive webhooks from GuildPass integrations, you can add a webhook endpoint using the `@guildpass/webhook-utils` package for secure signature verification.

### Example: Webhook Endpoint

Create a new route at `app/api/webhooks/guildpass/route.ts`:

```typescript
import { verifySignature } from "@guildpass/webhook-utils";
import { apiError, apiResponse } from "@/lib/api-helpers";

export async function POST(request: Request) {
  // 1. Get raw body (CRITICAL: before parsing)
  const rawBody = await request.text();
  
  // 2. Get signature header
  const signature = request.headers.get('x-guildpass-signature');
  
  if (!signature) {
    return apiError('Missing signature', 401);
  }
  
  // 3. Verify signature
  const result = verifySignature({
    signatureHeader: signature,
    secret: process.env.WEBHOOK_SECRET!,
    payload: rawBody,
    tolerance: 300, // 5 minutes
  });
  
  if (!result.valid) {
    console.error('Webhook verification failed:', result.error);
    return apiError('Invalid signature', 401);
  }
  
  // 4. Process the verified webhook
  const event = JSON.parse(rawBody);
  
  switch (event.type) {
    case 'member.joined':
      // Handle member joined event
      break;
    case 'pass.activated':
      // Handle pass activated event
      break;
    // Add more event types as needed
  }
  
  return apiResponse({ received: true });
}
```

### Configuration

1. **Add webhook secret to environment variables:**

   ```bash
   # .env.local
   WEBHOOK_SECRET=whsec_your_secret_from_guildpass_dashboard
   ```

2. **Install the webhook utilities package:**

   The package is already part of the monorepo workspace. If you need to add it as a dependency:

   ```json
   // apps/dashboard/package.json
   {
     "dependencies": {
       "@guildpass/webhook-utils": "workspace:*"
     }
   }
   ```

3. **Update environment type definitions:**

   ```typescript
   // lib/env.ts
   declare global {
     namespace NodeJS {
       interface ProcessEnv {
         WEBHOOK_SECRET: string;
         // ... other env vars
       }
     }
   }
   ```

### Security Best Practices

1. **Always use raw body** - The signature is computed on the exact bytes received
2. **Set appropriate tolerance** - Default is 300 seconds (5 minutes)
3. **Never expose the secret** - Always use environment variables
4. **Log verification failures** - Monitor for potential attacks
5. **Use HTTPS only** - Webhooks should only be received over HTTPS

### Testing Webhooks

For testing, use the `generateSignature` utility:

```typescript
import { generateSignature } from '@guildpass/webhook-utils';

const payload = JSON.stringify({ event: 'test' });
const { signature } = generateSignature({
  secret: process.env.WEBHOOK_SECRET,
  payload,
});

// Use signature in test request
await fetch('http://localhost:3000/api/webhooks/guildpass', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-guildpass-signature': signature,
  },
  body: payload,
});
```

### Additional Resources

- [Webhook Utils Package Documentation](../../../packages/webhook-utils/README.md)
- [Next.js Example](../../../packages/webhook-utils/examples/nextjs-app-router.ts)
- [Testing Examples](../../../packages/webhook-utils/examples/testing.ts)

### Common Webhook Events

| Event Type | Description | Data |
|------------|-------------|------|
| `member.joined` | A new member joined a guild | `{ memberId, guildId, userId, joinedAt }` |
| `member.left` | A member left a guild | `{ memberId, guildId, userId, leftAt }` |
| `pass.activated` | A guild pass was activated | `{ passId, guildId, userId, activatedAt, expiresAt }` |
| `pass.expired` | A guild pass expired | `{ passId, guildId, userId, expiredAt }` |
| `guild.updated` | Guild settings were updated | `{ guildId, changes, updatedAt }` |

### Error Codes

| Status | Meaning | Description |
|--------|---------|-------------|
| 200 | Success | Webhook processed successfully |
| 401 | Unauthorized | Invalid or missing signature |
| 500 | Internal Error | Server error processing webhook |

### Monitoring

Consider adding monitoring for:
- Failed signature verifications (potential security issues)
- Webhook processing latency
- Event type distribution
- Timestamp age (detect clock skew issues)

Example logging:

```typescript
console.log('Webhook metrics:', {
  type: event.type,
  verified: result.valid,
  age: Date.now() / 1000 - result.timestamp!,
  processingTime: Date.now() - startTime,
});
```
