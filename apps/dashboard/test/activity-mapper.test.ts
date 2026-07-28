import { describe, test } from "node:test";
import assert from "node:assert";
import { mapWebhookToActivity } from "../lib/activity/mapper";
import { CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION } from "@guildpass/integration-client";
import type { WebhookPayload } from "../lib/activity/types";

const CREATED = 1_700_000_000;
const TIMESTAMP = "2023-11-14T22:13:20.000Z";

function payload(overrides: Partial<WebhookPayload>): WebhookPayload {
  return {
    id: "evt_test",
    type: "membership.created",
    created: CREATED,
    data: {},
    ...overrides,
  };
}

describe("mapWebhookToActivity", () => {
  test("maps membership.created webhooks to member.joined activity", () => {
    const data = { id: "member_123", name: "Alice", wallet: "0xabc" };
    const activity = mapWebhookToActivity(
      payload({ id: "evt_membership_created", type: "membership.created", data })
    );

    assert.deepStrictEqual(activity, {
      id: "evt_membership_created",
      type: "member.joined",
      source: "webhook",
      severity: "info",
      actor: {
        name: "Alice",
        wallet: "0xabc",
      },
      description: "New member joined: Alice",
      timestamp: TIMESTAMP,
      entity: {
        type: "member",
        id: "member_123",
        name: "Alice",
      },
      metadata: data,
      schemaVersion: CURRENT_ACTIVITY_EVENT_SCHEMA_VERSION,
    });
  });

  test("maps membership.updated webhooks to the existing member.left activity type", () => {
    const data = { id: "member_456", name: "Bob", wallet: "0xdef" };
    const activity = mapWebhookToActivity(
      payload({ id: "evt_membership_updated", type: "membership.updated", data })
    );

    assert.strictEqual(activity?.id, "evt_membership_updated");
    assert.strictEqual(activity?.type, "member.left");
    assert.strictEqual(activity?.source, "webhook");
    assert.strictEqual(activity?.severity, "info");
    assert.deepStrictEqual(activity?.actor, { name: "Bob", wallet: "0xdef" });
    assert.strictEqual(activity?.description, "Member Bob updated");
    assert.strictEqual(activity?.timestamp, TIMESTAMP);
    assert.deepStrictEqual(activity?.entity, {
      type: "member",
      id: "member_456",
      name: "Bob",
    });
    assert.deepStrictEqual(activity?.metadata, data);
  });

  test("maps pass.created webhooks", () => {
    const data = { id: "pass_123", name: "Founders Pass" };
    const activity = mapWebhookToActivity(
      payload({ id: "evt_pass_created", type: "pass.created", data })
    );

    assert.strictEqual(activity?.id, "evt_pass_created");
    assert.strictEqual(activity?.type, "pass.created");
    assert.deepStrictEqual(activity?.actor, { name: "Admin" });
    assert.strictEqual(activity?.description, "New pass created: Founders Pass");
    assert.strictEqual(activity?.timestamp, TIMESTAMP);
    assert.deepStrictEqual(activity?.entity, {
      type: "pass",
      id: "pass_123",
      name: "Founders Pass",
    });
    assert.deepStrictEqual(activity?.metadata, data);
  });

  test("maps pass.updated webhooks", () => {
    const data = { id: "pass_456", name: "VIP Pass" };
    const activity = mapWebhookToActivity(
      payload({ id: "evt_pass_updated", type: "pass.updated", data })
    );

    assert.strictEqual(activity?.id, "evt_pass_updated");
    assert.strictEqual(activity?.type, "pass.updated");
    assert.deepStrictEqual(activity?.actor, { name: "Admin" });
    assert.strictEqual(activity?.description, "Pass updated: VIP Pass");
    assert.deepStrictEqual(activity?.entity, {
      type: "pass",
      id: "pass_456",
      name: "VIP Pass",
    });
    assert.deepStrictEqual(activity?.metadata, data);
  });

  test("maps guild.updated webhooks", () => {
    const data = { id: "guild_123", name: "Adamantine Guild" };
    const activity = mapWebhookToActivity(
      payload({ id: "evt_guild_updated", type: "guild.updated", data })
    );

    assert.strictEqual(activity?.id, "evt_guild_updated");
    assert.strictEqual(activity?.type, "guild.updated");
    assert.deepStrictEqual(activity?.actor, { name: "Admin" });
    assert.strictEqual(activity?.description, "Guild settings updated: Adamantine Guild");
    assert.deepStrictEqual(activity?.entity, {
      type: "guild",
      id: "guild_123",
      name: "Adamantine Guild",
    });
    assert.deepStrictEqual(activity?.metadata, data);
  });

  test("maps verification.completed webhooks", () => {
    const data = { wallet: "0x987" };
    const activity = mapWebhookToActivity(
      payload({ id: "evt_verification_completed", type: "verification.completed", data })
    );

    assert.strictEqual(activity?.id, "evt_verification_completed");
    assert.strictEqual(activity?.type, "verification.completed");
    assert.deepStrictEqual(activity?.actor, { wallet: "0x987" });
    assert.strictEqual(activity?.description, "Verification completed for 0x987");
    assert.deepStrictEqual(activity?.entity, {
      type: "verification",
      id: "0x987",
    });
    assert.deepStrictEqual(activity?.metadata, data);
  });

  test("returns null for unsupported webhook event types", () => {
    const activity = mapWebhookToActivity(
      payload({ id: "evt_unsupported", type: "pass.deleted", data: { id: "pass_789" } })
    );

    assert.strictEqual(activity, null);
  });

  test("uses fallback display values when optional names are missing", () => {
    const member = mapWebhookToActivity(
      payload({
        id: "evt_member_without_name",
        type: "membership.created",
        data: { id: "member_without_name", wallet: "0xmissing" },
      })
    );
    const pass = mapWebhookToActivity(
      payload({
        id: "evt_pass_without_name",
        type: "pass.created",
        data: { id: "pass_without_name" },
      })
    );
    const guild = mapWebhookToActivity(
      payload({
        id: "evt_guild_without_name",
        type: "guild.updated",
        data: { id: "guild_without_name" },
      })
    );

    assert.strictEqual(member?.description, "New member joined: 0xmissing");
    assert.strictEqual(pass?.description, "New pass created: pass_without_name");
    assert.strictEqual(guild?.description, "Guild settings updated: guild_without_name");
  });
});

describe("mapWebhookToActivity metadata sanitisation", () => {
  test("strips fields outside the per-type allowlist from stored metadata", () => {
    const activity = mapWebhookToActivity(
      payload({
        id: "evt_membership_created_extra_fields",
        type: "membership.created",
        data: {
          id: "member_123",
          name: "Alice",
          wallet: "0xabc",
          email: "alice@example.com",
          password: "hunter2",
        },
      })
    );

    assert.deepStrictEqual(activity?.metadata, {
      id: "member_123",
      name: "Alice",
      wallet: "0xabc",
    });
    assert.strictEqual("email" in (activity?.metadata ?? {}), false);
    assert.strictEqual("password" in (activity?.metadata ?? {}), false);
  });

  test("stores an empty metadata object for unrecognised data fields", () => {
    const activity = mapWebhookToActivity(
      payload({
        id: "evt_pass_created_extra_fields",
        type: "pass.created",
        data: { id: "pass_123", name: "Founders Pass", internalNotes: "do not expose" },
      })
    );

    assert.deepStrictEqual(activity?.metadata, { id: "pass_123", name: "Founders Pass" });
    assert.strictEqual("internalNotes" in (activity?.metadata ?? {}), false);
  });

  test("never stores the raw webhook data object as metadata by reference", () => {
    const data = { id: "guild_123", name: "Adamantine Guild", secret: "leaked" };
    const activity = mapWebhookToActivity(
      payload({ id: "evt_guild_updated_extra_fields", type: "guild.updated", data })
    );

    assert.notStrictEqual(activity?.metadata, data);
    assert.strictEqual("secret" in (activity?.metadata ?? {}), false);
  });
});
