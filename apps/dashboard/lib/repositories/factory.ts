/**
 * Repository factory: selects and instantiates repositories based on storage mode.
 * This is the single point of configuration for all data persistence.
 *
 * Durable mode: all repositories share a single pg.Pool created lazily in
 * `lib/db.ts`. The connection string passed to each constructor is retained
 * for API compatibility but the adapters route all queries through the pool.
 */

import type { IRepositoryFactory, IPassRepository, IGuildRepository, IMemberRepository, IActivityRepository, ISettingsRepository } from "./types";
import { MockPassRepository, MockGuildRepository, MockMemberRepository, MockActivityRepository, MockSettingsRepository } from "./adapters/mock";
import { DurablePassRepository, DurableGuildRepository, DurableMemberRepository, DurableActivityRepository, DurableSettingsRepository } from "./adapters/durable";
import { getStorageMode, getStorageConfig } from "../env";

/**
 * Singleton instances for mock repositories (reused per process).
 */
let mockPassRepo: IPassRepository | null = null;
let mockGuildRepo: IGuildRepository | null = null;
let mockMemberRepo: IMemberRepository | null = null;
let mockActivityRepo: IActivityRepository | null = null;
let mockSettingsRepo: ISettingsRepository | null = null;

/**
 * Singleton instances for durable repositories (reused per process).
 */
let durablePassRepo: IPassRepository | null = null;
let durableGuildRepo: IGuildRepository | null = null;
let durableMemberRepo: IMemberRepository | null = null;
let durableActivityRepo: IActivityRepository | null = null;
let durableSettingsRepo: ISettingsRepository | null = null;

/**
 * Creates or returns a cached repository factory based on storage mode.
 */
export function getRepositoryFactory(): IRepositoryFactory {
  const mode = getStorageMode();

  if (mode === "mock") {
    return {
      passRepository() {
        if (!mockActivityRepo) mockActivityRepo = new MockActivityRepository();
        if (!mockPassRepo) mockPassRepo = new MockPassRepository(mockActivityRepo);
        return mockPassRepo;
      },
      guildRepository() {
        if (!mockActivityRepo) mockActivityRepo = new MockActivityRepository();
        if (!mockGuildRepo) mockGuildRepo = new MockGuildRepository(mockActivityRepo);
        return mockGuildRepo;
      },
      memberRepository() {
        if (!mockActivityRepo) mockActivityRepo = new MockActivityRepository();
        if (!mockMemberRepo) mockMemberRepo = new MockMemberRepository(mockActivityRepo);
        return mockMemberRepo;
      },
      activityRepository() {
        if (!mockActivityRepo) mockActivityRepo = new MockActivityRepository();
        return mockActivityRepo;
      },
      settingsRepository() {
        if (!mockActivityRepo) mockActivityRepo = new MockActivityRepository();
        if (!mockSettingsRepo) mockSettingsRepo = new MockSettingsRepository(mockActivityRepo);
        return mockSettingsRepo;
      },
    };
  }

  if (mode === "durable") {
    const config = getStorageConfig();
    const connectionString = config.connectionString;

    return {
      passRepository() {
        if (!durableActivityRepo) durableActivityRepo = new DurableActivityRepository(connectionString);
        if (!durablePassRepo) durablePassRepo = new DurablePassRepository(connectionString, durableActivityRepo);
        return durablePassRepo;
      },
      guildRepository() {
        if (!durableActivityRepo) durableActivityRepo = new DurableActivityRepository(connectionString);
        if (!durableGuildRepo) durableGuildRepo = new DurableGuildRepository(connectionString, durableActivityRepo);
        return durableGuildRepo;
      },
      memberRepository() {
        if (!durableActivityRepo) durableActivityRepo = new DurableActivityRepository(connectionString);
        if (!durableMemberRepo) durableMemberRepo = new DurableMemberRepository(connectionString, durableActivityRepo);
        return durableMemberRepo;
      },
      activityRepository() {
        if (!durableActivityRepo) durableActivityRepo = new DurableActivityRepository(connectionString);
        return durableActivityRepo;
      },
      settingsRepository() {
        if (!durableActivityRepo) durableActivityRepo = new DurableActivityRepository(connectionString);
        if (!durableSettingsRepo) durableSettingsRepo = new DurableSettingsRepository(connectionString, durableActivityRepo);
        return durableSettingsRepo;
      },
    };
  }

  throw new Error(`Unknown storage mode: ${mode}`);
}

/**
 * Convenience function: get a specific repository directly.
 */
export function getPassRepository(): IPassRepository {
  return getRepositoryFactory().passRepository();
}

export function getGuildRepository(): IGuildRepository {
  return getRepositoryFactory().guildRepository();
}

export function getMemberRepository(): IMemberRepository {
  return getRepositoryFactory().memberRepository();
}

export function getActivityRepository(): IActivityRepository {
  return getRepositoryFactory().activityRepository();
}

export function getSettingsRepository(): ISettingsRepository {
  return getRepositoryFactory().settingsRepository();
}

/**
 * Clear cached repositories (useful for testing).
 */
export function clearRepositories(): void {
  mockPassRepo = null;
  mockGuildRepo = null;
  mockMemberRepo = null;
  mockActivityRepo = null;
  mockSettingsRepo = null;
  durablePassRepo = null;
  durableGuildRepo = null;
  durableMemberRepo = null;
  durableActivityRepo = null;
  durableSettingsRepo = null;
}
