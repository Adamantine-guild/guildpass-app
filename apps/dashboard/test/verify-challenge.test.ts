import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHALLENGE_TTL_MS,
  createVerificationChallengeStore,
  resetVerificationChallengeStore,
} from "../lib/verification-challenge.js";

// Hardhat/Anvil dev accounts #0 and #1 (public, used across the ecosystem for tests)
const ALICE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BOB_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ALICE = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const savedEnv: Record<string, string | undefined> = {};

function setLiveEnv() {
  for (const k of ["DASHBOARD_API_MODE", "GUILD_PASS_CORE_URL", "GUILD_PASS_CORE_API_KEY", "WEBHOOK_SECRET"]) {
    savedEnv[k] = process.env[k];
  }
  process.env.DASHBOARD_API_MODE = "live";
  process.env.GUILD_PASS_CORE_URL = "http://127.0.0.1:1";
  process.env.GUILD_PASS_CORE_API_KEY = "test-core-api-key";
  process.env.WEBHOOK_SECRET = "test-webhook-secret";
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function jsonRequest(url: string, payload: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function issueChallenge(discordUserId: string, wallet: string) {
  const { POST: challengePOST } = await import("../app/api/verify/challenge/route.js");
  const res = await challengePOST(jsonRequest("http://localhost/api/verify/challenge", { discordUserId, wallet }) as any);
  const body = await res.json();
  return { res, body };
}

async function signChallenge(privateKey: `0x${string}`, message: string) {
  const account = privateKeyToAccount(privateKey);
  return account.signMessage({ message });
}

beforeEach(() => {
  resetVerificationChallengeStore();
  delete (globalThis as any).__TEST_VERIFICATION_CHALLENGE_STORE;
  setLiveEnv();
});

afterEach(() => {
  delete (globalThis as any).__TEST_INTEGRATION_CLIENT;
  delete (globalThis as any).__TEST_VERIFICATION_CHALLENGE_STORE;
  resetVerificationChallengeStore();
  restoreEnv();
});

test("POST /api/verify/challenge issues a challenge scoped to the pair", async () => {
  const { res, body } = await issueChallenge("user_1", ALICE);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.ok, true);
  assert.ok(typeof body.data.nonce === "string" && body.data.nonce.length >= 8);
  assert.ok(body.data.message.includes("Discord user: user_1"));
  assert.ok(body.data.message.includes(`Wallet: ${ALICE}`));
  assert.ok(body.data.message.includes(`Nonce: ${body.data.nonce}`));
  assert.strictEqual(body.data.expiresIn, Math.floor(CHALLENGE_TTL_MS / 1000));
});

test("POST /api/verify/challenge rejects missing fields and bad checksum", async () => {
  const missing = await issueChallenge("", "");
  assert.strictEqual(missing.res.status, 400);

  const badWallet = await issueChallenge("user_1", ALICE.toLowerCase());
  assert.strictEqual(badWallet.res.status, 400);
});

test("POST /api/verify without a signature is rejected in live mode", async () => {
  const { POST } = await import("../app/api/verify/route.js");
  const res = await POST(jsonRequest("http://localhost/api/verify", { discordUserId: "user_1", wallet: ALICE }) as any);
  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.strictEqual(body.ok, false);
});

test("valid signature over the issued challenge verifies", async () => {
  let calledWith: { discordUserId?: string; wallet?: string; options?: any } = {};
  (globalThis as any).__TEST_INTEGRATION_CLIENT = {
    verifyWallet: async (discordUserId: string, wallet: string, options?: any) => {
      calledWith = { discordUserId, wallet, options };
      return { userId: discordUserId, wallet, verified: true, message: "ok" };
    },
  };

  const { body: challengeBody } = await issueChallenge("user_1", ALICE);
  const { nonce, message } = challengeBody.data;
  const signature = await signChallenge(ALICE_KEY, message);

  const { POST } = await import("../app/api/verify/route.js");
  const res = await POST(
    jsonRequest("http://localhost/api/verify", { discordUserId: "user_1", wallet: ALICE, nonce, signature }) as any,
  );
  const body = await res.json();
  assert.strictEqual(res.status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.data.verified, true);
  assert.strictEqual(calledWith.discordUserId, "user_1");
  // proof is forwarded to core with the verification request
  assert.deepStrictEqual(calledWith.options?.proof, { nonce, signature });
});

test("signature from a different wallet is rejected", async () => {
  (globalThis as any).__TEST_INTEGRATION_CLIENT = {
    verifyWallet: async () => {
      throw new Error("must not be called");
    },
  };

  const { body: challengeBody } = await issueChallenge("user_1", ALICE);
  const { nonce, message } = challengeBody.data;
  const signature = await signChallenge(BOB_KEY, message); // wrong signer

  const { POST } = await import("../app/api/verify/route.js");
  const res = await POST(
    jsonRequest("http://localhost/api/verify", { discordUserId: "user_1", wallet: ALICE, nonce, signature }) as any,
  );
  assert.strictEqual(res.status, 401);
});

test("a consumed nonce cannot be replayed", async () => {
  (globalThis as any).__TEST_INTEGRATION_CLIENT = {
    verifyWallet: async (discordUserId: string, wallet: string) => ({
      userId: discordUserId, wallet, verified: true,
    }),
  };

  const { body: challengeBody } = await issueChallenge("user_1", ALICE);
  const { nonce, message } = challengeBody.data;
  const signature = await signChallenge(ALICE_KEY, message);

  const { POST } = await import("../app/api/verify/route.js");
  const first = await POST(
    jsonRequest("http://localhost/api/verify", { discordUserId: "user_1", wallet: ALICE, nonce, signature }) as any,
  );
  assert.strictEqual(first.status, 200);

  const second = await POST(
    jsonRequest("http://localhost/api/verify", { discordUserId: "user_1", wallet: ALICE, nonce, signature }) as any,
  );
  assert.strictEqual(second.status, 401);
});

test("a challenge issued for a different discord user is rejected (cross-context)", async () => {
  (globalThis as any).__TEST_INTEGRATION_CLIENT = {
    verifyWallet: async () => {
      throw new Error("must not be called");
    },
  };

  const { body: challengeBody } = await issueChallenge("user_1", ALICE);
  const { nonce, message } = challengeBody.data;
  const signature = await signChallenge(ALICE_KEY, message);

  const { POST } = await import("../app/api/verify/route.js");
  // Same wallet, same nonce, valid signature — but a different Discord user.
  const res = await POST(
    jsonRequest("http://localhost/api/verify", { discordUserId: "user_2", wallet: ALICE, nonce, signature }) as any,
  );
  assert.strictEqual(res.status, 401);
});

test("challenge store enforces single-use, scope, and expiry", () => {
  const store = createVerificationChallengeStore();
  const t0 = 1_000_000;

  const c = store.issue("u1", ALICE, t0);
  assert.strictEqual(store.size(), 1);

  // wrong pair can't consume it
  assert.strictEqual(store.consume("u2", ALICE, c.nonce, t0), null);
  assert.strictEqual(store.size(), 1, "failed cross-pair consume must not burn the challenge");

  // correct pair consumes it once
  assert.ok(store.consume("u1", ALICE, c.nonce, t0 + 1));
  assert.strictEqual(store.consume("u1", ALICE, c.nonce, t0 + 2), null, "replay must fail");

  // expired challenge is rejected
  const c2 = store.issue("u1", ALICE, t0);
  assert.strictEqual(store.consume("u1", ALICE, c2.nonce, t0 + CHALLENGE_TTL_MS + 1), null);

  // re-issuing for the same pair replaces the old challenge
  const c3 = store.issue("u1", ALICE, t0);
  const c4 = store.issue("u1", ALICE, t0);
  assert.notStrictEqual(c3.nonce, c4.nonce);
  assert.strictEqual(store.consume("u1", ALICE, c3.nonce, t0), null, "superseded nonce must fail");
  assert.ok(store.consume("u1", ALICE, c4.nonce, t0));
});
