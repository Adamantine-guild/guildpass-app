import { test } from "node:test";
import assert from "node:assert";

test("GET /api/passes returns unsupported in live mode", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  process.env.DASHBOARD_API_MODE = "live";

  try {
    const { GET } = await import("../app/api/passes/route.js");
    const res: Response = await GET(new Request("http://localhost/api/passes"));
    const body = await res.json();

    assert.strictEqual(res.status, 501);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.code, "UNSUPPORTED");
    assert.deepStrictEqual(body.unsupported, { feature: "passes.list", mode: "live" });
  } finally {
    restoreEnv("DASHBOARD_API_MODE", previousMode);
  }
});

test("GET /api/passes returns paginated mock data in mock mode", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  process.env.DASHBOARD_API_MODE = "mock";

  try {
    const { GET } = await import("../app/api/passes/route.js");
    const { mockPasses, DEFAULT_GUILD_ID } = await import("../lib/mock-data.js");
    const res: Response = await GET(new Request("http://localhost/api/passes"));
    const body = await res.json();

    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.data.items), "response should include items");
    // Listing is tenant-scoped: only the active guild's passes are returned.
    const expected = mockPasses.filter((p) => p.guildId === DEFAULT_GUILD_ID).length;
    assert.strictEqual(body.data.total, expected);
  } finally {
    restoreEnv("DASHBOARD_API_MODE", previousMode);
  }
});

test("GET /api/guilds returns unsupported in live mode", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  process.env.DASHBOARD_API_MODE = "live";

  try {
    const { GET } = await import("../app/api/guilds/route.js");
    const res: Response = await GET();
    const body = await res.json();

    assert.strictEqual(res.status, 501);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.code, "UNSUPPORTED");
    assert.deepStrictEqual(body.unsupported, { feature: "guilds.list", mode: "live" });
  } finally {
    restoreEnv("DASHBOARD_API_MODE", previousMode);
  }
});

test("GET /api/guilds returns wrapped mock data in mock mode", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  process.env.DASHBOARD_API_MODE = "mock";

  try {
    const { GET } = await import("../app/api/guilds/route.js");
    const { mockGuilds } = await import("../lib/mock-data.js");
    const res: Response = await GET();
    const body = await res.json();

    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.data), "response data should be an array");
    assert.strictEqual(body.data.length, mockGuilds.length);
  } finally {
    restoreEnv("DASHBOARD_API_MODE", previousMode);
  }
});

test("GET /api/members returns unsupported in live mode without lookup params", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  const previousUrl = process.env.GUILD_PASS_CORE_URL;
  process.env.DASHBOARD_API_MODE = "live";
  process.env.GUILD_PASS_CORE_URL = "http://localhost:9999";

  try {
    const { GET } = await import("../app/api/members/route.js");
    const res: Response = await GET(new Request("http://localhost/api/members"));
    const body = await res.json();

    assert.strictEqual(res.status, 501);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.code, "UNSUPPORTED");
    assert.deepStrictEqual(body.unsupported, { feature: "members.list", mode: "live" });
  } finally {
    restoreEnv("DASHBOARD_API_MODE", previousMode);
    restoreEnv("GUILD_PASS_CORE_URL", previousUrl);
  }
});

test("GET /api/members returns data with wallet query in live mode", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  process.env.DASHBOARD_API_MODE = "live";

  try {
    (globalThis as any).__TEST_INTEGRATION_CLIENT = {
      getMembershipByWallet: async (wallet: string) => ({
        userId: `u_${wallet.slice(-4)}`,
        wallet,
        status: "active",
        roles: ["member"],
        updatedAt: new Date().toISOString(),
      }),
    };

    const { GET } = await import("../app/api/members/route.js");
    const res: Response = await GET(new Request("http://localhost/api/members?wallet=0xabc123"));
    const body = await res.json();

    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.data));
    assert.strictEqual(body.data.length, 1);
    assert.strictEqual(body.data[0].wallet, "0xabc123");
  } finally {
    delete (globalThis as any).__TEST_INTEGRATION_CLIENT;
    restoreEnv("DASHBOARD_API_MODE", previousMode);
  }
});

test("GET /api/members returns paginated mock data in mock mode", async () => {
  const previousMode = process.env.DASHBOARD_API_MODE;
  process.env.DASHBOARD_API_MODE = "mock";

  try {
    const { GET } = await import("../app/api/members/route.js");
    const { mockMembers, DEFAULT_GUILD_ID } = await import("../lib/mock-data.js");
    const res: Response = await GET(new Request("http://localhost/api/members"));
    const body = await res.json();

    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.data.items), "response should include items");
    // Listing is tenant-scoped: only the active guild's members are returned.
    const expected = mockMembers.filter((m) => m.guildId === DEFAULT_GUILD_ID).length;
    assert.strictEqual(body.data.total, expected);
  } finally {
    restoreEnv("DASHBOARD_API_MODE", previousMode);
  }
});

test("apiUnsupported returns the shared unsupported shape", async () => {
  const { apiUnsupported } = await import("../lib/api-helpers.js");
  const res: Response = apiUnsupported("example.feature", "live", "Test message");
  const body = await res.json();

  assert.strictEqual(res.status, 501);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.code, "UNSUPPORTED");
  assert.strictEqual(body.error, "Test message");
  assert.deepStrictEqual(body.unsupported, { feature: "example.feature", mode: "live" });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
