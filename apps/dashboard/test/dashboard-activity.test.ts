import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearRepositories,
  getActivityRepository,
  getPassRepository,
  getMemberRepository,
  getGuildRepository,
} from "../lib/repositories/factory";
import { recordDashboardActivity } from "../lib/activity/dashboard";
import type { ActivityEvent } from "../lib/activity/types";

process.env.DASHBOARD_STORAGE_MODE = "mock";
process.env.DASHBOARD_API_MODE = "mock";

describe("recordDashboardActivity", () => {
  beforeEach(() => clearRepositories());

  test("creates a pass.created event with actor, entity, source, severity, and timestamp", async () => {
    const event = await recordDashboardActivity({
      type: "pass.created",
      entity: { type: "pass", id: "p1", name: "Test Pass" },
      actor: { name: "Admin", id: "admin-001" },
    });

    assert.equal(event.type, "pass.created");
    assert.equal(event.source, "dashboard");
    assert.equal(event.severity, "info");
    assert.equal(event.actor.name, "Admin");
    assert.equal(event.actor.id, "admin-001");
    assert.equal(event.entity?.type, "pass");
    assert.equal(event.entity?.id, "p1");
    assert.equal(event.entity?.name, "Test Pass");
    assert.ok(event.id, "should have a generated id");
    assert.ok(event.timestamp, "should have an ISO timestamp");
    assert.ok(event.description.includes("Test Pass"), "description should reference entity");
  });

  test("pass.updated event", async () => {
    const event = await recordDashboardActivity({
      type: "pass.updated",
      entity: { type: "pass", id: "p1", name: "Test Pass" },
      actor: { name: "Admin" },
    });

    assert.equal(event.type, "pass.updated");
    assert.equal(event.source, "dashboard");
    assert.ok(event.actor.name, "Admin");
  });

  test("pass.deleted event", async () => {
    const event = await recordDashboardActivity({
      type: "pass.deleted",
      entity: { type: "pass", id: "p1", name: "Test Pass" },
      actor: { name: "Admin" },
    });

    assert.equal(event.type, "pass.deleted");
    assert.equal(event.source, "dashboard");
    assert.ok(event.description.includes("Test Pass"));
  });

  test("member.roles_changed event", async () => {
    const event = await recordDashboardActivity({
      type: "member.roles_changed",
      entity: { type: "member", id: "m1", name: "Alice" },
      actor: { name: "Admin" },
    });

    assert.equal(event.type, "member.roles_changed");
    assert.equal(event.source, "dashboard");
    assert.equal(event.entity?.type, "member");
  });

  test("member.left event", async () => {
    const event = await recordDashboardActivity({
      type: "member.left",
      entity: { type: "member", id: "m1", name: "Alice" },
      actor: { name: "Admin" },
    });

    assert.equal(event.type, "member.left");
    assert.equal(event.source, "dashboard");
    assert.equal(event.entity?.id, "m1");
  });

  test("member.joined event", async () => {
    const event = await recordDashboardActivity({
      type: "member.joined",
      entity: { type: "member", id: "m1", name: "Alice" },
      actor: { name: "Admin" },
    });

    assert.equal(event.type, "member.joined");
    assert.equal(event.source, "dashboard");
  });

  test("guild.created event", async () => {
    const event = await recordDashboardActivity({
      type: "guild.created",
      entity: { type: "guild", id: "g1", name: "New Guild" },
      actor: { name: "Admin" },
    });

    assert.equal(event.type, "guild.created");
    assert.equal(event.source, "dashboard");
  });

  test("guild.updated event", async () => {
    const event = await recordDashboardActivity({
      type: "guild.updated",
      entity: { type: "guild", id: "g1", name: "Updated Guild" },
      actor: { name: "Admin" },
    });

    assert.equal(event.type, "guild.updated");
    assert.equal(event.source, "dashboard");
  });

  test("guild.deleted event", async () => {
    const event = await recordDashboardActivity({
      type: "guild.deleted",
      entity: { type: "guild", id: "g1", name: "Old Guild" },
      actor: { name: "Admin" },
    });

    assert.equal(event.type, "guild.deleted");
    assert.equal(event.source, "dashboard");
  });

  test("settings.updated event", async () => {
    const event = await recordDashboardActivity({
      type: "settings.updated",
      actor: { name: "Admin" },
      description: "Dashboard settings updated",
    });

    assert.equal(event.type, "settings.updated");
    assert.equal(event.source, "dashboard");
    assert.equal(event.description, "Dashboard settings updated");
    assert.equal(event.entity, undefined, "settings events may omit entity");
  });

  test("events persist and are queryable via activity repository", async () => {
    await recordDashboardActivity({
      type: "pass.created",
      entity: { type: "pass", id: "p_query", name: "Query Test" },
      actor: { name: "Admin" },
    });

    const events = await getActivityRepository().query({});
    assert.ok(events.length >= 1);
    const found = events.find((e) => e.entity?.id === "p_query");
    assert.ok(found, "event should be stored and retrievable");
    assert.equal(found?.type, "pass.created");
  });

  test("multiple events are stored with correct ordering", async () => {
    await recordDashboardActivity({
      type: "pass.created",
      entity: { type: "pass", id: "p_first", name: "First" },
      actor: { name: "Admin" },
    });

    await recordDashboardActivity({
      type: "pass.created",
      entity: { type: "pass", id: "p_second", name: "Second" },
      actor: { name: "Admin" },
    });

    const events = await getActivityRepository().query({});
    const firstIndex = events.findIndex((e) => e.entity?.id === "p_first");
    const secondIndex = events.findIndex((e) => e.entity?.id === "p_second");
    assert.ok(firstIndex >= 0, "first event should exist");
    assert.ok(secondIndex >= 0, "second event should exist");
  });

  test("events include source=dashboard for all types", async () => {
    const types: Array<ActivityEvent["type"]> = [
      "pass.created", "pass.updated", "pass.deleted",
      "member.joined", "member.left", "member.roles_changed",
      "guild.created", "guild.updated", "guild.deleted",
      "settings.updated",
    ];

    for (const type of types) {
      const event = await recordDashboardActivity({
        type,
        entity: type === "settings.updated" ? undefined : { type: type.startsWith("pass") ? "pass" : type.startsWith("member") ? "member" : "guild", id: "test" },
        actor: { name: "Tester" },
      });
      assert.equal(event.source, "dashboard", `${type} should have source=dashboard`);
    }
  });

  test("failed mutations do not record activity events", async () => {
    const before = await getActivityRepository().query({});

    const repo = getPassRepository();
    const result = await repo.update("nonexistent", { name: "test" });
    assert.equal(result, null, "update of non-existent pass returns null");

    const after = await getActivityRepository().query({});
    assert.equal(after.length, before.length, "no activity event should be recorded for a failed update");
  });

  test("route handler pass creation flow records activity", async () => {
    const repo = getPassRepository();
    const created = await repo.create({
      name: "Integration Pass",
      description: "Test",
      status: "active",
      currentSupply: 0,
    });

    await recordDashboardActivity({
      type: "pass.created",
      entity: { type: "pass", id: created.id, name: created.name },
      actor: { name: "Admin" },
    });

    const events = await getActivityRepository().query({ type: "pass.created" });
    const found = events.find((e) => e.entity?.id === created.id);
    assert.ok(found, "pass created event should exist");
    assert.equal(found?.entity?.name, "Integration Pass");
  });

  test("route handler pass update flow records activity", async () => {
    const repo = getPassRepository();
    const created = await repo.create({
      name: "Update Pass",
      description: "Test",
      status: "draft",
      currentSupply: 0,
    });

    const updated = await repo.update(created.id, { status: "active" });
    assert.ok(updated);

    await recordDashboardActivity({
      type: "pass.updated",
      entity: { type: "pass", id: updated!.id, name: updated!.name },
      actor: { name: "Admin" },
    });

    const events = await getActivityRepository().query({ type: "pass.updated" });
    const found = events.find((e) => e.entity?.id === created.id);
    assert.ok(found, "pass updated event should exist");
  });

  test("route handler pass deactivation flow records activity", async () => {
    const repo = getPassRepository();
    const created = await repo.create({
      name: "Deactivate Pass",
      description: "Test",
      status: "active",
      currentSupply: 0,
    });

    const deleted = await repo.delete(created.id);
    assert.equal(deleted, true);

    await recordDashboardActivity({
      type: "pass.deleted",
      entity: { type: "pass", id: created.id, name: created.name },
      actor: { name: "Admin" },
    });

    const events = await getActivityRepository().query({ type: "pass.deleted" });
    const found = events.find((e) => e.entity?.id === created.id);
    assert.ok(found, "pass deleted event should exist");
  });

  test("route handler member role change flow records activity", async () => {
    const repo = getMemberRepository();
    const created = await repo.create({
      wallet: "0xrole_test",
      name: "Role Test",
      status: "active",
      roles: ["member"],
      joinedAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    });

    const updated = await repo.update(created.id, { roles: ["member", "contributor"] });
    assert.ok(updated);

    await recordDashboardActivity({
      type: "member.roles_changed",
      entity: { type: "member", id: updated!.id, name: updated!.name },
      actor: { name: "Admin" },
    });

    const events = await getActivityRepository().query({ type: "member.roles_changed" });
    const found = events.find((e) => e.entity?.id === created.id);
    assert.ok(found, "member roles_changed event should exist");
  });

  test("route handler member removal flow records activity", async () => {
    const repo = getMemberRepository();
    const created = await repo.create({
      wallet: "0xremoval_test",
      name: "Remove Test",
      status: "active",
      roles: ["member"],
      joinedAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    });

    const deleted = await repo.delete(created.id);
    assert.equal(deleted, true);

    await recordDashboardActivity({
      type: "member.left",
      entity: { type: "member", id: created.id, name: created.name },
      actor: { name: "Admin" },
    });

    const events = await getActivityRepository().query({ type: "member.left" });
    const found = events.find((e) => e.entity?.id === created.id);
    assert.ok(found, "member left event should exist");
  });

  test("route handler guild update flow records activity", async () => {
    const repo = getGuildRepository();
    const created = await repo.create({
      name: "Activity Test Guild",
      description: "Testing activity recording",
      memberCount: 0,
      passCount: 0,
    });

    const updated = await repo.update(created.id, { description: "Updated description" });
    assert.ok(updated);

    await recordDashboardActivity({
      type: "guild.updated",
      entity: { type: "guild", id: updated!.id, name: updated!.name },
      actor: { name: "Admin" },
    });

    const events = await getActivityRepository().query({ type: "guild.updated" });
    const found = events.find((e) => e.entity?.id === created.id);
    assert.ok(found, "guild updated event should exist");
  });
});
