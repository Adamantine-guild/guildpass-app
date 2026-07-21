import { createHmac, timingSafeEqual } from "crypto";

export type VerifyOptions = {
  /** The signature header from the incoming webhook (e.g., "t=1234567890,v1=abc123...") */
  signatureHeader: string;
  /** Your webhook secret used to sign the payload */
  secret: string;
  /** The raw webhook payload (must be the exact body bytes received) */
  payload: string | Buffer;
  /**
   * Optional timestamp tolerance in seconds (default: 300 = 5 minutes)
   * Set to 0 to disable timestamp validation
   */
  tolerance?: number;
};

export type VerifyResult = {
  /** Whether the signature is valid */
  valid: boolean;
  /** Error message if verification failed */
  error?: string;
  /** The timestamp from the signature header (if present) */
  timestamp?: number;
};

/**
 * Verify a webhook signature using HMAC-SHA256.
 * 
 * Expected signature format: "t=<timestamp>,v1=<signature>"
 * - t: Unix timestamp when the webhook was sent
 * - v1: HMAC-SHA256 signature of "t.<payload>"
 * 
 * This prevents:
 * - Tampering: Modified payloads won't match the signature
 * - Replay attacks: Old webhooks are rejected if timestamp is stale
 * - Timing attacks: Uses constant-time comparison
 * 
 * @example
 * ```ts
 * const result = verifySignature({
 *   signatureHeader: request.headers.get('x-guildpass-signature'),
 *   secret: process.env.WEBHOOK_SECRET,
 *   payload: rawBody,
 *   tolerance: 300 // 5 minutes
 * });
 * 
 * if (!result.valid) {
 *   return Response.json({ error: result.error }, { status: 401 });
 * }
 * ```
 */
export function verifySignature(opts: VerifyOptions): VerifyResult {
  const { signatureHeader, secret, payload, tolerance = 300 } = opts;

  // Validate inputs
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return { valid: false, error: "Missing or invalid signature header" };
  }

  if (!secret || typeof secret !== "string") {
    return { valid: false, error: "Missing or invalid secret" };
  }

  if (payload === null || payload === undefined) {
    return { valid: false, error: "Missing payload" };
  }

  // Parse signature header: "t=1234567890,v1=abc123..."
  const parts = signatureHeader.split(",");
  let timestamp: number | undefined;
  let signature: string | undefined;

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") {
      timestamp = parseInt(value, 10);
    } else if (key === "v1") {
      signature = value;
    }
  }

  if (!timestamp || isNaN(timestamp)) {
    return { valid: false, error: "Invalid or missing timestamp in signature" };
  }

  if (!signature) {
    return { valid: false, error: "Invalid or missing signature (v1)" };
  }

  // Check timestamp freshness (replay attack protection)
  if (tolerance > 0) {
    const now = Math.floor(Date.now() / 1000);
    const age = now - timestamp;

    if (age > tolerance) {
      return {
        valid: false,
        error: `Timestamp too old: ${age}s (tolerance: ${tolerance}s)`,
        timestamp,
      };
    }

    if (age < -tolerance) {
      return {
        valid: false,
        error: `Timestamp in future: ${Math.abs(age)}s`,
        timestamp,
      };
    }
  }

  // Compute expected signature: HMAC-SHA256(secret, "t.payload")
  const payloadString = Buffer.isBuffer(payload)
    ? payload.toString("utf8")
    : payload;

  const signedPayload = `${timestamp}.${payloadString}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  try {
    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: "Invalid signature", timestamp };
    }

    const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!isValid) {
      return { valid: false, error: "Invalid signature", timestamp };
    }

    return { valid: true, timestamp };
  } catch (err) {
    return {
      valid: false,
      error: "Signature comparison failed",
      timestamp,
    };
  }
}

/**
 * Generate a webhook signature for testing purposes.
 * 
 * @example
 * ```ts
 * const { signature, timestamp } = generateSignature({
 *   secret: 'my-secret',
 *   payload: JSON.stringify({ event: 'test' })
 * });
 * 
 * // Use in test request
 * fetch('/api/webhook', {
 *   headers: { 'x-guildpass-signature': signature }
 * });
 * ```
 */
export function generateSignature(opts: {
  secret: string;
  payload: string | Buffer;
  timestamp?: number;
}): { signature: string; timestamp: number } {
  const { secret, payload } = opts;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);

  const payloadString = Buffer.isBuffer(payload)
    ? payload.toString("utf8")
    : payload;

  const signedPayload = `${timestamp}.${payloadString}`;
  const hmac = createHmac("sha256", secret).update(signedPayload).digest("hex");

  return {
    signature: `t=${timestamp},v1=${hmac}`,
    timestamp,
  };
}
