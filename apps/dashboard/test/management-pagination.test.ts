import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  filterMembers,
  normalisePagination,
  paginateItems,
} from "../lib/pagination";
import type { Member } from "../lib/mock-data";

describe("pagination boundary helpers", () => {
  test("normalisePagination falls back for zero and negative limits", () => {
    assert.deepEqual(normalisePagination({ limit: 0 }), {
      limit: DEFAULT_LIST_LIMIT,
      page: 1,
    });
    assert.deepEqual(normalisePagination({ limit: -5 }), {
      limit: DEFAULT_LIST_LIMIT,
      page: 1,
    });
  });

  test("normalisePagination clamps oversized limits", () => {
    assert.deepEqual(normalisePagination({ limit: 999 }), {
      limit: MAX_LIST_LIMIT,
      page: 1,
    });
  });

  test("normalisePagination falls back for non-numeric pages and malformed cursors", () => {
    assert.deepEqual(normalisePagination({ page: Number.NaN }), {
      limit: DEFAULT_LIST_LIMIT,
      page: 1,
    });
    assert.deepEqual(normalisePagination({ cursor: "page:-1" }), {
      limit: DEFAULT_LIST_LIMIT,
      page: 1,
    });
    assert.deepEqual(normalisePagination({ cursor: "garbage" }), {
      limit: DEFAULT_LIST_LIMIT,
      page: 1,
    });
  });

  test("paginateItems never uses a negative page window", () => {
    assert.deepEqual(paginateItems(["a", "b", "c"], { limit: 1, page: -2 }), {
      items: ["a"],
      total: 3,
      limit: 1,
      page: 1,
      nextCursor: "page:2",
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });
});

const testMembers: Member[] = [
  {
    id: "m1",
    guildId: "g1",
    version: 1,
    wallet: "0xAAA1111111111111111111111111111111111A",
    name: "Alice Anderson",
    status: "active",
    roles: ["admin"],
    joinedAt: "2025-01-10T00:00:00Z",
    lastActive: "2025-06-01T00:00:00Z",
  },
  {
    id: "m2",
    guildId: "g1",
    version: 1,
    wallet: "0xBBB2222222222222222222222222222222222B",
    name: "Bob Brown",
    status: "active",
    roles: ["member"],
    joinedAt: "2025-03-15T00:00:00Z",
    lastActive: "2025-06-01T00:00:00Z",
  },
  {
    id: "m3",
    guildId: "g1",
    version: 1,
    wallet: "0xCCC3333333333333333333333333333333333C",
    name: "Cara White",
    status: "inactive",
    roles: ["member", "contributor"],
    joinedAt: "2025-06-20T00:00:00Z",
    lastActive: "2025-06-01T00:00:00Z",
  },
];

describe("filterMembers (search, role, and join-date filtering)", () => {
  test("matches partial member name, case-insensitively", () => {
    const result = filterMembers(testMembers, { search: "ali" });
    assert.deepEqual(result.map((m) => m.name), ["Alice Anderson"]);
  });

  test("matches partial wallet address, case-insensitively", () => {
    const result = filterMembers(testMembers, { search: "ccc333" });
    assert.deepEqual(result.map((m) => m.name), ["Cara White"]);
  });

  test("filters by role", () => {
    const result = filterMembers(testMembers, { role: "contributor" });
    assert.deepEqual(result.map((m) => m.name), ["Cara White"]);
  });

  test("filters by joined-date range, inclusive of both bounds", () => {
    const result = filterMembers(testMembers, { joinedFrom: "2025-01-10", joinedTo: "2025-03-15" });
    assert.deepEqual(result.map((m) => m.name), ["Alice Anderson", "Bob Brown"]);
  });

  test("joinedTo alone excludes members who joined after that date", () => {
    const result = filterMembers(testMembers, { joinedTo: "2025-02-01" });
    assert.deepEqual(result.map((m) => m.name), ["Alice Anderson"]);
  });

  test("joinedFrom alone excludes members who joined before that date", () => {
    const result = filterMembers(testMembers, { joinedFrom: "2025-06-01" });
    assert.deepEqual(result.map((m) => m.name), ["Cara White"]);
  });

  test("combines search, role, status, and date range together", () => {
    const result = filterMembers(testMembers, {
      search: "bob",
      role: "member",
      status: "active",
      joinedFrom: "2025-03-01",
      joinedTo: "2025-04-01",
    });
    assert.deepEqual(result.map((m) => m.name), ["Bob Brown"]);
  });

  test("returns an empty array when combined filters match nobody", () => {
    const result = filterMembers(testMembers, { search: "bob", role: "contributor" });
    assert.deepEqual(result, []);
  });
});

describe("management list pagination and filtering", () => {
  test("GET /api/passes searches by name or description", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/passes/route.js");
      const response = await GET(new Request("http://localhost/api/passes?search=early"));
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.equal(body.data.total, 1);
      assert.equal(body.data.items[0].name, "Founder Pass");
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/passes filters by status and paginates", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/passes/route.js");
      const response = await GET(new Request("http://localhost/api/passes?status=active&limit=2&page=1"));
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.equal(body.data.total, 3);
      assert.equal(body.data.items.length, 2);
      assert.equal(body.data.hasNextPage, true);
      assert.ok(body.data.items.every((pass: any) => pass.status === "active"));
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members searches by name or wallet", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");
      const response = await GET(new Request("http://localhost/api/members?search=90F8"));
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.equal(body.data.total, 1);
      assert.equal(body.data.items[0].name, "Bob");
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members filters by status and role", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");
      const response = await GET(new Request("http://localhost/api/members?status=active&role=contributor"));
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.equal(body.data.total, 1);
      assert.equal(body.data.items[0].name, "Bob");
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members returns a clear empty paginated result", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");
      const response = await GET(new Request("http://localhost/api/members?search=no-such-member"));
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.deepEqual(body.data.items, []);
      assert.equal(body.data.total, 0);
      assert.equal(body.data.nextCursor, null);
      assert.equal(body.data.hasNextPage, false);
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members search matches partial member name case-insensitively", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");
      const response = await GET(new Request("http://localhost/api/members?search=AlI"));
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.equal(body.data.total, 1);
      assert.equal(body.data.items[0].name, "Alice");
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members search matches partial wallet address case-insensitively", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");
      const response = await GET(new Request("http://localhost/api/members?search=90f8bf6a"));
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.equal(body.data.total, 1);
      assert.equal(body.data.items[0].name, "Bob");
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members filters by role alone", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");
      const response = await GET(new Request("http://localhost/api/members?role=admin"));
      const body = await response.json();

      assert.equal(body.ok, true);
      // Guild 1 (default) has exactly one admin: Alice.
      assert.equal(body.data.total, 1);
      assert.equal(body.data.items[0].name, "Alice");
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members filters by joined-date range", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");

      // Guild 1 joinedAt dates: Alice 2024-12-01, Bob 2025-01-05,
      // Charlie 2025-06-12, Diana 2025-02-14.
      const response = await GET(
        new Request("http://localhost/api/members?joinedFrom=2025-01-01&joinedTo=2025-03-01")
      );
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.equal(body.data.total, 2);
      const names = body.data.items.map((m: { name: string }) => m.name).sort();
      assert.deepEqual(names, ["Bob", "Diana"]);
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members joinedTo is inclusive of the whole day", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");

      // Charlie joined 2025-06-12T00:00:00Z; a joinedTo of the same calendar
      // date must still include him even though his timestamp isn't midnight-exact.
      const response = await GET(new Request("http://localhost/api/members?joinedTo=2025-06-12"));
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.ok(body.data.items.some((m: { name: string }) => m.name === "Charlie"));
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members combines search, role, status, and date range", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");
      const { GUILD_ID_HEADER } = await import("../lib/guild-context.js");

      // Guild 2: Frank (contributor, active, joined 2025-02-03) should match;
      // narrowing the date range further should exclude him again.
      const matches = new Request(
        "http://localhost/api/members?search=frank&role=contributor&status=active&joinedFrom=2025-02-01&joinedTo=2025-02-28",
        { headers: { [GUILD_ID_HEADER]: "2" } }
      );
      const matchesBody = await (await GET(matches as any)).json();
      assert.equal(matchesBody.ok, true);
      assert.equal(matchesBody.data.total, 1);
      assert.equal(matchesBody.data.items[0].name, "Frank");

      const excluded = new Request(
        "http://localhost/api/members?search=frank&role=contributor&status=active&joinedFrom=2025-03-01&joinedTo=2025-03-31",
        { headers: { [GUILD_ID_HEADER]: "2" } }
      );
      const excludedBody = await (await GET(excluded as any)).json();
      assert.equal(excludedBody.ok, true);
      assert.equal(excludedBody.data.total, 0);
      assert.deepEqual(excludedBody.data.items, []);
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });

  test("GET /api/members returns empty state when combined filters match nobody", async () => {
    const previousMode = process.env.DASHBOARD_API_MODE;
    process.env.DASHBOARD_API_MODE = "mock";

    try {
      const { GET } = await import("../app/api/members/route.js");

      // Real name + wrong role: no member in guild 1 satisfies both.
      const response = await GET(
        new Request("http://localhost/api/members?search=alice&role=contributor")
      );
      const body = await response.json();

      assert.equal(body.ok, true);
      assert.deepEqual(body.data.items, []);
      assert.equal(body.data.total, 0);
      assert.equal(body.data.hasNextPage, false);
      assert.equal(body.data.hasPreviousPage, false);
    } finally {
      restoreEnv("DASHBOARD_API_MODE", previousMode);
    }
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
