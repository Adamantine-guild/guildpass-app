import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { privateKeyToAccount } from "viem/accounts";

// Hardhat/Anvil dev account #0 (public test key)
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_WALLET = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

test("POST /api/verify forwards to core API in live mode", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  const previousCoreUrl = process.env.GUILD_PASS_CORE_URL;
  const previousApiKey = process.env.GUILD_PASS_CORE_API_KEY;
  const previousWebhookSecret = process.env.WEBHOOK_SECRET;
  process.env.DASHBOARD_API_MODE = "live";
  process.env.GUILD_PASS_CORE_API_KEY = "test-core-api-key";
  process.env.WEBHOOK_SECRET = "test-webhook-secret";

  let coreBody: any = null;
  const server = http.createServer((req, res) => {
    if (!req.url) return res.end();
    const url = new URL(req.url, `http://localhost`);

    if (url.pathname === "/v1/verify" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}");
        coreBody = parsed;
        const result = {
          userId: parsed.discordUserId,
          wallet: parsed.wallet,
          verified: true,
          message: "verified by fake core",
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to start server");
  const port = addr.port;

  process.env.GUILD_PASS_CORE_URL = `http://127.0.0.1:${port}`;

  try {
    const { resetVerificationChallengeStore } = await import("../lib/verification-challenge.js");
    resetVerificationChallengeStore();

    // 1. Request a challenge for the pair
    const { POST: challengePOST } = await import("../app/api/verify/challenge/route.js");
    const challengeRes = await challengePOST(
      new Request("http://localhost/api/verify/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordUserId: "u_live", wallet: TEST_WALLET }),
      }) as any,
    );
    const challengeBody = await challengeRes.json();
    assert.strictEqual(challengeBody.ok, true);
    const { nonce, message } = challengeBody.data;

    // 2. Sign the challenge with the claimed wallet
    const account = privateKeyToAccount(TEST_KEY);
    const signature = await account.signMessage({ message });

    // 3. Submit proof
    const { POST } = await import("../app/api/verify/route.js");
    const res = await POST(
      new Request("http://localhost/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordUserId: "u_live", wallet: TEST_WALLET, nonce, signature }),
      }) as any,
    );
    const body = await res.json();

    assert.strictEqual(body.ok, true);
    const data = body.data;
    assert.strictEqual(data.userId, "u_live");
    assert.strictEqual(data.wallet, TEST_WALLET);
    assert.strictEqual(data.verified, true);

    // core received the proof of control alongside the lookup
    assert.deepStrictEqual(coreBody.proof, { nonce, signature });
  } finally {
    if (server.listening) {
      server.close();
    }

    if (previousMode === undefined) {
      delete process.env.DASHBOARD_API_MODE;
    } else {
      process.env.DASHBOARD_API_MODE = previousMode;
    }

    if (previousCoreUrl === undefined) {
      delete process.env.GUILD_PASS_CORE_URL;
    } else {
      process.env.GUILD_PASS_CORE_URL = previousCoreUrl;
    }

    if (previousApiKey === undefined) {
      delete process.env.GUILD_PASS_CORE_API_KEY;
    } else {
      process.env.GUILD_PASS_CORE_API_KEY = previousApiKey;
    }

    if (previousWebhookSecret === undefined) {
      delete process.env.WEBHOOK_SECRET;
    } else {
      process.env.WEBHOOK_SECRET = previousWebhookSecret;
    }
  }
});
