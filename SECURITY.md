# Security Policy <!-- IC: 182 -->

## Supported Versions <!-- IC: 183 -->

| Version | Supported | <!-- IC: 184 -->
|---|---| <!-- IC: 185 -->
| 0.1.x (main) | ✅ Yes | <!-- IC: 186 -->

## Reporting a Vulnerability <!-- IC: 187 -->

We take security seriously. If you discover a security vulnerability in this repository, please **do not** open a public GitHub issue. <!-- IC: 188 -->

### How to report <!-- IC: 189 -->

1. **Email** us at **cerealboxx123@gmail.com** with the subject line `[SECURITY] guildpass-app — <brief description>`. <!-- IC: 190 -->
2. Include: <!-- IC: 191 -->
   - A description of the vulnerability <!-- IC: 192 -->
   - Steps to reproduce it <!-- IC: 193 -->
   - The potential impact <!-- IC: 194 -->
   - Any suggested mitigations (optional) <!-- IC: 195 -->
3. We will acknowledge receipt within **72 hours** and aim to provide an initial assessment within **7 days**. <!-- IC: 196 -->

### Scope <!-- IC: 197 -->

This repository contains: <!-- IC: 198 -->
- A Discord bot that authenticates with the Discord API and calls `guildpass-core` <!-- IC: 199 -->
- A Docusaurus documentation site (static, no server-side secrets) <!-- IC: 200 -->

**In-scope concerns:** <!-- IC: 201 -->
- Exposure of Discord bot tokens or API keys <!-- IC: 202 -->
- Privilege escalation via slash commands <!-- IC: 203 -->
- Webhook verification bypass <!-- IC: 204 -->
- Unsafe data passed from Discord to `guildpass-core` <!-- IC: 205 -->

**Out-of-scope for this repo:** <!-- IC: 206 -->
- Vulnerabilities in `guildpass-core` — please report those in that repository <!-- IC: 207 -->
- Discord platform bugs — report those to [Discord's bug bounty](https://discord.com/security) <!-- IC: 208 -->

### Disclosure policy <!-- IC: 209 -->

- We will work with you to understand and resolve the issue. <!-- IC: 210 -->
- We ask for a **90-day** coordinated disclosure window before public disclosure. <!-- IC: 211 -->
- We will credit reporters in the release notes unless you prefer to remain anonymous.

## Webhook Endpoint Abuse Defenses

The dashboard webhook endpoint (`POST /api/webhooks`) applies two guards
ahead of signature verification and logs every rejection in a structured
format:

- **Payload size limit** — bodies larger than `WEBHOOK_MAX_BODY_BYTES`
  (default `262144` = 256 KB) are rejected with `413` before any HMAC work,
  checked against both the declared `content-length` and the actual body
  size.
- **Failed-verification rate limit** — a source (first `x-forwarded-for`
  address, else `x-real-ip`) that produces more than
  `WEBHOOK_INVALID_ATTEMPT_LIMIT` (default `10`) failed verifications within
  `WEBHOOK_RATE_LIMIT_WINDOW_MS` (default `60000` ms) is rejected with `429`
  until the sliding window expires. A successful verification resets the
  source's window, so legitimate senders are unaffected. The limiter is
  in-process; multi-instance deployments should back it with shared storage.

Every rejection emits one JSON log line via `console.warn`:

```json
{"event":"webhook_rejected","reason":"invalid_signature","source":"203.0.113.9","endpoint":"/api/webhooks","status":401,"ts":"2026-07-24T00:00:00.000Z"}
```

`reason` is one of `oversized_payload`, `invalid_signature`,
`expired_timestamp`, `rate_limited`, `malformed_header`. The log NEVER
contains the webhook secret, the signature header value, or the request
body — only the metadata above, which is safe to ship to alerting.

Thank you for helping keep GuildPass secure.
