# @guildpass/webhook-utils

Production-ready webhook verification utilities for GuildPass integrations.

## Features

- ✅ **HMAC-SHA256 signature verification** – Cryptographically secure payload validation
- ✅ **Replay attack protection** – Timestamp-based validation prevents stale webhooks
- ✅ **Timing attack resistant** – Constant-time comparison for security
- ✅ **Zero dependencies** – Uses Node.js built-in crypto module
- ✅ **TypeScript support** – Fully typed with comprehensive documentation
- ✅ **Framework agnostic** – Works with Next.js, Express, Fastify, and more

## Installation

```bash
pnpm add @guildpass/webhook-utils
```

## Quick Start

```typescript
import { verifySignature } from "@guildpass/webhook-utils";

// In your webhook handler
const result = verifySignature({
  signatureHeader: request.headers.get('x-guildpass-signature'),
  secret: process.env.WEBHOOK_SECRET,
  payload: rawBody, // IMPORTANT: Must be the raw, unparsed body
  tolerance: 300 // Optional: 5 minutes (default)
});

if (!result.valid) {
  return Response.json({ error: result.error }, { status: 401 });
}

// Signature is valid, process the webhook
const event = JSON.parse(rawBody);
```

## Signature Format

Webhooks include an `x-guildpass-signature` header with the format:

```
t=<unix_timestamp>,v1=<hmac_sha256_signature>
```

- **t**: Unix timestamp when the webhook was sent
- **v1**: HMAC-SHA256 hash of `"{timestamp}.{payload}"` using your secret

## API Reference

### `verifySignature(options)`

Verifies a webhook signature using HMAC-SHA256.

#### Parameters

```typescript
{
  signatureHeader: string;  // The 'x-guildpass-signature' header value
  secret: string;           // Your webhook secret from the dashboard
  payload: string | Buffer; // Raw request body (NOT parsed JSON)
  tolerance?: number;       // Timestamp tolerance in seconds (default: 300)
}
```

#### Returns

```typescript
{
  valid: boolean;      // Whether signature is valid
  error?: string;      // Error message if invalid
  timestamp?: number;  // Timestamp from signature header
}
```

#### Example

```typescript
const result = verifySignature({
  signatureHeader: 't=1234567890,v1=abc123...',
  secret: 'whsec_...',
  payload: '{"event":"member.joined"}',
  tolerance: 300
});

if (result.valid) {
  console.log('Webhook verified at', new Date(result.timestamp * 1000));
} else {
  console.error('Verification failed:', result.error);
}
```

### `generateSignature(options)`

Generates a webhook signature for testing purposes.

#### Parameters

```typescript
{
  secret: string;           // Your webhook secret
  payload: string | Buffer; // The webhook payload
  timestamp?: number;       // Optional custom timestamp (defaults to now)
}
```

#### Returns

```typescript
{
  signature: string;  // The formatted signature header value
  timestamp: number;  // The timestamp used in the signature
}
```

#### Example

```typescript
const { signature, timestamp } = generateSignature({
  secret: 'whsec_test',
  payload: JSON.stringify({ event: 'test' })
});

// Use in test request
fetch('http://localhost:3000/api/webhook', {
  method: 'POST',
  headers: {
    'x-guildpass-signature': signature,
    'content-type': 'application/json'
  },
  body: JSON.stringify({ event: 'test' })
});
```

## Framework Examples

### Next.js App Router (Route Handler)

Next.js requires special handling to access the raw request body:

```typescript
// app/api/webhook/route.ts
import { verifySignature } from "@guildpass/webhook-utils";

export async function POST(request: Request) {
  // CRITICAL: Get raw body BEFORE parsing
  const rawBody = await request.text();
  
  const signature = request.headers.get('x-guildpass-signature');
  const secret = process.env.WEBHOOK_SECRET!;

  const result = verifySignature({
    signatureHeader: signature || '',
    secret,
    payload: rawBody,
  });

  if (!result.valid) {
    console.error('Webhook verification failed:', result.error);
    return Response.json(
      { error: 'Invalid signature' },
      { status: 401 }
    );
  }

  // Parse and process the event
  const event = JSON.parse(rawBody);
  
  switch (event.type) {
    case 'member.joined':
      await handleMemberJoined(event.data);
      break;
    case 'pass.activated':
      await handlePassActivated(event.data);
      break;
    default:
      console.log('Unhandled event type:', event.type);
  }

  return Response.json({ received: true });
}
```

### Next.js Pages Router (API Route)

```typescript
// pages/api/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifySignature } from '@guildpass/webhook-utils';
import { buffer } from 'micro';

// CRITICAL: Disable body parsing to get raw body
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get raw body
  const rawBody = await buffer(req);
  const signature = req.headers['x-guildpass-signature'] as string;

  const result = verifySignature({
    signatureHeader: signature || '',
    secret: process.env.WEBHOOK_SECRET!,
    payload: rawBody,
  });

  if (!result.valid) {
    console.error('Verification failed:', result.error);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process the webhook
  const event = JSON.parse(rawBody.toString());
  console.log('Webhook received:', event.type);

  res.status(200).json({ received: true });
}
```

### Express

```typescript
import express from 'express';
import { verifySignature } from '@guildpass/webhook-utils';

const app = express();

// CRITICAL: Use raw body parser for webhook endpoint
app.post('/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const signature = req.headers['x-guildpass-signature'] as string;
    
    const result = verifySignature({
      signatureHeader: signature || '',
      secret: process.env.WEBHOOK_SECRET!,
      payload: req.body, // Already a Buffer from express.raw()
    });

    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }

    const event = JSON.parse(req.body.toString());
    console.log('Webhook event:', event.type);

    res.json({ received: true });
  }
);
```

### Fastify

```typescript
import Fastify from 'fastify';
import { verifySignature } from '@guildpass/webhook-utils';

const fastify = Fastify();

fastify.post('/webhook', {
  config: {
    // Get raw body
    rawBody: true,
  },
  handler: async (request, reply) => {
    const signature = request.headers['x-guildpass-signature'] as string;
    const rawBody = request.rawBody!;

    const result = verifySignature({
      signatureHeader: signature || '',
      secret: process.env.WEBHOOK_SECRET!,
      payload: rawBody,
    });

    if (!result.valid) {
      return reply.code(401).send({ error: result.error });
    }

    const event = JSON.parse(rawBody.toString());
    console.log('Webhook event:', event.type);

    return { received: true };
  },
});
```

## Security Best Practices

### 1. Always Use Raw Body

The signature is computed on the **exact bytes** received. Parsed JSON will not match:

```typescript
// ❌ WRONG - Parsed body won't match signature
const body = await request.json();
verifySignature({ payload: JSON.stringify(body), ... });

// ✅ CORRECT - Use raw body
const rawBody = await request.text();
verifySignature({ payload: rawBody, ... });
```

### 2. Set Appropriate Tolerance

Default is 300 seconds (5 minutes). Adjust based on your needs:

```typescript
// Strict: 1 minute tolerance
verifySignature({ tolerance: 60, ... });

// Lenient: 10 minutes (for slow networks)
verifySignature({ tolerance: 600, ... });

// Disabled: No timestamp check (NOT recommended for production)
verifySignature({ tolerance: 0, ... });
```

### 3. Never Expose Your Secret

```typescript
// ❌ WRONG - Secret in code
const secret = 'whsec_hardcoded123';

// ✅ CORRECT - Secret from environment
const secret = process.env.WEBHOOK_SECRET;
if (!secret) throw new Error('WEBHOOK_SECRET not configured');
```

### 4. Handle Verification Errors Properly

```typescript
const result = verifySignature({ ... });

if (!result.valid) {
  // Log for debugging (but don't expose to caller)
  console.error('Webhook verification failed:', {
    error: result.error,
    timestamp: result.timestamp,
    receivedAt: new Date().toISOString(),
  });

  // Return generic error to client
  return Response.json(
    { error: 'Invalid signature' },
    { status: 401 }
  );
}
```

### 5. Use HTTPS Only

Webhooks should only be received over HTTPS to prevent man-in-the-middle attacks. Signature verification does not protect against network eavesdropping.

### 6. Protect the Endpoint Itself

Signature verification stops forged events, but the verification step itself
costs CPU — an endpoint that verifies unbounded bodies at unbounded rates can
still be abused. Reject oversized bodies **before** verifying, rate-limit
sources with repeated failed verifications, and log rejections in a
structured format (without the secret or signature values) so probing is
visible. The dashboard's webhook route (`apps/dashboard/app/api/webhooks/`)
implements this pattern; see `SECURITY.md` ("Webhook Endpoint Abuse
Defenses") for the limits, log format, and configuration env vars.

## Testing

### Unit Tests

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch
```

### Integration Testing

Use `generateSignature` to create valid signatures for your tests:

```typescript
import { generateSignature } from '@guildpass/webhook-utils';

describe('Webhook endpoint', () => {
  test('should accept valid webhook', async () => {
    const payload = JSON.stringify({ event: 'member.joined', id: '123' });
    const { signature } = generateSignature({
      secret: process.env.WEBHOOK_SECRET,
      payload,
    });

    const response = await fetch('http://localhost:3000/api/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-guildpass-signature': signature,
      },
      body: payload,
    });

    expect(response.status).toBe(200);
  });

  test('should reject invalid signature', async () => {
    const response = await fetch('http://localhost:3000/api/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-guildpass-signature': 't=123,v1=invalid',
      },
      body: JSON.stringify({ event: 'test' }),
    });

    expect(response.status).toBe(401);
  });
});
```

## Troubleshooting

### "Invalid signature" error

**Cause**: Body content doesn't match what was signed.

**Solutions**:
- Ensure you're using the raw body, not parsed JSON
- Check that your framework isn't modifying the body (e.g., adding charset)
- Verify the secret matches your dashboard configuration

### "Timestamp too old" error

**Cause**: Webhook was sent more than `tolerance` seconds ago.

**Solutions**:
- Increase the tolerance if your server is slow or experiencing delays
- Check for clock skew between your server and GuildPass
- Ensure webhooks are processed quickly

### "Missing or invalid signature header" error

**Cause**: The `x-guildpass-signature` header is missing or malformed.

**Solutions**:
- Verify the header name is exactly `x-guildpass-signature`
- Check that the header is being forwarded by any proxies/load balancers
- Ensure the webhook is coming from GuildPass

## Webhook Events

GuildPass sends webhooks for various events. See the [API documentation](../../apps/docs/docs/api-overview.md) for a complete list of event types.

Common events include:

- `member.joined` - A new member joined a guild
- `member.left` - A member left a guild
- `pass.activated` - A guild pass was activated
- `pass.expired` - A guild pass expired
- `guild.updated` - Guild settings were updated

## Support

For issues or questions:

- 📖 [Documentation](../../apps/docs)
- 🐛 [Report a bug](../../CONTRIBUTING.md)
- 💬 [Discord community](#)

## License

MIT - See [LICENSE](../../LICENSE) for details.
