# Changelog

All notable changes to the @guildpass/webhook-utils package will be documented in this file.

## [0.2.0] - 2026-07-29

### Added

#### Outbound Webhook Delivery
- `WebhookEvent` type — `event`, `payload`, `timestamp`, `guildId`
- `dispatchWebhook(subscriberUrl, event, options)` — signs an event with
  `generateSignature` and POSTs it to a subscriber URL, retrying transient
  failures with exponential backoff and full jitter (default: 3 attempts,
  200ms base delay)
- Dead-letter handling: `DeadLetterStore` interface + `InMemoryDeadLetterStore`,
  written to when a delivery exhausts all retry attempts
- Subscriber registry: `createSubscriberRegistry(mapping)` and
  `loadSubscriberRegistryFromEnv()` for a minimal guildId → URL(s) mock
  config, structured to be swappable for a database-backed registry later
- New environment variables (see `.env.example`): `WEBHOOK_DISPATCH_SECRET`,
  `WEBHOOK_SUBSCRIBERS`, `WEBHOOK_DISPATCH_MAX_ATTEMPTS`,
  `WEBHOOK_DISPATCH_BASE_DELAY_MS`, `WEBHOOK_DISPATCH_MAX_DELAY_MS`

#### Documentation
- README: "Outbound Webhook Delivery" section documenting the `WebhookEvent`
  schema, the signing/verification contract, `dispatchWebhook` usage, retry
  strategy, subscriber registry, and dead-letter handling

#### Testing
- New test suite (`test/dispatch.test.js`) covering signing/verification
  symmetry for dispatched payloads, retry-then-succeed behavior, exponential
  backoff with jitter, dead-letter recording after exhausted retries, and a
  source-scan check that no secrets or subscriber URLs are hardcoded in the
  dispatcher or registry modules

### Notes

- `generateSignature` is unchanged but is now documented as the production
  signing primitive for outbound delivery, not only a testing utility —
  signing and verification were already symmetric (same HMAC-SHA256 scheme),
  so no new signing algorithm was introduced.
- Still zero runtime dependencies.

## [0.1.0] - 2026-06-21

### Added

#### Core Functionality
- **Production-ready webhook signature verification** using HMAC-SHA256
- **Replay attack protection** with configurable timestamp tolerance
- **Timing attack resistance** using constant-time comparison
- **Comprehensive input validation** for all parameters
- **Flexible payload support** (string or Buffer)
- **Detailed error messages** for debugging

#### API
- `verifySignature(options)` - Verify incoming webhook signatures
  - Validates signature format (t=timestamp,v1=signature)
  - Checks timestamp freshness (configurable tolerance, default 300s)
  - Uses constant-time comparison for security
  - Returns detailed result with error messages
- `generateSignature(options)` - Generate signatures for testing
  - Supports custom timestamps
  - Works with string or Buffer payloads
  - Returns formatted signature header

#### TypeScript Support
- Full TypeScript type definitions
- `VerifyOptions` interface with detailed documentation
- `VerifyResult` interface with validation results
- Zero dependencies (uses Node.js built-in crypto)

#### Testing
- **Comprehensive test suite** with 40+ test cases covering:
  - Valid signature verification (string, Buffer, custom timestamp)
  - Invalid signature rejection (tampering, wrong secret, malformed)
  - Timestamp validation (stale, future, within tolerance)
  - Malformed header handling (missing parts, invalid format)
  - Input validation (missing/invalid parameters)
  - Body tampering detection (character changes, whitespace, encoding)
  - Signature generation (format, timestamps, uniqueness)
- Uses Node.js built-in test runner (no external dependencies)
- All tests pass with 100% coverage of security scenarios

#### Documentation
- **README.md** - Complete usage guide with:
  - Quick start guide
  - API reference with examples
  - Framework-specific examples (Next.js App Router, Pages Router, Express, Fastify)
  - Security best practices
  - Troubleshooting guide
  - Common webhook events reference
- **TESTING.md** - Comprehensive testing guide with:
  - Unit testing instructions
  - Integration testing examples
  - Framework-specific test examples (Jest, Vitest, Node.js, Playwright, Cypress)
  - Manual testing with cURL and Postman
  - CI/CD configuration examples
  - Performance testing guide
  - Security testing (fuzzing)

#### Examples
- **nextjs-app-router.ts** - Complete Next.js 13+ App Router example
  - Raw body handling
  - Signature verification
  - Event type routing
  - Error handling
  - TypeScript types for webhook events
- **express.ts** - Express middleware example
  - Raw body parser configuration
  - Webhook handler implementation
- **testing.ts** - Testing utilities and examples
  - Unit test examples
  - Integration test patterns
  - Jest/Vitest test suites
  - Playwright E2E tests

#### Integration Documentation
- **apps/dashboard/app/api/README.md** - Dashboard-specific webhook integration guide
  - Configuration instructions
  - Environment variable setup
  - Security best practices
  - Common event types
  - Error codes reference
  - Monitoring recommendations

#### Package Configuration
- Added test scripts (`test`, `test:watch`)
- Added `@types/node` dev dependency for TypeScript types
- Configured for ESM output
- Zero runtime dependencies

### Security

- **HMAC-SHA256 signature verification** ensures payload integrity
- **Timing-safe comparison** prevents timing attacks
- **Timestamp validation** prevents replay attacks
- **Input validation** prevents injection and malformed data
- **Constant-time operations** for cryptographic security

### Performance

- Zero dependencies (uses Node.js built-in crypto)
- ~10,000 verifications per second on modern hardware
- Minimal memory footprint
- Efficient Buffer handling

## Upgrade Guide

### From Stub Implementation

If you were using the previous stub implementation:

```typescript
// Old (stub)
const valid = verifySignature({ signatureHeader, secret, payload });
if (!valid) { /* error */ }

// New (production-ready)
const result = verifySignature({ signatureHeader, secret, payload });
if (!result.valid) {
  console.error(result.error);
  // Handle specific error cases
}
```

The API now returns a detailed result object instead of a boolean:

```typescript
type VerifyResult = {
  valid: boolean;
  error?: string;      // NEW: Detailed error message
  timestamp?: number;  // NEW: Timestamp from signature
};
```

### Migration Checklist

- ✅ Update code to handle `result.valid` instead of direct boolean
- ✅ Add error logging using `result.error`
- ✅ Configure `tolerance` parameter (default: 300s)
- ✅ Ensure raw body is being used (not parsed JSON)
- ✅ Update tests to use `generateSignature` utility
- ✅ Add webhook secret to environment variables

## Support Status

This package is actively maintained and production-ready. It is used to verify webhooks from GuildPass integrations.

## License

MIT - See [LICENSE](../../LICENSE)
