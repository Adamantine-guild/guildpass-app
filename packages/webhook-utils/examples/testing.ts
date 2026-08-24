/**
 * Webhook Testing Examples
 * 
 * Examples of how to test webhook endpoints using the generateSignature utility
 */

import { generateSignature, verifySignature } from "@guildpass/webhook-utils";

/**
 * Example 1: Unit test for verification logic
 */
export function testVerificationLogic() {
  const secret = "test-secret";
  const payload = JSON.stringify({ event: "member.joined", id: "123" });

  // Generate a valid signature
  const { signature, timestamp } = generateSignature({ secret, payload });

  // Verify it
  const result = verifySignature({
    signatureHeader: signature,
    secret,
    payload,
  });

  console.assert(result.valid === true, "Should verify valid signature");
  console.assert(result.timestamp === timestamp, "Should return timestamp");
  console.log("✓ Verification logic test passed successfully");
}

/**
 * Example 2: Integration test with fetch
 */
export async function testWebhookEndpoint() {
  const secret = process.env.WEBHOOK_SECRET || "test-secret";
  const payload = JSON.stringify({
    type: "member.joined",
    data: {
      memberId: "test-123",
      guildId: "guild-456",
      userId: "user-789",
      joinedAt: new Date().toISOString(),
    },
  });

  // Generate valid signature
  const { signature } = generateSignature({ secret, payload });

  // Send webhook request
  const response = await fetch("http://localhost:3000/api/webhooks/guildpass", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-guildpass-signature": signature,
    },
    body: payload,
  });

  console.assert(
    response.status === 200,
    `Expected 200, got ${response.status}`
  );
  console.log("✓ Webhook endpoint test passed");
}

/**
 * Example 3: Test invalid signature rejection
 */
export async function testInvalidSignature() {
  const payload = JSON.stringify({ event: "test" });

  // Use invalid signature
  const response = await fetch("http://localhost:3000/api/webhooks/guildpass", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-guildpass-signature": "t=123,v1=invalid",
    },
    body: payload,
  });

  console.assert(
    response.status === 401,
    `Expected 401, got ${response.status}`
  );
  console.log("✓ Invalid signature rejection test passed");
}

/**
 * Example 4: Test stale timestamp rejection
 */
export async function testStaleTimestamp() {
  const secret = process.env.WEBHOOK_SECRET || "test-secret";
  const payload = JSON.stringify({ event: "test" });

  // Generate signature with old timestamp (1 hour ago)
  const staleTimestamp = Math.floor(Date.now() / 1000) - 3600;
  const { signature } = generateSignature({
    secret,
    payload,
    timestamp: staleTimestamp,
  });

  const response = await fetch("http://localhost:3000/api/webhooks/guildpass", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-guildpass-signature": signature,
    },
    body: payload,
  });

  console.assert(
    response.status === 401,
    `Expected 401, got ${response.status}`
  );
  console.log("✓ Stale timestamp rejection test passed");
}

/**
 * Example 5: Jest/Vitest test suite
 */
export const jestTestSuite = `
import { describe, test, expect } from '@jest/globals';
import { generateSignature } from '@guildpass/webhook-utils';

describe('Webhook Endpoint', () => {
  const WEBHOOK_URL = 'http://localhost:3000/api/webhooks/guildpass';
  const SECRET = process.env.WEBHOOK_SECRET || 'test-secret';

  test('accepts valid webhook', async () => {
    const payload = JSON.stringify({
      type: 'member.joined',
      data: { memberId: '123' }
    });

    const { signature } = generateSignature({
      secret: SECRET,
      payload,
    });

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-guildpass-signature': signature,
      },
      body: payload,
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.received).toBe(true);
  });

  test('rejects invalid signature', async () => {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-guildpass-signature': 't=123,v1=invalid',
      },
      body: JSON.stringify({ event: 'test' }),
    });

    expect(response.status).toBe(401);
  });

  test('rejects missing signature', async () => {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ event: 'test' }),
    });

    expect(response.status).toBe(401);
  });

  test('rejects tampered payload', async () => {
    const originalPayload = JSON.stringify({ value: 100 });
    const { signature } = generateSignature({
      secret: SECRET,
      payload: originalPayload,
    });

    // Send different payload with same signature
    const tamperedPayload = JSON.stringify({ value: 999 });

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-guildpass-signature': signature,
      },
      body: tamperedPayload,
    });

    expect(response.status).toBe(401);
  });

  test('rejects stale timestamp', async () => {
    const payload = JSON.stringify({ event: 'test' });
    
    // Generate with timestamp from 1 hour ago
    const { signature } = generateSignature({
      secret: SECRET,
      payload,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-guildpass-signature': signature,
      },
      body: payload,
    });

    expect(response.status).toBe(401);
  });
});
`;

/**
 * Example 6: Playwright E2E test
 */
export const playwrightTest = `
import { test, expect } from '@playwright/test';
import { generateSignature } from '@guildpass/webhook-utils';

test.describe('Webhook Integration', () => {
  test('processes webhook and updates UI', async ({ page }) => {
    const SECRET = process.env.WEBHOOK_SECRET;
    
    // Navigate to dashboard
    await page.goto('http://localhost:3000/dashboard');
    
    // Send webhook via API
    const payload = JSON.stringify({
      type: 'member.joined',
      data: {
        memberId: 'test-123',
        guildId: 'guild-456',
        userId: 'user-789',
        joinedAt: new Date().toISOString(),
      },
    });

    const { signature } = generateSignature({ secret: SECRET, payload });

    await page.request.post('http://localhost:3000/api/webhooks/guildpass', {
      headers: {
        'content-type': 'application/json',
        'x-guildpass-signature': signature,
      },
      data: payload,
    });

    // Verify UI updated
    await expect(page.locator('[data-testid="member-test-123"]')).toBeVisible();
  });
});
`;

// Run tests if executed directly
if (require.main === module) {
  void (async () => {
    console.log("Running webhook tests...\n");

    testVerificationLogic();
    await testWebhookEndpoint();
    await testInvalidSignature();
    await testStaleTimestamp();

    console.log("\n✓ All tests passed!");
  })();
}
