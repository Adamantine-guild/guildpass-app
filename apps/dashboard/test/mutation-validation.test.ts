import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  clearRepositories,
  getMemberRepository,
  getPassRepository,
} from "../lib/repositories/factory";
import {
  validateMemberCreatePayload,
  validateMemberUpdatePayload,
  validatePassCreatePayload,
  validatePassUpdatePayload,
} from "../lib/validation/mutations";

process.env.DASHBOARD_API_MODE = "mock";
process.env.DASHBOARD_STORAGE_MODE = "mock";

const VALID_WALLET = "0x742d35Cc6634C0532925a3b8879539d43374e290";

type MutationValidationResult =
  | ReturnType<typeof validatePassCreatePayload>
  | ReturnType<typeof validatePassUpdatePayload>
  | ReturnType<typeof validateMemberCreatePayload>
  | ReturnType<typeof validateMemberUpdatePayload>;

function errorFields(result: MutationValidationResult): string[] {
  assert.equal(result.valid, false);
  if (result.valid) {
    throw new Error("Expected validation to fail");
  }

  return result.errors.map((error: { field: string }) => error.field);
}

beforeEach(() => {
  clearRepositories();
});

describe("pass mutation validation", () => {
  test("accepts valid pass create payloads in mock mode", async () => {
    const validation = validatePassCreatePayload({
        name: "Season Pass",
        description: "Access for this season",
        price: 0.25,
        maxSupply: 100,
    });
    assert.equal(validation.valid, true);
    if (!validation.valid) {
      throw new Error("Expected validation to pass");
    }

    const pass = await getPassRepository().create(validation.data);
    assert.equal(pass.name, "Season Pass");
    assert.equal(pass.status, "draft");
    assert.equal(pass.currentSupply, 0);
    assert.ok(pass.id);
    assert.ok(pass.createdAt);
  });

  test("returns field errors for missing required pass fields", () => {
    const result = validatePassCreatePayload({
      description: "",
    });

    assert.deepEqual(errorFields(result), ["name", "description"]);
  });

  test("rejects invalid pass status and supply values", () => {
    const result = validatePassUpdatePayload({
      status: "archived",
      currentSupply: -1,
      maxSupply: 1.5,
    });

    assert.deepEqual(errorFields(result), [
      "maxSupply",
      "currentSupply",
      "status",
    ]);
  });

  test("rejects malformed pass payloads", () => {
    const result = validatePassCreatePayload("not an object");

    assert.deepEqual(errorFields(result), ["body"]);
  });

  test("rejects server-owned pass fields", () => {
    const result = validatePassUpdatePayload({
      id: "client-id",
      createdAt: "2020-01-01T00:00:00.000Z",
    });

    assert.deepEqual(errorFields(result), ["id", "createdAt"]);
  });
});

describe("member mutation validation", () => {
  test("accepts valid member create payloads in mock mode", async () => {
    const validation = validateMemberCreatePayload({
        name: "Ada",
        wallet: VALID_WALLET,
        roles: ["member", "contributor"],
    });
    assert.equal(validation.valid, true);
    if (!validation.valid) {
      throw new Error("Expected validation to pass");
    }

    const member = await getMemberRepository().create(validation.data);
    assert.equal(member.name, "Ada");
    assert.equal(member.wallet, VALID_WALLET);
    assert.equal(member.status, "pending");
    assert.deepEqual(member.roles, ["member", "contributor"]);
    assert.ok(member.id);
    assert.ok(member.joinedAt);
    assert.ok(member.lastActive);
  });

  test("returns field errors for missing required member fields", () => {
    const result = validateMemberCreatePayload({
      roles: [],
    });

    assert.deepEqual(errorFields(result), ["name", "wallet"]);
  });

  test("rejects invalid member wallet, status, roles, and dates", () => {
    const result = validateMemberUpdatePayload({
      wallet: "0xnot-a-wallet",
      status: "banned",
      roles: ["owner"],
      joinedAt: "not-a-date",
      lastActive: 123,
    });

    assert.deepEqual(errorFields(result), [
      "wallet",
      "roles.0",
      "joinedAt",
      "lastActive",
      "status",
    ]);
  });

  test("rejects malformed member payloads", () => {
    const result = validateMemberCreatePayload(null);

    assert.deepEqual(errorFields(result), ["body"]);
  });

  test("rejects server-owned member fields", () => {
    const result = validateMemberUpdatePayload({
      id: "client-id",
      createdAt: "2020-01-01T00:00:00.000Z",
    });

    assert.deepEqual(errorFields(result), ["id", "createdAt"]);
  });
});
